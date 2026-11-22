import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { runBackfill } from './backfill';
import {
    type CorrectionDeliveryTarget,
    correctionDeliveryPath,
    type FrozenCorrectionSet,
    planCorrectionDeliveries,
    readCorrectionDeliveries,
    readFrozenCorrections,
    recordCorrectionDeliveries,
    renderCorrectionsBlock,
    writeCorrectionDeliveries,
} from './corrections';
import { type EpisodeMapping, mapContentToEpisode } from './map';
import {
    MicrofeedClient,
    type MicrofeedItem,
    type MicrofeedItemInput,
    MicrofeedRequestError,
    resolveTimeoutMs,
} from './microfeed-client';
import {
    type PreparedEpisodeFields,
    prepareEpisodeFields,
    readImageDimensions,
    resolvePodcastSeoConfig,
    type SeoBlock,
    warn,
} from './seo';
import { renderShowNotesMarkdown, type ShowNotesRenderOptions } from './show-notes';
import {
    applyArticleReceipt,
    articleUrlFromPostPath,
    planCards,
    renderBriefShowNotes,
    renderCardsRegion,
    stripArticlePlaceholderHtml,
    upsertArticleLinkHtml,
} from './show-notes-brief';
import { buildTranscriptSegments, renderWebVtt, resolveTranscriptConfig, transcriptReferences } from './transcript';

/** Result target name for this plugin. */
/**
 * Canonical public page URL from a microfeed item: `_microfeed.web_url` (`/i/{slug}-{id}/` — the
 * deployment's real page shape) wins, then the JSON Feed `url`, then the client's `/items/{id}`
 * fallback (which 404s on some deployments but is the only shape derivable from the id alone).
 */
export function publicItemUrl(item: MicrofeedItem | undefined, itemId: string, client: MicrofeedClient): string {
    const microfeed = item?._microfeed as Record<string, unknown> | undefined;
    const webUrl = typeof microfeed?.web_url === 'string' ? microfeed.web_url : '';
    if (webUrl !== '') return webUrl;
    const feedUrl = typeof item?.url === 'string' ? item.url : '';
    return feedUrl !== '' ? feedUrl : client.itemUrl(itemId);
}

const TARGET = 'podcast-pub';

/** Management operations routed via `options.operation` (design D5). */
const OPERATIONS = [
    'publish',
    'show-notes',
    'list',
    'get',
    'update',
    'delete',
    'validate',
    'backfill-seo',
    'patch-article-link',
] as const;
type Operation = (typeof OPERATIONS)[number];

/** Target-specific options carried on the invoke payload. */
interface PodcastPubOptions {
    operation?: unknown;
    itemId?: unknown;
    /** Item input (`apiItemInputSchema` shape) sent by the `update` op / `validate` op. */
    item?: unknown;
    /** Episode plan Doc[] rendered by the `show-notes` op (transport-level calls carry it here). */
    docs?: unknown;
    /** Show-notes render options; CLI callers may omit these (env fallbacks apply). */
    title?: unknown;
    runDate?: unknown;
    articleBaseUrl?: unknown;
    /** Explicit hosted article URL for `patch-article-link`. */
    articleUrl?: unknown;
    /** Surfdash publish result `metadata.postPath` (briefMode & `patch-article-link` URL source). */
    postPath?: unknown;
    /** Brief/timeline render flag (task 0118). */
    briefMode?: unknown;
    /** Surfdash publish result `metadata.postPath` (briefMode URL source). */
    articlePostPath?: unknown;
    /** Episode-assembly options for the `publish` op (absorb publish-prep's merge; additive). */
    audioFile?: unknown;
    coverPath?: unknown;
    durationSec?: unknown;
    /** `backfill-seo` (R10). Dry-run unless `apply` is true. */
    since?: unknown;
    until?: unknown;
    ids?: unknown;
    out?: unknown;
    plan?: unknown;
    apply?: unknown;
    retitle?: unknown;
    rewriteBody?: unknown;
    applySlug?: unknown;
    overrides?: unknown;
    /**
     * 0396 R2 — the other 0388 targets this episode's correction must reach, as the dispatch ledger
     * sees them (`{target, mode, state, manualStep, blockedBy, lastError, supportsCorrections,
     * capabilityReason}`). Each row yields one delivery record with an exact reason; a row that is
     * manual/blocked/unsupported is recorded as such and never as `delivered`.
     */
    correctionTargets?: unknown;
}

/** Re-reads env each call so tests can set credentials without constructor plumbing (design D4). */
function resolveClient(): { client: MicrofeedClient } | { error: string } {
    const baseUrl = process.env.MICROFEED_BASE_URL;
    const apiKey = process.env.MICROFEED_API_KEY;
    if (!baseUrl || baseUrl.trim().length === 0) {
        return {
            error: 'MICROFEED_BASE_URL environment variable is required: the microfeed instance base URL (e.g. https://<instance>.workers.dev)',
        };
    }
    if (!apiKey || apiKey.trim().length === 0) {
        return {
            error: 'MICROFEED_API_KEY environment variable is required: a microfeed named API key with write scope',
        };
    }
    return {
        client: new MicrofeedClient(baseUrl.trim(), apiKey.trim(), resolveTimeoutMs(process.env.MICROFEED_TIMEOUT_MS)),
    };
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

/**
 * Local-cover MIME by extension. `map.ts` has already rejected anything outside this set (R4), so
 * the fallback is unreachable in practice; it keeps the field non-empty for the type system.
 */
const COVER_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};

/** Parses and routes `options.operation`; unknown or misplaced values fail loud. */
function resolveOperation(options: PodcastPubOptions): { operation: Operation } | { error: string } {
    const raw = options.operation ?? 'publish';
    if (typeof raw !== 'string' || !OPERATIONS.includes(raw as Operation)) {
        return { error: `invalid options.operation "${String(raw)}": expected one of ${OPERATIONS.join(', ')}` };
    }
    return { operation: raw as Operation };
}

/** `options.itemId` is required for the item-scoped operations (design D5). */
function resolveItemId(options: PodcastPubOptions): { itemId: string } | { error: string } {
    const raw = options.itemId;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `options.itemId is required for the "${String(options.operation)}" operation` };
    }
    return { itemId: raw.trim() };
}

/** Options the `show-notes` operation reads on the payload (a subset of {@link PodcastPubOptions}). */
type ShowNotesOpOptions = Pick<
    PodcastPubOptions,
    'docs' | 'title' | 'runDate' | 'articleBaseUrl' | 'briefMode' | 'articlePostPath'
