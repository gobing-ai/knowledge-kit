/**
 * G81/0309 R3 — the operator-run live check of the Collect module's store views.
 *
 * Design: `docs/design/collect-store-views.md` §5, refined 2026-10-16: read the live store IN PLACE
 * (never a copy) and prove it read-only with before/after digests.
 *
 * The CHECKED PROJECT (`--project`, default the invocation directory) is the real checkout:
 *   <project>/.works/kk.db   the kk store, which the installed reader opens in place (read-only)
 *   <project>/.spur/spur.db  Spur run history: read for the run ids and for the Board's run list
 * The installed reader runs with cwd = <project>, so every store projection the browser asserts on
 * comes from the real store file. Its content sha256 AND its `sqlite_master` + per-table row counts
 * are captured before and after the browser run; any difference exits non-zero.
 *
 * Two walls make a `spur serve --cwd <checkout>` impossible here, both verified 2026-10-17: the
 * operator's own Board owns the checkout ("Project already has a server owner (pid …)"), and the
 * reader refuses any Board whose `/api/project` path differs from its own project path (403
 * `board.project.mismatch`). So the BOARD and the reader share a throwaway project: it holds the CLI
 * tarball packed from THIS worktree (`prepack` builds the board assets, so the browser exercises
 * 0307/0308 code), a copy of the Spur plane (a `spur serve` writes to its database), and — never a
 * copy — a SYMLINK to the live store (and to its `-wal`, so the projections see the live snapshot).
 * The reader therefore opens this checkout's real store file, and both its content sha256 (`db` and
 * `wal`) and its `sqlite_master` + per-table row counts are compared before and after.
 *
 * Chromium then visits Overview, Run detail and Items for one run that HAS a store row and one that
 * has none, writing `<project>/.works/.board/verify/<stamp>/report.json` plus one screenshot per tab.
 *
 * Usage (from the checkout being checked, or with --project pointing at it):
 *   bun <repo>/apps/board/scripts/verify-collect-live.ts --project /path/to/checkout
 */
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const REPO = resolve(import.meta.dir, '../../..');
const CLI_DIR = join(REPO, 'apps/cli');
const INSTALLED = '@gobing-ai/knowledge-kit';
const WORKFLOW = 'kk-collect';
/** The four tables the store views read; one row count each is the digest's data half. */
const TABLES = ['collect_runs', 'items', 'labels', 'selections'] as const;
/** The confidence levels the Run detail label-quality histogram reports (design §2). */
const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** Where the check reads from and writes to. */
interface Paths {
    project: string;
    /** The real kk store the reader opens IN PLACE (never copied, never opened for write). */
    store: string;
    /** The real Spur run history: run ids are read from it, and the Board's copy derives from it. */
    spurDb: string;
    /** The artifact directory (`report.json` + one screenshot per tab). */
    out: string;
}

/** The store fingerprint: schema + row counts, never the file bytes (a WAL tick is not a write). */
interface Digest {
    sqliteMasterSha256: string;
    tables: Record<string, number>;
}

/** One tab's outcome. */
interface TabResult {
    runId: string | null;
    tab: string;
    pass: boolean;
    detail: string;
    screenshot: string;
}

/** One browser console error (or uncaught page error): its resource URL and HTTP status, if any. */
interface ConsoleError {
    text: string;
    url: string | null;
    status: number | null;
}

/** The two shipped reader routes that answer 404 when a run has no capture record (design §3). */
const CAPTURE_ROUTE = /\/api\/workflows\/kk-collect\/runs\/[^/]+\/(results|config)$/;

/**
 * The ONE expected miss: a 404 from `results` or `config`. Neither checkout holds a capture record
 * for these real runs (a record names the absolute project it was taken in), so those two shipped
 * endpoints 404 in place as well — while the store views under test need no capture at all. Any
 * other status, route or page error is a failure.
 */
function expectedReaderMiss(error: ConsoleError): boolean {
    return error.status === 404 && error.url !== null && CAPTURE_ROUTE.test(error.url);
}

/** One long-running server the check owns. */
interface Server {
    name: string;
    logFile: string;
    child: { kill(): void; exited: Promise<number> };
}

function argValue(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? undefined : process.argv[index + 1];
}

