/**
 * `backfill-seo` (design D9 / R10). Dry-run is the default. The op never calls a
 * host other than the one in `MICROFEED_BASE_URL`, and tests stub that client.
 *
 * Default patch fills `_microfeed.seo` and missing iTunes numbers only.
 * `--retitle`, `--rewrite-body` and `--apply-slug` are separate opt-ins.
 */

import type { Result } from '@gobing-ai/kk-core';
import { ResultSchema } from '@gobing-ai/kk-core';
import { ensureDirForFile, readJsonFile, writeJsonFile } from '@gobing-ai/ts-runtime';
import { echo } from '@gobing-ai/ts-utils';
import {
    type MicrofeedClient,
    type MicrofeedItem,
    type MicrofeedItemInput,
    MicrofeedRequestError,
} from './microfeed-client';
import {
    clauseFromTitle,
    codePointLength,
    dateFromFeedItem,
    isValidItemSlug,
    type PodcastSeoConfig,
    prepareEpisodeFields,
    renderSlug,
    rewriteEpisodeHtml,
    type SeoBlock,
    summaryParagraphHtml,
    titlesFromContentHtml,
    warn,
} from './seo';

const TARGET = 'podcast-pub';

export interface BackfillOverride {
    id: string;
    title?: string;
    titleKeywords?: string[];
    summaryClauses?: string[];
}

export interface BackfillOptions {
    since?: unknown;
    until?: unknown;
    ids?: unknown;
    out?: unknown;
    /** Reviewed plan JSON. When `apply` is set, these patches are sent instead of a fresh plan. */
    plan?: unknown;
    apply?: unknown;
    retitle?: unknown;
    rewriteBody?: unknown;
    applySlug?: unknown;
    overrides?: unknown;
}

export interface BackfillEntry {
    id: string;
    date?: string;
    patch: MicrofeedItemInput;
    counts: { title?: number; seoTitle?: number; seoDescription?: number };
    violations: string[];
    current: {
        title?: string;
        seoTitle?: string;
        seoDescription?: string;
        season?: number;
        episode?: number;
        slug?: string;
    };
}

interface BackfillFlags {
    apply: boolean;
    retitle: boolean;
    rewriteBody: boolean;
    applySlug: boolean;
    since?: string;
    until?: string;
    ids?: Set<string>;
    out?: string;
    planPath?: string;
    overrides: Map<string, BackfillOverride>;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    return undefined;
}

function flag(value: unknown): boolean {
    return value === true || value === 'true' || value === '1';
}

function positiveInt(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 1) return parsed;
    }
    return undefined;
}

function parseOverrides(raw: unknown): { overrides: Map<string, BackfillOverride> } | { error: string } {
    if (raw === undefined) return { overrides: new Map() };
    if (!Array.isArray(raw))
        return {
            error: 'invalid options.overrides: expected an array of {id, title?, titleKeywords?, summaryClauses?}',
        };
    const overrides = new Map<string, BackfillOverride>();
    for (const entry of raw) {
        const record = asRecord(entry);
        if (!record || typeof record.id !== 'string' || record.id.trim().length === 0) {
            return { error: 'invalid options.overrides: each entry needs a string id' };
        }
        const keywords = record.titleKeywords;
        if (
            keywords !== undefined &&
            (!Array.isArray(keywords) || keywords.some((keyword) => typeof keyword !== 'string'))
        ) {
            return { error: `invalid options.overrides titleKeywords for "${record.id}": expected string[]` };
        }
        const clauses = record.summaryClauses;
        if (
            clauses !== undefined &&
            (!Array.isArray(clauses) || clauses.some((clause) => typeof clause !== 'string'))
        ) {
            return { error: `invalid options.overrides summaryClauses for "${record.id}": expected string[]` };
        }
        if (record.title !== undefined && typeof record.title !== 'string') {
            return { error: `invalid options.overrides title for "${record.id}": expected a string` };
        }
        overrides.set(record.id, {
            id: record.id,
            ...(typeof record.title === 'string' ? { title: record.title } : {}),
            ...(Array.isArray(keywords)
                ? { titleKeywords: keywords.filter((keyword): keyword is string => typeof keyword === 'string') }
                : {}),
            ...(Array.isArray(clauses)
                ? { summaryClauses: clauses.filter((clause): clause is string => typeof clause === 'string') }
                : {}),
        });
    }
    return { overrides };
}

