/**
 * cnblogs-pub — cnblogs (www.cnblogs.com) Markdown-article publisher plugin surface (task 0293).
 *
 * This module is the manifest-facing plugin surface: the declared operation list, the pre-browser
 * refusal ladder (operation → driver → publishStatus → payload → unsupported fields → category
 * types → local Markdown images — all refused before any browser opens), `getPublishTransport`,
 * the `--in/--out` IO contract and the CLI `main`. The selectors live in `src/selectors.ts`, the
 * browser transport and flow in `src/flow.ts`, and the operator session CLI in
 * `src/profile-check.ts`.
 *
 * Evidence: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/cnblogs.js` pins the
 * field semantics cited below (fill cnblogs.js:20-32, register map cnblogs.js:35-37) but is a
 * fill-only adapter — no save/publish protocol, no receipt. Its upload.cnblogs.com XSRF image
 * endpoint (cnblogs.js:5-18) and its replace-with-uploaded-URL image pass (cnblogs.js:24) are
 * deliberately NOT ported: requested cover/tags/images refuse, non-HTTPS Markdown image refs
 * refuse before submit without echoing the path, and existing HTTPS image URLs stay literal.
 *
 * publishStatus contract (task 0293 Design freeze): absent defaults to 'draft', 'draft' saves
 * through the exact-visible 保存草稿|存为草稿 control, 'public' activates 发布|发布博文 — both
 * provisional, bounded, fail closed — and any other value refuses before the browser.
 */
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { type BrowserDriver, FakeBrowserTransport, type PublishTransport } from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { bounded, boundedDetail, CnblogsBrowserTransport, countNonHttpsImageRefs, errorMessage, fail } from './flow';
import { CNBLOGS_TARGET } from './selectors';

/** Declared operations (ADR-029 dispatch): the source handles article only (cnblogs.js:21). */
export const CNBLOGS_OPERATIONS = ['article'] as const;
export type CnblogsOperation = (typeof CNBLOGS_OPERATIONS)[number];

/**
 * Resolves the requested operation. An undeclared value is refused by name, before any transport —
 * and therefore before any browser — is resolved (the source handles article only, cnblogs.js:21).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: CnblogsOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'article';
    if (typeof raw !== 'string' || !(CNBLOGS_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for ${CNBLOGS_TARGET}: expected one of ${CNBLOGS_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as CnblogsOperation };
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
            error: `unsupported driver '${bounded(raw)}' for ${CNBLOGS_TARGET}: expected one of script (the cnblogs-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * cnblogs browser transport (`src/flow.ts`).
 * @param operation - Resolved operation (`article`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: CnblogsOperation = 'article',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new CnblogsBrowserTransport(operation, driver);
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
 * transport (whose own ladder refuses status/payload/unsupported-field/category/image problems —
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
        await writePublishResult(outputPath, fail(CNBLOGS_TARGET, message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(CNBLOGS_TARGET, mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(CNBLOGS_TARGET, driverMode.error));
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
        echoError(`cnblogs-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}

/** Re-exported so the local Markdown-image rule stays observable from the plugin surface. */
export { countNonHttpsImageRefs };