function resolvePaths(): Paths {
    const project = resolve(argValue('project') ?? process.cwd());
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    return {
        project,
        store: resolve(argValue('store') ?? join(project, '.works/kk.db')),
        spurDb: resolve(argValue('spur-db') ?? join(project, '.spur/spur.db')),
        out: resolve(argValue('out') ?? join(project, '.works/.board/verify', stamp)),
    };
}

/** Child environment for every spawned CLI/server: drop the nested-workflow-run guard. */
function childEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    return env;
}

/** Hex sha256 of a file, streamed (the Spur plane is multiple GB). */
async function sha256File(path: string): Promise<string> {
    const hasher = new Bun.CryptoHasher('sha256');
    for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
    return hasher.digest('hex');
}

/** One store file's sha256 and byte size (size is what distinguishes a checkpoint from a write). */
interface StoreFilePrint {
    sha256: string;
    bytes: number;
}

/** The store file (and its WAL when present) as sha256 + size — a content fingerprint, not just counts. */
export interface StoreFilePrints {
    db: StoreFilePrint;
    wal: StoreFilePrint | null;
}

function printOf(path: string): StoreFilePrint {
    const bytes = readFileSync(path);
    return { sha256: Bun.CryptoHasher.hash('sha256', bytes, 'hex'), bytes: bytes.byteLength };
}

export function storeFiles(path: string): StoreFilePrints {
    const walPath = `${path}-wal`;
    return { db: printOf(path), wal: existsSync(walPath) ? printOf(walPath) : null };
}

/**
 * What a before/after file pair means.
 *
 * SQLite folds the WAL back into the main file when the last connection closes, so a read-only
 * reader can still move bytes: the db grows and the WAL shrinks or vanishes. That is a
 * **checkpoint**, not a collect tick — classifying it as drift reported a misleading FAIL
 * (G81 / task 0313). Anything else that changes content without a matching schema/count change is
 * real, unexplained drift and stays a failure.
 */
export function classifyStoreChange(
    before: StoreFilePrints,
    after: StoreFilePrints,
    digestIdentical: boolean,
): { identical: boolean; checkpointed: boolean; reason: string | null } {
    const identical = before.db.sha256 === after.db.sha256 && before.wal?.sha256 === after.wal?.sha256;
    if (identical) return { identical: true, checkpointed: false, reason: null };
    const walFolded = after.wal === null || after.wal.bytes === 0;
    const dbGrew = after.db.bytes > before.db.bytes;
    if (walFolded && dbGrew && digestIdentical) {
        return {
            identical: false,
            checkpointed: true,
            reason: `WAL checkpointed into the store (db ${before.db.bytes} → ${after.db.bytes} bytes, WAL emptied); rows, schema and journal unchanged`,
        };
    }
    return {
        identical: false,
        checkpointed: false,
        reason: 'store content changed without a matching schema/count change',
    };
}

/** The store's schema fingerprint plus its four store-view row counts, read-only. */
function digest(path: string): Digest {
    const db = new Database(path, { readonly: true });
    try {
        const master = db.query('SELECT type, name, sql FROM sqlite_master ORDER BY name').all();
        const hasher = new Bun.CryptoHasher('sha256');
        hasher.update(JSON.stringify(master));
        const tables: Record<string, number> = {};
        for (const table of TABLES) {
            const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | null;
            tables[table] = row?.n ?? 0;
        }
        return { sqliteMasterSha256: hasher.digest('hex'), tables };
    } finally {
        db.close();
    }
}

/** Every kk-collect run in the Spur plane, newest first — the source for a run the page omits. */
function spurRuns(path: string): BoardRun[] {
    const db = new Database(path, { readonly: true });
    try {
        return db
            .query("SELECT id, status FROM runs WHERE workflow_name = 'kk-collect' ORDER BY started_at DESC")
            .all() as BoardRun[];
    } finally {
        db.close();
    }
}

/** One run as the Board's own run list reports it. */
interface BoardRun {
    id: string;
    status: string;
}

/**
 * The Overview page the browser renders: the Board's own first 25 `kk-collect` runs. Choosing the
 * checked runs from anything else risks naming a run the page (and its selector) never shows.
 */
