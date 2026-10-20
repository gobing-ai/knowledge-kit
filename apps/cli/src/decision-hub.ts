/**
 * Task 0317 R8 — the in-process decision hub for batch item labelling.
 *
 * `kk store label` used to spawn one `spur decision run` subprocess per (item, decision): 8+ process
 * starts, catalog loads and maker constructions per item, which dominated a collect run's cost. The
 * batch path now asks `@gobing-ai/ts-ai-decision` directly — the same package spur's `decision`
 * service wraps — so one warm maker serves the whole batch and `dispose()` releases it (a
 * `laya-local` maker holds a Python worker whose open pipes otherwise keep kk alive).
 *
 * Parity with the subprocess path is the contract, and it has three parts:
 *  - **The catalog**: the same `plugins/kk/decisions/kk-items.yaml` file, loaded by the same hub
 *    implementation spur bundles.
 *  - **The evidence**: `spur decision run --evidence <file>` folds the file into the reserved
 *    `instructions` parameter, bounded to `EVIDENCE_MAX_CHARS` (`DECIDE_EVIDENCE_MAX_CHARS` in
 *    spur's `decision-evidence-input.ts`).
 *  - **The maker**: spur resolves config-decision → config-default → catalog-decision →
 *    catalog-default. `.spur/config.yaml`'s `decisions.makers[<id>]` and `decisions.maker` are
 *    passed per call, so the config layer keeps its precedence; with neither set the hub falls
 *    back to the catalog's own `maker` and then its default.
 *
 * One-off callers (`apps/cli/src/itc-decision.ts`) keep the subprocess path deliberately: a single
 * decision does not amortise a hub, and the subprocess is the audited seam there.
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeSyncProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';

/** The catalog file the label path's decisions are declared in (`STORE_CATALOG_PATH_REL`). */
export const STORE_CATALOG_PATH_REL = 'plugins/kk/decisions/kk-items.yaml';

/** `.spur/config.yaml`, relative to the project root (spur's project layer). */
export const SPUR_CONFIG_PATH_REL = '.spur/config.yaml';

/**
 * How much item body reaches the model, in characters. Mirrors spur's `DECIDE_EVIDENCE_MAX_CHARS`,
 * so the in-process request and the `--evidence` subprocess request carry the same instructions.
 */
export const EVIDENCE_MAX_CHARS = 2000;

/** One decision's answer, shaped like `spur decision run --json` prints it. */
export interface DecisionAnswer {
    value: string | number;
    confidence: number | null;
    source: string;
    reason: string;
    /** The maker that answered; absent when the backend did not name one (the caller's stands). */
    maker?: string;
    /** Backend wall-clock cost; absent when a stub could not measure it. */
    durationMs?: number;
}

/** What a decision needs from the caller: the item's title, source and body. */
export interface DecisionInput {
    title: string;
    source: string;
    /** The item body; bounded to {@link EVIDENCE_MAX_CHARS} before it reaches the model. */
    body: string;
}

/** The one method the label pass needs from a hub (injectable, so tests never call a model). */
export interface DecisionHubLike {
    decide(id: string, input: Record<string, unknown>, options?: { maker?: string }): Promise<DecisionAnswer>;
    registry: { dispose(): Promise<void> | void };
}

/** The one-off transport signature (`spur decision run`), injectable so a test never spawns. */
export type DecisionSubprocess = (
    decisionId: string,
    input: DecisionInput,
    maker: string | undefined,
) => DecisionAnswer | undefined;

/** Batch-scoped decision access: one warm maker, one `dispose()` at the end. */
export interface DecisionAsker {
    ask(decisionId: string, input: DecisionInput, maker?: string): Promise<DecisionAnswer | undefined>;
    dispose(): Promise<void>;
}

/**
 * How many times ONE decision may come back from the hub with a backend failure before the asker
 * routes it to `spur decision run` for the rest of the batch. A backend that cannot construct at all
 * (a missing peer module, an unconfigured SDK) fails identically on every item, so the second
 * failure is the evidence and a per-item retry would only double the batch's latency.
 */
const SUBPROCESS_FALLBACK_AFTER = 2;

/** The maker routing `.spur/config.yaml` declares for the decision layer. */
export interface DecisionRouting {
    /** Per-decision maker overrides (`decisions.makers`). */
    makers: Record<string, string>;
    /** The decision layer's default maker (`decisions.maker`), when declared. */
    maker?: string;
}

/**
 * Read the label catalog path and the maker routing from the project's `.spur/config.yaml`.
 * A missing file or a missing `decisions` block is not an error: the label pass then runs with the
 * catalog's own routing, which is exactly what a project without the layer pays today.
 */
/**
 * The catalog file the label path's decisions are declared in: the working checkout's copy first,
 * then this module's own install (source layout `<root>/apps/cli/src/…`, bundle layout
 * `<pkg>/dist/index.js`). Throws when none exists — labels cannot be validated without it.
 */
