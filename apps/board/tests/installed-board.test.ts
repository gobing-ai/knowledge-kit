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
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@gobing-ai/kk-store';
import { type Browser, type ConsoleMessage, chromium, type Locator, type Page, type Request } from 'playwright';
import { spurPackageRootOf } from '../../../scripts/spur-env';

const REPO = resolve(import.meta.dir, '../../..');
const CLI_DIR = join(REPO, 'apps/cli');
const INSTALLED = '@gobing-ai/knowledge-kit';
const PROJECT_NAME = 'kk-installed-board-fixture';
const MODULES = [
    { id: 'kk-collect', name: 'Collect', icon: '📥', entry: 'collect' },
    { id: 'kk-daily-ai-voice2', name: 'Daily AI Voice', icon: '🎙️', entry: 'daily-voice' },
    { id: 'kk-itc', name: 'IT Content', icon: '✍️', entry: 'itc' },
] as const;

/**
 * A hostname that is not a loopback name, resolved to 127.0.0.1 inside Chromium by
 * `--host-resolver-rules`, so the LAN-access case needs no real network. The Board allows it
 * through `SPUR_CORS_ORIGINS`.
 */
const LAN_HOST = 'lan.test';

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
let browser: Browser | null = null;
let page: Page | null = null;
let spur: string[] = [];

/**
 * Resolve the Spur package behind the `spur` on PATH — the same one `scripts/with-spur-env.ts` puts on
 * NODE_PATH. PATH comes first because `import.meta.resolve` walks ancestor `node_modules`, so a stale
 * `~/node_modules/@gobing-ai/spur` would otherwise shadow the single global install.
 */
function resolveSpurPackageRoot(): string {
    const which = Bun.which('spur');
    if (which !== null) {
        // `scripts/spur-env.ts` is the canonical resolver: it accepts a published install AND a
        // source checkout whose `spur` on PATH is a working copy (the workspace self-link case).
        const packageRoot = spurPackageRootOf(dirname(realpathSync(which)));
        if (packageRoot === undefined) throw new Error(`cannot locate the @gobing-ai/spur package behind ${which}`);
        return packageRoot;
    }
    try {
        return dirname(fileURLToPath(import.meta.resolve('@gobing-ai/spur/package.json')));
    } catch {
        throw new Error('cannot resolve the installed spur CLI; set SPUR_BIN to spur.js');
    }
}

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

/** Resolve the installed `spur` CLI: `$SPUR_BIN`, then the PATH, then the module resolver. */
function resolveSpur(): string[] {
    const override = process.env.SPUR_BIN;
    if (override !== undefined && override !== '') return [process.execPath, override];
    return [process.execPath, join(resolveSpurPackageRoot(), 'spur.js')];
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
function spawnServer(
    name: string,
    label: string,
    args: string[],
    cwd: string,
    extraEnv: Record<string, string> = {},
): (typeof servers)[number] {
    const logFile = join(realTempDir(`kk-installed-${name}-`), 'server.log');
    const fd = openSync(logFile, 'a');
    const child = Bun.spawn({ cmd: args, cwd, stdout: fd, stderr: fd, env: { ...childEnv(), ...extraEnv } });
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
            `      api: node_modules/${INSTALLED}/dist/board/api.js`,
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
            { id: 'extract', actions: 1 },
            { id: 'plan', actions: 1 },
            { id: 'qc-content', actions: 1 },
            { id: 'generate', actions: 1 },
            { id: 'safety', actions: 1 },
            { id: 'duration', actions: 1 },
            { id: 'publish-classify', actions: 1 },
            { id: 'run-report', actions: 1 },
        ]),
    );
    writeFileSync(join(dir, 'kk-itc.yaml'), stateMachine('kk-itc', [{ id: 'prepare', actions: 1 }]));
    // 0390 R3: the current news family. One state per producer node the news artifact manifest
    // names (`apps/cli/src/board/manifest.ts` NEWS_GENERATE_ARTIFACTS), so each hand-written file
    // is authorized by a real recorded producer success. Its run is created LAST (see
    // `ensureNewsFixture`), so the retired-layout assertions above keep testing the fallback.
    writeFileSync(
        join(dir, 'kk-news-generate.yaml'),
        stateMachine('kk-news-generate', [
            { id: 'prepare', actions: 1 },
            { id: 'curate', actions: 1 },
            { id: 'script-write', actions: 1 },
            { id: 'editorial-judge', actions: 1 },
            { id: 'render', actions: 1 },
            { id: 'safety', actions: 1 },
            { id: 'cards', actions: 1 },
            { id: 'safety-variants', actions: 1 },
            { id: 'voice', actions: 1 },
            { id: 'freeze', actions: 1 },
        ]),
    );
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

/**
 * G82/0320 — write one funnel-gate run's workspace. Every file is one of the fixed manifest
 * paths; the variant names the run so `d-funnel` is the measured refusal, `d-mismatch` the full
 * run whose stages disagree (pool 3 / annotated 7 / plan 6), and the rest one gate each.
 */
