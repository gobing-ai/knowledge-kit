/**
 * shipinhao-pub — shipinhao (channels.weixin.qq.com) short-video publisher plugin surface (task 0296).
 *
 * This module is the manifest-facing plugin surface: the declared operation list, the pre-browser
 * refusal ladder (operation → driver → publishStatus → format → title → body → video file → cover
 * → tags → original → unsupported fields — all refused before any browser opens),
 * `getPublishTransport`, the `--in/--out` IO contract and the CLI `main`. The selectors and the
 * vendor-grounded site predicates live in `src/selectors.ts`, the browser transport and flow in
 * `src/flow.ts`, and the operator session CLI in `src/profile-check.ts`.
 *
 * Evidence: the recovered extension adapter
 * `.spur/run/yijianfa-source/platforms/shipinhao.js` (2817 lines) pins the field semantics cited
 * throughout `src/selectors.ts` and `src/flow.ts` (root policy 514-545, upload 549-631, fields
 * 638-674, originality 2221-2310, cover 1461-1467/1853-1871/2111-2215, publish 2312-2326).
 *
 * publishStatus contract (task 0296 Design freeze): absent defaults to 'draft' and saves through
 * the exact-visible 保存草稿 candidate (provisional — the vendor never saves a draft, so absence
 * is a typed failure, never a manufactured draft and never a publish click); 'public' publishes
 * through the scoped exact-发表 button and requires a fresh id-bearing works receipt plus
 * persisted state; any unknown value refuses before the browser.
 */
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { type BrowserDriver, FakeBrowserTransport, type PublishTransport } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { bounded, boundedDetail, errorMessage, fail, ShipinhaoBrowserTransport } from './flow';
import { SHP_TARGET } from './selectors';

/**
 * Declared operations (ADR-029 dispatch): the source registers a single short-video flow
 * (`shortVideo`; the vendor's type dispatch, shipinhao.js:10,2802, declares this one kind).
 */
export const SHP_OPERATIONS = ['shortVideo'] as const;
export type ShipinhaoOperation = (typeof SHP_OPERATIONS)[number];

/**
 * Resolves the requested operation (`options.operation ?? content.metadata.operation ?? default`)
 * BEFORE any transport — and therefore before any browser — is resolved. An undeclared value is
 * refused by name (this source publishes short video only).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: ShipinhaoOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'shortVideo';
    if (typeof raw !== 'string' || !(SHP_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for ${SHP_TARGET}: expected one of ${SHP_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as ShipinhaoOperation };
}

/**
 * Resolves the driver from `options.driver ?? 'script'`. This channel ships one driver and no
 * `agent` path, so anything else — including a wrong type — is refused by name before a transport
 * is built.
 * @param options - Per-call publish options (`driver`).
 * @returns The resolved driver, or the refusal message.
 */
function resolveDriver(
    options?: Record<string, unknown>,
): { driver: BrowserDriver; error?: undefined } | { driver?: undefined; error: string } {
    const raw = options?.driver ?? 'script';
    if (raw !== 'script') {
        return {
            error: `unsupported driver '${bounded(raw)}' for ${SHP_TARGET}: expected one of script (the shipinhao-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * shipinhao browser transport (`src/flow.ts`). API-only paths never load Playwright eagerly:
 * the harness launcher imports Playwright dynamically at launch time only.
 * @param operation - Resolved operation (`shortVideo`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: ShipinhaoOperation = 'shortVideo',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new ShipinhaoBrowserTransport(operation, driver);
}

/** Writes the Result to `--out`, creating its directory when the caller named a nested path. */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * The plugin's `--in/--out` contract: validate the Content, resolve **and refuse** the operation
 * and the driver before any transport exists, then publish through the injected or configured
 * transport (whose own ladder refuses status/format/payload/video/cover/tags/original problems —
 * also all pre-browser).
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
        const message = boundedDetail(`Invalid Content input: ${errorMessage(error)}`);
        await writePublishResult(outputPath, fail(SHP_TARGET, message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(SHP_TARGET, mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(SHP_TARGET, driverMode.error));
        throw new Error(driverMode.error);
    }
    const resolved = transport ?? getPublishTransport(mode.operation, driverMode.driver);
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
        echoError(`shipinhao-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
