import { join } from 'node:path';
import { discoverAllPlugins } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { bindAdapterSession, selectBotAdapter } from '../bot-adapter';
import { decodeBotPlan } from '../bot-plan';
import { readFileBytes, writeBytes, writeFileBytes } from '../byte-output';
import { consoleOutput } from '../output';

/**
 * `kk bot list|login|logout|open` — named local browser sessions (task 0276, A22 R1/R3-R5).
 *
 * Arguments, exit mapping and output live here; the lifecycle itself lives in
 * `@gobing-ai/publish-harness/browser`. That module is imported lazily inside the actions, so
 * `kk bot --help` and `kk bot list` never need the browser half of the harness (or a browser
 * binary) to be installed. The fixed default profile root always wins: no ambient
 * `KK_BROWSER_PROFILE_DIR`/channel env can redirect what these verbs list, open or delete.
 */

// The collection runner and the 0382 record/codegen/replay trio are sibling sub-paths, not
// `browser` re-exports (0346: one-way import).
type BotHarness = typeof import('@gobing-ai/publish-harness/browser') &
    typeof import('@gobing-ai/publish-harness/bot-collection') &
    typeof import('@gobing-ai/publish-harness/bot-record') &
    typeof import('@gobing-ai/publish-harness/bot-codegen') &
    typeof import('@gobing-ai/publish-harness/bot-replay');
type BotCollectionPlan = import('@gobing-ai/publish-harness/bot-collection').BotCollectionPlan;

/**
 * Injectable seams for the registrar. `load` is the deterministic-test seam the design freezes
 * (dependencies are injected; there is no product test-root flag) — production always uses the
 * lazy loader below.
 */
export interface BotCommandDeps {
    /** Harness loader override. */
    load?: () => Promise<BotHarness>;
}

let botHarness: Promise<BotHarness> | undefined;

/** Lazily import the browser-dependent half of the harness (help/list stay browser-free). */
function loadBotHarness(): Promise<BotHarness> {
    botHarness ??= Promise.all([
        import('@gobing-ai/publish-harness/browser'),
        import('@gobing-ai/publish-harness/bot-collection'),
        import('@gobing-ai/publish-harness/bot-record'),
        import('@gobing-ai/publish-harness/bot-codegen'),
        import('@gobing-ai/publish-harness/bot-replay'),
    ]).then(([browser, collection, record, codegen, replay]) => ({
        ...browser,
        ...collection,
        ...record,
        ...codegen,
        ...replay,
    }));
    return botHarness;
}

/**
 * Run one bot operation through the harness, mapping a failure onto the frozen exit contract
 * (design §Chosen shape): `BotError.code === 'usage'` → 2, every other failure → 1. Command
 * modules never terminate the process themselves; the thrown CommanderError carries the code to
 * `main()`.
 */
async function runBotAction(
    load: () => Promise<BotHarness>,
    action: (harness: BotHarness) => Promise<void>,
): Promise<void> {
    const harness = await load();
    try {
        await action(harness);
    } catch (error) {
        failBot(harness, error);
    }
}

/** Print `kk.bot.failed: <detail>` on stderr and throw the exit code to `main()`. */
function failBot(harness: BotHarness, error: unknown): never {
    const detail = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof harness.BotError && error.code === 'usage' ? 2 : 1;
    consoleOutput.error(`kk.bot.failed: ${detail}`);
    throw new CommanderError(exitCode, 'kk.bot.failed', detail);
}

/**
 * `kk bot list` — one tab-separated
 * `name / cached / saved-default-url / identity / last-login / expires` row per cached local
 * profile (the three fact columns appended in 0305, so positional parsers of the first three keep
 * working). Facts were captured at the last saved login; a missing value prints `unknown`. An
 * absent root is an empty successful inventory: no row and exit 0. Nothing here launches a browser,
 * inspects a cookie database or claims that a cached profile proves a current login.
 */
async function botListAction(load: () => Promise<BotHarness>): Promise<void> {
    await runBotAction(load, async ({ listBots }) => {
        for (const entry of await listBots()) {
            consoleOutput.write(
                [
                    entry.name,
                    entry.state,
                    entry.defaultUrl ?? 'unknown',
                    entry.identity ?? 'unknown',
                    entry.lastLoginAt ?? 'unknown',
                    entry.expiresAt ?? 'unknown',
                ].join('\t'),
            );
        }
    });
}