function writeDailyFunnelFiles(workDirRel: string, stamp: string, variant: string): void {
    const dir = join(project, workDirRel);
    const pool = (count: number): string =>
        JSON.stringify(
            Array.from({ length: count }, (_, index) => ({ id: `p${index}`, title: `Title p${index}`, body: 'body' })),
        );
    const write = (rel: string, body: string): void => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), body);
    };
    write('10-collect/pool.json', pool(variant === 'd-empty' ? 0 : variant === 'd-mismatch' ? 3 : 4));
    write(`21-plan/${stamp}_04_quality-control-content_annotated.json`, pool(variant === 'd-mismatch' ? 7 : 4));
    write(
        `21-plan/${stamp}_04_quality-control-content_candidates.rejected.json`,
        JSON.stringify({ rejected: [{ doc: { id: 'x' }, reasons: ['low quality'] }, { doc: { id: 'y' } }], total: 2 }),
    );
    if (variant !== 'd-unk' && variant !== 'd-empty' && variant !== 'd-qce' && variant !== 'd-script') {
        write(
            `21-plan/${stamp}_04_quality-control-content_exclusions.json`,
            JSON.stringify({
                version: 1,
                runDate: stamp,
                excluded: [{ id: 'd', title: 'Secret title', rule: 'policy-dispute', matched: 'lawsuit' }],
                kept: ['a', 'b', 'c'],
            }),
        );
    }
    if (variant !== 'd-mismatch' && variant !== 'd-empty' && variant !== 'd-unk') {
        // Post-dedup survivors; a refusal clears the real file, so only runs without one carry docs.
        // d-qce's pre-refusal candidates are genuinely EMPTY (QC emptied the pool); d-funnel and
        // d-floor had theirs cleared by the refusal itself, so their docs bag is empty too.
        const docs =
            variant === 'd-qce'
                ? []
                : variant === 'd-funnel' || variant === 'd-floor'
                  ? []
                  : [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        write(
            `21-plan/${stamp}_04_quality-control-content_candidates.json`,
            JSON.stringify({ metadata: { doc_count: docs.length, docs } }),
        );
    }
    if (variant === 'd-mismatch' || variant === 'd-funnel') {
        // 2026-10-21 planned 6 episodes; 2026-10-22 planned 3 before the duration refusal.
        write(`21-plan/${stamp}_03_plan_plan.json`, pool(variant === 'd-mismatch' ? 6 : 3));
    }
    if (variant === 'd-floor') {
        write(
            `21-plan/${stamp}_04_quality-control-content_floor-refusal.json`,
            JSON.stringify({ estimatedMinutes: 6.2, minMinutes: 15, candidateChars: 900 }),
        );
    }
    if (variant === 'd-script') {
        write(
            `30-audio/${stamp}_11_generate_content_duration-refusal.json`,
            JSON.stringify({ stage: 'script', estimatedMinutes: 5.1, minMinutes: 15, keptCount: 3 }),
        );
    }
    if (variant === 'd-funnel') {
        write(
            `30-audio/${stamp}_11_generate_content_duration-refusal.json`,
            JSON.stringify({
                measuredMinutes: 8.9,
                estimatedMinutes: 14.4,
                minMinutes: 15,
                keptCount: 3,
                candidateChars: 4300,
            }),
        );
    }
    write(
        `${stamp}_19_run-report_report.md`,
        `# Daily run report

no-content: the episode was refused (${variant})`,
    );
    if (variant === 'd-mismatch') {
        write(`31-publish/${stamp}_17_publish_publish-status.txt`, 'full');
    }
}

/** The throwaway project's kk store — the file the seeded DAOs write and the reader reads. */
function storeDbPath(): string {
    return join(project, '.works/kk.db');
}

/**
 * G81/0309 R1 — seed the throwaway project's store through the REAL kk-store DAOs.
 *
 * Fixture run `r-a` gets a `collect_runs` row (with the real `inserted`/`updated` counts from the
 * upsert), 27 items across two sources, three label observations (one per maker) and three
 * selections (`selected`, `published`, `dropped`); fixture run `r-b` gets NOTHING, so the Board
 * must render it as `no store row`. No raw SQL: every write goes through `CollectRunsDao`,
 * `ItemsDao`, `LabelsDao` and `SelectionsDao`, the same seams `kk store ingest/label` uses.
 */
async function seedCollectStore(): Promise<void> {
    const store = await openStore({ path: storeDbPath() });
    try {
        const sourceCounts = { 'aihot-ingest': 20, 'horizon-ingest': 7 };
        await store.collectRuns.start({ runId: 'r-a', startedAt: Date.now() - 3_600_000, sourceCounts });
        const docs = Array.from({ length: 27 }, (_, index) => ({
            id: `g81-seed-${index}`,
            title: `Seeded collect item ${index + 1}`,
            body: `Seeded body ${index + 1}`,
            // One item carries a canonical URL so the Items tab renders a link; the rest are text.
            ...(index === 0 ? { sourceUri: 'https://example.com/collect/first' } : {}),
            metadata: { source: index < 20 ? 'aihot-ingest' : 'horizon-ingest' },
        }));
        const stored = await store.items.upsertDocs('r-a', docs);
        const [first = '', second = '', third = '', fourth = ''] = stored.newIds;
        // `labels_current` joins on `items.content_hash`, so an observation must carry the hash it
        // was made against — the same value the real label pass stamps (design §3).
        const hashOf = async (itemId: string): Promise<string | null> =>
            (await store.items.findById(itemId))?.contentHash ?? null;
        const decisionId = 'kk-item-category';
        await store.labels.recordObservation({
            itemId: first,
            decisionId,
            value: 'ai-news',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'r-a',
            contentHash: await hashOf(first),
        });
        await store.labels.recordObservation({
            itemId: second,
            decisionId,
            value: 'ai-news',
            maker: 'model:interview',
            source: 'model',
            confidence: 'HIGH',
            rawConfidence: 0.9,
            runId: 'r-a',
            contentHash: await hashOf(second),
        });
        // A second model answer below `min_confidence`: the same value at MEDIUM, so the run's own
        // histogram carries all three confidence levels the UI must show (HIGH/MEDIUM/LOW).
        await store.labels.recordObservation({
            itemId: fourth,
            decisionId,
            value: 'ai-news',
            maker: 'model:interview',
            source: 'model',
            confidence: 'MEDIUM',
            rawConfidence: 0.6,
            runId: 'r-a',
            contentHash: await hashOf(fourth),
        });
        await store.labels.recordObservation({
            itemId: third,
            decisionId,
            value: 'other',
            maker: 'default',
            source: 'default',
            confidence: 'LOW',
            runId: 'r-a',
            contentHash: await hashOf(third),
        });
        await store.selections.insertMany([
            { topic: 'ai-news', itemId: first, runId: 'r-a', storyId: first, status: 'selected' },
            {
                topic: 'ai-news',
                itemId: second,
                runId: 'r-a',
                storyId: second,
                status: 'published',
                publishedAt: Date.now(),
            },
            { topic: 'ai-news', itemId: third, runId: 'r-a', storyId: third, status: 'dropped' },
        ]);
        await store.collectRuns.finish('r-a', {
            status: 'done',
            inserted: stored.inserted,
            updated: stored.updated,
            sourceCounts,
            finishedAt: Date.now(),
        });
    } finally {
        await store.close();
    }
}