export async function resolveCatalogPath(
    projectRoot: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<string> {
    // The working checkout first (a project may carry its own catalog), then this module's own
    // install: source layout `<root>/apps/cli/src/…`, bundle layout `<pkg>/dist/index.js`.
    const candidates = [
        resolve(projectRoot, STORE_CATALOG_PATH_REL),
        resolve(import.meta.dir, '../../..', STORE_CATALOG_PATH_REL),
        resolve(import.meta.dir, '..', STORE_CATALOG_PATH_REL),
    ];
    for (const candidate of candidates) {
        if (await fs.exists(candidate)) return candidate;
    }
    throw new Error(`decision catalog not found: tried ${candidates.join(', ')}`);
}

/**
 * The hub seam for tests: `KK_DECISION_HUB` names a module whose default export is a
 * {@link DecisionHubLike}. It plays the same role `KK_SPUR_BIN` played for the subprocess path —
 * the label suite runs against a stub instead of a live model — and is inert when unset.
 */
async function loadInjectedHub(): Promise<DecisionHubLike | undefined> {
    const modulePath = process.env.KK_DECISION_HUB;
    if (modulePath === undefined || modulePath === '') return undefined;
    const loaded: unknown = await import(modulePath);
    const hub = (loaded as { default?: DecisionHubLike }).default;
    if (hub === undefined) throw new Error(`KK_DECISION_HUB module ${modulePath} has no default export`);
    return hub;
}

/**
 * Read the label catalog path and the maker routing for a project: the `decisions.makers[<id>]` /
 * `decisions.maker` layer from `.spur/config.yaml` (spur's config precedence), falling back to the
 * catalog's own routing when the file or the block is absent or unreadable.
 */
export async function readDecisionRouting(
    projectRoot: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ catalogPath: string; routing: DecisionRouting }> {
    const catalogPath = await resolveCatalogPath(projectRoot, fs);
    const configPath = join(projectRoot, SPUR_CONFIG_PATH_REL);
    if (!(await fs.exists(configPath))) return { catalogPath, routing: { makers: {} } };
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(await fs.readFile(configPath));
    } catch {
        // An unreadable spur config must not fail a label pass; the catalog routing still holds.
        return { catalogPath, routing: { makers: {} } };
    }
    const decisions = asRecord(asRecord(parsed).decisions);
    const makers: Record<string, string> = {};
    for (const [id, value] of Object.entries(asRecord(decisions.makers))) {
        if (typeof value === 'string' && value.trim() !== '') makers[id] = value.trim();
    }
    const maker =
        typeof decisions.maker === 'string' && decisions.maker.trim() !== '' ? decisions.maker.trim() : undefined;
    return { catalogPath, routing: maker === undefined ? { makers } : { makers, maker } };
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

/**
 * Build the batch asker. `hub` is injectable for tests; production constructs the real hub over the
 * project's catalog, which is the only place a maker is ever constructed (lazily, on first ask).
 */
export async function createItemDecisionAsker(
    options: {
        projectRoot?: string;
        hub?: DecisionHubLike;
        /** The one-off transport used when the hub cannot serve a decision; injectable for tests. */
        fallback?: DecisionSubprocess;
        /** File system seam (`no-direct-fs-io`): the evidence temp file goes through it. */
        fs?: FileSystem;
    } = {},
): Promise<DecisionAsker> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const fs = options.fs ?? createNodeFileSystem();
    const { catalogPath, routing } = await readDecisionRouting(projectRoot, fs);
    const injected = options.hub ?? (await loadInjectedHub());
    // An injected hub owns the whole transport (it IS the test double), so it never triggers a
    // real `spur decision run` spawn; production — no injection — always has the fallback.
    const fallback =
        options.fallback ??
        (injected === undefined
            ? (decisionId, input, maker) => runDecisionSubprocess(decisionId, input, maker, fs)
            : undefined);
    // Lazy on purpose: the decision family (TypeSafe SDK, the fm and Laya drivers) is heavy and only
    // `store label` needs it, so `kk`'s other commands never load it. The CLI build therefore
    // externalizes the package instead of bundling that graph (task 0317 R8).
    const hub: DecisionHubLike =
        injected ??
        ((await (
            await import('@gobing-ai/ts-ai-decision')
        ).createDecisionHub({
            catalogs: [catalogPath],
            // The TypeSafe SDK drains the response body for its telemetry buffer before parsing the
            // same response again; see `bufferedDecisionFetch` for why that is fatal under Bun.
            builtins: { makerOptions: { fetch: bufferedDecisionFetch } },
        })) as unknown as DecisionHubLike);

    const backendFailures = new Map<string, number>();

    return {
        async ask(decisionId: string, input: DecisionInput, maker?: string): Promise<DecisionAnswer | undefined> {
            // Config-decision > config-default, then the catalog's own routing (hub-side). The
            // caller's `--maker` still wins over both, as it does on the subprocess path.
            const resolved = maker ?? routing.makers[decisionId] ?? routing.maker;
            const failures = backendFailures.get(decisionId) ?? 0;
            if (fallback !== undefined && failures >= SUBPROCESS_FALLBACK_AFTER) {
                return fallback(decisionId, input, resolved);
            }
            const started = Date.now();
            let answer: DecisionAnswer | undefined;
            try {
                answer = await hub.decide(
                    decisionId,
                    {
                        title: input.title,
                        source: input.source,
                        instructions: input.body.slice(0, EVIDENCE_MAX_CHARS),
                    },
                    resolved === undefined ? {} : { maker: resolved },
                );
            } catch {
                // A caller mistake (unknown decision id, an input outside the declared contract, an
                // unregistered maker) is "no usable answer", the same outcome a non-zero exit had.
                return undefined;
            }
            if (answer.durationMs === undefined) answer = { ...answer, durationMs: Date.now() - started };
            // A maker's own low-confidence answer is a real answer, not a transport failure: only a
            // backend failure (`error` / `no-backend` / `timeout`) is worth a second transport.
            if (answer.source !== 'default' || answer.reason === 'low-confidence') {
                backendFailures.delete(decisionId);
                return answer;
            }
            // A backend that cannot serve this decision IN PROCESS still serves it through spur: the
            // subprocess bundles its own dependencies, so a peer the hub cannot resolve (0317: the
            // TypeSafe driver's `@opentelemetry/api`) is present there. Latch after the second
            // failure so a dead backend costs one probe, not one probe per item.
            backendFailures.set(decisionId, failures + 1);
            return (fallback === undefined ? undefined : fallback(decisionId, input, resolved)) ?? answer;
        },
        async dispose(): Promise<void> {
            await hub.registry.dispose();
        },
    };
}