>;

/**
 * Option-then-env resolution for the show-notes render options: `kk executor run`
 * passes only `--in`/`--out`, so workflow callers (task 0097) supply `title` and
 * `runDate` as `PODCAST_PUB_*` environment variables, matching the dailynews-gen
 * env-option convention. Raw values — no trimming — to keep the render byte-stable.
 */
function resolveOptionString(raw: unknown, envKey: string): string | undefined {
    if (typeof raw === 'string' && raw.length > 0) return raw;
    const fromEnv = process.env[envKey];
    return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Resolves `{title, runDate, articleBaseUrl?}`; title and runDate are required. */
function resolveShowNotesRenderOptions(
    options: ShowNotesOpOptions,
): { renderOptions: ShowNotesRenderOptions } | { error: string } {
    const title = resolveOptionString(options.title, 'PODCAST_PUB_TITLE');
    if (title === undefined) {
        return { error: 'options.title (or PODCAST_PUB_TITLE) is required for the "show-notes" operation' };
    }
    const runDate = resolveOptionString(options.runDate, 'PODCAST_PUB_RUN_DATE');
    if (runDate === undefined) {
        return { error: 'options.runDate (or PODCAST_PUB_RUN_DATE) is required for the "show-notes" operation' };
    }
    const articleBaseUrl = resolveOptionString(options.articleBaseUrl, 'PODCAST_PUB_ARTICLE_BASE_URL');
    const briefModeRaw = options.briefMode ?? process.env.PODCAST_PUB_BRIEF_MODE;
    const briefMode = briefModeRaw === true || briefModeRaw === 'true' || briefModeRaw === '1';
    const articlePostPath = resolveOptionString(options.articlePostPath, 'PODCAST_PUB_ARTICLE_POST_PATH');
    const footerNote = resolveOptionString(undefined, 'PODCAST_PUB_FOOTER_NOTE');
    // Audio segment metadata for real timeline offsets: the generated episode content's
    // `metadata.segments[]` (duration + ASR transcription). Absent ⇒ `--:--` offsets.
    let audioSegments: ShowNotesRenderOptions['audioSegments'];
    const audioContentPath = resolveOptionString(undefined, 'PODCAST_PUB_AUDIO_CONTENT');
    if (audioContentPath !== undefined) {
        try {
            const parsed: unknown = JSON.parse(readFileSync(audioContentPath, 'utf-8'));
            const meta = (parsed as { metadata?: unknown })?.metadata as Record<string, unknown> | undefined;
            if (Array.isArray(meta?.segments)) {
                audioSegments = (meta.segments as Array<Record<string, unknown>>).map((s) => ({
                    duration: typeof s.duration === 'number' ? s.duration : undefined,
                    transcription: typeof s.transcription === 'string' ? s.transcription : undefined,
                }));
            }
        } catch {
            // Timeline offsets degrade to proportional — never block show-notes on audio metadata.
        }
    }
    const seoConfig = resolvePodcastSeoConfig(undefined);
    if ('error' in seoConfig) return { error: seoConfig.error };
    const config = seoConfig.config;
    return {
        renderOptions: {
            title,
            runDate,
            ...(articleBaseUrl !== undefined ? { articleBaseUrl } : {}),
            ...(briefMode ? { briefMode: true } : {}),
            ...(articlePostPath !== undefined ? { articlePostPath } : {}),
            ...(footerNote !== undefined ? { footerNote } : {}),
            ...(audioSegments !== undefined ? { audioSegments } : {}),
            summaryParagraph: config.summaryParagraph,
            timelineStyle: config.timelineStyle,
            seriesName: config.seriesName,
            showName: config.showName,
            descriptionMin: config.descriptionMin,
            descriptionMax: config.descriptionMax,
            descriptionSource: config.descriptionSource,
            descriptionPattern: config.descriptionPattern,
        },
    };
}

/**
 * 0396 R1 — the frozen correction projection, read from the snapshot path the stage passes in
 * (`PODCAST_PUB_CORRECTIONS`, 0384's `21-plan/<date>_judgment-snapshot.json`).
 *
 * `null` = the caller configured no corrections for this run (the documented "no frozen judgment"
 * case: no block, no heading). A configured-but-unreadable snapshot is an exact, path-naming error —
 * never a silent "there is no correction", because a swallowed correction is a public error left
 * unacknowledged.
 */
function resolveCorrectionSet(): { set: FrozenCorrectionSet } | { error: string } | null {
    const path = resolveOptionString(undefined, 'PODCAST_PUB_CORRECTIONS');
    if (path === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
        return {
            set: readFrozenCorrections(parsed, {
                runDate: resolveOptionString(undefined, 'PODCAST_PUB_RUN_DATE') ?? null,
            }),
        };
    } catch (error: unknown) {
        return {
            error: `corrections: cannot read the frozen judgment snapshot ${path} (${error instanceof Error ? error.message : String(error)}) — the correction block is NOT carried; fix the snapshot path before publishing`,
        };
    }
}

/**
 * Places the correction block directly under the episode title (the first markdown line), so the
 * acknowledgement is the first thing a reader hears/reads under the episode identity 0385 froze. The
 * block itself carries its own `## 本期更正说明` heading; with no block the markdown is byte-identical.
 */
function insertCorrectionBlock(markdown: string, block: string | null): string {
    if (block === null) return markdown;
    const split = markdown.indexOf('\n');
    if (split === -1) return `${markdown}\n\n${block}`;
    return `${markdown.slice(0, split)}\n\n${block}${markdown.slice(split + 1)}`;
}

/** Validates the plan Doc[] and renders show-notes markdown (pure render; no microfeed call). */
function renderShowNotesFromOptions(
    options: ShowNotesOpOptions,
): { markdown: string; warnings: string[] } | { error: string } {
    const docs = DocListSchema.safeParse(options.docs);
    if (!docs.success) {
        const reason = docs.error.issues[0]?.message ?? 'invalid document list';
        return { error: `options.docs must be an episode plan Doc[] array: ${reason}` };
    }
    const renderOptions = resolveShowNotesRenderOptions(options);
    if ('error' in renderOptions) return { error: renderOptions.error };
    const warnings: string[] = [];
    const corrections = resolveCorrectionSet();
    if (corrections !== null && 'error' in corrections) return { error: corrections.error };
    const block = corrections === null ? null : renderCorrectionsBlock(corrections.set);
    if (corrections !== null) {
        // Malformed/duplicate frozen entries are reported, never silently dropped (R1: an owed
        // correction must be visible in the run log even when the block carries the valid ones).
        for (const diagnostic of corrections.set.diagnostics) {
            warnings.push(`WARN podcast-pub: correction ${diagnostic}`);
        }
    }
    const withCorrections = (markdown: string): string => insertCorrectionBlock(markdown, block);
    const brief = resolveBriefNotes(docs.data, renderOptions.renderOptions, warnings);
    if (brief !== null) return { markdown: withCorrections(brief.markdown), warnings };
    return {
        markdown: withCorrections(renderShowNotesMarkdown(docs.data, renderOptions.renderOptions, warnings)),
        warnings,
    };
}

/**
 * 0386 R1 — the brief notes path: cards, or the explicit no-receipt review mode, switch the render
 * from the legacy layout to the brief/timeline/card renderer ({@link renderBriefShowNotes}). The
 * article link still comes **only** from the publish receipt's `postPath` (never from the title);
 * a missing receipt leaves a text placeholder the notes can be reviewed with. Card problems go to
 * the separate diagnostics file (`PODCAST_PUB_CARDS_DIAGNOSTICS`) and the warning channel, never
 * into the markdown. Returns `null` when this is not a brief-notes render.
 */
function resolveBriefNotes(
    docs: Doc[],
    renderOptions: ShowNotesRenderOptions,
    warnings: string[],
): { markdown: string; warnings: string[] } | null {
    const cardsPath = resolveOptionString(undefined, 'PODCAST_PUB_CARDS');
    const reviewMode = process.env.PODCAST_PUB_BRIEF_WITHOUT_RECEIPT === 'true';
    if (renderOptions.briefMode !== true || (cardsPath === undefined && !reviewMode)) return null;
    let cards: unknown;
    if (cardsPath !== undefined) {
        try {
            cards = JSON.parse(readFileSync(cardsPath, 'utf-8'));
        } catch (error) {
            warnings.push(`WARN podcast-pub: unreadable card manifest ${cardsPath}: ${(error as Error).message}`);
        }
    }
    const rendered = renderBriefShowNotes({
        docs,
        ...(renderOptions.title !== undefined ? { title: renderOptions.title } : {}),
        ...(renderOptions.audioSegments !== undefined ? { audioSegments: renderOptions.audioSegments } : {}),
        ...(cards !== undefined ? { cards } : {}),
    });
    for (const diagnostic of rendered.diagnostics) {
        warnings.push(`WARN podcast-pub: card ${diagnostic.index} ${diagnostic.reason}: ${diagnostic.detail}`);
    }
    const diagnosticsPath = resolveOptionString(undefined, 'PODCAST_PUB_CARDS_DIAGNOSTICS');
    if (diagnosticsPath !== undefined) {
        try {
            writeFileSync(
                diagnosticsPath,
                `${JSON.stringify({ runDate: renderOptions.runDate, cards: rendered.diagnostics }, null, 2)}\n`,
                'utf-8',
            );
        } catch (error) {
            warnings.push(`WARN podcast-pub: cannot write card diagnostics: ${(error as Error).message}`);
        }
    }
    // The receipt's postPath is the only link source; absent ⇒ the placeholder stays (R1).
    const postPath = renderOptions.articlePostPath ?? '';
    const enriched =
        postPath === ''
            ? { markdown: rendered.markdown, enriched: false }
            : applyArticleReceipt(
                  rendered.markdown,
                  { ok: true, target: TARGET, metadata: { postPath } },
                  renderOptions.articleBaseUrl,
              );
    if (postPath === '') {
        warnings.push('WARN podcast-pub: no article receipt yet — notes rendered without an article link');
    }
    const footer = renderOptions.footerNote !== undefined ? `\n${renderOptions.footerNote}\n` : '';
    return { markdown: `${enriched.markdown}${footer}`, warnings };
}

/** Episode-assembly options (R2): present keys make the plugin merge article + audio + cover itself. */
interface AssemblyOptions {
    audioFile?: string;
    coverPath?: string;
    durationSec?: number;
}

/** Resolves the additive assembly options; each key is independent, well-typed, and fails loud. */
function resolveAssemblyOptions(options: PodcastPubOptions): { assembly: AssemblyOptions } | { error: string } {
    const assembly: AssemblyOptions = {};
    if (options.audioFile !== undefined) {
        if (typeof options.audioFile !== 'string' || options.audioFile.trim().length === 0) {
            return { error: 'invalid options.audioFile: expected a nonempty local audio file path' };
        }
        assembly.audioFile = options.audioFile.trim();
    }
    if (options.coverPath !== undefined) {
        if (typeof options.coverPath !== 'string' || options.coverPath.trim().length === 0) {
            return { error: 'invalid options.coverPath: expected a nonempty local cover image path' };
        }
        assembly.coverPath = options.coverPath.trim();
    }
    if (options.durationSec !== undefined) {
        if (
            typeof options.durationSec !== 'number' ||
            !Number.isFinite(options.durationSec) ||
            options.durationSec < 0
        ) {
            return {
                error: `invalid options.durationSec: expected a nonnegative number, got ${String(options.durationSec)}`,
            };
        }
        assembly.durationSec = options.durationSec;
    }
    return { assembly };
}

/**
 * Builds `_microfeed.podcast.transcripts` behind `PODCAST_PUB_TRANSCRIPT` (design
 * docs/design/podcast-transcript.md): builds the WebVTT from `metadata.segments[]` measured
 * absolute offsets and writes it as a local dry-run artifact next to the episode's audio
 * source — transcript files are never uploaded here (microfeed hosts only already-external
 * HTTPS URLs). Inert today: the audio chain records no measured offsets, so this returns
 * undefined and the payload omits `podcast` entirely so a later update cannot erase a stored
 * transcript list.
 */
function prepareTranscript(
    metadata: Record<string, unknown> | undefined,
    warnings: string[],
    emit: (message: string) => void = (message) => warn(message, warnings),
): EpisodeMapping['transcripts'] {
    const config = resolveTranscriptConfig(metadata);
    if ('error' in config) throw new Error(config.error);
    if (!config.config.enabled) return undefined;
    if (!config.config.url) {
        emit('transcript skipped: PODCAST_PUB_TRANSCRIPT is on but no transcriptUrl was provided');
        return undefined;
    }
    const meta = metadata ?? {};
    const segments = Array.isArray(meta.segments)
        ? (meta.segments as Array<Record<string, unknown>>).map((s) => ({
              startSeconds: typeof s.startSeconds === 'number' ? s.startSeconds : undefined,
              endSeconds: typeof s.endSeconds === 'number' ? s.endSeconds : undefined,
              transcription: typeof s.transcription === 'string' ? s.transcription : undefined,
          }))
        : [];
    const cues = buildTranscriptSegments(segments);
    if (!cues) {
        emit(
            'transcript skipped: no measured absolute offsets recorded for every segment (concat does not record startSeconds/endSeconds yet); summed per-clip durations are never used for cue timing',
        );
        return undefined;
    }
    const source = (() => {
        for (const key of ['mp3Path', 'audioPath', 'audioFile'] as const) {
            const value = meta[key];
            if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        }
        return undefined;
    })();
    if (!source) {
        emit('transcript skipped: no local mp3Path/audioPath/audioFile to anchor the .vtt artifact next to');
        return undefined;
    }
    const vttPath = `${join(dirname(source), basename(source).replace(/\.[^.]+$/, ''))}.vtt`;
    try {
        writeFileSync(vttPath, renderWebVtt(cues), 'utf-8');
    } catch (error: unknown) {
        emit(
            `transcript skipped: could not write ${vttPath} (${error instanceof Error ? error.message : String(error)})`,
        );
        return undefined;
    }
    return transcriptReferences(config.config.url);
}

/** Builds the RSS-enclosure attachment from the presigned-upload media URL (design D2). */
function audioAttachment(
    audio: ReturnType<typeof mapContentToEpisode>['audio'],
    mediaUrl: string,
    sizeInBytes?: number,
    durationSeconds?: number,
): MicrofeedItemInput {
    return {
        category: 'audio',
        url: mediaUrl,
        mime_type: audio.mimeType,
        ...(sizeInBytes !== undefined ? { size_in_bytes: sizeInBytes } : {}),
        ...(durationSeconds !== undefined ? { duration_in_seconds: durationSeconds } : {}),
    };
}

/** Spreads optional episode fields (image, date, link, itunes, seo) into a microfeed item payload. */
function episodeExtras(episode: EpisodeMapping, seo?: SeoBlock): MicrofeedItemInput {
    return {
        ...(episode.imageUrl ? { image: episode.imageUrl } : {}),
        ...(episode.datePublishedMs !== undefined ? { date_published_ms: episode.datePublishedMs } : {}),
        ...(episode.link ? { url: episode.link } : {}),
        _microfeed: {
            ...(episode.transcripts ? { podcast: { transcripts: episode.transcripts } } : {}),
            'itunes:episodeType': episode.itunes?.episodeType ?? 'full',
            ...(episode.itunes?.title ? { 'itunes:title': episode.itunes.title } : {}),
            ...(episode.itunes?.season !== undefined ? { 'itunes:season': episode.itunes.season } : {}),
            ...(episode.itunes?.episode !== undefined ? { 'itunes:episode': episode.itunes.episode } : {}),
            ...(episode.itunes?.explicit !== undefined ? { 'itunes:explicit': episode.itunes.explicit } : {}),
            ...(episode.itunes?.block !== undefined ? { 'itunes:block': episode.itunes.block } : {}),
            ...(seo ? { seo } : {}),
        },
    };
}

function shapedEpisode(episode: EpisodeMapping, fields: PreparedEpisodeFields): EpisodeMapping {
    return {
        ...episode,
        title: fields.title,
        ...(fields.itunes ? { itunes: fields.itunes } : {}),
        ...(fields.durationSeconds !== undefined
            ? { durationSeconds: fields.durationSeconds }
            : { durationSeconds: undefined }),
        link: fields.link,
    };
}

/**
 * Canonical JSON for the create request fingerprint. The API's idempotency window is only 24h,
 * so the key must be stable across a process restart while remaining different for a changed body.
 * Object-key ordering is normalized because callers build the same logical payload in more than
 * one branch (hosted audio and the draft half of local-audio publishing).
 */
function canonicalJson(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(String(value));
}

/** RFC 4122 UUIDv5-shaped key; microfeed validates Idempotency-Key as a UUID. */
function deterministicUuid(name: string): string {
    // The URL namespace is only a stable namespace marker; the payload remains the name input.
    const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
    const digest = createHash('sha1').update(namespace).update(name, 'utf8').digest();
    digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
    digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
    const hex = digest.subarray(0, 16).toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derives the caller-supplied create key from the exact request body and its primary media.
 * Local audio uses content identity rather than its temporary path, so a resumed run can replay
 * the same draft even when the workspace path changes.
 */
function createItemIdempotencyKey(body: MicrofeedItemInput, mediaIdentity: string): string {
    return deterministicUuid(canonicalJson({ mediaIdentity, payload: body }));
}

/** First createItem carries the slug. A 409 retries once as `{slug}-2`, then publishes with no slug. */
async function createEpisodeItem(
    client: MicrofeedClient,
    body: MicrofeedItemInput,
    slug: string | undefined,
    warnings: string[],
    mediaIdentity: string,
): Promise<string> {
    const create = (input: MicrofeedItemInput): Promise<string> =>
        client.createItem(input, createItemIdempotencyKey(input, mediaIdentity));
    const withSlug = (itemSlug: string): MicrofeedItemInput => {
        const micro = (body._microfeed as Record<string, unknown> | undefined) ?? {};
        return { ...body, _microfeed: { ...micro, slug: itemSlug } };
    };
    if (!slug) return create(body);
    try {
        return await create(withSlug(slug));
    } catch (error: unknown) {
        if (!(error instanceof MicrofeedRequestError) || error.status !== 409) throw error;
        const retry = `${slug}-2`;
        try {
            return await create(withSlug(retry));
        } catch (retryError: unknown) {
            if (!(retryError instanceof MicrofeedRequestError) || retryError.status !== 409) throw retryError;
            warn(`slug "${slug}" conflicted (HTTP 409); publishing without a custom slug`, warnings);
            return create(body);
        }
    }
}

/** Uploads a local 1200×630 image, or checks a remote one. A bad size skips the image and the publish continues. */
async function resolveSocialImage(
    client: MicrofeedClient,
    fields: PreparedEpisodeFields,
    warnings: string[],
): Promise<NonNullable<SeoBlock['social_image']> | undefined> {
    if (!fields.socialAlt) return undefined;
    if (fields.socialLocalPath && fields.socialMime) {
        const bytes = new Uint8Array(await readFile(fields.socialLocalPath));
        const prepared = await client.prepareUpload({
            category: 'image',
            full_local_file_path: basename(fields.socialLocalPath),
            size: bytes.byteLength,
            type: fields.socialMime,
        });
        await client.uploadBytes(prepared.presignedUrl, bytes, fields.socialMime);
        return {
            url: prepared.mediaUrl,
            width: 1200,
            height: 630,
            mime_type: fields.socialMime,
            alt: fields.socialAlt,
        };
    }
    if (!fields.socialRemoteUrl) return undefined;
    let bytes: Uint8Array;
    try {
        const response = await fetch(fields.socialRemoteUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error: unknown) {
        warn(
            `social image skipped: could not read ${fields.socialRemoteUrl} (${error instanceof Error ? error.message : String(error)})`,
            warnings,
        );
        return undefined;
    }
    const dims = readImageDimensions(bytes);
    if (dims?.width !== 1200 || dims?.height !== 630) {
        warn(
            `social image skipped: expected a 1200×630 PNG or JPEG, got ${dims ? `${dims.width}×${dims.height}` : 'an unreadable file'}`,
            warnings,
        );
        return undefined;
    }
    return {
        url: fields.socialRemoteUrl,
        width: 1200,
        height: 630,
        mime_type: dims.mime,
        alt: fields.socialAlt,
    };
}

function mergeSocial(
    seo: SeoBlock | undefined,
    social: NonNullable<SeoBlock['social_image']> | undefined,
): SeoBlock | undefined {
    if (!social) return seo;
    return { ...(seo ?? {}), social_image: social };
}

/** Item body for `validate` when the caller did not pass `options.item`. Throws on a bad episode. */
function mappedValidateInput(content: Content): MicrofeedItemInput {
    const seoConfig = resolvePodcastSeoConfig(content.metadata);
    if ('error' in seoConfig) throw new Error(seoConfig.error);
    const episode = mapContentToEpisode(content);
    const policy = prepareEpisodeFields(episode, content.metadata ?? {}, seoConfig.config);
    if (!policy.ok) throw new Error(policy.error);
    const shaped = shapedEpisode(episode, policy.fields);
    return {
        title: shaped.title,
        content_html: shaped.contentHtml,
        status: shaped.status,
        ...episodeExtras(shaped, policy.fields.seo),
    };
}

/** Untrusted `options.correctionTargets` rows → the classifier's target shape (unknown keys dropped). */
function readCorrectionTargets(raw: unknown): CorrectionDeliveryTarget[] {
    if (!Array.isArray(raw)) return [];
    const targets: CorrectionDeliveryTarget[] = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const target = typeof row.target === 'string' ? row.target.trim() : '';
        if (target === '') continue;
        const blockedBy = Array.isArray(row.blockedBy) ? row.blockedBy.filter((id) => typeof id === 'string') : [];
        targets.push({
            target,
            ...(typeof row.mode === 'string' ? { mode: row.mode } : {}),
            ...(typeof row.state === 'string' ? { state: row.state } : {}),
            ...(typeof row.manualStep === 'string' ? { manualStep: row.manualStep } : {}),
            ...(typeof row.lastError === 'string' ? { lastError: row.lastError } : {}),
            ...(blockedBy.length > 0 ? { blockedBy: blockedBy as string[] } : {}),
            // Absent capability facts mean "unknown" and are treated as unsupported on purpose: a
            // correction is never recorded as delivered to a target whose surface we cannot name.
            supportsCorrections: row.supportsCorrections === true,
            ...(typeof row.capabilityReason === 'string' ? { capabilityReason: row.capabilityReason } : {}),
            ...(typeof row.deliveryEvidence === 'string' ? { deliveryEvidence: row.deliveryEvidence } : {}),
        });
    }
    return targets;
}

/**
 * 0396 R1/R2 — record where this episode's correction was delivered.
 *
 * The podcast target is classified from the publish that just happened (`dispatched` when the item
 * went live, `pending` while it is a draft), the other targets from the 0388 dispatch rows the stage
 * forwards. The ledger lands at `PODCAST_PUB_CORRECTION_DELIVERY` (defaulted by the stage to
 * `31-publish/<date>_16_corrections-delivery.json`); every non-delivered row prints its EXACT
 * target-level reason into the warning channel instead of being folded into a generic failure.
 * Returns the delivered rows for the publish result's metadata.
 */
async function recordCorrectionDelivery(
    options: PodcastPubOptions,
    episodeStatus: string,
    delivery: { itemId?: string; url?: string },
    warnings: string[],
): Promise<{ correctionIds: string[]; delivered: string[] } | null> {
    const corrections = resolveCorrectionSet();
    if (corrections === null || 'error' in corrections) {
        if (corrections !== null && 'error' in corrections) warnings.push(`WARN podcast-pub: ${corrections.error}`);
        return null;
    }
    if (corrections.set.corrections.length === 0) return null;
    const runDate = corrections.set.runDate;
    const path = resolveOptionString(undefined, 'PODCAST_PUB_CORRECTION_DELIVERY');
    const targets: CorrectionDeliveryTarget[] = [
        {
            target: TARGET,
            state: episodeStatus === 'published' ? 'dispatched' : 'pending',
            supportsCorrections: true,
        },
        ...readCorrectionTargets(options.correctionTargets),
    ];
    const ledgerPath = path ?? (runDate === null ? undefined : correctionDeliveryPath(process.cwd(), runDate));
    const ledger = ledgerPath === undefined ? null : await readCorrectionDeliveries(ledgerPath, runDate);
    const planned = planCorrectionDeliveries(corrections.set, targets, {
        runDate,
        prior: ledger?.deliveries ?? [],
    }).map((entry) =>
        // The published item is the traceable address of a delivery to this target.
        entry.state === 'delivered' && entry.target === TARGET
            ? {
                  ...entry,
                  ...(delivery.itemId === undefined ? {} : { itemId: delivery.itemId }),
                  ...(delivery.url === undefined ? {} : { url: delivery.url }),
              }
            : entry,
    );
    for (const entry of planned) {
        if (entry.state === 'delivered') continue;
        warnings.push(
            `WARN podcast-pub: correction ${entry.correctionId} not delivered to target "${entry.target}" — ${entry.reason}`,
        );
    }
    if (ledger !== null && ledgerPath !== undefined) {
        const { ledger: next, skipped } = recordCorrectionDeliveries(ledger, planned);
        await writeCorrectionDeliveries(ledgerPath, next);
        for (const entry of skipped) {
            warnings.push(
                `WARN podcast-pub: correction ${entry.correctionId} already delivered to target "${entry.target}" — not re-sent`,
            );
        }
    }
    return {
        correctionIds: corrections.set.corrections.map((entry) => entry.correctionId),
        delivered: planned.filter((entry) => entry.state === 'delivered').map((entry) => entry.target),
    };
}

/**
 * Uploads rendered local card PNGs to microfeed R2 and rewrites `<!--kk:cards-->` with their
 * hosted HTTPS URLs before show-notes HTML renders. Per-card failures degrade to text captions +
 * a warning without aborting episode publish.
 */
async function hydrateShowNotesCards(client: MicrofeedClient, content: Content, warnings: string[]): Promise<Content> {
    const metadata = content.metadata ?? {};
    const podcastMeta =
        metadata.podcast !== null && typeof metadata.podcast === 'object' && !Array.isArray(metadata.podcast)
            ? (metadata.podcast as Record<string, unknown>)
            : undefined;
    const rawCards = podcastMeta?.cards ?? metadata.cards;
    if (rawCards === undefined) return content;

    const showNotes = typeof metadata.showNotes === 'string' ? metadata.showNotes : '';
    const usesShowNotes = showNotes.includes('<!--kk:cards-->');
    const sourceMarkdown = usesShowNotes ? showNotes : content.body;
    if (!sourceMarkdown.includes('<!--kk:cards-->')) return content;

    const { cards } = planCards(rawCards);
    if (cards.length === 0) return content;

    let uploadedAny = false;
    const hydrated = await Promise.all(
        cards.map(async (card) => {
            if (card.imageUrl !== '' || !card.imagePath) return card;
            const ext = extname(card.imagePath).toLowerCase();
            const mime = COVER_MIME[ext];
            if (!mime) {
                warn(`card ${card.index} upload skipped: unsupported extension "${ext}"`, warnings);
                return card;
            }
            try {
                const bytes = new Uint8Array(await readFile(card.imagePath));
                const prepared = await client.prepareUpload({
                    category: 'image',
                    full_local_file_path: basename(card.imagePath),
                    size: bytes.byteLength,
                    type: mime,
                });
                await client.uploadBytes(prepared.presignedUrl, bytes, mime);
                uploadedAny = true;
                return { ...card, imageUrl: prepared.mediaUrl };
            } catch (error: unknown) {
                warn(
                    `card ${card.index} upload failed (${error instanceof Error ? error.message : String(error)}); keeping text caption`,
                    warnings,
                );
                return card;
            }
        }),
    );
    if (!uploadedAny) return content;

    const region = renderCardsRegion(hydrated);
    const updatedMarkdown = sourceMarkdown.replace(/<!--kk:cards-->[\s\S]*?<!--\/kk:cards-->/, () => region);
    if (usesShowNotes) {
        return {
            ...content,
            metadata: {
                ...metadata,
                showNotes: updatedMarkdown,
            },
        };
    }
    return {
        ...content,
        body: updatedMarkdown,
    };
}

/**
 * Patches the published `完整图文版` link onto an existing microfeed episode item idempotently.
 */
async function patchArticleLink(client: MicrofeedClient, options: PodcastPubOptions): Promise<Result> {
    const itemId = resolveItemId(options);
    if ('error' in itemId) return fail(itemId.error);
    const baseUrl =
        typeof options.articleBaseUrl === 'string' && options.articleBaseUrl.trim() !== ''
            ? options.articleBaseUrl.trim()
            : 'https://surfing.salty.vip';
    const explicitUrl = typeof options.articleUrl === 'string' ? options.articleUrl.trim() : '';
    const postPath =
        typeof options.articlePostPath === 'string' && options.articlePostPath.trim() !== ''
            ? options.articlePostPath.trim()
            : typeof options.postPath === 'string'
              ? options.postPath.trim()
              : '';
    const articleUrl = /^https?:\/\//i.test(explicitUrl)
        ? explicitUrl
        : postPath !== ''
          ? articleUrlFromPostPath(postPath, baseUrl)
          : '';
    if (!/^https?:\/\//i.test(articleUrl)) {
        return fail('options.articleUrl or options.postPath is required for the "patch-article-link" operation');
    }
    const feed = await client.getItem(itemId.itemId);
    const item = feed.items?.[0];
    if (!item) return fail(`microfeed item "${itemId.itemId}" not found in the feed response`);
    const currentHtml = typeof item.content_html === 'string' ? item.content_html : '';
    const patched = upsertArticleLinkHtml(currentHtml, articleUrl);
    let updatedItem = item;
    if (patched.changed) {
        updatedItem = await client.updateItem(itemId.itemId, { content_html: patched.html });
    }
    const itemUrl = publicItemUrl(updatedItem, itemId.itemId, client);
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        id: itemId.itemId,
        url: itemUrl,
        message: patched.changed
            ? `Patched article link into microfeed item ${itemId.itemId}`
            : `Article link already present on microfeed item ${itemId.itemId}`,
        metadata: {
            changed: patched.changed,
            articleUrl,
        },
    });
}

