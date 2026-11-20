/**
 * Deterministic daily-topics.json upsert for digest posts (zh/en/ja).
 *
 * Headlines, descriptions, and claims are copied from existing post frontmatter —
 * never invented. `claim_basis` is left unset so `sd seo retitle --write --stamp-claims`
 * can stamp it. Upsert is idempotent and always writes a given slug key once, so a
 * file that already had a duplicated key (the surfdash #30 merge failure) is collapsed
 * on rewrite.
 */

import { dirname } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { DIGEST_TAG, parseFrontmatterScalars } from './digest-check';
import { PATCH_LOCALES, type PatchLocale, SERIES_NAMES } from './patch';

/** One locale's topic-map fields. `claim_basis` is stamped later by retitle. */
export interface DailyTopicsLocaleEntry {
    headlines: string[];
    description: string;
    key_points: string[];
    claims: string[];
    short_claims: string[];
}

/** The three-locale value stored under a day's slug in daily-topics.json. */
export type DailyTopicsEntry = Record<PatchLocale, DailyTopicsLocaleEntry>;

export type BuildDailyTopicsResult = { ok: true; entry: DailyTopicsEntry } | { ok: false; error: string };

const escapeRe = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const titleSepFor = (locale: PatchLocale): string => (locale === 'en' ? ': ' : '：');
const listSepFor = (locale: PatchLocale): string => (locale === 'en' ? ', ' : '、');

/**
 * Slug folder (`20261108-ai-2026-11-08`) from a locale `index.md` (or its directory)
 * under `content/posts/articles/<locale>/`. The slug is not reconstructed from the title:
 * historical map keys are not always `${YYYYMMDD}-ai-${YYYY-MM-DD}`.
 */
export function slugFromPostPath(postPath: string): string | undefined {
    const normalized = postPath.replaceAll('\\', '/');
    const match = normalized.match(/(?:^|\/)posts\/articles\/(?:zh|en|ja)\/([^/]+)/);
    return match?.[1];
}

function tagList(frontmatter: Map<string, string | string[]>): string[] {
    const tags = frontmatter.get('tags');
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string' && tags !== '') return [tags];
    return [];
}

/** True when the post carries the daily-digest tag. */
export function isDigestMarkdown(markdown: string): boolean {
    return tagList(parseFrontmatterScalars(markdown)).some((tag) => tag.includes(DIGEST_TAG));
}

function scalar(frontmatter: Map<string, string | string[]>, key: string): string | undefined {
    const value = frontmatter.get(key);
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value.join(' ') : value;
}

function parseTitleHeadlines(title: string, locale: PatchLocale): string[] | undefined {
    const series = SERIES_NAMES[locale];
    const titleSep = titleSepFor(locale);
    const listSep = listSepFor(locale);
    const match = title.match(new RegExp(`^${escapeRe(series)} · (\\d{4}-\\d{2}-\\d{2})${escapeRe(titleSep)}(.+)$`));
    if (!match?.[2]) return undefined;
    const heads = match[2].split(listSep).map((head) => head.trim());
    // 1..2 structural headlines: the site may collapse a title to one when two do not fit its
    // SEO budget, so a single headline is a valid derivation source (task 0408).
    if (heads.length < 1 || heads.length > 2 || heads.some((head) => head === '')) return undefined;
    return heads;
}

function parseKeyPointParts(points: string[]): { labels: string[]; sentences: string[] } | undefined {
    const labels: string[] = [];
    const sentences: string[] = [];
    for (const point of points) {
        const sep = point.indexOf(' — ');
        if (sep < 0) return undefined;
        const label = point.slice(0, sep).trim();
        const sentence = point.slice(sep + 3).trim();
        if (label === '' || sentence === '') return undefined;
        labels.push(label);
        sentences.push(sentence);
    }
    return { labels, sentences };
}

function splitDescriptionParts(description: string, count: number): string[] | undefined {
    for (const pattern of [/；|; /, /；|;/]) {
        const parts = description
            .split(pattern)
            .map((part) => part.trim())
            .filter((part) => part !== '');
        if (parts.length === count) return parts;
    }
    return undefined;
}