/**
 * G82/0320 — seed the supply context for the d-funnel run: one positive `aihot-ingest` tick and
 * five items, both recorded 2 h before the run's own `startedAt`, i.e. INSIDE the configured
 * `[startedAt − 24h, startedAt)` window. `horizon-ingest` is deliberately absent from the window,
 * so the panel must show 0 recorded contributions and unknown health for it.
 */
async function seedDailySupply(): Promise<void> {
    const response = await fetch(`${boardOrigin}/api/runs/d-funnel`);
    expect(response.status).toBe(200);
    const run = ((await response.json()) as { run: { startedAt: string | null } }).run;
    const startedAt = run.startedAt === null || run.startedAt === undefined ? null : Date.parse(run.startedAt);
    if (startedAt === null || !Number.isFinite(startedAt)) throw new Error('d-funnel carries no startedAt');
    const at = startedAt - 2 * 3_600_000;
    const store = await openStore({ path: storeDbPath() });
    try {
        await store.collectRuns.start({
            runId: 'd-supply-tick',
            startedAt: at,
            sourceCounts: { 'aihot-ingest': 5 },
        });
        await store.collectRuns.finish('d-supply-tick', { status: 'done', finishedAt: at + 1 });
        await store.items.upsertDocs(
            'd-supply-tick',
            Array.from({ length: 5 }, (_, index) => ({
                id: `d-supply-${index}`,
                title: `Daily supply item ${index}`,
                body: `Supply body ${index}`,
                metadata: { source: 'aihot-ingest' },
            })),
            at,
        );
    } finally {
        await store.close();
    }
}

/**
 * G81/0319 — seed 35 extra tick days (one `collect_runs` row each) so the All range has more than
 * one 30-day aggregate page. Each row is a valid empty source-count map: the plugin table must show
 * the named plugins as zero, never invent a count.
 */
async function seedChannelTicks(): Promise<void> {
    const store = await openStore({ path: storeDbPath() });
    try {
        const now = Date.now();
        const dayMs = 86_400_000;
        for (let i = 0; i < 35; i += 1) {
            const startedAt = now - (i + 1) * dayMs;
            await store.collectRuns.start({ runId: `pg-${i}`, startedAt, sourceCounts: {} });
            await store.collectRuns.finish(`pg-${i}`, { status: 'done', finishedAt: startedAt + 1 });
        }
    } finally {
        await store.close();
    }
}

async function consoleErrorsDuring(fn: () => Promise<void>): Promise<string[]> {
    if (page === null) throw new Error('browser page not ready');
    const errors: string[] = [];
    // Installed `spur self serve` calls `Bun.serve` without `idleTimeout: 0` (default 10 s), while
    // its `/api/events/planning` SSE keepalive fires every 15 s. An idle host stream is therefore
    // cut with `net::ERR_INCOMPLETE_CHUNKED_ENCODING` around 10 s (e.g. right after the 9 s AC6
    // mid-flight switch test), emitting both a `requestfailed` and a console error anchored to that
    // exact host SSE URL. Filter ONLY that host-owned idle cut; every reader/module/other error
    // still fails the assertion.
    const planningSseUrl = `${boardOrigin}/api/events/planning`;
    const isHostPlanningSseIdleCut = (url: string, detail: string): boolean =>
        url === planningSseUrl && detail.includes('ERR_INCOMPLETE_CHUNKED_ENCODING');
    const onConsole = (message: ConsoleMessage): void => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (isHostPlanningSseIdleCut(message.location().url, text)) return;
        errors.push(text);
    };
    const onPageError = (error: Error): void => {
        errors.push(error.message);
    };
    // A console line names the failure but never the resource: `net::ERR_INCOMPLETE_CHUNKED_ENCODING`
    // failed this suite once (CI run 44852346749, 2026-11-21) and the text alone could not say which
    // response was cut, so the occurrence cost a rerun instead of a diagnosis. Requests the browser
    // cancels for its own reasons (a navigation, a superseded load) are not failures and stay silent.
    const onRequestFailed = (request: Request): void => {
        const failure = request.failure();
        if (failure === null || failure.errorText.includes('ERR_ABORTED')) return;
        if (isHostPlanningSseIdleCut(request.url(), failure.errorText)) return;
        errors.push(`${request.method()} ${request.url()} — ${failure.errorText}`);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    try {
        await fn();
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('requestfailed', onRequestFailed);
    }
    return errors;
}

