import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { type Content, ContentSchema, discoverAllPlugins, type PluginRecord } from '@gobing-ai/kk-core';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import {
    carryOfficialAccountLink,
    gateChannelsCard,
    isChannelsCardTarget,
    OFFICIAL_ACCOUNT_PLUGIN,
} from './publish-channels-link';
import {
    loadPublishPreset,
    type PublishPreset,
    type PublishPresetTarget,
    type PublishWindow,
    PublishWindowSchema,
    probePlugin,
    type Receipt,
    resolveConfigPath,
    type SendRow,
    sendRows,
} from './publish-core';
import {
    applyDispatchResults,
    type DispatchEntry,
    type DispatchMode,
    type DispatchTarget,
    dispatchable,
    dispatchLedgerPath,
    type OwnerReceipt,
    planDispatch,
    readDispatchLedger,
    resolveFrozenRunDate,
    retryable,
    writeDispatchLedger,
} from './publish-dispatch';

/** One frozen asset a bundle ships: a `Content` JSON path plus its sha256. */
export const BundleVariantSchema = z
    .object({
        path: z.string().min(1),
        sha256: z.string().min(1),
    })
    .strict();

/**
 * Additive final-variant safety evidence (0331 R2/R3): the nested safety machine's verdict over the
 * bundle's final publish variants. `variants` maps bundle variant keys to the reviewed sha256, so a
 * variant edited after review no longer matches. `block` is deliberately unrepresentable — a blocked
 * variants review never freezes into a real-capable bundle (the freeze refuses such evidence files).
 */
export const BundleSafetySchema = z
    .object({
        status: z.enum(['pass', 'escalate', 'exclude']),
        digest: z.string().min(1),
        excludedPlatforms: z.array(z.string()).default([]),
        variants: z.record(z.string(), z.string()),
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
        contentType: z.string().min(1).default('news'),
        title: z.string().min(1).optional(),
        parentRunId: z.string().min(1).optional(),
        runs: z.array(z.string()).default([]),
        episode: z
            .object({ title: z.string().min(1), guid: z.string().optional() })
            .strict()
            .optional(),
        variants: z.record(z.string(), BundleVariantSchema),
        safety: BundleSafetySchema.optional(),
    })
    .strict();

/** Parsed bundle. */
export type Bundle = z.input<typeof BundleSchema>;

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
        transport: z.enum(['fanout', 'browser']).default('fanout'),
        metadata: z.record(z.string(), z.unknown()).optional(),
        modeSource: z.enum(['flag', 'config', 'preset']).optional(),
        profile: z.string().min(1).optional(),
        payloadPath: z.string().min(1),
        payloadDigest: z.string().min(1),
        /** Source variant path (bundle-relative) and digest, frozen so send can revalidate (0331 R5). */
        variantPath: z.string().min(1).optional(),
        variantDigest: z.string().min(1).optional(),
    })
    .strict();

/** Parsed plan row. The public type keeps additive fields optional for legacy callers. */
export type PublishPlanRow = z.input<typeof PublishPlanRowSchema>;

/**
 * One preset target dropped from the plan for a policy reason (0333): safety exclusion, `mode: off`,
 * or dropped by a narrowing `--channels` list. Recorded so an off/excluded target stays visible in
 * the outcome and the report instead of silently vanishing from the audit trail.
 */
export const PublishPlanExcludedSchema = z
    .object({
        id: z.string().min(1),
        plugin: z.string().min(1),
        reason: z.string().min(1),
    })
    .strict();

/** A policy-dropped in-window preset target kept visible in the plan/outcome (0333). */
export type PublishPlanExcluded = z.infer<typeof PublishPlanExcludedSchema>;

/** One window's publish plan (`4-publish/plan.<window>.json`). */
export const PublishPlanSchema = z
    .object({
        schemaVersion: z.literal(1).default(1),
        window: PublishWindowSchema,
        bundleRunId: z.string().min(1),
        parentRunId: z.string().min(1),
        presetName: z.string().min(1),
        presetDigest: z.string().min(1),
        runDate: z.string().min(1).optional(),
        excluded: z.array(PublishPlanExcludedSchema).default([]),
        rows: z.array(PublishPlanRowSchema),
    })
    .strict();

/**
 * Where a run directory's frozen bundle lives — `4-publish/bundle.json` (design §4.3), with the
 * root-level `bundle.json` of a pre-cut-over run directory as the fallback.
 *
 * Task 0366 needs both spellings at once: the launching verb admits only the frozen path (§3.2),
 * while a run directory produced before the layout moved "remains publishable with `--work-dir`"
 * (§4.3), and the retired publish3 DAG still named the root path. Reading is additive — a directory
 * with both files keeps using the frozen one.
 */
export async function resolveBundlePath(fs: FileSystem, workDir: string): Promise<string> {
    // The run root first (0382): `generate-bundle --stage freeze` writes the news bundle there and
    // records every variant path relative to that directory (`30-variants/…`), so a bundle read from
    // `4-publish/` would resolve those paths against the wrong base and fail with
    // "variant file not found: 4-publish/30-variants/…". The `4-publish/` copy stays the fallback for
    // the article layout, whose bundle and payloads do live there.
    const root = join(workDir, 'bundle.json');
    if (await fs.exists(root)) return root;
    return join(workDir, '4-publish', 'bundle.json');
}

/** Parsed plan. The public type accepts legacy rows without additive defaulted fields. */
export type PublishPlan = Omit<z.input<typeof PublishPlanSchema>, 'rows' | 'excluded'> & {
    excluded: PublishPlanExcluded[];
    rows: PublishPlanRow[];
};

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
        excluded: z.array(PublishPlanExcludedSchema).default([]),
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
    receipts: readonly Receipt[],
    runDate: string,
): PublishOutcome {
    const byTarget = new Map<string, Receipt>();
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

    // "Real" is plan-owned (0330 R3), not receipt-owned: a dummy window whose send never ran has
    // no dummy receipts yet, so missing receipts only count as dummy evidence when a dummy pass
    // actually left receipts behind (0326 'none' vs 0332 R6 failed-dummy-prep accounting).
    const anyDummyReceipt = receipts.some((receipt) => receipt.dummy === true);
    const planModeById = new Map(plan.rows.map((row) => [row.id, row.mode] as const));
    const real = rows.filter(
        (row) => !row.dummy && !(planModeById.get(row.id) === 'dummy' && row.status === 'missing' && anyDummyReceipt),
    );
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
        excluded: plan.excluded,
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
    /** Injected preset (tests); a live call resolves it from the `--preset` slug instead. */
    preset?: PublishPreset;
    /** Preset plus digest after applying a content-type switchboard (new content verbs only). */
    presetOverride?: { preset: PublishPreset; digest: string };
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

/** Modes accepted by the content-type channel switchboard. */
export type ChannelMode = 'off' | 'dummy' | 'draft' | 'live';

/** Raised before any publish artifact is written when a switchboard key is a configuration typo. */
export class UnknownChannelModeError extends Error {
    constructor(key: string, preset: string) {
        super(`channel '${key}' is not listed in preset '${preset}'`);
        this.name = 'UnknownChannelModeError';
    }
}

function targetMatchesChannel(target: PublishPresetTarget, token: string): boolean {
    return (
        target.plugin === token ||
        target.id === token ||
        targetId(target) === token ||
        (target.variant !== undefined && `${target.plugin}/${target.variant}` === token)
    );
}

/** Validate per-run channel selectors without touching the work directory. */
export function validatePublishChannelTokens(preset: PublishPreset, tokens: readonly string[]): void {
    for (const token of tokens) {
        if (!preset.targets.some((target) => targetMatchesChannel(target, token))) {
            throw new UnknownChannelModeError(token, preset.name);
        }
    }
}

/**
 * Apply the content-type channel switchboard to a preset copy.
 *
 * The returned preset carries `modeSource` as an additive internal field. Legacy stage callers do
 * not invoke this helper, so their plan bytes remain unchanged; the content verbs use the field to
 * explain an operator-configured mode and to distinguish `mode off (config)` from a preset opt-out.
 */
export function applyChannelModes(
    preset: PublishPreset,
    channels: Readonly<Record<string, ChannelMode>>,
    liveChannels: readonly string[],
): PublishPreset {
    validatePublishChannelTokens(preset, Object.keys(channels));

    return {
        ...preset,
        targets: preset.targets.map((target) => {
            const specificKey = target.variant === undefined ? undefined : `${target.plugin}/${target.variant}`;
            const configKey =
                specificKey !== undefined && channels[specificKey] !== undefined
                    ? specificKey
                    : channels[target.plugin] !== undefined
                      ? target.plugin
                      : undefined;
            const configMode = configKey === undefined ? undefined : channels[configKey];
            const live =
                (configMode ?? target.mode) !== 'off' &&
                liveChannels.some((token) => targetMatchesChannel(target, token));
            const mode = live ? 'live' : (configMode ?? target.mode ?? 'draft');
            const modeSource: PublishPlanRow['modeSource'] = live
                ? 'flag'
                : configMode !== undefined
                  ? 'config'
                  : 'preset';
            return {
                ...target,
                mode,
                modeSource,
            };
        }),
    };
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
 * Normalizes a run date to its `YYYY-MM-DD` calendar day (0332 R1).
 *
 * Accepts ISO (`2026-10-22`) and compact (`20261022`) forms so a scheduler, an operator and a
 * legacy caller all land on the same day; anything else — including impossible calendar days like
 * `2026-02-30` — is rejected, because a wrong date must not slip through into receipts or the RSS
 * gate. Returns undefined for invalid input.
 */
export function normalizeRunDate(raw: string): string | undefined {
    const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw.trim());
    if (m === null) return undefined;
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCFullYear() !== Number(m[1]) ||
        parsed.getUTCMonth() + 1 !== Number(m[2]) ||
        parsed.getUTCDate() !== Number(m[3])
    ) {
        return undefined;
    }
    return iso;
}

