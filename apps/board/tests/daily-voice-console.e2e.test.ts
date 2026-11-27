/**
 * G83/0443 — the Daily AI Voice console's committed end-to-end evidence.
 *
 * The executable verification frozen in `docs/design/daily-voice-ops-console.md` §7: one repeatable
 * E2E over a fixture works root (days 20261115–20261125, including the shipinhao `effect: none`
 * failure, an engine-fallback day and a window whose plan has no launch receipt), the reader started
 * against it, and the console driven in a real Chromium. It commits a render of Today, Generation,
 * Publishing, History and one previewed + confirmed `publish-window --dummy` action whose child is a
 * stub `kk` on PATH, plus the digest JSON the parity assertion compares.
 *
 * Failure list written before the code:
 * 1. the console never mounts, or a tab renders nothing for the fixture day it was opened on;
 * 2. a day's status or attention list disagrees with the recorded evidence (e.g. an `effect: none`
 *    failed target reading `ok`, or a plan without a launch receipt reading success);
 * 3. `kk news digest --json` and `GET /api/days/<day>` answer different objects for one day;
 * 4. the action plane is enabled in config but the console never offers a launch (digest carries
 *    `actions.enabled: false`), or a preview never resolves the argv the digest rendered;
 * 5. the launched action's argv differs from the rendered recipe, or nothing is audited;
 * 6. a request from the wrong origin, without the `x-kk-action` header, or with a stale token is
 *    accepted — the envelope's refusals are the security claim.
 *
 * Use KK_UPDATE_BOARD_EVIDENCE=1 to refresh the checked-in artifacts.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    closeSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { DailyDigest } from '@gobing-ai/kk-board/contracts';
import { type Browser, chromium, type Page } from 'playwright';
import { spurPackageRootOf } from '../../../scripts/spur-env';

const REPO = resolve(import.meta.dir, '../../..');
const CLI_ENTRY = join(REPO, 'apps/cli/src/index.ts');
const FIXTURE = join(REPO, 'apps/board/tests/fixtures/daily-voice-days');
let artifacts: string;
const MODULE_ID = 'kk-daily-ai-voice2';
const DAYS = [
    '20261115',
    '20261116',
    '20261117',
    '20261118',
    '20261119',
    '20261120',
    '20261121',
    '20261122',
    '20261123',
    '20261124',
    '20261125',
];
/** The day the action step drives: a past day whose overseas window never ran. */
const ACTION_DAY = '20261123';
/** The day mirroring the 2026-11-25 shipinhao `effect: none` failure. */
const FAILED_DAY = '20261125';
/** A browser navigation plus a reader round-trip does not fit bun's 5 s default per test. */
const TEST_TIMEOUT = 60_000;

const children: { kill(): void }[] = [];
const servers: {
    name: string;
    label: string;
    logFile: string;
    child: { kill(): void; exited: Promise<number> };
}[] = [];
const tempDirs: string[] = [];

let project = '';
let works = '';
let configFile = '';
let stubArgvLog = '';
let boardOrigin = '';
let moduleApi = '';
let spur: string[] = [];
let browser: Browser | null = null;
let page: Page | null = null;

/** A fresh realpath'd temp dir the suite removes afterwards. */
function realTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

/** Child environment for every spawned CLI/server in this fixture. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', ...extra };
    // A nested `spur workflow run` is refused when the guard is inherited from whatever pipeline is
    // running the suite (same reason as installed-board.test.ts).
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    return env;
}

/** Resolve the Spur CLI: `$SPUR_BIN`, then the PATH, then the module resolver. */
function resolveSpur(): string[] {
    const override = process.env.SPUR_BIN;
    if (override !== undefined && override !== '') return [process.execPath, override];
    const which = Bun.which('spur');
    if (which !== null) {
        const root = spurPackageRootOf(dirname(realpathSync(which)));
        if (root !== undefined) return [process.execPath, join(root, 'spur.js')];
    }
    return [process.execPath, join(dirname(import.meta.resolve('@gobing-ai/spur/package.json')), 'spur.js')];
}