/** The Overview table row for one run id (the run link text is the exact id). */
function overviewRow(runId: string): Locator {
    if (page === null) throw new Error('browser page not ready');
    return page
        .locator('.kk-collect-table tbody tr')
        .filter({ has: page.locator('.kk-collect-run-link', { hasText: new RegExp(`^${runId}$`) }) });
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
    if (!existsSync(cliEntry)) throw new Error(`the packed install does not carry the CLI binary: ${cliEntry}`);
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
    // G82/0320: one run per funnel gate, plus the mismatched full run and the unknown run.
    for (const runId of ['d-funnel', 'd-mismatch', 'd-script', 'd-floor', 'd-empty', 'd-qce', 'd-unk']) {
        runWorkflow('kk-daily-ai-voice2', runId);
    }

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
    // G82/0320: funnel workspaces — every capture carries the configured window and episode bounds.
    const funnelSettings = ['window=24h', 'episode_min_minutes=15', 'episode_max_minutes=25'];
    const funnelDirs: Record<string, string> = {
        'd-funnel': 'F1',
        'd-mismatch': 'F2',
        'd-script': 'F3',
        'd-floor': 'F4',
        'd-empty': 'F5',
        'd-qce': 'F6',
        'd-unk': 'F7',
    };
    for (const [runId, stamp] of Object.entries(funnelDirs)) {
        capture(
            'kk-daily-ai-voice2',
            runId,
            `.works/kk-daily-ai-voice2/${stamp}`,
            stamp,
            runId === 'd-mismatch' ? [...funnelSettings, 'publish_enabled=true'] : funnelSettings,
        );
        writeDailyFunnelFiles(`.works/kk-daily-ai-voice2/${stamp}`, stamp, runId);
    }
    // 4b. G81/0309: the store plane, seeded through the real DAOs (r-a has a row, r-b none).
    await seedCollectStore();
    // 4c. G81/0319: 35 extra tick days so the All channel-yield aggregate spans multiple pages.
    await seedChannelTicks();

    // 5. The installed Board serves the browser contributions and their module API.
    const boardPort = freePort();
    boardOrigin = `http://127.0.0.1:${boardPort}`;
    const boardServer = spawnServer(
        'board',
        'installed Board (spur self serve)',
        [...spur, 'self', 'serve', '--port', String(boardPort), '--host', '127.0.0.1', '--no-open', '--cwd', project],
        project,
        // The LAN-origin case below reaches this same listener under a non-loopback hostname.
        { SPUR_CORS_ORIGINS: `http://${LAN_HOST}:${boardPort}` },
    );
    await waitFor(`${boardOrigin}/api/health`, boardServer);
    for (const module of MODULES) {
        await waitFor(`${moduleApi(module.id)}/api/health`, boardServer);
    }
    // 5b. G82/0320: in-window supply for d-funnel — a tick plus items BACKDATED to 2 h before the
    // run's own start, through the real DAOs (no raw SQL).
    await seedDailySupply();

    // 6. A real browser; a missing runtime fails the setup loudly.
    try {
        browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${LAN_HOST} 127.0.0.1`] });
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
    // `.kk-board` is rendered by the module itself, so the host's own diagnostic (an unusable
    // `webModule`, a 404 page) shows up only as a bare selector timeout. Carry the rendered text and
    // the page errors into the failure so the cause is named.
    const errors: string[] = [];
    const onConsole = (message: ConsoleMessage): void => {
        if (message.type() === 'error') errors.push(message.text());
    };
    const onPageError = (error: Error): void => {
        errors.push(error.message);
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    try {
        await page.waitForSelector('.kk-board', { timeout: 15_000 });
    } catch {
        const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 400);
        const detail = errors.length === 0 ? '' : ` | errors: ${errors.join(' | ')}`;
        throw new Error(`module ${id} never mounted at ${page.url()}: ${body}${detail}`);
    } finally {
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
    }
}

/** Wait until the run selector or table carries an option/row for `runId`. */
async function waitForRunOption(runId: string): Promise<void> {
    if (page === null) throw new Error('browser page not ready');
    const selector = page.locator(
        `.kk-board-run-selector select option[value="${runId}"], select[name="run"] option[value="${runId}"]`,
    );
    if ((await selector.count()) > 0) {
        await selector.first().waitFor({
            state: 'attached',
            timeout: 15_000,
        });
    } else {
        await page
            .locator('.kk-collect-table tbody tr, .kk-collect-run-link, .kk-card, .kk-stat-grid')
            .first()
            .waitFor({
                state: 'attached',
                timeout: 15_000,
            });
    }
}

/** Encode a module deep-link query. */
function query(params: Record<string, string> = {}): string {
    return new URLSearchParams(params).toString();
}

function moduleApi(id: string = 'kk-collect'): string {
    return `${boardOrigin}/api/modules/${id}`;
}

/** A reader request carrying the correct Board origin header. */
function readerFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${moduleApi(/^\/api\/workflows\/([^/]+)/.exec(path)?.[1])}${path}`, {
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
            // Collect and ITC keep the legacy four-tab strip; the day-centric Daily Voice console
            // ships the kit's append-only five-tab strip (G83/0440: Today, Generation, Publishing,
            // History, Actions log).
            const tabCount = module.id === 'kk-daily-ai-voice2' ? 5 : 4;
            const selector = module.id === 'kk-daily-ai-voice2' ? '[role="tab"]' : '.kk-board-tabs button';
            expect(await page.locator(selector).count(), module.id).toBe(tabCount);
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

    it('mounts Collect when the Board is opened on a non-loopback hostname', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const lanOrigin = `http://${LAN_HOST}:${new URL(boardOrigin).port}`;
        await page.goto(`${lanOrigin}/board/modules/kk-collect`, { waitUntil: 'commit' });
        await page.waitForSelector('.kk-board-collect', { timeout: 15_000 });
        const body = await page.locator('body').innerText();
        expect(body).not.toContain('could not be displayed');
        // Native reads still resolve: the same-origin store routes answer on the LAN hostname.
        await waitForRunOption('r-a');
    }, 30_000);
});

