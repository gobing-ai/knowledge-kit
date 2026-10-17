/**
 * G8/0255 — the installed-package Board acceptance check.
 *
 * The executable acceptance layer frozen in `docs/design/workflow-board-modules.md` §9: it packs
 * the CLI (honoring its `prepack` build hook), installs the tarball into a throwaway project,
 * starts the INSTALLED `spur` Board with that project's `bootstrap.modules` pointing at the
 * INSTALLED package's `dist/board/<entry>` tree, then drives the three native module routes and
 * Settings → Workflows with a real Chromium. No source-checkout import may satisfy the module
 * assets: the suite asserts the served bundles are byte-identical to the installed package's files.
 *
 * Fixtures are deterministic — the run rows come from real but trivially fast `spur workflow run`
 * executions and the artifacts are hand-written under a real captured workspace. A missing
 * Chromium runtime FAILS the setup with a clear message; it is never a silent skip.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';

const REPO = resolve(import.meta.dir, '../../..');
const CLI_DIR = join(REPO, 'apps/cli');
const INSTALLED = '@gobing-ai/knowledge-kit';
const PROJECT_NAME = 'kk-installed-board-fixture';
const MODULES = [
    { id: 'kk-collect', name: 'Collect', icon: '📥', entry: 'collect' },
    { id: 'kk-daily-ai-voice2', name: 'Daily AI Voice', icon: '🎙️', entry: 'daily-voice' },
    { id: 'kk-itc', name: 'IT Content', icon: '✍️', entry: 'itc' },
] as const;

/** Every long-running child + temp dir the suite owns, torn down in `afterAll`. */
const children: { kill(): void }[] = [];
/** Every long-running server, with the log file that captured its stdout+stderr. */
const servers: {
    name: string;
    label: string;
    logFile: string;
    child: { kill(): void; exited: Promise<number> };
}[] = [];
const tempDirs: string[] = [];

let project = '';
let installedPkg = '';
let cliEntry = '';
let boardOrigin = '';
let readerOrigin = '';
let browser: Browser | null = null;
let page: Page | null = null;
let spur: string[] = [];

/** Run a short command to completion; a non-zero exit is a loud setup failure. */
function shell(command: string, args: string[], cwd: string): string {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        env: childEnv(),
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return result.stdout;
}

/** Run the installed `spur` CLI with `args`, resolving `spur.js` from the workspace or PATH. */
function spawnSpur(args: string[], cwd: string): string {
    const [command = process.execPath, ...rest] = spur;
    return shell(command, [...rest, ...args], cwd);
}

/** Resolve the installed `spur` CLI: `$SPUR_BIN`, then the workspace dependency, then the PATH. */
function resolveSpur(): string[] {
    const override = process.env.SPUR_BIN;
    if (override !== undefined && override !== '') return [process.execPath, override];
    try {
        const pkg = import.meta.resolve('@gobing-ai/spur/package.json');
        return [process.execPath, join(dirname(fileURLToPath(pkg)), 'spur.js')];
    } catch {
        const which = Bun.which('spur');
        if (which !== null) return [which];
        throw new Error('cannot resolve the installed spur CLI; set SPUR_BIN to spur.js');
    }
}

/** A fresh realpath'd temp dir the suite removes afterwards. */
function realTempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

/**
 * Serialize the shared workspace build/pack across test files with a cross-process lock. `bun pm
 * pack` runs the CLI `prepack` build, which writes the SHARED `apps/cli/dist` + `apps/board/dist`
 * trees; two test files packing/ building at once race over those files. The lock makes the suite
 * correct under `bun test` across files, not only when a single file runs in isolation.
 */
