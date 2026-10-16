/**
 * bilibili-pub — Bilibili video uploads and dynamic posts publish plugin surface (task 0297).
 *
 * Implements the manifest-facing plugin surface:
 * - Declared operations list (`BILIBILI_OPERATIONS`: `['shortVideo', 'dynamic']`)
 * - Operation and driver resolution BEFORE browser or profile initialization
 * - `getPublishTransport`: returns FakeBrowserTransport under KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake
 *   or BilibiliBrowserTransport
 * - `--in/--out` IO contract in `processPublishIO`
 * - CLI `main` entrypoint
 */

import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { type BrowserDriver, FakeBrowserTransport, type PublishTransport } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { BilibiliBrowserTransport, bounded, boundedDetail, errorMessage, fail } from './flow';
import { BILI_TARGET, BILIBILI_OPERATIONS, type BilibiliOperation } from './selectors';

export { BILIBILI_OPERATIONS, type BilibiliOperation };

/**
 * Resolves the requested operation (`options.operation ?? content.metadata.operation ?? 'shortVideo'`)
 * BEFORE any browser or profile is created. Undeclared values are refused by name.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: BilibiliOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'shortVideo';
    if (typeof raw !== 'string' || !(BILIBILI_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for ${BILI_TARGET}: expected one of ${BILIBILI_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as BilibiliOperation };
}

/**
 * Resolves the driver from `options.driver ?? 'script'`. Only 'script' is supported.
 */
function resolveDriver(
    options?: Record<string, unknown>,
): { driver: BrowserDriver; error?: undefined } | { driver?: undefined; error: string } {
    const raw = options?.driver ?? 'script';
    if (raw !== 'script') {
        return {
            error: `unsupported driver '${bounded(raw)}' for ${BILI_TARGET}: expected one of script (the bilibili-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Resolves the channel transport: FakeBrowserTransport when KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake,
 * or BilibiliBrowserTransport.
 */
export function getPublishTransport(
    operation: BilibiliOperation = 'shortVideo',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new BilibiliBrowserTransport(operation, driver);
}

/** Writes the Result to `--out`, creating parent directories if needed. */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * Process `--in/--out` publish IO contract.
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
        const message = boundedDetail(`Invalid Content input: ${errorMessage(error)}`);
        await writePublishResult(outputPath, fail(BILI_TARGET, message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(BILI_TARGET, mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(BILI_TARGET, driverMode.error));
        throw new Error(driverMode.error);
    }
    const resolved = transport ?? getPublishTransport(mode.operation, driverMode.driver);
    const result = ResultSchema.parse(await resolved.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

/**
 * CLI entry point: `--in <content.json> --out <result.json>`.
 */
export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${errorMessage(error)}`);
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
        echoError(`bilibili-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