/** Run a short command to completion; a non-zero exit is a loud setup failure. */
function shell(command: string, args: string[], cwd: string, extraEnv: Record<string, string> = {}): string {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        env: childEnv(extraEnv),
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/**
 * Serialize the shared workspace build across test files: `bun scripts/build-board.ts` writes the
 * SHARED `apps/cli/dist/board` tree that this suite serves, so two files building at once race.
 */
async function withBuildLock<T>(fn: () => T): Promise<T> {
    const lock = join(tmpdir(), 'kk-board-shared-build.lock');
    const deadline = Date.now() + 300_000;
    let fd: number | null = null;
    while (fd === null) {
        try {
            fd = openSync(lock, 'wx');
        } catch {
            try {
                if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { force: true });
            } catch {
                // the lock vanished between attempts — just retry
            }
            if (Date.now() > deadline) throw new Error('timed out acquiring the board shared-build lock');
            await Bun.sleep(200);
        }
    }
    try {
        return fn();
    } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
    }
}

/** A loopback port the OS reports free right now (a small, accepted TOCTOU window). */
function freePort(): number {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = server.port ?? 0;
    server.stop(true);
    return port;
}

/** Spawn a long-running server with its stdout+stderr captured to a readable log file. */
function spawnServer(
    name: string,
    label: string,
    args: string[],
    extraEnv: Record<string, string> = {},
): (typeof servers)[number] {
    const logFile = join(realTempDir(`kk-daily-voice-${name}-`), 'server.log');
    const fd = openSync(logFile, 'a');
    const child = Bun.spawn({
        cmd: args,
        cwd: project,
        stdout: fd,
        stderr: fd,
        env: childEnv(extraEnv),
    });
    children.push(child);
    const handle = { name, label, logFile, child };
    servers.push(handle);
    return handle;
}

/** One server's captured output, trimmed for a failure message. */
function serverLog(server: { logFile: string }): string {
    if (!existsSync(server.logFile)) return '(no output captured)';
    return readFileSync(server.logFile, 'utf-8').trim() || '(no output captured)';
}

/** Wait on a real readiness signal; a server that exits first fails immediately with its log. */
async function waitFor(
    url: string,
    server: { label: string; logFile: string; child: { exited: Promise<number> } },
    timeoutMs = 30_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let exited: number | null = null;
    void server.child.exited.then((code) => {
        exited = code;
    });
    while (Date.now() < deadline) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            // not listening yet
        }
        if (exited !== null) break;
        await Bun.sleep(150);
    }
    const reason = exited === null ? 'timed out' : `exited with code ${exited}`;
    throw new Error(`${server.label} never became ready at ${url} (${reason}); captured output:\n${serverLog(server)}`);
}

/** The fixture works root, copied into the throwaway project with its capture paths rewritten. */
function stageFixture(): void {
    cpSync(FIXTURE, works, { recursive: true });
    const runs = join(works, '.board/runs');
    for (const name of readdirSync(runs)) {
        const path = join(runs, name);
        writeFileSync(
            path,
            readFileSync(path, 'utf-8').split('__PROJECT_ROOT__').join(project).split('__WORKS_ROOT__').join(works),
        );
    }
}

/**
 * Copy this checkout's built module into the project and point `bootstrap.modules` at the copy.
 *
 * The server refuses a module directory that resolves outside the project root, so a symlink back to
 * the checkout is not an option; the copy is the built bundle under test, byte for byte.
 */
function writeProjectConfig(): void {
    const moduleRoot = join(project, 'node_modules/@gobing-ai/kk-daily-voice-module/daily-voice');
    mkdirSync(dirname(moduleRoot), { recursive: true });
    cpSync(join(REPO, 'apps/cli/dist/board/daily-voice'), moduleRoot, { recursive: true });
    cpSync(join(REPO, 'apps/cli/dist/board/api.js'), join(dirname(moduleRoot), 'api.js'));
    const lines = [
        '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
        'version: "1.2"',
        'name: kk-daily-voice-console-fixture',
        'bootstrap:',
        '  database: { enabled: true, driver: bun-sqlite, url: .spur/spur.db }',
        '  scheduler: { enabled: false }',
        '  modules:',
        `    - id: ${MODULE_ID}`,
        '      name: Daily AI Voice',
        '      icon: "🎙️"',
        '      type: react',
        '      directory: node_modules/@@gobing-ai/kk-daily-voice-module/daily-voice'.replace('@@', '@'),
        '      api: node_modules/@gobing-ai/kk-daily-voice-module/api.js',
        '      entry: index.js',
        '      styles: [index.css]',
        '',
    ];
    mkdirSync(join(project, '.spur'), { recursive: true });
    writeFileSync(join(project, '.spur/config.yaml'), lines.join('\n'));
}

