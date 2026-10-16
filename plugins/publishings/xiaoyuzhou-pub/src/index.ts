/**
 * xiaoyuzhou-pub — xiaoyuzhou (podcaster.xiaoyuzhoufm.com) podcast publisher plugin surface (task 0295).
 *
 * This module is the manifest-facing plugin surface: the declared operation list, the pre-browser
 * refusal ladder (operation → driver → publishStatus → format → title → body → audio file →
 * podcastId → duration → cover → unsupported fields — all refused before any browser opens),
 * `getPublishTransport`, the `--in/--out` IO contract and the CLI `main`. The selectors live in
 * `src/selectors.ts`, the browser transport and flow in `src/flow.ts`, and the operator session
 * CLI in `src/profile-check.ts`.
 *
 * Evidence: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/xiaoyuzhou.js`
 * (83 lines) pins the field semantics cited below (fill xiaoyuzhou.js:23-78, register map
 * xiaoyuzhou.js:83) but is a fill-only adapter — no save protocol, no receipt, and it stops
 * before the publish button (xiaoyuzhou.js:6, 18-19). That button is deliberately never clicked:
 * this slice saves drafts only.
 *
 * publishStatus contract (task 0295 Design freeze): absent defaults to 'draft' and saves through
 * the exact-visible 保存草稿|保存 candidate (provisional, bounded, fail closed); 'public' and any
 * unknown value refuse before the browser — final publication on the studio is not evidenced and
 * not requested by the task AC.
 */
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { type BrowserDriver, FakeBrowserTransport, type PublishTransport } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { bounded, boundedDetail, errorMessage, fail, XiaoyuzhouBrowserTransport } from './flow';
import { XYZF_TARGET } from './selectors';

/**
 * Declared operations (ADR-029 dispatch): the source is a podcast-audio adapter — it runs the
 * same audio fill for every type and notes it is really a podcast audio upload (xiaoyuzhou.js:7).
 */
export const XYZF_OPERATIONS = ['podcast'] as const;
export type XiaoyuzhouOperation = (typeof XYZF_OPERATIONS)[number];

/**
 * Resolves the requested operation (`options.operation ?? content.metadata.operation ?? default`)
 * BEFORE any transport — and therefore before any browser — is resolved. An undeclared value is
 * refused by name (the source handles podcast audio only, xiaoyuzhou.js:3-7).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: XiaoyuzhouOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'podcast';
    if (typeof raw !== 'string' || !(XYZF_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for ${XYZF_TARGET}: expected one of ${XYZF_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as XiaoyuzhouOperation };
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
            error: `unsupported driver '${bounded(raw)}' for ${XYZF_TARGET}: expected one of script (the xiaoyuzhou-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * xiaoyuzhou browser transport (`src/flow.ts`). API-only paths never load Playwright eagerly:
 * the harness launcher imports Playwright dynamically at launch time only.
 * @param operation - Resolved operation (`podcast`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: XiaoyuzhouOperation = 'podcast',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new XiaoyuzhouBrowserTransport(operation, driver);
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
 * transport (whose own ladder refuses status/format/payload/audio/show/cover problems — also all
 * pre-browser).
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
        await writePublishResult(outputPath, fail(XYZF_TARGET, message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(XYZF_TARGET, mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(XYZF_TARGET, driverMode.error));
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
        echoError(`xiaoyuzhou-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