/**
 * Two-phase publish (design D2, the only legal order): create a draft item →
 * presign with `item_id` → PUT bytes → PUT item with attachment + target status.
 * `metadata.audioUrl` (already hosted) skips the upload steps and creates the
 * published item in a single call.
 */
async function publishEpisode(
    client: MicrofeedClient,
    payload: PublishTransportPayload,
    options: PodcastPubOptions,
): Promise<Result> {
    const assembly = resolveAssemblyOptions(options);
    if ('error' in assembly) return fail(assembly.error);

    // Assembly options are additive (L1 R6): present keys make the plugin own that channel
    // (publish-prep's merge absorbed — options.audioFile retires metadata.audioUrl so the
    // map.ts ambiguity guard is not tripped); absent keys leave the existing
    // Content→episode mapping (map.ts) as the fallback, unchanged.
    const { audioFile, coverPath, durationSec } = assembly.assembly;
    const rawContent: Content =
        audioFile !== undefined || coverPath !== undefined || durationSec !== undefined
            ? {
                  ...payload.content,
                  metadata: {
                      ...payload.content.metadata,
                      ...(audioFile !== undefined ? { audioFile, audioUrl: undefined } : {}),
                      ...(coverPath !== undefined ? { coverImage: coverPath } : {}),
                      ...(durationSec !== undefined ? { durationSeconds: durationSec } : {}),
                  },
              }
            : payload.content;

    const cardWarnings: string[] = [];
    const content = await hydrateShowNotesCards(client, rawContent, cardWarnings);

    let episode: EpisodeMapping;
    try {
        episode = mapContentToEpisode(content);
    } catch (error: unknown) {
        return fail(`Invalid Content: ${error instanceof Error ? error.message : String(error)}`);
    }

    const seoConfig = resolvePodcastSeoConfig(content.metadata);
    if ('error' in seoConfig) return fail(seoConfig.error);
    const policy = prepareEpisodeFields(episode, content.metadata ?? {}, seoConfig.config);
    if (!policy.ok) return fail(policy.error);
    const fields = policy.fields;
    if (cardWarnings.length > 0) fields.warnings.push(...cardWarnings);
    // Transcript (PODCAST_PUB_TRANSCRIPT): built and written to disk before any create call so
    // the `_microfeed` payload in both create branches carries the same field when it exists.
    try {
        episode.transcripts = prepareTranscript(content.metadata, fields.warnings);
    } catch (error: unknown) {
        return fail(`Invalid transcript config: ${error instanceof Error ? error.message : String(error)}`);
    }

    let social: NonNullable<SeoBlock['social_image']> | undefined;
    try {
        social = await resolveSocialImage(client, fields, fields.warnings);
    } catch (error: unknown) {
        return fail(error instanceof Error ? error.message : String(error));
    }
    const seo = mergeSocial(fields.seo, social);
    episode = shapedEpisode(episode, fields);
    // Never ship the pre-publish placeholder literal to public listeners on microfeed.
    episode.contentHtml = stripArticlePlaceholderHtml(episode.contentHtml);

    let localAudioBytes: Uint8Array | undefined;
    let mediaIdentity: string;
    if (episode.audio.kind === 'url') {
        mediaIdentity = `audio-url:${episode.audio.url}\0${episode.audio.mimeType}`;
    } else {
        localAudioBytes = new Uint8Array(await readFile(episode.audio.path));
        mediaIdentity = `audio-file-sha256:${createHash('sha256').update(localAudioBytes).digest('hex')}\0${episode.audio.mimeType}`;
    }

    if (episode.audio.kind === 'url') {
        const itemId = await createEpisodeItem(
            client,
            {
                title: episode.title,
                content_html: episode.contentHtml,
                status: episode.status,
                attachments: [audioAttachment(episode.audio, episode.audio.url, undefined, episode.durationSeconds)],
                ...episodeExtras(episode, seo),
            },
            fields.slug,
            fields.warnings,
            mediaIdentity,
        );
        // Best-effort canonical-URL enrichment: the episode is already published, so a failed
        // follow-up GET (or an unparsable response) falls back to publicItemUrl's own chain.
        let hostedItem: MicrofeedItem | undefined;
        try {
            hostedItem = (await client.getItem(itemId)).items?.[0];
        } catch {
            hostedItem = undefined;
        }
        const hostedUrl = publicItemUrl(hostedItem, itemId, client);
        const corrections = await recordCorrectionDelivery(
            options,
            String(episode.status),
            { itemId, url: hostedUrl },
            fields.warnings,
        );
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            url: hostedUrl,
            id: itemId,
            message: 'Published successfully to microfeed (hosted audio, single-call create)',
            ...(fields.warnings.length > 0 || corrections !== null
                ? {
                      metadata: {
                          ...(corrections !== null ? { corrections } : {}),
                          ...(fields.warnings.length > 0 ? { warnings: fields.warnings } : {}),
                      },
                  }
                : {}),
        });
    }

    // Phase 1: draft item without attachment (audio presign requires item_id).
    // The slug is sent only here — a later update would move an existing URL.
    const itemId = await createEpisodeItem(
        client,
        {
            title: episode.title,
            content_html: episode.contentHtml,
            status: 'unpublished',
        },
        fields.slug,
        fields.warnings,
        mediaIdentity,
    );

    // Phase 2-3: presign against the draft, then PUT the raw bytes.
    // The bytes were read before create so their digest can make a resumed create idempotent.
    const bytes = localAudioBytes;
    if (!bytes) return fail('local audio identity was not prepared before item creation');
    const prepared = await client.prepareUpload({
        category: 'audio',
        full_local_file_path: episode.audio.path,
        item_id: itemId,
        size: bytes.byteLength,
        type: episode.audio.mimeType,
    });
    await client.uploadBytes(prepared.presignedUrl, bytes, episode.audio.mimeType);

    // Phase 2b: upload a local cover via the presigned image flow (no item_id needed). Only the
    // basename is sent as `full_local_file_path`, and the MIME follows the real extension rather
    // than assuming PNG (R4).
    let imageUrl = episode.imageUrl;
    if (episode.imagePath && !imageUrl) {
        const imageMime = COVER_MIME[extname(episode.imagePath).toLowerCase()] ?? 'image/png';
        const imageBytes = new Uint8Array(await readFile(episode.imagePath));
        const imagePrepared = await client.prepareUpload({
            category: 'image',
            full_local_file_path: basename(episode.imagePath),
            size: imageBytes.byteLength,
            type: imageMime,
        });
        await client.uploadBytes(imagePrepared.presignedUrl, imageBytes, imageMime);
        imageUrl = imagePrepared.mediaUrl;
    }

    // Phase 4: attach + publish; the response is the public item (url when live).
    const item = await client.updateItem(itemId, {
        title: episode.title,
        content_html: episode.contentHtml,
        status: episode.status,
        attachments: [audioAttachment(episode.audio, prepared.mediaUrl, bytes.byteLength, episode.durationSeconds)],
        ...(imageUrl ? { image: imageUrl } : {}),
        ...episodeExtras(episode, seo),
    });

    const publishedUrl = publicItemUrl(item, itemId, client);
    const corrections = await recordCorrectionDelivery(
        options,
        String(episode.status),
        { itemId, url: publishedUrl },
        fields.warnings,
    );
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        url: publishedUrl,
        id: itemId,
        message: 'Published successfully to microfeed (two-phase upload + publish)',
        // 20260917 review #6: downstream surfdash patch reuses the podcast-hosted cover URL
        // (no re-upload); null when the episode carried no local cover.
        metadata: {
            itemId,
            imageUrl: imageUrl ?? null,
            ...(corrections !== null ? { corrections } : {}),
            ...(fields.warnings.length > 0 ? { warnings: fields.warnings } : {}),
        },
    });
}

