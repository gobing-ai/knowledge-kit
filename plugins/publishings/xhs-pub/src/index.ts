import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    FakeBrowserTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
} from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

const CHANNEL = 'xhs';
const TARGET = 'xhs';

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function draftId(content: Content): string {
    const title = content.title ?? 'untitled';
    return `${CHANNEL}-draft-${title.length}`;
}

function draftResult(content: Content, driver: BrowserDriver, profileDir: string): Result {
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        id: draftId(content),
        message: `${TARGET} draft prepared (unpublished)`,
        metadata: { driver, publishStatus: 'draft', profileDir },
    });
}

export class XhsBrowserTransport implements PublishTransport {
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
        const override =
            typeof payload.options?.profileDir === 'string'
                ? payload.options.profileDir
                : (process.env.XHS_PROFILE_DIR ?? process.env.KK_BROWSER_PROFILE_DIR);
        const profileDir = resolveBrowserProfileDir(CHANNEL, override);
        if (!this.sessionReady) {
            return fail(
                `login timeout after ${this.loginTimeoutMs}ms: no authenticated ${CHANNEL} session in ${profileDir}`,
            );
        }
        return draftResult(payload.content, this.driver, profileDir);
    }
}

export function getPublishTransport(driver: BrowserDriver = 'agent'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport(driver);
    }
    return new XhsBrowserTransport(driver);
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
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
    const result = ResultSchema.parse(await transport.publish({ content, options }));
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
        echoError(`xhs-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