/**
 * `publish-matrix-validate <work_dir> [--run-date <stamp>]` — the pre-flight date gate (0332 R1,
 * F13).
 *
 * Runs before any planning or dispatch: an omitted run date derives from the bundle's own
 * `runDate`, a provided compact/ISO date must normalize to a valid calendar day, and the canonical
 * result lands in `4-publish/run-date.txt` for the window stages to fall back to. Exit 1 with an
 * actionable message on refusal — a missing or malformed date must be rejected BEFORE a send, not
 * by the classifier after one.
 */
export async function runPublishMatrixValidate(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const raw = flagValue(args, '--run-date');
    if (!workDir) {
        echoError('usage: publish-matrix-validate <work_dir> [--run-date <YYYY-MM-DD|YYYYMMDD>]');
        return 1;
    }
    let source = '--run-date';
    let candidate = raw === undefined || raw.trim() === '' ? undefined : raw;
    if (candidate === undefined) {
        source = 'bundle.json';
        const bundlePath = await resolveBundlePath(fs, workDir);
        if (!(await fs.exists(bundlePath))) {
            echoError(`publish-matrix-validate: no --run-date and no bundle at ${bundlePath} to derive one from`);
            return 1;
        }
        try {
            const bundle = JSON.parse(await fs.readFile(bundlePath)) as { runDate?: unknown };
            candidate = typeof bundle.runDate === 'string' ? bundle.runDate : undefined;
        } catch {
            candidate = undefined;
        }
        if (candidate === undefined) {
            echoError(`publish-matrix-validate: bundle.json has no usable runDate; pass --run-date`);
            return 1;
        }
    }
    const normalized = normalizeRunDate(candidate);
    if (normalized === undefined) {
        echoError(
            `publish-matrix-validate: run date '${candidate}' (from ${source}) is not a valid calendar day (YYYY-MM-DD or YYYYMMDD)`,
        );
        return 1;
    }
    await fs.ensureDir(join(workDir, '4-publish'));
    await fs.writeFile(join(workDir, '4-publish', 'run-date.txt'), `${normalized}\n`);
    echo(`run date ${normalized} (from ${source})`);
    return 0;
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
        presetOverride?: { preset: PublishPreset; digest: string };
    },
): Promise<{ plan: PublishPlan; omitted: OmittedTarget[] }> {
    const bundleAbs = resolve(input.bundlePath);
    if (!(await fs.exists(bundleAbs))) throw new Error(`bundle not found: ${bundleAbs}`);
    const bundleParsed = BundleSchema.safeParse(JSON.parse(await fs.readFile(bundleAbs)));
    if (!bundleParsed.success) {
        throw new Error(`malformed bundle at ${bundleAbs}: ${bundleParsed.error.message}`);
    }
    const bundle = bundleParsed.data;
    // Every receipt this bundle produces must carry its calendar day (0332 R1): a bundle without a
    // usable runDate cannot bind evidence, so planning refuses before any payload is written.
    const runDate = normalizeRunDate(bundle.runDate ?? '');
    if (runDate === undefined) {
        throw new Error(
            `bundle runDate '${String(bundle.runDate)}' is not a valid calendar day (YYYY-MM-DD or YYYYMMDD)`,
        );
    }
    const bundleDir = dirname(bundleAbs);

    const { preset, digest } =
        input.presetOverride ??
        (await loadPublishPreset(
            input.preset,
            { ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}) },
            fs,
        ));

    const inWindow = preset.targets.filter(
        (target) => (target.window ?? 'after-generate') === input.window && (target.mode ?? 'draft') !== 'off',
    );

    // Reviewed platform exclusions (0331 R4) drop every row of the excluded destination before any
    // mode/payload work. Identifiers are content-safety platform names or preset plugin ids; an
    // unknown identifier is a typo in the safety verdict, so it fails instead of silently planning.
    const PLATFORM_EXCLUSIONS: Readonly<Record<string, readonly string[]>> = {
        xiaoyuzhou: ['podcast-pub'],
        'apple-podcasts': ['podcast-pub'],
        wechatmp: ['wechatmp-pub'],
        surfdash: ['surfdash-pub'],
        x: ['x-pub'],
        weibo: ['weibo-pub'],
        threads: ['threads-pub'],
        xhs: ['xhs-pub'],
        xiaohongshu: ['xhs-pub'],
        shipinhao: ['shipinhao-pub'],
    };
    const safety = bundle.safety;
    const excludedPlugins = new Set<string>();
    for (const identifier of safety?.excludedPlatforms ?? []) {
        const mapped = PLATFORM_EXCLUSIONS[identifier];
        if (mapped !== undefined) {
            for (const plugin of mapped) excludedPlugins.add(plugin);
        } else if (preset.targets.some((target) => target.plugin === identifier)) {
            excludedPlugins.add(identifier);
        } else {
            throw new Error(
                `bundle safety excludedPlatforms has unknown identifier '${identifier}': use a known platform (${Object.keys(PLATFORM_EXCLUSIONS).join(', ')}) or a preset plugin id`,
            );
        }
    }
    const notExcluded = (target: PublishPresetTarget): boolean => !excludedPlugins.has(target.plugin);

    // Launch vars may only narrow or promote what the preset already lists. A token that matches no
    // preset target at all is a typo, so it fails instead of silently planning nothing.
    const matches = (target: PublishPresetTarget, token: string): boolean => targetMatchesChannel(target, token);
    for (const token of [...input.channels, ...input.liveChannels]) {
        if (!preset.targets.some((target) => matches(target, token))) {
            throw new Error(`channel '${token}' is not listed in preset '${preset.name}'`);
        }
    }
    for (const token of [...input.channels, ...input.liveChannels]) {
        if (
            !preset.targets.some(
                (target) => (target.window ?? 'after-generate') === input.window && matches(target, token),
            )
        ) {
            throw new Error(`channel '${token}' has no target in window '${input.window}'`);
        }
    }

    const selected =
        input.channels.length === 0
            ? inWindow.filter(notExcluded)
            : inWindow.filter(
                  (target) => input.channels.some((token) => matches(target, token)) && notExcluded(target),
              );

    // Every in-window preset target the plan drops for a POLICY reason stays visible (0333):
    // safety exclusion, `mode: off`, or a narrowing `--channels` list. (Variant-missing drops are
    // `omitted` above, not here — they carry failed receipts instead.)
    const excluded: PublishPlanExcluded[] = [];
    for (const target of preset.targets) {
        if ((target.window ?? 'after-generate') !== input.window) continue;
        const id = targetId(target);
        if (excludedPlugins.has(target.plugin)) {
            excluded.push({ id, plugin: target.plugin, reason: 'excluded by bundle safety' });
        } else if ((target.mode ?? 'draft') === 'off') {
            excluded.push({
                id,
                plugin: target.plugin,
                reason: target.modeSource === 'config' ? 'mode off (config)' : 'mode off',
            });
        } else if (input.channels.length > 0 && !input.channels.some((token) => matches(target, token))) {
            excluded.push({ id, plugin: target.plugin, reason: 'not in --channels list' });
        }
    }

    const rows: PublishPlanRow[] = [];
    const omitted: OmittedTarget[] = [];
    const seen = new Set<string>();

    /**
     * Resolve one bundle variant to validated Content, enforcing the frozen digest and — for every
     * non-dummy row — the reviewed safety digest, so the row cannot ride a stale review.
     */
    const loadVariant = async (
        variantName: string,
        plugin: string,
        rowMode: PublishPlanRow['mode'],
        label: string,
    ): Promise<{ content: Content; path: string; digest: string }> => {
        const entry = bundle.variants[`${variantName}@${plugin}`] ?? bundle.variants[variantName];
        if (entry === undefined) throw new Error(`bundle has no variant '${variantName}' for ${label}`);
        const contentPath = resolve(bundleDir, entry.path);
        if (!(await fs.exists(contentPath))) throw new Error(`variant file not found: ${contentPath}`);
        const raw = await fs.readFile(contentPath);
        const digest = createHash('sha256').update(raw).digest('hex');
        if (digest !== entry.sha256) {
            throw new Error(`variant digest mismatch for '${variantName}': expected ${entry.sha256}, got ${digest}`);
        }
        const parsed = ContentSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            throw new Error(`variant '${variantName}' is not valid Content: ${parsed.error.message}`);
        }
        if (rowMode !== 'dummy') {
            const key =
                bundle.variants[`${variantName}@${plugin}`] !== undefined ? `${variantName}@${plugin}` : variantName;
            const reviewed = safety?.variants[key];
            if (safety !== undefined && reviewed === undefined) {
                throw new Error(
                    `variant '${key}' is not covered by bundle.safety.variants; the variants safety gate must review every real row's variant`,
                );
            }
            if (reviewed !== undefined && reviewed !== digest) {
                throw new Error(
                    `variant '${key}' changed after review: reviewed ${reviewed}, frozen ${digest}; re-run the variants safety gate`,
                );
            }
        }
        return { content: parsed.data, path: entry.path, digest };
    };

    for (const target of selected) {
        const id = targetId(target);
        if (seen.has(id)) throw new Error(`duplicate target id '${id}' in preset '${preset.name}'`);
        seen.add(id);

        if (target.plugin === 'podcast-pub' && bundle.episode === undefined) {
            throw new Error(`bundle is missing required field 'episode' for podcast target '${id}'`);
        }

        const liveToken = input.liveChannels.find((token) => matches(target, token));
        if (liveToken !== undefined && target.mode === 'dummy') {
            throw new Error(`channel '${liveToken}' is dummy-only and cannot be promoted to live`);
        }
        // ADR-022 amendment 2026-11-12: the preset's own `mode: live` is consent, so a scheduled
        // window sends without a launch flag. `--live-channels` still promotes one row ad hoc and
        // `--dummy` still rehearses the whole window.
        const mode: PublishPlanRow['mode'] = input.dummy
            ? 'dummy'
            : liveToken !== undefined || target.mode === 'live'
              ? 'live'
              : target.mode === 'dummy'
                ? 'dummy'
                : 'draft';

        // Real rows bind to reviewed bytes (0331 R3). With evidence present, EVERY non-dummy row's
        // variant must match its reviewed digest — a variant edited after the variants review
        // (social copy, card text) cannot ride an article-only review. With no evidence at all,
        // only live news rows are gated (articles carry no final-variant safety workflow per design
        // §4.1), so legacy bundles and article bundles keep planning unchanged.
        if (mode === 'live' && safety === undefined && bundle.contentType === 'news') {
            throw new Error(
                `bundle has no final-variant safety evidence; run the variants safety gate (kk-daily-safety scope=variants) before a live launch`,
            );
        }

        if (target.variant === undefined) {
            throw new Error(`target '${id}' has no variant; a publish-matrix target must name one`);
        }
        // A channel-specific variant wins over the shared one, so generate can ship 小红书-only copy
        // without a preset change.
        const entry = bundle.variants[`${target.variant}@${target.plugin}`] ?? bundle.variants[target.variant];
        if (entry === undefined) {
            // A missing REQUIRED variant aborts the plan (unchanged). A missing OPTIONAL variant must
            // not cancel the whole window (0332 R6): the row is dropped from the plan and an
            // explicit failed effect-none receipt records the omission (written in planPublishMatrix).
            if (target.required === true) {
                throw new Error(`bundle has no variant '${target.variant}' for target '${id}'`);
            }
            omitted.push({
                id,
                plugin: target.plugin,
                profile: target.profile ?? 'article',
                mode,
                reason: `bundle has no variant '${target.variant}' for target '${id}'`,
            });
            continue;
        }
        const loaded = await loadVariant(target.variant, target.plugin, mode, `target '${id}'`);
        const parsedContent = { data: loaded.content };

        // Mode keys are plan-owned (0330 R3): a preset `options` entry that could flip a row's
        // mode behind the plan's back is a live-promotion attempt, so it is refused, not overridden.
        for (const key of ['publishStatus', 'published', 'status', 'skip_review', 'auto_publish'] as const) {
            if (target.options?.[key] !== undefined) {
                throw new Error(
                    `preset target '${id}' may not set options.${key}: the row's mode is owned by the plan (mode '${mode}')`,
                );
            }
        }
        const inherited = {
            ...(parsedContent.data.metadata ?? {}),
            ...(target.metadata ?? {}),
            ...(target.options ?? {}),
        };
        delete inherited.publishStatus;
        delete inherited.published;
        delete inherited.status;
        // Operation-native mode fields (0330 R1): the matrix writes the field each plugin's mapper
        // reads, so a draft can never inherit live-looking keys from a variant (ADR-022). Plugins
        // without a native field keep reading publishStatus.
        const nativeMode: Record<string, Record<string, unknown>> = mode === 'live'
            ? {
                  'surfdash-pub': { published: true },
                  'podcast-pub': { status: 'published' },
                  'qiita-pub': { private: false, published: true },
                  'zenn-pub': { published: true },
              }
            : {
                  'surfdash-pub': { published: false },
                  'podcast-pub': { status: 'unpublished' },
                  'qiita-pub': { private: true, published: false },
                  'zenn-pub': { published: false },
              };

        const payload: Content = {
            ...parsedContent.data,
            metadata: {
                ...inherited,
                ...(target.operation !== undefined ? { operation: target.operation } : {}),
                ...(nativeMode[target.plugin] ?? {}),
                publishStatus: mode === 'live' ? 'public' : 'draft',
            },
        };
        const payloadRelative = `4-publish/payloads/content.${id}.json`;
        const payloadText = `${JSON.stringify(payload, null, 2)}\n`;

        // 0423 R6: a channel the operator named explicitly on this invocation is required for its
        // exit code, even when the preset marks it optional — a run must not report success while
        // the only target it was asked to publish failed. A `--dummy` rehearsal asserts nothing
        // about the channel, so it stays optional.
        const explicitlySelected =
            mode !== 'dummy' && (liveToken !== undefined || input.channels.some((token) => matches(target, token)));
        rows.push({
            id,
            plugin: target.plugin,
            ...(target.operation !== undefined ? { operation: target.operation } : {}),
            variant: target.variant,
            tier: target.tier ?? 3,
            window: input.window,
            mode,
            required: (target.required ?? false) || explicitlySelected,
            // Approval is recorded only: enforcement is the workflow's pause node (ADR-022), and the
            // console attaches through this field (design §5b).
            approval: mode === 'live' ? 'required' : 'none',
            status: 'planned',
            ...(target.transport !== undefined ? { transport: target.transport } : {}),
            ...(target.metadata !== undefined ? { metadata: target.metadata } : {}),
            ...(target.modeSource !== undefined ? { modeSource: target.modeSource } : {}),
            ...(target.profile !== undefined ? { profile: target.profile } : {}),
            payloadPath: payloadRelative,
            payloadDigest: createHash('sha256').update(payloadText).digest('hex'),
            // Bundle variant paths resolve against the BUNDLE's directory (design §4.1), while this
            // plan's own paths (`payloadPath`, and the settle revalidation that reads `variantPath`
            // with `join(workDir, …)`) resolve against the run directory. They coincide for a bundle
            // at the run root (news) and differ for `4-publish/bundle.json` (the article layout), so
            // the plan records the run-relative form.
            variantPath: relative(input.workDir, resolve(bundleDir, entry.path)),
            variantDigest: entry.sha256,
        });
        await fs.ensureDir(join(input.workDir, '4-publish', 'payloads'));
        await fs.writeFile(join(input.workDir, payloadRelative), payloadText);
    }

    return {
        plan: {
            schemaVersion: 1,
            window: input.window,
            bundleRunId: bundle.runId,
            parentRunId: bundle.parentRunId ?? bundle.runId,
            presetName: preset.name,
            presetDigest: digest,
            runDate,
            excluded,
            rows,
        },
        omitted,
    };
}

