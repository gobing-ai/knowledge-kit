import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { createProgram } from '../../src/cli';
import { type BotCommandDeps, registerBotCommand } from '../../src/commands/bot';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

/**
 * `kk bot list|login|logout|open` (task 0276, A22 R1/R3-R5): registration and argv shape, the
 * frozen exit-code mapping and output contract, and the browser-free/lazy behaviour. The success
 * paths run against an injected harness seam so no real profile root and no browser is touched;
 * the end-to-end invocations redirect `HOME` to a throwaway root in a child process.
 */

type BotHarness = Awaited<ReturnType<NonNullable<BotCommandDeps['load']>>>;

/** `BotError` shape the CLI maps to exit codes (usage → 2, everything else → 1). */
class FakeBotError extends Error {
    public readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'BotError';
        this.code = code;
    }
}

interface Fakes {
    list?: () => Promise<unknown[]>;
    login?: (name: string, url: string) => Promise<unknown>;
    logout?: (name: string) => Promise<unknown>;
    open?: (name: string, options: { login?: boolean }) => Promise<unknown>;
    calls: string[];
}

/** Fake harness half: records calls and lets a test make one operation fail. */
function fakeHarness(fakes: Fakes): BotHarness {
    const record = async <T>(label: string, value: T): Promise<T> => {
        fakes.calls.push(label);
        return value;
    };
    return {
        BotError: FakeBotError,
        listBots: () => record('list', fakes.list?.() ?? Promise.resolve([])),
        loginBot: (name: string, url: string) =>
            record(`login:${name}:${url}`, fakes.login?.(name, url) ?? Promise.resolve({ name, defaultUrl: url })),
        logoutBot: (name: string) =>
            record(`logout:${name}`, fakes.logout?.(name) ?? Promise.resolve({ name, removed: true, message: '' })),
        openBot: (name: string, options: { login?: boolean }) =>
            record(
                `open:${name}:${options.login === true}`,
                fakes.open?.(name, options) ?? Promise.resolve({ name, defaultUrl: 'https://x/', message: '' }),
            ),
    } as unknown as BotHarness;
}

interface RunResult {
    code: number;
    out: string;
    err: string;
}

/** Run the bot registrar over an injected harness (no main(), no real loader). */
async function runInjected(args: string[], harness: BotHarness): Promise<RunResult> {
    const program = new Command().name('kk');
    program.exitOverride();
    registerBotCommand(program, { load: async () => harness });
    const capture = captureOutput();
    try {
        try {
            await program.parseAsync(['node', 'kk', ...args]);
            return { code: 0, out: capture.read(), err: capture.readErr() };
        } catch (error) {
            if (error instanceof CommanderError) {
                return { code: error.exitCode, out: capture.read(), err: capture.readErr() };
            }
            throw error;
        }
    } finally {
        capture.restore();
    }
}

/** Run `kk …` through main() with echo/echoError captured (the real default harness loader). */
async function run(args: string[]): Promise<RunResult> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

const repoRoot = join(import.meta.dir, '../../../..');
const cliEntry = join(repoRoot, 'apps/cli/src/index.ts');
const tempHomes: string[] = [];

/** A throwaway `HOME` so the fixed bot root resolves under a temp dir, never the real ~/.config. */
function tempHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'kk-bot-cli-'));
    tempHomes.push(home);
    return home;
}

/** Run the real CLI entry in a child process with an isolated HOME. */
async function runCliProcess(args: string[], home: string): Promise<RunResult> {
    const proc = Bun.spawn(['bun', cliEntry, ...args], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home, NODE_ENV: 'test' },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, out, err };
}

afterAll(() => {
    for (const home of tempHomes) {
        rmSync(home, { recursive: true, force: true });
    }
});

describe('kk bot registration and argv shape (A22 R1)', () => {
    it('registers one visible bot noun with exactly list/login/logout/open and no extra flags', () => {
        const program = createProgram();
        const bot = program.commands.find((command) => command.name() === 'bot');
        expect(bot).toBeDefined();
        expect(bot?.commands.map((command) => command.name())).toEqual(['list', 'login', 'logout', 'open']);
        expect(bot?.commands.every((command) => command.commands.length === 0)).toBe(true);

        const flags = Object.fromEntries(
            (bot?.commands ?? []).map((command) => [
                command.name(),
                command.options.map((option) => option.long).sort(),
            ]),
        );
        expect(flags).toEqual({
            list: [],
            login: ['--save'],
            logout: [],
            open: ['--login'],
        });
        const login = bot?.commands.find((command) => command.name() === 'login');
        expect(login?.registeredArguments.map((argument) => argument.name())).toEqual(['url']);
        const open = bot?.commands.find((command) => command.name() === 'open');
        expect(open?.registeredArguments.map((argument) => argument.name())).toEqual(['name']);
    });

    it('documents each verb and keeps `kk bot` itself a group with no action', async () => {
        const help = await run(['bot', '--help']);
        expect(help.code).toBe(0);
        for (const verb of ['list', 'login', 'logout', 'open']) {
            expect(help.out).toContain(verb);
        }
        const verbHelp = await run(['bot', 'login', '--help']);
        expect(verbHelp.code).toBe(0);
        expect(verbHelp.out).toContain('Usage: kk bot login');
        expect(verbHelp.out).toContain('--save');

        const group = await run(['bot']);
        expect(group.code).not.toBe(0);
        expect(`${group.out}${group.err}`).toContain('list');
    });
});