function parseFlags(options: BackfillOptions): { flags: BackfillFlags } | { error: string } {
    const overrides = parseOverrides(options.overrides);
    if ('error' in overrides) return overrides;
    const since = options.since === undefined ? undefined : String(options.since);
    const until = options.until === undefined ? undefined : String(options.until);
    if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return { error: `invalid options.since "${since}": expected YYYY-MM-DD` };
    }
    if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        return { error: `invalid options.until "${until}": expected YYYY-MM-DD` };
    }
    let ids: Set<string> | undefined;
    if (options.ids !== undefined) {
        if (!Array.isArray(options.ids) || options.ids.some((id) => typeof id !== 'string')) {
            return { error: 'invalid options.ids: expected an array of item id strings' };
        }
        ids = new Set(options.ids);
    }
    return {
        flags: {
            apply: flag(options.apply),
            retitle: flag(options.retitle),
            rewriteBody: flag(options.rewriteBody),
            applySlug: flag(options.applySlug),
            ...(since ? { since } : {}),
            ...(until ? { until } : {}),
            ...(ids ? { ids } : {}),
            ...(typeof options.out === 'string' && options.out.length > 0 ? { out: options.out } : {}),
            ...(typeof options.plan === 'string' && options.plan.length > 0 ? { planPath: options.plan } : {}),
            overrides: overrides.overrides,
        },
    };
}

function microfeedOf(item: MicrofeedItem): Record<string, unknown> {
    return asRecord(item._microfeed) ?? {};
}

function durationOf(item: MicrofeedItem): number | undefined {
    const attachments = item.attachments;
    if (!Array.isArray(attachments)) return undefined;
    const first = asRecord(attachments[0]);
    const seconds = first?.duration_in_seconds;
    return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : undefined;
}

function articleUrlOf(html: string): string | undefined {
    const marked = /完整图文版：<a href="([^"]+)"/.exec(html);
    if (marked?.[1]) return marked[1];
    const any = /href="(https?:\/\/[^"]+)"/.exec(html);
    return any?.[1];
}

function inWindow(date: string | undefined, flags: BackfillFlags): boolean {
    if (!flags.since && !flags.until) return true;
    if (!date) return false;
    if (flags.since && date < flags.since) return false;
    if (flags.until && date > flags.until) return false;
    return true;
}

/**
 * One item's minimal patch. SEO uses headline mode even when publish's title mode
 * is `as-is`, so existing RSS titles stay put unless `retitle` is set.
 */
