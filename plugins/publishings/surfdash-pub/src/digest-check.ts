/**
 * Post-refine digest contract check (2026-10-24).
 *
 * The surfdash refine step (scripts/lib/seo-digest.ts) owns the daily-digest title, description
 * and key_points (ADR-008). `requireRefined` only proves refine *ran*; this module re-verifies the
 * values against the site's published contract (exact `<series> · <date>：h1、h2` title shape,
 * `title | Surfing` ≤ 60 code points, description length window + terminal punctuation, no
 * ellipsis, `label — sentence` key_points) so a regressed derivation fails the publish loud
 * instead of shipping broken SEO metadata.
 *
 * Line-based frontmatter parsing with Bun's stdlib YAML renderer for block scalars (no package
 * dependency; same field compatibility as the site's own check-digest script). Handles `"..."`,
 * `'...'`, plain and folded/literal block scalars, flow arrays and `  - "..."` block lists.
 */
import { SERIES_NAMES } from './patch';

/** Locales the digest series publishes in (zh primary; en/ja translated siblings). */
export type DigestLocale = keyof typeof SERIES_NAMES;

/** The tag that marks a post as one of the daily digest series (site DIGEST_TAG). */
export const DIGEST_TAG = 'sub-category:ai-daily';

/** Podcast-intro openings a digest description must not start with (case-insensitive). */
const PODCAST_INTROS = ['这里是由Robin', '咸话咸说', 'This is Robin', 'Robin がお届け'] as const;

/** Rendered `<title>` budget: title + " | Surfing" must fit (site SEO_TITLE_LIMIT). */
const SEO_TITLE_LIMIT = 60;

/** One parsed frontmatter entry: a scalar string or a block/flow list of strings. */
type FrontmatterValue = string | string[];

/** Opening `key:` line: bare key, no leading whitespace (frontmatter is never indented). */
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;
const BLOCK_SCALAR = /^[>|][+-]?$/;

const escapeRe = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Number of leading indentation characters; YAML block indentation is spaces in refined posts. */
function leadingIndent(line: string): number {
    return line.match(/^[ \t]*/)?.[0].length ?? 0;
}

/**
 * Reads one block scalar without allowing a same-indentation sibling list item to become text.
 * Bun's YAML renderer supplies folded/literal and blank-line semantics once the indentation
 * boundary is known. The fallback keeps malformed frontmatter non-fatal, matching the old
 * line parser's permissive behavior.
 */
function readBlockScalar(
    lines: string[],
    start: number,
    end: number,
    parentIndent: number,
    indicator: string,
): { value: string; nextIndex: number } {
    const content: string[] = [];
    let j = start;
    while (j < end) {
        const line = lines[j] ?? '';
        if (line.trim() === '') {
            content.push('');
            j++;
            continue;
        }
        if (leadingIndent(line) <= parentIndent) break;
        content.push(line);
        j++;
    }
    if (content.length === 0) return { value: '', nextIndex: j };

    const normalized = content.map((line) =>
        line === '' ? '' : line.slice(Math.min(parentIndent, leadingIndent(line))),
    );
    try {
        const parsed = Bun.YAML.parse([`value: ${indicator}`, ...normalized, 'sentinel: null'].join('\n')) as {
            value?: unknown;
        };
        if (typeof parsed.value === 'string') return { value: parsed.value, nextIndex: j };
    } catch {
        // Keep the checker useful for malformed drafts; the contract gate reports the field issue.
    }
    const folded = indicator.startsWith('>');
    const parts: string[] = [];
    for (const line of normalized) {
        if (line !== '') parts.push(line.trim());
    }
    return {
        value: parts.join(folded ? ' ' : '\n'),
        nextIndex: j,
    };
}

/** Unquotes a YAML scalar: `"…"` via JSON (mapContent writes JSON.stringify), `'…'` with '' unescape. */
function unquote(value: string): string {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value) as string;
        } catch {
            return value.slice(1, -1);
        }
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replaceAll("''", "'");
    }
    return value;
}

/**
 * Line-based frontmatter parse: scalars (plain/quoted/folded/literal) and string lists (block `- item`
 * or flow `[a, b]`). Unknown shapes degrade to the raw text; a missing frontmatter yields {}.
 */
export function parseFrontmatterScalars(markdown: string): Map<string, FrontmatterValue> {
    const out = new Map<string, FrontmatterValue>();
    const lines = markdown.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return out;
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end < 0) return out;
    for (let i = 1; i < end; i++) {
        const line = lines[i];
        if (!line) continue;
        const match = line.match(KEY_LINE);
        if (!match?.[1] || match[2] === undefined) continue;
        const key = match[1];
        const value = match[2].trim();
        if (BLOCK_SCALAR.test(value)) {
            const block = readBlockScalar(lines, i + 1, end, leadingIndent(line), value);
            out.set(key, block.value);
            i = block.nextIndex - 1;
            continue;
        }
        if (value === '') {
            // Block list: `key:` followed by `  - item` lines; an empty key stays ''.
            const items: string[] = [];
            let listIndent: number | undefined;
            let j = i + 1;
            while (j < end) {
                const itemLine = lines[j];
                if (!itemLine || !/^\s*-\s+/.test(itemLine)) break;
                const itemIndent = leadingIndent(itemLine);
                if (listIndent === undefined) listIndent = itemIndent;
                if (itemIndent !== listIndent) break;
                const raw = itemLine.replace(/^\s*-\s+/, '').trim();
                // Folded item (`- >-`): the refine writer folds long CJK bullets, and a bare
                // ">-" item would fail the " — " separator check downstream — read the
                // indented continuation lines into the item with YAML's block-scalar semantics.
                if (BLOCK_SCALAR.test(raw)) {
                    const block = readBlockScalar(lines, j + 1, end, itemIndent, raw);
                    items.push(block.value);
                    j = block.nextIndex;
                    continue;
                }
                items.push(unquote(raw));
                j++;
            }
            if (items.length > 0) {
                out.set(key, items);
                i = j - 1;
            } else {
                out.set(key, '');
            }
            continue;
        }
        if (value.startsWith('[') && value.endsWith(']')) {
            out.set(
                key,
                value
                    .slice(1, -1)
                    .split(',')
                    .map((item) => unquote(item.trim()))
                    .filter((item) => item !== ''),
            );
            continue;
        }
        out.set(key, unquote(value));
    }
    return out;
}

