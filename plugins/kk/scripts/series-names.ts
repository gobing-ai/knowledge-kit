/**
 * Canonical daily-series naming for the kk-daily-* pipelines (2026-10-23 regression).
 *
 * The 2026-10-23 surfdash run: the translate agent invented locale series names (ja 毎日AIブレンド,
 * en "Daily AI Medley"/"hodgepodge" phrasing, zh-name listen links inside en/ja posts). Series
 * names are product identity, not translation — this module is the pipeline's single definition of
 * the per-locale series/show names plus the deterministic rewrite that repairs the known bad set
 * before the CMS sync (plugins/kk/scripts/daily-stages.ts translate-sync gate).
 *
 * Pure string work only, no I/O. URL segments (http/https) are never touched — a slug or
 * percent-encoded path may legitimately embed any of these tokens. surfdash-pub's cross-link table
 * (plugins/publishings/surfdash-pub/src/patch.ts) cannot import this file (the kk scripts resolve
 * from the installed package with node builtins only), so it repeats the names; tests assert the
 * two tables agree.
 */

/** The locales a daily post is published in (mirrors surfdash-pub's PATCH_LOCALES). */
export type DailyLocale = 'zh' | 'en' | 'ja';

/** One locale's daily-series naming: the series (episode-column) name and the show it runs under. */
export interface DailySeriesNames {
    series: string;
    show: string;
}

/** The single per-locale table; en/ja names are fixed identity, the zh column name is the source. */
export const DAILY_SERIES_NAMES: Record<DailyLocale, DailySeriesNames> = {
    zh: { series: '每日AI乱炖', show: '咸话咸说' },
    en: { series: 'Daily AI Stew', show: 'Salty Talk' },
    ja: { series: 'デイリーAIシチュー', show: '咸話咸説' },
};

/**
 * Retired series spellings that must never be emitted in any locale. ごった煮 is deliberately absent:
 * it is ordinary ja vocabulary, so rewriting or failing on it would butcher legitimate prose.
 */
const RETIRED_SERIES_NAMES = ['毎日AIブレンド', 'Daily AI Medley', 'Daily AI Briefing'] as const;

/** All canonical series tokens — each locale's own name is correct there, wrong-locale elsewhere. */
const SERIES_TOKENS = ['每日AI乱炖', 'Daily AI Stew', 'デイリーAIシチュー'] as const;

const escapeRe = (token: string): string => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Latin tokens match case-insensitively with word boundaries; CJK tokens match exactly. */
const tokenRe = (token: string): RegExp =>
    /^[\x20-\x7E]+$/.test(token) ? new RegExp(`\\b${escapeRe(token)}\\b`, 'gi') : new RegExp(escapeRe(token), 'g');

/** Splits markdown into alternating non-URL / URL segments (`split` keeps the capture group). */
const URL_SPLIT = /(https?:\/\/[^\s<>"')\]]+)/g;

function mapOutsideUrls(markdown: string, fn: (text: string) => string): string {
    return markdown
        .split(URL_SPLIT)
        .map((part, index) => (index % 2 === 1 ? part : fn(part)))
        .join('');
}

/** The short/spacing zh form (`AI 乱炖`/`AI乱炖`) as a series name; `每日` already prefixing it is correct zh. */
const SHORT_ZH_FORM = /(?<!每日)AI ?乱炖/g;

/** Every retired or wrong-locale series reference in `text`, as written, deduplicated in order. */
function retiredIn(text: string, locale: DailyLocale): string[] {
    const canonical = DAILY_SERIES_NAMES[locale].series;
    const patterns: RegExp[] = [
        ...RETIRED_SERIES_NAMES.map(tokenRe),
        ...SERIES_TOKENS.filter((token) => token !== canonical).map(tokenRe),
        SHORT_ZH_FORM,
        /\bhodgepodge\b/gi,
    ];
    const found: string[] = [];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            if (!found.includes(match[0])) found.push(match[0]);
        }
    }
    return found;
}

/**
 * Retired / wrong-locale series references in `markdown`, as written (URL segments excluded).
 * Detection only — the repair side is {@link normalizeSeriesNames}.
 */
export function findRetiredSeriesNames(markdown: string, locale: DailyLocale): string[] {
    const found: string[] = [];
    mapOutsideUrls(markdown, (text) => {
        for (const hit of retiredIn(text, locale)) {
            if (!found.includes(hit)) found.push(hit);
        }
        return text;
    });
    return found;
}

/**
 * Rewrite every known retired / wrong-locale series reference to the locale's canonical series
 * name and list what could not be rewritten safely: a bare `hodgepodge` is vocabulary, not a name
 * — rewriting it would butcher prose, so it is reported for hand repair instead. Idempotent: the
 * rewrite only ever produces the locale's own canonical name, which no rule matches.
 */
export function normalizeSeriesNames(
    markdown: string,
    locale: DailyLocale,
): {
    /** The input with every known bad series token rewritten (URL segments untouched). */
    markdown: string;
    /** Retired series references left over that the caller must report or repair by hand. */
    remaining: string[];
} {
    const canonical = DAILY_SERIES_NAMES[locale].series;
    const next = mapOutsideUrls(markdown, (text) => {
        let out = text;
        if (locale === 'en') {
            // The observed en intro phrase — rewritten as a phrase first so the bare word never
            // produces "daily AI Daily AI Stew".
            out = out.replace(/\byour daily AI hodgepodge\b/gi, 'Your Daily AI Stew');
            out = out.replace(/\bdaily AI hodgepodge\b/gi, 'Daily AI Stew');
        }
        for (const token of [...RETIRED_SERIES_NAMES, ...SERIES_TOKENS.filter((name) => name !== canonical)]) {
            out = out.replace(tokenRe(token), () => canonical);
        }
        return out.replace(SHORT_ZH_FORM, canonical);
    });
    return { markdown: next, remaining: findRetiredSeriesNames(next, locale) };
}