/**
 * `kk bot login <url> --save <name>` — open the login URL headed and save it as `name` once the
 * operator confirms at the terminal. Prints only the bot name and outcome: the supplied URL can
 * carry a grant, so it never reaches stdout/stderr.
 */
async function botLoginAction(load: () => Promise<BotHarness>, url: string, options: { save: string }): Promise<void> {
    await runBotAction(load, async (harness) => {
        // 0277 R2: bind a known adapter when the bot/URL matches a declared descriptor; an
        // ambiguous or unavailable saved adapter is refused instead of silently going generic.
        const selection = selectBotAdapter(discoverAllPlugins().plugins, { botName: options.save, url });
        if (selection.error !== undefined) {
            throw new harness.BotError('persistence', selection.error);
        }
        const result = await harness.loginBot(options.save, url, {
            ...(selection.adapter !== null ? { adapter: bindAdapterSession(selection.adapter) } : {}),
        });
        consoleOutput.write(`${result.name}\tsaved`);
    });
}

/** `kk bot logout <name>` — remove that bot's local profile; an absent bot is an idempotent success. */
async function botLogoutAction(load: () => Promise<BotHarness>, name: string): Promise<void> {
    await runBotAction(load, async ({ logoutBot }) => {
        const result = await logoutBot(name);
        consoleOutput.write(`${result.name}\t${result.removed ? 'removed' : 'absent'}`);
    });
}

/** `kk bot open <name> [--login]` — reopen the saved page headed and stay until the context closes. */
async function botOpenAction(
    load: () => Promise<BotHarness>,
    name: string,
    options: { login?: boolean },
): Promise<void> {
    await runBotAction(load, async (harness) => {
        // 0277 R2: bind the adapter from the saved pluginName, the bot name's declared profileName,
        // or (with a saved default URL) a unique descriptor homeUrl origin. A metadata-free fixed
        // profile opens through its adapter's declared homeUrl; a publication-scoped adapter
        // (Substack) gets login guidance from the harness instead.
        const saved = await harness.readBotSavedMetadata(name);
        const selection = selectBotAdapter(discoverAllPlugins().plugins, {
            botName: name,
            url: saved?.defaultUrl,
            ...(saved?.pluginName !== undefined ? { savedPluginName: saved.pluginName } : {}),
        });
        if (selection.error !== undefined) {
            throw new harness.BotError('persistence', selection.error);
        }
        const descriptorHomeUrl = selection.adapter?.record.browserSession?.homeUrl;
        const result = await harness.openBot(name, {
            login: options.login === true,
            ...(selection.adapter !== null ? { adapter: bindAdapterSession(selection.adapter) } : {}),
            ...(saved === null && descriptorHomeUrl !== undefined ? { defaultUrl: descriptorHomeUrl } : {}),
        });
        consoleOutput.write(`${result.name}\tclosed`);
    });
}

/**
 * `kk bot record <name>` — open the bot's saved page headed under one lease and write an ordered
 * transcript of what the operator does (0382 R1). Typed text is a length marker unless
 * `--include-text`; the file is 0600 and its path prints on stdout.
 */
async function botRecordAction(
    load: () => Promise<BotHarness>,
    name: string,
    options: { out?: string; includeText?: boolean },
): Promise<void> {
    await runBotAction(load, async (harness) => {
        const result = await harness.recordBotSession(name, {
            ...(options.out === undefined ? {} : { out: options.out }),
            ...(options.includeText === true ? { includeText: true } : {}),
        });
        consoleOutput.write(`${result.out}\t${result.stepCount} steps\t${result.redacted ? 'redacted' : 'verbatim'}`);
    });
}

/**
 * `kk bot codegen <transcript>` — emit a rail skeleton to stdout, or beside the plugin with
 * `--apply` (0382 R3/R4). Warnings go to stderr; an unusable step exits 1 and nothing is written.
 */