/**
 * A preset target dropped from the plan because its variant is missing (0332 R6). Only targets that
 * are not `required` can be omitted; planPublishMatrix writes each one a failed effect-none receipt.
 */
interface OmittedTarget {
    id: string;
    plugin: string;
    profile: string;
    mode: PublishPlanRow['mode'];
    reason: string;
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
        const { plan, omitted } = await composePlan(fs, {
            workDir,
            bundlePath,
            preset,
            window: parsedWindow.data,
            channels,
            liveChannels,
            dummy,
            ...(deps.projectRoot ? { projectRoot: deps.projectRoot } : {}),
            ...(deps.presetOverride ? { presetOverride: deps.presetOverride } : {}),
        });
        const publishDir = join(workDir, '4-publish');
        await fs.ensureDir(publishDir);
        const planText = `${JSON.stringify(plan, null, 2)}\n`;
        await fs.writeFile(join(publishDir, `plan.${plan.window}.json`), planText);
        // The plan digest the omitted receipts carry (0332 R6) must equal what sendRows computes
        // from the same file, so it is hashed from the exact bytes written above.
        const planDigest = createHash('sha256').update(planText).digest('hex');
        for (const target of omitted) {
            const receipt: Receipt = {
                schemaVersion: 1,
                parentRunId: plan.parentRunId,
                planDigest,
                plugin: target.plugin,
                profile: target.profile,
                // `dummy` never reaches a plugin, so a receipt only ever states draft or live.
                mode: target.mode === 'live' ? 'live' : 'draft',
                attemptId: 'plan-1',
                status: 'failed',
                effect: 'none',
                error: target.reason,
                target: target.id,
                window: plan.window,
                ...(target.mode === 'dummy' ? { dummy: true } : {}),
            };
            await fs.ensureDir(join(publishDir, 'receipts'));
            await fs.writeFile(
                join(publishDir, 'receipts', `${target.id}.json`),
                `${JSON.stringify(receipt, null, 2)}\n`,
            );
            await appendEvent(fs, publishDir, {
                event: 'omitted',
                window: plan.window,
                id: target.id,
                plugin: target.plugin,
                reason: target.reason,
            });
        }
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
    const runDateRaw = flagValue(args, '--run-date');
    if (!workDir || windowArg === undefined) {
        echoError('usage: publish-matrix-classify <work_dir> --window <w> [--run-date <stamp>]');
        return 1;
    }
    // The outcome must carry the bundle's own calendar day (0332 R1): a provided stamp normalizes
    // (compact and ISO land on the same day) and may not disagree with the plan; an omitted one
    // derives from the plan, then the validate stage's canonical output.
    let runDate = runDateRaw !== undefined && runDateRaw.trim() !== '' ? normalizeRunDate(runDateRaw) : undefined;
    if (runDateRaw !== undefined && runDateRaw.trim() !== '' && runDate === undefined) {
        echoError(`publish-matrix-classify: '${runDateRaw}' is not a valid calendar day (YYYY-MM-DD or YYYYMMDD)`);
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
        if (plan.runDate !== undefined) {
            if (runDate !== undefined && runDate !== plan.runDate) {
                echoError(
                    `publish-matrix-classify: run date ${runDate} disagrees with the bundle's own day ${plan.runDate}; refusing to label this window's outcome`,
                );
                return 1;
            }
            runDate = plan.runDate;
        }
    } catch (err: unknown) {
        // No plan means nothing was dispatched for this window: `none`, reported, never fatal.
        echoError(`publish-matrix-classify: ${err instanceof Error ? err.message : String(err)}`);
        await fs.ensureDir(publishDir);
        const noneDate =
            runDate ??
            (await (async () => {
                const stampPath = join(publishDir, 'run-date.txt');
                if (!(await fs.exists(stampPath))) return undefined;
                return normalizeRunDate((await fs.readFile(stampPath)).trim());
            })()) ??
            runDateRaw?.trim() ??
            '';
        const none: PublishOutcome = {
            schemaVersion: 1,
            window: parsedWindow.data,
            runDate: noneDate,
            status: 'none',
            published: 0,
            targets: 0,
            excluded: [],
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
    if (runDate === undefined) {
        // Legacy plan without a runDate: fall back to the validate stage's canonical output.
        const stampPath = join(publishDir, 'run-date.txt');
        const stamp = (await fs.exists(stampPath))
            ? normalizeRunDate((await fs.readFile(stampPath)).trim())
            : undefined;
        if (stamp === undefined) {
            echoError(
                'publish-matrix-classify: plan has no runDate and no usable --run-date/run-date.txt was provided',
            );
            return 1;
        }
        runDate = stamp;
    }

    const receiptsDir = join(publishDir, 'receipts');
    const receipts: Receipt[] = [];
    // Every receipt in the dir is evidence (0332 R6): omitted variants' failed-effect-none receipts
    // carry the dummy accounting even though no plan row references them.
    if (await fs.exists(receiptsDir)) {
        for (const name of await fs.readDir(receiptsDir)) {
            if (!name.endsWith('.json')) continue;
            try {
                receipts.push(JSON.parse(await fs.readFile(join(receiptsDir, name))) as Receipt);
            } catch {
                // an unreadable receipt is a row with no evidence: it stays `missing`
            }
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
            // Legacy names use the compact stamp (20261022_...); runDate is ISO by 0332 R1.
            await fs.writeFile(
                join(legacyDir, `${runDate.replaceAll('-', '')}${source.file}`),
                await fs.readFile(aggregate),
            );
        }
    }

    echo(outcome.status);
    return 0;
}

/**
 * `publish-matrix-settle` (0333): promote the store selection only on receipt-proven completion.
 *
 * Settlement is keyed to `plan.parentRunId` — the bundle identity — never to a per-window publish
 * run id, so a rerun across windows cannot double-promote. Every `required` row whose plan mode is
 * real (`draft`/`live`) must carry a CURRENT-bundle receipt (`parentRunId` match) with
 * `status: succeeded`, `effect: confirmed` and `mode: live`; draft preparation and dummy rehearsals
 * HOLD the selection without claiming a live publication. Each blocking row is listed in
 * `4-publish/settlement.<window>.json` with its reason — a partial failure names the exact target
 * ids. Holding exits 0: the workflow's outcome assertion decides the run's exit code, so the
 * evidence file always survives for the report.
 */
export async function runPublishMatrixSettle(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const executor = deps.executor ?? new NodeProcessExecutor();
    const [workDir = ''] = args;
    const windowArg = flagValue(args, '--window');
    const topic = flagValue(args, '--topic') ?? 'ai-news';
    const dbArg = flagValue(args, '--db');
    if (!workDir || windowArg === undefined) {
        echoError('usage: publish-matrix-settle <work_dir> --window <w> [--topic <t>] [--db <path>]');
        return 1;
    }
    const parsedWindow = PublishWindowSchema.safeParse(windowArg);
    if (!parsedWindow.success) {
        echoError(`publish-matrix-settle: unknown window '${windowArg}'`);
        return 1;
    }
    const publishDir = join(workDir, '4-publish');
    let plan: PublishPlan;
    try {
        plan = await readPlan(fs, workDir, parsedWindow.data);
    } catch (err: unknown) {
        echoError(`publish-matrix-settle: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    const parentRunId = plan.parentRunId;
    const receiptsDir = join(publishDir, 'receipts');
    const receiptFor = async (id: string): Promise<Receipt | undefined> => {
        const path = join(receiptsDir, `${id}.json`);
        if (!(await fs.exists(path))) return undefined;
        try {
            return JSON.parse(await fs.readFile(path)) as Receipt;
        } catch {
            return undefined;
        }
    };
    const requiredReal = plan.rows.filter((row) => row.required && row.mode !== 'dummy');
    const unresolved: Array<{ id: string; reason: string }> = [];
    if (requiredReal.length === 0) {
        // A dummy rehearsal (or a window with no required tier-0 rows) has nothing owned to settle:
        // the selection holds and no store call is made at all.
        unresolved.push({ id: '*', reason: 'no required real owned rows in this window' });
    }
    for (const row of requiredReal) {
        const receipt = await receiptFor(row.id);
        if (receipt === undefined) {
            unresolved.push({ id: row.id, reason: 'no receipt' });
            continue;
        }
        if (receipt.parentRunId !== parentRunId) {
            unresolved.push({
                id: row.id,
                reason: `receipt belongs to bundle ${receipt.parentRunId ?? 'unknown'}, not ${parentRunId}`,
            });
            continue;
        }
        if (receipt.dummy === true) {
            unresolved.push({ id: row.id, reason: 'dummy receipt' });
            continue;
        }
        if (receipt.status !== 'succeeded') {
            unresolved.push({ id: row.id, reason: `status ${receipt.status}` });
            continue;
        }
        if (receipt.effect !== 'confirmed') {
            unresolved.push({ id: row.id, reason: `effect ${receipt.effect ?? 'unknown'}` });
            continue;
        }
        if (receipt.mode !== 'live') {
            // Draft preparation keeps the selection: prepared is not published (0333, binding).
            unresolved.push({ id: row.id, reason: `prepared as ${receipt.mode ?? 'unknown'}, not published live` });
        }
    }
    const settlement = {
        schemaVersion: 1,
        window: parsedWindow.data,
        runDate: plan.runDate ?? '',
        parentRunId,
        marked: unresolved.length === 0,
        unresolved,
    };
    await fs.ensureDir(publishDir);
    const settlementPath = join(publishDir, `settlement.${parsedWindow.data}.json`);
    if (unresolved.length > 0) {
        await fs.writeFile(settlementPath, `${JSON.stringify(settlement, null, 2)}\n`);
        echo(`settle: held ${parsedWindow.data} — ${unresolved.length} unresolved (selection kept)`);
        return 0;
    }
    // 0393 R2: prepare reserved the PRE-curation pool, but only the validated plan aired. Promote
    // exactly the plan's IDs and release the rest; a run without a readable plan (legacy layout)
    // keeps the whole-run promotion, which over-protects rather than re-airing anything.
    const planPath = join(workDir, '21-plan', `${(plan.runDate ?? '').replaceAll('-', '')}_03_plan_plan.json`);
    const finalItemIds = await readFinalItemIds(fs, planPath);
    const markArgs = ['store', 'mark-published', '--topic', topic, '--run', parentRunId];
    if (finalItemIds !== undefined) markArgs.push('--in', planPath);
    if (dbArg !== undefined) markArgs.push('--db', dbArg);
    const result = await executor.run({ command: 'kk', args: markArgs });
    if (result.exitCode !== 0) {
        const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.exitCode}`;
        await fs.writeFile(
            settlementPath,
            `${JSON.stringify(
                {
                    ...settlement,
                    marked: false,
                    unresolved: [{ id: '*', reason: `store mark-published failed: ${detail}` }],
                },
                null,
                2,
            )}\n`,
        );
        echoError(`publish-matrix-settle: store mark-published failed — ${detail}`);
        return 1;
    }
    const settled: Record<string, unknown> = {
        ...settlement,
        marked: true,
        scope: finalItemIds === undefined ? 'run' : 'final',
        ...(finalItemIds === undefined ? {} : { finalItemIds }),
    };
    if (finalItemIds !== undefined) {
        // Rows still `selected` after the promotion are the curation-dropped reservations: nothing
        // carried them to air, so they return to the pool. `published` rows are never touched.
        const releaseArgs = ['store', 'release', '--run', parentRunId, '--topic', topic];
        if (dbArg !== undefined) releaseArgs.push('--db', dbArg);
        const release = await executor.run({ command: 'kk', args: releaseArgs });
        if (release.exitCode !== 0) {
            // The aired set is already published; an unreleased row stays excluded, never re-aired.
            settled.releaseError = release.stderr?.trim() || release.stdout?.trim() || `exit ${release.exitCode}`;
            echoError(`publish-matrix-settle: store release failed — ${String(settled.releaseError)}`);
        }
    }
    await fs.writeFile(settlementPath, `${JSON.stringify(settled, null, 2)}\n`);
    echo(`settle: marked ${topic}/${parentRunId} published (${String(settled.scope)})`);
    return 0;
}

/** The validated plan's item IDs, or `undefined` when the plan is absent or not a non-empty Doc[]. */
async function readFinalItemIds(fs: FileSystem, planPath: string): Promise<string[] | undefined> {
    if (!(await fs.exists(planPath))) return undefined;
    try {
        const docs: unknown = JSON.parse(await fs.readFile(planPath));
        if (!Array.isArray(docs)) return undefined;
        const ids = docs.map((doc) => (doc as { id?: unknown } | null)?.id);
        return ids.length > 0 && ids.every((id) => typeof id === 'string' && id !== '')
            ? [...new Set(ids as string[])]
            : undefined;
    } catch {
        return undefined;
    }
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
): Promise<Receipt> {
    const base: Receipt = {
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
 * Read the tier-0 receipts a link placeholder resolves from. `real` excludes dummy receipts: a draft
 * or live row must never publish a `dummy://` link, so with only a rehearsed tier 0 its placeholder
 * stays unresolved and the row fails with effect none; `all` serves dummy rows.
 */
async function readLinkMap(
    fs: FileSystem,
    publishDir: string,
    plan: PublishPlan,
): Promise<{ real: LinkMap; live: LinkMap; all: LinkMap }> {
    const real: LinkMap = {};
    const live: LinkMap = {};
    const all: LinkMap = {};
    // Tier-0 receipts from EVERY window of this bundle revision (0332 R4): the after-generate
    // article feeds the cn-peak podcast and social rows. Only plans sharing the plan's parentRunId
    // are scanned — a receipt an older bundle revision wrote never resolves a link.
    const tierZero: Array<{ plugin: string; rowId: string }> = [];
    const planPaths = ((await fs.exists(publishDir)) ? await fs.readDir(publishDir) : []).filter((name) =>
        /^plan\..*\.json$/.test(name),
    );
    for (const name of planPaths) {
        try {
            const candidate = JSON.parse(await fs.readFile(join(publishDir, name))) as PublishPlan;
            if (candidate.parentRunId !== plan.parentRunId) continue;
            for (const row of candidate.rows) {
                if (row.tier === 0) tierZero.push({ plugin: row.plugin, rowId: row.id });
            }
        } catch {
            // an unreadable sibling plan simply contributes no tier-0 rows
        }
    }
    for (const source of LINK_SOURCES) {
        const entry = tierZero.find((candidate) => candidate.plugin === source.plugin);
        if (entry === undefined) continue;
        const path = join(publishDir, 'receipts', `${entry.rowId}.json`);
        if (!(await fs.exists(path))) continue;
        try {
            const receipt = JSON.parse(await fs.readFile(path)) as Receipt & { guid?: string };
            if (receipt.status !== 'succeeded' || !receipt.url) continue;
            if (receipt.parentRunId !== plan.parentRunId) continue;
            all[source.receipt] = receipt.url;
            // Draft/public proof levels are separate (0332 R4): a non-dummy tier-0 URL feeds draft
            // rows, but only a receipt whose row actually went out in live mode may fill a live
            // row's placeholder — a draft or rehearsal URL is not a public link.
            if (receipt.dummy !== true) real[source.receipt] = receipt.url;
            if (receipt.dummy !== true && receipt.mode === 'live') live[source.receipt] = receipt.url;
        } catch {
            // an unreadable tier-0 receipt simply leaves the placeholder unresolved
        }
    }
    return { real, live, all };
}

async function readPodcastTier0AssetLinks(
    fs: FileSystem,
    receiptsDir: string,
    parentRunId: string,
    consumerMode: 'draft' | 'live' | 'dummy',
): Promise<{ imageUrl?: string; podcastUrl?: string } | null> {
    if (!(await fs.exists(receiptsDir))) return null;
    for (const name of (await fs.readDir(receiptsDir)).filter((entry) => entry.endsWith('.json'))) {
        try {
            const receipt = JSON.parse(await fs.readFile(join(receiptsDir, name))) as Receipt;
            if (
                receipt.plugin !== 'podcast-pub' ||
                receipt.parentRunId !== parentRunId ||
                receipt.status !== 'succeeded' ||
                receipt.dummy === true ||
                (consumerMode === 'live' && receipt.mode !== 'live') ||
                receipt.aggregatePath === undefined
            ) {
                continue;
            }
            if (!(await fs.exists(receipt.aggregatePath))) continue;
            const aggregate = JSON.parse(await fs.readFile(receipt.aggregatePath)) as {
                targets?: Array<{ url?: string; metadata?: Record<string, unknown> }>;
            };
            const first = aggregate.targets?.[0];
            const rawImage = typeof first?.metadata?.imageUrl === 'string' ? first.metadata.imageUrl : undefined;
            const rawUrl = typeof first?.url === 'string' ? first.url : receipt.url;
            const imageUrl = rawImage !== undefined && /^https:\/\//.test(rawImage) ? rawImage : undefined;
            const podcastUrl = rawUrl !== undefined && /^https:\/\//.test(rawUrl) ? rawUrl : undefined;
            if (imageUrl !== undefined || podcastUrl !== undefined) {
                return { ...(imageUrl ? { imageUrl } : {}), ...(podcastUrl ? { podcastUrl } : {}) };
            }
        } catch {
            // unreadable podcast receipt or aggregate leaves the original payload untouched
        }
    }
    return null;
}

/**
 * 0395: every receipt on disk, in the owner-URL shape 0388 resolves links from.
 *
 * A receipt is evidence for the bundle revision its `parentRunId` names; the Fleet-wide read is safe
 * because the resolution step keeps only the ones bound to this bundle. An unreadable receipt
 * contributes nothing — it can never confirm a link.
 */
async function readOwnerReceipts(fs: FileSystem, publishDir: string): Promise<OwnerReceipt[]> {
    const receiptsDir = join(publishDir, 'receipts');
    if (!(await fs.exists(receiptsDir))) return [];
    const receipts: OwnerReceipt[] = [];
    for (const name of (await fs.readDir(receiptsDir)).filter((entry) => entry.endsWith('.json'))) {
        try {
            const receipt = JSON.parse(await fs.readFile(join(receiptsDir, name))) as Receipt;
            receipts.push({
                // The matrix writes the plan row id into `target`; the file name is the same key.
                targetId: receipt.target ?? name.replace(/\.json$/, ''),
                plugin: receipt.plugin,
                parentRunId: receipt.parentRunId,
                status: receipt.status,
                mode: receipt.mode,
                ...(receipt.url === undefined ? {} : { url: receipt.url }),
            });
        } catch {
            // an unreadable receipt confirms nothing
        }
    }
    return receipts;
}

/**
 * 0395: the Official Account ARTICLE rows of THIS bundle revision.
 *
 * Scanned across the run's sibling plans for the same reason `readLinkMap` is — the Channels row
 * lives in the RSS window while the 公众号 article row is planned in after-generate, and the card
 * send must still know which receipt is allowed to confirm its link. Only `variant: article` rows
 * qualify: the 公众号 播客 row is an audio post with no article to link.
 */
async function readOfficialAccountArticleIds(fs: FileSystem, publishDir: string, plan: PublishPlan): Promise<string[]> {
    const ids: string[] = [];
    const planPaths = ((await fs.exists(publishDir)) ? await fs.readDir(publishDir) : []).filter((name) =>
        /^plan\..*\.json$/.test(name),
    );
    for (const name of planPaths) {
        try {
            const candidate = JSON.parse(await fs.readFile(join(publishDir, name))) as PublishPlan;
            if (candidate.parentRunId !== plan.parentRunId) continue;
            for (const row of candidate.rows) {
                if (row.plugin === OFFICIAL_ACCOUNT_PLUGIN && row.variant === 'article' && !ids.includes(row.id)) {
                    ids.push(row.id);
                }
            }
        } catch {
            // an unreadable sibling plan contributes no producer rows
        }
    }
    return ids;
}

/** Mode ordering for ledger adoption: a wider earlier dispatch covers a narrower later one. */
const DISPATCH_MODE_RANK: Record<DispatchMode, number> = { off: 0, dummy: 1, draft: 2, live: 3 };

/**
 * 0388: does the dispatch ledger refuse to send this row again on the frozen date?
 *
 * The ledger closes the ONE door the receipts cannot: a target it recorded as `dispatched` whose
 * receipt evidence is gone (deleted, moved away, lost with the run dir) must not be sent a second
 * time — a completed external effect is never repeated. When the receipt IS still there, this file's
 * own identity rules stay the authority (they reconcile a changed payload or a draft→live promotion
 * instead of silently skipping), so the ledger does not pre-empt them.
 *
 * A rehearsal (`dummy`) has no external effect and never suppresses, and a narrower recorded mode
 * (draft) does not cover a wider planned one (live): the plan's mode stays the authority on what may
 * go out. `retry`/`pending`/`blocked`/`deferred` never suppress — those rows keep going through the
 * resend rules (succeeded skipped, live-with-unknown-effect never resent, `--retry` resends
 * `effect: none` failures only).
 */
function ledgerSuppresses(row: PublishPlanRow, entry: DispatchEntry | undefined, hasReceipt: boolean): boolean {
    if (entry === undefined || entry.state !== 'dispatched') return false;
    if (hasReceipt) return false;
    if (entry.mode === 'dummy' || row.mode === 'dummy') return false;
    return DISPATCH_MODE_RANK[entry.mode] >= DISPATCH_MODE_RANK[row.mode];
}

/**
 * `publish-matrix-send`: dispatch the plan's rows in tier order and record one receipt per row.
 *
 * Tier 0 is the publication contract: serial and first, because every later tier's
 * `{{article_url}}` / `{{podcast_url}}` resolves from its receipts. A failed tier-0 row fails only
 * the later rows whose payload actually asks for the missing link (`unresolved-link`, effect none);
 * unrelated channels still dispatch. Resend rules are the itc ones, inherited through `sendRows` —
 * a succeeded row is skipped, a live row with an unknown effect is never resent, and `--retry` only
 * resends `effect: none` failures.
 */
export async function sendPublishMatrix(args: string[], deps: PublishMatrixDeps = {}): Promise<number> {
    const fs = deps.fs ?? createNodeFileSystem();
    const [workDir = ''] = args;
    const windowArg = flagValue(args, '--window');
    const tierArg = flagValue(args, '--tier');
    const retry = args.includes('--retry');
    // 0382: a live row whose effect is unknown is never resent unless the operator asserts, after
    // checking the channel, that the earlier attempt published nothing. Recorded in the receipt's
    // diagnostics by sendRows.
    const confirmNone = args.includes('--confirm-none');
    if (!workDir || windowArg === undefined) {
        echoError('usage: publish-matrix-send <work_dir> --window <w> [--retry] [--tier <n>] [--confirm-none]');
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
        // 0347 F7 (2026-11-10): repair (--retry) on a gated-miss day hits a missing plan — the plan
        // node never runs when the rss-gate misses, so "no plan" there is a vacuous repair, not a
        // misconfiguration. Settle as a no-op so the window records a clean incident instead of a
        // dag failure; non-retry sends still fail loud through readPlan.
        if (retry && !(await fs.exists(join(workDir, '4-publish', `plan.${parsedWindow.data}.json`)))) {
            echo(
                `publish-matrix-send: no plan for window '${parsedWindow.data}' — nothing was planned, nothing to resend`,
            );
            return 0;
        }
        const plan = await readPlan(fs, workDir, parsedWindow.data);
        const publishDir = join(workDir, '4-publish');
        const receiptsDir = join(publishDir, 'receipts');
        await fs.ensureDir(receiptsDir);
        const planDigest = createHash('sha256')
            .update(await fs.readFile(join(publishDir, `plan.${plan.window}.json`)))
            .digest('hex');

        const tiers = [...new Set(plan.rows.map((row) => row.tier))].sort((a, b) => a - b);
        const tierRows = onlyTier === undefined ? plan.rows : plan.rows.filter((row) => row.tier === onlyTier);

        // 0388: the dispatch ledger is the durable record of "dispatched once per FROZEN date".
        // This file stays the authority on MODES and per-row resend rules; the ledger answers the
        // other question — what was already dispatched for this date — so a second trigger for the
        // same date (a re-run, a later window) repeats no completed effect. The frozen day comes
        // from the plan (which froze it from the bundle/`--run-date`), so a legacy `--window`
        // invocation still lands on the same day and adopts the same ledger.
        const frozen = resolveFrozenRunDate({
            ...(plan.runDate === undefined ? {} : { runDate: plan.runDate }),
            window: plan.window,
        });
        const priorLedger = await readDispatchLedger(fs, workDir);
        const ledgerTargets: DispatchTarget[] = [
            ...plan.rows.map((row) => ({
                id: row.id,
                plugin: row.plugin,
                ...(row.operation === undefined ? {} : { operation: row.operation }),
                window: row.window,
                tier: row.tier,
                mode: row.mode,
            })),
            // Entries recorded for a sibling window of this run stay in the ledger: this trigger
            // plans only its own window, but it must not forget what the other windows dispatched.
            ...(priorLedger?.entries ?? [])
                .filter((entry) => !plan.rows.some((row) => row.id === entry.id))
                .map((entry) => ({ ...entry })),
        ];
        let ledger = planDispatch({
            runDate: frozen.runDate,
            window: plan.window,
            targets: ledgerTargets,
            frozenSource: frozen.source,
            bundleRunId: plan.bundleRunId,
            ledger: priorLedger,
        });
        const recorded = new Map(ledger.entries.map((entry) => [entry.id, entry] as const));
        const withReceipt = new Set<string>();
        for (const row of tierRows) {
            if (await fs.exists(join(receiptsDir, `${row.id}.json`))) withReceipt.add(row.id);
        }
        const suppressed = tierRows.filter((row) =>
            ledgerSuppresses(row, recorded.get(row.id), withReceipt.has(row.id)),
        );
        const pending = tierRows.filter((row) => !ledgerSuppresses(row, recorded.get(row.id), withReceipt.has(row.id)));
        for (const row of suppressed) {
            echoError(
                `publish-matrix-send: ${row.id} was already dispatched for ${frozen.runDate} and its receipt evidence is gone — not resending; remove its entry from ${dispatchLedgerPath(workDir)} if the channel really published nothing`,
            );
        }

        // The matrix, not the ledger, decides whether a dependency-blocked row may still go out
        // (2026-11-12: the link dependency is per payload). Every row this pass actually sends is
        // therefore `pending`, so its outcome is recorded instead of being silently dropped by
        // `applyDispatchResults`.
        const sendIds = new Set(pending.map((row) => row.id));
        ledger = {
            ...ledger,
            entries: ledger.entries.map((entry) => {
                if (!sendIds.has(entry.id) || (entry.state !== 'blocked' && entry.state !== 'deferred')) {
                    return entry;
                }
                const { blockedBy: _blockedBy, ...rest } = entry;
                return { ...rest, state: 'pending' as const };
            }),
        };

        // Edit-while-paused revalidation (0331 R5): before any dispatch, every dispatched row's
        // payload must still match the digest the plan froze, and every real row's source variant
        // must still match the frozen (reviewed) bytes. Rows dispatched as dummy are a rehearsal and
        // are not gated. Old plans without variantDigest keep working (additive field).
        for (const row of pending) {
            if (row.mode === 'dummy') continue;
            const payloadPath = join(workDir, row.payloadPath);
            const payloadRaw = (await fs.exists(payloadPath)) ? await fs.readFile(payloadPath) : null;
            if (payloadRaw === null) {
                throw new Error(`payload missing for '${row.id}': ${payloadPath}; re-run publish-matrix-plan`);
            }
            const payloadActual = createHash('sha256').update(payloadRaw).digest('hex');
            if (payloadActual !== row.payloadDigest) {
                throw new Error(
                    `payload for '${row.id}' changed after the plan was frozen (reviewed ${row.payloadDigest}, on disk ${payloadActual}); re-run publish-matrix-plan`,
                );
            }
            if (row.variantPath !== undefined && row.variantDigest !== undefined) {
                const variantPath = join(workDir, row.variantPath);
                const variantRaw = (await fs.exists(variantPath)) ? await fs.readFile(variantPath) : null;
                if (variantRaw === null) {
                    throw new Error(
                        `variant source missing for '${row.id}': ${variantPath}; re-run publish-matrix-plan`,
                    );
                }
                const variantActual = createHash('sha256').update(variantRaw).digest('hex');
                if (variantActual !== row.variantDigest) {
                    throw new Error(
                        `variant source for '${row.id}' changed after the freeze; re-run the variants safety gate and publish-matrix-plan`,
                    );
                }
            }
        }

        // A failed required tier-0 row no longer blocks every later tier (2026-11-12): the link
        // dependency is per payload, and `preparePayload` already fails a row whose `{{article_url}}`
        // / `{{podcast_url}}` has no receipt to resolve — with `effect: none`, so a bounded retry can
        // pick it up. Blocking unrelated channels (xhs, shipinhao) on a surfdash CMS hiccup lost two
        // whole days of planned posts; downstream posts that do link tier 0 still cannot go out with
        // a broken or missing link.
        // 0395 (L3 R18): the WeChat Channels 图文 row may only carry the CONFIRMED Official Account
        // article link. Its gate is resolved per row per pass from this bundle's receipts, so an
        // operator who releases the article and retries simply finds a confirmed link — nothing is
        // cached between passes and no second ledger records the wait (0388's `retry` does).
        const channelsCardIds = new Set(plan.rows.filter((row) => isChannelsCardTarget(row)).map((row) => row.id));

        for (const tier of tiers) {
            const rows = pending.filter((row) => row.tier === tier);
            if (rows.length === 0) continue;

            const linkMaps = tier === 0 ? { real: {}, live: {}, all: {} } : await readLinkMap(fs, publishDir, plan);
            const sendRowsInput: SendRow[] = rows.map((row) => ({
                key: row.id,
                plugin: row.plugin,
                profile: row.profile ?? 'article',
                mode: row.mode,
                payloadPath: join(workDir, row.payloadPath),
                transport: row.transport ?? 'fanout',
                ...(row.metadata !== undefined ? { metadata: row.metadata } : {}),
                receiptExtras: { target: row.id, window: plan.window },
            }));

            const sendOutcome = await sendRows({
                rows: sendRowsInput,
                publishDir,
                receiptsDir,
                parentRunId: plan.parentRunId,
                planDigest,
                retry,
                ...(confirmNone ? { confirmNone } : {}),
                label: 'publish-matrix-send',
                fs,
                ...(deps.dispatch ? { dispatch: deps.dispatch } : {}),
                // A dummy row gets the same payload work as a real one — that is the rehearsal.
                dummyReceipt: (row, context) =>
                    writeDummyReceipt(fs, row, { ...context, parentRunId: plan.parentRunId, planDigest }),
                preparePayload: async (row) => {
                    if (tier === 0) {
                        if (row.plugin === 'surfdash-pub' && (await fs.exists(row.payloadPath))) {
                            // Keep an already-delivered raw payload identity intact on replay (e.g.
                            // legacy presets where surfdash-pub ran before podcast-pub wrote its receipt).
                            const rawDigest = createHash('sha256')
                                .update(await fs.readFile(row.payloadPath))
                                .digest('hex');
                            const priorReceiptPath = join(receiptsDir, `${row.key}.json`);
                            if (await fs.exists(priorReceiptPath)) {
                                try {
                                    const prior = JSON.parse(await fs.readFile(priorReceiptPath)) as Receipt;
                                    if (
                                        prior.status === 'succeeded' &&
                                        prior.dummy !== true &&
                                        prior.parentRunId === plan.parentRunId &&
                                        prior.payloadDigest === rawDigest
                                    ) {
                                        return { payloadPath: row.payloadPath };
                                    }
                                } catch {
                                    // unreadable prior receipt falls through to normal payload preparation
                                }
                            }
                            const podcastLinks = await readPodcastTier0AssetLinks(
                                fs,
                                receiptsDir,
                                plan.parentRunId,
                                row.mode,
                            );
                            if (podcastLinks !== null) {
                                const parsed = JSON.parse(await fs.readFile(row.payloadPath)) as {
                                    metadata?: Record<string, unknown>;
                                    [key: string]: unknown;
                                };
                                const nextMetadata: Record<string, unknown> = { ...(parsed.metadata ?? {}) };
                                if (podcastLinks.imageUrl !== undefined) {
                                    nextMetadata.coverImage = podcastLinks.imageUrl;
                                }
                                if (podcastLinks.podcastUrl !== undefined) {
                                    nextMetadata.podcastUrl = podcastLinks.podcastUrl;
                                }
                                const resolvedPath = join(
                                    workDir,
                                    '4-publish',
                                    'payloads',
                                    `content.${row.key}.resolved.json`,
                                );
                                await fs.writeFile(
                                    resolvedPath,
                                    `${JSON.stringify({ ...parsed, metadata: nextMetadata }, null, 2)}\n`,
                                );
                                return { payloadPath: resolvedPath };
                            }
                        }
                        return { payloadPath: row.payloadPath };
                    }
                    const raw = (await fs.exists(row.payloadPath)) ? await fs.readFile(row.payloadPath) : '';
                    const links: LinkMap =
                        row.mode === 'dummy' ? linkMaps.all : row.mode === 'live' ? linkMaps.live : linkMaps.real;
                    // 0395: the Channels card is gated BEFORE any payload work. A missing, drafted,
                    // foreign or unsafe link fails only THIS row (effect `none` receipt + ledger
                    // `retry`), so the other targets of the window keep their configured modes and
                    // dispatch. A `dummy` row is a rehearsal with no external effect and never
                    // blocks on the real article: it carries the link when one exists.
                    let cardLink: string | undefined;
                    if (channelsCardIds.has(row.key)) {
                        const gate = gateChannelsCard({
                            receipts: await readOwnerReceipts(fs, publishDir),
                            parentRunId: plan.parentRunId,
                            producerIds: await readOfficialAccountArticleIds(fs, publishDir, plan),
                        });
                        if (!gate.ok) {
                            await appendEvent(fs, publishDir, {
                                event: 'channels-card-deferred',
                                window: plan.window,
                                id: row.key,
                                reason: gate.reason,
                                detail: gate.detail,
                                mode: row.mode,
                            });
                            if (row.mode !== 'dummy') {
                                echoError(`publish-matrix-send: ${row.key} deferred — ${gate.detail}`);
                                return { error: `channels-card-${gate.reason}` };
                            }
                            echo(`publish-matrix-send: ${row.key} rehearsal — ${gate.detail}`);
                        } else {
                            cardLink = gate.url;
                            await appendEvent(fs, publishDir, {
                                event: 'channels-card-bound',
                                window: plan.window,
                                id: row.key,
                                articleTarget: gate.receiptId,
                                articleUrl: gate.url,
                                mode: row.mode,
                            });
                        }
                    }
                    let resolved = raw;
                    for (const source of LINK_SOURCES) {
                        const url = links[source.receipt];
                        if (url === undefined) continue;
                        // The payload is JSON text: escape the URL as a string fragment so a quote or
                        // backslash in it cannot break the document.
                        resolved = resolved.split(source.placeholder).join(JSON.stringify(url).slice(1, -1));
                    }
                    if (cardLink !== undefined) {
                        // The confirmed link rides the APPROVED card bytes: the shared `cards` variant
                        // has no link field, so it lands in the caption and the placement is recorded
                        // in the resolved payload's metadata (design: use the channel's link
                        // mechanism when it exists, else the body link, saying which).
                        const carried = carryOfficialAccountLink(resolved, cardLink);
                        resolved = carried.text;
                        echo(
                            `publish-matrix-send: ${row.key} carries the confirmed Official Account link (${carried.placement})`,
                        );
                    }
                    if (LINK_SOURCES.some((source) => resolved.includes(source.placeholder))) {
                        // A draft may proceed without the cross-link (0383 follow-up): WeChat's
                        // `originalUrl` is optional and a draft is reviewed before it publishes, so
                        // a missing surfdash URL must not block the draft. A live row keeps refusing —
                        // a published article carrying an unresolved placeholder is worse than none.
                        const unresolved = LINK_SOURCES.filter((source) => resolved.includes(source.placeholder)).map(
                            (source) => source.placeholder,
                        );
                        const draftMayDropLink =
                            row.mode === 'draft' &&
                            unresolved.every((placeholder) => placeholder === '{{article_url}}');
                        if (draftMayDropLink) {
                            resolved = resolved.replace(
                                /"originalUrl"\s*:\s*"\{\{article_url\}\}"/,
                                '"originalUrl": ""',
                            );
                            echo(
                                `publish-matrix-send: ${row.key} is a draft — dropped the unresolved {{article_url}} cross-link`,
                            );
                        }
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

            // 0388: record this tier's outcomes in the ledger before anything can throw, so a
            // partial pass is durable: a sent row becomes `dispatched` (never repeated) and a failed
            // one `retry` (re-attempted alone). A row the send loop skipped as an identical
            // succeeded receipt is a completed effect too — the ledger converges on the receipts.
            ledger = applyDispatchResults(ledger, [
                ...sendOutcome.receipts.map((receipt) => ({
                    id: receipt.target ?? receipt.plugin,
                    ok: receipt.status === 'succeeded',
                    ...(receipt.url === undefined ? {} : { url: receipt.url }),
                    ...(receipt.error === undefined ? {} : { error: receipt.error }),
                })),
                ...sendOutcome.skipped.map((id) => ({ id, ok: true })),
            ]);
            await writeDispatchLedger(fs, workDir, ledger);

            if (sendOutcome.reconciliationRequired.length > 0) {
                throw new Error(
                    `receipt reconciliation required for: ${sendOutcome.reconciliationRequired.join(', ')}`,
                );
            }
        }

        echo(`window ${plan.window}: ${pending.length} target(s) dispatched`);
        if (suppressed.length > 0) {
            echo(
                `publish-matrix-send: adopted ${suppressed.length} target(s) the ledger already dispatched for ${frozen.runDate} (${frozen.source}) — not resent`,
            );
        }
        echo(
            `publish-matrix-send: dispatch ledger ${dispatchLedgerPath(workDir)} — ${ledger.entries.filter((entry) => entry.state === 'dispatched').length} dispatched, ${dispatchable(ledger).length} pending, ${retryable(ledger).length} retryable (frozen date ${ledger.runDate})`,
        );
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
 * Decide whether the feed carries the gated episode (task 0323 R3, tightened by 0332 R5).
 *
 * A known guid is authoritative in BOTH directions: the receipt names the episode this bundle
 * produced, so a feed that carries a different episode — even one with a matching title-date — is a
 * miss, never a hit. The title-date fallback remains only for receipts that recorded no guid (or
 * runs with no tier-0 receipt yet). A feed that could not be fetched is a **miss**, never a hit: an
 * outage must not let an unpublished episode through, and `reason` keeps the classes distinguishable
 * in the incident.
 */
export function matchRssGate(items: readonly FeedItem[], date: string, guid: string): RssGateResult['reason'] {
    if (guid !== '') return items.some((item) => item.guid === guid) ? 'guid' : 'missing';
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
    const dateRaw = flagValue(args, '--date');
    const feedUrl = flagValue(args, '--feed') ?? 'https://podcast.salty.vip/rss/';
    if (!workDir) {
        echoError('usage: publish-matrix-rss-gate <work_dir> [--date <YYYY-MM-DD|YYYYMMDD>] [--feed <url>]');
        return 1;
    }
    const publishDir = join(workDir, '4-publish');

    const bundlePath = await resolveBundlePath(fs, workDir);
    const hasBundle = await fs.exists(bundlePath);
    if (hasBundle) {
        try {
            const parsed = BundleSchema.safeParse(JSON.parse(await fs.readFile(bundlePath)));
            if (!parsed.success) throw new Error(parsed.error.message);
            if (parsed.data.episode === undefined) {
                throw new Error("bundle is missing required field 'episode' for RSS gating");
            }
        } catch (err: unknown) {
            echoError(
                `publish-matrix-rss-gate: malformed bundle at ${bundlePath}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }
    }

    // The gate's day is the bundle's own calendar day (0332 R1/R5): a provided date must normalize
    // and must not disagree with the plans it is gating — a wrong date never authorizes a send.
    let date = dateRaw !== undefined && dateRaw.trim() !== '' ? normalizeRunDate(dateRaw) : undefined;
    if (dateRaw !== undefined && dateRaw.trim() !== '' && date === undefined) {
        echoError(`publish-matrix-rss-gate: '${dateRaw}' is not a valid calendar day (YYYY-MM-DD or YYYYMMDD)`);
        return 1;
    }

    // A tier-0 podcast receipt carries the guid the feed must contain; a receipt that records none
    // leaves the title-date match as the only evidence. Plans bind the date even when no receipt
    // exists yet — a gate before any send must still refuse a date that disagrees with the bundle.
    let guid = '';
    const receiptsDir = join(publishDir, 'receipts');
    for (const planWindow of ['after-generate', 'cn-peak'] as const) {
        const planPath = join(publishDir, `plan.${planWindow}.json`);
        if (!(await fs.exists(planPath))) continue;
        const plan = JSON.parse(await fs.readFile(planPath)) as PublishPlan;
        if (plan.runDate !== undefined) {
            if (date !== undefined && date !== plan.runDate) {
                echoError(
                    `publish-matrix-rss-gate: date ${date} disagrees with the bundle's own day ${plan.runDate}; refusing to authorize an overseas send`,
                );
                return 1;
            }
            date = plan.runDate;
        }
        if (!(await fs.exists(receiptsDir))) continue;
        for (const row of plan.rows) {
            if (row.plugin !== 'podcast-pub') continue;
            const receiptPath = join(receiptsDir, `${row.id}.json`);
            if (!(await fs.exists(receiptPath))) continue;
            const receipt = JSON.parse(await fs.readFile(receiptPath)) as Receipt & { guid?: string };
            if (typeof receipt.guid === 'string') guid = receipt.guid;
        }
    }
    if (date === undefined) {
        // Omitted --date derives from the validate stage's canonical output, then the plan.
        const stampPath = join(publishDir, 'run-date.txt');
        const stamp = (await fs.exists(stampPath))
            ? normalizeRunDate((await fs.readFile(stampPath)).trim())
            : undefined;
        if (stamp === undefined) {
            echoError('publish-matrix-rss-gate: no usable --date and no run-date.txt/plan.runDate to derive one from');
            return 1;
        }
        date = stamp;
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

    // An empty QC pool deliberately has no bundle. Record a conservative miss so the workflow can
    // classify the day as no-content; absence of a bundle must never authorize an RSS send.
    if (!hasBundle) {
        return write({
            schemaVersion: 1,
            date,
            feedUrl,
            hit: false,
            reason: 'missing',
            detail: `bundle.json is absent at ${bundlePath}; no episode was generated`,
        });
    }

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
    // Parity/rehearsal seam: an offline test drives the real workflow stack, so a window whose
    // target is hours away would otherwise sleep through the test's budget. Documented and
    // never set by a shipped job; the production path always waits.
    if (process.env.KK_WINDOW_WAIT === 'skip') {
        echo(`publish-matrix-wait-until: ${target} ${zone} skipped (KK_WINDOW_WAIT=skip)`);
        return 0;
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
    const targetMinutes = hours * 60 + minutes;
    // A clock that wrapped past midnight in `zone` (more than the <=180min DST cushion before
    // `target`) is 15-24h AFTER the previous day's `target`, not hours ahead of today's.
    if (already >= targetMinutes || targetMinutes - already > 180) {
        echo(`publish-matrix-wait-until: ${zone} is already past ${target}`);
        return 0;
    }

    let wait = (targetMinutes - already) * 60_000;
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
    const configPath = resolveConfigPath(env, env.HOME ?? '');
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
    const presetSlug = flagValue(args, '--preset');
    if (!workDir || runDate === undefined || parentRunId === undefined) {
        echoError(
            'usage: publish-matrix-bundle <work_dir> --run-date <YYYY-MM-DD> --run-id <voice3 run id> [--preset <slug>]',
        );
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

        // 0329 F02: a preset-required variant that the run never produced must fail the freeze —
        // before any bundle write — instead of freezing a bundle whose tier-0 send dies later with
        // "variant not found" after the publish window opened.
        const preset =
            deps.preset ??
            (presetSlug !== undefined
                ? (await loadPublishPreset(presetSlug, { projectRoot: deps.projectRoot }, fs)).preset
                : undefined);
        if (preset !== undefined) {
            const missing = preset.targets
                .filter((target: PublishPresetTarget) => target.required === true && target.variant !== undefined)
                .filter((target: PublishPresetTarget) => variants[target.variant as string] === undefined)
                .map((target: PublishPresetTarget) => target.variant as string);
            if (missing.length > 0) {
                echoError(
                    `publish-matrix-bundle: preset '${preset.name}' requires variant(s) the run never produced: ${missing.join(', ')}`,
                );
                return 1;
            }
        }

        const articleTitle = await readVariantTitle(fs, workDir, variants);

        // Freeze admission (0331 R2/R3): final-variant safety evidence, when the variants gate ran,
        // is attached verbatim; a 'block' verdict refuses the freeze entirely. A missing evidence
        // file still freezes (dummy-capable bundle) — real planning is gated at plan time instead.
        const safetyPath = join(workDir, '4-safety-variants', 'safety.json');
        let safety: z.infer<typeof BundleSafetySchema> | undefined;
        if (await fs.exists(safetyPath)) {
            const safetyParsed = BundleSafetySchema.safeParse(JSON.parse(await fs.readFile(safetyPath)));
            if (!safetyParsed.success) {
                echoError(
                    `publish-matrix-bundle: malformed final-variant safety evidence at ${safetyPath}: ${safetyParsed.error.message}`,
                );
                return 1;
            }
            // 'block' is unrepresentable in BundleSafetySchema: a raw block verdict fails the parse
            // above and refuses the freeze with the malformed-evidence error (0331 R2/R3).
            safety = safetyParsed.data;
            // 0382: the evidence must describe the bytes being frozen. A safety pass that reviewed one
            // revision and a freeze that hashed a later one produced a bundle whose `safety.variants`
            // and `variants[].sha256` disagreed, which only surfaced at publish time as "changed after
            // review". Refusing here turns that into a freeze-time error with the fix in the message.
            const disagreed = Object.entries(safety.variants)
                .filter(([key, reviewed]) => {
                    const frozen = variants[key]?.sha256;
                    return frozen !== undefined && frozen !== reviewed;
                })
                .map(([key]) => key);
            if (disagreed.length > 0) {
                echoError(
                    `publish-matrix-bundle: final-variant safety evidence is stale for ${disagreed.join(', ')} — the reviewed digest differs from the variant being frozen; re-run the variants safety gate (kk-daily-safety scope=variants) and freeze again`,
                );
                return 1;
            }
        }

        const bundle: Bundle = {
            schemaVersion: 1,
            runId: `${runDate}-${parentRunId}`,
            runDate,
            parentRunId,
            runs: [],
            episode: { title: articleTitle === '' ? `每日AI乱炖 · ${runDate}` : articleTitle },
            variants,
            ...(safety !== undefined ? { safety } : {}),
        };
        const validated = BundleSchema.parse(bundle);
        const bundlePath = join(workDir, 'bundle.json');
        // A re-freeze keeps the windows already recorded (deduped — a double append must not
        // multiply) and appends its own generate run id last, so the bundle always names the run
        // that produced it (0329 R2).
        if (await fs.exists(bundlePath)) {
            try {
                const prior = BundleSchema.parse(JSON.parse(await fs.readFile(bundlePath)));
                const deduped = [...new Set(prior.runs)];
                if (!deduped.includes(parentRunId)) deduped.push(parentRunId);
                validated.runs = deduped;
            } catch {
                // an unreadable prior bundle is replaced by this validated one
            }
        }
        if (!validated.runs.includes(parentRunId)) validated.runs.push(parentRunId);
        // Preserve legacy stage bytes; schema defaults are interpreted only when reading.
        await fs.writeFile(bundlePath, `${JSON.stringify({ ...bundle, runs: validated.runs }, null, 2)}\n`);
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
