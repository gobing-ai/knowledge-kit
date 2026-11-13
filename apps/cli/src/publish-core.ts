/**
 * The neutral publish core shared by the ITC path and the daily channel matrix (task 0361, ADR-053 §1).
 *
 * Everything here is content-type agnostic: the receipt contract, the plugin readiness probe, the
 * publish preset schema plus its resolver, the operator config path convention, and the send loop.
 * Nothing in this module imports a `./itc-*` module, so a second content type can publish without
 * adopting the ITC plan shape (AC1). The move is behaviour-preserving: bodies are unchanged, and the
 * ITC modules re-export every symbol under its previous name so no caller or test changed.
 */
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { runFanout } from './fanout';
import { pluginEnvFromConfig, pluginProcessEnv } from './invoke';
import { resolvePackageRoot } from './package-root';

// ---- receipt contract (moved from itc-publish, task 0361 R1/R2) ----

/** Delivery effect a publish plugin reports alongside its result. */
export const DeliveryMetadataSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        publicUrlVerified: z.boolean().optional(),
    })
    .strict();

/** Per-target publish receipt bound to the parent run, plan digest and payload digest. */
export const ReceiptSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        parentRunId: z.string().min(1),
        planDigest: z.string().min(1),
        /** Absent on plan-omitted receipts (0332 R6): no payload was ever prepared. */
        payloadDigest: z.string().min(1).optional(),
        plugin: z.string().min(1),
        profile: z.string().min(1),
        mode: z.enum(['draft', 'live']),
        attemptId: z.string().min(1),
        status: z.enum(['succeeded', 'failed', 'uncertain']),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        resultDigest: z.string().optional(),
        aggregatePath: z.string().optional(),
        publicUrlVerified: z.boolean().optional(),
        url: z.string().optional(),
        durationMs: z.number().optional(),
        // Channel-matrix fields (task 0321): absent on every itc receipt.
        target: z.string().min(1).optional(),
        window: z.string().min(1).optional(),
        dummy: z.boolean().optional(),
        /** Stable episode identity persisted from the plugin result (0332 R5); podcast rows only. */
        guid: z.string().min(1).optional(),
        error: z.string().optional(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
    })
    .strict();

/** Parsed ITC publish receipt. */
export type Receipt = z.infer<typeof ReceiptSchema>;

// ---- plugin readiness probe (moved from itc-publish) ----

/**
 * One plugin readiness probe: `ok` plus the probe's own `status: detail` when it refused.
 * `detail` is scrubbed of every config-injected value before it can reach the operator.
 */
export interface PluginProbeResult {
    ok: boolean;
    detail?: string;
}

/**
 * Probe one plugin's `check` entry through the process seam (no direct spawn). Env comes from the
 * shared injection seam (0311): config plugin env under `process.env`, project root anchored — the
 * same env the send path hands this plugin.
 *
 * Policy-free on purpose: the itc caller fails the run on `!ok`, the matrix caller is warn-only.
 */
export async function probePlugin(
    plugin: PluginRecord,
    executor: ProcessExecutor = new NodeProcessExecutor(),
): Promise<PluginProbeResult> {
    if (!plugin.check) return { ok: true };
    const probe = await executor.run({
        command: process.execPath,
        args: [plugin.check, 'check'],
        env: pluginProcessEnv(plugin.kind, plugin.name) as Record<string, string>,
        timeout: 60_000,
    });
    if (probe.exitCode === 0) return { ok: true };
    // The probe's last stdout line carries {status, detail} — surface it so e.g. a stale profile
    // SingletonLock isn't misreported as an auth expiry (dogfood 2026-10-17).
    let detail = '';
    try {
        const last = probe.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
        const parsed = JSON.parse(last) as { status?: string; detail?: string };
        if (parsed.detail) {
            detail = `${parsed.status ?? 'refused'}: ${parsed.detail}`;
            // A probe may echo a config-injected value in its detail (0311 R3): scrub every value
            // the config overlay injected before the message reaches the operator.
            for (const value of Object.values(pluginEnvFromConfig(plugin.kind, plugin.name))) {
                if (value) detail = detail.split(value).join('<redacted>');
            }
        }
    } catch {
        // keep the generic hint
    }
    return { ok: false, ...(detail ? { detail } : {}) };
}

