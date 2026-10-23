/**
 * Per-episode SEO for microfeed 1.0.13 (design D9).
 *
 * Pure helpers: title pattern, `_microfeed.seo`, iTunes numbering, slug checks,
 * title sanitising, and show-notes summary text. Network stays in `index.ts`.
 * Lengths are Unicode code points, matching microfeed's slug rule.
 */

import { readFileSync } from 'node:fs';

/** Code-point length. Microfeed counts the same way for slugs and SEO limits. */
export function codePointLength(value: string): number {
    return Array.from(value).length;
}

export const WARN_PREFIX = 'WARN podcast-pub:';

/** Prints a stable stderr line and records it for result metadata. */
export function warn(message: string, sink?: string[]): void {
    const line = message.startsWith(WARN_PREFIX) ? message : `${WARN_PREFIX} ${message}`;
    console.error(line);
    sink?.push(line);
}

export type TitleMode = 'as-is' | 'headline';
export type SanitizeMode = 'normalize' | 'reject';
export type LinkField = 'none' | 'url';
export type SlugMode = 'auto' | 'pattern';
export type DescriptionSource = 'plan' | 'surfing';
export type TimelineStyle = 'after' | 'before' | 'omit';

export interface PodcastSeoConfig {
    seo: boolean;
    titleMode: TitleMode;
    titlePattern: string;
    seriesName: string;
    showName: string;
    titleMax: number;
    titleMaxKeywords: number;
    seoTitleSuffix: string;
    seoTitleMax: number;
    descriptionMin: number;
    descriptionMax: number;
    descriptionSource: DescriptionSource;
    descriptionPattern: string;
    summaryParagraph: boolean;
    timelineStyle: TimelineStyle;
    autoEpisodeNumber: boolean;
    titleSanitize: SanitizeMode;
    linkField: LinkField;
    slugMode: SlugMode;
    slugPattern: string;
    socialImage: boolean;
    socialImageAltPattern: string;
    roundDuration: boolean;
}

/** Plugin defaults. Robin (2026-10-23): middle-dot title pattern, SEO and summary on. */
export const SEO_DEFAULTS: PodcastSeoConfig = {
    seo: true,
    titleMode: 'as-is',
    titlePattern: '{series} · {date}：{keywords}',
    seriesName: '每日AI乱炖',
    showName: '咸话咸说',
    titleMax: 55,
    titleMaxKeywords: 2,
    seoTitleSuffix: '｜咸话咸说',
    seoTitleMax: 60,
    descriptionMin: 120,
    descriptionMax: 155,
    descriptionSource: 'plan',
    descriptionPattern: '{show}·{series} {date}（约 {minutes} 分钟）：{clauses}。',
    summaryParagraph: true,
    timelineStyle: 'after',
    autoEpisodeNumber: true,
    titleSanitize: 'normalize',
    linkField: 'none',
    slugMode: 'pattern',
    slugPattern: 'daily-ai-{date}',
    socialImage: false,
    socialImageAltPattern: '{series} {date} 封面：{keywords}',
    roundDuration: true,
};

export interface PlanItem {
    title: string;
    brief?: string;
}

export interface SeoBlock {
    title?: string;
    description?: string;
    social_image?: {
        url: string;
        width: 1200;
        height: 630;
        mime_type: 'image/jpeg' | 'image/png';
        alt: string;
    };
}

export interface PreparedEpisodeFields {
    title: string;
    itunes?: {
        title?: string;
        episodeType?: 'full' | 'trailer' | 'bonus';
        season?: number;
        episode?: number;
        explicit?: boolean;
        block?: boolean;
    };
    /** Attachment duration. Rounded when `PODCAST_PUB_ROUND_DURATION` is on. */
    durationSeconds?: number;
    /** Set only when `PODCAST_PUB_LINK_FIELD=url`. */
    link?: string;
    seo?: SeoBlock;
    /** Custom slug for the first createItem. Absent in `auto` mode or without a date. */
    slug?: string;
    warnings: string[];
    /** Alt text for a social image. Present only when a candidate image was accepted or still needs a remote size check. */
    socialAlt?: string;
    /** Local 1200×630 image still to upload. */
    socialLocalPath?: string;
    socialMime?: 'image/jpeg' | 'image/png';
    /** Remote URL whose bytes still need a 1200×630 check before it is sent. */
    socialRemoteUrl?: string;
}

const ENV_KEYS = {
    seo: 'PODCAST_PUB_SEO',
    titleMode: 'PODCAST_PUB_EPISODE_TITLE_MODE',
    titlePattern: 'PODCAST_PUB_EPISODE_TITLE_PATTERN',
    seriesName: 'PODCAST_PUB_SERIES_NAME',
    showName: 'PODCAST_PUB_SHOW_NAME',
    titleMax: 'PODCAST_PUB_TITLE_MAX',
    titleMaxKeywords: 'PODCAST_PUB_TITLE_MAX_KEYWORDS',
    seoTitleSuffix: 'PODCAST_PUB_SEO_TITLE_SUFFIX',
    seoTitleMax: 'PODCAST_PUB_SEO_TITLE_MAX',
    descriptionMin: 'PODCAST_PUB_SEO_DESCRIPTION_MIN',
    descriptionMax: 'PODCAST_PUB_SEO_DESCRIPTION_MAX',
    descriptionSource: 'PODCAST_PUB_SEO_DESCRIPTION_SOURCE',
    descriptionPattern: 'PODCAST_PUB_SEO_DESCRIPTION_PATTERN',
    summaryParagraph: 'PODCAST_PUB_SUMMARY_PARAGRAPH',
    timelineStyle: 'PODCAST_PUB_TIMELINE_INLINE_STYLE',
    autoEpisodeNumber: 'PODCAST_PUB_AUTO_EPISODE_NUMBER',
    titleSanitize: 'PODCAST_PUB_TITLE_SANITIZE',
    linkField: 'PODCAST_PUB_LINK_FIELD',
    slugMode: 'PODCAST_PUB_SLUG',
    slugPattern: 'PODCAST_PUB_SLUG_PATTERN',
    socialImage: 'PODCAST_PUB_SOCIAL_IMAGE',
    socialImageAltPattern: 'PODCAST_PUB_SOCIAL_IMAGE_ALT_PATTERN',
    roundDuration: 'PODCAST_PUB_ROUND_DURATION',
} as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return undefined;
}