describe('run selection and deep links (AC2)', () => {
    it('restores a saved ?run=&tab= deep link and keeps both in the URL', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        // G81/0308 keeps shipped `?tab=results` links alive: the alias resolves to Run Details.
        await openModule('kk-collect', query({ run: 'r-b', tab: 'results', range: '7d' }));
        await waitForRunOption('r-b');
        if ((await page.locator('.kk-board-run-selector select').count()) > 0) {
            expect(await page.locator('.kk-board-run-selector select').inputValue()).toBe('r-b');
        }
        expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
            'Run Details',
        );
        const url = new URL(page.url());
        expect(url.searchParams.get('run')).toBe('r-b');
        expect(url.searchParams.get('tab')).toBe('runs');
        expect(url.searchParams.get('range')).toBe('7d');
    }, 30_000);

    it('retains the selected run across tab changes, a reload and back/forward', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await openModule('kk-collect', query({ run: 'r-b', tab: 'results' }));
        await waitForRunOption('r-b');
        // AC2 "across all tabs": visit every Collect tab, ending on selections for the reload below.
        for (const [tab, label] of [
            ['summary', 'Summary'],
            ['runs', 'Run Details'],
            ['items', 'Items'],
            ['selections', 'Selections'],
        ] as const) {
            await page.locator('.kk-board-tabs').getByRole('button', { name: label, exact: true }).click();
            await page.waitForTimeout(200);
            expect(new URL(page.url()).searchParams.get('tab'), tab).toBe(tab);
            expect(new URL(page.url()).searchParams.get('run'), tab).toBe('r-b');
            expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
                label,
            );
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForRunOption('r-b');
        expect(new URL(page.url()).searchParams.get('tab')).toBe('selections');
        // A browser back/forward must not lose the module's own run/tab selection.
        await page.goto(`${boardOrigin}/board`, { waitUntil: 'domcontentloaded' });
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.kk-board');
        expect(new URL(page.url()).searchParams.get('run')).toBe('r-b');
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
        await overviewRow('r-empty').getByRole('button', { name: 'Inspect' }).click();
        await page.locator('.kk-modal-card').waitFor();
        await page.locator('.kk-modal-card .kk-badge').first().waitFor({ state: 'attached', timeout: 15_000 });
        expect(await page.locator('body').innerText()).toContain('missing');
        await page.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
        await page.locator('.kk-modal-backdrop').waitFor({ state: 'detached' });
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
        const foreign = await fetch(`${moduleApi()}/api/workflows/kk-collect/runs/r-a/results`, {
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
        const moduleRoutes = '**/api/modules/kk-collect/**';
        await page.route(moduleRoutes, (route) => route.abort());
        try {
            await openModule('kk-collect');
            await waitForRunOption('r-a');
            const banner = page.locator('.kk-board-reader-offline-banner');
            await banner.waitFor();
            expect(await banner.innerText()).toContain('Board module API unavailable');
        } finally {
            await page.unroute(moduleRoutes);
        }
    }, 30_000);

    it('is keyboard-usable at a narrow viewport', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        await page.setViewportSize({ width: 480, height: 900 });
        try {
            await openModule('kk-collect', query({ run: 'r-a' }));
            expect(await page.locator('.kk-board-tabs').getAttribute('aria-label')).toBe('Collect tabs');
            const buttons = page.locator('.kk-board-tabs button');
            expect(await buttons.count()).toBe(4);
            await buttons.nth(1).focus();
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
            expect((await page.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
                'Run Details',
            );
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
        await page.waitForTimeout(400);
        await overviewRow('r-a').getByRole('button', { name: 'Inspect' }).click();
        await page.locator('.kk-modal-card').waitFor();
        const settingsLink = page.locator('.kk-modal-card a[href="/board/settings/workflows"]');
        await settingsLink.first().waitFor({ state: 'attached', timeout: 15_000 });
        expect(await settingsLink.count()).toBeGreaterThan(0);
        await page.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
        await page.locator('.kk-modal-backdrop').waitFor({ state: 'detached' });
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
        // The console renders the verdict its digest carries (server-validated, G83/0439); the
        // retired Summary view's "Safety confidence" fact is gone with the run-centric module, so
        // the browser half of this case retires here and 0441 re-covers it on the per-run tabs.
    }, 30_000);
});