/**
 * The minimal `kk-news-generate` definition the fixture's runs execute.
 *
 * The node ids are the ones the news artifact manifest names as producers, so the reader's
 * availability rules can be exercised; each state does nothing, because the day's evidence is the
 * fixture's hand-written artifacts, not the run's payloads.
 */
function writeWorkflow(): void {
    const states = [
        'prepare',
        'collect',
        'curate',
        'plan',
        'qc-content',
        'generate',
        'voice',
        'safety',
        'duration',
        'run-report',
    ];
    const lines = [
        '---',
        'name: kk-news-generate',
        'kind: state-machine',
        `initialState: ${states[0]}`,
        'terminalStates: [done]',
        'states:',
        ...states.flatMap((id) => [
            `    - id: ${id}`,
            '      onEnter:',
            '          - { kind: shell, options: { command: "true" } }',
        ]),
        '    - id: done',
        'transitions:',
    ];
    for (let index = 0; index < states.length; index += 1) {
        const next = states[index + 1] ?? 'done';
        lines.push(`    - { from: ${states[index]}, to: ${next}, guard: { kind: always } }`);
    }
    mkdirSync(join(project, '.spur/workflows'), { recursive: true });
    writeFileSync(join(project, '.spur/workflows/kk-news-generate.yaml'), `${lines.join('\n')}\n`);
}

/** The kk config: the action plane switched on, the store kept inside the fixture project. */
function writeKkConfig(): void {
    configFile = join(realTempDir('kk-daily-voice-config-'), 'config.yaml');
    writeFileSync(
        configFile,
        ['board:', '  actions:', '    enabled: true', 'store:', '  db_path: .works/kk.db', ''].join('\n'),
    );
}

/** A stub `kk` on PATH: it records its argv and answers with a run id, and publishes nothing. */
function writeStubKk(): string {
    const bin = join(realTempDir('kk-daily-voice-stub-'), 'bin');
    mkdirSync(bin, { recursive: true });
    stubArgvLog = join(bin, 'argv.log');
    const script = join(bin, 'kk');
    // The log path is baked in rather than read from the environment: the child env is the reader's
    // inherited one, and a launch that silently lost a variable would look like a launch that worked.
    writeFileSync(
        script,
        ['#!/bin/sh', `printf "%s\\n" "$*" >> '${stubArgvLog}'`, 'printf \'{"runId":"stub-1"}\\n\'', ''].join('\n'),
        { mode: 0o755 },
    );
    return bin;
}

/**
 * One run per fixture day, under the exact run id its capture record names.
 *
 * The capture records are committed because the day projection reads them; the runs are created here
 * because a Spur run id only exists in a project database.
 */
function runFixtureDays(): void {
    for (const day of DAYS) {
        shell(
            spur[0] ?? process.execPath,
            [
                ...spur.slice(1),
                '--no-logo',
                'workflow',
                'run',
                join(project, '.spur/workflows/kk-news-generate.yaml'),
                '--run-id',
                `kk-news-generate-${day}-1`,
                '--quiet',
            ],
            project,
        );
    }
}

/** Build the whole fixture: module bundle, project, day runs, servers, browser. */
async function setup(): Promise<void> {
    spur = resolveSpur();
    artifacts =
        process.env.KK_UPDATE_BOARD_EVIDENCE === '1'
            ? join(REPO, 'apps/board/tests/artifacts/daily-voice-console')
            : realTempDir('kk-console-evidence-');
    mkdirSync(artifacts, { recursive: true });
    // 1. The module assets the Board serves must be this checkout's source, not a stale bundle.
    await withBuildLock(() => shell('bun', ['scripts/build-board.ts'], REPO));
    if (!existsSync(join(REPO, 'apps/cli/dist/board/daily-voice/index.js'))) {
        throw new Error('build-board did not produce the daily-voice module bundle');
    }

    project = realTempDir('kk-daily-voice-project-');
    works = join(project, '.works');
    stageFixture();
    writeProjectConfig();
    writeWorkflow();
    writeKkConfig();
    const stubBin = writeStubKk();
    runFixtureDays();

    // The Board runs the native module with the fixture action configuration.
    const boardPort = freePort();
    boardOrigin = `http://127.0.0.1:${boardPort}`;
    moduleApi = `${boardOrigin}/api/modules/${MODULE_ID}`;
    const boardServer = spawnServer(
        'board',
        'Board (spur self serve)',
        [...spur, 'self', 'serve', '--port', String(boardPort), '--host', '127.0.0.1', '--no-open', '--cwd', project],
        {
            KK_CONFIG: configFile,
            KK_STUB_ARGV_LOG: stubArgvLog,
            PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        },
    );
    await waitFor(`${moduleApi}/api/health`, boardServer);

    try {
        browser = await chromium.launch();
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Chromium is unavailable — run \`bunx playwright install chromium\`. Cause: ${cause}`);
    }
    page = await browser.newPage();
    page.setDefaultTimeout(20_000);
}