function podcastOf(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    return asRecord(metadata?.podcast) ?? {};
}

function pick(
    metadata: Record<string, unknown> | undefined,
    podcastKey: string,
    envKey: string,
    env: NodeJS.ProcessEnv,
): { value: unknown; key: string } | undefined {
    const podcast = podcastOf(metadata);
    if (Object.hasOwn(podcast, podcastKey)) {
        const value = podcast[podcastKey];
        if (value !== undefined && value !== '') return { value, key: `metadata.podcast.${podcastKey}` };
    }
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && fromEnv !== '') return { value: fromEnv, key: envKey };
    return undefined;
}

function invalid(key: string, value: unknown, expected: string): string {
    return `invalid ${key} "${String(value)}": expected ${expected}`;
}

function parseBool(raw: { value: unknown; key: string } | undefined, fallback: boolean): boolean | string {
    if (!raw) return fallback;
    const value = raw.value;
    if (value === true || value === 'true' || value === '1') return true;
    if (value === false || value === 'false' || value === '0') return false;
    return invalid(raw.key, value, 'true or false');
}

function parseIntIn(raw: { value: unknown; key: string } | undefined, fallback: number, min: number): number | string {
    if (!raw) return fallback;
    const value = typeof raw.value === 'number' ? raw.value : Number(raw.value);
    if (!Number.isInteger(value) || value < min) return invalid(raw.key, raw.value, `an integer ≥ ${min}`);
    return value;
}

function parseEnum<T extends string>(
    raw: { value: unknown; key: string } | undefined,
    allowed: readonly T[],
    fallback: T,
): T | string {
    if (!raw) return fallback;
    const value = String(raw.value);
    if ((allowed as readonly string[]).includes(value)) return value as T;
    return invalid(raw.key, raw.value, allowed.join(' or '));
}

