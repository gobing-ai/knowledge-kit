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
import { resolveItcConfigPath } from './itc-config';
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

/** One classified plan row: the receipt's own words, plus `missing` when none was written. */
export const PublishOutcomeRowSchema = z
    .object({
        id: z.string().min(1),
        tier: z.number().int().min(0).max(3),
        required: z.boolean(),
        status: z.enum(['succeeded', 'failed', 'uncertain', 'missing']),
        effect: z.enum(['none', 'confirmed', 'unknown']).optional(),
        dummy: z.boolean(),
    })
    .strict();

/** One window's publish outcome (`4-publish/outcome.<window>.json`). */
export const PublishOutcomeSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        window: PublishWindowSchema,
        runDate: z.string().min(1),
        status: z.enum(['full', 'partial', 'none', 'dummy']),
        published: z.number().int().min(0),
        targets: z.number().int().min(0),
        rows: z.array(PublishOutcomeRowSchema),
    })
    .strict();

/** Parsed publish outcome. */
export type PublishOutcome = z.infer<typeof PublishOutcomeSchema>;

/**
 * Classify one window's plan against its receipts — pure, so it is checkable without a filesystem.
 *
 * Computed over the **non-dummy** rows only (task 0326 R2): a dummy receipt records a rehearsal, so
 * it can never make a window `full`. `full` means every non-dummy row succeeded, `partial` that at
 * least one did, `none` that none did, and `dummy` that the window had nothing but rehearsals. A
 * planned row with no receipt is `missing` and counts as not succeeded — a window that never
 * dispatched must not read as published.
 */
export function classifyPublishMatrix(
    plan: PublishPlan,
    receipts: readonly ItcReceipt[],
    runDate: string,
): PublishOutcome {
    const byTarget = new Map<string, ItcReceipt>();
    for (const receipt of receipts) {
        const key = receipt.target ?? receipt.plugin;
        byTarget.set(key, receipt);
    }

    const rows = plan.rows.map((row) => {
        const receipt = byTarget.get(row.id);
        return {
            id: row.id,
            tier: row.tier,
            required: row.required,
            status: receipt?.status ?? ('missing' as const),
            ...(receipt?.effect !== undefined ? { effect: receipt.effect } : {}),
            dummy: receipt?.dummy === true,
        };
    });

    const real = rows.filter((row) => !row.dummy);
    const succeeded = real.filter((row) => row.status === 'succeeded');
    const status: PublishOutcome['status'] =
        real.length === 0
            ? 'dummy'
            : succeeded.length === real.length
              ? 'full'
              : succeeded.length > 0
                ? 'partial'
                : 'none';

    return {
        schemaVersion: 1,
        window: plan.window,
        runDate,
        status,
        published: succeeded.length,
        targets: real.length,
        rows,
    };
}

