/**
 * The plain launch verbs, `kk <noun> generate` and `kk <noun> publish` (task 0365, ADR-053 §3).
 *
 * `generate` launches `content_types.<type>.workflow`; `publish` launches the shared `kk-publish`
 * workflow. Both hand straight over to `launchWorkflow` (`apps/cli/src/launch.ts`), which owns the
 * six supervised steps; this module owns the verb surface: flag parsing, run and workflow
 * resolution, the two publish admission rules of design §3.2, and the window/CN-consent validation
 * ported from the retired publish-window launcher (design §3.3).
 *
 * Exit codes (design §1): `0` done, `1` the step ran and failed, `2` usage, `5` refused by
 * preflight/admission, `6` another launch holds `<workflow>-<run>`.
 *
 * Task 0366 R4: the publish launch passes `noun` and `dummy` in the shape `kk-publish.yaml` declares.
 * `noun` selects the step verbs (`kk news publish-plan` vs `kk article publish-plan`) of the one
 * shared workflow. `dummy` carries the rehearsal *flag word* (`--dummy`, or nothing) rather than
 * `true`/`false`: the workflow must add an optional boolean flag to a single-call node command, the
 * engine rejects `${vars.x:+…}` conditionals as an undeclared reference (probe: spur 0.4.33), and R2
 * forbids assembling it with a multi-command shell.
 */
import { basename, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import {
    ContentTypeSkillMissingError,
    ContentTypeUnknownError,
    type ResolvedContentType,
    resolveContentType,
    resolveRun,
} from '../content-types';
import { type LaunchReceipt, launchWorkflow, type PlannedLaunch, PUBLISH_WORKFLOW } from '../launch';
import { consoleOutput } from '../output';
import { resolvePackageRoot } from '../package-root';
import { PublishWindowSchema } from '../publish-core';
import { resolveBundlePath } from '../publish-matrix';
import { type ContentConfigDocument, configPath, expandHome, readConfig, resolveWorksDir } from './content';

/** Windows `publish` accepts (design §1.1; the matrix's own enum from 0364). */
const PUBLISH_WINDOWS = PublishWindowSchema.options;

/** Flags of `kk <noun> generate` (design §1.1). */
interface GenerateOptions {
    type?: string;
    slug?: string;
    runDate?: string;
    agent?: string;
    skipReview?: boolean;
    auto?: boolean;
    publish?: boolean;
    channels?: string;
    liveChannels?: string;
    timeoutMs?: string;
    allowDirty?: boolean;
    dryRun?: boolean;
}

/** Flags of `kk <noun> publish` (design §1.1). */
interface PublishOptions {
    type?: string;
    slug?: string;
    runDate?: string;
    workDir?: string;
    window?: string;
    preset?: string;
    channels?: string;
    liveChannels?: string;
    liveConfirm?: boolean;
    dummy?: boolean;
    retry?: boolean;
    agent?: string;
    unattended?: boolean;
    yes?: boolean;
    timeoutMs?: string;
    dryRun?: boolean;
}

interface JsonObject {
    [key: string]: unknown;
}

// The surface rule `cli-no-parse-at-module-scope` bans the JSON decode token under
// `commands/*.ts` (it cannot tell a JSON decode from Commander's own parse call), so the decode is
// bound once here — the same seam `commands/content.ts` uses.
const parseJson = JSON.parse.bind(JSON);

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Fail loud through the CommanderError contract `main()` maps to an exit code. */
function fail(code: number, id: string, message: string): never {
    consoleOutput.error(message);
    throw new CommanderError(code, id, message);
}

/** `YYYY-MM-DD` or `YYYYMMDD` as `YYYYMMDD`, or undefined when it is not a real day (matrix parity). */
export function normalizeRunDate(raw: string): string | undefined {
    const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw.trim());
    if (match === null) return undefined;
    const digits = `${match[1]}${match[2]}${match[3]}`;
    const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString().slice(0, 10).replaceAll('-', '') === digits ? digits : undefined;
}

/** Today (offset 0) or yesterday (offset -1) in America/Los_Angeles — the episodes' own day. */
function losAngelesDate(offsetDays = 0): string {
    const instant = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(instant).replaceAll('-', '');
}

/**
 * Resolve the workflow YAML: the `workflows_dir` config override first (the existing escape hatch,
 * R6 — tests supply the stub `kk-publish.yaml` through it), else the shipped package root.
 */