function buildLocaleEntry(markdown: string, locale: PatchLocale): DailyTopicsLocaleEntry | string {
    if (!isDigestMarkdown(markdown)) {
        return `${locale}: missing ${DIGEST_TAG} tag`;
    }
    const frontmatter = parseFrontmatterScalars(markdown);
    const title = scalar(frontmatter, 'title') ?? '';
    const headlines = parseTitleHeadlines(title, locale);
    if (!headlines) {
        return `${locale}: title is not "<series> · YYYY-MM-DD${titleSepFor(locale)}h1${listSepFor(locale)}h2"`;
    }
    const description = (scalar(frontmatter, 'description') ?? scalar(frontmatter, 'seo_description') ?? '').trim();
    if (description === '') {
        return `${locale}: description is empty`;
    }
    const rawPoints = frontmatter.get('key_points');
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
        return `${locale}: key_points is missing`;
    }
    const parts = parseKeyPointParts(rawPoints);
    if (!parts) {
        return `${locale}: key_points must be "label — sentence"`;
    }
    // The title names the TOP stories; the key-point box carries up to four. The site's own
    // generator emits exactly that shape (`scripts/commands/seo/retitle.ts`: title = "top story 1,
    // story 2", key_points = up to four bullets), so demanding a one-to-one match made every
    // crefitable digest fail the sync. The title must be the leading labels, in order.
    if (headlines.length > parts.labels.length || headlines.some((headline, i) => headline !== parts.labels[i])) {
        return `${locale}: title headlines do not match the leading key_points labels`;
    }
    const claims = parts.sentences;
    const shortClaims = splitDescriptionParts(description, headlines.length) ?? claims;
    return {
        headlines,
        description,
        key_points: headlines,
        claims,
        short_claims: shortClaims,
    };
}

/**
 * Build one day's topic-map entry from the three locale post bodies. Fails rather than
 * invent wording when a title, description, or key_points label cannot be parsed confidently.
 */
export function buildDailyTopicsEntry(posts: Record<PatchLocale, string>): BuildDailyTopicsResult {
    const entry = {} as DailyTopicsEntry;
    for (const locale of PATCH_LOCALES) {
        const markdown = posts[locale];
        if (typeof markdown !== 'string' || markdown.trim() === '') {
            return { ok: false, error: `${locale}: post markdown is empty` };
        }
        const built = buildLocaleEntry(markdown, locale);
        if (typeof built === 'string') return { ok: false, error: built };
        entry[locale] = built;
    }
    return { ok: true, entry };
}

/**
 * Insert or replace `obj[slug] = entry` and write pretty tab-indented JSON. Parse+serialize
 * collapses a raw file that already contained the same key twice. Never appends a second key.
 * Rejects on unreadable / non-object JSON so the caller can fail closed. Text IO routes
 * through the ts-runtime FileSystem seam (runtime-boundaries no-direct-fs-io).
 */
export async function upsertDailyTopicsEntry(
    mapPath: string,
    slug: string,
    entry: DailyTopicsEntry,
    fileSystem: FileSystem = createNodeFileSystem(),
): Promise<void> {
    if (slug.trim() === '') throw new Error('daily-topics upsert: empty slug');
    let existing: Record<string, unknown> = {};
    if (await fileSystem.exists(mapPath)) {
        const raw = (await fileSystem.readFile(mapPath)).trim();
        if (raw !== '') {
            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch (error: unknown) {
                throw new Error(
                    `daily-topics upsert: invalid JSON in ${mapPath}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error(`daily-topics upsert: ${mapPath} is not a JSON object`);
            }
            existing = parsed as Record<string, unknown>;
        }
    }
    // A curated entry WINS. The site's runbook (docs/runbook-seo-geo-operations.md §10) sanctions
    // editing a slug's claims/short_claims by hand, and re-deriving them from the posts on every
    // publish silently reverted that fix (2026-11-16: a curated 20261116 entry was replaced, retitle
    // then re-broke the descriptions, and the gate failed again on the next attempt). Derivation only
    // fills what the map does not already state.
    const prior = existing[slug];
    existing[slug] =
        prior === null || typeof prior !== 'object' || Array.isArray(prior)
            ? entry
            : keepCurated(prior as Record<string, unknown>, entry as unknown as Record<string, unknown>);
    await fileSystem.ensureDir(dirname(mapPath));
    await fileSystem.writeFile(mapPath, `${JSON.stringify(existing, null, '\t')}\n`);
}

/**
 * Merges a derived entry under an existing one, keeping every non-empty curated value and taking the
 * derived value only where the map states nothing (a missing locale, a new field).
 */
function keepCurated(curated: Record<string, unknown>, derived: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...derived, ...curated };
    const isEmpty = (value: unknown): boolean =>
        value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    for (const [key, value] of Object.entries(derived)) {
        const current = curated[key];
        if (isEmpty(current)) continue;
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !isEmpty(current)) {
            merged[key] = keepCurated(current as Record<string, unknown>, value as Record<string, unknown>);
        }
    }
    return merged;
}