/** Env, then `metadata.podcast.*` (the item wins). Unknown values name the key and fail. */
export function resolvePodcastSeoConfig(
    metadata: Record<string, unknown> | undefined,
    env: NodeJS.ProcessEnv = process.env,
): { config: PodcastSeoConfig } | { error: string } {
    const bool = (podcastKey: string, envKey: string, fallback: boolean): boolean | string =>
        parseBool(pick(metadata, podcastKey, envKey, env), fallback);
    const int = (podcastKey: string, envKey: string, fallback: number, min: number): number | string =>
        parseIntIn(pick(metadata, podcastKey, envKey, env), fallback, min);
    const text = (podcastKey: string, envKey: string, fallback: string): string => {
        const raw = pick(metadata, podcastKey, envKey, env);
        return raw ? String(raw.value) : fallback;
    };
    const seo = bool('seo', ENV_KEYS.seo, SEO_DEFAULTS.seo);
    const titleMode = parseEnum(
        pick(metadata, 'titleMode', ENV_KEYS.titleMode, env),
        ['as-is', 'headline'] as const,
        SEO_DEFAULTS.titleMode,
    );
    const titleMax = int('titleMax', ENV_KEYS.titleMax, SEO_DEFAULTS.titleMax, 1);
    const titleMaxKeywords = int('titleMaxKeywords', ENV_KEYS.titleMaxKeywords, SEO_DEFAULTS.titleMaxKeywords, 1);
    const seoTitleMax = int('seoTitleMax', ENV_KEYS.seoTitleMax, SEO_DEFAULTS.seoTitleMax, 1);
    const descriptionMin = int('descriptionMin', ENV_KEYS.descriptionMin, SEO_DEFAULTS.descriptionMin, 1);
    const descriptionMax = int('descriptionMax', ENV_KEYS.descriptionMax, SEO_DEFAULTS.descriptionMax, 1);
    const descriptionSource = parseEnum(
        pick(metadata, 'descriptionSource', ENV_KEYS.descriptionSource, env),
        ['plan', 'surfing'] as const,
        SEO_DEFAULTS.descriptionSource,
    );
    const summaryParagraph = bool('summaryParagraph', ENV_KEYS.summaryParagraph, SEO_DEFAULTS.summaryParagraph);
    const timelineStyle = parseEnum(
        pick(metadata, 'timelineInlineStyle', ENV_KEYS.timelineStyle, env),
        ['after', 'before', 'omit', 'true', 'false'] as const,
        'after',
    );
    const autoEpisodeNumber = bool('autoEpisodeNumber', ENV_KEYS.autoEpisodeNumber, SEO_DEFAULTS.autoEpisodeNumber);
    const titleSanitize = parseEnum(
        pick(metadata, 'titleSanitize', ENV_KEYS.titleSanitize, env),
        ['normalize', 'reject'] as const,
        SEO_DEFAULTS.titleSanitize,
    );
    const linkField = parseEnum(
        pick(metadata, 'linkField', ENV_KEYS.linkField, env),
        ['none', 'url'] as const,
        SEO_DEFAULTS.linkField,
    );
    const slugMode = parseEnum(
        pick(metadata, 'slug', ENV_KEYS.slugMode, env),
        ['auto', 'pattern'] as const,
        SEO_DEFAULTS.slugMode,
    );
    const socialImage = bool('socialImageEnabled', ENV_KEYS.socialImage, SEO_DEFAULTS.socialImage);
    const roundDuration = bool('roundDuration', ENV_KEYS.roundDuration, SEO_DEFAULTS.roundDuration);
    const parsed = [
        seo,
        titleMode,
        titleMax,
        titleMaxKeywords,
        seoTitleMax,
        descriptionMin,
        descriptionMax,
        descriptionSource,
        summaryParagraph,
        timelineStyle,
        autoEpisodeNumber,
        titleSanitize,
        linkField,
        slugMode,
        socialImage,
        roundDuration,
    ];
    const failure = parsed.find((value) => typeof value === 'string' && value.startsWith('invalid '));
    if (typeof failure === 'string') return { error: failure };
    if ((descriptionMin as number) > (descriptionMax as number)) {
        return {
            error: `invalid ${ENV_KEYS.descriptionMin}: ${String(descriptionMin)} is greater than ${ENV_KEYS.descriptionMax} ${String(descriptionMax)}`,
        };
    }
    const seoTitleSuffix = text('seoTitleSuffix', ENV_KEYS.seoTitleSuffix, SEO_DEFAULTS.seoTitleSuffix);
    if (codePointLength(seoTitleSuffix) >= (seoTitleMax as number)) {
        return {
            error: `invalid ${ENV_KEYS.seoTitleSuffix}: suffix is longer than ${ENV_KEYS.seoTitleMax} (${String(seoTitleMax)})`,
        };
    }
    const styleRaw = timelineStyle as string;
    const timeline: TimelineStyle =
        styleRaw === 'true' || styleRaw === 'after'
            ? 'after'
            : styleRaw === 'false' || styleRaw === 'omit'
              ? 'omit'
              : 'before';
    return {
        config: {
            seo: seo as boolean,
            titleMode: titleMode as TitleMode,
            titlePattern: text('titlePattern', ENV_KEYS.titlePattern, SEO_DEFAULTS.titlePattern),
            seriesName: text('seriesName', ENV_KEYS.seriesName, SEO_DEFAULTS.seriesName),
            showName: text('showName', ENV_KEYS.showName, SEO_DEFAULTS.showName),
            titleMax: titleMax as number,
            titleMaxKeywords: titleMaxKeywords as number,
            seoTitleSuffix,
            seoTitleMax: seoTitleMax as number,
            descriptionMin: descriptionMin as number,
            descriptionMax: descriptionMax as number,
            descriptionSource: descriptionSource as DescriptionSource,
            descriptionPattern: text(
                'descriptionPattern',
                ENV_KEYS.descriptionPattern,
                SEO_DEFAULTS.descriptionPattern,
            ),
            summaryParagraph: summaryParagraph as boolean,
            timelineStyle: timeline,
            autoEpisodeNumber: autoEpisodeNumber as boolean,
            titleSanitize: titleSanitize as SanitizeMode,
            linkField: linkField as LinkField,
            slugMode: slugMode as SlugMode,
            slugPattern: text('slugPattern', ENV_KEYS.slugPattern, SEO_DEFAULTS.slugPattern),
            socialImage: socialImage as boolean,
            socialImageAltPattern: text(
                'socialImageAltPattern',
                ENV_KEYS.socialImageAltPattern,
                SEO_DEFAULTS.socialImageAltPattern,
            ),
            roundDuration: roundDuration as boolean,
        },
    };
}

function hasControlChar(value: string): boolean {
    for (const ch of value) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) return true;
    }
    return false;
}

/** Characters that would break the theme's unescaped JSON-LD string. */
function forbiddenChars(value: string): string[] {
    const found: string[] = [];
    if (value.includes('"')) found.push('"');
    if (value.includes('\\')) found.push('\\');
    if (value.includes('<')) found.push('<');
    if (value.includes('>')) found.push('>');
    if (hasControlChar(value)) found.push('control');
    return found;
}

/**
 * `"` becomes paired “ ”, a lone quote becomes ”, `\` becomes ＼, `<>` become 〈〉,
 * and C0/C1 plus U+2028/U+2029 are removed. `reject` names the offending characters.
 */
export function sanitizeTitle(
    value: string,
    mode: SanitizeMode,
): { ok: true; value: string } | { ok: false; error: string } {
    const forbidden = forbiddenChars(value);
    if (mode === 'reject' && forbidden.length > 0) {
        return { ok: false, error: `title contains forbidden characters: ${forbidden.join(', ')}` };
    }
    const chars = Array.from(value);
    const quoteAt: number[] = [];
    chars.forEach((ch, index) => {
        if (ch === '"') quoteAt.push(index);
    });
    const odd = quoteAt.length % 2 === 1;
    for (let n = 0; n < quoteAt.length; n++) {
        const index = quoteAt[n] ?? 0;
        const last = n === quoteAt.length - 1;
        chars[index] = odd && last ? '”' : n % 2 === 0 ? '“' : '”';
    }
    let out = '';
    for (const ch of chars) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) continue;
        if (ch === '\\') out += '＼';
        else if (ch === '<') out += '〈';
        else if (ch === '>') out += '〉';
        else out += ch;
    }
    return { ok: true, value: out.trim() };
}

