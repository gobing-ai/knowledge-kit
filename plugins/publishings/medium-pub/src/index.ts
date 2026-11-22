import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport, type PublishTransport, type PublishTransportPayload } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { MediumBrowserTransport } from './browser-rail';

export {
    CHANNEL,
    channelConfig,
    DRAFT_URL_RE,
    HOME_URL,
    isAuthenticated,
    LOGIN_URL_RE,
    MediumBrowserTransport,
    SELECTORS,
} from './browser-rail';

/** Medium REST API v1 (integration tokens still post; official docs archived 2023). */
const MEDIUM_API_BASE = 'https://api.medium.com/v1';

/** Per-request timeout (ms) for Medium HTTP calls — Bun's `fetch` has no default deadline (R5). */
const REQUEST_TIMEOUT_MS = 120_000;
const TARGET = 'medium';
const TOKEN_ENV = 'MEDIUM_INTEGRATION_TOKEN';
const STATUS_ENV = 'MEDIUM_PUBLISH_STATUS';

export type MediumPublishStatus = 'draft' | 'unlisted' | 'public';

/** Body posted to `POST /users/{userId}/posts`. */
export interface MediumPostBody {
    title: string;
    contentFormat: 'markdown' | 'html';
    content: string;
    tags: string[];
    publishStatus: MediumPublishStatus;
    canonicalUrl?: string;
    license?: string;
    notifyFollowers: boolean;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function resolveTitle(content: Content): string {
    if (content.title && content.title.trim().length > 0) return content.title.trim();
    const match = content.body.match(/^#\s+(.+)$/m);
    return match?.[1] ? match[1].trim() : 'Untitled Post';
}

function resolveTags(content: Content): string[] {
    const raw: unknown[] = Array.isArray(content.metadata?.tags)
        ? content.metadata.tags
        : Array.isArray(content.metadata?.keywords)
          ? content.metadata.keywords
          : [];
    const tags = raw.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
    return [...new Set(tags)].slice(0, 5);
}

function resolvePublishStatus(content: Content, options?: Record<string, unknown>): MediumPublishStatus {
    const raw = options?.publishStatus ?? content.metadata?.publishStatus ?? process.env[STATUS_ENV];
    if (raw === 'public' || raw === 'unlisted' || raw === 'draft') return raw;
    return 'draft';
}

/**
 * Maps Content into the Medium create-post envelope. Default publishStatus is draft
 * unless the operator confirms live (`public` / `unlisted`).
 */
export function mapContentToMediumPost(content: Content, options?: Record<string, unknown>): MediumPostBody {
    const canonical =
        typeof content.metadata?.canonicalUrl === 'string'
            ? content.metadata.canonicalUrl
            : content.references?.[0]?.url;
    const license = typeof content.metadata?.license === 'string' ? content.metadata.license : undefined;
    return {
        title: resolveTitle(content),
        contentFormat: content.format === 'html' ? 'html' : 'markdown',
        content: content.body,
        tags: resolveTags(content),
        publishStatus: resolvePublishStatus(content, options),
        ...(canonical ? { canonicalUrl: canonical } : {}),
        ...(license ? { license } : {}),
        notifyFollowers: false,
    };
}

/**
 * Token-API transport: GET /me then POST /users/{id}/posts with Bearer integration token.
 */
export class MediumApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const token = process.env[TOKEN_ENV];
        if (!token || token.trim().length === 0) {
            return fail(
                `${TOKEN_ENV} environment variable is required: Medium self-issued integration token (https://medium.com/me/settings)`,
            );
        }

        const body = mapContentToMediumPost(payload.content, payload.options);
        try {
            const meResponse = await fetch(`${MEDIUM_API_BASE}/me`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!meResponse.ok) {
                const errorText = (await meResponse.text()).slice(0, 1000);
                return fail(
                    `Medium API /me failed (HTTP ${meResponse.status} ${meResponse.statusText}): ${errorText.trim() || 'Unknown error'}`,
                );
            }
            const meJson = (await meResponse.json()) as { data?: { id?: unknown } };
            if (typeof meJson.data?.id !== 'string') {
                return fail('Medium API /me response missing data.id');
            }

            const postResponse = await fetch(`${MEDIUM_API_BASE}/users/${meJson.data.id}/posts`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                body: JSON.stringify(body),
            });
            if (!postResponse.ok) {
                const errorText = (await postResponse.text()).slice(0, 1000);
                return fail(
                    `Medium API create-post failed (HTTP ${postResponse.status} ${postResponse.statusText}): ${errorText.trim() || 'Unknown error'}`,
                );
            }
            const postJson = (await postResponse.json()) as {
                data?: { id?: unknown; url?: unknown; publishStatus?: unknown };
            };
            if (typeof postJson.data?.id !== 'string') {
                return fail('Medium API create-post response missing data.id');
            }
            const url = typeof postJson.data.url === 'string' ? postJson.data.url : undefined;
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                id: postJson.data.id,
                url,
                message: `Medium post created as ${body.publishStatus}`,
                metadata: { publishStatus: body.publishStatus },
            });
        } catch (err: unknown) {
            return fail(`Medium transport error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeFileCliTransport();
    }
    const token = process.env[TOKEN_ENV];
    if (token && token.trim().length > 0) {
        return new MediumApiTransport();
    }
    return new MediumBrowserTransport('script');
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') {
        await createNodeFileSystem().ensureDir(outDir);
    }
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

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
        await writePublishResult(outputPath, fail(message));
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
        echoError(`medium-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