describe('Collect store views over a seeded store (G81/0309 R1)', () => {
    it('never shows the previous run funnel while the selected run is loading', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        // The funnel lives in the Inspect modal, so the stale row it must never show is the previous
        // target's while the new target's store request is still in flight.
        await openModule('kk-collect', query({ run: 'r-a', tab: 'runs' }));
        await waitForRunOption('r-a');
        await view.locator('.kk-collect-table tbody tr').first().waitFor();
        await overviewRow('r-a').getByRole('button', { name: 'Inspect' }).click();
        await view.waitForSelector('.kk-modal-card .kk-collect-funnel .kk-stat-card');
        expect(await view.locator('.kk-modal-card .kk-collect-funnel').innerText()).toContain('aihot-ingest 20');
        await view.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
        await view.route('**/runs/r-b/store', (route) => route.abort());
        try {
            await overviewRow('r-b').getByRole('button', { name: 'Inspect' }).click();
            await view.waitForSelector('.kk-modal-card');
            const modal = view.locator('.kk-modal-card');
            expect(await modal.innerText()).toContain('The store has not answered for this run yet.');
            expect(await modal.innerText()).not.toContain('aihot-ingest 20');
            const artifacts = join(REPO, '.works/test-artifacts/g81');
            mkdirSync(artifacts, { recursive: true });
            await view.screenshot({ path: join(artifacts, 'collect-run-switch.png') });
        } finally {
            await view.unroute('**/runs/r-b/store');
            if ((await view.locator('.kk-modal-card').count()) > 0) {
                await view.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
                await view.locator('.kk-modal-backdrop').waitFor({ state: 'detached' });
            }
        }
    }, 30_000);

    it('joins the store onto the run page: banner, r-a counts, r-b has no store row', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        // The collector stays attached for the WHOLE scenario: a console error raised by any
        // assertion step (not only the first load) fails the check.
        const errors = await consoleErrorsDuring(async () => {
            await openModule('kk-collect', query({ tab: 'runs' }));
            await waitForRunOption('r-a');
            await view.locator('.kk-collect-table tbody tr').first().waitFor();
            // The banner measures the seeded `finished_at` against the 6 h schedule.
            const banner = view.locator('.kk-collect-banner');
            expect((await banner.locator('.kk-collect-banner-value').first().innerText()).trim()).toBe('on schedule');
            expect(await banner.innerText()).toContain('since the last stored collection (schedule 6 h)');
            // Spur's own statuses still count what needs attention: the four fixture runs without a row.
            expect(await banner.innerText()).toContain('0 failed · 4 done without a store row · 0 in progress');
            // r-a: the stored columns, each naming its own unit in the header row.
            const cells = overviewRow('r-a').locator('td');
            expect((await cells.nth(3).innerText()).trim()).toBe('done');
            expect((await cells.nth(4).innerText()).trim()).toBe('aihot-ingest 20 · horizon-ingest 7');
            expect((await cells.nth(5).innerText()).trim()).toBe('27');
            expect((await cells.nth(6).innerText()).trim()).toBe('0');
            expect((await cells.nth(7).innerText()).trim()).toBe('4');
            expect((await cells.nth(8).innerText()).trim()).toBe('25%');
            expect((await cells.nth(9).innerText()).trim()).toBe('1 selected · 1 published · 1 dropped');
            // r-b: a done tick with no store row states it — never a fabricated zero.
            expect(await overviewRow('r-b').innerText()).toContain('no store row');
        });
        expect(errors).toEqual([]);
    }, 30_000);

    it('renders the Run Details funnel and label quality in the Inspect modal, including ?tab=results', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        const errors = await consoleErrorsDuring(async () => {
            // A shipped `?tab=results` link resolves to Run Details (design §2).
            await openModule('kk-collect', query({ run: 'r-a', tab: 'results' }));
            await waitForRunOption('r-a');
            expect((await view.locator('.kk-board-tabs button[aria-current="page"]').textContent())?.trim()).toBe(
                'Run Details',
            );
            // The funnel and label quality are the run's drilldown, not a tab body.
            await overviewRow('r-a').getByRole('button', { name: 'Inspect' }).click();
            await view.waitForSelector('.kk-modal-card .kk-collect-funnel .kk-stat-card');
            const cards = view.locator('.kk-modal-card .kk-collect-funnel .kk-stat-card');
            expect(await cards.count()).toBe(4);
            // The stage label is uppercased by CSS, so the assertions read the flattened card text.
            const card = async (index: number): Promise<string> =>
                (await cards.nth(index).innerText()).trim().toLowerCase();
            // Every card names its own unit: items collected, stored, labeled, and yielded downstream.
            expect(await card(0)).toContain('collected');
            expect(await card(0)).toContain('27');
            expect(await card(0)).toContain('aihot-ingest 20 · horizon-ingest 7');
            expect(await card(1)).toContain('stored');
            expect(await card(1)).toContain('27 inserted · 0 updated · 0 unchanged');
            expect(await card(2)).toContain('labeled');
            expect(await card(2)).toContain('4 label rows: 1 heuristic · 2 model · 1 default');
            expect(await card(3)).toContain('downstream');
            expect(await card(3)).toContain('1 selected · 1 published · 1 dropped');
            // Label quality: this run's own rows, per decision, with the confidence histogram.
            const quality = view.locator('.kk-modal-card .kk-collect-quality');
            // The decision heading is uppercased by CSS like the funnel labels.
            expect((await quality.locator('h3').first().innerText()).trim().toLowerCase()).toBe('kk-item-category');
            // The histogram names the three levels the module reports (HIGH/MEDIUM/LOW) plus `none`.
            const headers = await quality.locator('thead th').allInnerTexts();
            expect(headers.map((text) => text.trim())).toEqual(['Value', 'HIGH', 'MEDIUM', 'LOW', 'none']);
            const histogram = async (value: string): Promise<string[]> => {
                const row = quality.locator('tbody tr').filter({ hasText: value });
                return (await row.locator('td').allInnerTexts()).map((text) => text.trim());
            };
            // ai-news: one HIGH model answer, one MEDIUM model answer, and a heuristic row with no level.
            expect(await histogram('ai-news')).toEqual(['ai-news', '1', '1', '0', '1']);
            expect(await histogram('other')).toEqual(['other', '0', '0', '1', '0']);
            // The toggle swaps to the effective (`labels_current`) distribution over the same items.
            await quality.getByRole('button', { name: 'Show effective labels' }).click();
            await view.waitForFunction(
                () =>
                    document.querySelector('.kk-collect-quality table thead th:nth-child(2)')?.textContent === 'Items',
                undefined,
                { timeout: 15_000 },
            );
            expect(await quality.innerText()).toContain('ai-news');
            await view.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
            await view.locator('.kk-modal-backdrop').waitFor({ state: 'detached' });
        });
        expect(errors).toEqual([]);
    }, 30_000);

    it('pages the Items tab and filters it through the reader route', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        const errors = await consoleErrorsDuring(async () => {
            await openModule('kk-collect', query({ run: 'r-a', tab: 'items' }));
            await waitForRunOption('r-a');
            await view.waitForSelector('.kk-collect-items-table');
            const rows = view.locator('.kk-collect-items-table tbody tr');
            const pager = view.locator('.kk-collect-pager');
            expect(await rows.count()).toBe(25);
            expect(await pager.innerText()).toContain('Page 1 of 2 · 27 items');
            // The one URL-carrying item is a safe link; the rest render as text.
            const link = view.locator('.kk-collect-items-table a[href="https://example.com/collect/first"]');
            expect(await link.count()).toBe(1);
            expect(await link.getAttribute('rel')).toBe('noreferrer');
            // Every row states something in the Labels column: a chip, or the explicit no-label dash.
            expect((await rows.first().locator('td').nth(4).innerText()).trim()).not.toBe('');
            // Page 2 carries the remaining two items.
            await pager.getByRole('button', { name: 'Next' }).click();
            await view.waitForFunction(
                () => document.querySelectorAll('.kk-collect-items-table tbody tr').length === 2,
                undefined,
                { timeout: 15_000 },
            );
            expect(await pager.innerText()).toContain('Page 2 of 2 · 27 items');
            // Switching runs on page 2 must not carry the page over (G81 / task 0312): stored, `r-b`
            // has no row, so the reader answers an available, empty page 1 — a fact 0308 §Items lets
            // the panel state, pager included. A surviving page 2 would show up in that pager; the
            // loading state in between has none, so waiting on the pager is what makes this
            // deterministic (asserting "no empty claim" instead raced the response: CI caught the
            // loaded page, local caught the loading one). Coming back to `r-a` restarts at page 1.
            await view
                .locator('.kk-collect-filter select[name="run"], .kk-board-run-selector select')
                .first()
                .selectOption('r-b');
            await view.waitForFunction(
                () => document.querySelector('.kk-collect-pager')?.textContent?.includes('0 items') ?? false,
                undefined,
                { timeout: 15_000 },
            );
            expect(await pager.innerText()).toContain('Page 1 of 1 · 0 items');
            expect(await rows.count()).toBe(0);
            await view
                .locator('.kk-collect-filter select[name="run"], .kk-board-run-selector select')
                .first()
                .selectOption('r-a');
            await view.waitForSelector('.kk-collect-items-table');
            expect(await pager.innerText()).toContain('Page 1 of 2 · 27 items');
            // One filter, sent to the 0307 route: a new filter restarts at page 1.
            await view.locator('.kk-collect-filter select[name="source"]').selectOption('horizon-ingest');
            await view.waitForFunction(
                () => document.querySelectorAll('.kk-collect-items-table tbody tr').length === 7,
                undefined,
                { timeout: 15_000 },
            );
            expect(await pager.innerText()).toContain('Page 1 of 1 · 7 items');
            const sources = await view.locator('.kk-collect-items-table tbody tr td:nth-child(2)').allInnerTexts();
            expect(sources.map((text) => text.trim())).toEqual(Array.from({ length: 7 }, () => 'horizon-ingest'));
        });
        expect(errors).toEqual([]);
    }, 30_000);
});

