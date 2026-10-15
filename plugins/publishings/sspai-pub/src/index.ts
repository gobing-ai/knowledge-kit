/**
 * sspai-pub — sspai (sspai.com) Matrix-column article publisher plugin surface (task 0294).
 *
 * This module is the manifest-facing plugin surface: the declared operation list, the pre-browser
 * refusal ladder (operation → driver → publishStatus → title → body → unsupported fields → cover
 * file — all refused before any browser opens), `getPublishTransport`, the `--in/--out` IO
 * contract and the CLI `main`. The selectors live in `src/selectors.ts`, the browser transport
 * and flow in `src/flow.ts`, and the operator session CLI in `src/profile-check.ts`.
 *
 * Evidence: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/sspai.js` pins the
 * field semantics cited below (fill sspai.js:23-77, register map sspai.js:82) but is a fill-only
 * adapter — no save protocol, no receipt, and it stops at the preview control (sspai.js:15-16,
 * 68-76). That preview is deliberately never clicked: this slice saves drafts only.
 *
 * publishStatus contract (task 0294 Design freeze): absent defaults to 'draft' and saves through
 * the exact-visible 保存草稿|保存 candidate (provisional, bounded, fail closed); 'public' and any
 * unknown value refuse before the browser — final publication/submission on sspai is not
 * evidenced and not requested by the task AC.
 */
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { type BrowserDriver, FakeBrowserTransport, type PublishTransport } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { bounded, boundedDetail, errorMessage, fail, SspaiBrowserTransport } from './flow';
import { SSPAI_TARGET } from './selectors';

/** Declared operations (ADR-029 dispatch): the source handles article only (sspai.js:24). */
export const SSPAI_OPERATIONS = ['article'] as const;
export type SspaiOperation = (typeof SSPAI_OPERATIONS)[number];

/**
 * Resolves the requested operation. An undeclared value is refused by name, before any transport —
 * and therefore before any browser — is resolved (the source handles article only, sspai.js:24).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: SspaiOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'article';
    if (typeof raw !== 'string' || !(SSPAI_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for ${SSPAI_TARGET}: expected one of ${SSPAI_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as SspaiOperation };
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
            error: `unsupported driver '${bounded(raw)}' for ${SSPAI_TARGET}: expected one of script (the sspai-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * sspai browser transport (`src/flow.ts`).
 * @param operation - Resolved operation (`article`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: SspaiOperation = 'article',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new SspaiBrowserTransport(operation, driver);
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
 * transport (whose own ladder refuses status/payload/unsupported-field/cover problems — also all
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
        await writePublishResult(outputPath, fail(SSPAI_TARGET, message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(SSPAI_TARGET, mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(SSPAI_TARGET, driverMode.error));
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
        echoError(`sspai-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
