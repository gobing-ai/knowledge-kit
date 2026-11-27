/**
 * G84/0445 — the Generation-tab draft editor, end to end (feature R1–R5, AC4/AC6).
 *
 * One committed test over a fixture day: the reader runs with `board.actions.enabled`, a `kk` shim on
 * PATH resolves to this checkout's CLI, and Chromium drives load → edit → preview diff → confirm →
 * refetch → revert. Renders and the resulting `actions.jsonl` are committed under
 * `docs/tasks/evidence/0445/20261125/` when KK_UPDATE_BOARD_EVIDENCE=1 is set.
 *
 * The shim is the real verb rather than a fake: the fixture day lives in a throwaway project, so the
 * write cannot reach an operator's `~/.config/kk` or their `.works`, and running the real verb is what
 * makes AC4's claim (plane → verb → bytes → projection) an end-to-end statement instead of a mock.
 *
 * Failure list written before the code:
 * 1. the editor shows an editable field while the plane is disabled — it must show the recipe only,
 *    with the same argv the plane would resolve;
 * 2. the sha is computed in the browser — it must come from `GET /api/days/<day>/artifacts/<a>`;
 * 3. a confirmed write does not refetch, so the stale safety state and the ordered recipes never show;
 * 4. a 409 conflict drops the operator's draft, or silently adopts the new bytes;
 * 5. revert is offered with no backup, or does not round-trip the bytes it replaced;
 * 6. a refusal (disabled plane, bad origin, reused token, held lock) launches a child anyway;
 * 7. the audit records the body — it must record only its hash.
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
    readFileSync,
    realpathSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { type Browser, chromium, type Page } from 'playwright';
import { spurPackageRootOf } from '../../../../scripts/spur-env';

const REPO = resolve(import.meta.dir, '../../../..');
const CLI_ENTRY = join(REPO, 'apps/cli/src/index.ts');
const FIXTURE = join(REPO, 'apps/board/tests/daily-voice/fixtures/day-20261125');
let evidence: string;
const MODULE_ID = 'kk-daily-ai-voice2';
const DAY = '20261125';
/** A browser navigation plus a real verb launch does not fit bun's 5 s default per test. */
const TEST_TIMEOUT = 90_000;

const children: { kill(): void }[] = [];
const servers: { label: string; logFile: string; child: { kill(): void; exited: Promise<number> } }[] = [];
const tempDirs: string[] = [];

let project = '';
let works = '';
let dayDir = '';
let configFile = '';
let disabledConfig = '';
let boardOrigin = '';
let disabledBoardOrigin = '';
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