/**
 * Token-API transport for a self-hosted microfeed instance (design D1):
 * publishes podcast episodes over `/api/v1/` with Bearer auth and routes thin
 * management operations via `options.operation` (design D5).
 */
export class PodcastPubTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const options: PodcastPubOptions =
            payload.options !== undefined && typeof payload.options === 'object' && payload.options !== null
                ? (payload.options as PodcastPubOptions)
                : {};

        const routed = resolveOperation(options);
        if ('error' in routed) return fail(routed.error);

        // Pure render: no microfeed client (hence no credentials) and no API call (design L1 R6).
        if (routed.operation === 'show-notes') {
            const rendered = renderShowNotesFromOptions(options);
            if ('error' in rendered) return fail(rendered.error);
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                message: 'Rendered show notes markdown (pure render; no microfeed API call)',
                metadata: {
                    markdown: rendered.markdown,
                    ...(rendered.warnings.length > 0 ? { warnings: rendered.warnings } : {}),
                },
            });
        }

        const resolved = resolveClient();
        if ('error' in resolved) return fail(resolved.error);
        const { client } = resolved;

        try {
            switch (routed.operation) {
                case 'publish':
                    return await publishEpisode(client, payload, options);
                case 'list': {
                    const feed = await client.listItems();
                    return ResultSchema.parse({
                        ok: true,
                        target: TARGET,
                        url: typeof feed.feed_url === 'string' ? feed.feed_url : undefined,
                        message: `Listed ${feed.items?.length ?? 0} microfeed item(s)`,
                        metadata: { items: feed.items ?? [] },
                    });
                }
                case 'get': {
                    const itemId = resolveItemId(options);
                    if ('error' in itemId) return fail(itemId.error);
                    const feed = await client.getItem(itemId.itemId);
                    const item = feed.items?.[0];
                    if (!item) return fail(`microfeed item "${itemId.itemId}" not found in the feed response`);
                    return ResultSchema.parse({
                        ok: true,
                        target: TARGET,
                        id: itemId.itemId,
                        url: typeof item.url === 'string' ? item.url : undefined,
                        message: `Fetched microfeed item ${itemId.itemId}`,
                        metadata: { item },
                    });
                }
                case 'update': {
                    const itemId = resolveItemId(options);
                    if ('error' in itemId) return fail(itemId.error);
                    if (options.item === undefined || typeof options.item !== 'object' || options.item === null) {
                        return fail('options.item (microfeed item input object) is required for the update operation');
                    }
                    const item = await client.updateItem(itemId.itemId, options.item as MicrofeedItemInput);
                    return ResultSchema.parse({
                        ok: true,
                        target: TARGET,
                        id: itemId.itemId,
                        url: typeof item.url === 'string' ? item.url : undefined,
                        message: `Updated microfeed item ${itemId.itemId}`,
                        metadata: { item },
                    });
                }
                case 'delete': {
                    const itemId = resolveItemId(options);
                    if ('error' in itemId) return fail(itemId.error);
                    await client.deleteItem(itemId.itemId);
                    return ResultSchema.parse({
                        ok: true,
                        target: TARGET,
                        id: itemId.itemId,
                        message: `Deleted microfeed item ${itemId.itemId}`,
                    });
                }
                case 'backfill-seo': {
                    const config = resolvePodcastSeoConfig(payload.content.metadata);
                    if ('error' in config) return fail(config.error);
                    return await runBackfill(client, options, config.config);
                }
                case 'patch-article-link':
                    return await patchArticleLink(client, options);
                case 'validate': {
                    // Validate the caller-supplied item input, or the Content-mapped
                    // draft when no explicit input is given (server-side schema check).
                    const input =
                        options.item !== undefined && typeof options.item === 'object' && options.item !== null
                            ? (options.item as MicrofeedItemInput)
                            : mappedValidateInput(payload.content);
                    await client.validateItem(input);
                    return ResultSchema.parse({
                        ok: true,
                        target: TARGET,
                        message: 'microfeed accepted the item input (POST /api/v1/items/validate)',
                    });
                }
            }
        } catch (error: unknown) {
            return fail(`${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/** Resolves the default PublishTransport based on environment configuration. */
export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeFileCliTransport();
    }
    return new PodcastPubTransport();
}

/** Writes a Result JSON to the output path, creating the directory as needed. */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * Show-notes operation IO: `--in` is the episode plan Doc[], `--out` the markdown
 * file (pure render — no Content, no transport call). Render options come from the
 * `PODCAST_PUB_*` environment variables. Failure writes a fail-loud Result to the
 * output path and rejects, matching the Content path.
 */
async function renderShowNotesIO(docs: unknown[], outputPath: string): Promise<void> {
    const rendered = renderShowNotesFromOptions({ docs });
    if ('error' in rendered) {
        const message = `show-notes render failed: ${rendered.error}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    await createNodeFileSystem().writeFile(outputPath, rendered.markdown);
}

/**
 * Processes input Content and writes output Result via transport.
 *
 * A bare JSON array input selects the `show-notes` operation: `--in` is the
 * episode plan Doc[] and `--out` receives the markdown file itself.
 *
 * The input JSON may otherwise carry a top-level `options` object (`operation`,
 * `itemId`, `item`) alongside the Content fields for management operations;
 * validation failure and transport failure both write a fail-loud Result
 * (ok: false + error) to the output path and reject (spec §2.5).
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);

    let content: Content;
    let options: Record<string, unknown> | undefined;
    try {
        const rawInput = await createNodeFileSystem().readFile(inputPath);
        const raw = JSON.parse(rawInput) as Record<string, unknown>;
        if (Array.isArray(raw)) {
            await renderShowNotesIO(raw, outputPath);
            return;
        }
        content = ContentSchema.parse(raw);
        if (raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null) {
            options = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, ResultSchema.parse({ ok: false, target: TARGET, error: message }));
        throw new Error(message);
    }

    const result = await transport.publish({ content, options });
    const validatedResult = ResultSchema.parse(result);
    await writePublishResult(outputPath, validatedResult);

    if (!validatedResult.ok) {
        throw new Error(validatedResult.error ?? 'Publish failed');
    }
}

export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({
            options: {
                in: { type: 'string' },
                out: { type: 'string' },
            },
        }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }

    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`podcast-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