describe('kk bot exit-code mapping and output contract (A22 R1/R3-R5)', () => {
    it('maps a usage BotError to exit 2 and every other failure to exit 1', async () => {
        const usage = await runInjected(
            ['bot', 'logout', 'bad name'],
            fakeHarness({
                calls: [],
                logout: () => Promise.reject(new FakeBotError('usage', 'bot name must match [A-Za-z0-9]')),
            }),
        );
        expect(usage.code).toBe(2);
        expect(usage.err).toContain('kk.bot.failed');
        expect(usage.err).toContain('bot name must match');

        const busy = await runInjected(
            ['bot', 'list'],
            fakeHarness({
                calls: [],
                list: () => Promise.reject(new FakeBotError('busy', 'browser lease is held by pid 42')),
            }),
        );
        expect(busy.code).toBe(1);
        expect(busy.err).toContain('browser lease is held by pid 42');

        const unexpected = await runInjected(
            ['bot', 'list'],
            fakeHarness({ calls: [], list: () => Promise.reject(new Error('boom')) }),
        );
        expect(unexpected.code).toBe(1);
        expect(unexpected.err).toContain('boom');
    });

    it('maps the real harness usage failures to exit 2 without touching the filesystem', async () => {
        const unsafeName = await run(['bot', 'logout', 'bad name']);
        expect(unsafeName.code).toBe(2);
        expect(unsafeName.err).toContain('bot name must match');

        const badScheme = await run(['bot', 'login', 'ftp://site.example.com/x', '--save', 'ok']);
        expect(badScheme.code).toBe(2);
        expect(badScheme.err).toContain('kk.bot.failed');

        const userinfo = await run(['bot', 'login', 'https://user:secret@site.example.com/', '--save', 'ok']);
        expect(userinfo.code).toBe(2);
        expect(userinfo.err).not.toContain('secret');
    });

    it('never echoes a supplied login URL query or a token value', async () => {
        const result = await run(['bot', 'login', 'https://site.example.com/login?token=SEKRET', '--save', 'bad name']);
        expect(result.code).toBe(2);
        expect(`${result.out}${result.err}`).not.toContain('SEKRET');
        expect(`${result.out}${result.err}`).not.toContain('token=');
    });

    it('prints one tab-separated row per cached bot and nothing for an empty inventory', async () => {
        const empty = await runInjected(['bot', 'list'], fakeHarness({ calls: [], list: () => Promise.resolve([]) }));
        expect(empty.code).toBe(0);
        expect(empty.out).toBe('');

        const populated = await runInjected(
            ['bot', 'list'],
            fakeHarness({
                calls: [],
                list: () =>
                    Promise.resolve([
                        { name: 'alice', state: 'cached', defaultUrl: 'https://alice.example.com/home' },
                        { name: 'legacy', state: 'cached', defaultUrl: null },
                    ]),
            }),
        );
        expect(populated.code).toBe(0);
        expect(populated.out).toBe('alice\tcached\thttps://alice.example.com/home\nlegacy\tcached\tunknown\n');
    });

    it('prints only the bot name and outcome for a successful mutation', async () => {
        const saved = await runInjected(
            ['bot', 'login', 'https://site.example.com/login?token=SEKRET', '--save', 'alice'],
            fakeHarness({
                calls: [],
                login: (name) => Promise.resolve({ name, defaultUrl: 'https://site.example.com/login' }),
            }),
        );
        expect(saved.code).toBe(0);
        expect(saved.out).toBe('alice\tsaved\n');
        expect(saved.out).not.toContain('SEKRET');

        const removed = await runInjected(['bot', 'logout', 'alice'], fakeHarness({ calls: [] }));
        expect(removed.code).toBe(0);
        expect(removed.out).toBe('alice\tremoved\n');

        const absent = await runInjected(
            ['bot', 'logout', 'ghost'],
            fakeHarness({ calls: [], logout: (name) => Promise.resolve({ name, removed: false, message: '' }) }),
        );
        expect(absent.out).toBe('ghost\tabsent\n');

        const opened = await runInjected(
            ['bot', 'open', 'alice', '--login'],
            fakeHarness({
                calls: [],
                open: (name) => Promise.resolve({ name, defaultUrl: 'https://x/', message: '' }),
            }),
        );
        expect(opened.code).toBe(0);
        expect(opened.out).toBe('alice\tclosed\n');
    });

    it('passes --login through to openBot and leaves plain open unflagged', async () => {
        const withLogin: string[] = [];
        await runInjected(['bot', 'open', 'alice', '--login'], fakeHarness({ calls: withLogin }));
        expect(withLogin).toEqual(['open:alice:true']);

        const plain: string[] = [];
        await runInjected(['bot', 'open', 'alice'], fakeHarness({ calls: plain }));
        expect(plain).toEqual(['open:alice:false']);
    });
});