async function boardRunPage(origin: string): Promise<BoardRun[]> {
    const params = new URLSearchParams({ workflow: WORKFLOW, limit: '25' });
    const response = await fetch(`${origin}/api/runs?${params.toString()}`);
    if (!response.ok) throw new Error(`the Board refused its own run list (${response.status})`);
    const body = (await response.json()) as { runs?: unknown };
    const runs = Array.isArray(body.runs) ? body.runs : [];
    return runs.flatMap((entry: unknown) => {
        const run = entry as { id?: unknown; status?: unknown };
        return typeof run.id === 'string' && typeof run.status === 'string' ? [{ id: run.id, status: run.status }] : [];
    });
}

/** The store's `collect_runs.run_id` set — the runs that reached the `store` state. */
function storedRunIds(path: string): Set<string> {
    const db = new Database(path, { readonly: true });
    try {
        const rows = db.query('SELECT run_id AS id FROM collect_runs').all() as { id: string }[];
        return new Set(rows.map((row) => row.id));
    } finally {
        db.close();
    }
}

/**
 * One run that HAS a store row and one that has none (a tick that never reached `store`).
 *
 * The stored run must be on the rendered page (the Overview table only shows that page); the run
 * with no row may be older than the page — its Run detail and Items tabs are reached by deep link,
 * which is how an operator inspects a failed tick the table has scrolled past.
 */
function pickRunIds(
    page: readonly BoardRun[],
    history: readonly BoardRun[],
    stored: ReadonlySet<string>,
): { withStore: string; withoutStore: string } {
    const withStore = page.find((run) => stored.has(run.id))?.id;
    // A running tick without a row renders `in progress`, not `no store row`: prefer a finished one.
    const withoutStore = history.find((run) => !stored.has(run.id) && run.status !== 'running')?.id;
    if (withStore === undefined || withoutStore === undefined) {
        throw new Error(
            `no checkable pair: ${page.length} ${WORKFLOW} runs on the page, ${history.length} in the history, ` +
                `${stored.size} store rows. Run at least one collection of each kind.`,
        );
    }
    return { withStore, withoutStore };
}

/** Write the scratch project's config: the Board plus the one module this check drives. */
function writeConfig(project: string): void {
    const config = [
        '$schema: "@gobing-ai/spur/schemas/spur-config.schema.json"',
        'version: "1.2"',
        'name: kk-verify-collect-live',
        'bootstrap:',
        '  database: { enabled: true, driver: bun-sqlite, url: .spur/spur.db }',
        '  scheduler: { enabled: false }',
        '  modules:',
        `    - id: ${WORKFLOW}`,
        '      name: Collect',
        '      icon: "📥"',
        '      type: react',
        `      directory: node_modules/${INSTALLED}/dist/board/collect`,
        '      entry: index.js',
        '      styles: [index.css]',
        '',
    ].join('\n');
    mkdirSync(join(project, '.spur'), { recursive: true });
    writeFileSync(join(project, '.spur/config.yaml'), config);
}

/**
 * The throwaway project the BOARD and the reader share (see the header for the two walls that rule
 * out serving the checkout directly). The store is LINKED, never copied: the reader opens the real
 * file, so the digests observe the live store. Its `-wal` is linked too — a WAL-mode store keeps the
 * newest committed rows there, and only a db path beside it can see them; SQLite rebuilds a fresh
 * `-shm` in this directory and pure reads never append to the WAL, which the before/after digests
 * would catch anyway. The Spur plane IS copied: a `spur serve` writes to its own database.
 */
function boardProject(paths: Paths): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-verify-collect-board-'));
    mkdirSync(join(dir, '.works'), { recursive: true });
    mkdirSync(join(dir, '.spur'), { recursive: true });
    const link = join(dir, '.works/kk.db');
    symlinkSync(paths.store, link);
    if (existsSync(`${paths.store}-wal`)) symlinkSync(`${paths.store}-wal`, `${link}-wal`);
    const spurCopy = join(dir, '.spur/spur.db');
    copyFileSync(paths.spurDb, spurCopy);
    // Committed rows may still live in the WAL; copying the main file alone would lose them.
    if (existsSync(`${paths.spurDb}-wal`)) copyFileSync(`${paths.spurDb}-wal`, `${spurCopy}-wal`);
    writeConfig(dir);
    return dir;
}