/**
 * Fetch adapter for the TypeSafe-backed decisions (`kk-item-china-politics`, `-sensitivity`,
 * `-audience`): hand the SDK an already-buffered, body-less response.
 *
 * `@typesafe-ai/sdk@0.7.0`'s `attempt()` drains `response.clone().body` AND `response.body` for its
 * telemetry buffer (`bufferResponse`) and then parses the original with `response.text()`. Under Bun
 * the drain consumes the original body, so every request dies with `TypeError: Body already used`
 * and the maker answers through its declared fallback — which is fail-closed on purpose:
 * `kk-item-china-politics` falls back to 3, and the ai-news extract profile's `lte: 1` gate then
 * drops every item, so the daily episode cannot be built at all (2026-10-20, every label pass from
 * 10-19T03:53Z on). SDK 0.6.0 had no such drain; 0.7.0 ships it unconditionally.
 *
 * Reading the body once here and returning a Response-shaped object with `body: null` makes that
 * drain an immediate no-op (`if (!reader) return`), so the SDK parses the text this adapter already
 * holds. `clone()` returns the same object: nothing downstream mutates it, and it keeps the no-op
 * body contract. Remove this adapter once the SDK stops draining the response it is about to parse.
 *
 * The underlying fetch is a PARAMETER, not the global: this module is the decision transport seam
 * (`no-direct-fetch`), so it never reaches the network itself — the hub's default is the ambient
 * fetch, and a test injects its own instead of mutating `globalThis` (`no-globalthis-fetch-mutation`).
 */
export function createBufferedDecisionFetch(inner: typeof fetch = fetch): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const response = await inner(input, init);
        const text = await response.text();
        const buffered = {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: null,
            text: async () => text,
            json: async () => JSON.parse(text),
            clone: () => buffered,
        };
        return buffered as unknown as Response;
    }) as unknown as typeof fetch;
}

/** The adapter the in-process hub installs on the TypeSafe maker (ambient fetch). */
export const bufferedDecisionFetch = createBufferedDecisionFetch();

/**
 * The one-off transport: `spur decision run <id> --param title=… --param source=… --evidence <body>
 * [--maker <maker>] --json`. `undefined` means "no usable answer" (spawn failure, non-zero exit,
 * unparseable stdout), which the label pass treats exactly like a bare fallback. `KK_SPUR_BIN`
 * overrides the binary, the same seam `kk ledger` uses; the evidence file goes through the
 * `FileSystem` seam (`no-direct-fs-io`) and is removed on every exit path.
 */
export function runDecisionSubprocess(
    decisionId: string,
    input: DecisionInput,
    maker: string | undefined,
    fs: FileSystem = createNodeFileSystem(),
): DecisionAnswer | undefined {
    const command = process.env.KK_SPUR_BIN ?? 'spur';
    const scratch = join(tmpdir(), `kk-decision-${randomUUID()}`);
    const evidencePath = join(scratch, 'evidence.md');
    try {
        fs.writeFile(evidencePath, input.body);
        const args = [
            'decision',
            'run',
            decisionId,
            '--param',
            `title=${input.title}`,
            '--param',
            `source=${input.source}`,
            '--evidence',
            evidencePath,
        ];
        if (maker !== undefined) args.push('--maker', maker);
        args.push('--json');
        const result: ProcessResult = new NodeSyncProcessExecutor().runSync({ command, args });
        if (result.exitCode !== 0) return undefined;
        return JSON.parse(result.stdout) as DecisionAnswer;
    } catch {
        return undefined;
    } finally {
        void fs.deleteFile(scratch);
    }
}
