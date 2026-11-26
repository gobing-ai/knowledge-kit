import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { ThreadsPostBrowserTransport } from './post-rail';

export { ThreadsPostBrowserTransport } from './post-rail';

/** Per-request timeout (ms) for the Threads Graph call — Bun's `fetch` has no default deadline. */
const REQUEST_TIMEOUT_MS = 120_000;

const TARGET = 'threads';
/** Meta's Threads Graph host, version-pinned like the rest of the publish channel plugins. */
export const THREADS_API_BASE = 'https://graph.threads.net/v1.0';
const TOKEN_ENVS = ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'] as const;

/**
 * Threads' own hard limit on a text post: 500 characters. Counted in code points, which is the
 * closest readable match to Meta's "characters"; overlong text is refused, never truncated (R3).
 */
const MAX_TEXT_CHARS = 500;

/** The first http(s) URL in the copy, and the punctuation that ends a sentence rather than a link. */
const FIRST_URL_RE = /https?:\/\/[^\s<>"'`]+/;
const TRAILING_PUNCT_RE = /[),.;:!?，。；：！？）》」』]+$/;

/** Declared operations (ADR-029 dispatch): threads-pub posts text only. */
export const THREADS_OPERATIONS = ['post'] as const;
export type ThreadsOperation = (typeof THREADS_OPERATIONS)[number];

/** Removes every configured credential — raw and percent-encoded — from a message (R4). */
function redact(message: string): string {
    let out = message;
    for (const key of TOKEN_ENVS) {
        const value = process.env[key];
        if (!value || value.trim().length === 0) continue;
        for (const form of new Set([value, encodeURIComponent(value)])) {
            out = out.split(form).join('***');
        }
    }
    return out;
}

/** Every refusal passes through `redact`, so no path can write a token into the Result (R4). */
function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error: redact(error) });
}

/** A bounded, single-line rendering of an operator-supplied value for a refusal message (R5). */
function bounded(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
    return String(value).replace(/\s+/g, ' ').slice(0, 100);
}

/** Bounds a diagnostic detail to one short line, so a Result never carries a stack or a JSON blob. */
function boundedDetail(detail: string): string {
    return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * The deferred surfaces this channel refuses by name before any transport or browser resolves
 * (R5, R11): threads-pub has no browser path, and Threads media needs a public image host.
 */
function refuseUnsupportedOptions(options?: Record<string, unknown>, content?: Content): string | undefined {
    const driver = options?.driver;
    if (driver !== undefined) {
        return `unsupported driver option '${bounded(driver)}' for threads-pub: threads-pub posts text only`;
    }
    const images = options?.images ?? content?.metadata?.images;
    if (images !== undefined) {
        return `unsupported images option (${bounded(images)}) for threads-pub: threads-pub posts text only`;
    }
    return undefined;
}

/**
 * Resolves the requested operation and refuses the deferred options in one place, so the caller
 * can reject a request before any transport — real or fake — is constructed (R5, R11).
 * @param options - Per-call publish options (`operation`, `driver`, `images`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved `post` operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: ThreadsOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    if (typeof raw !== 'string' || !(THREADS_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${String(raw)}' for threads-pub: expected one of ${THREADS_OPERATIONS.join(', ')}`,
        };
    }
    const unsupported = refuseUnsupportedOptions(options, content);
    if (unsupported !== undefined) return { error: unsupported };
    return { operation: raw as ThreadsOperation };
}

/** Payload of a Graph error body; only `error.message` is ever echoed, bounded and redacted (R4). */
interface GraphErrorBody {
    error?: { message?: unknown };
}

/** Bounded Graph `error.message` when the response carries one; never the raw response body (R4). */
async function graphMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as GraphErrorBody;
        const message = body.error?.message;
        if (typeof message === 'string' && message.trim().length > 0) return message.trim().slice(0, 200);
    } catch {
        // A non-JSON error body carries nothing this channel is allowed to echo (R4).
    }
    return response.statusText.trim() || 'no error message';
}

/**
 * Accepts a permalink only when it is an HTTPS Threads URL carrying no token material: a
 * best-effort lookup must never turn an arbitrary Graph string into the Result's `url` (R2).
 */
function acceptPermalink(raw: unknown, token: string): string | undefined {
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return undefined;
    }
    if (url.protocol !== 'https:') return undefined;
    if (!/(^|\.)threads\.(net|com)$/i.test(url.hostname)) return undefined;
    if (token.length > 0 && raw.includes(token)) return undefined;
    return raw;
}

/** A container or publish id, validated as a decimal string before it reaches a URL or Result. */
interface StepId {
    id: string;
}

/**
 * Threads text transport: POST a TEXT container, then POST it to `threads_publish`. No browser, no
 * retry loop, no truncation — every refusal is a `Result` with `ok: false` (R2, R3, R4).
 */
