import { discoverAllPlugins } from '@gobing-ai/kk-core';
import { type Command, CommanderError } from 'commander';
import { bindAdapterSession, selectBotAdapter } from '../bot-adapter';
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

type BotHarness = typeof import('@gobing-ai/publish-harness/browser');

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
    botHarness ??= import('@gobing-ai/publish-harness/browser');
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
        // `-i` prints `HTTP <status> <statusText>`: Playwright exposes no protocol version.
        if (options.include === true) {
            await writeBytes(execHeaderBlock(response.status, response.statusText, response.headers));
        }
        if (options.fail === true && response.status >= 400) {
            throw new harness.BotError('browser', `HTTP ${response.status}`);
        }
        // Bytes never go through the line-oriented output seam: it would append a newline and
        // mangle a binary body (`-o` writes the same bytes to the file instead).
        if (options.output !== undefined) writeFileBytes(options.output, response.body);
        else await writeBytes(response.body);
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
        headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
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

/**
 * Register the `bot` group under the current CLI factory. The group carries no action of its own:
 * `kk bot` alone prints Commander usage, exactly like every other noun. No flag beyond the
 * declared surface (`--save` on login, `--login` on open) is added.
 */
export function registerBotCommand(program: Command, deps: BotCommandDeps = {}): void {
    const load = deps.load ?? loadBotHarness;
    const bot = program.command('bot').description('Named local browser sessions (list, login, logout, open, exec)');

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
        .option('-i, --include', 'Print the status line and response headers before the body')
        .option('-L, --location', 'Follow redirects (default: return the 3xx response as-is)')
        .option('-f, --fail', 'Exit 1 without the body when the status is 400 or above')
        .option('-m, --max-time <seconds>', 'Whole-request timeout in seconds (default: Playwright 30s)')
        .action((name: string, url: string, options: BotExecCliOptions) => botExecAction(load, name, url, options));
    // Commander reports every parse error (unknown option, missing/excess argument) as exit 1.
    // This leaf's contract makes them usage errors (exit 2), so the callback is installed from a
    // pre-subcommand hook: `main()` re-inherits the exit callback over its children after
    // registration, which would drop one set here. Help/version (exit 0) pass straight through.
    bot.hook('preSubcommand', (_parent, subcommand) => {
        if (subcommand === exec) {
            subcommand.exitOverride((error) => {
                throw error.exitCode === 1 ? new CommanderError(2, error.code, error.message) : error;
            });
        }
    });
}