async function botCodegenAction(
    load: () => Promise<BotHarness>,
    transcriptPath: string,
    options: { plugin: string; operation: string; apply?: boolean; receiptPath?: string; allowUnredacted?: boolean },
): Promise<void> {
    await runBotAction(load, async (harness) => {
        const transcript = await harness.readTranscript(transcriptPath, {
            ...(options.allowUnredacted === true ? { allowUnredacted: true } : {}),
        });
        const { source, warnings } = harness.generateRail(transcript, {
            plugin: options.plugin,
            operation: options.operation,
            transcriptPath,
            ...(options.receiptPath === undefined ? {} : { receiptPath: options.receiptPath }),
        });
        for (const warning of warnings) consoleOutput.error(`kk.bot.codegen: ${warning}`);
        if (options.apply !== true) {
            consoleOutput.write(source);
            return;
        }
        const target = join('plugins', 'publishings', options.plugin, 'src', `${options.operation}-rail.generated.ts`);
        if (await createNodeFileSystem().exists(target)) {
            throw new harness.BotError(
                'usage',
                `${target} already exists — promoting a generated rail is a by-hand edit`,
            );
        }
        writeFileBytes(target, new TextEncoder().encode(source));
        consoleOutput.write(`${target}\twritten`);
    });
}

/**
 * `kk bot replay <name> <transcript>` — re-run the recorded steps headed and stop before the submit
 * click unless `--submit` (0382 R5). One screenshot plus a `replay.json` row per step lands in
 * `--output`; any step that does not resolve exactly one visible node exits 1.
 */
async function botReplayAction(
    load: () => Promise<BotHarness>,
    name: string,
    transcriptPath: string,
    options: { submit?: boolean; submitText?: string; output?: string; file?: string; allowUnredacted?: boolean },
): Promise<void> {
    await runBotAction(load, async (harness) => {
        const transcript = await harness.readTranscript(transcriptPath, {
            ...(options.allowUnredacted === true ? { allowUnredacted: true } : {}),
        });
        const { result, replayPath } = await harness.replayBot(name, transcript, {
            ...(options.submit === true ? { submit: true } : {}),
            ...(options.submitText === undefined ? {} : { submitText: options.submitText }),
            ...(options.output === undefined ? {} : { outDir: options.output }),
            ...(options.file === undefined ? {} : { filePath: options.file }),
        });
        consoleOutput.write(JSON.stringify({ ...result, replayPath }, null, 2));
        const failed = result.rows.find((row) => !row.ok && row.skipped !== 'submit');
        if (failed !== undefined) {
            throw new harness.BotError(
                'browser',
                `replay stopped at step ${failed.step}: ${failed.detail ?? 'unresolved'}`,
            );
        }
    });
}

/** Commander reducer for the repeatable `-H, --header` option. */
function collectHeader(value: string, previous: string[] | undefined): string[] {
    return [...(previous ?? []), value];
}

/** `kk bot exec` options as Commander hands them over (repeatable `-H`, raw `-d`). */
interface BotExecCliOptions {
    request?: string;
    header?: string[];
    data?: string;
    output?: string;
    include?: boolean;
    location?: boolean;
    fail?: boolean;
    maxTime?: string;
}

/**
 * `kk bot exec <name> <url>` — one authenticated request with the bot's cached cookie session
 * (0306, design §kk bot exec). Option parsing, printing and the exit mapping live here; the
 * request itself and the lease/browser lifetime live in the harness. Any unsupported option is a
 * Commander usage error, and every rejected value is a `usage` BotError (exit 2).
 */
async function botExecAction(
    load: () => Promise<BotHarness>,
    name: string,
    url: string,
    options: BotExecCliOptions,
): Promise<void> {
    await runBotAction(load, async (harness) => {
        const request = buildExecRequest(harness, url, options);
        const response = await harness.execBot(name, request);
        // `-i` prints `HTTP <status> <statusText>`: Playwright exposes no protocol version. Like
        // curl, the block goes wherever the body goes — stdout, or the `-o` file.
        const head = Buffer.from(
            options.include === true ? execHeaderBlock(response.status, response.statusText, response.headers) : '',
        );
        const failed = options.fail === true && response.status >= 400;
        const bytes = failed ? head : Buffer.concat([head, response.body]);
        // Bytes never go through the line-oriented output seam: it would append a newline and
        // mangle a binary body. A `-f` rejection without `-i` writes nothing (no empty `-o` file).
        if (!failed || head.length > 0) {
            if (options.output !== undefined) writeFileBytes(options.output, bytes);
            else await writeBytes(bytes);
        }
        if (failed) throw new harness.BotError('browser', `HTTP ${response.status}`);
    });
}