export async function resolveWorkflowPath(
    workflow: string,
    config: ContentConfigDocument,
    fs: FileSystem,
): Promise<string> {
    const raw = config.workflows_dir;
    const override = typeof raw === 'string' ? raw.trim() : '';
    if (override !== '') {
        const candidate = resolve(expandHome(override), `${workflow}.yaml`);
        if (await fs.exists(candidate)) return candidate;
    }
    const root = await resolvePackageRoot(fs);
    return join(root, 'plugins', 'kk', 'workflows', `${workflow}.yaml`);
}

async function readJson(fs: FileSystem, path: string): Promise<JsonObject | null> {
    if (!(await fs.exists(path))) return null;
    try {
        const parsed: unknown = parseJson(await fs.readFile(path));
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseTimeout(raw: string | undefined, verb: string): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail(2, `kk.content.${verb}`, `--timeout-ms must be a positive integer, got '${raw}'`);
    }
    return value;
}

async function loadConfig(
    fs: FileSystem,
    verb: string,
): Promise<{ config: ContentConfigDocument; configFile: string }> {
    const configFile = configPath();
    try {
        return { config: await readConfig(configFile, fs), configFile };
    } catch (error) {
        return fail(2, `kk.content.${verb}`, error instanceof Error ? error.message : String(error));
    }
}

/** Resolve the content type, mapping an unknown type to exit 2 and a missing skill to exit 5. */
async function loadType(
    type: string,
    config: ContentConfigDocument,
    configFile: string,
    verb: string,
    preset?: string,
): Promise<ResolvedContentType> {
    try {
        return await resolveContentType(type, config, {
            configPath: configFile,
            ...(preset === undefined ? {} : { preset }),
        });
    } catch (error) {
        if (error instanceof ContentTypeUnknownError) fail(2, `kk.content.${verb}`, error.message);
        if (error instanceof ContentTypeSkillMissingError) fail(5, `kk.content.${verb}`, error.message);
        const message = error instanceof Error ? error.message : String(error);
        return fail(2, `kk.content.${verb}`, `invalid content type configuration in ${configFile}: ${message}`);
    }
}

/** The run identity flags shared by both verbs: `--slug` (article) or `--run-date` (news). */
function runSelector(type: string, options: { slug?: string; runDate?: string; workDir?: string }, verb: string) {
    const suppliedWorkDir = options.workDir === undefined ? undefined : resolve(expandHome(options.workDir));
    if (options.runDate !== undefined && normalizeRunDate(options.runDate) === undefined) {
        fail(2, `kk.content.${verb}`, '--run-date must be a real calendar date as YYYYMMDD');
    }
    if (type !== 'news' && options.slug === undefined && suppliedWorkDir === undefined) {
        fail(2, `kk.content.${verb}`, '--slug is required for article content and must be a lowercase slug');
    }
    return {
        slug: options.slug ?? (suppliedWorkDir === undefined ? undefined : basename(suppliedWorkDir)),
        runDate: options.runDate === undefined ? undefined : normalizeRunDate(options.runDate),
        workDir: suppliedWorkDir,
    };
}

/** Trimmed, comma-split `--channels` / `--live-channels` values, or undefined when absent. */
function channelList(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const tokens = raw
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token !== '');
    return tokens.length === 0 ? undefined : tokens.join(',');
}

/** Print the receipt and return the exit code it maps to. */
function reportReceipt(receipt: LaunchReceipt): number {
    consoleOutput.write(JSON.stringify(receipt));
    return receipt.exitCode;
}

/**
 * Validate `--live-channels` against the pinned preset's rows for this window (design §3.3, ported
 * from the retired publish-window launcher, R3/F10). Runs before the lock: a consent mismatch is a refusal.
 */
export function validateLiveTokens(
    preset: { targets?: Array<{ plugin?: string; id?: string; mode?: string; window?: string }> } | null,
    window: string,
    tokens: string[],
    presetName: string,
): void {
    if (tokens.length === 0) return;
    if (preset === null) {
        fail(5, 'kk.content.publish', `cannot validate --live-channels: preset '${presetName}' was not found`);
    }
    const inWindow = (preset.targets ?? []).filter((target) => (target.window ?? 'after-generate') === window);
    const refused = tokens.filter((token) => {
        const row = inWindow.find((target) => target.plugin === token || target.id === token);
        return row === undefined || (row.mode ?? 'draft') === 'off';
    });
    if (refused.length > 0) {
        fail(
            5,
            'kk.content.publish',
            `live token(s) ${refused.join(', ')} have no active row in window '${window}' of preset '${presetName}'`,
        );
    }
}

