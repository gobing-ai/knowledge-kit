/**
 * 0385 R4 — the daily episode's canonical, frozen identity.
 *
 * One episode is identified by its run date plus one headline point (「当日要点」) anchored to the
 * admitted lead story. Every publishing surface (Chinese title, cover headline, ID3/RSS title, show
 * notes) reads that single frozen record instead of deriving its own title, so the episode cannot
 * carry two identities. Two failure modes are explicit, never silent:
 *
 *  - `support-removed`: admission dropped the source(s) the headline rests on. The headline — and
 *    every field derived from it — is withheld (`title: null`); the caller must regenerate the
 *    headline from an admitted story or refuse to publish. It never keeps a title it cannot support.
 *  - `no-headline`: no point was frozen at all (a legacy bundle or a run without a script plan).
 *    `legacyTitle` is carried through untouched, so replaying an old bundle reproduces what aired.
 *
 * Retries and historical replay reuse the record already stamped in the bundle's metadata
 * ({@link identityFromMetadata}) verbatim: a replayed episode keeps the identity it shipped with
 * even when today's admission would compute a different one.
 *
 * Pure string work, node builtins only — no I/O, so the render and publish seams share it.
 */

/** The frozen record; `version` pins the shape so a future change fails loud instead of drifting. */
export interface EpisodeIdentity {
    version: 1;
    /** The run date exactly as the caller supplied it (the episode date is frozen, never re-derived). */
    date: string;
    /** ISO-ish issue number in the Chinese title: `20261120` / `2026-11-20` → `261120`. */
    issue: string;
    /** The frozen 当日要点 (one line, ≤ {@link MAX_HEADLINE_CHARS}), or null when withheld. */
    headline: string | null;
    /** `第<issue>期 · <headline>`, or null when the headline had to be withheld. */
    title: string | null;
    /** The cover reuses the same point — never a second wording of it. */
    coverHeadline: string | null;
    /** The admitted source ids the headline rests on (empty when the caller named none). */
    supportingSourceIds: string[];
    status: 'frozen' | 'no-headline' | 'support-removed';
}

export interface EpisodeIdentityInput {
    /** Run date, `YYYYMMDD` or `YYYY-MM-DD`. */
    date: string;
    /** The candidate 当日要点 (may still carry line breaks from the writer). */
    headline?: string | null;
    /** Source ids the headline rests on. Omitted/empty means "no claim made about support". */
    supportingSourceIds?: readonly string[] | null;
    /** Source ids the settled plan (admission) actually keeps. */
    admittedSourceIds?: readonly string[] | null;
    /** Pre-0385 title of the same episode, preserved for legacy bundles and replay. */
    legacyTitle?: string | null;
}

/** The style contract caps the cover headline at 25 chars per line (0347 R4); the point is one line. */
export const MAX_HEADLINE_CHARS = 25;

/** Trim, collapse whitespace (writers emit wrapped `\n`), and drop a trailing sentence stop. */
function normalizeHeadline(raw: string): string {
    return raw
        .replaceAll(/\s+/g, ' ')
        .trim()
        .replace(/[。．.、，,；;：:·]+$/u, '')
        .trim();
}

/** Code-point slice — a UTF-16 slice could split a surrogate pair in the middle of the title. */
function clip(text: string, max: number): string {
    const points = [...text];
    return points.length <= max ? text : `${points.slice(0, max - 1).join('')}…`;
}

/** The issue number of the frozen episode date, or `''` when the date carries no digits at all. */
export function issueNumberOf(date: string): string {
    const digits = date.replaceAll(/\D/g, '');
    return digits.length >= 6 ? digits.slice(-6) : '';
}

/** `第261120期` — the title's stable prefix, derived from the episode date only. */
export function issueLabel(date: string): string {
    const issue = issueNumberOf(date);
    return issue === '' ? '' : `第${issue}期`;
}

/**
 * The Chinese publish title of one episode: `第261120期 · 当日要点`. Returns `''` when the point
 * is empty, so a caller can never emit a dangling `第261120期 · `.
 */
export function composeEpisodeTitle(date: string, headline: string): string {
    const label = issueLabel(date);
    const point = clip(normalizeHeadline(headline), MAX_HEADLINE_CHARS);
    return label === '' || point === '' ? '' : `${label} · ${point}`;
}

/**
 * Freeze one episode's identity. Deterministic: the same inputs always produce the same record,
 * and only admission can withhold the title — never a re-worded fallback.
 */
export function freezeEpisodeIdentity(input: EpisodeIdentityInput): EpisodeIdentity {
    const date = input.date.trim();
    const issue = issueNumberOf(date);
    const headline = normalizeHeadline(input.headline ?? '');
    const supportingSourceIds = [...new Set((input.supportingSourceIds ?? []).map((id) => id.trim()))].filter(
        (id) => id !== '',
    );
    const legacyTitle = (input.legacyTitle ?? '').trim();

    if (headline === '' || issue === '') {
        return {
            version: 1,
            date,
            issue,
            headline: null,
            title: legacyTitle === '' ? null : legacyTitle,
            coverHeadline: null,
            supportingSourceIds: [],
            status: 'no-headline',
        };
    }

    // Admission is only consulted when the caller said what the headline rests on; "no ids named"
    // is not evidence that the support vanished (legacy plans carry no id on the cover at all).
    const admitted = new Set((input.admittedSourceIds ?? []).map((id) => id.trim()).filter((id) => id !== ''));
    const supportRemoved = supportingSourceIds.length > 0 && !supportingSourceIds.some((id) => admitted.has(id));
    if (supportRemoved) {
        return {
            version: 1,
            date,
            issue,
            headline: null,
            title: null,
            coverHeadline: null,
            supportingSourceIds,
            status: 'support-removed',
        };
    }

    const point = clip(headline, MAX_HEADLINE_CHARS);
    return {
        version: 1,
        date,
        issue,
        headline: point,
        title: `${issueLabel(date)} · ${point}`,
        coverHeadline: point,
        supportingSourceIds,
        status: 'frozen',
    };
}

/**
 * The identity a bundle already ships, read back from its `metadata.episode-identity` — the retry
 * and historical-replay path. Anything unrecognizable returns null (the caller freezes afresh)
 * instead of throwing: an old bundle must still replay.
 */
export function identityFromMetadata(metadata: unknown): EpisodeIdentity | null {
    if (metadata === null || typeof metadata !== 'object') return null;
    const raw = (metadata as Record<string, unknown>).episodeIdentity;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (record.version !== 1) return null;
    const status = record.status;
    if (status !== 'frozen' && status !== 'no-headline' && status !== 'support-removed') return null;
    if (typeof record.date !== 'string' || record.date.trim() === '') return null;
    const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
    const ids = Array.isArray(record.supportingSourceIds)
        ? record.supportingSourceIds.filter((id): id is string => typeof id === 'string')
        : [];
    return {
        version: 1,
        date: record.date.trim(),
        issue: typeof record.issue === 'string' ? record.issue : issueNumberOf(record.date),
        headline: text(record.headline),
        title: text(record.title),
        coverHeadline: text(record.coverHeadline),
        supportingSourceIds: ids,
        status,
    };
}

/** The metadata field the record is stamped under, so reader and writer cannot disagree. */
export const EPISODE_IDENTITY_KEY = 'episodeIdentity';