/** Turn the parsed options into the frozen harness request, rejecting every malformed value. */
function buildExecRequest(harness: BotHarness, url: string, options: BotExecCliOptions) {
    const headers: Record<string, string> = {};
    for (const line of options.header ?? []) {
        const colon = line.indexOf(':');
        // The value is never echoed: a malformed `Authorization` header is still a credential.
        if (colon <= 0 || line.slice(0, colon).trim() === '') {
            throw new harness.BotError('usage', 'header must be "Name: value"');
        }
        const header = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        // The request shape holds one value per name, so a repeated name is joined rather than
        // dropped: ", " per RFC 9110 §5.3, "; " for Cookie per RFC 6265 §5.4.
        const existing = Object.keys(headers).find((key) => key.toLowerCase() === header.toLowerCase());
        if (existing === undefined) headers[header] = value;
        else headers[existing] = `${headers[existing]}${existing.toLowerCase() === 'cookie' ? '; ' : ', '}${value}`;
    }
    const data = options.data === undefined ? undefined : readExecData(harness, options.data);
    const timeoutMs = options.maxTime === undefined ? undefined : parseExecMaxTime(harness, options.maxTime);
    return {
        url,
        method: options.request ?? (data === undefined ? 'GET' : 'POST'),
        headers,
        ...(data === undefined ? {} : { data }),
        followRedirects: options.location === true,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
    };
}

/** `-d` literal, or `@file` read raw (no newline stripping). An unreadable file is exit 1. */
function readExecData(harness: BotHarness, value: string): Buffer {
    if (!value.startsWith('@')) return Buffer.from(value);
    if (value === '@-') throw new harness.BotError('usage', 'reading the body from stdin (-d @-) is not supported');
    const path = value.slice(1);
    try {
        return readFileBytes(path);
    } catch {
        throw new harness.BotError('persistence', `could not read the --data file '${path}'`);
    }
}

/** `-m` seconds → milliseconds; zero, negative and non-numeric values are usage errors. */
function parseExecMaxTime(harness: BotHarness, value: string): number {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new harness.BotError('usage', '--max-time must be a positive number of seconds');
    }
    return Math.round(seconds * 1000);
}

/** `-i` header block: status line, one `Name: value` per header, then the blank separator. */
function execHeaderBlock(status: number, statusText: string, headers: Array<{ name: string; value: string }>): string {
    const lines = [`HTTP ${status}${statusText === '' ? '' : ` ${statusText}`}`];
    for (const header of headers) {
        // A `Set-Cookie` value is a live credential; `-i` prints the header, never its value.
        lines.push(`${header.name}: ${header.name.toLowerCase() === 'set-cookie' ? '<redacted>' : header.value}`);
    }
    return `${lines.join('\n')}\n\n`;
}

/** `kk bot plan` options as Commander hands them over. */
interface BotPlanCliOptions {
    output?: string;
    maxTime?: string;
}

/** `-m` seconds → milliseconds (valid 1..600s); zero, negative, non-numeric and >600 are usage errors. */
function parsePlanMaxTime(harness: BotHarness, value: string): number {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) {
        throw new harness.BotError('usage', '--max-time must be a positive number of seconds (up to 600)');
    }
    return Math.round(seconds * 1000);
}

/** Read and decode the plan JSON file. Unreadable paths and non-object JSON throw a usage BotError. */
async function readPlanFile(harness: BotHarness, planPath: string): Promise<BotCollectionPlan> {
    let raw: string;
    try {
        raw = await createNodeFileSystem().readFile(planPath);
    } catch {
        throw new harness.BotError('usage', `could not read plan file '${planPath}'`);
    }
    const decoded = decodeBotPlan(raw);
    if (!decoded.ok) {
        throw new harness.BotError(
            'usage',
            decoded.reason === 'not-object' ? 'plan must be a JSON object' : 'plan file is not valid JSON',
        );
    }
    // Shape validation is the runner's (normalizePlan) — it rejects before any profile or lease work.
    return decoded.plan as unknown as BotCollectionPlan;
}

