import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { type Content, ContentSchema, discoverAllPlugins, type PluginRecord } from '@gobing-ai/kk-core';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { loadPublishPreset, type PublishPresetTarget, type PublishWindow, PublishWindowSchema } from './itc-plan';
import { type ItcReceipt, probePlugin, type SendRow, sendRows } from './itc-publish';

/** One frozen asset a bundle ships: a `Content` JSON path plus its sha256. */
export const BundleVariantSchema = z
    .object({
        path: z.string().min(1),
        sha256: z.string().min(1),
    })
    .strict();

/**
 * The frozen handover between the generate workflow and every publish run (design §2).
 *
 * `path` values resolve against the bundle file's own directory, so a bundle and its variants move
 * together as one artifact.
 */
export const BundleSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        runId: z.string().min(1),
        runDate: z.string().min(1),
        parentRunId: z.string().min(1).optional(),
        runs: z.array(z.string()).default([]),
        episode: z.object({ title: z.string().min(1), guid: z.string().optional() }).strict(),
        variants: z.record(z.string(), BundleVariantSchema),
    })
    .strict();

/** Parsed bundle. */
export type Bundle = z.infer<typeof BundleSchema>;

/** One planned publish target: everything a send needs, plus the console's approval flag. */
export const PublishPlanRowSchema = z
    .object({
        id: z.string().min(1),
        plugin: z.string().min(1),
        operation: z.string().min(1).optional(),
        variant: z.string().min(1),
        tier: z.number().int().min(0).max(3),
        window: PublishWindowSchema,
        mode: z.enum(['dummy', 'draft', 'live']),
        required: z.boolean(),
        approval: z.enum(['none', 'required']),
        status: z.literal('planned'),
        profile: z.string().min(1).optional(),
        payloadPath: z.string().min(1),
        payloadDigest: z.string().min(1),
    })
    .strict();

/** Parsed plan row. */
export type PublishPlanRow = z.infer<typeof PublishPlanRowSchema>;

/** One window's publish plan (`4-publish/plan.<window>.json`). */
export const PublishPlanSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        window: PublishWindowSchema,
        bundleRunId: z.string().min(1),
        parentRunId: z.string().min(1),
        presetName: z.string().min(1),
        presetDigest: z.string().min(1),
        rows: z.array(PublishPlanRowSchema),
    })
    .strict();

/** Parsed plan. */
export type PublishPlan = z.infer<typeof PublishPlanSchema>;

/** Injection seams: the stage entry uses the defaults, the E2E test passes its own. */
export interface PublishMatrixDeps {
    fs?: FileSystem;
    projectRoot?: string;
    plugins?: readonly PluginRecord[];
    dispatch?: (argv: string[]) => Promise<number>;
    executor?: ProcessExecutor;
}

/**
 * Escapes nothing and keeps CJK: only whitespace and `/` become `-`, so an operation named 上传图文
 * stays readable in a receipt filename.
 */
function slugify(value: string): string {
    return value.trim().replace(/[\s/]+/g, '-');
}

/**
 * Receipt/payload key for a preset target.
 *
 * itc rows carry no operation, so their key stays the plugin name and their artefacts are unchanged
 * (feature G15 R6); voice3 has several operations per plugin, so the operation joins the key.
 */
export function targetId(target: PublishPresetTarget): string {
    if (target.id) return target.id;
    if (target.operation) return `${target.plugin}.${slugify(target.operation)}`;
    return target.plugin;
}

/** Value of a `--flag value` pair, or undefined when the flag is absent. */
function flagValue(args: readonly string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx === -1) return undefined;
    const value = args[idx + 1];
    return value !== undefined && !value.startsWith('--') ? value : undefined;
}

/** Comma-separated list value of a `--flag a,b` pair, empty when absent. */
function listValue(args: readonly string[], flag: string): string[] {
    const raw = flagValue(args, flag);
    if (raw === undefined) return [];
    return raw
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
}