export function planBackfillItem(
    item: MicrofeedItem,
    config: PodcastSeoConfig,
    flags: Pick<BackfillFlags, 'retitle' | 'rewriteBody' | 'applySlug'>,
    override: BackfillOverride | undefined,
): BackfillEntry | { error: string } {
    const id = typeof item.id === 'string' ? item.id : '';
    if (id.length === 0) return { error: 'backfill-seo: a feed item is missing id' };
    const currentTitle = typeof item.title === 'string' ? item.title : '';
    const micro = microfeedOf(item);
    const currentSeo = asRecord(micro.seo);
    const currentSeoTitle = typeof currentSeo?.title === 'string' ? currentSeo.title : undefined;
    const currentSeoDescription = typeof currentSeo?.description === 'string' ? currentSeo.description : undefined;
    const currentSeason = positiveInt(micro['itunes:season']);
    const currentEpisode = positiveInt(micro['itunes:episode']);
    const currentSlug = typeof micro.slug === 'string' ? micro.slug : undefined;
    const date = dateFromFeedItem(item);
    const html = typeof item.content_html === 'string' ? item.content_html : '';
    const titles = titlesFromContentHtml(html);
    const clauses =
        override?.summaryClauses ?? titles.map((title) => clauseFromTitle(title)).filter((clause) => clause.length > 0);
    const keywords = override?.titleKeywords ?? titles.filter((title) => title.length > 0);
    const metadata: Record<string, unknown> = {
        ...(date ? { runDate: date } : {}),
        ...(durationOf(item) !== undefined ? { durationSeconds: durationOf(item) } : {}),
        podcast: {
            titleMode: 'headline',
            ...(override?.title ? { title: override.title } : {}),
            ...(keywords.length > 0 ? { titleKeywords: keywords.slice(0, config.titleMaxKeywords) } : {}),
            ...(clauses.length > 0 ? { summaryClauses: clauses } : {}),
        },
    };
    // The backfill op always proposes SEO fields and missing episode numbers.
    // PODCAST_PUB_SEO / SLUG / LINK_FIELD gate new publishes, not this repair.
    const prepared = prepareEpisodeFields(
        {
            title: currentTitle,
            durationSeconds: durationOf(item),
            itunes: {
                ...(currentSeason !== undefined ? { season: currentSeason } : {}),
                ...(currentEpisode !== undefined ? { episode: currentEpisode } : {}),
            },
        },
        metadata,
        {
            ...config,
            seo: true,
            titleMode: 'headline',
            slugMode: 'auto',
            linkField: 'none',
            socialImage: false,
            autoEpisodeNumber: true,
        },
    );
    if (!prepared.ok) return { error: `${id}: ${prepared.error}` };
    const violations: string[] = [];
    if (!date) violations.push('episode date is unknown');
    const patch: MicrofeedItemInput = {};
    const nextMicro: Record<string, unknown> = {};
    if (flags.retitle && prepared.fields.title !== currentTitle) patch.title = prepared.fields.title;
    const seo = prepared.fields.seo;
    if (seo) {
        const seoPatch: SeoBlock = {};
        if (seo.title && seo.title !== currentSeoTitle) seoPatch.title = seo.title;
        if (seo.description && seo.description !== currentSeoDescription) seoPatch.description = seo.description;
        if (seoPatch.title || seoPatch.description) nextMicro.seo = seoPatch;
        if (seo.description && codePointLength(seo.description) < config.descriptionMin) {
            violations.push(
                `seo.description is ${codePointLength(seo.description)} code points, under ${config.descriptionMin}`,
            );
        }
        if (seo.description && /^\s*(\d|#|[-*])/.test(seo.description)) {
            violations.push('seo.description starts with a forbidden character');
        }
    }
    const numbered = prepared.fields.itunes;
    if (numbered?.season !== undefined && currentSeason === undefined) nextMicro['itunes:season'] = numbered.season;
    if (numbered?.episode !== undefined && currentEpisode === undefined) nextMicro['itunes:episode'] = numbered.episode;
    if (flags.applySlug && date) {
        const slug = renderSlug(config.slugPattern, date);
        if (slug.slug && slug.slug !== currentSlug && isValidItemSlug(slug.slug)) nextMicro.slug = slug.slug;
        if (slug.error) violations.push(slug.error);
    }
    if (flags.rewriteBody && html.length > 0 && seo?.description) {
        const summary = summaryParagraphHtml(seo.description, config.showName, articleUrlOf(html), '本期完整文章');
        const rewritten = rewriteEpisodeHtml(html, summary, config.timelineStyle !== 'omit');
        if (rewritten !== html.trim()) patch.content_html = rewritten;
    }
    if (Object.keys(nextMicro).length > 0) patch._microfeed = nextMicro;
    const proposedTitle = typeof patch.title === 'string' ? patch.title : currentTitle;
    const proposedSeo = asRecord(nextMicro.seo);
    return {
        id,
        ...(date ? { date } : {}),
        patch,
        counts: {
            ...(proposedTitle ? { title: codePointLength(proposedTitle) } : {}),
            ...(typeof proposedSeo?.title === 'string' ? { seoTitle: codePointLength(proposedSeo.title) } : {}),
            ...(typeof proposedSeo?.description === 'string'
                ? { seoDescription: codePointLength(proposedSeo.description) }
                : {}),
        },
        violations,
        current: {
            ...(currentTitle ? { title: currentTitle } : {}),
            ...(currentSeoTitle ? { seoTitle: currentSeoTitle } : {}),
            ...(currentSeoDescription ? { seoDescription: currentSeoDescription } : {}),
            ...(currentSeason !== undefined ? { season: currentSeason } : {}),
            ...(currentEpisode !== undefined ? { episode: currentEpisode } : {}),
            ...(currentSlug ? { slug: currentSlug } : {}),
        },
    };
}

function describeEntry(entry: BackfillEntry): string {
    const seo = asRecord(asRecord(entry.patch._microfeed)?.seo);
    const parts = [
        `${entry.id}:`,
        entry.date ? `date ${entry.date}` : 'date unknown',
        `title ${JSON.stringify(entry.current.title ?? '')} → ${JSON.stringify(entry.patch.title ?? entry.current.title ?? '')} (${entry.counts.title ?? 0})`,
        `seo.title ${JSON.stringify(entry.current.seoTitle ?? '')} → ${JSON.stringify(seo?.title ?? entry.current.seoTitle ?? '')} (${entry.counts.seoTitle ?? codePointLength(String(entry.current.seoTitle ?? ''))})`,
        `seo.description (${entry.counts.seoDescription ?? codePointLength(String(entry.current.seoDescription ?? ''))})`,
    ];
    if (entry.violations.length > 0) parts.push(`violations: ${entry.violations.join('; ')}`);
    return parts.join(' | ');
}

async function writePlan(path: string, entries: BackfillEntry[], apply: boolean): Promise<void> {
    await ensureDirForFile(path);
    await writeJsonFile(path, { dryRun: !apply, items: entries });
}

async function loadPlan(path: string): Promise<{ entries: BackfillEntry[] } | { error: string }> {
    try {
        const parsed: unknown = await readJsonFile(path);
        const record = asRecord(parsed);
        const items = record?.items;
        if (!Array.isArray(items)) return { error: `invalid backfill plan ${path}: expected { items: [...] }` };
        const entries: BackfillEntry[] = [];
        for (const item of items) {
            const row = asRecord(item);
            if (!row || typeof row.id !== 'string' || !asRecord(row.patch)) {
                return { error: `invalid backfill plan ${path}: each item needs id and patch` };
            }
            entries.push(row as unknown as BackfillEntry);
        }
        return { entries };
    } catch (error: unknown) {
        return { error: `invalid backfill plan ${path}: ${error instanceof Error ? error.message : String(error)}` };
    }
}

function withoutSlug(micro: Record<string, unknown>): Record<string, unknown> {
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(micro)) {
        if (key !== 'slug') rest[key] = value;
    }
    return rest;
}

