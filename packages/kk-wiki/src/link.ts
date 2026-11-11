import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { scanLines, type VaultIndex } from './graph';
import { parseFrontmatter, parsePage, type VaultPage } from './page';
import type { GuardDecision } from './write';
import { applyWriteToPage } from './write';

/**
 * Unlinked-mention detection and repair (task 0356, docs/design/kk-wiki.md §2 `link`).
 *
 * Candidates are existing page titles only — a general vocabulary matcher floods a growing vault.
 * Fenced blocks and inline code are skipped by the shared line scanner.
 */

/** One prose mention of a page title that carries no wikilink. */
export interface Mention {
    path: string;
    line: number;
    slug: string;
    surface: string;
    text: string;
}

/** One page changed (or refused) by a fix pass. */
export interface LinkFixResult {
    changed: string[];
    refused: string[];
    mentions: Mention[];
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find prose mentions of indexed page titles, skipping lines that already link that page. */
export function findMentions(index: VaultIndex): Mention[] {
    const mentions: Mention[] = [];
    const titles = index.pages
        .map((page) => ({ page, title: page.frontmatter.title.trim() }))
        .filter((entry) => entry.title.length >= 3);
    for (const page of index.pages) {
        const linked = new Set(page.links.map((link) => link.target.toLowerCase()));
        for (const scanned of scanLines(page.body)) {
            if (scanned.inFence) continue;
            const masked = scanned.text.replace(/\[\[[^\]]*\]\]/g, (span) => ' '.repeat(span.length));
            for (const { page: target, title } of titles) {
                if (target.slug === page.slug || linked.has(target.slug) || linked.has(title.toLowerCase())) continue;
                const pattern = new RegExp(`(?<![\\w\\[|])${escapeRegExp(title)}(?![\\w\\]])`, 'i');
                const hit = pattern.exec(masked);
                if (hit === null) continue;
                mentions.push({
                    path: page.path,
                    line: scanned.line + page.bodyStartLine - 1,
                    slug: target.slug,
                    surface: title,
                    text: title,
                });
                break;
            }
        }
    }
    return mentions;
}

/**
 * Rewrite one body: replace the first unlinked occurrence of each mention's title.
 *
 * `lineOffset` converts the file-relative mention line back to a body index.
 */
function rewriteBody(body: string, pageMentions: Mention[], lineOffset: number): string {
    const lines = body.split('\n');
    for (const mention of pageMentions) {
        const index = mention.line - lineOffset;
        const line = lines[index];
        if (line === undefined) continue;
        const pattern = new RegExp(`(?<![\\w\\[|])${escapeRegExp(mention.text)}(?![\\w\\]])`, 'i');
        lines[index] = line.replace(pattern, `[[${mention.slug}|${mention.surface}]]`);
    }
    return lines.join('\n');
}

/** Apply the reported mentions to their pages through the guard. */
export async function fixLinks(
    index: VaultIndex,
    options: { date: string; dryRun?: boolean; contentDir?: string; fileSystem?: FileSystem } = { date: '' },
): Promise<LinkFixResult> {
    const fs = options.fileSystem ?? createNodeFileSystem();
    const contentDir = options.contentDir ?? index.contentDir;
    const mentions = findMentions(index);
    const grouped = new Map<string, Mention[]>();
    for (const mention of mentions) {
        const list = grouped.get(mention.path) ?? [];
        list.push(mention);
        grouped.set(mention.path, list);
    }
    const changed: string[] = [];
    const refused: string[] = [];
    for (const [path, pageMentions] of grouped) {
        const raw = await fs.readFile(join(contentDir, path));
        const page: VaultPage = parsePage(raw, path);
        const rewritten = rewriteBody(page.body, pageMentions, parseFrontmatter(raw).bodyStartLine);
        const { text, guard }: { text: string; guard: GuardDecision } = applyWriteToPage(page, rewritten, {
            mode: 'full',
            date: options.date,
        });
        if (options.dryRun === true) {
            changed.push(path);
            continue;
        }
        await fs.writeFile(join(contentDir, path), text);
        if (guard === 'appended') refused.push(path);
        else changed.push(path);
    }
    return { changed, refused, mentions };
}

/**
 * Link the first occurrence of each existing page title inside arbitrary text.
 *
 * Used by the write verbs (`summarize`, `synthesize`) so agent-authored prose enters the vault
 * already wired into the graph, without a second mention pass.
 */
export function linkTitlesInText(index: VaultIndex, text: string): string {
    let linked = text;
    const titles = index.pages
        .map((page) => ({ slug: page.slug, title: page.frontmatter.title.trim() }))
        .filter((entry) => entry.title.length >= 3)
        .sort((a, b) => b.title.length - a.title.length);
    for (const { slug, title } of titles) {
        const pattern = new RegExp(`(?<![\\w\\[|])${escapeRegExp(title)}(?![\\w\\]])`, 'i');
        linked = linked.replace(pattern, `[[${slug}|${title}]]`);
    }
    return linked;
}