/**
 * `kk bot plan <name> <plan>` — execute a declarative collection plan under the shared profile lease.
 * Outputs JSON result to stdout, or writes artifact bodies to `--output <dir>` with a result.json summary.
 */
async function botPlanAction(
    load: () => Promise<BotHarness>,
    name: string,
    planPath: string,
    options: BotPlanCliOptions,
): Promise<void> {
    await runBotAction(load, async (harness) => {
        const plan = await readPlanFile(harness, planPath);
        const timeoutMs = options.maxTime === undefined ? undefined : parsePlanMaxTime(harness, options.maxTime);
        const result = await harness.runBotCollection(name, plan, {
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
        });

        if (options.output !== undefined) {
            const fs = createNodeFileSystem();
            // Lock the directory before any body lands in it; each file is then narrowed to 0600.
            await fs.ensureDir(options.output);
            harness.chmod(options.output, 0o700);
            const sanitizedArtifacts: Array<Record<string, unknown>> = [];
            for (const [index, artifact] of result.artifacts.entries()) {
                const safeName = `${String(index).padStart(2, '0')}-${artifact.id.replace(/[^A-Za-z0-9_-]/g, '-')}.txt`;
                const filePath = join(options.output, safeName);
                await fs.writeFile(filePath, artifact.body);
                harness.chmod(filePath, 0o600);
                sanitizedArtifacts.push({
                    id: artifact.id,
                    kind: artifact.kind,
                    file: safeName,
                    ...(artifact.status !== undefined ? { status: artifact.status } : {}),
                    ...(artifact.url !== undefined ? { url: artifact.url } : {}),
                    ...(artifact.stepIndex !== undefined ? { stepIndex: artifact.stepIndex } : {}),
                });
            }
            const summary = {
                ok: true,
                steps: result.steps,
                artifacts: sanitizedArtifacts,
            };
            const resultPath = join(options.output, 'result.json');
            await fs.writeFile(resultPath, JSON.stringify(summary, null, 2));
            harness.chmod(resultPath, 0o600);
            consoleOutput.write(JSON.stringify(summary, null, 2));
        } else {
            consoleOutput.write(JSON.stringify({ ok: true, ...result }, null, 2));
        }
    });
}

/**
 * Register the `bot` group under the current CLI factory. The group carries no action of its own:
 * `kk bot` alone prints Commander usage, exactly like every other noun. No flag beyond the
 * declared surface (`--save` on login, `--login` on open) is added.
 */