async function putPatch(client: MicrofeedClient, entry: BackfillEntry, warnings: string[]): Promise<void> {
    const micro = asRecord(entry.patch._microfeed);
    const slug = typeof micro?.slug === 'string' ? micro.slug : undefined;
    if (!slug || !micro) {
        await client.updateItem(entry.id, entry.patch);
        return;
    }
    try {
        await client.updateItem(entry.id, entry.patch);
    } catch (error: unknown) {
        if (!(error instanceof MicrofeedRequestError) || error.status !== 409) throw error;
        const retry = `${slug}-2`;
        try {
            await client.updateItem(entry.id, { ...entry.patch, _microfeed: { ...micro, slug: retry } });
            warn(`slug "${slug}" for ${entry.id} conflicted (HTTP 409); retried as ${retry}`, warnings);
        } catch (retryError: unknown) {
            if (!(retryError instanceof MicrofeedRequestError) || retryError.status !== 409) throw retryError;
            const rest = withoutSlug(micro);
            if (Object.keys(rest).length === 0) {
                const { _microfeed: _dropped, ...other } = entry.patch;
                if (Object.keys(other).length === 0) {
                    warn(
                        `slug "${slug}" for ${entry.id} conflicted twice (HTTP 409); skipped the slug and no other fields changed`,
                        warnings,
                    );
                    return;
                }
                await client.updateItem(entry.id, other);
            } else {
                await client.updateItem(entry.id, { ...entry.patch, _microfeed: rest });
            }
            warn(
                `slug "${slug}" for ${entry.id} conflicted twice (HTTP 409); applied the patch without a slug`,
                warnings,
            );
        }
    }
}

/** Lists the feed and either prints a plan or PUTs the changed keys. */
export async function runBackfill(
    client: MicrofeedClient,
    options: BackfillOptions,
    config: PodcastSeoConfig,
): Promise<Result> {
    const parsed = parseFlags(options);
    if ('error' in parsed) return fail(parsed.error);
    const flags = parsed.flags;
    const warnings: string[] = [];
    let entries: BackfillEntry[];
    if (flags.apply && flags.planPath) {
        const loaded = await loadPlan(flags.planPath);
        if ('error' in loaded) return fail(loaded.error);
        entries = loaded.entries.filter((entry) => !flags.ids || flags.ids.has(entry.id));
    } else {
        const feed = await client.listItems();
        entries = [];
        for (const item of feed.items ?? []) {
            const id = typeof item.id === 'string' ? item.id : '';
            if (flags.ids && !flags.ids.has(id)) continue;
            const date = dateFromFeedItem(item);
            if (!inWindow(date, flags)) continue;
            const planned = planBackfillItem(item, config, flags, flags.overrides.get(id));
            if ('error' in planned) return fail(planned.error);
            entries.push(planned);
        }
    }
    for (const entry of entries) echo(describeEntry(entry));
    if (flags.out) await writePlan(flags.out, entries, flags.apply);
    if (!flags.apply) {
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            message: `backfill-seo dry-run for ${entries.length} item(s); no writes`,
            metadata: { dryRun: true, items: entries, warnings },
        });
    }
    let written = 0;
    for (const entry of entries) {
        if (Object.keys(entry.patch).length === 0) continue;
        await putPatch(client, entry, warnings);
        written += 1;
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `backfill-seo applied ${written} item(s)`,
        metadata: { dryRun: false, applied: written, items: entries, warnings },
    });
}
