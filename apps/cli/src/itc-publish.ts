import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { type Content, discoverAllPlugins, type PluginRecord } from '@gobing-ai/kk-core';
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
import type { ItcEffectiveOptions } from './itc-config';
import { itcDecision } from './itc-decision';
import { buildItcPublishPlan, type ItcPlanRequest, type ItcPublishPlan, resolveItcTargets } from './itc-plan';
import { type ChosenSourceArtifact, type ItcSelectionSettleRequest, itcSelectionSettle } from './itc-topic';

/** Delivery effect a publish plugin reports alongside its result. */
export const ItcDeliveryMetadataSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        effect: z.enum(['none', 'confirmed', 'unknown']),
        publicUrlVerified: z.boolean().optional(),
    })
    .strict();

/** Per-target publish receipt bound to the parent run, plan digest and payload digest. */
export const ItcReceiptSchema = z
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
export type ItcReceipt = z.infer<typeof ItcReceiptSchema>;

/** First `cover.*` in 4-illustrations as an ABSOLUTE path (plugins run with cwd != workDir and reject relative paths), or undefined. */
async function findCover(fs: FileSystem, workDir: string): Promise<string | undefined> {
    const dir = join(workDir, '4-illustrations');
    if (!(await fs.exists(dir))) return undefined;
    const cover = (await fs.readDir(dir)).find((file) => file.startsWith('cover.'));
    return cover ? join(dir, cover) : undefined;
}