function spaceCjkLatin(text: string): string {
    return text.replace(/(\p{Script=Han})([A-Za-z0-9])/gu, '$1 $2').replace(/([A-Za-z0-9])(\p{Script=Han})/gu, '$1 $2');
}

/** Legacy series names, a duplicated trailing date, whitespace, and CJK/Latin spacing outside the series token. */
export function normalizeEpisodeTitle(title: string, seriesName: string): string {
    let out = title.replace(/\s+/g, ' ').trim();
    const legacy = /^(?:每日 AI 资讯|每日AI资讯|AI 乱炖|AI乱炖)/;
    if (legacy.test(out)) out = out.replace(legacy, seriesName);
    const trailing = /\s·\s*(\d{4}-\d{2}-\d{2})\s*$/;
    const trail = trailing.exec(out);
    if (trail?.[1] && out.slice(0, trail.index).includes(trail[1])) out = out.slice(0, trail.index).trim();
    if (seriesName.length > 0 && out.startsWith(seriesName)) {
        let rest = spaceCjkLatin(out.slice(seriesName.length));
        const seriesEndsCjk = /\p{Script=Han}$/u.test(seriesName);
        if (seriesEndsCjk && /^[A-Za-z0-9]/.test(rest)) rest = ` ${rest}`;
        out = seriesName + rest;
    } else {
        out = spaceCjkLatin(out);
    }
    return out.replace(/\s+/g, ' ').trim();
}

function isRealDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;
    const utc = new Date(Date.UTC(year, month - 1, day));
    return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/** `YYYYMMDD` or `YYYY-MM-DD` (extra time text is ignored) → ISO date, or undefined. */
export function isoFromRunDate(raw: string): string | undefined {
    const digits = raw.replaceAll(/\D/g, '');
    if (digits.length < 8) return undefined;
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    if (!isRealDate(year, month, day)) return undefined;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Calendar date in America/Los_Angeles. Episode identity follows the news day, not UTC. */
export function isoFromLosAngeles(ms: number): string | undefined {
    if (!Number.isFinite(ms)) return undefined;
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(ms));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) return undefined;
    return `${year}-${month}-${day}`;
}

export function resolveEpisodeDate(metadata: Record<string, unknown>, publishedAtMs?: number): string | undefined {
    if (typeof metadata.runDate === 'string') {
        const fromRun = isoFromRunDate(metadata.runDate);
        if (fromRun) return fromRun;
    }
    if (publishedAtMs !== undefined) return isoFromLosAngeles(publishedAtMs);
    const publishedAt = metadata.publishedAt;
    if (typeof publishedAt === 'number') return isoFromLosAngeles(publishedAt);
    if (typeof publishedAt === 'string' && publishedAt.length > 0) {
        const parsed = Date.parse(publishedAt);
        if (!Number.isNaN(parsed)) return isoFromLosAngeles(parsed);
    }
    return undefined;
}

/** Season = year, episode = 1-based day-of-year. UTC calendar math, so the zone cannot shift the day. */
export function seasonAndEpisode(isoDate: string): { season: number; episode: number } | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!match) return undefined;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isRealDate(year, month, day)) return undefined;
    const episode = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
    return { season: year, episode };
}

function isPositiveInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export function keywordsFromRefinedTitle(title: string): string[] {
    const index = title.indexOf('：');
    if (index < 0) return [];
    return title
        .slice(index + 1)
        .split('、')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

/** Plan-doc fallback: cut at the first clause break, then keep at most 15 code points. */
export function keywordFromDocTitle(title: string): string {
    const cut = title.split(/，|,|：|；|——/)[0]?.trim() ?? '';
    return Array.from(cut).slice(0, 15).join('');
}

export function clauseFromTitle(title: string): string {
    const cut = (title.split(/，|,/)[0] ?? title).replaceAll('「', '').replaceAll('」', '');
    return cut.replace(/\s+/g, ' ').trim();
}

export function firstSentence(text: string): string {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0) return '';
    const parts = trimmed.split(/(?<=[。！？.!?])/);
    return (parts[0] ?? trimmed).trim();
}

export function planItemsFromMetadata(metadata: Record<string, unknown> | undefined): PlanItem[] {
    const raw = podcastOf(metadata).planItems;
    if (!Array.isArray(raw)) return [];
    const items: PlanItem[] = [];
    for (const entry of raw) {
        const record = asRecord(entry);
        if (!record) continue;
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        const brief = typeof record.brief === 'string' ? record.brief.trim() : '';
        if (title.length === 0 && brief.length === 0) continue;
        items.push(brief.length > 0 ? { title, brief } : { title });
    }
    return items;
}

function stringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
    return items.filter((entry) => entry.length > 0);
}

function cutAtBoundary(value: string, room: number): string {
    if (room <= 0) return '';
    const chars = Array.from(value);
    if (chars.length <= room) return value;
    const sliced = chars.slice(0, room);
    let cut = sliced.length;
    for (let index = sliced.length - 1; index >= 0; index--) {
        if (/[，。！？、；：,.\s]/.test(sliced[index] ?? '')) {
            cut = index;
            break;
        }
    }
    const trimmed = sliced.slice(0, cut).join('').trim();
    return trimmed.length > 0 ? trimmed : sliced.join('').trim();
}

