import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { type Command, CommanderError } from 'commander';
import { resolveContentType } from '../content-types';
import { consoleOutput } from '../output';
import {
    loadPublishPreset,
    type PublishPreset,
    type PublishWindow,
    PublishWindowSchema,
    type Receipt,
    ReceiptSchema,
} from '../publish-core';
import {
    applyChannelModes,
    BundleSchema,
    type ChannelMode,
    checkPublishMatrix,
    PublishOutcomeSchema,
    PublishPlanSchema,
    planPublishMatrix,
    resolveBundlePath,
    runPublishMatrixClassify,
    runPublishMatrixRssGate,
    runPublishMatrixSettle,
    runPublishMatrixValidate,
    runPublishMatrixWaitUntil,
    sendPublishMatrix,
    UnknownChannelModeError,
    validatePublishChannelTokens,
} from '../publish-matrix';
import { runStageCancellable } from '../stage';
import { type ContentConfigDocument, configPath, readConfig, resolveWorksDir } from './content';
import { syncLedger } from './ledger';

interface PublishOptions {
    workDir?: string;
    window?: string;
    preset?: string;
    channels?: string;
    liveChannels?: string;
    dummy?: boolean;
    runDate?: string;
    feed?: string;
    retry?: boolean;
    tier?: string;
    allWindows?: boolean;
    topic?: string;
    db?: string;
}

interface JsonObject {
    [key: string]: unknown;
}

interface LoadedPublishContext {
    config: ContentConfigDocument;
    configFile: string;
    preset: PublishPreset;
    presetDigest: string;
    workDir: string;
    window: PublishWindow;
}

const parseJson = JSON.parse.bind(JSON);

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function listOption(value: string | undefined): string[] {
    return value === undefined
        ? []
        : value
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item !== '');
}

function optionalOption(flag: string, value: string | undefined): string[] {
    return value === undefined ? [] : [flag, value];
}

function expandHome(value: string): string {
    if (value === '~' || value === '$HOME') return homedir();
    if (value.startsWith('~/')) return join(homedir(), value.slice(2));
    if (value.startsWith('$HOME/')) return join(homedir(), value.slice('$HOME/'.length));
    return value;
}

function requireWorkDir(options: PublishOptions, command: string): string {
    if (options.workDir === undefined || options.workDir.trim() === '') {
        throw new CommanderError(2, command, `${command}: --work-dir is required`);
    }
    return resolve(expandHome(options.workDir));
}

function commandFailure(command: string, code: number, message: string): never {
    consoleOutput.error(message);
    throw new CommanderError(code, command, message);
}

/** Does this parsed file carry a `rows` array (the outcome shape this verb asserts on)? */
function isOutcomeRows(value: unknown): boolean {
    return typeof value === 'object' && value !== null && Array.isArray((value as { rows?: unknown }).rows);
}

