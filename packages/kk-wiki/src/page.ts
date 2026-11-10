import { z } from 'zod';

/**
 * Vault page contract (ADR-046, docs/design/kk-wiki.md §3).
 *
 * The frontmatter is intentionally flat: scalars plus string arrays, written one `key: value`
 * per line. No YAML library is imported (the repo declares none), so a nested map is a reported
 * error rather than a silently parsed value.
 */

export const PageTypeSchema = z.enum(['concept', 'entity', 'source', 'index']);
/** The four page classes a vault folder may hold. */
export type PageType = z.infer<typeof PageTypeSchema>;

/** Schema every vault page frontmatter block must satisfy. */
export const PageFrontmatterSchema = z.object({
    title: z.string().min(1),
    type: PageTypeSchema,
    tags: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
    updated_at: z.string().min(1),
    user_edited: z.boolean().optional(),
    redirect_to: z.string().min(1).optional(),
});
/** Validated page frontmatter. */
export type PageFrontmatter = z.infer<typeof PageFrontmatterSchema>;

/** One learned-page file: its vault-relative-ish path, validated frontmatter and body. */
export interface VaultPage {
    path: string;
    frontmatter: PageFrontmatter;
    body: string;
}

/** Tolerant parse result: `errors` is empty when the block is flat and well-formed. */
export interface ParsedFrontmatter {
    data: Record<string, string | boolean | string[]>;
    body: string;
    errors: string[];
    /** 1-based line of the body's first line in the original file (1 when there is no frontmatter). */
    bodyStartLine: number;
}

/** A page whose frontmatter does not satisfy the schema. Carries the path for the caller. */
export class FrontmatterError extends Error {
    constructor(
        readonly path: string,
        readonly issues: string[],
    ) {
        super(`invalid frontmatter in ${path}: ${issues.join('; ')}`);
        this.name = 'FrontmatterError';
    }
}

const FENCE = '---';

function parseScalar(raw: string): string | boolean {
    const trimmed = raw.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        return trimmed.slice(1, -1);
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
        return trimmed.slice(1, -1);
    }
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return trimmed;
}

/**
 * Parse the leading `---` block into flat keys, returning the body after it.
 *
 * Tolerant by design: a missing block or a malformed line yields `errors` entries and a
 * best-effort `data` map, so `lint` can report the defect with the page path instead of the
 * whole vault failing to load.
 */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
    const errors: string[] = [];
    const text = raw.replace(/^\uFEFF/, '');
    const lines = text.split('\n');
    if (lines[0]?.trim() !== FENCE) {
        return { data: {}, body: text, errors: ['missing-frontmatter'], bodyStartLine: 1 };
    }
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE);
    if (close < 0) {
        return { data: {}, body: text, errors: ['unterminated-frontmatter'], bodyStartLine: 1 };
    }
    const data: Record<string, string | boolean | string[]> = {};
    let openArrayKey: string | null = null;
    for (const line of lines.slice(1, close)) {
        if (line.trim() === '') continue;
        const item = /^\s+-\s+(.*)$/.exec(line);
        if (item !== null) {
            if (openArrayKey === null) {
                errors.push(`array item without a key: ${line.trim()}`);
                continue;
            }
            const list = data[openArrayKey];
            if (Array.isArray(list)) list.push(String(parseScalar(item[1] ?? '')));
            continue;
        }
        const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
        if (pair === null) {
            // A nested map (`  child: value`) lands here: flat-only contract.
            errors.push(`unsupported frontmatter line (nested or malformed): ${line.trim()}`);
            continue;
        }
        const key = pair[1] ?? '';
        const value = (pair[2] ?? '').trim();
        openArrayKey = value === '' ? key : null;
        if (value === '' || value === '[]') {
            data[key] = [];
            continue;
        }
        data[key] = parseScalar(value);
    }
    const rest = lines.slice(close + 1);
    const leadingBlank = rest[0] === '' ? 1 : 0;
    return {
        data,
        body: rest.join('\n').replace(/^\n/, ''),
        errors,
        bodyStartLine: close + 2 + leadingBlank,
    };
}

/** Parse + validate one page file. Throws `FrontmatterError` when the schema rejects the block. */
export function parsePage(text: string, path: string): VaultPage {
    const parsed = parseFrontmatter(text);
    const result = PageFrontmatterSchema.safeParse(parsed.data);
    if (!result.success) {
        const issues = parsed.errors.concat(
            result.error.issues.map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`),
        );
        throw new FrontmatterError(path, issues);
    }
    return { path, frontmatter: result.data, body: parsed.body };
}

function renderValue(value: string | boolean): string {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === '' || /[:#\n]/.test(value) || value.trim() !== value) return `"${value.replace(/"/g, '\\"')}"`;
    return value;
}

/** Render a page back to disk form: canonical key order, arrays as `- item` lines. */
export function renderPage(page: VaultPage): string {
    const fm = page.frontmatter;
    const lines = [FENCE, `title: ${renderValue(fm.title)}`, `type: ${fm.type}`];
    if (fm.tags.length === 0) {
        lines.push('tags: []');
    } else {
        lines.push('tags:', ...fm.tags.map((tag) => `  - ${renderValue(tag)}`));
    }
    if (fm.sources.length === 0) {
        lines.push('sources: []');
    } else {
        lines.push('sources:', ...fm.sources.map((source) => `  - ${renderValue(source)}`));
    }
    lines.push(`updated_at: ${renderValue(fm.updated_at)}`);
    if (fm.user_edited === true) lines.push('user_edited: true');
    if (fm.redirect_to !== undefined) lines.push(`redirect_to: ${renderValue(fm.redirect_to)}`);
    lines.push(FENCE, '');
    return `${lines.join('\n')}\n${page.body.replace(/\s+$/, '')}\n`;
}

/** Slug rule (frozen in docs/design/kk-wiki.md §3): lowercase, non-alphanumerics collapsed to `-`. */
export function resolveSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