describe('kk bot browser-free behaviour (A22 R6/R7)', () => {
    it('never loads the harness for help output (lazy load)', async () => {
        let written = '';
        const never: BotCommandDeps = {
            load: () => {
                throw new Error('the harness must stay lazy for help');
            },
        };
        const program = new Command().name('kk');
        program.exitOverride();
        program.configureOutput({
            writeOut: (text: string) => {
                written += text;
            },
            writeErr: (text: string) => {
                written += text;
            },
        });
        registerBotCommand(program, never);

        await expect(program.parseAsync(['node', 'kk', 'bot', '--help'])).rejects.toThrow();
        expect(written).toContain('Usage: kk bot');
        expect(written).not.toContain('must stay lazy');
    });

    it('imports the harness only dynamically, so no browser module loads at CLI start', async () => {
        const source = await Bun.file(new URL('../../src/commands/bot.ts', import.meta.url)).text();
        expect(source).not.toMatch(/^import\s[^;]*from\s*'@gobing-ai\/publish-harness/m);
        expect(source).not.toMatch(/^import\s+type\s[^;]*from\s*'@gobing-ai\/publish-harness\/browser'/m);
        expect(source).toContain("import('@gobing-ai/publish-harness/browser')");
    });
});

describe('kk bot against a throwaway profile root (end-to-end)', () => {
    let home: string;
    beforeEach(() => {
        home = tempHome();
    });
    afterEach(() => {
        rmSync(join(home, '.config'), { recursive: true, force: true });
    });

    it('lists an empty inventory as an empty success and never creates the root', async () => {
        const result = await runCliProcess(['bot', 'list'], home);
        expect(result.code).toBe(0);
        expect(result.out).toBe('');
        expect(existsSync(join(home, '.config', 'kk', 'browser-profiles'))).toBe(false);
    });

    it('lists cached profiles (including a legacy one) as tab-separated rows', async () => {
        const profiles = join(home, '.config', 'kk', 'browser-profiles');
        mkdirSync(join(profiles, 'alice'), { recursive: true });
        writeFileSync(
            join(profiles, 'alice', 'bot.json'),
            JSON.stringify({
                schemaVersion: 1,
                defaultUrl: 'https://alice.example.com/home',
                authenticationEvidence: 'operator-confirmed',
            }),
        );
        mkdirSync(join(profiles, 'legacy'), { recursive: true });

        const result = await runCliProcess(['bot', 'list'], home);
        expect(result.code).toBe(0);
        expect(result.out).toBe('alice\tcached\thttps://alice.example.com/home\nlegacy\tcached\tunknown\n');
    });

    it('refuses traversal/unsafe names, and logout is idempotent for an absent bot', async () => {
        const traversal = await runCliProcess(['bot', 'logout', '../evil'], home);
        expect(traversal.code).toBe(2);
        expect(traversal.err).toContain('kk.bot.failed');

        const first = await runCliProcess(['bot', 'logout', 'ghost'], home);
        expect(first.code).toBe(0);
        expect(first.out).toBe('ghost\tabsent\n');
        const second = await runCliProcess(['bot', 'logout', 'ghost'], home);
        expect(second.code).toBe(0);
        expect(second.out).toBe('ghost\tabsent\n');
        expect(existsSync(join(home, '.config', 'kk', 'browser-profiles', 'ghost'))).toBe(false);
    });

    it('points a missing bot at `kk bot login` instead of inventing a session', async () => {
        const result = await runCliProcess(['bot', 'open', 'ghost'], home);
        expect(result.code).toBe(1);
        expect(result.err).toContain('kk bot login <url> --save ghost');
    });
});