async function withBuildLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const lock = join(tmpdir(), 'kk-board-shared-build.lock');
    const deadline = Date.now() + 300_000;
    let fd: number | null = null;
    while (fd === null) {
        try {
            fd = openSync(lock, 'wx');
        } catch {
            // A crashed holder leaves a stale lock; reclaim it after a grace period that stays BELOW the
            // 300s waiter deadline, else a SIGKILLed holder's lock is never reclaimed by any waiter. A real
            // pack/build holds the lock for seconds, so 120s never cuts a live holder.
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
        return await fn();
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

/**
 * Child environment for every spawned CLI/server in this fixture.
 *
 * A nested `spur workflow run` is refused when `SPUR_WORKFLOW_RUN_ACTIVE` is inherited (the guard
 * that stops a pipeline from forking another pipeline). This file deliberately drives the CLI in a
 * throwaway project, so it must not inherit the guard from whatever pipeline is running the test
 * suite — a full `spur workflow run feature-verification.yaml` gate run failed exactly that way
 * (2026-10-13). Same treatment as `apps/cli/tests/kk-collect.test.ts`.
 */
function childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    return env;
}

/**
 * Spawn a long-running server with its stdout+stderr captured to a readable log file — never
 * discarded. A server that exits before it listens is therefore diagnosable from the failure
 * message instead of a bare "Unable to connect".
 */
function spawnServer(name: string, label: string, args: string[], cwd: string): (typeof servers)[number] {
    const logFile = join(realTempDir(`kk-installed-${name}-`), 'server.log');
    const fd = openSync(logFile, 'a');
    const child = Bun.spawn({ cmd: args, cwd, stdout: fd, stderr: fd, env: childEnv() });
    children.push(child);
    const handle = { name, label, logFile, child };
    servers.push(handle);
    return handle;
}

/** The captured stdout+stderr of one server, trimmed for a failure message. */
function serverLog(server: { logFile: string }): string {
    if (!existsSync(server.logFile)) return '(no output captured)';
    return readFileSync(server.logFile, 'utf-8').trim() || '(no output captured)';
}

/**
 * Wait on a REAL readiness signal (the server answering `url`), not a fixed sleep. If the server
 * process exits first, fail immediately with its captured output as the cause.
 */
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

/** The installed package's module directory, relative to the throwaway project. */
function installedModuleDir(entry: string): string {
    return `node_modules/${INSTALLED}/dist/board/${entry}`;
}

/** Write the project config declaring the three modules against the installed package. */
function writeProjectConfig(): void {
    const lines = [
        '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
        'version: "1.2"',
        `name: ${PROJECT_NAME}`,
        'bootstrap:',
        '  database: { enabled: true, driver: bun-sqlite, url: .spur/spur.db }',
        '  scheduler: { enabled: false }',
        '  modules:',
    ];
    for (const module of MODULES) {
        lines.push(
            `    - id: ${module.id}`,
            `      name: ${module.name}`,
            `      icon: "${module.icon}"`,
            '      type: react',
            `      directory: ${installedModuleDir(module.entry)}`,
            '      entry: index.js',
            '      styles: [index.css]',
        );
    }
    mkdirSync(join(project, '.spur'), { recursive: true });
    writeFileSync(join(project, '.spur/config.yaml'), `${lines.join('\n')}\n`);
}

/** A minimal state machine named `name` with `states` onEnter shell actions each. */
function stateMachine(name: string, states: { id: string; actions: number }[]): string {
    const blocks = states.map((state) =>
        [
            `  - id: ${state.id}`,
            '    onEnter:',
            ...Array.from({ length: state.actions }, () => '      - { kind: shell, options: { command: "true" } }'),
        ].join('\n'),
    );
    const ids = [...states.map((state) => state.id), 'done'];
    const edges = ids
        .slice(0, -1)
        .map((id, index) => `  - { from: ${id}, to: ${ids[index + 1]}, guard: { kind: always } }`);
    return [
        '---',
        `name: ${name}`,
        'kind: state-machine',
        `initialState: ${states[0]?.id ?? 'done'}`,
        'terminalStates: [done]',
        'states:',
        ...blocks,
        '  - id: done',
        'transitions:',
        ...edges,
        '',
    ].join('\n');
}

/** Write the three workflow definitions so Settings discovery and `spur workflow run` both see them. */
function writeWorkflows(): void {
    const dir = join(project, '.spur/workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'kk-collect.yaml'),
        stateMachine('kk-collect', [
            { id: 'collect', actions: 2 },
            { id: 'store', actions: 1 },
            { id: 'label', actions: 1 },
        ]),
    );
    writeFileSync(
        join(dir, 'kk-daily-ai-voice2.yaml'),
        stateMachine('kk-daily-ai-voice2', [
            { id: 'generate', actions: 1 },
            { id: 'safety', actions: 1 },
        ]),
    );
    writeFileSync(join(dir, 'kk-itc.yaml'), stateMachine('kk-itc', [{ id: 'prepare', actions: 1 }]));
}

/** Execute one workflow in the fixture project under a deterministic run id. */
function runWorkflow(name: string, runId: string): void {
    spawnSpur(
        [
            '--no-logo',
            'workflow',
            'run',
            join(project, '.spur/workflows', `${name}.yaml`),
            '--run-id',
            runId,
            '--quiet',
        ],
        project,
    );
}

/** Capture one run's workspace + sanitized settings through the INSTALLED `kk board capture`. */
function capture(workflow: string, runId: string, workDir: string, stamp: string, settings: string[] = []): void {
    const args = [
        cliEntry,
        'board',
        'capture',
        '--workflow',
        workflow,
        '--run',
        runId,
        '--work-dir',
        workDir,
        '--stamp',
        stamp,
    ];
    for (const setting of settings) args.push('--setting', setting);
    shell(process.execPath, args, project);
}

/** Write the four allowlisted collect artifacts for one run workspace. */
function writeCollectArtifacts(workDirRel: string, stamp: string, variant: string): void {
    const dir = join(project, workDirRel);
    mkdirSync(join(dir, '10-ingest'), { recursive: true });
    mkdirSync(join(dir, '20-facts'), { recursive: true });
    writeFileSync(
        join(dir, '10-ingest', `${stamp}_02_collect_blended.json`),
        JSON.stringify([
            { id: `${variant}-1`, body: 'x', metadata: { sources: [{ file: 'aihot-ingest' }] } },
            { id: `${variant}-2`, body: 'y', metadata: { sources: [{ file: 'horizon-ingest' }] } },
        ]),
    );
    writeFileSync(join(dir, '20-facts', `${stamp}_02_collect_core-facts.md`), `# ${variant} facts\n- one\n`);
    writeFileSync(join(dir, 'store-result.json'), JSON.stringify({ inserted: 2, updated: 1, unchanged: 0 }));
    writeFileSync(
        join(dir, 'label-result.txt'),
        JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', labeled: 2, model: 1, fallback: 1 }),
    );
}

/**
 * Write the daily run's recorded safety judge verdict. The `confidence` is the HIGH/MEDIUM/LOW
 * vocabulary the reader must enforce (an out-of-vocabulary value must never be echoed).
 */
function writeDailyConfidence(workDirRel: string, stamp: string, confidence: unknown): void {
    const dir = join(project, workDirRel, '24-script');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${stamp}_09_safety-judge_verdict.json`), JSON.stringify({ verdict: 'PASS', confidence }));
}

/** Write the daily run's final audio so its byte ranges are servable. */
function writeDailyAudio(workDirRel: string, stamp: string): void {
    const dir = join(project, workDirRel, '30-audio');
    mkdirSync(dir, { recursive: true });
    // 64 deterministic bytes: a real media payload, not `String(bytes)`.
    const bytes = new Uint8Array(Array.from({ length: 64 }, (_, index) => (index * 3) % 256));
    writeFileSync(join(dir, `${stamp}_11_generate_content.mp3`), bytes);
}

/** Build the whole fixture: install, runs, captures, artifacts, servers, browser. */
async function setup(): Promise<void> {
    spur = resolveSpur();
    // 1. Pack the CLI exactly as an install would (the `prepack` hook builds the board assets too),
    //    then extract it into the throwaway project — never the source checkout.
    const packDir = realTempDir('kk-installed-pack-');
    // `bun pm pack --quiet` prints the absolute tarball path as its final stdout line (the preceding
    // lines are its `prepack` build log). The pack runs `prepack` -> build into the SHARED workspace
    // trees, so it is serialized against any other packer with `withBuildLock`.
    const tarball = (
        await withBuildLock(() => shell('bun', ['pm', 'pack', '--destination', packDir, '--quiet'], CLI_DIR))
    )
        .trim()
        .split('\n')
        .pop()
        ?.trim();
    if (tarball === undefined || !tarball.endsWith('.tgz') || !existsSync(tarball)) {
        throw new Error(`bun pm pack produced an unexpected artifact: ${tarball ?? '(none)'}`);
    }
    project = realTempDir('kk-installed-project-');
    installedPkg = join(project, 'node_modules', INSTALLED);
    mkdirSync(installedPkg, { recursive: true });
    shell('tar', ['-xzf', tarball, '-C', installedPkg, '--strip-components=1'], project);
    cliEntry = join(installedPkg, 'dist/index.js');
    if (!existsSync(cliEntry)) throw new Error(`the packed install does not carry the reader binary: ${cliEntry}`);
    for (const module of MODULES) {
        if (!existsSync(join(installedPkg, 'dist/board', module.entry, 'index.js'))) {
            throw new Error(`the packed install does not carry the ${module.entry} module`);
        }
    }

    // 2. Project config + workflow definitions.
    writeProjectConfig();
    writeWorkflows();

    // 3. Deterministic runs: two collect runs with different outputs, a same-workspace pair for
    //    supersession, a capture with no artifacts, and one daily run with final audio.
    for (const runId of ['r-a', 'r-b', 'r-sup-old', 'r-sup-new', 'r-empty']) runWorkflow('kk-collect', runId);
    runWorkflow('kk-daily-ai-voice2', 'd-audio');
    runWorkflow('kk-daily-ai-voice2', 'd-conf');

    // 4. Captures + hand-written artifacts (the installed capture seam writes the record + marker).
    capture('kk-collect', 'r-a', '.works/kk-collect/S1', 'S1', ['limit=10']);
    writeCollectArtifacts('.works/kk-collect/S1', 'S1', 'alpha');
    capture('kk-collect', 'r-b', '.works/kk-collect/S2', 'S2', ['limit=20']);
    writeCollectArtifacts('.works/kk-collect/S2', 'S2', 'beta');
    capture('kk-collect', 'r-sup-old', '.works/kk-collect/S3', 'S3', ['limit=7']);
    writeCollectArtifacts('.works/kk-collect/S3', 'S3', 'superseded');
    capture('kk-collect', 'r-sup-new', '.works/kk-collect/S3', 'S3');
    capture('kk-collect', 'r-empty', '.works/kk-collect/S4', 'S4');
    capture('kk-daily-ai-voice2', 'd-audio', '.works/kk-daily-ai-voice2/D1', 'D1', ['publish_enabled=true']);
    writeDailyAudio('.works/kk-daily-ai-voice2/D1', 'D1');
    writeDailyConfidence('.works/kk-daily-ai-voice2/D1', 'D1', 'HIGH');
    capture('kk-daily-ai-voice2', 'd-conf', '.works/kk-daily-ai-voice2/D2', 'D2');
    writeDailyConfidence('.works/kk-daily-ai-voice2/D2', 'D2', 'HIGH');

    // 5. The installed Board, then the reader bound to that exact origin.
    const boardPort = freePort();
    boardOrigin = `http://127.0.0.1:${boardPort}`;
    const boardServer = spawnServer(
        'board',
        'installed Board (spur serve)',
        [...spur, 'serve', '--port', String(boardPort), '--host', '127.0.0.1', '--no-open', '--cwd', project],
        project,
    );
    await waitFor(`${boardOrigin}/api/health`, boardServer);
    const readerPort = freePort();
    readerOrigin = `http://127.0.0.1:${readerPort}`;
    const readerServer = spawnServer(
        'reader',
        'installed reader (kk board serve)',
        [process.execPath, cliEntry, 'board', 'serve', '--board-origin', boardOrigin, '--port', String(readerPort)],
        project,
    );
    await waitFor(`${readerOrigin}/api/health`, readerServer);

    // 6. A real browser; a missing runtime fails the setup loudly.
    try {
        browser = await chromium.launch();
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Chromium is unavailable — run \`bunx playwright install chromium\`. Cause: ${cause}`);
    }
    page = await browser.newPage();
    page.setDefaultTimeout(15_000);
}