function quietStdout<T>(action: () => Promise<T>): Promise<T> {
    const restore = setDefaultOutputTargets({ stdout: { write() {} } });
    return action().finally(restore);
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

async function loadContext(
    type: string,
    options: PublishOptions,
    command: string,
    fs: FileSystem,
): Promise<LoadedPublishContext> {
    const configFile = configPath();
    let config: ContentConfigDocument;
    try {
        config = await readConfig(configFile, fs);
    } catch (error: unknown) {
        return commandFailure(command, 2, error instanceof Error ? error.message : String(error));
    }

    let resolvedType: Awaited<ReturnType<typeof resolveContentType>>;
    try {
        resolvedType = await resolveContentType(type, config, {
            configPath: configFile,
            ...(options.preset !== undefined ? { preset: options.preset } : {}),
        });
    } catch (error: unknown) {
        return commandFailure(
            command,
            error instanceof Error ? (error.name === 'ContentTypeSkillMissingError' ? 5 : 2) : 2,
            error instanceof Error ? error.message : String(error),
        );
    }

    const presetSlug = options.preset ?? resolvedType.publish_preset;
    let loaded: Awaited<ReturnType<typeof loadPublishPreset>>;
    try {
        loaded = await loadPublishPreset(presetSlug, { projectRoot: process.cwd() });
    } catch (error: unknown) {
        return commandFailure(command, 1, `${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsedWindow = PublishWindowSchema.safeParse(options.window ?? 'after-generate');
    if (!parsedWindow.success) return commandFailure(command, 2, `${command}: unknown window '${options.window}'`);
    return {
        config,
        configFile,
        preset: loaded.preset,
        presetDigest: loaded.digest,
        workDir: requireWorkDir(options, command),
        window: parsedWindow.data,
    };
}

function configChannels(config: ContentConfigDocument, type: string): Record<string, ChannelMode> {
    const block = isObject(config.content_types) ? config.content_types[type] : undefined;
    const channels = isObject(block) ? block.channels : undefined;
    return isObject(channels) ? (channels as Record<string, ChannelMode>) : {};
}

async function planAction(type: string, options: PublishOptions): Promise<void> {
    const command = 'kk.content.publish-plan';
    const fs = createNodeFileSystem();
    const context = await loadContext(type, options, command, fs);
    const applied = (() => {
        try {
            validatePublishChannelTokens(context.preset, [
                ...listOption(options.channels),
                ...listOption(options.liveChannels),
            ]);
            const configured = configChannels(context.config, type);
            const configuredPreset = applyChannelModes(context.preset, configured, listOption(options.liveChannels));
            if (!options.dummy) return configuredPreset;
            return {
                ...configuredPreset,
                targets: configuredPreset.targets.map((target) =>
                    target.mode === 'off' ? target : { ...target, mode: 'dummy' as const, modeSource: 'flag' as const },
                ),
            };
        } catch (error: unknown) {
            if (error instanceof UnknownChannelModeError) return commandFailure(command, 2, error.message);
            return commandFailure(command, 1, `${command}: ${error instanceof Error ? error.message : String(error)}`);
        }
    })();
    const workDir = context.workDir;
    const bundlePath = await resolveBundlePath(fs, workDir);
    const runDate = options.runDate;
    let wait: JsonObject | undefined;
    let gate: JsonObject | undefined;

    if (context.window === 'cn-peak') {
        const code = await quietStdout(() => runPublishMatrixWaitUntil(['09:00', 'Asia/Shanghai']));
        if (code !== 0) return commandFailure(command, 1, 'publish-plan: wait-until failed');
        wait = { until: new Date().toISOString() };
    }
    if (context.window === 'overseas-rss') {
        const gateArgs = [
            workDir,
            ...(runDate === undefined ? [] : ['--date', runDate]),
            ...(options.feed ? ['--feed', options.feed] : []),
        ];
        const code = await quietStdout(() => runPublishMatrixRssGate(gateArgs));
        const result = await readJson(fs, join(workDir, '4-publish', 'rss-gate.json'));
        gate = { rss: result?.hit === true ? 'hit' : 'miss' };
        if (code !== 0) return commandFailure(command, 1, `publish-plan: RSS gate ${gate.rss}`);
    }

    const validateArgs = [workDir, ...(runDate === undefined ? [] : ['--run-date', runDate])];
    const validateCode = await quietStdout(() => runPublishMatrixValidate(validateArgs));
    if (validateCode !== 0) return commandFailure(command, 1, 'publish-plan: run-date validation failed');

    const planArgs = [
        workDir,
        '--bundle',
        bundlePath,
        '--preset',
        context.preset.name,
        '--window',
        context.window,
        ...optionalOption('--channels', options.channels),
        ...optionalOption('--live-channels', options.liveChannels),
        ...(options.dummy ? ['--dummy'] : []),
    ];
    const code = await quietStdout(() =>
        planPublishMatrix(planArgs, {
            projectRoot: process.cwd(),
            presetOverride: { preset: applied, digest: context.presetDigest },
        }),
    );
    if (code !== 0) return commandFailure(command, 1, 'publish-plan: matrix planning failed');
    const path = join(workDir, '4-publish', `plan.${context.window}.json`);
    const plan = PublishPlanSchema.parse.bind(PublishPlanSchema)(parseJson(await fs.readFile(path)));
    consoleOutput.write(
        JSON.stringify({
            plan: path,
            rows: plan.rows.length,
            live: plan.rows.filter((row) => row.mode === 'live').length,
            excluded: plan.excluded.length,
            ...(wait !== undefined ? { wait } : {}),
            ...(gate !== undefined ? { gate } : {}),
        }),
    );
}

async function checkAction(type: string, options: PublishOptions): Promise<void> {
    const command = 'kk.content.publish-check';
    const fs = createNodeFileSystem();
    const context = await loadContext(type, options, command, fs);
    const args = [
        context.workDir,
        ...(options.allWindows ? ['--all-windows', '--preset', context.preset.name] : ['--window', context.window]),
    ];
    const code = await quietStdout(() => checkPublishMatrix(args));
    if (code !== 0) return commandFailure(command, 1, 'publish-check failed');
    const path = join(
        context.workDir,
        '4-publish',
        options.allWindows ? 'check.preflight.json' : `check.${context.window}.json`,
    );
    const check = (await readJson(fs, path)) ?? { plugins: [] };
    const plugins = Array.isArray(check.plugins) ? check.plugins : [];
    const warnings = plugins
        .filter((plugin): plugin is JsonObject => isObject(plugin) && plugin.ok !== true)
        .map((plugin) => `${String(plugin.plugin ?? 'unknown')}: ${String(plugin.detail ?? 'not ready')}`);
    consoleOutput.write(
        JSON.stringify({
            check: path,
            ready: plugins.filter((plugin) => isObject(plugin) && plugin.ok === true).length,
            warnings,
        }),
    );
}

async function receiptFiles(fs: FileSystem, workDir: string): Promise<Receipt[]> {
    const dir = join(workDir, '4-publish', 'receipts');
    if (!(await fs.exists(dir))) return [];
    const names = (await fs.readDir(dir)).filter((name: string) => name.endsWith('.json'));
    return (
        await Promise.all(
            names.map(async (name: string) => {
                const value = await readJson(fs, join(dir, name));
                return value === null ? undefined : ReceiptSchema.safeParse(value).data;
            }),
        )
    ).filter((value: Receipt | undefined): value is Receipt => value !== undefined);
}

async function sendAction(type: string, options: PublishOptions): Promise<void> {
    const command = 'kk.content.publish-send';
    const fs = createNodeFileSystem();
    const context = await loadContext(type, options, command, fs);
    const args = [
        context.workDir,
        '--window',
        context.window,
        ...(options.retry ? ['--retry'] : []),
        ...(options.tier ? ['--tier', options.tier] : []),
    ];
    const code = await quietStdout(() => sendPublishMatrix(args));
    if (code !== 0) return commandFailure(command, 1, 'publish-send failed');
    const receipts = await receiptFiles(fs, context.workDir);
    consoleOutput.write(
        JSON.stringify({
            sent: receipts.filter((receipt) => receipt.status === 'succeeded').length,
            failed: receipts.filter((receipt) => receipt.status === 'failed').length,
            uncertain: receipts.filter((receipt) => receipt.status === 'uncertain').length,
            receipts: join(context.workDir, '4-publish', 'receipts'),
        }),
    );
}

async function appendBundleRun(fs: FileSystem, workDir: string): Promise<void> {
    const path = await resolveBundlePath(fs, workDir);
    if (!(await fs.exists(path))) throw new Error(`bundle.json not found at ${path}`);
    const parsed = BundleSchema.parse.bind(BundleSchema)(parseJson(await fs.readFile(path)));
    const runId = parsed.runId;
    if (!parsed.runs.includes(runId)) parsed.runs.push(runId);
    await fs.writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function settleAction(type: string, options: PublishOptions): Promise<void> {
    const command = 'kk.content.publish-settle';
    const fs = createNodeFileSystem();
    const context = await loadContext(type, options, command, fs);
    const classifyCode = await quietStdout(() =>
        runPublishMatrixClassify([context.workDir, '--window', context.window]),
    );
    if (classifyCode !== 0) return commandFailure(command, 1, 'publish-settle: classification failed');

    if (context.window === 'after-generate') {
        await quietStdout(() =>
            runStageCancellable(['publish-matrix-patch-surfdash', context.workDir, '--window', context.window]),
        );
    }
    const statusPath = join(context.workDir, '4-publish', `publish-status.${context.window}.txt`);
    if ((await fs.exists(statusPath)) && /^(full|partial|none)$/.test((await fs.readFile(statusPath)).trim())) {
        await quietStdout(() =>
            runStageCancellable(['publish-matrix-partial', context.workDir, '--window', context.window]),
        );
    }
    let settleCode = 0;
    if (context.window !== 'overseas-rss') {
        const settleArgs = [
            context.workDir,
            '--window',
            context.window,
            ...(options.topic ? ['--topic', options.topic] : []),
            ...(options.db ? ['--db', options.db] : []),
        ];
        settleCode = await quietStdout(() => runPublishMatrixSettle(settleArgs));
    }

    try {
        await appendBundleRun(fs, context.workDir);
    } catch (error: unknown) {
        return commandFailure(command, 1, `publish-settle: ${error instanceof Error ? error.message : String(error)}`);
    }
    const outcomePath = join(context.workDir, '4-publish', `outcome.${context.window}.json`);
    const outcome = PublishOutcomeSchema.parse.bind(PublishOutcomeSchema)(parseJson(await fs.readFile(outcomePath)));
    const failedRequired = outcome.rows.some((row) => row.required && !row.dummy && row.status !== 'succeeded');
    consoleOutput.write(JSON.stringify(outcome));
    if (settleCode !== 0 || failedRequired)
        throw new CommanderError(1, command, 'publish-settle: required targets failed');
}

async function renderReport(fs: FileSystem, workDir: string, window: PublishWindow): Promise<string> {
    const statusPath = join(workDir, '4-publish', `publish-status.${window}.txt`);
    const status = (await fs.exists(statusPath)) ? (await fs.readFile(statusPath)).trim() : 'unknown';
    const outcome = await readJson(fs, join(workDir, '4-publish', `outcome.${window}.json`));
    const runDate = typeof outcome?.runDate === 'string' ? outcome.runDate : '';
    const rows = Array.isArray(outcome?.rows) ? outcome.rows : [];
    const excluded = Array.isArray(outcome?.excluded) ? outcome.excluded : [];
    const lines = [
        `# Publish report — ${window} — ${runDate}`,
        '',
        `- status: ${status}`,
        '',
        '| target | tier | status | effect | dummy |',
        '| --- | --- | --- | --- | --- |',
        ...rows
            .filter(isObject)
            .map(
                (row) =>
                    `| ${String(row.id ?? '')} | ${String(row.tier ?? '')} | ${String(row.status ?? '')} | ${String(row.effect ?? '-')} | ${String(row.dummy ?? false)} |`,
            ),
        ...excluded
            .filter(isObject)
            .map(
                (row) =>
                    `- excluded: ${String(row.id ?? '')} (${String(row.plugin ?? '')}) — ${String(row.reason ?? '')}`,
            ),
        '',
    ];
    return lines.join('\n');
}

async function reportAction(type: string, options: PublishOptions): Promise<void> {
    const command = 'kk.content.publish-report';
    const fs = createNodeFileSystem();
    const context = await loadContext(type, options, command, fs);
    const reportPath = join(context.workDir, '5-report', `publish-${context.window}.md`);
    await fs.ensureDir(dirname(reportPath));
    await fs.writeFile(reportPath, await renderReport(fs, context.workDir, context.window));
    try {
        await quietStdout(() =>
            syncLedger({
                workflow: 'kk-publish',
                worksDir: resolveWorksDir(context.config, context.configFile),
                workDir: context.workDir,
            }),
        );
    } catch (error: unknown) {
        consoleOutput.error(
            `publish-report: ledger sync warning: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    consoleOutput.write(JSON.stringify({ report: reportPath }));
    // The run's honest exit (ported from publish3's `outcome-assert`, which sat AFTER report and
    // ledger): the page and the ledger row are already written when this node fails, so a partial
    // window keeps its report and still fails the run. A gated-miss day has no outcome file and
    // stays done — the diagnose/repair path already classified it.
    const outcomePath = join(context.workDir, '4-publish', `outcome.${context.window}.json`);
    if (await fs.exists(outcomePath)) {
        let rows: Array<{ required?: unknown; dummy?: unknown; status?: unknown }>;
        try {
            const parsed: unknown = parseJson(await fs.readFile(outcomePath));
            rows = isOutcomeRows(parsed) ? (parsed as { rows: typeof rows }).rows : [];
        } catch {
            // A corrupt outcome cannot certify the window. The page above is already written, so the
            // failure is reported, not hidden — publish3's `jq` assert failed the same way.
            return commandFailure(command, 1, `publish-report: ${outcomePath} is unreadable or malformed`);
        }
        const failed = rows.some((row) => row.required === true && row.dummy !== true && row.status !== 'succeeded');
        if (failed) {
            return commandFailure(
                command,
                1,
                `publish-report: required targets failed — see outcome.${context.window}.json and the page`,
            );
        }
    }
}

function rejectPositionals(command: string, positionals: string[]): void {
    if (positionals.length > 0)
        commandFailure(command, 2, `${command}: positional arguments are not accepted; use --work-dir`);
}

function publishCommand(
    parent: Command,
    name: string,
    description: string,
    configure: (command: Command) => void,
    action: (type: string, options: PublishOptions) => Promise<void>,
    type: string,
): void {
    const command = `kk.content.${name}`;
    const child = parent.command(name).description(description).argument('[positionals...]');
    configure(child);
    child.action(async (positionals: string[], options: PublishOptions) => {
        rejectPositionals(command, positionals);
        await action(type, options);
    });
}

/** Register the five shared publish-step verbs for one content noun. */
export function registerContentPublishVerbs(parent: Command, type: string): void {
    const base = (command: Command): Command =>
        command
            .option('--work-dir <dir>', 'content run directory')
            .option('--window <window>', 'publish window', 'after-generate');
    publishCommand(
        parent,
        'publish-plan',
        'freeze a publish window plan',
        (command) => {
            base(command)
                .option('--preset <name>', 'publish preset')
                .option('--channels <a,b>', 'narrow channels')
                .option('--live-channels <a,b>', 'promote channels to live')
                .option('--dummy', 'rehearse without dispatch')
                .option('--run-date <date>', 'bundle run date')
                .option('--feed <url>', 'RSS feed URL');
        },
        planAction,
        type,
    );
    publishCommand(
        parent,
        'publish-check',
        'probe planned publish targets',
        (command) => {
            base(command)
                .option('--preset <name>', 'publish preset')
                .option('--all-windows', 'probe every preset window');
        },
        checkAction,
        type,
    );
    publishCommand(
        parent,
        'publish-send',
        'dispatch a frozen publish plan',
        (command) => {
            base(command).option('--retry', 'retry effect-none failures').option('--tier <n>', 'send one tier');
        },
        sendAction,
        type,
    );
    publishCommand(
        parent,
        'publish-settle',
        'classify and settle a publish window',
        (command) => {
            base(command).option('--topic <topic>', 'store topic').option('--db <path>', 'store database path');
        },
        settleAction,
        type,
    );
    publishCommand(parent, 'publish-report', 'write a publish report and sync the ledger', base, reportAction, type);
}

/** Command-module registration seam used by the CLI surface rule and host integrations. */
export function registerContentPublishCommand(parent: Command, type: string): void {
    registerContentPublishVerbs(parent, type);
}
