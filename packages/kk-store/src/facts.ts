import type { Doc } from '@gobing-ai/kk-core';
import { canonicalUrlForDoc } from './canonical-url';

/** `source_tier`: the three source classes the importance dimension distinguishes. */
export type SourceTier = 'curated' | 'community' | 'other';

/**
 * The deterministic, maker-independent facts of one Doc (G32 D2). A value a maker could disagree
 * on stays a `labels` observation; these are the columns every dimension score is a pure function
 * of, so `ItemsDao` fills them at ingest and `ItemsDao.backfillFacts` recomputes them.
 */
export interface ItemFacts {
    /** Largest finite number in `metadata.engagement`, else `null`. */
    engagement: number | null;
    /** `[...body].length` — code points, not UTF-16 units. */
    bodyChars: number;
    /** `curated` (aihot) | `community` (rss/hackernews) | `other`. */
    sourceTier: SourceTier;
    /** `metadata.lang`, else the title's script, else `null`. */
    lang: string | null;
    /** `new URL(canonical_url).hostname`, lowercased with `www.` stripped, else `null`. */
    domain: string | null;
}

/**
 * Source → tier, mirroring the plugin's `IMPORTANCE_BASE` for the importance dimension:
 * `plugins/generations/episode-plan-gen/src/index.ts:184` (`{ aihot: 4, rss: 3, hackernews: 3 }`,
 * everything else 2). The tier names the base, not the score, so a rubric change does not move them.
 */
const CURATED_SOURCES = new Set(['aihot']);
const COMMUNITY_SOURCES = new Set(['rss', 'hackernews']);

/** The CJK ideograph block (U+4E00–U+9FFF) — the script `lang` falls back to `zh` on. */
const CJK_IDEOGRAPH = /[\u4E00-\u9FFF]/;
/** A Latin letter (ASCII) — the script `lang` falls back to `en` on. */
const LATIN_LETTER = /[A-Za-z]/;

/** `value` as an object, or `{}` — a non-object metadata slot holds no sub-key. */
function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/** A finite number, or a numeric string parsed the way the plugin's `toNumber` does; else `undefined`. */
function toFiniteNumber(value: unknown): number | undefined {
    const parsed =
        typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Largest engagement number across mixed units, or `null` — the same read the plugin's
 * `maxEngagement` makes (`plugins/generations/episode-plan-gen/src/index.ts:334-341`), including the
 * `parseFloat` of a numeric string, so ingest and the heuristic agree on the impact signal.
 */
function maxEngagement(raw: unknown): number | null {
    let max: number | null = null;
    for (const value of Object.values(asRecord(raw))) {
        const parsed = toFiniteNumber(value);
        if (parsed !== undefined && (max === null || parsed > max)) max = parsed;
    }
    return max;
}

/** The source's tier, `'other'` for a missing or unknown source. */
function sourceTierOf(metadata: Doc['metadata']): SourceTier {
    const source = metadata?.source;
    if (typeof source === 'string') {
        if (CURATED_SOURCES.has(source)) return 'curated';
        if (COMMUNITY_SOURCES.has(source)) return 'community';
    }
    return 'other';
}

/** The declared `metadata.lang`, else the title's script (CJK before Latin), else `null`. */
function langOf(metadata: Doc['metadata'], title: string): string | null {
    const declared = metadata?.lang;
    if (typeof declared === 'string' && declared.trim() !== '') return declared;
    if (CJK_IDEOGRAPH.test(title)) return 'zh';
    if (LATIN_LETTER.test(title)) return 'en';
    return null;
}

/** The canonical URL's hostname, `www.` stripped, or `null` when there is no parseable URL. */
function domainOf(canonicalUrl: string | undefined): string | null {
    if (canonicalUrl === undefined) return null;
    try {
        return new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

/** Every deterministic fact of `doc`, as ingest stores them (R1). */
export function itemFacts(doc: Doc): ItemFacts {
    return {
        engagement: maxEngagement(doc.metadata?.engagement),
        bodyChars: [...(doc.body ?? '')].length,
        sourceTier: sourceTierOf(doc.metadata),
        lang: langOf(doc.metadata, doc.title ?? ''),
        domain: domainOf(canonicalUrlForDoc(doc)),
    };
}