/** Pack the CLI as an install would (`prepack` builds the board assets) and extract it. */
function packAndInstall(project: string): string {
    const packDir = mkdtempSync(join(tmpdir(), 'kk-verify-pack-'));
    try {
        const packed = spawnSync('bun', ['pm', 'pack', '--destination', packDir, '--quiet'], {
            cwd: CLI_DIR,
            encoding: 'utf-8',
            env: childEnv(),
            maxBuffer: 64 * 1024 * 1024,
        });
        if (packed.status !== 0) {
            throw new Error(`bun pm pack failed (${packed.status}): ${packed.stderr || packed.stdout}`);
        }
        const tarball = packed.stdout.trim().split('\n').pop()?.trim();
        if (tarball === undefined || !tarball.endsWith('.tgz')) {
            throw new Error(`bun pm pack produced an unexpected artifact: ${tarball ?? '(none)'}`);
        }
        const installedPkg = join(project, 'node_modules', INSTALLED);
        mkdirSync(installedPkg, { recursive: true });
        const untarred = spawnSync('tar', ['-xzf', tarball, '-C', installedPkg, '--strip-components=1'], {
            encoding: 'utf-8',
        });
        if (untarred.status !== 0) throw new Error(`tar failed (${untarred.status}): ${untarred.stderr}`);
        const entry = join(installedPkg, 'dist/index.js');
        if (!existsSync(entry)) throw new Error(`the packed install does not carry the reader binary: ${entry}`);
        if (!existsSync(join(installedPkg, 'dist/board/collect/index.js'))) {
            throw new Error('the packed install does not carry the collect module');
        }
        return entry;
    } finally {
        rmSync(packDir, { recursive: true, force: true });
    }
}

/** A loopback port the OS reports free right now. */
function freePort(): number {
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = server.port ?? 0;
    server.stop(true);
    return port;
}

/** Spawn a long-running server with its output captured into the artifact directory. */
function spawnServer(name: string, args: string[], cwd: string, out: string): Server {
    const logFile = join(out, `server-${name}.log`);
    const fd = openSync(logFile, 'a');
    const child = Bun.spawn({ cmd: args, cwd, stdout: fd, stderr: fd, env: childEnv() });
    return { name, logFile, child };
}

/** Wait on a real readiness signal (the server answering `url`), failing with its captured log. */
async function waitFor(url: string, server: Server, timeoutMs = 60_000): Promise<void> {
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
    const log = existsSync(server.logFile) ? readFileSync(server.logFile, 'utf-8').trim() : '(no output)';
    throw new Error(`${server.name} never became ready at ${url}; captured output:\n${log}`);
}

/** The Overview table row for one run id. */
function overviewRow(page: Page, runId: string) {
    return page
        .locator('.kk-collect-table tbody tr')
        .filter({ has: page.locator('.kk-collect-run-link', { hasText: new RegExp(`^${runId}$`) }) });
}