/** The scalar at `key`: a list joins with ' ' (never a shape the digest contract accepts). */
function scalar(frontmatter: Map<string, FrontmatterValue>, key: string): string | undefined {
    const value = frontmatter.get(key);
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value.join(' ') : value;
}

/** Terminal punctuation per locale: terminator, optionally followed by closing quotes/brackets. */
function endsAsSentence(text: string, locale: DigestLocale): boolean {
    return locale === 'en' ? /[.!?]["')”’]*$/u.test(text.trimEnd()) : /[。！？][」』”）]*$/u.test(text.trimEnd());
}

/**
 * Validates a refined post's frontmatter against the digest contract. Returns the problems
 * (empty = ok); non-digest posts (no `sub-category:ai-daily` tag) return [] unchecked.
 */
export function checkDigestFrontmatter(markdown: string, locale: DigestLocale): string[] {
    const frontmatter = parseFrontmatterScalars(markdown);
    const tags = frontmatter.get('tags');
    const tagList = Array.isArray(tags) ? tags : typeof tags === 'string' && tags !== '' ? [tags] : [];
    if (!tagList.some((tag) => tag.includes(DIGEST_TAG))) return [];

    const problems: string[] = [];
    const series = SERIES_NAMES[locale];
    const titleSep = locale === 'en' ? ': ' : '：';
    const listSep = locale === 'en' ? ', ' : '、';

    const title = scalar(frontmatter, 'title');
    if (title === undefined || title === '') {
        problems.push('title: missing');
    } else {
        const match = title.match(
            new RegExp(`^${escapeRe(series)} · (\\d{4}-\\d{2}-\\d{2})${escapeRe(titleSep)}(.+)$`),
        );
        if (!match) {
            problems.push(
                `title: expected "<series> · YYYY-MM-DD${titleSep}<h1>${listSep}<h2>" for ${series}, got "${title}"`,
            );
        } else {
            const rest = match[2] ?? '';
            const heads = locale === 'en' ? rest.split(', ') : rest.split('、');
            const seps = locale === 'en' ? (rest.match(/, /g) ?? []).length : (rest.match(/、/g) ?? []).length;
            if (seps !== 1 || heads.some((head) => head.trim() === '')) {
                problems.push(`title: expected exactly two non-empty headlines joined "${listSep}", got "${rest}"`);
            }
        }
        const seoTitle = `${title} | Surfing`;
        const seoLength = Array.from(seoTitle).length;
        if (seoLength > SEO_TITLE_LIMIT) {
            problems.push(`title: "${seoTitle}" is ${seoLength} code points (max ${SEO_TITLE_LIMIT})`);
        }
        if (title.includes('…') || title.includes('...')) problems.push('title: contains "…" or "..."');
    }

    const description = scalar(frontmatter, 'description');
    const [min, max] = locale === 'en' ? [120, 155] : [70, 100];
    if (description === undefined || description === '') {
        problems.push('description: missing');
    } else {
        const length = Array.from(description).length;
        if (length < min || length > max) {
            problems.push(`description: ${length} code points (expected ${min}–${max} for ${locale})`);
        }
        if (!endsAsSentence(description, locale)) {
            problems.push('description: does not end with sentence punctuation');
        }
        const lower = description.toLowerCase();
        const intro = PODCAST_INTROS.find((candidate) => lower.startsWith(candidate.toLowerCase()));
        if (intro) problems.push(`description: starts with the podcast intro ("${intro}")`);
        if (description.includes('…') || description.includes('...')) {
            problems.push('description: contains "…" or "..."');
        }
    }

    const points = frontmatter.get('key_points');
    if (!Array.isArray(points) || points.length === 0) {
        problems.push('key_points: missing');
    } else {
        const labelMax = locale === 'en' ? 28 : 14;
        points.forEach((point, index) => {
            const sep = point.indexOf(' — ');
            if (sep < 0) {
                problems.push(`key_points[${index}]: missing " — " separator`);
                return;
            }
            const label = point.slice(0, sep);
            const text = point.slice(sep + 3);
            const labelLength = Array.from(label).length;
            if (labelLength === 0 || labelLength > labelMax) {
                problems.push(`key_points[${index}]: label "${label}" is ${labelLength} code points (max ${labelMax})`);
            }
            if (!endsAsSentence(text, locale)) {
                problems.push(`key_points[${index}]: text does not end with sentence punctuation`);
            }
            if (point.includes('…') || point.includes('...')) {
                problems.push(`key_points[${index}]: contains "…" or "..."`);
            }
        });
    }
    return problems;
}
