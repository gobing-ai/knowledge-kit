import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { type EpisodeMapping, mapContentToEpisode } from './map';
import { MicrofeedClient, type MicrofeedItemInput, resolveTimeoutMs } from './microfeed-client';

/** Result target name for this plugin. */
const TARGET = 'podcast-pub';

/** Management operations routed via `options.operation` (design D5). */
const OPERATIONS = ['publish', 'list', 'get', 'update', 'delete', 'validate'] as const;
type Operation = (typeof OPERATIONS)[number];

/** Target-specific options carried on the invoke payload. */
interface PodcastPubOptions {
    operation?: unknown;
    itemId?: unknown;
    /** Item input (`apiItemInputSchema` shape) sent by the `update` op / `validate` op. */
    item?: unknown;
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

/** Spreads optional episode fields (image, date, link, itunes) into a microfeed item payload. */
function episodeExtras(episode: EpisodeMapping): MicrofeedItemInput {
    return {
        ...(episode.imageUrl ? { image: episode.imageUrl } : {}),
        ...(episode.datePublishedMs !== undefined ? { date_published_ms: episode.datePublishedMs } : {}),
        ...(episode.link ? { url: episode.link } : {}),
        ...{
            _microfeed: {
                'itunes:episodeType': episode.itunes?.episodeType ?? 'full',
                ...(episode.itunes?.title ? { 'itunes:title': episode.itunes.title } : {}),
                ...(episode.itunes?.season !== undefined ? { 'itunes:season': episode.itunes.season } : {}),
                ...(episode.itunes?.episode !== undefined ? { 'itunes:episode': episode.itunes.episode } : {}),
                ...(episode.itunes?.explicit !== undefined ? { 'itunes:explicit': episode.itunes.explicit } : {}),
                ...(episode.itunes?.block !== undefined ? { 'itunes:block': episode.itunes.block } : {}),
            },
        },
    };
}

/**
 * Two-phase publish (design D2, the only legal order): create a draft item →
 * presign with `item_id` → PUT bytes → PUT item with attachment + target status.
 * `metadata.audioUrl` (already hosted) skips the upload steps and creates the
 * published item in a single call.
 */
async function publishEpisode(client: MicrofeedClient, payload: PublishTransportPayload): Promise<Result> {
    let episode: EpisodeMapping;
    try {
        episode = mapContentToEpisode(payload.content);
    } catch (error: unknown) {
        return fail(`Invalid Content: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Caller-supplied uuid per publish attempt (design D3; microfeed makes create
    // idempotent for 24h, so a retry after a lost response cannot duplicate the item).
    const idempotencyKey = crypto.randomUUID();

    if (episode.audio.kind === 'url') {
        const itemId = await client.createItem(
            {
                title: episode.title,
                content_html: episode.contentHtml,
                status: episode.status,
                attachments: [audioAttachment(episode.audio, episode.audio.url, undefined, episode.durationSeconds)],
                ...episodeExtras(episode),
            },
            idempotencyKey,
        );
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            url: client.itemUrl(itemId),
            id: itemId,
            message: 'Published successfully to microfeed (hosted audio, single-call create)',
        });
    }

    // Phase 1: draft item without attachment (audio presign requires item_id).
    const itemId = await client.createItem(
        {
            title: episode.title,
            content_html: episode.contentHtml,
            status: 'unpublished',
        },
        idempotencyKey,
    );

    // Phase 2-3: presign against the draft, then PUT the raw bytes.
    const bytes = new Uint8Array(await readFile(episode.audio.path));
    const prepared = await client.prepareUpload({
        category: 'audio',
        full_local_file_path: episode.audio.path,
        item_id: itemId,
        size: bytes.byteLength,
        type: episode.audio.mimeType,
    });
    await client.uploadBytes(prepared.presignedUrl, bytes, episode.audio.mimeType);

    // Phase 2b: upload a local cover via the presigned image flow (no item_id needed).
    let imageUrl = episode.imageUrl;
    if (episode.imagePath && !imageUrl) {
        const imageBytes = new Uint8Array(await readFile(episode.imagePath));
        const imagePrepared = await client.prepareUpload({
            category: 'image',
            full_local_file_path: episode.imagePath,
            size: imageBytes.byteLength,
            type: 'image/png',
        });
        await client.uploadBytes(imagePrepared.presignedUrl, imageBytes, 'image/png');
        imageUrl = imagePrepared.mediaUrl;
    }

    // Phase 4: attach + publish; the response is the public item (url when live).
    const item = await client.updateItem(itemId, {
        title: episode.title,
        content_html: episode.contentHtml,
        status: episode.status,
        attachments: [audioAttachment(episode.audio, prepared.mediaUrl, bytes.byteLength, episode.durationSeconds)],
        ...(imageUrl ? { image: imageUrl } : {}),
        ...episodeExtras(episode),
    });

    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        url: typeof item.url === 'string' && item.url.length > 0 ? item.url : client.itemUrl(itemId),
        id: itemId,
        message: 'Published successfully to microfeed (two-phase upload + publish)',
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

        const resolved = resolveClient();
        if ('error' in resolved) return fail(resolved.error);
        const { client } = resolved;

        try {
            switch (routed.operation) {
                case 'publish':
                    return await publishEpisode(client, payload);
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
                case 'validate': {
                    // Validate the caller-supplied item input, or the Content-mapped
                    // draft when no explicit input is given (server-side schema check).
                    const input =
                        options.item !== undefined && typeof options.item === 'object' && options.item !== null
                            ? (options.item as MicrofeedItemInput)
                            : (() => {
                                  const episode = mapContentToEpisode(payload.content);
                                  return {
                                      title: episode.title,
                                      content_html: episode.contentHtml,
                                      status: episode.status,
                                  } satisfies MicrofeedItemInput;
                              })();
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
 * Processes input Content and writes output Result via transport.
 *
 * The input JSON may carry a top-level `options` object (`operation`, `itemId`,
 * `item`) alongside the Content fields for management operations; validation
 * failure and transport failure both write a fail-loud Result (ok: false + error)
 * to the output path and reject (spec §2.5).
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