/** One tab visit: navigate, let the reader answer, assert, screenshot. */
async function visit(
    page: Page,
    origin: string,
    readerOrigin: string,
    out: string,
    tab: string,
    runId: string | null,
    assert: () => Promise<string>,
): Promise<TabResult> {
    const params = new URLSearchParams({ kkApi: readerOrigin, tab, ...(runId === null ? {} : { run: runId }) });
    const screenshot = join(out, `${runId ?? 'overview'}-${tab}.png`);
    const result: TabResult = { runId, tab, pass: false, detail: '', screenshot };
    try {
        await page.goto(`${origin}/board/modules/${WORKFLOW}?${params.toString()}`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForSelector('.kk-board', { timeout: 20_000 });
        if (runId !== null) {
            // The module prints the selected run id in its header: that is the selection being applied,
            // whether or not the run is on the loaded page (an old failed tick is reached by deep link).
            await page.waitForFunction(
                (id) => document.querySelector('.kk-board-header code')?.textContent === id,
                runId,
                {
                    timeout: 20_000,
                },
            );
        }
        // The store projection is a second round trip after the shell mounts.
        await page.waitForTimeout(800);
        result.detail = await assert();
        result.pass = true;
    } catch (error) {
        result.detail = error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
    } finally {
        await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    }
    return result;
}

/** Drive the installed Board through the five tabs the design names (§5). */
async function checkTabs(
    origin: string,
    readerOrigin: string,
    ids: { withStore: string; withoutStore: string },
    out: string,
): Promise<{ tabs: TabResult[]; consoleErrors: ConsoleError[]; failedRequests: string[] }> {
    const browser = await chromium.launch();
    const consoleErrors: ConsoleError[] = [];
    const failedRequests: string[] = [];
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20_000);
        // The status behind each failing request, so a console error can be classified by the HTTP
        // answer it came from instead of by its message shape ("Failed to load resource …").
        const statusOf = new Map<string, number>();
        page.on('response', (response) => {
            if (response.status() >= 400) {
                statusOf.set(response.url(), response.status());
                failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
            }
        });
        page.on('console', (message) => {
            if (message.type() === 'error') {
                const url = message.location().url || null;
                consoleErrors.push({
                    text: message.text(),
                    url,
                    status: url === null ? null : (statusOf.get(url) ?? null),
                });
            }
        });
        page.on('pageerror', (error) => consoleErrors.push({ text: error.message, url: null, status: null }));
        console.error('chromium: driving the installed Board …');
        const tabs = [
            await visit(page, origin, readerOrigin, out, 'overview', null, async () => {
                await page.waitForSelector('.kk-collect-table tbody tr');
                const rows = await page.locator('.kk-collect-table tbody tr').count();
                const banner = (await page.locator('.kk-collect-banner').innerText()).replaceAll(/\s+/g, ' ').trim();
                const inserted = (await overviewRow(page, ids.withStore).locator('td').nth(5).innerText()).trim();
                if (!/^\d+$/.test(inserted)) {
                    throw new Error(
                        `Overview shows no stored count for ${ids.withStore} (Inserted cell "${inserted}")`,
                    );
                }
                // A `no store row` cell only exists for a run on the page; when the page has one, it must
                // state it (never a zero). The checked no-row run is asserted on its Run detail tab.
                const noStoreCells = page.locator('.kk-collect-table .kk-collect-nostore');
                const noStoreRows = await noStoreCells.count();
                if (noStoreRows > 0) {
                    const cell = (await noStoreCells.first().innerText()).trim();
                    if (!/no store row|in progress/.test(cell)) {
                        throw new Error(`a run without a store row renders "${cell}", not its state`);
                    }
                }
                return `${rows} run rows (${noStoreRows} not stored); ${ids.withStore} inserted ${inserted}; banner: ${banner}`;
            }),
            await visit(page, origin, readerOrigin, out, 'summary', ids.withStore, async () => {
                await page.waitForSelector('.kk-collect-funnel .kk-stat-card');
                const stages = await page.locator('.kk-collect-funnel .kk-stat-card').count();
                if (stages < 4) throw new Error(`Run detail shows ${stages} funnel stages, expected 4`);
                await page.waitForSelector('.kk-collect-quality');
                const quality = await page.locator('.kk-collect-quality').innerText();
                if (/could not be read/.test(quality)) throw new Error('Label quality reports an unreadable store');
                // The histogram must name every confidence level. A run with no label rows renders no
                // table at all (an explicit "No label decisions recorded" line), which is not a miss.
                const headers = (await page.locator('.kk-collect-quality thead th').allInnerTexts()).map((text) =>
                    text.trim(),
                );
                const missing =
                    headers.length === 0 ? [] : CONFIDENCE_LEVELS.filter((level) => !headers.includes(level));
                if (missing.length > 0) {
                    throw new Error(`Label quality does not name the ${missing.join('/')} confidence level(s)`);
                }
                const histogramRows = await page.locator('.kk-collect-quality tbody tr').count();
                return `${stages} funnel stages; label quality: ${histogramRows} histogram row(s)${
                    headers.length === 0 ? ' (no label rows for this run)' : ' with HIGH/MEDIUM/LOW columns'
                }`;
            }),
            await visit(page, origin, readerOrigin, out, 'items', ids.withStore, async () => {
                await page.waitForSelector('.kk-collect-items');
                const panel = await page.locator('.kk-collect-items').innerText();
                if (/could not be read/.test(panel)) throw new Error('Items panel reports an unreadable store');
                const rows = await page.locator('.kk-collect-items-table tbody tr').count();
                const pager = (
                    await page
                        .locator('.kk-collect-pager')
                        .innerText()
                        .catch(() => '')
                )
                    .replaceAll(/\s+/g, ' ')
                    .trim();
                if (rows === 0 && !/No items match/.test(panel))
                    throw new Error('Items panel is empty without a reason');
                return `${rows} item rows${pager === '' ? '' : `; ${pager}`}`;
            }),
            await visit(page, origin, readerOrigin, out, 'summary', ids.withoutStore, async () => {
                await page.waitForSelector('.kk-collect-detail');
                const detail = await page.locator('.kk-collect-detail').innerText();
                if (!detail.includes('wrote no store row')) {
                    throw new Error('Run detail does not state the missing store row');
                }
                return 'states "This run wrote no store row."';
            }),
            await visit(page, origin, readerOrigin, out, 'items', ids.withoutStore, async () => {
                await page.waitForSelector('.kk-collect-items');
                const panel = await page.locator('.kk-collect-items').innerText();
                if (/could not be read/.test(panel)) throw new Error('Items panel reports an unreadable store');
                const rows = await page.locator('.kk-collect-items-table tbody tr').count();
                return `${rows} item rows (no store row for this run)`;
            }),
        ];
        return { tabs, consoleErrors, failedRequests };
    } finally {
        await browser.close();
    }
}