// ---- publish preset contract (moved from itc-plan) ----

/** Publish window a preset target belongs to (design kk-daily-ai-voice3 §5a, task 0321). */
export const PublishWindowSchema = z.enum(['after-generate', 'cn-peak', 'overseas-rss']);

/**
 * Target entry inside a publish preset.
 *
 * The matrix fields are all optional so every shipped itc preset keeps validating. `mode` is closed
 * over `off | dummy | draft | live`: ADR-022's 2026-11-12 amendment moved live consent into the
 * operator-owned preset, so `daily-ai-voice.json` ships live rows and a channel opts out with `off`
 * (`--live-channels` still promotes a single row for an ad-hoc window; `live_confirm` keeps the
 * send-confirm pause available to a supervised run).
 */
export const PublishPresetTargetSchema = z
    .object({
        plugin: z.string().min(1),
        profile: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        operation: z.string().min(1).optional(),
        variant: z.string().min(1).optional(),
        tier: z.number().int().min(0).max(3).optional(),
        window: PublishWindowSchema.optional(),
        mode: z.enum(['off', 'dummy', 'draft', 'live']).optional(),
        required: z.boolean().optional(),
        options: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

/** One preset target row, including the optional channel-matrix fields. */
export type PublishPresetTarget = z.infer<typeof PublishPresetTargetSchema>;

/** Parsed publish window. */
export type PublishWindow = z.infer<typeof PublishWindowSchema>;

/** Preset v1 definition schema (task 0300). */
export const PublishPresetSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        name: z.string().min(1),
        targets: z.array(PublishPresetTargetSchema).min(1),
    })
    .strict();

/** Parsed publish preset v1. */
export type PublishPreset = z.infer<typeof PublishPresetSchema>;

// ---- preset resolution (moved from itc-plan) ----

/** Preset slug shape: lowercase alphanumerics joined by single hyphens. */
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The package/checkout root that ships the ITC assets, via the shared resolver: the cwd tree first
 * (a checkout keeps shadowing the installed package), then the runtime script's directory so a run
 * from a foreign work dir still finds the installed package's shipped presets. Never derived from
 * `import.meta.dir`/`__dirname`: Bun inlines those as absolute source paths in the bundle, which
 * would make the packed CLI reference the checkout it was built in (0255 AC7).
 */
export async function resolveDefaultPackageRoot(fs: FileSystem): Promise<string> {
    return resolvePackageRoot(fs);
}

/**
 * Resolve a publish preset from roots:
 * Search `<projectRoot>/.kk/publish-presets/<slug>.json` then `<packageRoot>/plugins/kk/publish-presets/<slug>.json`.
 * Traversal rejected; malformed override throws immediately without falling through.
 */
export async function resolvePresetFromRoots(
    fs: FileSystem,
    slug: string,
    projectRoot: string,
    packageRoot: string,
): Promise<{ preset: PublishPreset; digest: string }> {
    if (!SLUG_REGEX.test(slug)) {
        throw new Error(`invalid publish preset slug '${slug}': must be lowercase alphanumeric with hyphens`);
    }

    const projectDir = resolve(projectRoot, '.kk/publish-presets');
    const projectPath = resolve(projectDir, `${slug}.json`);
    if (await fs.exists(projectPath)) {
        return readPresetFile(fs, projectPath, projectDir, slug);
    }

    const pkgDir = resolve(packageRoot, 'plugins/kk/publish-presets');
    const pkgPath = resolve(pkgDir, `${slug}.json`);
    if (await fs.exists(pkgPath)) {
        return readPresetFile(fs, pkgPath, pkgDir, slug);
    }

    throw new Error(`publish preset '${slug}' not found in ${projectPath} or ${pkgPath}`);
}

