import { discoverAllPlugins } from '@gobing-ai/kk-core';
import { type Command, CommanderError } from 'commander';
import { bindAdapterSession, selectBotAdapter } from '../bot-adapter';
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

/**
 * Register the `bot` group under the current CLI factory. The group carries no action of its own:
 * `kk bot` alone prints Commander usage, exactly like every other noun. No flag beyond the
 * declared surface (`--save` on login, `--login` on open) is added.
 */
export function registerBotCommand(program: Command, deps: BotCommandDeps = {}): void {
    const load = deps.load ?? loadBotHarness;
    const bot = program.command('bot').description('Named local browser sessions (list, login, logout, open)');

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
}
