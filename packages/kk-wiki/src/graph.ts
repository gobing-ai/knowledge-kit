import { relative } from 'node:path';
import { createNodeFileSystem, type FileSystem, walkDir } from '@gobing-ai/ts-runtime';
import type { FindingCode, FindingRecord } from './findings';
import { type PageFrontmatter, PageFrontmatterSchema, parseFrontmatter, resolveSlug } from './page';

/**
 * Vault index: every page parsed once, its wikilinks resolved, its inbound links counted
 * (task 0356, docs/design/kk-wiki.md §3).
 *
 * The index is rebuilt from disk on every call — there is no cache file, so a stale index cannot
 * report a false clean lint.
 */

/** One `[[...]]` occurrence inside a page body. */
export interface LinkRef {
    /** Link target as written (a slug or a page title). */
    target: string;
    /** Display surface after `|`, when the link carries one. */
    surface: string | null;
    /** 1-based line number in the page body. */
    line: number;
}

/** One indexed page. */
export interface VaultPageEntry {
    path: string;
    slug: string;
    frontmatter: PageFrontmatter;
    body: string;
    /** 1-based line where the body starts in the file (frontmatter offset for file-relative lines). */
    bodyStartLine: number;
    links: LinkRef[];
    inbound: number;
}

/** A parsed vault: pages keyed by path and by slug, plus the defects found while building it. */
export interface VaultIndex {
    contentDir: string;
    pages: VaultPageEntry[];
    bySlug: Map<string, VaultPageEntry>;
    findings: FindingRecord[];
}

/** Toggle-aware line scanner that ignores fenced blocks and inline code spans. */
interface ScannedLine {
    line: number;
    /** Line content with inline code spans masked out. */
    text: string;
    inFence: boolean;
}

/**
 * Split a body into scannable lines: fenced blocks are reported but their content is skipped, and
 * inline code spans are blanked so a `[[example]]` inside backticks is not a link.
 */
export function scanLines(body: string): ScannedLine[] {
    const result: ScannedLine[] = [];
    let inFence = false;
    body.split('\n').forEach((raw, index) => {
        const isFence = /^\s*(```|~~~)/.test(raw);
        if (isFence) inFence = !inFence;
        const masked = raw.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length));
        result.push({ line: index + 1, text: masked, inFence: isFence ? true : inFence });
    });
    return result;
}

/** Extract every wikilink from a body, ignoring fenced blocks and inline code spans. */
export function extractLinks(body: string): LinkRef[] {
    const links: LinkRef[] = [];
    for (const scanned of scanLines(body)) {
        if (scanned.inFence) continue;
        const pattern = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
        for (const match of scanned.text.matchAll(pattern)) {
            links.push({
                target: (match[1] ?? '').trim(),
                surface: match[2] === undefined ? null : match[2].trim(),
                line: scanned.line,
            });
        }
    }
    return links;
}

/** Slug for a page: the schema guarantees a title, so the slug is always title-derived. */
function pageSlug(title: string): string {
    return resolveSlug(title);
}

async function listMarkdown(dir: string, fs: FileSystem): Promise<string[]> {
    const files = await walkDir(dir, fs);
    return files.filter((file) => file.endsWith('.md')).sort();
}

function duplicateSlugFindings(pages: VaultPageEntry[]): FindingRecord[] {
    const seen = new Map<string, string[]>();
    for (const page of pages) {
        const paths = seen.get(page.slug) ?? [];
        paths.push(page.path);
        seen.set(page.slug, paths);
    }
    const findings: FindingRecord[] = [];
    for (const [slug, paths] of seen) {
        if (paths.length < 2) continue;
        for (const path of paths) {
            findings.push({
                code: 'duplicate-slug',
                path,
                line: 1,
                message: `slug '${slug}' is shared by ${paths.length} pages`,
            });
        }
    }
    return findings;
}

/** Build the vault index from `contentDir`, tolerating unparsable pages as findings. */
export async function buildVaultIndex(
    contentDir: string,
    fileSystem: FileSystem = createNodeFileSystem(),
): Promise<VaultIndex> {
    const pages: VaultPageEntry[] = [];
    const findings: FindingRecord[] = [];
    for (const file of await listMarkdown(contentDir, fileSystem)) {
        const path = relative(contentDir, file);
        const text = await fileSystem.readFile(file);
        const parsed = parseFrontmatter(text);
        const validated = PageFrontmatterSchema.safeParse(parsed.data);
        if (!validated.success) {
            const code: FindingCode = parsed.errors.includes('missing-frontmatter')
                ? 'missing-frontmatter'
                : 'invalid-frontmatter';
            findings.push({
                code,
                path,
                line: 1,
                message:
                    parsed.errors[0] ??
                    validated.error.issues
                        .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
                        .join('; '),
            });
            continue;
        }
        const page: VaultPageEntry = {
            path,
            slug: pageSlug(validated.data.title),
            frontmatter: validated.data,
            body: parsed.body,
            bodyStartLine: parsed.bodyStartLine,
            links: extractLinks(parsed.body).map((link) => ({
                ...link,
                line: link.line + parsed.bodyStartLine - 1,
            })),
            inbound: 0,
        };
        pages.push(page);
    }
    const bySlug = new Map<string, VaultPageEntry>();
    for (const page of pages) bySlug.set(page.slug, page);
    for (const page of pages) {
        for (const link of page.links) {
            const target = bySlug.get(resolveSlug(link.target));
            if (target !== undefined && target !== page) target.inbound += 1;
        }
    }
    findings.push(...duplicateSlugFindings(pages));
    return { contentDir, pages, bySlug, findings };
}

/** Resolve one link target against the index (slug-first, then raw title). */
export function resolveLink(index: VaultIndex, link: LinkRef): VaultPageEntry | undefined {
    return index.bySlug.get(resolveSlug(link.target));
}