/** Legacy per-target result file each tier-0 owned plugin bridges into (task 0326 R3). */
const LEGACY_RESULT_FILES: ReadonlyArray<{ plugin: string; file: string }> = [
    { plugin: 'surfdash-pub', file: '_14_publish-surfdash_result.json' },
    { plugin: 'podcast-pub', file: '_16_publish-podcast_result.json' },
];

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
    const presetFlag = flagValue(args, '--preset');
    const windowArg = flagValue(args, '--window');
    const channels = listValue(args, '--channels');
    const liveChannels = listValue(args, '--live-channels');
    const dummy = args.includes('--dummy');

    if (!workDir || bundlePath === undefined || windowArg === undefined) {
        echoError(
            'usage: publish-matrix-plan <work_dir> --bundle <bundle.json> [--preset <slug>] --window <after-generate|cn-peak|overseas-rss> [--channels a,b] [--live-channels a,b] [--dummy]',
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
        // `--preset` wins; otherwise the operator's config selector decides (task 0323 R2), so the
        // workflow YAML never names a preset file.
        const preset = presetFlag ?? (await readPublishPresetSelector(process.env, fs));
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
    const presetFlag = flagValue(args, '--preset');
    const allWindows = args.includes('--all-windows');
    const presetMode = allWindows;
    if (!workDir || (windowArg === undefined && !presetMode)) {
        echoError(
            'usage: publish-matrix-check <work_dir> --window <after-generate|cn-peak|overseas-rss> | [--preset <slug>] --all-windows',
        );
        return 1;
    }

    const plugins = deps.plugins ?? discoverAllPlugins().plugins;
    const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
    const executor = deps.executor ?? new NodeProcessExecutor();
    const probes: Array<{ plugin: string; ok: boolean; detail?: string }> = [];

    try {
        // Two ways to reach the same probe loop. A plan answers "what will this window send?"; a
        // preset answers "which channels does this operator publish to at all?", which is the only
        // question answerable before generation exists (task 0325 R1/R2).
        let names: string[];
        let outFile: string;
        let label: string;
        if (presetMode) {
            const { preset } = await loadPublishPreset(
                presetFlag ?? (await readPublishPresetSelector(process.env, fs)),
                { ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}) },
                fs,
            );
            const unknown = preset.targets.filter((target) => !byName.has(target.plugin));
            if (unknown.length > 0) {
                echoError(
                    `publish-matrix-check: preset '${preset.name}' names uninstalled plugin(s): ${unknown
                        .map((target) => target.plugin)
                        .join(', ')}`,
                );
                return 1;
            }
            // A dummy or off row never spawns a plugin, so it never needs a warm session.
            names = [
                ...new Set(
                    preset.targets
                        .filter((target) => (target.mode ?? 'draft') !== 'off' && target.mode !== 'dummy')
                        .map((target) => target.plugin),
                ),
            ];
            label = 'preflight';
            outFile = 'check.preflight.json';
        } else {
            const parsedWindow = PublishWindowSchema.safeParse(windowArg);
            if (!parsedWindow.success) {
                echoError(`publish-matrix-check: unknown window '${windowArg}'`);
                return 1;
            }
            const plan = await readPlan(fs, workDir, parsedWindow.data);
            names = [...new Set(plan.rows.filter((row) => row.mode !== 'dummy').map((row) => row.plugin))];
            label = plan.window;
            outFile = `check.${plan.window}.json`;
        }

        for (const name of names) {
            const plugin = byName.get(name);
            if (plugin === undefined) {
                // Plan mode: a planned row whose plugin vanished is a runtime gap, reported not fatal.
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
            join(publishDir, outFile),
            `${JSON.stringify({ schemaVersion: 1, window: label, plugins: probes }, null, 2)}\n`,
        );
        echo(names.length === 0 ? 'no probes' : `${probes.length} probe(s) recorded for ${label}`);
        return 0;
    } catch (err: unknown) {
        echoError(`publish-matrix-check: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/**
 * `publish-matrix-classify`: turn one window's receipts into `full|partial|none|dummy`.
 *
 * Always exits 0 once it can read the plan — routing is the workflow's job (task 0326 R1). For the
 * `after-generate` window it also bridges the tier-0 owned receipts into the legacy
 * `31-publish/<runDate>_14|_16_…_result.json` names, so `daily-patch-surfdash`,
 * `daily-publish-partial`, `run-report` and the board keep working on a voice3 work dir.
 */
export async function runPublishMatrixClassify(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const windowArg = flagValue(args, '--window');
    const runDate = flagValue(args, '--run-date');
    if (!workDir || windowArg === undefined || runDate === undefined) {
        echoError('usage: publish-matrix-classify <work_dir> --window <w> --run-date <stamp>');
        return 1;
    }
    const parsedWindow = PublishWindowSchema.safeParse(windowArg);
    if (!parsedWindow.success) {
        echoError(`publish-matrix-classify: unknown window '${windowArg}'`);
        return 1;
    }

    const publishDir = join(workDir, '4-publish');
    let plan: PublishPlan;
    try {
        plan = await readPlan(fs, workDir, parsedWindow.data);
    } catch (err: unknown) {
        // No plan means nothing was dispatched for this window: `none`, reported, never fatal.
        echoError(`publish-matrix-classify: ${err instanceof Error ? err.message : String(err)}`);
        await fs.ensureDir(publishDir);
        const none: PublishOutcome = {
            schemaVersion: 1,
            window: parsedWindow.data,
            runDate,
            status: 'none',
            published: 0,
            targets: 0,
            rows: [],
        };
        await fs.writeFile(join(publishDir, `outcome.${parsedWindow.data}.json`), `${JSON.stringify(none, null, 2)}\n`);
        await fs.writeFile(join(publishDir, `publish-status.${parsedWindow.data}.txt`), 'none\n');
        // `kk ledger append` reads `<node>.summary.txt` for its Result cell, so the none branch writes
        // it too: a window that never planned must read `none` in the ledger, not blank.
        await fs.writeFile(
            join(workDir, 'publish-classify.summary.txt'),
            `${JSON.stringify({ status: 'none', published: 0, targets: 0 })}\n`,
        );
        return 0;
    }

    const receiptsDir = join(publishDir, 'receipts');
    const receipts: ItcReceipt[] = [];
    for (const row of plan.rows) {
        const path = join(receiptsDir, `${row.id}.json`);
        if (!(await fs.exists(path))) continue;
        try {
            receipts.push(JSON.parse(await fs.readFile(path)) as ItcReceipt);
        } catch {
            // an unreadable receipt is a row with no evidence: it stays `missing`
        }
    }

    const outcome = classifyPublishMatrix(plan, receipts, runDate);
    await fs.ensureDir(publishDir);
    await fs.writeFile(join(publishDir, `outcome.${outcome.window}.json`), `${JSON.stringify(outcome, null, 2)}\n`);
    await fs.writeFile(join(publishDir, `publish-status.${outcome.window}.txt`), `${outcome.status}\n`);

    // The ledger reads `<node>.summary.txt` for its Result cell (task 0212 R1); same shape as voice2.
    await fs.writeFile(
        join(workDir, 'publish-classify.summary.txt'),
        `${JSON.stringify({ status: outcome.status, published: outcome.published, targets: outcome.targets })}\n`,
    );

    if (outcome.window === 'after-generate') {
        // ponytail: legacy 31-publish names kept so voice2-era stages run on voice3 dirs; drop when
        // voice2 retires (the receipt-native rewrite is the console task's).
        const legacyDir = join(workDir, '31-publish');
        for (const source of LEGACY_RESULT_FILES) {
            const row = plan.rows.find((candidate) => candidate.plugin === source.plugin && candidate.tier === 0);
            if (row === undefined || row.mode === 'dummy') continue;
            const receipt = receipts.find((candidate) => (candidate.target ?? candidate.plugin) === row.id);
            if (receipt === undefined || receipt.dummy === true || receipt.aggregatePath === undefined) continue;
            const aggregate = receipt.aggregatePath;
            if (!(await fs.exists(aggregate))) continue;
            await fs.ensureDir(legacyDir);
            await fs.writeFile(join(legacyDir, `${runDate}${source.file}`), await fs.readFile(aggregate));
        }
    }

    echo(outcome.status);
    return 0;
}

/**
 * Write the synthetic receipt a `mode: dummy` row gets (design §3, task 0322 R1).
 *
 * The payload is parsed as kk-core `Content` first, so a rehearsal still proves the row would send
 * a valid payload; a parse failure is a failed receipt with `error: invalid-payload` and no send.
 * `url: dummy://<id>` is what later tiers' link placeholders resolve to, which is why an all-dummy
 * run needs no network for `{{article_url}}` / `{{podcast_url}}` either.
 */
async function writeDummyReceipt(
    fs: FileSystem,
    row: SendRow,
    context: { payloadPath: string; payloadDigest: string; startedAt: string; parentRunId: string; planDigest: string },
): Promise<ItcReceipt> {
    const base: ItcReceipt = {
        ...(row.receiptExtras ?? {}),
        schemaVersion: 1,
        parentRunId: context.parentRunId,
        planDigest: context.planDigest,
        payloadDigest: context.payloadDigest,
        plugin: row.plugin,
        profile: row.profile,
        mode: 'draft',
        attemptId: 'attempt-1',
        status: 'succeeded',
        effect: 'none',
        publicUrlVerified: false,
        dummy: true,
        url: `dummy://${row.key}`,
        startedAt: context.startedAt,
        finishedAt: new Date().toISOString(),
    };
    let invalid: string | undefined;
    try {
        // The resolved payload, not the raw one: the digest below is over what would have been sent.
        const raw = await fs.readFile(context.payloadPath);
        const parsed = ContentSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) invalid = parsed.error.message;
    } catch (err: unknown) {
        invalid = err instanceof Error ? err.message : String(err);
    }
    if (invalid === undefined) return base;
    return {
        ...base,
        status: 'failed',
        effect: 'none',
        error: 'invalid-payload',
        url: undefined,
    };
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

/**
 * Read the tier-0 receipts a link placeholder resolves from. `real` excludes dummy receipts: a draft
 * or live row must never publish a `dummy://` link, so with only a rehearsed tier 0 its placeholder
 * stays unresolved and the row fails with effect none; `all` serves dummy rows.
 */
async function readLinkMap(
    fs: FileSystem,
    receiptsDir: string,
    rows: readonly PublishPlanRow[],
): Promise<{ real: LinkMap; all: LinkMap }> {
    const real: LinkMap = {};
    const all: LinkMap = {};
    for (const source of LINK_SOURCES) {
        const row = rows.find((candidate) => candidate.plugin === source.plugin && candidate.tier === 0);
        if (row === undefined) continue;
        const path = join(receiptsDir, `${row.id}.json`);
        if (!(await fs.exists(path))) continue;
        try {
            const receipt = JSON.parse(await fs.readFile(path)) as ItcReceipt;
            if (receipt.status !== 'succeeded' || !receipt.url) continue;
            all[source.receipt] = receipt.url;
            if (receipt.dummy !== true) real[source.receipt] = receipt.url;
        } catch {
            // an unreadable tier-0 receipt simply leaves the placeholder unresolved
        }
    }
    return { real, all };
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

            const linkMaps = tier === 0 ? { real: {}, all: {} } : await readLinkMap(fs, receiptsDir, plan.rows);
            const sendRowsInput: SendRow[] = rows.map((row) => ({
                key: row.id,
                plugin: row.plugin,
                profile: row.profile ?? 'article',
                mode: row.mode,
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
                // A dummy row gets the same payload work as a real one — that is the rehearsal.
                dummyReceipt: (row, context) =>
                    writeDummyReceipt(fs, row, { ...context, parentRunId: plan.parentRunId, planDigest }),
                preparePayload: async (row) => {
                    if (tier === 0) return { payloadPath: row.payloadPath };
                    const raw = (await fs.exists(row.payloadPath)) ? await fs.readFile(row.payloadPath) : '';
                    const links: LinkMap = row.mode === 'dummy' ? linkMaps.all : linkMaps.real;
                    let resolved = raw;
                    for (const source of LINK_SOURCES) {
                        const url = links[source.receipt];
                        if (url === undefined) continue;
                        // The payload is JSON text: escape the URL as a string fragment so a quote or
                        // backslash in it cannot break the document.
                        resolved = resolved.split(source.placeholder).join(JSON.stringify(url).slice(1, -1));
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

/** Result of one RSS gate probe, written to `4-publish/rss-gate.json`. */
export const RssGateResultSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        date: z.string().min(1),
        feedUrl: z.string().min(1),
        hit: z.boolean(),
        reason: z.enum(['guid', 'title', 'missing', 'fetch-failed']),
        detail: z.string().optional(),
    })
    .strict();

/** Parsed RSS gate result. */
export type RssGateResult = z.infer<typeof RssGateResultSchema>;

/** One `<item>` of the podcast feed: the two fields the gate matches on. */
interface FeedItem {
    title: string;
    guid: string;
}

/**
 * Extract `<item>` title/guid pairs from a podcast RSS document.
 *
 * Deliberately a regex over the known feed shape rather than an XML parser: the document is a
 * podcast feed with a fixed element order, and a dependency for two fields is not worth it.
 */
export function feedItems(xml: string): FeedItem[] {
    const items: FeedItem[] = [];
    for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const body = block[1] ?? '';
        const title = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(body)?.[1]?.trim() ?? '';
        const guid = /<guid[^>]*>([\s\S]*?)<\/guid>/.exec(body)?.[1]?.trim() ?? '';
        items.push({ title, guid });
    }
    return items;
}

/**
 * Decide whether the feed carries the gated episode (task 0323 R3).
 *
 * A guid match is authoritative — it is the receipt's own identity for the episode. A title match is
 * the fallback for a run whose tier-0 receipt is absent (the gate also runs before publish). A feed
 * that could not be fetched is a **miss**, never a hit: an outage must not let an unpublished
 * episode through, and `reason` keeps the two distinguishable in the incident.
 */
export function matchRssGate(items: readonly FeedItem[], date: string, guid: string): RssGateResult['reason'] {
    if (guid !== '' && items.some((item) => item.guid === guid)) return 'guid';
    if (items.some((item) => item.title.includes(date))) return 'title';
    return 'missing';
}

/** `--flag value` already exists as `flagValue`; fetch one feed through the injected reader. */
export interface RssGateDeps extends PublishMatrixDeps {
    /** Injected feed reader (the test passes a local fixture); defaults to `fetch`. */
    readFeed?: (url: string) => Promise<string>;
}

/**
 * `publish-matrix-rss-gate <workDir> --date <YYYY-MM-DD> [--feed <url>]` — the overseas window's
 * gate (task 0323 R3).
 *
 * Exits 0 on a hit and 3 on a miss, so a `kind: dag` node can route on the exit code; the JSON
 * artifact carries the reason either way. The guid comes from the tier-0 podcast receipt when one
 * exists (the episode's own identity), the title date is the fallback.
 */
export async function runPublishMatrixRssGate(args: string[], deps: RssGateDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const date = flagValue(args, '--date');
    const feedUrl = flagValue(args, '--feed') ?? 'https://podcast.salty.vip/rss/';
    if (!workDir || date === undefined) {
        echoError('usage: publish-matrix-rss-gate <work_dir> --date <YYYY-MM-DD> [--feed <url>]');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');

    // A tier-0 podcast receipt carries the guid the feed must contain; a receipt that records none
    // leaves the title-date match as the only evidence.
    let guid = '';
    const receiptsDir = join(publishDir, 'receipts');
    if (await fs.exists(receiptsDir)) {
        for (const planWindow of ['after-generate', 'cn-peak'] as const) {
            const planPath = join(publishDir, `plan.${planWindow}.json`);
            if (!(await fs.exists(planPath))) continue;
            const plan = JSON.parse(await fs.readFile(planPath)) as PublishPlan;
            for (const row of plan.rows) {
                if (row.plugin !== 'podcast-pub') continue;
                const receiptPath = join(receiptsDir, `${row.id}.json`);
                if (!(await fs.exists(receiptPath))) continue;
                const receipt = JSON.parse(await fs.readFile(receiptPath)) as ItcReceipt & { guid?: string };
                if (typeof receipt.guid === 'string') guid = receipt.guid;
            }
        }
    }

    const write = async (result: RssGateResult): Promise<number> => {
        await fs.ensureDir(publishDir);
        await fs.writeFile(join(publishDir, 'rss-gate.json'), `${JSON.stringify(result, null, 2)}\n`);
        await appendEvent(fs, publishDir, {
            event: result.hit ? 'gate-hit' : 'gate-miss',
            window: 'overseas-rss',
            reason: result.reason,
            date: result.date,
        });
        if (!result.hit) {
            // The deterministic incident floor: the gate already knows its own class, so the miss is
            // recorded even if the workflow's `diagnose` agent step never gets to run. `diagnose`
            // may refine the class from the bundle and receipts; it always finds this file.
            const incident = {
                schemaVersion: 1,
                date: result.date,
                class: 'rss-lag',
                reason: `feed ${result.feedUrl} has no episode for ${result.date} (${result.reason})`,
                evidence: ['4-publish/rss-gate.json', ...(result.detail === undefined ? [] : [result.detail])],
            };
            await fs.writeFile(join(publishDir, 'incident.json'), `${JSON.stringify(incident, null, 2)}\n`);
            await fs.writeFile(
                join(publishDir, 'incident.md'),
                [
                    `# Overseas window missed — ${result.date}`,
                    '',
                    `The podcast feed \`${result.feedUrl}\` does not carry the ${result.date} episode (${result.reason}).`,
                    'Class `rss-lag`: the episode is not in the feed yet.',
                    result.detail === undefined ? '' : `Detail: ${result.detail}`,
                    '',
                    'Next: confirm the generation run published the podcast tier-0 target, then re-run the',
                    'overseas window for this date. An automatic repair only resends `effect: none` tier-0 rows.',
                ]
                    .filter((line) => line !== '')
                    .join('\n'),
            );
            echoError(`publish-matrix-rss-gate: miss (${result.reason}) for ${result.date}`);
        }
        return result.hit ? 0 : 3;
    };

    let xml: string;
    try {
        const read =
            deps.readFeed ??
            (async (url: string) => {
                // Bounded and status-checked: a hung feed must not stall the node, and an HTTP error
                // page is a fetch failure, not a feed that lacks today's item.
                const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            });
        xml = await read(feedUrl);
    } catch (err: unknown) {
        return write({
            schemaVersion: 1,
            date,
            feedUrl,
            hit: false,
            reason: 'fetch-failed',
            detail: err instanceof Error ? err.message : String(err),
        });
    }

    const reason = matchRssGate(feedItems(xml), date, guid);
    return write({ schemaVersion: 1, date, feedUrl, hit: reason !== 'missing', reason });
}

/**
 * `publish-matrix-wait-until <HH:MM> <Area/City>` — sleep until that local wall-clock time in the
 * given zone (task 0323 R5).
 *
 * DST-safe and no-op when the moment is already past, because the launchd entry fires in the
 * machine's local zone: the cn-peak tick at 17:00 PDT must sleep to 09:00 Shanghai, and after the
 * DST flip the same tick is only an hour early. The offset is computed twice — now and at the
 * target — so a window that straddles a transition still wakes at the right instant.
 */
export async function runPublishMatrixWaitUntil(
    args: string[],
    deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
    const [target = '', zone = ''] = args;
    const match = /^(\d{1,2}):(\d{2})$/.exec(target);
    if (!match || zone === '') {
        echoError('usage: publish-matrix-wait-until <HH:MM> <Area/City>');
        return 1;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
        echoError(`publish-matrix-wait-until: '${target}' is not a valid wall-clock time`);
        return 1;
    }
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    // The zone's offset at `at`, in minutes east of UTC.
    const offsetAt = (at: number): number => {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: zone,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(new Date(at));
        const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
        const asUtc = Date.UTC(
            get('year'),
            get('month') - 1,
            get('day'),
            get('hour') % 24,
            get('minute'),
            get('second'),
        );
        return Math.round((asUtc - at) / 60_000);
    };

    // The fields must be declared: an `Intl` formatter with only `timeZone` prints a DATE, not a
    // clock, and parsing that back yields NaN.
    const wall = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(new Date(now()));
    const part = (type: string): number => Number(wall.find((entry) => entry.type === type)?.value ?? '0');
    const localHour = part('hour') % 24;
    const localMinute = part('minute');
    const already = localHour * 60 + localMinute;
    if (already >= hours * 60 + minutes) {
        echo(`publish-matrix-wait-until: ${zone} is already past ${target}`);
        return 0;
    }

    let wait = (hours * 60 + minutes - already) * 60_000;
    // A DST transition inside the wait window shifts the target by the offset delta; one correction
    // is enough for a wait under 24 h, and a zero/negative result means the target already passed.
    const delta = offsetAt(now() + wait) - offsetAt(now());
    wait -= delta * 60_000;
    if (wait <= 0) {
        echo(`publish-matrix-wait-until: ${zone} is already past ${target}`);
        return 0;
    }
    echo(`publish-matrix-wait-until: sleeping ${Math.round(wait / 60_000)} min to ${target} ${zone}`);
    await sleep(wait);
    return 0;
}

/** Compiled default for the voice3/publish3 preset selector (task 0323 R2). */
export const DEFAULT_PUBLISH_PRESET = 'daily-ai-voice';

/**
 * Resolve the operator's `workflows.kk-daily-ai-voice3.publish_preset` selector (task 0323 R2).
 *
 * Mirrors the itc resolver's contract exactly: `$KK_CONFIG`, else `$HOME/.config/kk/config.yaml`;
 * a missing file or block is the compiled default; a malformed block, an unknown declared key or a
 * non-slug value throws naming the key, never the value. The preset is only *selected* here — its
 * contents stay in the reviewable preset file the plan digest records.
 */
export async function readPublishPresetSelector(
    env: Record<string, string | undefined> = process.env,
    fs: FileSystem = createNodeFileSystem(),
): Promise<string> {
    // The ONE kk config path convention (`itc-config.ts`): `$KK_CONFIG` (with `~` expanded) or
    // `$HOME/.config/kk/config.yaml`. Hand-rolling it here resolved `~` against the cwd instead, so a
    // `KK_CONFIG=~/.config/kk/config.yaml` launch read a different file than every itc stage.
    const configPath = resolveItcConfigPath(env, env.HOME ?? '');
    if (!(await fs.exists(configPath))) return DEFAULT_PUBLISH_PRESET;
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(await fs.readFile(configPath));
    } catch {
        throw new Error(`config file is not valid YAML: ${configPath}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_PUBLISH_PRESET;
    const workflows = (parsed as Record<string, unknown>).workflows;
    if (workflows === null || typeof workflows !== 'object' || Array.isArray(workflows)) return DEFAULT_PUBLISH_PRESET;
    const block = (workflows as Record<string, unknown>)['kk-daily-ai-voice3'];
    if (block === undefined) return DEFAULT_PUBLISH_PRESET;
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        throw new Error("config key 'workflows.kk-daily-ai-voice3' must be a mapping");
    }
    const settings = block as Record<string, unknown>;
    for (const key of Object.keys(settings)) {
        if (key !== 'publish_preset') {
            throw new Error(
                `config key 'workflows.kk-daily-ai-voice3.${key}' is not a declared setting (allowed: publish_preset)`,
            );
        }
    }
    const value = settings.publish_preset;
    if (value === undefined) return DEFAULT_PUBLISH_PRESET;
    if (typeof value !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
        throw new Error("config key 'workflows.kk-daily-ai-voice3.publish_preset' must be a lowercase hyphenated slug");
    }
    return value;
}

/**
 * `publish-matrix-bundle <workDir> --run-date <d> --run-id <id>` — the only producer of
 * `bundle.json` (task 0324 R2).
 *
 * The variant map is the `30-variants/` listing, so no hard-coded variant list lives in the
 * workflow: every `<key>.content.json` becomes `variants[key] = { path, sha256 }` (relative to the
 * bundle, so a bundle and its variants move together). The episode title comes from the plan, the
 * episode Content, or the run date, and a missing required variant fails the freeze — a bundle must
 * never advertise an artifact it cannot deliver.
 */
export async function runPublishMatrixBundle(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const runDate = flagValue(args, '--run-date');
    const parentRunId = flagValue(args, '--run-id');
    if (!workDir || runDate === undefined || parentRunId === undefined) {
        echoError('usage: publish-matrix-bundle <work_dir> --run-date <YYYY-MM-DD> --run-id <voice3 run id>');
        return 1;
    }
    const variantsDir = join(workDir, '30-variants');
    if (!(await fs.exists(variantsDir))) {
        echoError(`publish-matrix-bundle: no variants at ${variantsDir}; run daily-bundle-variants first`);
        return 1;
    }

    try {
        const entries = (await fs.readDir(variantsDir)).filter((file) => file.endsWith('.content.json')).sort();
        if (entries.length === 0) throw new Error(`no *.content.json under ${variantsDir}`);

        const variants: Record<string, { path: string; sha256: string }> = {};
        for (const file of entries) {
            const key = file.replace(/\.content\.json$/, '').replaceAll('_', ':');
            const raw = await fs.readFile(join(variantsDir, file));
            // Parse as Content here: a variant that is not a Content would fail every consumer later.
            const parsed = ContentSchema.safeParse(JSON.parse(raw));
            if (!parsed.success) {
                throw new Error(`variant '${key}' is not valid Content: ${parsed.error.message}`);
            }
            variants[key] = {
                path: `30-variants/${file}`,
                sha256: createHash('sha256').update(raw).digest('hex'),
            };
        }

        // The publication contract needs at least the shared article or episode variant: they are what
        // the tier-0 owned channels publish and what every later tier's link placeholders resolve to.
        const hasOwnedVariant = Object.keys(variants).some((key) => key === 'article' || key === 'episode');
        if (!hasOwnedVariant) {
            echoError(
                'publish-matrix-bundle: no article/episode variant — the publication contract needs at least one',
            );
            return 1;
        }

        const articleTitle = await readVariantTitle(fs, workDir, variants);
        const bundle: Bundle = {
            schemaVersion: 1,
            runId: `${runDate}-${parentRunId}`,
            runDate,
            parentRunId,
            runs: [],
            episode: { title: articleTitle === '' ? `每日AI乱炖 · ${runDate}` : articleTitle },
            variants,
        };
        const validated = BundleSchema.parse(bundle);
        const bundlePath = join(workDir, 'bundle.json');
        // An existing bundle keeps its `runs[]`: a re-freeze must not forget which windows already
        // published against it.
        if (await fs.exists(bundlePath)) {
            try {
                const prior = BundleSchema.parse(JSON.parse(await fs.readFile(bundlePath)));
                if (prior.runs.length > 0) validated.runs = prior.runs;
            } catch {
                // an unreadable prior bundle is replaced by this validated one
            }
        }
        await fs.writeFile(bundlePath, `${JSON.stringify(validated, null, 2)}\n`);
        echo(`bundle frozen: ${Object.keys(variants).length} variant(s) -> ${bundlePath}`);
        return 0;
    } catch (err: unknown) {
        echoError(`publish-matrix-bundle: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

/** The episode title for the bundle: the episode variant's own title, else the article's, else ''. */
async function readVariantTitle(
    fs: FileSystem,
    workDir: string,
    variants: Record<string, { path: string }>,
): Promise<string> {
    for (const key of ['episode', 'episode@podcast-pub', 'article']) {
        const entry = variants[key];
        if (entry === undefined) continue;
        try {
            const parsed = ContentSchema.parse(JSON.parse(await fs.readFile(join(workDir, entry.path))));
            if (parsed.title !== undefined && parsed.title.trim() !== '') return parsed.title.trim();
        } catch {
            // fall through to the next candidate
        }
    }
    return '';
}