/** Open one module route (optionally with a query) and wait for its shell to mount. */
async function openModule(id: string, query = ''): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.goto(`${boardOrigin}/board/modules/${id}${query === '' ? '' : `?${query}`}`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.kk-board', { timeout: 15_000 });
}

/** Wait until the run selector carries an option for `runId` (options are never "visible"). */
async function waitForRunOption(runId: string): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.locator(`.kk-board-run-selector select option[value="${runId}"]`).first().waitFor({
        state: 'attached',
        timeout: 15_000,
    });
}

/** The deep-link query every module needs to reach the non-default reader port. */
function query(params: Record<string, string> = {}): string {
    return new URLSearchParams({ kkApi: readerOrigin, ...params }).toString();
}

/** A reader request carrying the correct Board origin header. */
function readerFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${readerOrigin}${path}`, {
        ...init,
        headers: { origin: boardOrigin, ...(init.headers as Record<string, string> | undefined) },
    });
}

/** The daily run's recorded safety confidence as the INSTALLED reader projects it. */
async function dailySafetyConfidence(runId: string): Promise<string | null> {
    const response = await readerFetch(`/api/workflows/kk-daily-ai-voice2/runs/${runId}/results`);
    expect(response.status, runId).toBe(200);
    const body = (await response.json()) as { summary: { safety: { confidence: string | null } | null } };
    return body.summary.safety?.confidence ?? null;
}

/** The value cell of one Summary fact, without its trailing availability word. */
async function factValue(label: string): Promise<string> {
    if (page === null) throw new Error('browser page not ready');
    const cell = page.locator('.kk-board-facts dt', { hasText: label }).first().locator('..').locator('dd');
    const text = (await cell.innerText()).trim();
    return text.replace(/\s+(available|pending|missing|invalid|oversized|superseded|unverified)$/, '').trim();
}

let ready = false;
beforeAll(async () => {
    await setup();
    ready = true;
}, 240_000);

afterAll(async () => {
    if (browser !== null) await browser.close();
    for (const child of children) child.kill();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('installed Board native modules (AC1/AC7)', () => {
    it('serves all three modules at distinct host routes', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        for (const module of MODULES) {
            await openModule(module.id, query());
            expect(await page.locator(`.kk-board-${module.entry}`).count(), module.id).toBe(1);
            const heading = await page.locator('h1').first().textContent();
            expect(heading?.trim(), module.id).toBe(module.name);
            // G81/0308: Collect ships five tabs (Overview, Run detail, Items, the two shipped ones);
            // Daily Voice and ITC keep their four.
            expect(await page.locator('.kk-board-tabs button').count(), module.id).toBe(
                module.id === 'kk-collect' ? 5 : 4,
            );
        }
    }, 30_000);

    it('serves module assets from the installed package, not the checkout', async () => {
        if (!ready) throw new Error('setup did not complete');
        for (const module of MODULES) {
            const response = await fetch(`${boardOrigin}/modules/${module.id}/index.js`);
            expect(response.status, module.id).toBe(200);
            const served = await response.text();
            const installed = readFileSync(join(installedPkg, 'dist/board', module.entry, 'index.js'), 'utf-8');
            // Byte-identical to the packed file: no source-checkout import can be satisfying this.
            expect(served, module.id).toBe(installed);
            expect(installed, module.id).toContain('webModule');
            expect(
                installed.split('\n').filter((line) => line.startsWith('import ')).length,
                module.id,
            ).toBeGreaterThan(0);
        }
    }, 30_000);
});

describe('run selection and deep links (AC2)', () => {
    it('restores a saved ?run=&tab= deep link and keeps both in the URL', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        // G81/0308 keeps shipped `?tab=results` links alive: the alias resolves to Run detail.
        await openModule('kk-collect', query({ run: 'r-b', tab: 'results' }));
        await waitForRunOption('r-b');
        expect(await page.locator('.kk-board-run-selector select').inputValue()).toBe('r-b');
        expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
            'Run detail',
        );
        const url = new URL(page.url());
        expect(url.searchParams.get('run')).toBe('r-b');
        expect(url.searchParams.get('tab')).toBe('summary');
        // §4: the validated reader origin is retained in the saved URL.
        expect(url.searchParams.get('kkApi')).toBe(readerOrigin);
    }, 30_000);

    it('retains the selected run across tab changes, a reload and back/forward', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await openModule('kk-collect', query({ run: 'r-b', tab: 'results' }));
        await waitForRunOption('r-b');
        // AC2 "across all tabs": visit every Collect tab, ending on progress for the reload below.
        for (const [tab, label] of [
            ['overview', 'Overview'],
            ['summary', 'Run detail'],
            ['items', 'Items'],
            ['config', 'Workflow Config Summary'],
            ['progress', 'Execution progress'],
        ] as const) {
            await page.locator('.kk-board-tabs').getByRole('button', { name: label, exact: true }).click();
            await page.waitForTimeout(200);
            expect(new URL(page.url()).searchParams.get('tab'), tab).toBe(tab);
            expect(new URL(page.url()).searchParams.get('run'), tab).toBe('r-b');
            expect(await page.locator('.kk-board-run-selector select').inputValue(), tab).toBe('r-b');
            expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
                label,
            );
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForRunOption('r-b');
        expect(await page.locator('.kk-board-run-selector select').inputValue()).toBe('r-b');
        expect(new URL(page.url()).searchParams.get('tab')).toBe('progress');
        // A browser back/forward must not lose the module's own run/tab selection.
        await page.goto(`${boardOrigin}/board`, { waitUntil: 'domcontentloaded' });
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.kk-board');
        expect(new URL(page.url()).searchParams.get('run')).toBe('r-b');
        expect(await page.locator('.kk-board-run-selector select').inputValue()).toBe('r-b');
    }, 30_000);
});

describe('explicit states (AC3)', () => {
    it('states "no runs recorded" when a workflow has none', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await openModule('kk-itc', query());
        await page.waitForTimeout(600);
        expect(await page.locator('.kk-board-empty').textContent()).toContain('No runs recorded for kk-itc');
    }, 30_000);

    it('marks a selected run with no artifacts as missing, never invented counts', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const results = (await (await readerFetch('/api/workflows/kk-collect/runs/r-empty/results')).json()) as {
            availability: string;
            summary: { inserted: unknown };
            artifacts: { availability: string }[];
        };
        expect(results.availability).toBe('missing');
        expect(results.summary.inserted).toBeNull();
        expect(results.artifacts.every((artifact) => artifact.availability === 'missing')).toBe(true);
        await openModule('kk-collect', query({ run: 'r-empty', tab: 'results' }));
        await page.waitForTimeout(800);
        expect(await page.locator('body').innerText()).toContain('missing');
    }, 30_000);
});

describe('workspace supersession and reader isolation (AC4/AC5)', () => {
    it('marks a superseded earlier run without impersonating later outputs', async () => {
        if (!ready) throw new Error('setup did not complete');
        const results = (await (await readerFetch('/api/workflows/kk-collect/runs/r-sup-old/results')).json()) as {
            availability: string;
            artifacts: { availability: string }[];
        };
        expect(results.availability).toBe('superseded');
        expect(results.artifacts.every((artifact) => artifact.availability === 'superseded')).toBe(true);
        // The recorded config survives even though the artifacts are superseded (AC4).
        const config = (await (await readerFetch('/api/workflows/kk-collect/runs/r-sup-old/config')).json()) as {
            settings: Record<string, string>;
        };
        expect(config.settings).toEqual({ limit: '7' });
    }, 30_000);

    it('refuses foreign origins, unlisted artifacts, traversal and cross-workflow reads', async () => {
        if (!ready) throw new Error('setup did not complete');
        expect((await readerFetch('/api/workflows/kk-collect/runs/r-a/results')).status).toBe(200);
        // A foreign Origin is refused (403); a non-loopback Host would be too.
        const foreign = await fetch(`${readerOrigin}/api/workflows/kk-collect/runs/r-a/results`, {
            headers: { origin: 'http://evil.example' },
        });
        expect(foreign.status).toBe(403);
        expect((await readerFetch('/api/workflows/kk-collect/runs/r-a/artifacts/not-listed')).status).toBe(404);
        expect(
            (
                await readerFetch(
                    `/api/workflows/kk-collect/runs/r-a/artifacts/${encodeURIComponent('../../etc/passwd')}`,
                )
            ).status,
        ).toBe(404);
        // An allowlisted artifact whose bytes are a symlink escaping the workspace is refused too:
        // a normal read succeeds, and the same id 404s once its file is an out-of-tree symlink.
        const facts = join(project, '.works/kk-collect/S1', '20-facts', 'S1_02_collect_core-facts.md');
        const originalFacts = readFileSync(facts);
        expect((await readerFetch('/api/workflows/kk-collect/runs/r-a/artifacts/facts')).status).toBe(200);
        rmSync(facts);
        symlinkSync('/etc/passwd', facts);
        try {
            expect((await readerFetch('/api/workflows/kk-collect/runs/r-a/artifacts/facts')).status).toBe(404);
        } finally {
            rmSync(facts);
            writeFileSync(facts, originalFacts);
        }
        // The daily run is not readable under the collect workflow.
        expect((await readerFetch('/api/workflows/kk-collect/runs/d-audio/results')).status).toBe(404);
    }, 30_000);
});

describe('truthful refresh, usability and media (AC6/AC7)', () => {
    it('keeps a truthful view when the reader is unavailable', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        // A closed loopback reader: the Board's own run history must still render, and the reader
        // panels must say so instead of blanking or inventing data.
        const dead = new URLSearchParams({ kkApi: `http://127.0.0.1:${deadPort()}` }).toString();
        await openModule('kk-collect', dead);
        await waitForRunOption('r-a');
        expect(await page.locator('.kk-board-run-selector select option').count()).toBeGreaterThan(1);
        await page.waitForSelector('.kk-board-diagnostic');
        expect((await page.locator('body').innerText()).toLowerCase()).toContain('unavailable');
    }, 30_000);

    it('is keyboard-usable at a narrow viewport', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await page.setViewportSize({ width: 480, height: 900 });
        try {
            await openModule('kk-collect', query({ run: 'r-a' }));
            expect(await page.locator('.kk-board-tabs').getAttribute('aria-label')).toBe('Collect tabs');
            const buttons = page.locator('.kk-board-tabs button');
            expect(await buttons.count()).toBe(5);
            await buttons.nth(3).focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
            expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
                'Execution progress',
            );
            // The run selector is a labelled control, not a bare widget.
            expect(await page.locator('.kk-board-run-selector').innerText()).toContain('Run');
        } finally {
            await page.setViewportSize({ width: 1280, height: 900 });
        }
    }, 30_000);

    it('serves audio byte ranges with a correct Content-Range', async () => {
        if (!ready) throw new Error('setup did not complete');
        const path = '/api/workflows/kk-daily-ai-voice2/runs/d-audio/artifacts/audio';
        const whole = await readerFetch(path);
        expect(whole.status).toBe(200);
        expect(whole.headers.get('content-type')).toBe('audio/mpeg');
        const ranged = await readerFetch(path, { headers: { range: 'bytes=0-3' } });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-3\/64$/);
        expect((await ranged.arrayBuffer()).byteLength).toBe(4);
        expect((await readerFetch(path, { headers: { range: 'bytes=9999-' } })).status).toBe(416);
    }, 30_000);
});