beforeAll(setup, 600_000);

afterAll(async () => {
    if (page !== null) await page.close().catch(() => undefined);
    if (browser !== null) await browser.close().catch(() => undefined);
    for (const server of servers) server.child.kill();
    for (const child of children) child.kill();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A navigation counter: a hash-only change is a same-document jump, so each visit gets a fresh URL. */
let navigation = 0;

/** The module route for one day and tab. */
function moduleUrl(day: string, tab: string): string {
    navigation += 1;
    const query = new URLSearchParams({ n: String(navigation) });
    return `${boardOrigin}/board/modules/${MODULE_ID}?${query.toString()}#${new URLSearchParams({ day, tab }).toString()}`;
}

/** A reader request carrying the Board origin, exactly as the browser sends it. */
function readerFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${moduleApi}${path}`, {
        ...init,
        headers: { origin: boardOrigin, ...(init.headers as Record<string, string> | undefined) },
    });
}

/** Open the console on one day + tab and wait for the module shell to mount. */
async function openConsole(day: string, tab: string): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.goto(moduleUrl(day, tab), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.kk-board-daily-voice', { timeout: 20_000 });
    await page.waitForSelector(`[data-testid="${tab === 'today' ? 'today-panel' : `${tab}-panel`}"]`, {
        timeout: 20_000,
    });
}

/** Click one console tab and wait for its panel. */
async function openTab(tab: 'generation' | 'publishing' | 'history' | 'actions'): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.click(`#daily-voice-console-${tab}`);
    await page.waitForSelector(`[data-testid="${tab}-panel"]`, { timeout: 20_000 });
}

/** Commit one render under the artifacts directory. */
async function shot(name: string): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
}

/** One day's digest as the reader answers it. */
async function digestOf(day: string): Promise<DailyDigest> {
    const response = await readerFetch(`/api/days/${day}`);
    expect(response.status).toBe(200);
    return (await response.json()) as DailyDigest;
}

describe('the fixture works root (R1)', () => {
    it('covers the eleven days and their four recorded shapes', async () => {
        const failed = await digestOf(FAILED_DAY);
        expect(failed.status).toBe('failed');
        const blocked = failed.windows.flatMap((window) => window.targets).filter((target) => target.effect === 'none');
        expect(blocked.map((target) => target.id)).toContain('video.shipinhao');
        expect(failed.attention.map((item) => item.kind)).toContain('target-failed');

        const fallback = await digestOf('20261116');
        expect(fallback.generation.durations.map((duration) => duration.step)).toContain('voice');
        expect(fallback.windows.every((window) => window.launchStatus === 'done')).toBe(true);

        const unbound = await digestOf('20261119');
        const cnPeak = unbound.windows.find((window) => window.window === 'cn-peak');
        expect(cnPeak?.launchStatus).toBe('unknown');
        expect(cnPeak?.unknownReason).toBe('no-launch-receipt');
    });

    it('answers one digest per day and a bounded history list', async () => {
        const days = (await (await readerFetch('/api/days?from=20261115&until=20261125')).json()) as {
            day: string;
            status: string;
        }[];
        expect(days.map((day) => day.day)).toEqual([...DAYS].reverse());
        expect(days.find((day) => day.day === FAILED_DAY)?.status).toBe('failed');
        expect(days.find((day) => day.day === '20261122')?.status).toBe('running');
    });
});