/** `JSON.stringify` equality of two digests: any row landing mid-check shows up here. */
function sameDigest(a: Digest, b: Digest): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The exact invocation this run was started with, flags included — a report whose "operator command"
 * fails when copied loses the flag that made the check work in the first place.
 */
function operatorCommand(): string {
    const script = process.argv[1] ?? join('apps/board/scripts', 'verify-collect-live.ts');
    const args = process.argv.slice(2).map((arg) => (/[\s"'$]/.test(arg) ? JSON.stringify(arg) : arg));
    return ['bun', script, ...args].join(' ');
}

async function main(): Promise<number> {
    const paths = resolvePaths();
    if (!existsSync(paths.store)) throw new Error(`no kk store at ${paths.store}`);
    if (!existsSync(paths.spurDb)) throw new Error(`no Spur run history at ${paths.spurDb}`);
    if (!existsSync(join(paths.project, '.spur/config.yaml'))) {
        throw new Error(`${paths.project} is not a Spur project (no .spur/config.yaml)`);
    }
    mkdirSync(paths.out, { recursive: true });

    console.error(`checked project: ${paths.project}`);
    console.error(`kk store (read in place): ${paths.store}`);
    console.error(`spur plane: ${paths.spurDb}`);
    console.error('fingerprinting the store and the Spur plane …');
    const filesBefore = storeFiles(paths.store);
    const storeDigestBefore = digest(paths.store);
    const spurDbSha256 = await sha256File(paths.spurDb);

    console.error('building the throwaway Board project (Spur plane copy) …');
    const boardTemp = boardProject(paths);
    const servers: Server[] = [];
    let report: Record<string, unknown> = {};
    try {
        console.error('packing + installing the CLI (prepack builds the board assets) …');
        const cliEntry = packAndInstall(boardTemp);
        const boardPort = freePort();
        const origin = `http://127.0.0.1:${boardPort}`;
        console.error(`installed Board: ${origin}`);
        servers.push(
            spawnServer(
                'board',
                [
                    ...spurCommand(),
                    'serve',
                    '--port',
                    String(boardPort),
                    '--host',
                    '127.0.0.1',
                    '--no-open',
                    '--cwd',
                    boardTemp,
                ],
                boardTemp,
                paths.out,
            ),
        );
        await waitFor(`${origin}/api/health`, servers[0] as Server);
        // The checked runs come from the page the browser will render, not from the whole history.
        const stored = storedRunIds(paths.store);
        const ids = pickRunIds(await boardRunPage(origin), spurRuns(paths.spurDb), stored);
        console.error(`runs: ${ids.withStore} (store row) · ${ids.withoutStore} (no store row)`);
        const readerPort = freePort();
        const readerOrigin = `http://127.0.0.1:${readerPort}`;
        console.error(`installed reader: ${readerOrigin} (store ${paths.store}, opened in place)`);
        servers.push(
            spawnServer(
                'reader',
                [process.execPath, cliEntry, 'board', 'serve', '--board-origin', origin, '--port', String(readerPort)],
                // Same project root as the Board (the reader refuses a Board whose project differs —
                // 403 `board.project.mismatch`). Its `.works/kk.db` is the symlink to the live store,
                // so every projection the browser asserts on comes from the real file.
                boardTemp,
                paths.out,
            ),
        );
        await waitFor(`${readerOrigin}/api/health`, servers[1] as Server);

        const { tabs, consoleErrors, failedRequests } = await checkTabs(origin, readerOrigin, ids, paths.out);
        const filesAfter = storeFiles(paths.store);
        const storeDigestAfter = digest(paths.store);
        const digestIdentical = sameDigest(storeDigestBefore, storeDigestAfter);
        const change = classifyStoreChange(filesBefore, filesAfter, digestIdentical);
        const contentIdentical = change.identical;
        const tabsPassed = tabs.every((tab) => tab.pass);
        const expected = consoleErrors.filter(expectedReaderMiss);
        const unexpected = consoleErrors.filter((error) => !expectedReaderMiss(error));
        const ok =
            (contentIdentical || change.checkpointed) && digestIdentical && tabsPassed && unexpected.length === 0;
        report = {
            generatedAt: new Date().toISOString(),
            ok,
            operatorCommand: operatorCommand(),
            checkedRuns: ids,
            sources: {
                project: paths.project,
                store: {
                    path: paths.store,
                    copied: false,
                    openedInPlaceVia: join(boardTemp, '.works/kk.db'),
                    walLinked: existsSync(`${paths.store}-wal`),
                },
                spurDb: { path: paths.spurDb, sha256: spurDbSha256, copiedForBoard: true },
                boardProject: boardTemp,
            },
            digests: {
                storePath: paths.store,
                fileSha256: { before: filesBefore, after: filesAfter, identical: contentIdentical },
                schemaAndCounts: { before: storeDigestBefore, after: storeDigestAfter, identical: digestIdentical },
                identical: digestIdentical && (contentIdentical || change.checkpointed),
                checkpointed: change.checkpointed,
                changeReason: change.reason,
            },
            tabs,
            consoleErrors,
            expectedReaderMisses: expected,
            failedRequests,
        };
        writeFileSync(join(paths.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        for (const tab of tabs) {
            console.error(`${tab.pass ? 'PASS' : 'FAIL'} ${tab.runId ?? '(page)'} ${tab.tab}: ${tab.detail}`);
        }
        if (change.checkpointed) {
            console.error(`NOTE ${change.reason} — read-only, not a store write; rerun to see a byte-identical pair`);
        } else if (!contentIdentical) {
            console.error(
                `FAIL the store CONTENT changed while the check ran (${change.reason}) — a collect tick may have landed; rerun when idle`,
            );
        }
        if (!digestIdentical) {
            console.error(
                'FAIL the store schema/row counts changed while the check ran — a collect tick may have landed',
            );
        }
        if (expected.length > 0) {
            console.error(
                `note: ${expected.length} console error(s) are the reader's 404 for results/config of a run with no capture record`,
            );
        }
        if (unexpected.length > 0) {
            console.error(`FAIL ${unexpected.length} unexpected console error(s): ${unexpected[0]?.text ?? ''}`);
            for (const request of new Set(failedRequests)) console.error(`  ${request}`);
        }
        console.error(`artifacts: ${paths.out}`);
        console.error(`operator command: ${operatorCommand()}`);
        const print = (file: StoreFilePrint | null) =>
            file === null ? '(absent)' : `${file.sha256} (${file.bytes} B)`;
        console.error(`store db sha256 before: ${print(filesBefore.db)}`);
        console.error(`store db sha256 after:  ${print(filesAfter.db)} (identical: ${contentIdentical})`);
        console.error(`store wal sha256 before: ${print(filesBefore.wal)}`);
        console.error(`store wal sha256 after:  ${print(filesAfter.wal)} (identical: ${contentIdentical})`);
        console.error(
            `store sqlite_master sha256: ${storeDigestBefore.sqliteMasterSha256} (identical: ${digestIdentical})`,
        );
        console.error(`store row counts: ${JSON.stringify(storeDigestBefore.tables)}`);
        console.error(`spur db sha256: ${spurDbSha256}`);
        return ok ? 0 : 1;
    } finally {
        for (const server of servers) server.child.kill();
        rmSync(boardTemp, { recursive: true, force: true, maxRetries: 3 });
    }
}

/** The Spur CLI invocation: `$SPUR_BIN`, then the workspace dependency, then the PATH. */
function spurCommand(): string[] {
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

// Only when executed as a script: importing this module (the digest classifier's unit test) must
// not spawn servers or exit the process.
if (import.meta.main) {
    process.exit(
        await main().catch((error: unknown) => {
            console.error(`verify-collect-live: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }),
    );
}