/** Read one preset file, refusing a path outside `root` and a present-but-malformed document. */
export async function readPresetFile(
    fs: FileSystem,
    path: string,
    root: string,
    slug: string,
): Promise<{ preset: PublishPreset; digest: string }> {
    if (!path.startsWith(root)) {
        throw new Error(`path traversal rejected for preset '${slug}'`);
    }
    let text: string;
    try {
        text = await fs.readFile(path);
    } catch (err: unknown) {
        throw new Error(`malformed publish preset at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed: ReturnType<typeof PublishPresetSchema.safeParse>;
    try {
        parsed = PublishPresetSchema.safeParse(JSON.parse(text));
    } catch (err: unknown) {
        throw new Error(`malformed publish preset at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed.success) {
        throw new Error(`malformed publish preset at ${path}: ${parsed.error.message}`);
    }
    return { preset: parsed.data, digest: createHash('sha256').update(text).digest('hex') };
}

/**
 * Load one publish preset by slug, preserving every matrix field.
 *
 * `resolveItcTargets` narrows a preset to plugin+profile because that is all the itc plan binds;
 * the channel matrix needs the full row, so it reads the same file through the same resolver.
 */
export async function loadPublishPreset(
    slug: string,
    roots: { projectRoot?: string; packageRoot?: string } = {},
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ preset: PublishPreset; digest: string }> {
    const projectRoot = roots.projectRoot ? resolve(roots.projectRoot) : process.cwd();
    const packageRoot = roots.packageRoot ? resolve(roots.packageRoot) : await resolveDefaultPackageRoot(fs);
    return resolvePresetFromRoots(fs, slug.trim(), projectRoot, packageRoot);
}

// ---- operator config path (moved from itc-config) ----

/**
 * Expand ONLY a leading `~`/`$HOME` prefix (the forms the kk config examples use); any other
 * `$`/backtick sequence — including an embedded or `$HOME`-containing literal — stays as data.
 */
export function expandHome(value: string, homeDir: string): string {
    if (value === '~' || value === '$HOME') return homeDir;
    if (value.startsWith('~/')) return join(homeDir, value.slice(2));
    if (value.startsWith('$HOME/')) return join(homeDir, value.slice('$HOME/'.length));
    return value;
}

/** `KK_CONFIG` or `$HOME/.config/kk/config.yaml` — the ONE kk config path convention. */
export function resolveConfigPath(env: Record<string, string | undefined>, homeDir: string): string {
    const explicit = env.KK_CONFIG;
    if (explicit !== undefined && explicit.trim() !== '') return expandHome(explicit.trim(), homeDir);
    return join(homeDir, '.config', 'kk', 'config.yaml');
}

// ---- shared send loop (moved from itc-publish) ----

/**
 * One row the shared send loop dispatches. The itc plan and the channel matrix both reduce their
 * own plan shape to this, so the resend rules and receipt writing live in exactly one place.
 */
export interface SendRow {
    /** Receipt and aggregate file key (`<key>.json`, `fanout-result.<key>.json`). */
    key: string;
    plugin: string;
    profile: string;
    /** `dummy` rows are planned and validated but never dispatched (task 0322). */
    mode: 'draft' | 'live' | 'dummy';
    /** Absolute payload path handed to `--content`. */
    payloadPath: string;
    transport: 'fanout' | 'browser';
    /** Caller-owned receipt fields (the matrix writes `target` and `window`). */
    receiptExtras?: Partial<Receipt>;
}

/** What one shared send pass did, keyed by row key. */
export interface SendRowsOutcome {
    sent: string[];
    skipped: string[];
    /** Rows whose succeeded receipt does not match what this pass would deliver (0332 R3). */
    reconciliationRequired: string[];
    receipts: Receipt[];
}

/** Seam the shared send loop reads and writes through. */
export interface SendRowsOptions {
    rows: readonly SendRow[];
    /** Directory the `fanout-result.<key>.json` aggregates land in. */
    publishDir: string;
    receiptsDir: string;
    parentRunId: string;
    planDigest: string;
    retry: boolean;
    /** Operator-facing label for diagnostics and usage lines. */
    label: string;
    fs?: FileSystem;
    dispatch?: (argv: string[]) => Promise<number>;
    /**
     * Optional payload rewrite before dispatch. Returning `{ error }` fails that row with
     * `effect: none` and no spawn (the matrix uses it for an unresolved link placeholder).
     */
    preparePayload?: (row: SendRow) => Promise<{ payloadPath: string } | { error: string }>;
    /** Called with every receipt this pass writes, in order. */
    onReceipt?: (receipt: Receipt) => Promise<void>;
    /**
     * Synthetic receipt writer for a `mode: dummy` row (task 0322). Absent means a dummy row cannot
     * be completed and records a failure instead — never a dispatch.
     */
    dummyReceipt?: (
        row: SendRow,
        context: { payloadPath: string; payloadDigest: string; startedAt: string },
    ) => Promise<Receipt>;
}

/**
 * The shared send loop: skip/resend policy, dispatch through fan-out, receipt per row.
 *
 * Extracted from `itcSendTargets` unchanged (task 0321 R6) so the itc caller and the channel matrix
 * cannot drift: `key` is the plugin name for itc and the target id for the matrix.
 */
export async function sendRows(options: SendRowsOptions): Promise<SendRowsOutcome> {
    const fs = options.fs ?? createNodeFileSystem();
    const dispatch = options.dispatch ?? runFanout;
    const { rows, publishDir, receiptsDir, parentRunId, planDigest, retry, label } = options;
    const result: SendRowsOutcome = { sent: [], skipped: [], reconciliationRequired: [], receipts: [] };

    /** Identity helper: a receipt without a digest never matches (0332 R2 fail-closed). */
    const sameDigest = (priorDigest: string | undefined, digest: string | undefined): boolean =>
        priorDigest !== undefined && digest !== undefined && priorDigest === digest;

    for (const row of rows) {
        const startedAt = new Date().toISOString();
        const targetReceiptPath = join(receiptsDir, `${row.key}.json`);
        let reattempt = false;

        // Payload preparation and its digest come FIRST: the receipt identity (0332 R2) is defined
        // over the payload this pass would actually deliver, which is only known after resolution.
        let payloadPath = row.payloadPath;
        let preparedError: string | undefined;
        if (options.preparePayload) {
            const prepared = await options.preparePayload(row);
            if ('error' in prepared) {
                preparedError = prepared.error;
            } else {
                payloadPath = prepared.payloadPath;
            }
        }
        const payloadRaw = (await fs.exists(payloadPath)) ? await fs.readFile(payloadPath) : '{}';
        const payloadDigest = createHash('sha256').update(payloadRaw).digest('hex');

        if (retry) {
            // In retry mode, only retry effect: none failures
            if (!(await fs.exists(targetReceiptPath))) continue;
            try {
                const priorReceipt = JSON.parse(await fs.readFile(targetReceiptPath)) as Receipt;
                if (priorReceipt.status === 'succeeded' || priorReceipt.effect !== 'none') continue;
            } catch {
                continue;
            }
            reattempt = true;
        } else if (await fs.exists(targetReceiptPath)) {
            // Receipt identity decides reuse (0332 R2/R3): a succeeded receipt is evidence for ONE
            // parent bundle revision, one target/operation, one mode and one delivered payload. It
            // is reused only when all four match what this pass would deliver now; anything else
            // (older revision, edited content, draft-vs-live) is a reconciliation failure, not a
            // resend — resending could post twice or publish content nobody reviewed.
            const priorRaw = (await fs.exists(targetReceiptPath)) ? await fs.readFile(targetReceiptPath) : undefined;
            let prior: Receipt | undefined;
            try {
                prior = priorRaw === undefined ? undefined : (JSON.parse(priorRaw) as Receipt);
            } catch {
                prior = undefined;
            }
            if (prior === undefined) {
                // Unreadable evidence never authorizes a live send (0332 R3); a draft row is safe
                // to re-attempt, which is what the stale-aggregate fix needs (0314 f6815433).
                if (row.mode === 'live') {
                    echoError(
                        `${label}: ${row.key} has an unreadable receipt and this pass would send live — reconcile it by hand before resending; skipped`,
                    );
                    result.reconciliationRequired.push(row.key);
                    continue;
                }
                reattempt = true;
            } else if (prior.status === 'succeeded' && prior.dummy !== true) {
                const payloadForIdentity = preparedError === undefined ? payloadDigest : undefined;
                // A receipt without a payloadDigest predates 0332: its 0310 identity
                // (parentRunId + planDigest) stays authoritative; digests gate newer receipts only.
                const samePayload =
                    payloadForIdentity !== undefined &&
                    (prior.payloadDigest === undefined || prior.payloadDigest === payloadForIdentity);
                if (
                    prior.parentRunId === parentRunId &&
                    // A receipt without a mode predates the mode field (0330): legacy evidence stays
                    // reusable; from 0330 on the mode is part of the identity (0332 R2).
                    (prior.mode === undefined || prior.mode === (row.mode === 'live' ? 'live' : 'draft')) &&
                    samePayload
                ) {
                    result.skipped.push(row.key);
                    continue;
                }
                echoError(
                    `${label}: ${row.key} has a succeeded receipt from ${samePayload ? `mode '${prior.mode}' of this bundle` : `another bundle revision or payload`} — same target/content/mode required to reuse; reconcile or delete the receipt by hand; skipped without resending`,
                );
                result.reconciliationRequired.push(row.key);
                continue;
            } else if (prior.status === 'succeeded' && prior.dummy === true && row.mode !== 'dummy') {
                // A dummy receipt records that a rehearsal ran, not that the channel published
                // (task 0322 R2): flipping the target to draft must send it for real.
                reattempt = true;
            } else if (prior.status === 'succeeded' && prior.dummy === true) {
                // Rehearsal rerun: reuse only the same revision and payload (0332 R2).
                const payloadForIdentity = preparedError === undefined ? payloadDigest : undefined;
                if (prior.parentRunId === parentRunId && sameDigest(prior.payloadDigest, payloadForIdentity)) {
                    result.skipped.push(row.key);
                    continue;
                }
                reattempt = true;
            } else {
                // A LIVE target whose previous attempt left its effect unknown may already be
                // published: resending it could post twice. Skip it and say so — resolving it is an
                // operator decision. A draft (or any non-live mode) is safe to re-attempt, which is
                // what the stale-aggregate fix needs (0314 / review finding f6815433).
                const mayAlreadyBeLive =
                    (prior.status === 'uncertain' || prior.effect === 'unknown') &&
                    (row.mode === 'live' || prior.mode === 'live');
                if (mayAlreadyBeLive) {
                    echoError(
                        `${label}: ${row.key} has an unknown-effect live receipt (may already be published) — resolve it before resending; skipped`,
                    );
                    result.skipped.push(row.key);
                    continue;
                }
                reattempt = true;
            }
        }

        if (preparedError !== undefined) {
            const receipt: Receipt = {
                ...(row.receiptExtras ?? {}),
                schemaVersion: 1,
                parentRunId,
                planDigest,
                payloadDigest,
                plugin: row.plugin,
                profile: row.profile,
                // `dummy` never reaches a plugin, so a receipt only ever states draft or live.
                mode: row.mode === 'live' ? 'live' : 'draft',
                attemptId: retry ? 'retry-1' : 'attempt-1',
                status: 'failed',
                effect: 'none',
                publicUrlVerified: false,
                error: preparedError,
            };
            await fs.writeFile(targetReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
            result.receipts.push(receipt);
            if (options.onReceipt) await options.onReceipt(receipt);
            continue;
        }

        if (row.mode === 'dummy') {
            // Dummy mode fakes exactly one thing — the dispatch — so the whole publish path can be
            // rehearsed end to end without a plugin process or a network call (task 0322 R1).
            if (options.dummyReceipt === undefined) {
                echoError(`${label}: ${row.key} is dummy but no dummy receipt writer is configured; skipped`);
                result.skipped.push(row.key);
                continue;
            }
            const receipt = await options.dummyReceipt(row, { payloadPath, payloadDigest, startedAt });
            await fs.writeFile(targetReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
            result.receipts.push(receipt);
            if (receipt.status === 'succeeded') result.sent.push(row.key);
            if (options.onReceipt) await options.onReceipt(receipt);
            continue;
        }

        const outPath = join(publishDir, `fanout-result.${row.key}${retry ? '.retry' : ''}.json`);
        // A re-attempt must re-dispatch: the exists guard is only crash recovery for a dispatch
        // that never got its receipt written. Reusing the aggregate would re-read the old failure
        // (dogfood 2026-10-17: fixed-target resend silently kept the stale error).
        //
        // The same rule applies when the receipt was quarantined by hand (the documented recovery
        // for an unknown-effect refusal): the aggregate left beside it is the FAILED attempt, and
        // reusing it would rewrite that old failure as this pass's result without ever dispatching
        // (2026-11-12 xhs repair: 94s and an identical error, no console visit). A succeeded
        // aggregate is still reused — that is the genuine lost-receipt recovery.
        if (await fs.exists(outPath)) {
            let staleFailure = false;
            if (!reattempt) {
                try {
                    const prior = JSON.parse(await fs.readFile(outPath)) as { targets?: Array<{ ok?: boolean }> };
                    staleFailure = (prior.targets ?? []).some((entry) => entry.ok !== true);
                } catch {
                    // An unreadable aggregate is no evidence; the recovery guard stays as it was.
                }
            }
            if (reattempt || staleFailure) await fs.deleteFile(outPath);
        }
        const fanoutArgs = [
            '--content',
            payloadPath,
            '--target',
            row.plugin,
            '--out',
            outPath,
            ...(row.transport === 'browser' ? ['--serial-target', row.plugin] : []),
        ];

        let fanoutExit = 0;
        if (!(await fs.exists(outPath))) {
            try {
                fanoutExit = await dispatch(fanoutArgs);
            } catch {
                fanoutExit = 1;
            }
        }

        let outcome: {
            ok?: boolean;
            status?: string;
            url?: string;
            error?: string;
            durationMs?: number;
            metadata?: Record<string, unknown>;
        } = {};
        if (await fs.exists(outPath)) {
            try {
                const agg = JSON.parse(await fs.readFile(outPath)) as {
                    targets?: Array<{
                        target?: string;
                        ok?: boolean;
                        status?: string;
                        url?: string;
                        error?: string;
                        durationMs?: number;
                        metadata?: Record<string, unknown>;
                    }>;
                };
                const found = (agg.targets ?? []).find((t) => t.target === row.plugin);
                if (found) outcome = found;
            } catch {
                outcome = { ok: false, status: 'failed', error: 'failed to parse fanout result' };
            }
        }

        const isSuccess = fanoutExit === 0 && outcome.ok === true && outcome.status === 'published';
        const itcDelivery = outcome.metadata?.itcDelivery as
            | { effect?: 'none' | 'confirmed' | 'unknown'; publicUrlVerified?: boolean }
            | undefined;

        let effect: 'none' | 'confirmed' | 'unknown' = 'unknown';
        let publicUrlVerified = false;

        if (isSuccess) {
            effect = 'confirmed';
            if (row.mode === 'live' && outcome.url) {
                publicUrlVerified = itcDelivery?.publicUrlVerified === true;
            }
        } else if (itcDelivery?.effect === 'none') {
            effect = 'none';
        }

        const receipt: Receipt = {
            ...(row.receiptExtras ?? {}),
            schemaVersion: 1,
            parentRunId,
            planDigest,
            payloadDigest,
            plugin: row.plugin,
            profile: row.profile,
            mode: row.mode === 'live' ? 'live' : 'draft',
            attemptId: retry ? 'retry-1' : 'attempt-1',
            status: isSuccess ? 'succeeded' : effect === 'unknown' ? 'uncertain' : 'failed',
            effect,
            publicUrlVerified,
            ...(outcome.url ? { url: outcome.url } : {}),
            // Episode identity from the plugin result (0332 R5): the RSS gate binds its verdict to
            // this guid, so the writer must persist it, not let the receipt forget which episode.
            ...(typeof outcome.metadata?.guid === 'string' && outcome.metadata.guid !== ''
                ? { guid: outcome.metadata.guid }
                : {}),
            ...(outcome.error ? { error: outcome.error } : {}),
            ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
            aggregatePath: outPath,
        };

        await fs.writeFile(targetReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        result.receipts.push(receipt);
        if (receipt.status === 'succeeded') result.sent.push(row.key);
        if (options.onReceipt) await options.onReceipt(receipt);
    }
    return result;
}