async function readFrontmatter(fs: FileSystem, path: string): Promise<Record<string, string>> {
    if (!(await fs.exists(path))) return {};
    const text = await fs.readFile(path);
    if (!text.startsWith('---')) return {};
    const end = text.indexOf('\n---', 3);
    if (end < 0) return {};
    const out: Record<string, string> = {};
    for (const line of text.slice(4, end).split('\n')) {
        const m = /^([\w-]+):\s*(.+)$/.exec(line);
        if (m?.[1] && m[2]) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return out;
}

function splitList(value: string): string[] {
    return value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

/**
 * Materializes 4-publish/content.json and resolves target publication plan.
 */
export async function itcMaterializePlan(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', ...positional] = args;
    if (!workDir) {
        echoError('usage: itc-materialize-plan <work_dir> [targets] [source_locale] [publish_live] [preset]');
        return 1;
    }
    // The frozen launch snapshot (0303) wins over positional args, which remain for legacy callers.
    const snapshot = await readOptionsSnapshot(fs, workDir);
    const [targetsArg = '', sourceLocale = '', liveArg = '', presetArg = ''] = snapshot
        ? [snapshot.publishTargets, snapshot.sourceLocale, String(snapshot.publishLive), '']
        : positional;
    const live = liveArg === 'true';
    const draftPath = join(workDir, '3-draft-draft-article.md');
    if (!(await fs.exists(draftPath))) {
        echoError(`final draft not found: ${draftPath}`);
        return 1;
    }
    const lines = (await fs.readFile(draftPath)).split('\n');
    const h1 = lines.findIndex((line) => /^#\s+\S/.test(line));
    if (h1 < 0) {
        echoError(`no H1 title in ${draftPath}`);
        return 1;
    }
    const title = lines[h1]?.replace(/^#\s+/, '').trim() ?? '';
    const body = [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join('\n').trim();
    if (!body) {
        echoError(`empty body in ${draftPath}`);
        return 1;
    }

    const content: Record<string, unknown> = { title, format: 'markdown', body };
    const outlinePath = join(workDir, '2-outline', 'outline-approved.md');
    if (await fs.exists(outlinePath)) content.outline = (await fs.readFile(outlinePath)).trim();

    const docsPath = join(workDir, 'docs.json');
    if (await fs.exists(docsPath)) {
        try {
            const docs = JSON.parse(await fs.readFile(docsPath)) as Array<{
                id?: unknown;
                title?: unknown;
                sourceUri?: unknown;
            }>;
            if (Array.isArray(docs)) {
                content.references = docs.map((doc) => ({
                    ...(typeof doc.sourceUri === 'string' ? { url: doc.sourceUri } : {}),
                    ...(typeof doc.title === 'string' ? { title: doc.title } : {}),
                    ...(typeof doc.id === 'string' ? { cite: doc.id } : {}),
                }));
            }
        } catch {
            // ignore malformed docs
        }
    }

    const metadata: Record<string, unknown> = { published: live };
    const cover = await findCover(fs, workDir);
    if (cover) metadata.coverImage = cover;
    const brief = await readFrontmatter(fs, join(workDir, 'brief.md'));
    if (brief.tags) metadata.tags = splitList(brief.tags);
    if (brief.keywords) metadata.keywords = splitList(brief.keywords);
    if (brief.description) metadata.description = brief.description;
    content.metadata = metadata;

    const publishDir = join(workDir, '4-publish');
    await fs.ensureDir(publishDir);
    await fs.writeFile(join(publishDir, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);

    // Target resolution
    const fromLaunch = snapshot?.publishPresetSource === 'launch' ? snapshot.publishPreset : null;
    const fromConfig = snapshot?.publishPresetSource === 'config' ? snapshot.publishPreset : null;
    let resolvedTargets: Awaited<ReturnType<typeof resolveItcTargets>>;
    try {
        resolvedTargets = await resolveItcTargets(
            {
                explicitTargets: targetsArg ? targetsArg : undefined,
                explicitPreset: presetArg ? presetArg : (fromLaunch ?? undefined),
                workflowConfigPreset: fromConfig ?? undefined,
                topicProfile: snapshot?.topicProfile ?? undefined,
                projectRoot: snapshot?.launchProjectRoot,
            },
            fs,
        );
    } catch (err: unknown) {
        echoError(`itc-materialize-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    // A topic-profile preset is only a suggestion: a bounded decision accepts it or plans nothing.
    if (resolvedTargets.origin === 'topic-profile' && snapshot) {
        const decision = await itcDecision(
            {
                parentRunId: snapshot.parentRunId,
                decisionId: 'kk-itc-preset-choice',
                candidates: [
                    {
                        id: 'suggested',
                        title: `${resolvedTargets.presetName}: ${resolvedTargets.targets.map((t) => t.plugin).join(', ')}`,
                    },
                ],
                outPath: join(workDir, '4-publish', 'preset-decision.json'),
            },
            fs,
        );
        if (decision.value !== 'suggested') resolvedTargets = { targets: [], origin: 'none' };
    }

    if (resolvedTargets.targets.length === 0) {
        // No targets to plan
        const emptyPlan: ItcPublishPlan = {
            schemaVersion: 1,
            live,
            sourceLocale: sourceLocale || 'en',
            origin: resolvedTargets.origin,
            variants: {},
            fanout: [],
            browser: [],
            targets: [],
        };
        await fs.writeFile(join(publishDir, 'publish-plan.json'), `${JSON.stringify(emptyPlan, null, 2)}\n`);
        return 0;
    }

    const { plugins } = discoverAllPlugins();
    const req: ItcPlanRequest = {
        schemaVersion: 1,
        workDir,
        sourceLocale: sourceLocale || 'en',
        live,
        targets: resolvedTargets.targets,
        origin: resolvedTargets.origin,
        presetName: resolvedTargets.presetName,
        presetDigest: resolvedTargets.presetDigest,
    };

    try {
        const plan = await buildItcPublishPlan(req, plugins, fs);
        const planPath = join(publishDir, 'publish-plan.json');
        await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
        // A skipped target is not an error, but the operator must see which one was dropped.
        for (const warning of plan.warnings ?? []) echoError(`itc-materialize-plan: ${warning}`);

        // Prepare isolated target payloads
        await prepareTargetPayloads(fs, workDir, plan, plugins);
        return 0;
    } catch (err: unknown) {
        echoError(`itc-materialize-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/** The frozen `itc-options.json` fields materialize reads; absent for legacy positional callers. */
async function readOptionsSnapshot(
    fs: FileSystem,
    workDir: string,
): Promise<
    | Pick<
          ItcEffectiveOptions,
          | 'parentRunId'
          | 'publishTargets'
          | 'sourceLocale'
          | 'publishLive'
          | 'publishPreset'
          | 'publishPresetSource'
          | 'topicProfile'
          | 'launchProjectRoot'
      >
    | undefined
> {
    const path = join(workDir, 'itc-options.json');
    if (!(await fs.exists(path))) return undefined;
    return JSON.parse(await fs.readFile(path)) as ItcEffectiveOptions;
}

/**
 * Prepares isolated payload files per target with mode-key unions cleared and specific metadata applied.
 */
async function prepareTargetPayloads(
    fs: FileSystem,
    workDir: string,
    plan: ItcPublishPlan,
    plugins: readonly PluginRecord[],
): Promise<ItcPublishPlan> {
    const publishDir = join(workDir, '4-publish');
    if (!plan.targets || plan.targets.length === 0) return plan;
    const planned = new Set(plan.targets.map((t) => t.plugin));
    const modeKeys = new Set(['operation', 'published', 'publishStatus', 'private', 'mode']);
    for (const plugin of plugins) {
        if (!planned.has(plugin.name)) continue;
        for (const profile of Object.values(plugin.publishing?.profiles ?? {})) {
            for (const binding of Object.values(profile.modes)) {
                for (const key of Object.keys(binding?.metadata ?? {})) modeKeys.add(key);
            }
        }
    }

    const variants = plan.variants ?? {};
    let written = false;
    for (const target of plan.targets) {
        const variantEntry = variants[target.variant];
        const baseFile = variantEntry?.file ?? 'content.json';
        let basePath = join(publishDir, baseFile);
        if (!(await fs.exists(basePath))) {
            basePath = join(publishDir, 'content.json');
        }
        if (!(await fs.exists(basePath))) continue;

        const baseContent = JSON.parse(await fs.readFile(basePath)) as Content;
        const cleanedMetadata: Record<string, unknown> = { ...(baseContent.metadata ?? {}) };

        // Clear every mode switch any planned profile declares, so no target inherits another's.
        for (const k of modeKeys) {
            delete cleanedMetadata[k];
        }

        // Apply target metadata binding
        const isolatedContent: Content = {
            ...baseContent,
            metadata: {
                ...cleanedMetadata,
                ...target.metadata,
            },
        };

        const targetFileName = `content.${target.plugin}.json`;
        const targetFilePath = join(publishDir, targetFileName);
        const contentStr = `${JSON.stringify(isolatedContent, null, 2)}\n`;
        await fs.writeFile(targetFilePath, contentStr);

        const payloadDigest = createHash('sha256').update(contentStr).digest('hex');
        target.payloadPath = `4-publish/${targetFileName}`;
        (target as unknown as Record<string, unknown>).payloadDigest = payloadDigest;
        written = true;
    }

    // Re-save only when a payload changed: the plan's own digest is a receipt-identity input, so a
    // byte-identical rewrite is not free — it would re-key every prior receipt of the same plan.
    if (written) {
        await fs.writeFile(join(publishDir, 'publish-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    }
    return plan;
}

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

/**
 * `itc-check-targets`: readiness probes for the plan's targets, recorded as data.
 *
 * Warn-only (exit 0) — the same contract as `publish-matrix-check` (0332): a refusal is printed and
 * written to `4-publish/check-targets.json`, never a run failure. One stale browser session must not
 * veto the other channels of a fan-out, and the per-target receipt stays the authority on whether a
 * channel could publish. Exit 1 is reserved for a plan that cannot be read.
 */
export async function itcCheckTargets(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
    executor: ProcessExecutor = new NodeProcessExecutor(),
): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-check-targets <work_dir>');
        return 1;
    }
    const planPath = join(workDir, '4-publish/publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    let plan: ItcPublishPlan;
    try {
        plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    } catch (error: unknown) {
        echoError(
            `itc-check-targets: unreadable plan at ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
    }
    if (!plan.targets || plan.targets.length === 0) return 0;

    const { plugins } = discoverAllPlugins();
    const byName = new Map(plugins.map((p) => [p.name, p]));
    const probes: Array<{ plugin: string; ok: boolean; detail?: string }> = [];

    for (const target of plan.targets) {
        if (probes.some((row) => row.plugin === target.plugin)) continue;
        const plugin = byName.get(target.plugin);
        // A target whose plugin vanished from the tree is a runtime gap worth naming, not a plan error.
        if (plugin === undefined) {
            probes.push({ plugin: target.plugin, ok: false, detail: 'plugin not installed' });
            continue;
        }
        if (!plugin.check) continue;
        const probe = await probePlugin(plugin, executor);
        probes.push({ plugin: target.plugin, ok: probe.ok, ...(probe.detail ? { detail: probe.detail } : {}) });
        if (!probe.ok) {
            const botName = plugin.browserSession?.profileName ?? plugin.name;
            echoError(
                `channel probe for '${target.plugin}': ${probe.detail ?? `run \`kk bot open/login ${botName}\` to authenticate`}`,
            );
        }
    }

    try {
        await fs.ensureDir(join(workDir, '4-publish'));
        await fs.writeFile(
            join(workDir, '4-publish/check-targets.json'),
            `${JSON.stringify({ schemaVersion: 1, plugins: probes }, null, 2)}\n`,
        );
    } catch (error: unknown) {
        echoError(`itc-check-targets: cannot write probes: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    return 0;
}

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
    receiptExtras?: Partial<ItcReceipt>;
}

/** What one shared send pass did, keyed by row key. */
export interface SendRowsOutcome {
    sent: string[];
    skipped: string[];
    /** Rows whose succeeded receipt does not match what this pass would deliver (0332 R3). */
    reconciliationRequired: string[];
    receipts: ItcReceipt[];
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
    onReceipt?: (receipt: ItcReceipt) => Promise<void>;
    /**
     * Synthetic receipt writer for a `mode: dummy` row (task 0322). Absent means a dummy row cannot
     * be completed and records a failure instead — never a dispatch.
     */
    dummyReceipt?: (
        row: SendRow,
        context: { payloadPath: string; payloadDigest: string; startedAt: string },
    ) => Promise<ItcReceipt>;
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
                const priorReceipt = JSON.parse(await fs.readFile(targetReceiptPath)) as ItcReceipt;
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
            let prior: ItcReceipt | undefined;
            try {
                prior = priorRaw === undefined ? undefined : (JSON.parse(priorRaw) as ItcReceipt);
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
            const receipt: ItcReceipt = {
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
        if (reattempt && (await fs.exists(outPath))) await fs.deleteFile(outPath);
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

        const receipt: ItcReceipt = {
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

/**
 * Dispatches target sends via executor fan-out and records receipt files under 4-publish/receipts/.
 */
export async function itcSendTargets(
    args: string[],
    fs: FileSystem = createNodeFileSystem(),
    dispatch: (argv: string[]) => Promise<number> = runFanout,
): Promise<number> {
    const [workDir = ''] = args;
    const isRetry = args.includes('--retry');
    if (!workDir) {
        echoError('usage: itc-send-targets <work_dir> [--retry]');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    let plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    if (!plan.targets || plan.targets.length === 0) return 0;
    // A receipt is evidence for one run; without the frozen snapshot there is no run to bind it to.
    const parentRunId = (await readOptionsSnapshot(fs, workDir))?.parentRunId;
    if (!parentRunId) {
        echoError(`itc-send-targets: ${join(workDir, 'itc-options.json')} has no parentRunId`);
        return 1;
    }

    // Re-derive the per-target payloads from the plan's variant files before dispatch. The plan is
    // materialized BEFORE `adapt` in kk-itc.yaml, so the payloads written then carry whatever base
    // existed at that moment — the source article. Without this refresh an adapted translation never
    // reaches the wire: measured 2026-11-12, a `ja-article` plan dispatched the Chinese original.
    const { plugins } = discoverAllPlugins();
    plan = await prepareTargetPayloads(fs, workDir, plan, plugins);
    const targets = plan.targets ?? [];
    // An adapt:true variant with no file means the refresh fell back to the source article: the
    // target would ship the wrong locale. Say so; the send still records it as data.
    for (const target of targets) {
        const entry = plan.variants?.[target.variant];
        if (entry?.adapt !== true) continue;
        if (await fs.exists(join(publishDir, entry.file))) continue;
        echoError(
            `itc-send-targets: variant ${target.variant} has no ${entry.file}; '${target.plugin}' receives the ${plan.sourceLocale} source article`,
        );
    }

    const receiptsDir = join(publishDir, 'receipts');
    await fs.ensureDir(receiptsDir);

    const planRaw = await fs.readFile(planPath);
    const planDigest = createHash('sha256').update(planRaw).digest('hex');

    const rows: SendRow[] = targets.map((target) => ({
        key: target.plugin,
        plugin: target.plugin,
        profile: target.profile,
        mode: target.mode as 'draft' | 'live',
        payloadPath: join(workDir, target.payloadPath ?? `4-publish/content.${target.plugin}.json`),
        transport: target.transport,
    }));

    const outcome = await sendRows({
        rows,
        publishDir,
        receiptsDir,
        parentRunId,
        planDigest,
        retry: isRetry,
        label: 'itc-send-targets',
        fs,
        dispatch,
    });
    if (outcome.reconciliationRequired.length > 0) return 1;
    return 0;
}

/**
 * Reconciles target receipts against the plan and settles store selection.
 */
export async function itcReconcileReceipts(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-reconcile-receipts <work_dir>');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    const planPath = join(publishDir, 'publish-plan.json');
    if (!(await fs.exists(planPath))) return 0;

    const plan = JSON.parse(await fs.readFile(planPath)) as ItcPublishPlan;
    // Only a collected-topic run holds a store selection; a brief-driven run has nothing to settle.
    const chosenPath = join(workDir, 'chosen-source.json');
    const chosen = (await fs.exists(chosenPath))
        ? (JSON.parse(await fs.readFile(chosenPath)) as ChosenSourceArtifact)
        : undefined;
    const settle = async (outcome: ItcSelectionSettleRequest['outcome']): Promise<void> => {
        if (chosen === undefined) return;
        await itcSelectionSettle(
            {
                schemaVersion: 1,
                intakeDir: workDir,
                parentRunId: chosen.parentRunId,
                topicProfile: chosen.topicProfile,
                outcome,
            },
            fs,
        );
    };
    if (!plan.targets || plan.targets.length === 0) {
        await settle('author_only');
        return 0;
    }

    const receiptsDir = join(publishDir, 'receipts');
    const receipts: ItcReceipt[] = [];

    for (const target of plan.targets) {
        const rPath = join(receiptsDir, `${target.plugin}.json`);
        if (!(await fs.exists(rPath))) {
            echoError(`itc-reconcile-receipts: missing receipt for target '${target.plugin}'`);
            return 1;
        }
        try {
            const r = JSON.parse(await fs.readFile(rPath)) as ItcReceipt;
            receipts.push(r);
        } catch {
            echoError(`itc-reconcile-receipts: corrupt receipt for target '${target.plugin}'`);
            return 1;
        }
    }

    // Strongest known outcome: one confirmed live send promotes the selection; otherwise an
    // unresolved remote effect retains it for reconciliation; anything else releases it.
    const liveSuccess = receipts.some((r) => r.mode === 'live' && r.status === 'succeeded');
    const hasUncertain = receipts.some((r) => r.effect === 'unknown' || r.status === 'uncertain');
    const allSucceeded = receipts.every((r) => r.status === 'succeeded');
    await settle(liveSuccess ? 'published' : hasUncertain ? 'uncertain' : allSucceeded ? 'draft_only' : 'failed');

    return 0;
}

/**
 * Exports SEO prepublish request and published pages handoffs.
 */
export async function itcExportSeo(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', mode = 'handoff'] = args;
    if (!workDir) {
        echoError('usage: itc-export-seo <work_dir> [mode]');
        return 1;
    }
    const seoDir = join(workDir, 'seo');
    await fs.ensureDir(seoDir);

    if (mode === 'off') {
        await fs.writeFile(
            join(seoDir, 'prepublish-request.json'),
            `${JSON.stringify({ schemaVersion: 1, mode: 'off', status: 'not-assessed' }, null, 2)}\n`,
        );
        await fs.writeFile(
            join(seoDir, 'published-pages.json'),
            `${JSON.stringify({ schemaVersion: 1, mode: 'off', pages: [], status: 'not-assessed' }, null, 2)}\n`,
        );
        return 0;
    }

    // mode === 'handoff'
    const prepublish = {
        schemaVersion: 1,
        mode: 'handoff',
        status: 'ready',
        draftFile: '3-draft-draft-article.md',
    };
    await fs.writeFile(join(seoDir, 'prepublish-request.json'), `${JSON.stringify(prepublish, null, 2)}\n`);

    const receiptsDir = join(workDir, '4-publish/receipts');
    const verifiedPages: Array<{ plugin: string; url: string }> = [];

    if (await fs.exists(receiptsDir)) {
        for (const file of (await fs.readDir(receiptsDir)).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(await fs.readFile(join(receiptsDir, file))) as ItcReceipt;
                if (r.mode === 'live' && r.effect === 'confirmed' && r.publicUrlVerified === true && r.url) {
                    verifiedPages.push({ plugin: r.plugin, url: r.url });
                }
            } catch {
                // skip corrupt
            }
        }
    }

    const publishedPages = {
        schemaVersion: 1,
        mode: 'handoff',
        status: verifiedPages.length > 0 ? 'assessed' : 'not-assessed',
        pages: verifiedPages,
        ...(verifiedPages.length === 0 ? { reason: 'no verified public live URLs available' } : {}),
    };

    await fs.writeFile(join(seoDir, 'published-pages.json'), `${JSON.stringify(publishedPages, null, 2)}\n`);
    return 0;
}

/**
 * Emits final run summary report.json and report.md.
 */
export async function itcReportSummary(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = '', maxRevisions = '2'] = args;
    if (!workDir) {
        echoError('usage: itc-report-summary <work_dir> [max_revisions]');
        return 1;
    }
    const reportDir = join(workDir, '5-report');
    await fs.ensureDir(reportDir);

    let verdict = 'PASS';
    // Null while no verdict file exists (the manual/dry-run pass convention) or when the recorded
    // level is outside the judge's own enum.
    let confidence: string | null = null;
    let outcome = 'done';
    const verdictPath = join(workDir, '.itc-verdict.json');
    const hasVerdict = await fs.exists(verdictPath);
    if (hasVerdict) {
        try {
            const v = JSON.parse(await fs.readFile(verdictPath)) as { verdict?: unknown; confidence?: unknown };
            verdict = typeof v.verdict === 'string' ? v.verdict : 'PASS';
            // Same enum `itc-author-verdict` enforced when it wrote the disposition: a PASS is only
            // usable with the judge's HIGH|MEDIUM|LOW level, so the report never records one alone.
            confidence = ['HIGH', 'MEDIUM', 'LOW'].includes(String(v.confidence)) ? String(v.confidence) : null;
            if (verdict !== 'PASS' || confidence === null) outcome = 'failed';
        } catch {
            outcome = 'failed';
        }
    }

    let revisions = 0;
    const revPath = join(workDir, '.auto-revise-count');
    if (await fs.exists(revPath)) {
        try {
            revisions = Number((await fs.readFile(revPath)).trim()) || 0;
        } catch {
            revisions = 0;
        }
    }

    const receiptsDir = join(workDir, '4-publish/receipts');
    const receipts: ItcReceipt[] = [];
    if (await fs.exists(receiptsDir)) {
        for (const file of (await fs.readDir(receiptsDir)).filter((f) => f.endsWith('.json'))) {
            try {
                const r = JSON.parse(await fs.readFile(join(receiptsDir, file))) as ItcReceipt;
                receipts.push(r);
            } catch {
                // skip
            }
        }
    }

    if (receipts.some((r) => r.status !== 'succeeded')) {
        outcome = 'failed';
    }

    // R5: the receipts must be exactly the frozen plan's targets, bound to that plan's digest.
    const planPath = join(workDir, '4-publish/publish-plan.json');
    let targetContract: { expected: string[]; observed: string[]; stale: string[] } | undefined;
    if (await fs.exists(planPath)) {
        const planRaw = await fs.readFile(planPath);
        const planDigest = createHash('sha256').update(planRaw).digest('hex');
        const expected = ((JSON.parse(planRaw) as ItcPublishPlan).targets ?? []).map((t) => t.plugin).sort();
        const observed = receipts.map((r) => r.plugin).sort();
        const stale = receipts.filter((r) => r.planDigest !== planDigest).map((r) => r.plugin);
        if (expected.join('\n') !== observed.join('\n') || stale.length > 0) {
            targetContract = { expected, observed, stale };
            outcome = 'failed';
        }
    }

    const reportJson = {
        outcome,
        verdict,
        confidence,
        revisions,
        receipts,
        ...(targetContract ? { targetContractFailure: targetContract } : {}),
        maxRevisions: Number(maxRevisions) || 2,
    };

    await fs.writeFile(join(reportDir, 'report.json'), `${JSON.stringify(reportJson, null, 2)}\n`);

    const md = [
        '# ITC Publication Run Report',
        '',
        `- Outcome: ${outcome}`,
        `- Verdict: ${verdict}`,
        // A verdict file whose level is outside the enum is stated, never silently dropped.
        `- Confidence: ${confidence ?? (hasVerdict ? 'unknown (recorded value is outside HIGH/MEDIUM/LOW)' : 'not recorded')}`,
        `- Revisions: ${revisions}`,
        `- Target Receipts: ${receipts.length}`,
        ...(targetContract
            ? [
                  `- Target contract failure: expected [${targetContract.expected.join(', ')}], observed [${targetContract.observed.join(', ')}], stale [${targetContract.stale.join(', ')}]`,
              ]
            : []),
        '',
        '## Targets',
        ...receipts.map((r) => `- ${r.plugin} (${r.profile}): status=${r.status}, effect=${r.effect}`),
    ].join('\n');

    await fs.writeFile(join(reportDir, 'report.md'), `${md}\n`);
    return 0;
}

/**
 * Judge disposition (0301/0302): collapse the verdict + revision counters into ONE
 * outcome word so each transition guard stays a single predicate over a result
 * file (ADR-115 composition budget).
 *
 * Writes `<workDir>/.itc/disposition.txt` with exactly one of:
 * `finish` | `revise` | `autorevise` | `fail`.
 */
export async function itcAuthorVerdict(args: string[], fs: FileSystem = createNodeFileSystem()): Promise<number> {
    const [workDir = ''] = args;
    if (!workDir) {
        echoError('usage: itc-author-verdict <work_dir>');
        return 1;
    }
    const auto = process.env.KK_ITC_AUTO === 'true';
    const maxRevisions = Number(process.env.KK_ITC_MAX_REVISIONS ?? '2') || 2;

    const readCount = async (name: string): Promise<number> => {
        const p = join(workDir, name);
        if (!(await fs.exists(p))) return 0;
        const n = Number((await fs.readFile(p)).trim());
        return Number.isFinite(n) ? n : 0;
    };

    const verdictPath = join(workDir, '.itc-verdict.json');
    let verdict = '';
    let confidence = '';
    if (await fs.exists(verdictPath)) {
        try {
            const v = JSON.parse(await fs.readFile(verdictPath)) as {
                verdict?: unknown;
                confidence?: unknown;
            };
            verdict = typeof v.verdict === 'string' ? v.verdict : '';
            confidence = typeof v.confidence === 'string' ? v.confidence : '';
        } catch {
            verdict = 'malformed';
        }
    }

    let disposition: 'finish' | 'revise' | 'autorevise' | 'fail';
    if (verdict === '') {
        // No verdict file: the dry-run / manual-review convention treats it as a pass.
        disposition = 'finish';
    } else if (verdict === 'PASS' && ['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) {
        disposition = 'finish';
    } else if (verdict === 'NEEDS_REVISION') {
        if (auto) {
            disposition = (await readCount('.auto-revise-count')) < maxRevisions ? 'autorevise' : 'fail';
        } else {
            disposition = (await readCount('.revise-count')) < 3 ? 'revise' : 'fail';
        }
    } else {
        // FAIL, a PASS with an out-of-enum confidence, or an unparseable verdict.
        disposition = 'fail';
    }

    await fs.ensureDir(join(workDir, '.itc'));
    await fs.writeFile(join(workDir, '.itc/disposition.txt'), `${disposition}\n`);
    return 0;
}