export function registerBotCommand(program: Command, deps: BotCommandDeps = {}): void {
    const load = deps.load ?? loadBotHarness;
    const bot = program
        .command('bot')
        .description('Named local browser sessions (list, login, logout, open, exec, plan)');

    bot.command('list')
        .description('List cached local bot profiles: name, cached, default URL, identity, last login, expires')
        .action(() => botListAction(load));

    bot.command('login')
        .description('Open a site headed and save it as a named bot session after terminal confirmation')
        .argument('<url>', 'Login URL to open (http/https; its query is never saved)')
        .requiredOption('--save <name>', 'Bot name matching [A-Za-z0-9][A-Za-z0-9_-]{0,63}')
        .action((url: string, options: { save: string }) => botLoginAction(load, url, options));

    bot.command('logout')
        .description("Remove a named bot's local profile and credentials (no server-side revocation)")
        .argument('<name>', 'Bot name')
        .action((name: string) => botLogoutAction(load, name));

    bot.command('open')
        .description("Open a named bot's saved page headed until the browser closes")
        .argument('<name>', 'Bot name')
        .option('--login', 'Reauthenticate first, then reopen the saved page for interaction')
        .action((name: string, options: { login?: boolean }) => botOpenAction(load, name, options));

    const exec = bot
        .command('exec')
        .description("Send one request with a named bot's cached cookie session (curl option subset)")
        .argument('<name>', 'Bot name')
        .argument('<url>', 'Request URL (http/https, no credentials; sent as given, query kept)')
        .option('-X, --request <method>', 'HTTP method (default GET, or POST when -d is given)')
        .option('-H, --header <header>', 'Request header "Name: value" (repeatable)', collectHeader)
        .option('-d, --data <data>', 'Request body: a literal, or @file read raw')
        .option('-o, --output <file>', 'Write the response body to a file instead of stdout')
        .option('-i, --include', 'Include the status line and response headers before the body (stdout or the -o file)')
        .option('-L, --location', 'Follow redirects (default: return the 3xx response as-is)')
        .option('-f, --fail', 'Exit 1 without the body when the status is 400 or above')
        .option('-m, --max-time <seconds>', 'Whole-request timeout in seconds (default: Playwright 30s)')
        .action((name: string, url: string, options: BotExecCliOptions) => botExecAction(load, name, url, options));

    const plan = bot
        .command('plan')
        .description('Execute a declarative collection plan with a named bot session')
        .argument('<name>', 'Bot name')
        .argument('<plan>', 'Path to plan JSON file')
        .option('-o, --output <dir>', 'Directory to write captured artifact bodies (0600 mode)')
        .option('-m, --max-time <seconds>', 'Whole-run timeout in seconds (default: 120s, max: 600s)')
        .action((name: string, planPath: string, options: BotPlanCliOptions) =>
            botPlanAction(load, name, planPath, options),
        );

    const record = bot
        .command('record')
        .description('Record an operator session with a named bot into a transcript')
        .argument('<name>', 'Bot name')
        .option('-o, --out <file>', 'Transcript path (default .spur/run/bot-record-<bot>-<stamp>.json)')
        .option('--include-text', 'Keep typed text verbatim instead of a length marker')
        .action((name: string, options: { out?: string; includeText?: boolean }) =>
            botRecordAction(load, name, options),
        );

    const codegen = bot
        .command('codegen')
        .description('Emit a rail skeleton from a recorded transcript')
        .argument('<transcript>', 'Transcript JSON path')
        .requiredOption('--plugin <name>', 'Target publish plugin name under plugins/publishings/')
        .requiredOption('--operation <op>', 'Rail operation slug (the runner is run<Operation>)')
        .option('--apply', 'Write <operation>-rail.generated.ts beside the plugin instead of stdout')
        .option('--receipt-path <path>', 'Dot path of the publish id inside the receipt body')
        .option('--allow-unredacted', 'Accept a transcript recorded with --include-text')
        .action(
            (
                transcriptPath: string,
                options: {
                    plugin: string;
                    operation: string;
                    apply?: boolean;
                    receiptPath?: string;
                    allowUnredacted?: boolean;
                },
            ) => botCodegenAction(load, transcriptPath, options),
        );

    const replay = bot
        .command('replay')
        .description('Replay a transcript headed, stopping before the submit step by default')
        .argument('<name>', 'Bot name')
        .argument('<transcript>', 'Transcript JSON path')
        .option('--submit', 'Execute the submit step instead of stopping before it')
        .option('--submit-text <text>', 'Text of the click that submits (default: the last click)')
        .option('-o, --output <dir>', 'Evidence directory (default .spur/run/bot-replay-<bot>)')
        .option('--file <path>', 'Local file a recorded file step re-selects')
        .option('--allow-unredacted', 'Accept a transcript recorded with --include-text')
        .action(
            (
                name: string,
                transcriptPath: string,
                options: {
                    submit?: boolean;
                    submitText?: string;
                    output?: string;
                    file?: string;
                    allowUnredacted?: boolean;
                },
            ) => botReplayAction(load, name, transcriptPath, options),
        );

    // Commander reports every parse error (unknown option, missing/excess argument) as exit 1.
    // This leaf's contract makes them usage errors (exit 2), so the callback is installed from a
    // pre-subcommand hook: `main()` re-inherits the exit callback over its children after
    // registration, which would drop one set here. Help/version (exit 0) pass straight through.
    bot.hook('preSubcommand', (_parent, subcommand) => {
        if (
            subcommand === exec ||
            subcommand === plan ||
            subcommand === record ||
            subcommand === codegen ||
            subcommand === replay
        ) {
            subcommand.exitOverride((error) => {
                throw error.exitCode === 1 ? new CommanderError(2, error.code, error.message) : error;
            });
        }
    });
}