/** Read the preset a publish would plan against, or null when the file is absent. */
async function readPreset(
    presetName: string,
    fs: FileSystem,
): Promise<{ targets?: Array<{ plugin?: string; id?: string; mode?: string; window?: string }> } | null> {
    const root = await resolvePackageRoot(fs);
    const path = join(root, 'plugins', 'kk', 'publish-presets', `${presetName}.json`);
    return (await readJson(fs, path)) as {
        targets?: Array<{ plugin?: string; id?: string; mode?: string; window?: string }>;
    } | null;
}

/**
 * `kk <noun> generate` — resolve, then supervise one generation workflow (design §3).
 *
 * `--publish` launches `publish --window after-generate` in this same process after the generation
 * workflow exits 0 (R8): two sequential `launchWorkflow` calls, each with its own lock and receipt.
 */
async function generateAction(noun: string, defaultType: string, options: GenerateOptions): Promise<void> {
    const fs = createNodeFileSystem();
    const type = options.type ?? defaultType;
    const { config, configFile } = await loadConfig(fs, 'generate');
    const resolved = await loadType(type, config, configFile, 'generate');
    // 0373: the selector follows the resolved type — `kk article generate --type news` is a news run.
    const selector = runSelector(type, options, 'generate');
    const timeoutMs = parseTimeout(options.timeoutMs, 'generate');
    const worksDir = resolveWorksDir(config, configFile);
    const run = resolveRun({
        type,
        config,
        worksDir,
        workflow: resolved.workflow,
        ...(selector.slug === undefined ? {} : { slug: selector.slug }),
        ...(selector.runDate === undefined ? {} : { runDate: selector.runDate }),
    });
    const workflowPath = await resolveWorkflowPath(resolved.workflow, config, fs);
    const channels = channelList(options.channels);
    const liveChannels = channelList(options.liveChannels);
    const vars: Record<string, string> = { skill_dir: resolved.skillDir, preset: resolved.publish_preset };
    if (options.skipReview === true) vars.skip_review = 'true';
    if (options.auto === true) vars.auto = 'true';

    const receipt = await launchWorkflow({
        type,
        workflow: resolved.workflow,
        workflowPath,
        run: run.run,
        workDir: run.workDir,
        worksDir,
        harnessRoot: await resolvePackageRoot(fs),
        identityVar: type === 'news' ? 'run_date' : 'slug',
        vars,
        writerSkill: { dir: resolved.skillDir, sha256: resolved.skillSha256 },
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(options.allowDirty === undefined ? {} : { allowDirty: options.allowDirty }),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    });

    if (receipt.status !== 'done' || options.publish !== true) {
        const code = reportReceipt(receipt);
        if (code !== 0) fail(code, 'kk.content.generate', receipt.reason ?? `${resolved.workflow} exited ${code}`);
        return;
    }

    const publish = await publishRun({
        fs,
        config,
        configFile,
        type,
        noun,
        resolved,
        worksDir,
        run,
        window: 'after-generate',
        channels,
        liveChannels,
        unattended: false,
        allowGenerate: false,
        dryRun: false,
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    const combined = { ...receipt, publish } as LaunchReceipt & { publish: LaunchReceipt };
    consoleOutput.write(JSON.stringify(combined));
    if (publish.exitCode !== 0) {
        fail(publish.exitCode, 'kk.content.publish', publish.reason ?? `publish exited ${publish.exitCode}`);
    }
}

interface PublishRunSettings {
    fs: FileSystem;
    config: ContentConfigDocument;
    configFile: string;
    type: string;
    /** The CLI noun the workflow's step verbs are registered on (`news` | `article`). */
    noun: string;
    resolved: ResolvedContentType;
    worksDir: string;
    run: { run: string; workDir: string };
    window: string;
    preset?: string;
    channels?: string;
    liveChannels?: string;
    liveConfirm?: boolean;
    dummy?: boolean;
    retry?: boolean;
    agent?: string;
    timeoutMs?: number;
    dryRun?: boolean;
    /** The scheduled posture: one automatic `generate` when the bundle is missing (R7). */
    unattended: boolean;
    /** The operator consented to that one automatic `generate` (the legacy `--yes`). */
    allowGenerate: boolean;
}

/**
 * The CLI noun that registers a content type's step verbs (`news` → `news`, everything else →
 * `article`, whose own default type is `itc`). The workflow's node commands are `kk <noun>
 * publish-<step>`, so this — not the operator's word — is what the launch records.
 */
function nounForType(type: string): string {
    return type === 'news' ? 'news' : 'article';
}

/**
 * Publish admission (design §3.2, ported as the two rules): a `running` generate receipt refuses;
 * a missing bundle refuses unless `--unattended`/`--yes` authorizes exactly one `generate` first.
 */
async function publishRun(settings: PublishRunSettings): Promise<LaunchReceipt> {
    const { fs, type, resolved, worksDir, run } = settings;
    const publishDir = join(run.workDir, '4-publish');
    // `generate` freezes the bundle at the run root and records every variant path relative to it,
    // so publish must resolve through the same helper the plan side uses. A hardcoded
    // `4-publish/bundle.json` made a freshly generated run unpublishable (0382).
    const bundlePath = await resolveBundlePath(fs, run.workDir);
    const receiptPath = join(publishDir, `schedule-receipt.${settings.window}.json`);
    const generateReceipt = await readJson(fs, join(run.workDir, 'schedule-receipt.json'));
    const running = typeof generateReceipt?.status === 'string' && generateReceipt.status === 'running';
    let bundle = await readJson(fs, bundlePath);

    if (running) {
        fail(5, 'kk.content.publish', `generation for ${run.run} is still running (${run.workDir})`);
    }
    // Design §3.3: window and CN-consent validation is a pre-lock refusal, so it runs BEFORE the
    // auto-generate leg — a consent mismatch must not pay for a full generation first.
    const presetName = settings.preset ?? resolved.publish_preset;
    const tokens = channelList(settings.liveChannels);
    validateLiveTokens(await readPreset(presetName, fs), settings.window, tokens?.split(',') ?? [], presetName);
    /** The chained `generate` a dry run planned instead of launching (R9). */
    const planned: PlannedLaunch[] = [];
    if (bundle === null && (settings.unattended || settings.allowGenerate)) {
        const failed = generateReceipt === null || generateReceipt.status === 'failed';
        if (failed) {
            const workflowPath = await resolveWorkflowPath(resolved.workflow, settings.config, fs);
            const generated = await launchWorkflow({
                type,
                workflow: resolved.workflow,
                workflowPath,
                run: run.run,
                workDir: run.workDir,
                worksDir,
                harnessRoot: await resolvePackageRoot(fs),
                identityVar: type === 'news' ? 'run_date' : 'slug',
                vars: { skill_dir: resolved.skillDir, preset: resolved.publish_preset },
                writerSkill: { dir: resolved.skillDir, sha256: resolved.skillSha256 },
                ...(settings.agent === undefined ? {} : { agent: settings.agent }),
                ...(settings.timeoutMs === undefined ? {} : { timeoutMs: settings.timeoutMs }),
                // R9: a dry run plans only — no lock, no receipt, no child — so the leg inherits the
                // posture instead of launching a real generation before reporting `dryRun`.
                ...(settings.dryRun === undefined ? {} : { dryRun: settings.dryRun }),
            });
            if (generated.exitCode !== 0) {
                fail(
                    generated.exitCode,
                    'kk.content.generate',
                    generated.reason ?? `generation for ${run.run} exited ${generated.exitCode}`,
                );
            }
            if (generated.dryRun === undefined) {
                bundle = await readJson(fs, bundlePath);
            } else {
                planned.push({ workflow: generated.workflow, ...generated.dryRun });
            }
        }
    }
    if (bundle === null && settings.dryRun !== true) {
        fail(5, 'kk.content.publish', `no publishable bundle at ${bundlePath}`);
    }
    // A frozen bundle names its own type (0367/0368 stamp `contentType`); a mismatch is a wrong-run
    // refusal, never a silent switchboard swap.
    if (bundle !== null && typeof bundle.contentType === 'string' && bundle.contentType !== type) {
        fail(5, 'kk.content.publish', `bundle at ${bundlePath} is a '${bundle.contentType}' bundle, not '${type}'`);
    }

    const bundleDate =
        bundle !== null && typeof bundle.runDate === 'string' ? normalizeRunDate(bundle.runDate) : undefined;
    const requestedDate = type === 'news' ? run.run : undefined;
    if (bundleDate !== undefined && requestedDate !== undefined && bundleDate !== requestedDate) {
        fail(
            5,
            'kk.content.publish',
            `bundle at ${bundlePath} is dated ${bundleDate}, not the requested ${requestedDate}`,
        );
    }

    // 0373: `noun` selects the step verbs, so it must follow the RESOLVED content type rather than
    // the CLI word the operator typed — `kk article publish --type news` is a news run, and its
    // switchboard block is `content_types.news.channels`.
    const vars: Record<string, string> = { preset: presetName, window: settings.window, noun: nounForType(type) };
    if (requestedDate !== undefined) vars.run_date = requestedDate;
    else if (bundleDate !== undefined) vars.run_date = bundleDate;
    if (settings.channels !== undefined) vars.channels = settings.channels;
    if (tokens !== undefined) vars.live_channels = tokens;
    if (settings.liveConfirm === true) vars.live_confirm = 'true';
    // A rehearsal is a word in the node command, not a boolean the workflow would have to test.
    if (settings.dummy === true) vars.dummy = '--dummy';
    if (settings.retry === true) vars.retry = 'true';

    const receipt = await launchWorkflow({
        type,
        workflow: PUBLISH_WORKFLOW,
        workflowPath: await resolveWorkflowPath(PUBLISH_WORKFLOW, settings.config, fs),
        run: run.run,
        workDir: run.workDir,
        worksDir,
        harnessRoot: await resolvePackageRoot(fs),
        identityVar: null,
        vars,
        window: settings.window,
        receiptPath,
        ...(settings.agent === undefined ? {} : { agent: settings.agent }),
        ...(settings.timeoutMs === undefined ? {} : { timeoutMs: settings.timeoutMs }),
        ...(settings.dryRun === undefined ? {} : { dryRun: settings.dryRun }),
    });
    if (receipt.dryRun === undefined || planned.length === 0) return receipt;
    // A dry run reports the whole chain it would have run, generate leg first.
    return { ...receipt, dryRun: { ...receipt.dryRun, chained: planned } };
}

/** `kk <noun> publish` — window/consent validation, admission, then one supervised `kk-publish`. */
async function publishAction(noun: string, defaultType: string, options: PublishOptions): Promise<void> {
    const fs = createNodeFileSystem();
    const type = options.type ?? defaultType;
    const { config, configFile } = await loadConfig(fs, 'publish');
    const resolved = await loadType(type, config, configFile, 'publish', options.preset);
    // 0373: the selector follows the resolved type, so `--type news` on the article noun takes
    // `--run-date`/`--work-dir`, not the article `--slug`.
    const selector = runSelector(type, options, 'publish');
    const window = options.window ?? 'after-generate';
    if (!PUBLISH_WINDOWS.includes(window as (typeof PUBLISH_WINDOWS)[number])) {
        fail(2, 'kk.content.publish', `--window must be one of ${PUBLISH_WINDOWS.join('|')}, got '${window}'`);
    }
    if (options.dummy === true && options.liveChannels !== undefined && options.liveChannels.trim() !== '') {
        fail(2, 'kk.content.publish', '--dummy and --live-channels are mutually exclusive');
    }
    const timeoutMs = parseTimeout(options.timeoutMs, 'publish');
    const worksDir = resolveWorksDir(config, configFile);
    // An explicit --run-date wins; then the bundle's own day when --work-dir archives a finished run;
    // otherwise the window's Los Angeles day (overseas reads the episode that landed after the 07:00
    // tick, i.e. yesterday) — the retired publish-window rule.
    let runDate =
        selector.runDate ?? (type === 'news' ? losAngelesDate(window === 'overseas-rss' ? -1 : 0) : undefined);
    if (type === 'news' && selector.runDate === undefined && selector.workDir !== undefined) {
        const archived = await readJson(fs, join(selector.workDir, '4-publish', 'bundle.json'));
        const bundleDay = typeof archived?.runDate === 'string' ? normalizeRunDate(archived.runDate) : undefined;
        if (bundleDay !== undefined) runDate = bundleDay;
    }
    const run = resolveRun({
        type,
        config,
        worksDir,
        workflow: resolved.workflow,
        ...(selector.slug === undefined ? {} : { slug: selector.slug }),
        ...(runDate === undefined ? {} : { runDate }),
        ...(selector.workDir === undefined ? {} : { workDir: selector.workDir }),
    });
    const receipt = await publishRun({
        fs,
        config,
        configFile,
        type,
        noun,
        resolved,
        worksDir,
        run,
        window,
        unattended: options.unattended === true,
        allowGenerate: options.yes === true,
        ...(options.preset === undefined ? {} : { preset: options.preset }),
        ...(channelList(options.channels) === undefined ? {} : { channels: channelList(options.channels) }),
        ...(channelList(options.liveChannels) === undefined ? {} : { liveChannels: channelList(options.liveChannels) }),
        ...(options.liveConfirm === undefined ? {} : { liveConfirm: options.liveConfirm }),
        ...(options.dummy === undefined ? {} : { dummy: options.dummy }),
        ...(options.retry === undefined ? {} : { retry: options.retry }),
        ...(options.agent === undefined ? {} : { agent: options.agent }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    });
    const code = reportReceipt(receipt);
    if (code !== 0) fail(code, 'kk.content.publish', receipt.reason ?? `${PUBLISH_WORKFLOW} exited ${code}`);
}

function configureGenerate(command: Command, noun: string, defaultType: string): void {
    if (noun === 'article') {
        command.option('--type <type>', 'content type', defaultType).option('--slug <slug>', 'article run slug');
    } else {
        command.option('--run-date <YYYYMMDD>', 'news run date');
    }
    command
        .option('--agent <executor>', 'executor the workflow dispatches to (default: inline)')
        .option('--skip-review', 'skip the workflow review pause')
        .option('--auto', 'skip the human gates (article only)')
        .option('--publish', 'launch publish for window after-generate once generation is green')
        .option('--channels <a,b>', 'publish plan rows or plugins to include')
        .option('--live-channels <a,b>', 'promote enabled rows to live; off rows stay disabled')
        .option('--timeout-ms <n>', 'deadline for the workflow child in milliseconds')
        .option('--allow-dirty', 'launch even when harness paths are dirty')
        .option('--dry-run', 'run the preflight and print the planned launch without taking the lock')
        .action((options: GenerateOptions) => generateAction(noun, defaultType, options));
}

function configurePublish(command: Command, noun: string, defaultType: string): void {
    if (noun === 'article') {
        command
            .option('--type <type>', 'content type', defaultType)
            .option('--slug <slug>', 'article run slug')
            .option('--run-date <YYYYMMDD>', 'run date override');
    } else {
        command.option('--run-date <YYYYMMDD>', 'news run date');
    }
    command
        .option('--work-dir <dir>', 'explicit run directory')
        .option('--window <window>', `publish window (${PUBLISH_WINDOWS.join('|')})`, 'after-generate')
        .option('--preset <name>', 'publish preset')
        .option('--channels <a,b>', 'plan rows or plugins to include')
        .option('--live-channels <a,b>', 'promote enabled rows to live; off rows stay disabled')
        .option('--live-confirm', 'pause for live approval before sending')
        .option('--dummy', 'plan and validate every row without dispatching')
        .option('--retry', 'retry the rows a previous window left failed')
        .option('--agent <executor>', 'executor the workflow dispatches to (default: inline)')
        .option('--unattended', 'scheduled posture: generate once when the bundle is missing')
        .option('--yes', 'consent to that one generate without --unattended')
        .option('--timeout-ms <n>', 'deadline for the workflow child in milliseconds')
        .option('--dry-run', 'run the preflight and print the planned launch without taking the lock')
        .action((options: PublishOptions) => publishAction(noun, defaultType, options));
}

/** Register the plain `generate` and `publish` verbs for one content noun (design §1.1). */
export function registerContentLaunchVerbs(group: Command, noun: string, defaultType: string): void {
    configureGenerate(
        group.command('generate').description('launch the generation workflow for a run'),
        noun,
        defaultType,
    );
    configurePublish(
        group.command('publish').description('launch the publish workflow for a bundle'),
        noun,
        defaultType,
    );
}

/** Command-module registration seam used by the CLI surface rule and host integrations. */
export function registerContentLaunchCommand(program: Command, noun = 'article', defaultType = 'itc'): void {
    const group = program.command(noun).description(`${noun} content operations`);
    registerContentLaunchVerbs(group, noun, defaultType);
}
