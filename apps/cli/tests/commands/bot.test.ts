import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** The frozen harness request shape `kk bot exec` builds (0306). */
interface ExecRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: Buffer;
    followRedirects: boolean;
    timeoutMs?: number;
}

interface Fakes {
    list?: () => Promise<unknown[]>;
    login?: (name: string, url: string) => Promise<unknown>;
    logout?: (name: string) => Promise<unknown>;
    open?: (name: string, options: { login?: boolean }) => Promise<unknown>;
    exec?: (name: string, request: ExecRequest) => Promise<unknown>;
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
        readBotSavedMetadata: () => Promise.resolve(null),
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
        execBot: (name: string, request: ExecRequest) =>
            record(
                `exec:${name}`,
                fakes.exec?.(name, request) ??
                    Promise.resolve({
                        status: 200,
                        statusText: 'OK',
                        headers: [],
                        body: Buffer.from('ok'),
                    }),
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
    it('registers one visible bot noun with exactly list/login/logout/open/exec and no extra flags', () => {
        const program = createProgram();
        const bot = program.commands.find((command) => command.name() === 'bot');
        expect(bot).toBeDefined();
        expect(bot?.commands.map((command) => command.name())).toEqual(['list', 'login', 'logout', 'open', 'exec']);
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
            // 0306: the curl subset only — anything else stays a Commander usage error.
            exec: ['--data', '--fail', '--header', '--include', '--location', '--max-time', '--output', '--request'],
        });
        const login = bot?.commands.find((command) => command.name() === 'login');
        expect(login?.registeredArguments.map((argument) => argument.name())).toEqual(['url']);
        const open = bot?.commands.find((command) => command.name() === 'open');
        expect(open?.registeredArguments.map((argument) => argument.name())).toEqual(['name']);
        const exec = bot?.commands.find((command) => command.name() === 'exec');
        expect(exec?.registeredArguments.map((argument) => argument.name())).toEqual(['name', 'url']);
    });

    it('documents each verb and keeps `kk bot` itself a group with no action', async () => {
        const help = await run(['bot', '--help']);
        expect(help.code).toBe(0);
        for (const verb of ['list', 'login', 'logout', 'open', 'exec']) {
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
                        {
                            name: 'alice',
                            state: 'cached',
                            defaultUrl: 'https://alice.example.com/home',
                            identity: 'alice',
                            lastLoginAt: '2026-10-17T02:00:00.000Z',
                            expiresAt: '2026-11-16T02:00:00.000Z',
                        },
                        { name: 'legacy', state: 'cached', defaultUrl: null },
                    ]),
            }),
        );
        expect(populated.code).toBe(0);
        // The three fact columns are appended after the A22 three; a missing fact prints `unknown`.
        expect(populated.out).toBe(
            'alice\tcached\thttps://alice.example.com/home\talice\t2026-10-17T02:00:00.000Z\t2026-11-16T02:00:00.000Z\n' +
                'legacy\tcached\tunknown\tunknown\tunknown\tunknown\n',
        );
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

/** Capture the raw byte writes the exec body goes through (not the ts-utils line seam). */
async function withStdoutBytes<T>(body: () => Promise<T>): Promise<{ result: T; stdout: Buffer }> {
    const chunks: Buffer[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
        callback?.(null);
        return true;
    }) as typeof process.stdout.write;
    try {
        return { result: await body(), stdout: Buffer.concat(chunks) };
    } finally {
        process.stdout.write = original;
    }
}