function headlineFromKeywords(config: PodcastSeoConfig, date: string, keywords: string[], limit: number): string {
    const head = normalizeEpisodeTitle(
        config.titlePattern
            .replaceAll('{series}', config.seriesName)
            .replaceAll('{date}', date)
            .replaceAll('{keywords}', ''),
        config.seriesName,
    );
    const chosen: string[] = [];
    for (const keyword of keywords) {
        const title = normalizeEpisodeTitle(`${head}${[...chosen, keyword].join('、')}`, config.seriesName);
        if (codePointLength(title) <= limit) chosen.push(keyword);
        else break;
    }
    if (chosen.length === 0 && keywords[0]) {
        const room = limit - codePointLength(head);
        const cut = cutAtBoundary(keywords[0], room);
        if (cut.length > 0) chosen.push(cut);
    }
    return normalizeEpisodeTitle(chosen.length > 0 ? `${head}${chosen.join('、')}` : head, config.seriesName);
}

interface KeywordPick {
    explicitTitle?: string;
    keywords: string[];
}

function pickKeywords(metadata: Record<string, unknown>, config: PodcastSeoConfig): KeywordPick {
    const podcast = podcastOf(metadata);
    if (typeof podcast.title === 'string' && podcast.title.trim().length > 0) {
        return { explicitTitle: podcast.title.trim(), keywords: [] };
    }
    const explicit = stringList(podcast.titleKeywords);
    if (explicit && explicit.length > 0) return { keywords: explicit.slice(0, config.titleMaxKeywords) };
    const refined = typeof podcast.refinedTitle === 'string' ? keywordsFromRefinedTitle(podcast.refinedTitle) : [];
    if (refined.length > 0) return { keywords: refined.slice(0, config.titleMaxKeywords) };
    const fromPlan = planItemsFromMetadata(metadata)
        .map((item) => keywordFromDocTitle(item.title))
        .filter((keyword) => keyword.length > 0);
    if (fromPlan.length > 0) return { keywords: fromPlan.slice(0, config.titleMaxKeywords) };
    return { keywords: [] };
}

function buildItemTitle(
    asIs: string,
    metadata: Record<string, unknown>,
    config: PodcastSeoConfig,
    date: string | undefined,
    warnings: string[],
): { title: string; keywords: string[]; explicit: boolean } {
    const picked = pickKeywords(metadata, config);
    if (picked.explicitTitle) return { title: picked.explicitTitle, keywords: [], explicit: true };
    if (config.titleMode !== 'headline') return { title: asIs, keywords: picked.keywords, explicit: false };
    if (!date) {
        warnings.push(`${WARN_PREFIX} headline title skipped: episode date is unknown`);
        return { title: asIs, keywords: [], explicit: false };
    }
    if (picked.keywords.length === 0) {
        warnings.push(`${WARN_PREFIX} no keywords for the headline title; keeping the as-is title`);
        return { title: asIs, keywords: [], explicit: false };
    }
    return {
        title: headlineFromKeywords(config, date, picked.keywords, config.titleMax),
        keywords: picked.keywords,
        explicit: false,
    };
}

function fitSeoTitle(
    episodeTitle: string,
    keywords: string[],
    config: PodcastSeoConfig,
    date: string | undefined,
    explicit: boolean,
): { stem: string; seo: string } {
    const suffix = config.seoTitleSuffix;
    let stem = episodeTitle;
    let remaining = keywords;
    let seo = `${stem}${suffix}`;
    while (codePointLength(seo) > config.seoTitleMax && remaining.length > 0 && date && !explicit) {
        remaining = remaining.slice(0, -1);
        stem = headlineFromKeywords(config, date, remaining, config.titleMax);
        seo = `${stem}${suffix}`;
    }
    if (codePointLength(seo) > config.seoTitleMax) {
        const room = config.seoTitleMax - codePointLength(suffix);
        stem = cutAtBoundary(stem, room);
        seo = `${stem}${suffix}`;
    }
    return { stem, seo };
}