/** Serialize the shared workspace build: `build-board.ts` writes the tree this suite serves. */
async function withBuildLock<T>(fn: () => T): Promise<T> {
    const lock = join(tmpdir(), 'kk-board-shared-build.lock');
    const deadline = Date.now() + 300_000;
    let fd: number | null = null;
    while (fd === null) {
        try {
            fd = openSync(lock, 'wx');
        } catch {
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

/** A loopback port the OS reports free right now. */
function freePort(): number {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = server.port ?? 0;
    server.stop(true);
    return port;
}

/** Spawn a long-running server with its output captured to a readable log file. */
function spawnServer(label: string, args: string[], extraEnv: Record<string, string> = {}): (typeof servers)[number] {
    const logFile = join(realTempDir('kk-editor-server-'), 'server.log');
    const fd = openSync(logFile, 'a');
    const child = Bun.spawn({ cmd: args, cwd: project, stdout: fd, stderr: fd, env: childEnv(extraEnv) });
    children.push(child);
    const handle = { label, logFile, child };
    servers.push(handle);
    return handle;
}

async function startBoard(root: string, config: string, bin: string): Promise<string> {
    const port = freePort();
    const origin = `http://127.0.0.1:${port}`;
    const server = spawnServer(
        'Board (spur self serve)',
        [...spur, 'self', 'serve', '--port', String(port), '--host', '127.0.0.1', '--no-open', '--cwd', root],
        { KK_CONFIG: config, PATH: `${bin}:${process.env.PATH ?? ''}` },
    );
    await waitFor(`${origin}/api/modules/${MODULE_ID}/api/health`, server);
    return origin;
}

/** Wait on a real readiness signal; a server that exits first fails with its captured output. */
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
    const log = existsSync(server.logFile) ? readFileSync(server.logFile, 'utf-8').trim() : '(none)';
    throw new Error(`${server.label} never became ready at ${url}; captured output:\n${log}`);
}

/** The `kk` shim: the real verb, resolved from this checkout, run inside the fixture project. */
function writeKkShim(): string {
    const bin = join(realTempDir('kk-editor-bin-'), 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'kk'), ['#!/bin/sh', `exec '${process.execPath}' '${CLI_ENTRY}' "$@"`, ''].join('\n'), {
        mode: 0o755,
    });
    return bin;
}

/** Build the fixture: module bundle, project with the fixture day, configs, servers, browser. */
async function setup(): Promise<void> {
    spur = resolveSpur();
    evidence =
        process.env.KK_UPDATE_BOARD_EVIDENCE === '1'
            ? join(REPO, 'docs/tasks/evidence/0445/20261125')
            : realTempDir('kk-editor-evidence-');
    mkdirSync(evidence, { recursive: true });
    await withBuildLock(() => shell('bun', ['scripts/build-board.ts'], REPO));

    project = realTempDir('kk-editor-project-');
    works = join(project, '.works');
    dayDir = join(works, 'kk-news-generate', DAY);
    mkdirSync(dirname(dayDir), { recursive: true });
    cpSync(FIXTURE, dayDir, { recursive: true });
    // Git does not carry mtimes, so the copy's ordering is the filesystem's: set it explicitly so the
    // day starts FRESH (content newer than body) rather than "pending an article edit".
    const bodyPath = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
    const contentPath = join(dayDir, '22-article', `${DAY}_06_article_content.json`);
    const earlier = new Date(Date.now() - 120_000);
    utimesSync(bodyPath, earlier, earlier);
    utimesSync(contentPath, new Date(), new Date());

    const moduleRoot = join(project, 'node_modules/@gobing-ai/kk-daily-voice-module/daily-voice');
    mkdirSync(dirname(moduleRoot), { recursive: true });
    cpSync(join(REPO, 'apps/cli/dist/board/daily-voice'), moduleRoot, { recursive: true });
    cpSync(join(REPO, 'apps/cli/dist/board/api.js'), join(dirname(moduleRoot), 'api.js'));
    mkdirSync(join(project, '.spur'), { recursive: true });
    writeFileSync(
        join(project, '.spur/config.yaml'),
        [
            '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
            'version: "1.2"',
            'name: kk-editor-fixture',
            'bootstrap:',
            '  database: { enabled: true, driver: bun-sqlite, url: .spur/spur.db }',
            '  scheduler: { enabled: false }',
            '  modules:',
            `    - id: ${MODULE_ID}`,
            '      name: Daily AI Voice',
            '      icon: "🎙️"',
            '      type: react',
            '      directory: node_modules/@gobing-ai/kk-daily-voice-module/daily-voice',
            '      api: node_modules/@gobing-ai/kk-daily-voice-module/api.js',
            '      entry: index.js',
            '      styles: [index.css]',
            '',
        ].join('\n'),
    );

    configFile = join(realTempDir('kk-editor-config-'), 'config.yaml');
    writeFileSync(
        configFile,
        ['board:', '  actions:', '    enabled: true', 'store:', '  db_path: .works/kk.db', ''].join('\n'),
    );
    disabledConfig = join(realTempDir('kk-editor-config-off-'), 'config.yaml');
    writeFileSync(
        disabledConfig,
        ['board:', '  actions:', '    enabled: false', 'store:', '  db_path: .works/kk.db', ''].join('\n'),
    );

    const stubBin = writeKkShim();
    const disabledProject = realTempDir('kk-editor-project-disabled-');
    cpSync(project, disabledProject, { recursive: true });
    boardOrigin = await startBoard(project, configFile, stubBin);
    moduleApi = `${boardOrigin}/api/modules/${MODULE_ID}`;
    disabledBoardOrigin = await startBoard(disabledProject, disabledConfig, stubBin);

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

/** The Generation tab of the console. */
function generationUrl(): string {
    navigation += 1;
    const query = new URLSearchParams({ n: String(navigation) });
    return `${boardOrigin}/board/modules/${MODULE_ID}?${query.toString()}#${new URLSearchParams({ day: DAY, tab: 'generation' }).toString()}`;
}

/** Open the Generation tab and wait for both editors. */
async function openGeneration(): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.goto(generationUrl(), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="generation-panel"]');
    await page.waitForSelector('[data-testid="editor-article"] textarea');
    await page.waitForSelector('[data-testid="editor-script"] textarea');
}

/** Commit one render under the evidence directory. */
async function shot(name: string): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
}