describe('kk bot exec (0306 R1/R3/R4)', () => {
    const ok = (overrides: Record<string, unknown> = {}) => ({
        status: 200,
        statusText: 'OK',
        headers: [{ name: 'content-type', value: 'text/plain' }],
        body: Buffer.from('pong'),
        ...overrides,
    });

    it('defaults to GET, emits POST for -d, splits headers and reads @file raw', async () => {
        const seen: ExecRequest[] = [];
        const harness = fakeHarness({
            calls: [],
            exec: (_name, request) => {
                seen.push(request);
                return Promise.resolve(ok());
            },
        });

        await withStdoutBytes(() => runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a?x=1'], harness));
        expect(seen[0]).toEqual({
            url: 'https://site.example.com/a?x=1',
            method: 'GET',
            headers: {},
            followRedirects: false,
        });

        const dataFile = join(tempHome(), 'body.txt');
        writeFileSync(dataFile, 'line1\n');
        await withStdoutBytes(() =>
            runInjected(
                [
                    'bot',
                    'exec',
                    'alice',
                    'https://site.example.com/a',
                    '-H',
                    'X-Trace: abc',
                    '-H',
                    'Accept:application/json',
                    '-d',
                    `@${dataFile}`,
                    '-L',
                    '-m',
                    '2.5',
                ],
                harness,
            ),
        );
        // A `@file` body is read raw (the trailing newline survives) and implies POST.
        expect(seen[1]).toEqual({
            url: 'https://site.example.com/a',
            method: 'POST',
            headers: { 'X-Trace': 'abc', Accept: 'application/json' },
            data: Buffer.from('line1\n'),
            followRedirects: true,
            timeoutMs: 2500,
        });

        await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-X', 'PUT', '-d', 'x'], harness),
        );
        expect(seen[2]?.method).toBe('PUT');
        expect(seen[2]?.data).toEqual(Buffer.from('x'));
    });

    it('writes the body bytes to stdout with no added newline, or to the -o file', async () => {
        const harness = fakeHarness({ calls: [], exec: () => Promise.resolve(ok({ body: Buffer.from('a\u0000b') })) });
        const stdoutRun = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a'], harness),
        );
        expect(stdoutRun.result.code).toBe(0);
        expect(stdoutRun.stdout).toEqual(Buffer.from('a\u0000b'));
        expect(stdoutRun.result.err).toBe('');

        const outFile = join(tempHome(), 'response.bin');
        const fileRun = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-o', outFile], harness),
        );
        expect(fileRun.result.code).toBe(0);
        expect(fileRun.stdout.length).toBe(0);
        expect(readFileSync(outFile)).toEqual(Buffer.from('a\u0000b'));
    });

    it('prefixes the -i status line and headers, redacting Set-Cookie values', async () => {
        const harness = fakeHarness({
            calls: [],
            exec: () =>
                Promise.resolve(
                    ok({
                        status: 404,
                        statusText: 'Not Found',
                        headers: [
                            { name: 'content-type', value: 'text/plain' },
                            { name: 'Set-Cookie', value: 'sid=SEKRET; Path=/' },
                        ],
                        body: Buffer.from('missing'),
                    }),
                ),
        });
        const run = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-i'], harness),
        );
        // Playwright exposes no protocol version: the status line is `HTTP <status> <statusText>`.
        expect(run.stdout.toString()).toBe(
            'HTTP 404 Not Found\ncontent-type: text/plain\nSet-Cookie: <redacted>\n\nmissing',
        );
        expect(run.result.code).toBe(0);
        expect(run.stdout.toString()).not.toContain('SEKRET');
    });

    it('maps -f on a 4xx/5xx to exit 1 with the body suppressed', async () => {
        const harness = fakeHarness({
            calls: [],
            exec: () => Promise.resolve(ok({ status: 503, statusText: 'Service Unavailable', body: Buffer.from('x') })),
        });
        const run = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-f'], harness),
        );
        expect(run.result.code).toBe(1);
        expect(run.stdout.length).toBe(0);
        expect(run.result.err).toContain('kk.bot.failed: HTTP 503');

        const withoutFail = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a'], harness),
        );
        expect(withoutFail.result.code).toBe(0);
        expect(withoutFail.stdout).toEqual(Buffer.from('x'));
    });

    it('keeps the -i header block but suppresses the body when -f rejects the status', async () => {
        const harness = fakeHarness({
            calls: [],
            exec: () =>
                Promise.resolve({
                    status: 404,
                    statusText: 'Not Found',
                    headers: [{ name: 'content-type', value: 'text/plain' }],
                    body: Buffer.from('secret body'),
                }),
        });
        const run = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-i', '-f'], harness),
        );
        expect(run.result.code).toBe(1);
        expect(run.result.err).toContain('kk.bot.failed: HTTP 404');
        expect(run.stdout.toString()).toBe('HTTP 404 Not Found\ncontent-type: text/plain\n\n');
    });

    it('rejects a malformed option as a usage error before the request', async () => {
        const calls: string[] = [];
        const harness = fakeHarness({ calls });

        // Malformed values are rejected inside the action: `kk.bot.failed` on stderr, exit 2.
        for (const args of [
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-H', 'not-a-header'],
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-H', ': empty-name'],
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-m', '0'],
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-m', 'soon'],
        ]) {
            const run = await runInjected(args, harness);
            expect(run.code).toBe(2);
            expect(run.err).toContain('kk.bot.failed');
            // A rejected header value is never echoed (it can be a credential).
            expect(run.err).not.toContain('not-a-header');
        }

        // Unsupported option and a missing argument are Commander usage errors, also exit 2.
        const unsupported = await run(['bot', 'exec', 'alice', 'https://site.example.com/a', '--compressed']);
        expect(unsupported.code).toBe(2);
        expect(unsupported.err).toContain("unknown option '--compressed'");
        const missingUrl = await runInjected(['bot', 'exec', 'alice'], harness);
        expect(missingUrl.code).toBe(2);

        expect(calls).toEqual([]);
    });

    it('treats an unreadable @file body as an operational failure (exit 1)', async () => {
        const calls: string[] = [];
        const run = await runInjected(
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-d', '@/nonexistent/body.txt'],
            fakeHarness({ calls }),
        );
        expect(run.code).toBe(1);
        expect(run.err).toContain('kk.bot.failed');
        expect(calls).toEqual([]);
    });

    it('rejects the out-of-scope stdin body -d @- as a usage error (exit 2)', async () => {
        const calls: string[] = [];
        const run = await runInjected(
            ['bot', 'exec', 'alice', 'https://site.example.com/a', '-d', '@-'],
            fakeHarness({ calls }),
        );
        expect(run.code).toBe(2);
        expect(run.err).toContain('kk.bot.failed');
        expect(calls).toEqual([]);
    });

    it('combines repeated -H names case-insensitively instead of dropping a value', async () => {
        const seen: ExecRequest[] = [];
        const harness = fakeHarness({
            calls: [],
            exec: (_name, request) => {
                seen.push(request);
                return Promise.resolve(ok());
            },
        });
        await withStdoutBytes(() =>
            runInjected(
                [
                    'bot',
                    'exec',
                    'alice',
                    'https://site.example.com/a',
                    '-H',
                    'Accept: text/html',
                    '-H',
                    'accept: application/json',
                    '-H',
                    'Cookie: a=1',
                    '-H',
                    'cookie: b=2',
                ],
                harness,
            ),
        );
        // RFC 9110 §5.3 joins field lines with ", "; the Cookie header joins with "; " (RFC 6265 §5.4).
        expect(seen[0]?.headers).toEqual({ Accept: 'text/html, application/json', Cookie: 'a=1; b=2' });
    });

    it('writes the -i header block into the -o file with the body, as curl does', async () => {
        const harness = fakeHarness({ calls: [], exec: () => Promise.resolve(ok({ body: Buffer.from('pong') })) });
        const outFile = join(tempHome(), 'with-headers.txt');
        const run = await withStdoutBytes(() =>
            runInjected(['bot', 'exec', 'alice', 'https://site.example.com/a', '-i', '-o', outFile], harness),
        );
        expect(run.result.code).toBe(0);
        expect(run.stdout.length).toBe(0);
        expect(readFileSync(outFile, 'utf8')).toBe('HTTP 200 OK\ncontent-type: text/plain\n\npong');

        const failFile = join(tempHome(), 'failed.txt');
        const failed = await withStdoutBytes(() =>
            runInjected(
                ['bot', 'exec', 'alice', 'https://site.example.com/a', '-f', '-o', failFile],
                fakeHarness({ calls: [], exec: () => Promise.resolve(ok({ status: 500, statusText: 'Boom' })) }),
            ),
        );
        expect(failed.result.code).toBe(1);
        expect(existsSync(failFile)).toBe(false);
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
        const rows = result.out
            .trimEnd()
            .split('\n')
            .map((row) => row.split('\t'));
        expect(rows).toHaveLength(2);
        // A record without a stored save time shows the metadata mtime (metadata is only ever
        // rewritten by a successful login), never an invented date.
        expect(rows[0]?.slice(0, 4)).toEqual(['alice', 'cached', 'https://alice.example.com/home', 'unknown']);
        expect(Date.parse(rows[0]?.[4] ?? '')).toBeGreaterThan(Date.now() - 300_000);
        expect(rows[0]?.[5]).toBe('unknown');
        expect(rows[1]).toEqual(['legacy', 'cached', 'unknown', 'unknown', 'unknown', 'unknown']);
    });

    it('shows identity, last login and expiry for full/partial/legacy/corrupt rows (0305 R5)', async () => {
        const profiles = join(home, '.config', 'kk', 'browser-profiles');
        const write = (name: string, metadata: unknown): void => {
            mkdirSync(join(profiles, name), { recursive: true });
            writeFileSync(
                join(profiles, name, 'bot.json'),
                typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
            );
        };
        write('full', {
            schemaVersion: 1,
            defaultUrl: 'https://full.example.com/home',
            authenticationEvidence: 'site-verified',
            pluginName: 'xhs-pub',
            lastLoginAt: '2026-10-17T02:00:00.000Z',
            expiresAt: '2026-11-16T02:00:00.000Z',
            identity: 'alice',
        });
        write('partial', {
            schemaVersion: 1,
            defaultUrl: 'https://partial.example.com/',
            authenticationEvidence: 'operator-confirmed',
            expiresAt: '2026-11-16T02:00:00.000Z',
        });
        mkdirSync(join(profiles, 'legacy'), { recursive: true });
        write('corrupt', '{ not json');

        const result = await runCliProcess(['bot', 'list'], home);
        expect(result.code).toBe(0);
        const rows = Object.fromEntries(
            result.out
                .trimEnd()
                .split('\n')
                .map((row) => row.split('\t'))
                .map((cells) => [cells[0], cells]),
        );

        expect(rows.full).toEqual([
            'full',
            'cached',
            'https://full.example.com/home',
            'alice',
            '2026-10-17T02:00:00.000Z',
            '2026-11-16T02:00:00.000Z',
        ]);
        // No stored login time and no identity: mtime fallback + `unknown`.
        expect(rows.partial?.slice(0, 4)).toEqual(['partial', 'cached', 'https://partial.example.com/', 'unknown']);
        expect(rows.partial?.[5]).toBe('2026-11-16T02:00:00.000Z');
        expect(rows.legacy).toEqual(['legacy', 'cached', 'unknown', 'unknown', 'unknown', 'unknown']);
        expect(rows.corrupt).toEqual(['corrupt', 'cached', 'unknown', 'unknown', 'unknown', 'unknown']);
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