function cleanClause(value: string): string {
    return value
        .replace(/<[^>]*>/g, '')
        .replace(/[*#`[\]]/g, '')
        .replace(/[。！？.!?]+$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function descriptionHead(config: PodcastSeoConfig, date: string | undefined, minutes: number | undefined): string {
    const pattern = config.descriptionPattern.includes('{clauses}')
        ? (config.descriptionPattern.split('{clauses}')[0] ?? config.descriptionPattern)
        : config.descriptionPattern;
    let head = pattern.replaceAll('{show}', config.showName).replaceAll('{series}', config.seriesName);
    if (date) head = head.replaceAll('{date}', date);
    else head = head.replaceAll(' {date}', '').replaceAll('{date}', '');
    if (minutes !== undefined && minutes > 0) head = head.replaceAll('{minutes}', String(minutes));
    else head = head.replaceAll('（约 {minutes} 分钟）', '').replaceAll('{minutes}', '');
    return head.replace(/。\s*$/, '');
}

export function durationMinutes(seconds: number | undefined): number | undefined {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
    return Math.round(seconds / 60);
}

export function buildSeoDescription(input: {
    config: PodcastSeoConfig;
    date?: string;
    minutes?: number;
    clauses: string[];
    extraSentences: string[];
}): { description: string; short: boolean } {
    const head = descriptionHead(input.config, input.date, input.minutes);
    const render = (parts: string[]): string => (parts.length === 0 ? head : `${head}${parts.join('；')}。`);
    const picked: string[] = [];
    const pushWhile = (candidates: string[]) => {
        for (const candidate of candidates) {
            const clause = cleanClause(candidate);
            if (clause.length === 0 || picked.includes(clause)) continue;
            const next = render([...picked, clause]);
            if (codePointLength(next) <= input.config.descriptionMax) picked.push(clause);
        }
    };
    pushWhile(input.clauses);
    if (codePointLength(render(picked)) < input.config.descriptionMin) pushWhile(input.extraSentences);
    const description = render(picked);
    return { description, short: codePointLength(description) < input.config.descriptionMin };
}

function descriptionInputs(
    metadata: Record<string, unknown>,
    config: PodcastSeoConfig,
    date: string | undefined,
    minutes: number | undefined,
): { description: string; short: boolean } {
    const podcast = podcastOf(metadata);
    const plan = planItemsFromMetadata(metadata);
    const summary = stringList(podcast.summaryClauses);
    const surfing =
        config.descriptionSource === 'surfing' && typeof podcast.refinedDescription === 'string'
            ? podcast.refinedDescription.trim()
            : '';
    const clauses = surfing
        ? [surfing]
        : summary && summary.length > 0
          ? summary
          : plan.map((item) => clauseFromTitle(item.title)).filter((clause) => clause.length > 0);
    const extras = plan
        .map((item) => (item.brief ? firstSentence(item.brief) : ''))
        .filter((sentence) => sentence.length > 0);
    return buildSeoDescription({ config, date, minutes, clauses, extraSentences: extras });
}

/** microfeed slug rule: lowercase letters, digits and hyphens, ≤120, no trailing hyphen. */
export function isValidItemSlug(slug: string): boolean {
    return slug.length >= 1 && slug.length <= 120 && !slug.endsWith('-') && /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

export function renderSlug(
    pattern: string,
    date: string | undefined,
): { slug?: string; error?: string; warning?: string } {
    if (!date) return { warning: 'skipping slug: episode date is unknown' };
    const slug = pattern.replaceAll('{date}', date);
    if (!isValidItemSlug(slug)) {
        return {
            error: `invalid PODCAST_PUB_SLUG_PATTERN output "${slug}": expected lowercase letters, digits and hyphens (^[a-z0-9][a-z0-9-]*$), at most 120 characters, and no trailing hyphen`,
        };
    }
    return { slug };
}

export function roundDurationSeconds(seconds: number | undefined, enabled: boolean): number | undefined {
    if (seconds === undefined) return undefined;
    return enabled ? Math.round(seconds) : seconds;
}

function imageMimeFromBytes(bytes: Uint8Array): 'image/png' | 'image/jpeg' | undefined {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    return undefined;
}

/** PNG IHDR or JPEG SOF. Returns undefined when the header is not a PNG or JPEG. */
export function readImageDimensions(
    bytes: Uint8Array,
): { width: number; height: number; mime: 'image/png' | 'image/jpeg' } | undefined {
    const mime = imageMimeFromBytes(bytes);
    if (mime === 'image/png') {
        if (bytes.length < 24) return undefined;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const width = view.getUint32(16);
        const height = view.getUint32(20);
        return { width, height, mime };
    }
    if (mime === 'image/jpeg') {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 2;
        while (offset + 3 < bytes.length) {
            if (bytes[offset] !== 0xff) return undefined;
            const marker = bytes[offset + 1] ?? 0;
            if (marker === 0xd8 || marker === 0xd9) {
                offset += 2;
                continue;
            }
            if (marker >= 0xd0 && marker <= 0xd7) {
                offset += 2;
                continue;
            }
            if (offset + 4 > bytes.length) return undefined;
            const length = view.getUint16(offset + 2);
            if (length < 2) return undefined;
            const isSof =
                marker === 0xc0 ||
                marker === 0xc1 ||
                marker === 0xc2 ||
                (marker >= 0xc5 && marker <= 0xc7) ||
                (marker >= 0xc9 && marker <= 0xcb) ||
                (marker >= 0xcd && marker <= 0xcf);
            if (isSof) {
                if (offset + 9 > bytes.length) return undefined;
                return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), mime };
            }
            offset += 2 + length;
        }
    }
    return undefined;
}

function readLocalBytes(path: string): Uint8Array | undefined {
    try {
        return new Uint8Array(readFileSync(path));
    } catch {
        return undefined;
    }
}

function altText(config: PodcastSeoConfig, date: string | undefined, keywords: string[]): string {
    const rendered = config.socialImageAltPattern
        .replaceAll('{series}', config.seriesName)
        .replaceAll('{date}', date ?? '')
        .replaceAll('{keywords}', keywords.join('、'));
    const sanitized = sanitizeTitle(rendered, 'normalize');
    const value = sanitized.ok ? sanitized.value : rendered;
    if (codePointLength(value) <= 200) return value;
    return cutAtBoundary(value, 200);
}

function mustSanitize(
    value: string,
    mode: SanitizeMode,
    label: string,
): { ok: true; value: string } | { ok: false; error: string } {
    const sanitized = sanitizeTitle(value, mode);
    if (!sanitized.ok) return { ok: false, error: `${label}: ${sanitized.error}` };
    return sanitized;
}

/**
 * Applies R1–R9 to a mapped episode. Does not touch the network.
 * A `reject` sanitise failure or an invalid slug pattern returns `ok: false` before any request.
 */
export function prepareEpisodeFields(
    episode: {
        title: string;
        durationSeconds?: number;
        link?: string;
        itunes?: PreparedEpisodeFields['itunes'];
        datePublishedMs?: number;
    },
    metadata: Record<string, unknown>,
    config: PodcastSeoConfig,
): { ok: true; fields: PreparedEpisodeFields } | { ok: false; error: string } {
    const warnings: string[] = [];
    const date = resolveEpisodeDate(metadata, episode.datePublishedMs);
    const built = buildItemTitle(episode.title, metadata, config, date, warnings);
    const sanitizedTitle = mustSanitize(built.title, config.titleSanitize, 'item title');
    if (!sanitizedTitle.ok) return sanitizedTitle;
    // Explicit titles are an escape hatch: sanitise them, and do not rebuild the RSS title.
    // Headline titles are normalised (legacy series names, CJK/Latin spacing). as-is stays byte-stable.
    let title = built.explicit
        ? sanitizedTitle.value
        : config.titleMode === 'headline'
          ? normalizeEpisodeTitle(sanitizedTitle.value, config.seriesName)
          : sanitizedTitle.value;
    const itunes = { ...(episode.itunes ?? {}) };
    if (itunes.season !== undefined && !isPositiveInt(itunes.season)) {
        return {
            ok: false,
            error: `invalid metadata.itunes.season: expected an integer ≥ 1, got ${String(itunes.season)}`,
        };
    }
    if (itunes.episode !== undefined && !isPositiveInt(itunes.episode)) {
        return {
            ok: false,
            error: `invalid metadata.itunes.episode: expected an integer ≥ 1, got ${String(itunes.episode)}`,
        };
    }
    if (config.autoEpisodeNumber) {
        const derived = date ? seasonAndEpisode(date) : undefined;
        if (derived) {
            if (itunes.season === undefined) itunes.season = derived.season;
            if (itunes.episode === undefined) itunes.episode = derived.episode;
        } else if (itunes.season === undefined || itunes.episode === undefined) {
            warnings.push(`${WARN_PREFIX} itunes season/episode left unset: episode date is unknown`);
        }
    }
    if (itunes.title) {
        const sanitizedItunes = mustSanitize(itunes.title, config.titleSanitize, 'itunes:title');
        if (!sanitizedItunes.ok) return sanitizedItunes;
        itunes.title = sanitizedItunes.value;
    }
    const minutes = durationMinutes(episode.durationSeconds);
    let seo: SeoBlock | undefined;
    if (config.seo) {
        const fitted = fitSeoTitle(title, built.keywords, config, date, built.explicit);
        if (!built.explicit && config.titleMode === 'headline' && fitted.stem.length > 0) title = fitted.stem;
        const seoTitle = mustSanitize(fitted.seo, config.titleSanitize, 'seo.title');
        if (!seoTitle.ok) return seoTitle;
        const described = descriptionInputs(metadata, config, date, minutes);
        if (described.short) {
            warnings.push(
                `${WARN_PREFIX} seo.description is ${codePointLength(described.description)} code points, under the ${config.descriptionMin} minimum; left unpadded`,
            );
        }
        seo = { title: seoTitle.value, description: described.description };
    }
    let slug: string | undefined;
    if (config.slugMode === 'pattern') {
        const rendered = renderSlug(config.slugPattern, date);
        if (rendered.error) return { ok: false, error: rendered.error };
        if (rendered.warning) warnings.push(`${WARN_PREFIX} ${rendered.warning}`);
        slug = rendered.slug;
    }
    if (config.linkField === 'url' && episode.link) {
        warnings.push(
            `${WARN_PREFIX} PODCAST_PUB_LINK_FIELD=url sends metadata.articleUrl as the item url; microfeed uses that URL as the canonical and drops the episode from the podcast sitemap`,
        );
    }
    let socialAlt: string | undefined;
    let socialLocalPath: string | undefined;
    let socialMime: PreparedEpisodeFields['socialMime'];
    let socialRemoteUrl: string | undefined;
    if (config.socialImage) {
        const source = podcastOf(metadata).socialImage;
        const alt = altText(config, date, built.keywords);
        if (typeof source !== 'string' || source.trim().length === 0) {
            warnings.push(
                `${WARN_PREFIX} PODCAST_PUB_SOCIAL_IMAGE is on but metadata.podcast.socialImage is empty; skipping alt text`,
            );
        } else if (source.trim().startsWith('http')) {
            socialAlt = alt;
            socialRemoteUrl = source.trim();
        } else {
            const bytes = readLocalBytes(source.trim());
            const dims = bytes ? readImageDimensions(bytes) : undefined;
            if (dims?.width !== 1200 || dims?.height !== 630) {
                warnings.push(
                    `${WARN_PREFIX} social image skipped: expected a 1200×630 PNG or JPEG, got ${dims ? `${dims.width}×${dims.height}` : 'an unreadable file'}`,
                );
            } else {
                socialAlt = alt;
                socialLocalPath = source.trim();
                socialMime = dims.mime;
            }
        }
    }
    for (const line of warnings) console.error(line);
    return {
        ok: true,
        fields: {
            title,
            itunes,
            durationSeconds: roundDurationSeconds(episode.durationSeconds, config.roundDuration),
            ...(config.linkField === 'url' && episode.link ? { link: episode.link } : {}),
            ...(seo ? { seo } : {}),
            ...(slug ? { slug } : {}),
            warnings,
            ...(socialAlt ? { socialAlt } : {}),
            ...(socialLocalPath ? { socialLocalPath, socialMime } : {}),
            ...(socialRemoteUrl ? { socialRemoteUrl } : {}),
        },
    };
}

/** Markdown summary paragraph: R3 text without the `{show}·` prefix, then the Surfing cross-link. */
export function showNotesSummaryParagraph(input: {
    config: PodcastSeoConfig;
    runDate: string;
    durationSeconds?: number;
    plan: PlanItem[];
    refinedDescription?: string;
    summaryClauses?: string[];
    articleUrl: string;
    linkText: string;
}): { markdown: string; description: string; warnings: string[] } {
    const date = isoFromRunDate(input.runDate);
    const metadata: Record<string, unknown> = {
        ...(date ? { runDate: date } : { runDate: input.runDate }),
        podcast: {
            ...(input.refinedDescription ? { refinedDescription: input.refinedDescription } : {}),
            ...(input.summaryClauses ? { summaryClauses: input.summaryClauses } : {}),
            planItems: input.plan,
        },
    };
    const described = descriptionInputs(metadata, input.config, date, durationMinutes(input.durationSeconds));
    const warnings: string[] = [];
    if (described.short) {
        warnings.push(
            `${WARN_PREFIX} seo.description is ${codePointLength(described.description)} code points, under the ${input.config.descriptionMin} minimum; left unpadded`,
        );
    }
    const prefix = `${input.config.showName}·`;
    const stripped = described.description.startsWith(prefix)
        ? described.description.slice(prefix.length)
        : described.description;
    const safeLabel = input.linkText.replaceAll('[', '').replaceAll(']', '').replaceAll('(', '').replaceAll(')', '');
    const markdown = `${stripped} 完整图文版：[${safeLabel}](${input.articleUrl})`;
    return { markdown, description: described.description, warnings };
}

export function summaryParagraphHtml(
    description: string,
    showName: string,
    articleUrl: string | undefined,
    linkText: string,
): string {
    const prefix = `${showName}·`;
    const stripped = description.startsWith(prefix) ? description.slice(prefix.length) : description;
    const text = stripped.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    if (!articleUrl) return `<p>${text}</p>`;
    const href = articleUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '');
    const label = linkText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `<p>${text} 完整图文版：<a href="${href}" target="_blank" rel="noopener">${label}</a></p>`;
}

function stripMarkupTitle(raw: string): string {
    return raw
        .replace(/<[^>]+>/g, ' ')
        .replace(/来源/g, '')
        .replace(/^\s*\d+\s*[.、]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Chapter titles from a timeline (`.kk-tl-title`) or, failing that, legacy `<h2>` sections. */
export function titlesFromContentHtml(html: string): string[] {
    const timeline = [...html.matchAll(/class="kk-tl-title">([\s\S]*?)<\/div>/gi)]
        .map((match) => stripMarkupTitle(match[1] ?? ''))
        .filter((title) => title.length > 0);
    if (timeline.length > 0) return timeline;
    return [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
        .map((match) => stripMarkupTitle(match[1] ?? ''))
        .filter((title) => title.length > 0);
}

function insertAfterTimeline(html: string, insertion: string): string {
    const start = html.indexOf('<div class="kk-tl">');
    if (start < 0) return `${html.trim()}\n${insertion}`;
    let depth = 0;
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = start;
    let match = tags.exec(html);
    while (match) {
        depth += match[0].startsWith('</') ? -1 : 1;
        if (depth === 0) {
            const at = match.index + match[0].length;
            const head = html.slice(0, at).replace(/\s*$/, '');
            const tail = html.slice(at).replace(/^\s*/, '');
            return tail.length > 0 ? `${head}\n${insertion}\n${tail}` : `${head}\n${insertion}`;
        }
        match = tags.exec(html);
    }
    return `${html.trim()}\n${insertion}`;
}

/**
 * Summary `<p>` first, and the timeline `<style>` moved to after the timeline `</div>`.
 * A second pass on already-rewritten HTML does not duplicate the paragraph or the style.
 */
export function rewriteEpisodeHtml(html: string, summaryHtml: string, moveStyle: boolean): string {
    let body = html;
    if (moveStyle) {
        const styleMatch = body.match(/<style>[\s\S]*?<\/style>/i);
        if (styleMatch && styleMatch.index !== undefined) {
            const style = styleMatch[0];
            const without = `${body.slice(0, styleMatch.index)}${body.slice(styleMatch.index + style.length)}`;
            body = insertAfterTimeline(without, style);
        }
    }
    const trimmed = body.trim();
    if (
        summaryHtml.length > 0 &&
        (trimmed === summaryHtml || trimmed.startsWith(`${summaryHtml}\n`) || trimmed.startsWith(`${summaryHtml}<`))
    ) {
        return trimmed;
    }
    return `${summaryHtml}\n${trimmed}`;
}

/** ISO date from an existing feed item: title `YYYY-MM-DD`, else `date_published` in America/Los_Angeles. */
export function dateFromFeedItem(item: Record<string, unknown>): string | undefined {
    const title = typeof item.title === 'string' ? item.title : '';
    const inTitle = /(\d{4}-\d{2}-\d{2})/.exec(title);
    if (inTitle?.[1] && isoFromRunDate(inTitle[1])) return inTitle[1];
    const msField = item.date_published_ms;
    if (typeof msField === 'number') return isoFromLosAngeles(msField);
    const published = item.date_published;
    if (typeof published === 'number') return isoFromLosAngeles(published);
    if (typeof published === 'string') {
        const parsed = Date.parse(published);
        if (!Number.isNaN(parsed)) return isoFromLosAngeles(parsed);
    }
    return undefined;
}