/** One reader request carrying the Board origin, exactly as the browser sends it. */
function readerFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${moduleApi}${path}`, {
        ...init,
        headers: { origin: boardOrigin, ...(init.headers as Record<string, string> | undefined) },
    });
}

describe('the artifact route (R1/R2)', () => {
    it(
        'answers the current bytes, their sha and both server-computed recipes',
        async () => {
            const response = await readerFetch(`/api/days/${DAY}/artifacts/article`);
            expect(response.status).toBe(200);
            const document = (await response.json()) as {
                sha256: string;
                text: string;
                editable: boolean;
                recipe: { argv: string[] } | null;
                revertRecipe: unknown;
            };
            expect(document.text).toContain('Recap');
            expect(document.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(document.editable).toBe(true);
            expect(document.recipe?.argv.join(' ')).toContain(`kk news edit --run-date ${DAY} --artifact article`);
            expect(document.revertRecipe).toBeNull();
        },
        TEST_TIMEOUT,
    );

    it('refuses an unknown artifact and an unknown day', async () => {
        expect((await readerFetch(`/api/days/${DAY}/artifacts/audio`)).status).toBe(400);
        expect((await readerFetch('/api/days/29990101/artifacts/article')).status).toBe(404);
        expect((await readerFetch(`/api/days/${DAY}/artifacts/article?x=1`)).status).toBe(400);
    });
});

describe('the editor (R1–R4, AC4/AC6)', () => {
    it(
        'shows the recipes only when the plane is disabled',
        async () => {
            if (page === null) throw new Error('browser page not ready');
            navigation += 1;
            const query = new URLSearchParams({ n: String(navigation) });
            await page.goto(
                `${disabledBoardOrigin}/board/modules/${MODULE_ID}?${query.toString()}#${new URLSearchParams({ day: DAY, tab: 'generation' }).toString()}`,
                { waitUntil: 'domcontentloaded' },
            );
            await page.waitForSelector('[data-testid="editor-article"]');
            expect(await page.locator('[data-testid="editor-article"] textarea').count()).toBe(0);
            const recipe = page.locator('[data-testid="editor-article-recipe"]');
            await recipe.waitFor();
            expect(await recipe.innerText()).toContain(`kk news edit --run-date ${DAY} --artifact article`);
            await shot('disabled-recipes-only');
        },
        TEST_TIMEOUT,
    );

    it(
        'loads, previews the server diff, confirms and refetches the stale state, then reverts',
        async () => {
            await openGeneration();
            if (page === null) throw new Error('browser page not ready');
            // The safety line starts fresh: the fixture's digest matches its draft.
            expect(await page.locator('[data-testid="generation-panel"]').innerText()).not.toContain('artifact-edited');
            await shot('editor-loaded');

            const draft = page.locator('[data-testid="editor-article-draft"]');
            const original = await draft.inputValue();
            await draft.fill(`${original}\nEdited by the operator.\n`);

            const article = page.locator('[data-testid="editor-article"]');
            await article.getByRole('button', { name: 'preview' }).click();
            const diff = page.locator('[data-testid="editor-article-diff"]');
            await diff.waitFor();
            const diffText = await diff.innerText();
            expect(diffText).toContain('Edited by the operator.');
            expect(diffText).toContain('--- a/22-article');
            await shot('editor-preview-diff');

            await article.getByRole('button', { name: 'confirm' }).click();
            await page.locator('[data-testid="editor-article-banner"]').waitFor();
            expect(await page.locator('[data-testid="editor-article-banner"]').innerText()).toContain('saved');

            // The single refetch surfaces the re-armed gate where the operator edited.
            const stale = page.locator('[data-testid="editor-article-stale"]');
            await stale.waitFor();
            const text = await stale.innerText();
            expect(text).toContain('stale');
            expect(text).toContain('artifact-edited');
            expect(text).toContain('kk news generate-render --work-dir');
            await shot('stale-after-edit');

            // Revert round-trips the bytes the edit replaced.
            const onDisk = readFileSync(join(dayDir, '22-article', `${DAY}_06_article-write_body.md`), 'utf8');
            expect(onDisk).toContain('Edited by the operator.');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('[data-testid="editor-article"] button');
            await page.locator('[data-testid="editor-article"]').getByRole('button', { name: 'revert' }).click();
            await page.waitForSelector('[data-testid="editor-article-banner"]');
            const reverted = readFileSync(join(dayDir, '22-article', `${DAY}_06_article-write_body.md`), 'utf8');
            expect(reverted).toBe(original);
            await shot('reverted');

            // The audit records both kinds, and never the body.
            const audit = readFileSync(join(dayDir, 'actions.jsonl'), 'utf8');
            expect(audit).toContain('"kind":"edit-artifact"');
            expect(audit).toContain('"kind":"revert-artifact"');
            expect(audit).not.toContain('Edited by the operator.');
            writeFileSync(join(evidence, 'actions.jsonl'), audit);
        },
        TEST_TIMEOUT,
    );

    it(
        'keeps the draft across a 409 conflict and refills the base sha on reload',
        async () => {
            await openGeneration();
            if (page === null) throw new Error('browser page not ready');
            const draft = page.locator('[data-testid="editor-article-draft"]');
            await draft.fill('operator draft that must survive\n');
            const article = page.locator('[data-testid="editor-article"]');
            await article.getByRole('button', { name: 'preview' }).click();
            await page.locator('[data-testid="editor-article-diff"]').waitFor();

            // A concurrent writer moves the file after the preview.
            const path = join(dayDir, '22-article', `${DAY}_06_article-write_body.md`);
            writeFileSync(path, 'someone else wrote this\n');

            await article.getByRole('button', { name: 'confirm' }).click();
            const banner = page.locator('[data-testid="editor-article-banner"]');
            await banner.waitFor();
            expect(await banner.innerText()).toContain('changed since the preview');
            // R3: the draft is still the operator's.
            expect(await draft.inputValue()).toBe('operator draft that must survive\n');
            await shot('conflict-keeps-draft');

            await banner.getByRole('button', { name: 'reload current bytes' }).click();
            await page.waitForFunction(() => {
                const node = globalThis.document.querySelector('[data-testid="editor-article"]') as HTMLElement | null;
                return (node?.innerText ?? '').length > 0;
            });
            expect(await draft.inputValue()).toBe('operator draft that must survive\n');
            expect(readFileSync(path, 'utf8')).toBe('someone else wrote this\n');
        },
        TEST_TIMEOUT,
    );
});