/** Append one JSON line to `4-publish/publish-events.jsonl` (design §5b). */
async function appendEvent(fs: FileSystem, publishDir: string, event: Record<string, unknown>): Promise<void> {
    await fs.ensureDir(publishDir);
    const path = join(publishDir, 'publish-events.jsonl');
    const prior = (await fs.exists(path)) ? await fs.readFile(path) : '';
    await fs.writeFile(path, `${prior}${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

/**
 * Tier-0 targets whose published URL fills a link placeholder (design §5).
 *
 * This is the publication contract, not a channel table: the owned surfaces are what every
 * downstream channel links to, so they are the only ones whose URL can be resolved.
 */
const LINK_SOURCES: ReadonlyArray<{ placeholder: string; plugin: string; receipt: 'article' | 'podcast' }> = [
    { placeholder: '{{article_url}}', plugin: 'surfdash-pub', receipt: 'article' },
    { placeholder: '{{podcast_url}}', plugin: 'podcast-pub', receipt: 'podcast' },
];

/** Resolved link targets for placeholder substitution. */
type LinkMap = Partial<Record<'article' | 'podcast', string>>;

/** Read the plan's rows for one window, failing on a missing or malformed plan. */
async function readPlan(fs: FileSystem, workDir: string, window: PublishWindow): Promise<PublishPlan> {
    const planPath = join(workDir, '4-publish', `plan.${window}.json`);
    if (!(await fs.exists(planPath))) {
        throw new Error(`no plan at ${planPath}; run publish-matrix-plan first`);
    }
    const parsed = PublishPlanSchema.safeParse(JSON.parse(await fs.readFile(planPath)));
    if (!parsed.success) {
        throw new Error(`malformed plan at ${planPath}: ${parsed.error.message}`);
    }
    return parsed.data;
}

/** Build the plan document and its per-target payloads in memory (nothing written). */
async function composePlan(
    fs: FileSystem,
    input: {
        workDir: string;
        bundlePath: string;
        preset: string;
        window: PublishWindow;
        channels: readonly string[];
        liveChannels: readonly string[];
        dummy: boolean;
        projectRoot?: string;
    },
): Promise<PublishPlan> {
    const bundleAbs = resolve(input.bundlePath);
    if (!(await fs.exists(bundleAbs))) throw new Error(`bundle not found: ${bundleAbs}`);
    const bundleParsed = BundleSchema.safeParse(JSON.parse(await fs.readFile(bundleAbs)));
    if (!bundleParsed.success) {
        throw new Error(`malformed bundle at ${bundleAbs}: ${bundleParsed.error.message}`);
    }
    const bundle = bundleParsed.data;
    const bundleDir = dirname(bundleAbs);

    const { preset, digest } = await loadPublishPreset(
        input.preset,
        { ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}) },
        fs,
    );

    const inWindow = preset.targets.filter(
        (target) => (target.window ?? 'after-generate') === input.window && (target.mode ?? 'draft') !== 'off',
    );

    // Launch vars may only narrow or promote what the preset already lists. A token that matches no
    // preset target at all is a typo, so it fails instead of silently planning nothing.
    const matches = (target: PublishPresetTarget, token: string): boolean =>
        target.plugin === token || target.id === token;
    for (const token of [...input.channels, ...input.liveChannels]) {
        if (!preset.targets.some((target) => matches(target, token))) {
            throw new Error(`channel '${token}' is not listed in preset '${preset.name}'`);
        }
    }
    for (const token of [...input.channels, ...input.liveChannels]) {
        if (!inWindow.some((target) => matches(target, token))) {
            throw new Error(`channel '${token}' has no target in window '${input.window}'`);
        }
    }

    const selected =
        input.channels.length === 0
            ? inWindow
            : inWindow.filter((target) => input.channels.some((token) => matches(target, token)));

    const rows: PublishPlanRow[] = [];
    const seen = new Set<string>();
    for (const target of selected) {
        const id = targetId(target);
        if (seen.has(id)) throw new Error(`duplicate target id '${id}' in preset '${preset.name}'`);
        seen.add(id);

        const liveToken = input.liveChannels.find((token) => matches(target, token));
        if (liveToken !== undefined && target.mode === 'dummy') {
            throw new Error(`channel '${liveToken}' is dummy-only and cannot be promoted to live`);
        }
        const mode: PublishPlanRow['mode'] = input.dummy
            ? 'dummy'
            : liveToken !== undefined
              ? 'live'
              : target.mode === 'dummy'
                ? 'dummy'
                : 'draft';

        if (target.variant === undefined) {
            throw new Error(`target '${id}' has no variant; a publish-matrix target must name one`);
        }
        // A channel-specific variant wins over the shared one, so generate can ship 小红书-only copy
        // without a preset change.
        const entry = bundle.variants[`${target.variant}@${target.plugin}`] ?? bundle.variants[target.variant];
        if (entry === undefined) {
            throw new Error(`bundle has no variant '${target.variant}' for target '${id}'`);
        }
        const variantPath = resolve(bundleDir, entry.path);
        if (!(await fs.exists(variantPath))) throw new Error(`variant file not found: ${variantPath}`);
        const variantRaw = await fs.readFile(variantPath);
        const actual = createHash('sha256').update(variantRaw).digest('hex');
        if (actual !== entry.sha256) {
            throw new Error(`variant digest mismatch for '${target.variant}': expected ${entry.sha256}, got ${actual}`);
        }
        const parsedContent = ContentSchema.safeParse(JSON.parse(variantRaw));
        if (!parsedContent.success) {
            throw new Error(`variant '${target.variant}' is not valid Content: ${parsedContent.error.message}`);
        }

        const payload: Content = {
            ...parsedContent.data,
            metadata: {
                ...(parsedContent.data.metadata ?? {}),
                ...(target.options ?? {}),
                // Operation and publish status are last so a stray `options` key cannot flip a row's
                // mode behind the plan's back.
                ...(target.operation !== undefined ? { operation: target.operation } : {}),
                publishStatus: mode === 'live' ? 'public' : 'draft',
            },
        };
        const payloadRelative = `4-publish/payloads/content.${id}.json`;
        const payloadText = `${JSON.stringify(payload, null, 2)}\n`;

        rows.push({
            id,
            plugin: target.plugin,
            ...(target.operation !== undefined ? { operation: target.operation } : {}),
            variant: target.variant,
            tier: target.tier ?? 3,
            window: input.window,
            mode,
            required: target.required ?? false,
            // Approval is recorded only: enforcement is the workflow's pause node (ADR-022), and the
            // console attaches through this field (design §5b).
            approval: mode === 'live' ? 'required' : 'none',
            status: 'planned',
            ...(target.profile !== undefined ? { profile: target.profile } : {}),
            payloadPath: payloadRelative,
            payloadDigest: createHash('sha256').update(payloadText).digest('hex'),
        });
        await fs.ensureDir(join(input.workDir, '4-publish', 'payloads'));
        await fs.writeFile(join(input.workDir, payloadRelative), payloadText);
    }

    return {
        schemaVersion: 1,
        window: input.window,
        bundleRunId: bundle.runId,
        parentRunId: bundle.parentRunId ?? bundle.runId,
        presetName: preset.name,
        presetDigest: digest,
        rows,
    };
}

/**
 * `publish-matrix-plan`: freeze one window's target rows and their per-target payloads.
 *
 * Writes `4-publish/plan.<window>.json`, appends a `planned` line per row, and fails (exit 1) on an
 * unknown preset, a preset row carrying `mode: live`, an unlisted live promotion, a missing or
 * digest-mismatched variant or a duplicate target id.
 */
export async function planPublishMatrix(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const bundlePath = flagValue(args, '--bundle');
    const preset = flagValue(args, '--preset');
    const windowArg = flagValue(args, '--window');
    const channels = listValue(args, '--channels');
    const liveChannels = listValue(args, '--live-channels');
    const dummy = args.includes('--dummy');

    if (!workDir || bundlePath === undefined || preset === undefined || windowArg === undefined) {
        echoError(
            'usage: publish-matrix-plan <work_dir> --bundle <bundle.json> --preset <slug> --window <after-generate|cn-peak|overseas-rss> [--channels a,b] [--live-channels a,b] [--dummy]',
        );
        return 1;
    }
    const parsedWindow = PublishWindowSchema.safeParse(windowArg);
    if (!parsedWindow.success) {
        echoError(`publish-matrix-plan: unknown window '${windowArg}'`);
        return 1;
    }
    if (dummy && liveChannels.length > 0) {
        echoError('publish-matrix-plan: --dummy is a rehearsal and cannot be combined with --live-channels');
        return 1;
    }

    try {
        const plan = await composePlan(fs, {
            workDir,
            bundlePath,
            preset,
            window: parsedWindow.data,
            channels,
            liveChannels,
            dummy,
            ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
        });
        const publishDir = join(workDir, '4-publish');
        await fs.ensureDir(publishDir);
        await fs.writeFile(join(publishDir, `plan.${plan.window}.json`), `${JSON.stringify(plan, null, 2)}\n`);
        for (const row of plan.rows) {
            await appendEvent(fs, publishDir, {
                event: 'planned',
                window: plan.window,
                id: row.id,
                plugin: row.plugin,
                mode: row.mode,
                tier: row.tier,
            });
        }
        echo(`${plan.rows.length} target(s) planned for window ${plan.window}`);
        return 0;
    } catch (err: unknown) {
        echoError(`publish-matrix-plan: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/**
 * `publish-matrix-check`: readiness probes for the plan's non-dummy plugins.
 *
 * Warn-only (exit 0): a probe refusal is recorded and printed, never a run failure — the send's own
 * receipt is the authority on whether a channel could actually publish.
 */
export async function checkPublishMatrix(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const windowArg = flagValue(args, '--window');
    if (!workDir || windowArg === undefined) {
        echoError('usage: publish-matrix-check <work_dir> --window <after-generate|cn-peak|overseas-rss>');
        return 1;
    }
    const parsedWindow = PublishWindowSchema.safeParse(windowArg);
    if (!parsedWindow.success) {
        echoError(`publish-matrix-check: unknown window '${windowArg}'`);
        return 1;
    }

    try {
        const plan = await readPlan(fs, workDir, parsedWindow.data);
        const plugins = deps.plugins ?? discoverAllPlugins().plugins;
        const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
        const executor = deps.executor ?? new NodeProcessExecutor();
        const probes: Array<{ plugin: string; ok: boolean; detail?: string }> = [];

        for (const name of [...new Set(plan.rows.filter((row) => row.mode !== 'dummy').map((row) => row.plugin))]) {
            const plugin = byName.get(name);
            if (plugin === undefined) {
                probes.push({ plugin: name, ok: false, detail: 'plugin not installed' });
                echoError(`publish-matrix-check: plugin '${name}' is not installed`);
                continue;
            }
            const probe = await probePlugin(plugin, executor);
            probes.push({ plugin: name, ok: probe.ok, ...(probe.detail ? { detail: probe.detail } : {}) });
            if (!probe.ok) {
                echoError(`publish-matrix-check: channel probe for '${name}' refused: ${probe.detail ?? 'unknown'}`);
            }
        }

        const publishDir = join(workDir, '4-publish');
        await fs.ensureDir(publishDir);
        await fs.writeFile(
            join(publishDir, `check.${plan.window}.json`),
            `${JSON.stringify({ schemaVersion: 1, window: plan.window, plugins: probes }, null, 2)}\n`,
        );
        return 0;
    } catch (err: unknown) {
        echoError(`publish-matrix-check: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/**
 * Whether a row's receipt on disk (this pass or an earlier one) already records a success: one
 * tier-0 row skipping because it succeeded last night must not read as a failure, or "never resend"
 * would quietly become "never deliver".
 */
async function readSucceeded(fs: FileSystem, receiptsDir: string, id: string): Promise<boolean> {
    const path = join(receiptsDir, `${id}.json`);
    if (!(await fs.exists(path))) return false;
    try {
        return (JSON.parse(await fs.readFile(path)) as ItcReceipt).status === 'succeeded';
    } catch {
        return false;
    }
}

/** Read the tier-0 receipts a link placeholder resolves from. */
async function readLinkMap(fs: FileSystem, receiptsDir: string, rows: readonly PublishPlanRow[]): Promise<LinkMap> {
    const map: LinkMap = {};
    for (const source of LINK_SOURCES) {
        const row = rows.find((candidate) => candidate.plugin === source.plugin && candidate.tier === 0);
        if (row === undefined) continue;
        const path = join(receiptsDir, `${row.id}.json`);
        if (!(await fs.exists(path))) continue;
        try {
            const receipt = JSON.parse(await fs.readFile(path)) as ItcReceipt;
            if (receipt.status === 'succeeded' && receipt.url) map[source.receipt] = receipt.url;
        } catch {
            // an unreadable tier-0 receipt simply leaves the placeholder unresolved
        }
    }
    return map;
}

/**
 * `publish-matrix-send`: dispatch the plan's rows in tier order and record one receipt per row.
 *
 * Tier 0 is the publication contract: serial, and a failed `required` tier-0 row skips every later
 * tier. Resend rules are the itc ones, inherited through `sendRows` — a succeeded row is skipped, a
 * live row with an unknown effect is never resent, and `--retry` only resends `effect: none`
 * failures.
 */
export async function sendPublishMatrix(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const windowArg = flagValue(args, '--window');
    const tierArg = flagValue(args, '--tier');
    const retry = args.includes('--retry');
    if (!workDir || windowArg === undefined) {
        echoError('usage: publish-matrix-send <work_dir> --window <w> [--retry] [--tier <n>]');
        return 1;
    }
    const parsedWindow = PublishWindowSchema.safeParse(windowArg);
    if (!parsedWindow.success) {
        echoError(`publish-matrix-send: unknown window '${windowArg}'`);
        return 1;
    }
    let onlyTier: number | undefined;
    if (tierArg !== undefined) {
        onlyTier = Number(tierArg);
        if (!Number.isInteger(onlyTier) || onlyTier < 0 || onlyTier > 3) {
            echoError(`publish-matrix-send: --tier must be 0-3, got '${tierArg}'`);
            return 1;
        }
    }

    try {
        const plan = await readPlan(fs, workDir, parsedWindow.data);
        const publishDir = join(workDir, '4-publish');
        const receiptsDir = join(publishDir, 'receipts');
        await fs.ensureDir(receiptsDir);
        const planDigest = createHash('sha256')
            .update(await fs.readFile(join(publishDir, `plan.${plan.window}.json`)))
            .digest('hex');

        const succeededAlready = (id: string): Promise<boolean> => readSucceeded(fs, receiptsDir, id);
        const tiers = [...new Set(plan.rows.map((row) => row.tier))].sort((a, b) => a - b);
        const pending = onlyTier === undefined ? plan.rows : plan.rows.filter((row) => row.tier === onlyTier);

        let tierZeroBroken = false;
        for (const tier of tiers) {
            const rows = pending.filter((row) => row.tier === tier);
            if (rows.length === 0) continue;
            if (tierZeroBroken) {
                for (const row of rows) {
                    await appendEvent(fs, publishDir, {
                        event: 'skipped',
                        window: plan.window,
                        id: row.id,
                        plugin: row.plugin,
                        reason: 'tier-0-required-failed',
                    });
                }
                continue;
            }

            const links = tier === 0 ? {} : await readLinkMap(fs, receiptsDir, plan.rows);
            const sendRowsInput: SendRow[] = rows.map((row) => ({
                key: row.id,
                plugin: row.plugin,
                profile: row.profile ?? 'article',
                mode: row.mode === 'live' ? 'live' : 'draft',
                payloadPath: join(workDir, row.payloadPath),
                transport: 'fanout',
                receiptExtras: { target: row.id, window: plan.window },
            }));

            await sendRows({
                rows: sendRowsInput,
                publishDir,
                receiptsDir,
                parentRunId: plan.parentRunId,
                planDigest,
                retry,
                label: 'publish-matrix-send',
                fs,
                ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
                preparePayload: async (row) => {
                    const planRow = rows.find((candidate) => candidate.id === row.key);
                    // shortcut: dummy rows record a no-effect failure instead of a synthetic receipt;
                    // task 0322 replaces this branch with the real dummy semantics.
                    if (planRow?.mode === 'dummy') return { error: 'dummy-mode-not-implemented' };
                    if (tier === 0) return { payloadPath: row.payloadPath };
                    const raw = (await fs.exists(row.payloadPath)) ? await fs.readFile(row.payloadPath) : '';
                    let resolved = raw;
                    for (const source of LINK_SOURCES) {
                        const url = links[source.receipt];
                        if (url === undefined) continue;
                        resolved = resolved.split(source.placeholder).join(url);
                    }
                    if (LINK_SOURCES.some((source) => resolved.includes(source.placeholder))) {
                        return { error: 'unresolved-link' };
                    }
                    const resolvedPath = join(workDir, '4-publish', 'payloads', `content.${row.key}.resolved.json`);
                    await fs.writeFile(resolvedPath, resolved);
                    return { payloadPath: resolvedPath };
                },
                onReceipt: async (receipt) => {
                    await appendEvent(fs, publishDir, {
                        event: receipt.status === 'succeeded' ? 'sent' : 'failed',
                        window: plan.window,
                        id: receipt.target ?? receipt.plugin,
                        plugin: receipt.plugin,
                        mode: receipt.mode,
                        effect: receipt.effect,
                        ...(receipt.error ? { error: receipt.error } : {}),
                    });
                },
            });

            if (tier === 0) {
                // The publication contract: a required tier-0 row that did not succeed skips every
                // later tier, because downstream payloads link what tier 0 published. A row an
                // earlier pass already delivered (skipped here as succeeded) still satisfies it —
                // otherwise re-entering the window after a T2 failure would skip T2 forever.
                tierZeroBroken = false;
                for (const row of rows) {
                    if (!row.required) continue;
                    if (await succeededAlready(row.id)) continue;
                    tierZeroBroken = true;
                    break;
                }
            }
        }

        echo(`window ${plan.window}: ${pending.length} target(s) dispatched`);
        return 0;
    } catch (err: unknown) {
        echoError(`publish-matrix-send: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}