describe('Collect store views with the store file removed (G81/0309 R2)', () => {
    it('states board.store.missing, keeps Execution progress, and never creates the store', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        const storePath = storeDbPath();
        // Read the Board's own progress projection first: Execution progress comes from Spur, so a
        // missing store must not change what the tab renders.
        const progress = (await (await fetch(`${boardOrigin}/api/runs/r-a/progress`)).json()) as {
            states?: unknown[];
        };
        const recorded = Array.isArray(progress.states) ? progress.states.length : 0;
        const away = `${storePath}.away`;
        renameSync(storePath, away);
        try {
            // Run Details is the store-backed tab: it states the diagnostic instead of a zero.
            await openModule('kk-collect', query({ run: 'r-a', tab: 'runs' }));
            await waitForRunOption('r-a');
            const diagnostic = view.locator('.kk-collect-overview .kk-board-diagnostic').first();
            await diagnostic.waitFor();
            expect(await diagnostic.innerText()).toContain('no kk store at .works/kk.db');
            expect(await view.locator('.kk-collect-banner-value').first().innerText()).toContain('unknown');
            // Execution progress still renders its recorded states (or its explicit absence line) in the modal.
            await overviewRow('r-a').getByRole('button', { name: 'Inspect' }).click();
            await view.locator('.kk-modal-card').waitFor();
            const panel = view.locator('.kk-modal-card');
            if (recorded > 0) {
                await panel.locator('.kk-board-progress li').first().waitFor({ state: 'attached', timeout: 15_000 });
                expect(await panel.locator('.kk-board-progress li').count()).toBeGreaterThanOrEqual(recorded);
            }
            expect(await panel.locator('.kk-board-progress').innerText()).not.toContain('no kk store at .works/kk.db');
            await view.locator('.kk-modal-footer').getByRole('button', { name: 'Close' }).click();
            await view.locator('.kk-modal-backdrop').waitFor({ state: 'detached' });
            // The read must not create the file an open would otherwise materialize.
            expect(existsSync(storePath)).toBe(false);
        } finally {
            renameSync(away, storePath);
        }
    }, 30_000);
});