describe('settings and broken contributions (AC7/AC8)', () => {
    it('lists the three workflows once each under Settings → Workflows and links there from a module', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await page.goto(`${boardOrigin}/board/settings/workflows`, { waitUntil: 'domcontentloaded' });
        // The dropdown lists workflows only after the registry loads ("Loading registered
        // workflows…"), so wait for the kk entries to appear rather than reading an empty `<select>`.
        await page.waitForFunction(
            () => {
                const select = document.querySelector('select');
                if (select === null) return false;
                return Array.from(select.options).some((option) =>
                    option.textContent?.trim().startsWith('kk-collect '),
                );
            },
            undefined,
            { timeout: 15_000 },
        );
        const options = (await page.locator('select').first().locator('option').allTextContents()).map((text) =>
            text.trim(),
        );
        for (const module of MODULES) {
            expect(
                options.filter((text) => text.startsWith(`${module.id} `)),
                module.id,
            ).toHaveLength(1);
        }
        // The module keeps definitions in Settings rather than duplicating a viewer endpoint.
        await openModule('kk-collect', query({ run: 'r-a', tab: 'config' }));
        // `.kk-board` mounting is not the same event as the tab body rendering its link: under load the
        // bare `count()` read 0 in one of three full-gate runs (2026-10-12/13) while the link appeared a
        // moment later. Await the link the way the module's other selectors are awaited, then assert.
        const settingsLink = page.locator('a[href="/board/settings/workflows"]');
        await settingsLink.first().waitFor({ state: 'attached', timeout: 15_000 });
        expect(await settingsLink.count()).toBeGreaterThan(0);
    }, 30_000);

    it('keeps built-in Board navigation usable when a contribution fails', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const bundle = join(installedPkg, 'dist/board/collect/index.js');
        const original = readFileSync(bundle);
        writeFileSync(bundle, 'throw new Error("broken contribution");\n');
        try {
            // The broken entry never mounts `.kk-board`: the host must show its containment panel.
            await page.goto(`${boardOrigin}/board/modules/kk-collect?${query()}`, { waitUntil: 'domcontentloaded' });
            await page.getByText('could not be displayed').first().waitFor({ timeout: 15_000 });
            const text = await page.locator('body').innerText();
            expect(text).toContain('could not be displayed');
            expect(text).toContain('Other modules stay usable');
            // The host shell (and its navigation) survives the failed contribution.
            const board = await page.goto(`${boardOrigin}/board`, { waitUntil: 'domcontentloaded' });
            expect(board?.status()).toBe(200);
            const navLink = page.locator('a[href^="/board"]').first();
            await navLink.waitFor({ state: 'visible', timeout: 15_000 });
            expect(await page.locator('a[href^="/board"]').count()).toBeGreaterThan(0);
            // A sibling contribution still renders.
            await openModule('kk-itc', query());
            expect((await page.locator('h1').first().textContent())?.trim()).toBe('IT Content');
        } finally {
            writeFileSync(bundle, original);
        }
    }, 30_000);
});