describe('the console renders the day (R2)', () => {
    it(
        'shows Today with the failed target and its recipe',
        async () => {
            await openConsole(FAILED_DAY, 'today');
            if (page === null) throw new Error('browser page not ready');
            await page.waitForSelector('[data-testid="attention-list"]');
            const attention = await page.locator('[data-testid="attention-list"]').innerText();
            expect(attention).toContain('target-failed');
            expect(attention).toContain('video.shipinhao');
            // The rendered recipe is the retry argv the plane would execute, printed as copyable text.
            expect(attention).toContain(`kk news publish --run-date ${FAILED_DAY} --window after-generate --retry`);
            await shot('today');
        },
        TEST_TIMEOUT,
    );

    it(
        'shows the Generation tab with the attempt and its recorded node timeline',
        async () => {
            await openConsole(FAILED_DAY, 'today');
            await openTab('generation');
            if (page === null) throw new Error('browser page not ready');
            await page.waitForSelector('[data-testid="node-timeline"]');
            const timeline = await page.locator('[data-testid="node-timeline"]').innerText();
            // `step-timing.json` is the day's own record: a node the run never charted still appears,
            // carrying its step duration even when the run recorded no state for it.
            expect(timeline).toContain('Generate audio');
            expect(timeline).toContain('Curate topics');
            expect(timeline).toContain('4m 40s');
            await shot('generation');
        },
        TEST_TIMEOUT,
    );

    it(
        'shows the Publishing tab with the window matrix and its provenance checks',
        async () => {
            await openConsole(FAILED_DAY, 'today');
            await openTab('publishing');
            if (page === null) throw new Error('browser page not ready');
            expect(await page.locator('[data-testid="target-matrix"]').count()).toBeGreaterThan(0);
            const matrix = await page.locator('[data-testid="publishing-panel"]').innerText();
            expect(matrix).toContain('video.shipinhao');
            expect(matrix).toContain('failed');
            expect(matrix).toContain('plan digest');
            await shot('publishing');
        },
        TEST_TIMEOUT,
    );

    it(
        'shows History with one row per day and the node trend',
        async () => {
            await openConsole(FAILED_DAY, 'history');
            if (page === null) throw new Error('browser page not ready');
            const rows = await page.locator('.kk-board-history tbody tr').count();
            expect(rows).toBe(DAYS.length);
            const history = await page.locator('.kk-board-history').innerText();
            expect(history).toContain(FAILED_DAY);
            expect(history).toContain('running');
            await page.waitForSelector('[data-testid="duration-trend"]');
            await shot('history');
        },
        TEST_TIMEOUT,
    );
});

describe('the digest is one projection (R3)', () => {
    it(
        'renders the same DailyDigest the reader answers',
        async () => {
            const fromReader = await digestOf(ACTION_DAY);
            const fromCli = JSON.parse(
                shell(process.execPath, [CLI_ENTRY, 'news', 'digest', '--run-date', ACTION_DAY, '--json'], project, {
                    KK_CONFIG: configFile,
                }),
            ) as DailyDigest;
            expect(fromCli).toEqual(fromReader);
            writeFileSync(join(artifacts, 'digest.json'), `${JSON.stringify(fromReader, null, 4)}\n`);
        },
        TEST_TIMEOUT,
    );

    it(
        'renders markdown from the same figures',
        async () => {
            const markdown = shell(process.execPath, [CLI_ENTRY, 'news', 'digest', '--run-date', ACTION_DAY], project, {
                KK_CONFIG: configFile,
            });
            const digest = await digestOf(ACTION_DAY);
            expect(markdown).toContain(`# Daily AI Voice — ${ACTION_DAY}`);
            expect(markdown).toContain(`Status: **${digest.status}** · attention: ${digest.attention.length}`);
            for (const window of digest.windows) {
                expect(markdown).toContain(`**${window.window}**: ${window.launchStatus}`);
            }
        },
        TEST_TIMEOUT,
    );

    it('exits non-zero and names the path for a day with no directory', () => {
        const result = spawnSync(process.execPath, [CLI_ENTRY, 'news', 'digest', '--run-date', '29990101'], {
            cwd: project,
            encoding: 'utf-8',
            env: childEnv({ KK_CONFIG: configFile }),
        });
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain(join(works, 'kk-news-generate', '29990101'));
    });
});