describe('Collect channel yield over a seeded store (0319)', () => {
    it('serves both aggregate tables from one read-only route', async () => {
        if (!ready) throw new Error('setup did not complete');
        const now = Date.now();
        const dayMs = 86_400_000;
        const response = await readerFetch(
            `/api/workflows/kk-collect/store/channels?from=${now - 14 * dayMs}&until=${now + dayMs}&page=1`,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            availability: string;
            sources: string[];
            plugins: string[];
            bySource: Record<string, number>;
            byDay: { day: string; total: number; sources: Record<string, number> }[];
            runsByDay: { day: string; runs: number; plugins: Record<string, number> | null }[];
            lastPositiveAt: Record<string, number | null>;
        };
        expect(body.availability).toBe('available');
        expect(body.sources).toEqual(['aihot-ingest', 'horizon-ingest']);
        // 20 seeded collect items + the 5 daily-supply items seeded 2 h before d-funnel's start
        // (G82/0320) fall inside this 14-day window.
        expect(body.bySource).toEqual({ 'aihot-ingest': 25, 'horizon-ingest': 7 });
        expect(body.byDay.reduce((sum, day) => sum + day.total, 0)).toBe(32);
        expect(body.plugins).toContain('aihot-ingest');
        expect(body.plugins).toContain('horizon-ingest');
        expect(body.lastPositiveAt['aihot-ingest']).not.toBeNull();
        const tickTotals = body.runsByDay.reduce(
            (acc, day) => {
                if (day.plugins === null) return acc;
                for (const [plugin, count] of Object.entries(day.plugins)) acc[plugin] = (acc[plugin] ?? 0) + count;
                return acc;
            },
            {} as Record<string, number>,
        );
        expect(tickTotals['aihot-ingest']).toBeGreaterThanOrEqual(20);
        expect(tickTotals['horizon-ingest']).toBeGreaterThanOrEqual(7);
    }, 30_000);

    it('renders the two Summary tables, drops label/yield tiles, and keeps range on reload', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        await openModule('kk-collect', query({ tab: 'summary', range: '7d' }));
        await view.waitForSelector('.kk-channel-yield-table');
        await view.waitForSelector('.kk-plugin-run-table');
        expect(new URL(view.url()).searchParams.get('range')).toBe('7d');
        const text = await view.locator('.kk-collect-overview').innerText();
        expect(text).toContain('New items by day and source');
        expect(text).toContain('Collection ticks and plugin contributions');
        expect(text).not.toContain('Label Decisions');
        expect(text).not.toContain('Selection Yield');
        await view.reload({ waitUntil: 'domcontentloaded' });
        await view.waitForSelector('.kk-channel-yield-table');
        expect(new URL(view.url()).searchParams.get('range')).toBe('7d');
        expect(new URL(view.url()).searchParams.get('tab')).toBe('summary');
    }, 30_000);

    it('pages the All aggregate at 30 days per page', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        await openModule('kk-collect', query({ tab: 'summary', range: 'All' }));
        await view.waitForSelector('.kk-channel-yield-table');
        // 36 tick days (r-a plus 35 seeded) exceed one 30-day page.
        await view.waitForSelector('.kk-collect-pager');
        const pager = view.locator('.kk-collect-pager');
        expect(await pager.innerText()).toContain('Page 1 of');
        expect(await pager.innerText()).toContain('days');
        await pager.getByRole('button', { name: 'Next' }).click();
        await view.waitForFunction(
            () => document.querySelector('.kk-collect-pager')?.textContent?.includes('Page 2 of') ?? false,
            undefined,
            { timeout: 15_000 },
        );
    }, 30_000);

    it('degrades a missing store to a bounded diagnostic on the two panels only', async () => {
        if (!ready || page === null) throw new Error('setup did not complete');
        const view: Page = page;
        const storePath = storeDbPath();
        const away = `${storePath}.away`;
        renameSync(storePath, away);
        try {
            await openModule('kk-collect', query({ tab: 'summary', range: '14d' }));
            const diagnostic = view.locator('.kk-collect-overview .kk-board-diagnostic').first();
            await diagnostic.waitFor();
            expect(await diagnostic.innerText()).toContain('no kk store at .works/kk.db');
            await waitForRunOption('r-a');
            expect(await view.locator('.kk-channel-yield-table').count()).toBe(0);
        } finally {
            renameSync(away, storePath);
        }
    }, 30_000);
});

/**
 * The G82 funnel/supply panels and the 0390 run-centric Summary/Generation/Publishing news views
 * were retired with the run-centric module (G83/0440, feature R2): their layouts no longer exist, so
 * their Chromium cases are gone rather than skipped. The day-centric console's own E2E (Today,
 * Generation, Publishing, History renders plus one previewed action) is task 0443, and the per-run
 * drill-down coverage returns with 0441 on the existing per-run routes. The reader-level assertions
 * these cases also made survive above (`judge confidence vocabulary` keeps the projection round-trip).
 */