describe('judge confidence vocabulary (AC3/AC7)', () => {
    it('accepts only HIGH/MEDIUM/LOW and reports anything else as an explicit unknown', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const verdict = join(project, '.works/kk-daily-ai-voice2/D2', '24-script', 'D2_09_safety-judge_verdict.json');
        // The three recognized levels round-trip through the installed reader unchanged.
        for (const level of ['HIGH', 'MEDIUM', 'LOW']) {
            writeFileSync(verdict, JSON.stringify({ verdict: 'PASS', confidence: level }));
            expect(await dailySafetyConfidence('d-conf'), level).toBe(level);
        }
        // An out-of-vocabulary or absent confidence is never echoed — it projects as null.
        for (const confidence of ['CERTAIN', 'high', 'HIGHEST', null, undefined]) {
            writeFileSync(
                verdict,
                JSON.stringify({ verdict: 'PASS', ...(confidence === undefined ? {} : { confidence }) }),
            );
            expect(await dailySafetyConfidence('d-conf'), String(confidence)).toBeNull();
        }
        // The installed module shows a recognized level, and states the invalid one explicitly.
        await openModule('kk-daily-ai-voice2', query({ run: 'd-audio', tab: 'summary' }));
        await page.waitForSelector('.kk-board-facts');
        expect(await factValue('Safety confidence')).toBe('HIGH');
        writeFileSync(verdict, JSON.stringify({ verdict: 'PASS', confidence: 'CERTAIN' }));
        await openModule('kk-daily-ai-voice2', query({ run: 'd-conf', tab: 'summary' }));
        await page.waitForSelector('.kk-board-facts');
        expect(await factValue('Safety confidence')).toBe('not recorded');
    }, 30_000);
});

/** An unused loopback port for the reader-outage scenario. */
function deadPort(): number {
    const port = freePort();
    return port;
}