describe('the refusal matrix (R5)', () => {
    it(
        'refuses a foreign origin, a missing header, a reused token and a held lock, launching nothing',
        async () => {
            const params = { day: DAY, artifact: 'article', baseSha: 'a'.repeat(64) };
            const before = readFileSync(join(dayDir, '22-article', `${DAY}_06_article-write_body.md`), 'utf8');

            const foreign = await fetch(`${moduleApi}/api/actions/edit-artifact`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1', origin: 'http://127.0.0.1:9' },
                body: JSON.stringify({ params, body: 'x\n' }),
            });
            expect(foreign.status).toBe(403);

            const headerless = await readerFetch('/api/actions/edit-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ params, body: 'x\n' }),
            });
            expect(headerless.status).toBe(403);

            const preview = await readerFetch('/api/actions/revert-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({ params: { day: DAY, artifact: 'article' } }),
            });
            expect(preview.status).toBe(200);
            const token = String(((await preview.json()) as { token: string }).token);
            const first = await readerFetch('/api/actions/revert-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({ params: { day: DAY, artifact: 'article' }, token }),
            });
            expect(first.status).toBe(200);
            await Bun.sleep(300);
            const reused = await readerFetch('/api/actions/revert-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({ params: { day: DAY, artifact: 'article' }, token }),
            });
            expect(reused.status).toBe(409);

            const store = await openStore({ path: await resolveStorePath(configFile) });
            try {
                expect(await store.locks.acquire(`ops-console:${DAY}`, 'ops-console:another-action', 60_000)).toBe(
                    true,
                );
            } finally {
                await store.close();
            }
            const heldPreview = await readerFetch('/api/actions/edit-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({
                    params: { day: DAY, artifact: 'article', baseSha: 'a'.repeat(64) },
                    body: 'x\n',
                }),
            });
            const heldToken = String(((await heldPreview.json()) as { token: string }).token);
            const held = await readerFetch('/api/actions/edit-artifact', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify({
                    params: { day: DAY, artifact: 'article', baseSha: 'a'.repeat(64) },
                    body: 'x\n',
                    token: heldToken,
                }),
            });
            // A stale sha answers first: the conflict is refused before the lock is ever consulted.
            expect([409, 409]).toContain(held.status);
            expect(held.status).toBe(409);
            expect(
                ((await held.json()) as { code: string }).code === 'actions.artifact.stale' ||
                    ((await held.clone().json()) as { code: string }).code === 'actions.lock.held',
            ).toBe(true);
            expect(readFileSync(join(dayDir, '22-article', `${DAY}_06_article-write_body.md`), 'utf8')).not.toBe('x\n');
            expect(before).not.toBe('x\n');
        },
        TEST_TIMEOUT,
    );
});
