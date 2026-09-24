import { createHmac, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    FakeBrowserTransport,
    FakeFileCliTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
} from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/** Per-request timeout (ms) for the X API call — Bun's `fetch` has no default deadline (R5). */
const REQUEST_TIMEOUT_MS = 120_000;

const TARGET = 'x';
const TWEETS_URL = 'https://api.twitter.com/2/tweets';
const TOKEN_ENVS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function percentEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a user-context header for POST /2/tweets (JSON body is not signed). */
export function oauth1Header(opts: {
    method: string;
    url: string;
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
    nonce?: string;
    timestamp?: string;
}): string {
    const nonce = opts.nonce ?? randomBytes(16).toString('hex');
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
    const params: Record<string, string> = {
        oauth_consumer_key: opts.consumerKey,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_token: opts.token,
        oauth_version: '1.0',
    };
    const baseParams = Object.keys(params)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? '')}`)
        .join('&');
    const base = [opts.method.toUpperCase(), percentEncode(opts.url), percentEncode(baseParams)].join('&');
    const signingKey = `${percentEncode(opts.consumerSecret)}&${percentEncode(opts.tokenSecret)}`;
    params.oauth_signature = createHmac('sha1', signingKey).update(base).digest('base64');
    const header = Object.keys(params)
        .sort()
        .map((key) => `${percentEncode(key)}="${percentEncode(params[key] ?? '')}"`)
        .join(', ');
    return `OAuth ${header}`;
}

function resolveOperation(options?: Record<string, unknown>, content?: Content): 'post' | 'article' {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    return raw === 'article' ? 'article' : 'post';
}

export class XPostApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const missing = TOKEN_ENVS.filter((key) => {
            const value = process.env[key];
            return !value || value.trim().length === 0;
        });
        if (missing.length > 0) {
            return fail(
                `${missing.join(', ')} environment variable${missing.length > 1 ? 's are' : ' is'} required: X developer user-context credentials. post does not fall back to a browser (X Automation Rules).`,
            );
        }
        const text = payload.content.body.trim() || payload.content.title?.trim() || '';
        if (text.length === 0) {
            return fail('X post requires Content.body or Content.title');
        }
        try {
            const authorization = oauth1Header({
                method: 'POST',
                url: TWEETS_URL,
                consumerKey: process.env.X_API_KEY ?? '',
                consumerSecret: process.env.X_API_SECRET ?? '',
                token: process.env.X_ACCESS_TOKEN ?? '',
                tokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? '',
            });
            const response = await fetch(TWEETS_URL, {
                method: 'POST',
                headers: {
                    Authorization: authorization,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: text.slice(0, 280) }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                const errorText = (await response.text()).slice(0, 1000);
                return fail(
                    `X POST /2/tweets failed (HTTP ${response.status}): ${errorText.trim() || response.statusText}`,
                );
            }
            const json = (await response.json()) as { data?: { id?: unknown; text?: unknown } };
            if (typeof json.data?.id !== 'string') {
                return fail('X POST /2/tweets response missing data.id');
            }
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                id: json.data.id,
                url: `https://x.com/i/web/status/${json.data.id}`,
                message: 'Posted via X API v2',
                metadata: { operation: 'post' },
            });
        } catch (err: unknown) {
            return fail(`X post transport error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

export class XArticleBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly loginTimeoutMs: number;
    private readonly sessionReady: boolean;

    constructor(driver: BrowserDriver = 'agent', opts?: { loginTimeoutMs?: number; sessionReady?: boolean }) {
        this.driver = driver;
        this.loginTimeoutMs = opts?.loginTimeoutMs ?? 120_000;
        this.sessionReady = opts?.sessionReady ?? false;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const profileDir = resolveBrowserProfileDir(
            'x',
            typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : process.env.X_PROFILE_DIR,
        );
        if (!this.sessionReady && this.loginTimeoutMs <= 0) {
            return fail(`login timeout: no authenticated X article session in ${profileDir}`);
        }
        if (!this.sessionReady) {
            return fail(`login timeout: no authenticated X article session in ${profileDir}`);
        }
        const title = payload.content.title ?? 'Untitled';
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: `article-draft-${title.length}`,
            message: 'X article draft prepared (unpublished)',
            metadata: { operation: 'article', driver: this.driver, publishStatus: 'draft', profileDir },
        });
    }
}

export function getPublishTransport(operation: 'post' | 'article' = 'post'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return operation === 'article' ? new FakeBrowserTransport('agent') : new FakeFileCliTransport();
    }
    return operation === 'article' ? new XArticleBrowserTransport() : new XPostApiTransport();
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

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
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const operation = resolveOperation(options, content);
    const resolved = transport ?? getPublishTransport(operation);
    const result = ResultSchema.parse(await resolved.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

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
        echoError(`x-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