describe('the guarded action plane (R2/R11)', () => {
    it(
        'previews and confirms the window recipe, and launches exactly that argv',
        async () => {
            await openConsole(ACTION_DAY, 'actions');
            if (page === null) throw new Error('browser page not ready');
            // The plane is on: the receipts-only diagnostic must not be rendered.
            expect(await page.locator('[data-testid="actions-panel"]').innerText()).not.toContain(
                'Actions are disabled',
            );
            const recipes = page.locator('[data-testid="action-recipes"] li');
            // The recipe renders as its copyable argv, so the window is what identifies the row.
            const target = recipes.filter({ hasText: '--window overseas-rss --dummy' }).first();
            const recipeText = await target.innerText();
            expect(recipeText).toContain(`kk news publish --run-date ${ACTION_DAY} --window overseas-rss --dummy`);

            await target.getByRole('button', { name: 'preview' }).click();
            const preview = page.locator('[data-testid="action-preview-argv"]').first();
            await preview.waitFor();
            const argv = (await preview.innerText()).trim();
            expect(argv).toBe(`kk news publish --run-date ${ACTION_DAY} --window overseas-rss --dummy`);

            await target.getByRole('button', { name: 'run' }).click();
            await page.locator('text=launched — see Actions log').first().waitFor();
            await shot('action');

            // The launch is followed by the recorded exit, so wait for it rather than racing the child.
            const auditPath = join(works, 'kk-news-generate', ACTION_DAY, 'actions.jsonl');
            for (let tick = 0; tick < 50 && !existsSync(stubArgvLog); tick += 1) await Bun.sleep(100);
            // The stub `kk` recorded the argv it was spawned with: the recipe and the launch agree.
            if (!existsSync(stubArgvLog)) {
                throw new Error(
                    `the launch never reached the stub kk on PATH; audit lines:\n${readFileSync(
                        auditPath,
                        'utf-8',
                    )}\nstub script: ${readFileSync(join(dirname(stubArgvLog), 'kk'), 'utf-8')}`,
                );
            }
            const recorded = readFileSync(stubArgvLog, 'utf-8').trim().split('\n').filter(Boolean);
            expect(recorded).toContain(`news publish --run-date ${ACTION_DAY} --window overseas-rss --dummy`);
            writeFileSync(join(artifacts, 'argv.log'), `${recorded.join('\n')}\n`);

            // And the launch is audited on the day it names.
            const audit = readFileSync(auditPath, 'utf-8').trim().split('\n');
            expect(
                audit.some((line) => line.includes('"kind":"publish-window"') && line.includes('"runId":"stub-1"')),
            ).toBe(true);
        },
        TEST_TIMEOUT,
    );

    it(
        'refuses a foreign origin, a missing header and a stale token',
        async () => {
            const kind = 'publish-window';
            const params = { day: ACTION_DAY, window: 'overseas-rss', dummy: 'true' };
            const foreign = await fetch(`${moduleApi}/api/actions/${kind}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1', origin: 'http://127.0.0.1:9' },
                body: JSON.stringify({ params }),
            });
            // The reader's own origin gate answers first; the plane's refusal matrix follows below.
            expect(foreign.status).toBe(403);
            expect(((await foreign.json()) as { code: string }).code).toBe('board.origin.refused');

            const headerless = await readerFetch(`/api/actions/${kind}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ params }),
            });
            expect(headerless.status).toBe(403);
            expect(((await headerless.json()) as { code: string }).code).toBe('actions.header.missing');

            const stale = await readerFetch(`/api/actions/${kind}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({ params, token: 'not-a-token' }),
            });
            expect(stale.status).toBe(409);
            expect(((await stale.json()) as { code: string }).code).toBe('actions.token.invalid');
        },
        TEST_TIMEOUT,
    );
});

describe('the committed evidence', () => {
    it('carries the five renders, the argv log and the digest', () => {
        for (const name of ['today', 'generation', 'publishing', 'history', 'action']) {
            const path = join(artifacts, `${name}.png`);
            expect(existsSync(path)).toBe(true);
            expect(statSync(path).size).toBeGreaterThan(5_000);
        }
        expect(existsSync(join(artifacts, 'argv.log'))).toBe(true);
        expect(existsSync(join(artifacts, 'digest.json'))).toBe(true);
    });
});