export class ThreadsPostApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    /**
     * Publishes `Content.body` (or `title`) as one Threads text post.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, with the published media id and a best-effort permalink.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const unsupported = refuseUnsupportedOptions(payload.options, payload.content);
        if (unsupported !== undefined) return fail(unsupported);

        // 0330 R2: the post API publishes immediately — there is no draft. Intercept before the
        // credential lookup so a planned draft never reaches Threads, and fail closed on unknown modes.
        const requestedStatus = payload.content.metadata?.publishStatus;
        if (requestedStatus === 'draft') {
            return fail(
                'threads post has no draft: the Threads API publishes immediately — plan this target dummy/off or launch it live',
            );
        }
        if (requestedStatus !== undefined && requestedStatus !== 'public') {
            return fail(`unknown publishStatus '${String(requestedStatus)}' (expected absent, 'draft' or 'public')`);
        }

        const missing = TOKEN_ENVS.filter((key) => {
            const value = process.env[key];
            return !value || value.trim().length === 0;
        });
        if (missing.length > 0) {
            return fail(
                `${missing.join(', ')} environment variable${missing.length > 1 ? 's are' : ' is'} required: Threads Graph API credentials. post does not fall back to a browser.`,
            );
        }

        const text = payload.content.body.trim() || payload.content.title?.trim() || '';
        if (text.length === 0) {
            return fail('threads post requires Content.body or Content.title');
        }
        const length = [...text].length;
        if (length > MAX_TEXT_CHARS) {
            return fail(
                `threads post text is ${length} code points, over the ${MAX_TEXT_CHARS}-character limit: threads-pub never truncates`,
            );
        }

        const token = process.env.THREADS_ACCESS_TOKEN ?? '';
        const userId = process.env.THREADS_USER_ID ?? '';
        // Meta's opt-in card parameter. Passing it makes the preview deterministic: the implicit
        // "first URL in the text becomes the card" rule did not fire for our `…完整节目：<url>` copy
        // (measured 2026-11-25 — Threads stored `link_preview_attachment: null` and rendered a bare
        // link, while the identical text carded on X and the page's og:* tags were crawler-clean).
        const linkUrl = text.match(FIRST_URL_RE)?.[0]?.replace(TRAILING_PUNCT_RE, '');
        const container = await this.postForm('threads container', `${THREADS_API_BASE}/${userId}/threads`, {
            media_type: 'TEXT',
            text,
            access_token: token,
            ...(linkUrl === undefined || linkUrl.length === 0 ? {} : { link_attachment: linkUrl }),
        });
        if ('error' in container) return fail(container.error);

        const published = await this.postForm(
            'threads_publish',
            `${THREADS_API_BASE}/${userId}/threads_publish`,
            { creation_id: container.id, access_token: token },
            ` for container ${container.id}`,
        );
        if ('error' in published) return fail(published.error);

        const permalink = await this.fetchPermalink(token, published.id);
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: published.id,
            ...(permalink === undefined ? {} : { url: permalink }),
            message: 'Posted via the Threads publishing API',
            metadata: { operation: 'post' },
        });
    }

    /** One form-encoded Graph POST; failures name the step, the created container and the status. */
    private async postForm(
        step: string,
        url: string,
        fields: Record<string, string>,
        suffix = '',
    ): Promise<StepId | { error: string }> {
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(fields).toString(),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error: unknown) {
            const detail =
                error instanceof Error && error.name === 'TimeoutError'
                    ? ` (timeout after ${REQUEST_TIMEOUT_MS}ms)`
                    : '';
            return { error: `threads ${step} request failed${suffix}: no HTTP response was received${detail}` };
        }
        if (!response.ok) {
            return {
                error: `threads ${step} request failed (HTTP ${response.status})${suffix}: ${await graphMessage(response)}`,
            };
        }
        let body: unknown;
        try {
            body = await response.json();
        } catch {
            return { error: `threads ${step} response is not valid JSON${suffix}` };
        }
        const id = (body as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) {
            return { error: `threads ${step} response is missing a string id${suffix}` };
        }
        if (!/^\d+$/.test(id)) {
            return { error: `threads ${step} response id '${id}' is not a decimal string${suffix}` };
        }
        return { id };
    }

    /** Best-effort permalink lookup: any failure omits `url` and never flips `ok` (R2). */
    private async fetchPermalink(token: string, id: string): Promise<string | undefined> {
        try {
            const response = await fetch(
                `${THREADS_API_BASE}/${id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
                { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
            );
            if (!response.ok) return undefined;
            const body = (await response.json()) as { permalink?: unknown };
            return acceptPermalink(body.permalink, token);
        } catch {
            return undefined;
        }
    }
}

/**
 * Resolves the channel transport for the configured environment: the fake file-cli transport
 * under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, otherwise the real Threads Graph transport (R6).
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeFileCliTransport();
    // kk bot first (2026-11-16 operator decision): the web composer rides the `threads` profile, so no
    // Graph API credentials are needed. `THREADS_POST_TRANSPORT=api` keeps the official API path.
    return process.env.THREADS_POST_TRANSPORT === 'api'
        ? new ThreadsPostApiTransport()
        : new ThreadsPostBrowserTransport();
}

/** Writes the Result to `--out`, creating its directory when the caller named a nested path. */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * The plugin's `--in/--out` contract: validate the Content, resolve and refuse the operation and
 * deferred options, then publish through the injected or configured transport (R5, R6).
 * @param inputPath - Path to the Content JSON.
 * @param outputPath - Path the Result JSON is written to, on success and on refusal.
 * @param transport - Optional transport injection for tests and offline runs.
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport?: PublishTransport,
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    let content: Content;
    let options: Record<string, unknown> | undefined;
    try {
        const raw = JSON.parse(await createNodeFileSystem().readFile(inputPath)) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
        if (raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null) {
            options = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = redact(
            `Invalid Content input: ${boundedDetail(error instanceof Error ? error.message : String(error))}`,
        );
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(mode.error));
        throw new Error(mode.error);
    }
    const resolved = transport ?? getPublishTransport();
    const result = ResultSchema.parse(await resolved.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

/**
 * CLI entry point: `--in <content.json> --out <result.json>`.
 * @returns Process exit code (0 published, 1 refused or invalid arguments).
 */
export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
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
        echoError(`threads-pub failed: ${redact(error instanceof Error ? error.message : String(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
