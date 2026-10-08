/**
 * Task 0208 — the `kk-collect` standalone collection E2E.
 *
 * Failure-first list (written before the code):
 * 1. lock held by another run → `lock` writes `<work_dir>/lock.json` saying skipped, the guard
 *    routes to the `skipped` terminal, and nothing is collected or stored (single-flight);
 * 2. a lock left behind by a crashed run, older than its TTL → reclaimed and acquired;
 * 3. a lock still inside its TTL → NOT reclaimed (skipped, naming its holder);
 * 4. a lock held by the asking run → re-entrant acquire succeeds;
 * 5. `release` by a run that does not own the lock → the holder keeps it (`released: false`);
 * 6. one fan-in source failing → the run continues with the surviving sources' docs;
 * 7. every source failing → fan-in exits 1 → `collect` fails → `release-failed` releases the
 *    lock and the run ends `failed` (the lock must never be left behind);
 * 8. an empty `Doc[]` → ingest reports 0/0/0 and writes an empty new-ids list;
 * 9. a store failure → `store` routes to `release-failed`, so the lock is released and the run
 *    ends `failed`;
 * 10. re-collecting a stored item whose body changed → `updated: 1`, one `items` row, and the
 *    item id is in `new-ids.json` (its labels were invalidated);
 * 11. re-collecting an unchanged item → `unchanged`, no duplicate row, not in `new-ids.json`;
 * 12. `kk store ingest` on an unreadable or schema-invalid `--in` → exit 1, no store writes.
 *
 * The real workflow runs against fake ingestion plugins (a `KK_PLUGIN_PATH` root shadowing the
 * shipped ingestion names through ADR-012 root precedence) and a temp `store.db_path`, so
 * nothing touches the network or the operator's store. The DB plus the ledger are copied to
 * `.works/test-artifacts/0208/`.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId } from '@gobing-ai/kk-store';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const CLI = join(REPO, 'apps/cli/src/index.ts');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-collect.yaml');
const ARTIFACT_DIR = join(REPO, '.works/test-artifacts/0208');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** Run `kk …` in-process, returning the exit code plus the captured echo/echoError output. */
async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

/**
 * Run `kk …` as a child process from `cwd` — the way a scheduler invokes it. Needed for the
 * commands that resolve the run's `.spur` records and `.works` tree relative to their cwd
 * (`kk ledger append` spawns `spur workflow trace`).
 */
function kkIn(cwd: string, args: string[]): number {
    const result = Bun.spawnSync([process.execPath, CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return result.exitCode ?? 1;
}

/** Copy one run's evidence into `.works/test-artifacts/0208/` for later inspection. */
function saveArtifact(name: string, content: string | Uint8Array): void {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, name), content);
}

/** A `kk` PATH shim so the workflow's shell actions run this checkout's source entry. */
function withKkShim<T>(fn: () => T): T {
    const binDir = tempDir('kk-collect-bin-');
    writeFileSync(join(binDir, 'kk'), `#!/bin/bash\nexec ${process.execPath} ${CLI} "$@"\n`);
    chmodSync(join(binDir, 'kk'), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ''}`;
    try {
        return fn();
    } finally {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
    }
}

/** One Doc for the fake sources: identity is content-addressed (`itemId`), not the `id` field. */
function doc(id: string, body: string): Doc {
    return { id, body, title: id, sourceUri: `https://example.com/${id}`, metadata: { source: 'fake' } };
}

/** The store's identity for the fake source `https://example.com/<id>` (sha256 of its canonical URL). */
function storeId(id: string): string {
    return itemId({ body: '', sourceUri: `https://example.com/${id}` } as Doc);
}

/**
 * A fake ingestion plugin tree: three plugins whose entry copies its sibling `docs.json` to
 * `--out`, so one run's collected docs are test data. Installed as a `KK_PLUGIN_PATH` root,
 * which ADR-012 ranks above the project and built-in roots — the shipped names are shadowed.
 *
 * `options.fail` names plugins whose entry exits 1 instead, which is how the degraded-source and
 * all-sources-failed paths are exercised without touching the network.
 */
function fakePlugins(root: string, docs: unknown[], options: { fail?: readonly string[] } = {}): void {
    for (const name of ['aihot-ingest', 'last30days-ingest', 'horizon-ingest']) {
        const dir = join(root, 'ingestions', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'plugin.json'),
            JSON.stringify({ name, kind: 'ingestion', entry: './index.ts', version: '1.0.0' }),
        );
        const entry = options.fail?.includes(name)
            ? [`console.error('fake ${name}: source unavailable');`, `process.exit(1);`, '']
            : [
                  `const outIndex = process.argv.indexOf('--out');`,
                  `const out = process.argv[outIndex + 1] ?? '';`,
                  `await Bun.write(out, await Bun.file(new URL('./docs.json', import.meta.url)).text());`,
                  '',
              ];
        writeFileSync(join(dir, 'index.ts'), entry.join('\n'));
        writeFileSync(join(dir, 'docs.json'), JSON.stringify(docs));
    }
}

interface WorkflowRun {
    code: number;
    summary: { status?: string; finalState?: string };
    stderr: string;
}

/** Run `spur workflow run <kk-collect.yaml>` for real (no `--dry-run`) from `cwd`. */
function runWorkflow(
    cwd: string,
    runId: string,
    stamp: string,
    env: Record<string, string | undefined>,
    vars: Record<string, string> = {},
): WorkflowRun {
    const result = Bun.spawnSync(
        [
            'spur',
            'workflow',
            'run',
            WORKFLOW,
            '--run-id',
            runId,
            '--json',
            '--vars',
            JSON.stringify({ stamp, ...vars }),
        ],
        { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' },
    );
    let summary: { status?: string; finalState?: string } = {};
    try {
        summary = JSON.parse(result.stdout.toString()) as { status?: string; finalState?: string };
    } catch {
        summary = {};
    }
    return { code: result.exitCode ?? 1, summary, stderr: result.stderr.toString() };
}

describe('kk store lock (0208 R1)', () => {
    it('acquires, is single-flight inside the TTL, reclaims past the TTL and releases only its own', async () => {
        const dir = tempDir('kk-collect-lock-');
        const db = join(dir, 'kk.db');

        const first = await run(['store', 'lock', 'acquire', '--name', 'collect', '--run', 'run-a', '--db', db]);
        expect(first.code).toBe(0);
        expect(JSON.parse(first.out)).toEqual({ acquired: true });

        // A different run inside the TTL is skipped, naming the holder.
        const second = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'run-b',
            '--ttl',
            '21600000',
            '--db',
            db,
        ]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.out)).toEqual({ skipped: 'locked', holder: 'run-a' });

        // The same run re-acquires (re-entrant): a resumed run is not locked out of itself.
        const reentrant = await run(['store', 'lock', 'acquire', '--name', 'collect', '--run', 'run-a', '--db', db]);
        expect(reentrant.code).toBe(0);
        expect(JSON.parse(reentrant.out)).toEqual({ acquired: true });

        // Another run's release frees nothing.
        const foreign = await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(foreign.code).toBe(0);
        expect(JSON.parse(foreign.out)).toEqual({ released: false });
        const stillHeld = await run(['store', 'lock', 'acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(JSON.parse(stillHeld.out)).toEqual({ skipped: 'locked', holder: 'run-a' });

        // A claim is stale on its OWN recorded TTL, not on the asker's: run-a takes a 0 ms claim,
        // so the next run reclaims it — that is the crashed-holder path.
        const own = await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'run-a', '--db', db]);
        expect(own.code).toBe(0);
        expect(JSON.parse(own.out)).toEqual({ released: true });
        const stale = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'run-a',
            '--ttl',
            '0',
            '--db',
            db,
        ]);
        expect(JSON.parse(stale.out)).toEqual({ acquired: true });
        const reclaim = await run(['store', 'lock', 'acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(reclaim.code).toBe(0);
        expect(JSON.parse(reclaim.out)).toEqual({ acquired: true });
        const afterRelease = await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(JSON.parse(afterRelease.out)).toEqual({ released: true });

        // A malformed TTL is a usage failure, never a silent default.
        const badTtl = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'run-c',
            '--ttl',
            'soon',
            '--db',
            db,
        ]);
        expect(badTtl.code).toBe(1);
        expect(badTtl.err).toContain('kk.store.lock.failed');
        expect(badTtl.out).toBe('');

        saveArtifact(
            'store-lock-contract.json',
            `${JSON.stringify(
                {
                    acquire: JSON.parse(first.out),
                    skipped: JSON.parse(second.out),
                    reentrant: JSON.parse(reentrant.out),
                    foreignRelease: JSON.parse(foreign.out),
                    reclaimed: JSON.parse(reclaim.out),
                    ownRelease: JSON.parse(own.out),
                    staleTtl: JSON.parse(stale.out),
                },
                null,
                2,
            )}\n`,
        );
    });
});

describe('kk store ingest (0208 R2)', () => {
    it('persists a Doc[] into items + collect_runs and reports {inserted, updated, unchanged}', async () => {
        const dir = tempDir('kk-collect-ingest-');
        const db = join(dir, 'kk.db');
        const input = join(dir, 'docs.json');
        const newIds = join(dir, 'new-ids.json');
        writeFileSync(input, JSON.stringify([doc('one', 'first body'), doc('two', 'second body')]));

        const first = await run(['store', 'ingest', '--run', 'run-1', '--in', input, '--new-ids', newIds, '--db', db]);
        expect(first.code).toBe(0);
        expect(JSON.parse(first.out)).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
        expect(JSON.parse(readFileSync(newIds, 'utf-8'))).toEqual([storeId('one'), storeId('two')]);

        // Same ids, one edited body → the changed item is updated and label-invalidated.
        writeFileSync(input, JSON.stringify([doc('one', 'first body (edited)'), doc('two', 'second body')]));
        const second = await run(['store', 'ingest', '--run', 'run-2', '--in', input, '--new-ids', newIds, '--db', db]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.out)).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
        expect(JSON.parse(readFileSync(newIds, 'utf-8'))).toEqual([storeId('one')]);

        const raw = new Database(db, { readonly: true });
        const items = raw.query('SELECT id, body, first_seen_run, last_seen_run FROM items ORDER BY id').all();
        const runs = raw.query('SELECT run_id, status, inserted, updated FROM collect_runs ORDER BY run_id').all();
        raw.close();
        expect(items).toEqual([
            { id: storeId('one'), body: 'first body (edited)', first_seen_run: 'run-1', last_seen_run: 'run-2' },
            { id: storeId('two'), body: 'second body', first_seen_run: 'run-1', last_seen_run: 'run-2' },
        ]);
        expect(runs).toEqual([
            { run_id: 'run-1', status: 'done', inserted: 2, updated: 0 },
            { run_id: 'run-2', status: 'done', inserted: 0, updated: 1 },
        ]);

        // An empty Doc[] is a legitimate tick: 0/0/0 and an empty labelling input.
        writeFileSync(input, '[]');
        const empty = await run(['store', 'ingest', '--run', 'run-3', '--in', input, '--new-ids', newIds, '--db', db]);
        expect(empty.code).toBe(0);
        expect(JSON.parse(empty.out)).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
        expect(JSON.parse(readFileSync(newIds, 'utf-8'))).toEqual([]);

        saveArtifact('kk-collect-ingest.db', readFileSync(db));
    });

    it('exits 1 with kk.store.ingest.failed on an unreadable or invalid input, writing no rows', async () => {
        const dir = tempDir('kk-collect-ingest-bad-');
        const db = join(dir, 'kk.db');
        const newIds = join(dir, 'new-ids.json');
        expect((await run(['store', 'migrate', '--db', db])).code).toBe(0);

        const missing = await run([
            'store',
            'ingest',
            '--run',
            'run-x',
            '--in',
            join(dir, 'nope.json'),
            '--new-ids',
            newIds,
            '--db',
            db,
        ]);
        expect(missing.code).toBe(1);
        expect(missing.err).toContain('kk.store.ingest.failed');
        expect(missing.out).toBe('');

        const invalid = join(dir, 'invalid.json');
        writeFileSync(invalid, '{"not":"a doc list"}');
        const bad = await run(['store', 'ingest', '--run', 'run-x', '--in', invalid, '--new-ids', newIds, '--db', db]);
        expect(bad.code).toBe(1);
        expect(bad.err).toContain('kk.store.ingest.failed');
        expect(existsSync(newIds)).toBe(false);

        const raw = new Database(db, { readonly: true });
        const count = raw.query('SELECT COUNT(*) AS n FROM items').get() as { n: number };
        raw.close();
        expect(count.n).toBe(0);
        saveArtifact('store-ingest-failure.txt', `exit: ${bad.code}\nstderr: ${bad.err.trim()}\n`);
    });
});

describe('kk-collect workflow E2E (0208 AC1–AC3)', () => {
    it('stays within the ADR-115 composition limits (no lint findings)', () => {
        const result = Bun.spawnSync(['spur', 'workflow', 'validate', WORKFLOW, '--json', '--no-logo'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const report = JSON.parse(result.stdout.toString()) as { valid: boolean; composition: { findings: unknown[] } };
        expect(report.valid).toBe(true);
        expect(report.composition.findings).toEqual([]);
    });

    it('collects standalone into the store, updates without duplicating, and is single-flight', async () => {
        const root = tempDir('kk-collect-run-');
        const pluginsRoot = join(root, 'fake-plugins');
        const configFile = join(root, 'config.yaml');
        const db = join(root, 'kk.db');
        writeFileSync(configFile, `store:\n  db_path: ${db}\n`);
        const env = {
            KK_PLUGIN_PATH: pluginsRoot,
            KK_CONFIG: configFile,
            SPUR_WORKFLOW_RUN_ACTIVE: undefined,
            SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
        };
        const stampOne = '20261007T0000Z';
        const stampTwo = '20261007T0400Z';
        const stampThree = '20261007T0800Z';
        const workDirOne = join(root, '.works/kk-collect', stampOne);
        const ledger = join(root, '.works/kk-collect/ledger.md');

        fakePlugins(pluginsRoot, [doc('one', 'first body'), doc('two', 'second body'), doc('three', 'third body')]);

        // A topic carrying JSON metacharacters: the source configs must still be valid JSON.
        const topic = 'AI "agents" \\ news';
        const first = withKkShim(() => runWorkflow(root, 'kk-collect-1', stampOne, env, { last30days_topic: topic }));
        expect(first.code, `run 1: ${first.stderr}`).toBe(0);
        expect(first.summary.finalState).toBe('done');
        const ingestConfig = (name: string): unknown =>
            JSON.parse(readFileSync(join(workDirOne, '10-ingest', name), 'utf-8'));
        expect(ingestConfig('source.json')).toEqual({ limit: 10 });
        expect(ingestConfig('last30days.json')).toEqual({ topic });
        expect(ingestConfig('horizon.json')).toEqual({ hours: 4 });

        // AC1 — every collected item is stored, and the lock is released on the normal exit.
        const newIdsOne = JSON.parse(readFileSync(join(workDirOne, 'new-ids.json'), 'utf-8')) as string[];
        expect(newIdsOne.sort()).toEqual([storeId('one'), storeId('three'), storeId('two')].sort());
        const probe = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'probe',
            '--ttl',
            '0',
            '--db',
            db,
        ]);
        expect(JSON.parse(probe.out)).toEqual({ acquired: true });
        const probeRelease = await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'probe', '--db', db]);
        expect(JSON.parse(probeRelease.out)).toEqual({ released: true });

        // Run 2: one item's body changed upstream, the other two are unchanged.
        fakePlugins(pluginsRoot, [
            doc('one', 'first body (v2)'),
            doc('two', 'second body'),
            doc('three', 'third body'),
        ]);
        const second = withKkShim(() => runWorkflow(root, 'kk-collect-2', stampTwo, env));
        expect(second.code, `run 2: ${second.stderr}`).toBe(0);
        expect(second.summary.finalState, `run 2 summary: ${JSON.stringify(second.summary)}`).toBe('done');

        const raw = new Database(db, { readonly: true });
        const items = raw.query('SELECT id, body FROM items ORDER BY id').all();
        const collectRuns = raw
            .query('SELECT run_id, status, inserted, updated FROM collect_runs ORDER BY run_id')
            .all();
        raw.close();
        expect(items).toHaveLength(3); // AC2 — a re-collect updated in place, never duplicated
        const bodyById = new Map((items as Array<{ id: string; body: string }>).map((row) => [row.id, row.body]));
        expect(bodyById.get(storeId('one'))).toBe('first body (v2)'); // the edited item is updated in place
        expect(bodyById.get(storeId('two'))).toBe('second body');
        expect(collectRuns).toEqual([
            { run_id: 'kk-collect-1', status: 'done', inserted: 3, updated: 0 },
            { run_id: 'kk-collect-2', status: 'done', inserted: 0, updated: 1 },
        ]);
        expect(JSON.parse(readFileSync(join(root, '.works/kk-collect', stampTwo, 'new-ids.json'), 'utf-8'))).toEqual([
            storeId('one'),
        ]);

        // The ledger: run 2's `lock` synced finished run 1 (design §7 backfill) and the R7
        // append records a run once it has finished — a run's own `release` state still sees it
        // as running, so the section lands on the next tick's sync.
        expect(readFileSync(ledger, 'utf-8').split('<!-- run:').length - 1).toBe(1);
        expect(kkIn(root, ['ledger', 'append', '--workflow', 'kk-collect', '--run', 'kk-collect-2'])).toBe(0);
        expect(readFileSync(ledger, 'utf-8').split('<!-- run:').length - 1).toBe(2);

        // AC3 — an overlapping run inside the TTL is skipped, with nothing collected or stored.
        const held = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'manual-holder',
            '--ttl',
            '21600000',
            '--db',
            db,
        ]);
        expect(held.code).toBe(0);
        const skipped = withKkShim(() => runWorkflow(root, 'kk-collect-3', stampThree, env));
        expect(skipped.code, `run 3: ${skipped.stderr}`).toBe(0);
        expect(skipped.summary.finalState).toBe('skipped');

        const workDirThree = join(root, '.works/kk-collect', stampThree);
        const lockJson = JSON.parse(readFileSync(join(workDirThree, 'lock.json'), 'utf-8'));
        expect(lockJson).toEqual({ skipped: 'locked', holder: 'manual-holder' });
        expect(existsSync(join(workDirThree, '10-ingest', `${stampThree}_02_collect_blended.json`))).toBe(false);

        const after = new Database(db, { readonly: true });
        const storedRuns = after.query('SELECT COUNT(*) AS n FROM collect_runs').get() as { n: number };
        after.close();
        expect(storedRuns.n).toBe(2); // the skipped tick stored nothing
        await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'manual-holder', '--db', db]);

        saveArtifact('kk-collect.db', readFileSync(db));
        saveArtifact('kk-collect-ledger.md', readFileSync(ledger));
        saveArtifact('kk-collect-lock-skipped.json', `${JSON.stringify(lockJson, null, 2)}\n`);
        saveArtifact(
            'kk-collect-runs.json',
            `${JSON.stringify(
                {
                    first: first.summary,
                    second: second.summary,
                    skipped: skipped.summary,
                    firstNewIds: newIdsOne,
                    items,
                    collectRuns,
                },
                null,
                2,
            )}\n`,
        );
    }, 120_000);

    it('R3/AC3 — a degraded source keeps collecting, an all-sources failure and a store failure both release the lock and end failed', async () => {
        const root = tempDir('kk-collect-fail-');

        // (a) One failed source: fan-in degrades it to an error entry, the surviving sources are stored.
        const degradedPlugins = join(root, 'degraded-plugins');
        const degradedConfig = join(root, 'degraded.yaml');
        const degradedDb = join(root, 'degraded.db');
        writeFileSync(degradedConfig, `store:\n  db_path: ${degradedDb}\n`);
        fakePlugins(degradedPlugins, [doc('one', 'first body'), doc('two', 'second body')], {
            fail: ['horizon-ingest'],
        });
        const degraded = withKkShim(() =>
            runWorkflow(root, 'kk-collect-degraded', '20261007T1200Z', {
                KK_PLUGIN_PATH: degradedPlugins,
                KK_CONFIG: degradedConfig,
                SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
            }),
        );
        expect(degraded.code, `degraded: ${degraded.stderr}`).toBe(0);
        expect(degraded.summary.finalState).toBe('done');
        const degradedRaw = new Database(degradedDb, { readonly: true });
        const degradedItems = degradedRaw.query('SELECT COUNT(*) AS n FROM items').get() as { n: number };
        degradedRaw.close();
        expect(degradedItems.n).toBe(2);

        // (b) Every source fails: fan-in exits 1, the run goes through `release-failed` — failed AND unlocked.
        const deadPlugins = join(root, 'dead-plugins');
        const deadConfig = join(root, 'dead.yaml');
        const deadDb = join(root, 'dead.db');
        writeFileSync(deadConfig, `store:\n  db_path: ${deadDb}\n`);
        fakePlugins(deadPlugins, [], { fail: ['aihot-ingest', 'last30days-ingest', 'horizon-ingest'] });
        const deadEnv = {
            KK_PLUGIN_PATH: deadPlugins,
            KK_CONFIG: deadConfig,
            SPUR_WORKFLOW_RUN_ACTIVE: undefined,
            SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
        };
        const dead = withKkShim(() => runWorkflow(root, 'kk-collect-dead', '20261007T1300Z', deadEnv));
        expect(dead.summary.finalState).toBe('failed');
        const deadLock = await run([
            'store',
            'lock',
            'acquire',
            '--name',
            'collect',
            '--run',
            'probe',
            '--ttl',
            '0',
            '--db',
            deadDb,
        ]);
        expect(JSON.parse(deadLock.out)).toEqual({ acquired: true }); // the failed run released its claim
        expect(existsSync(join(root, '.works/kk-collect/20261007T1300Z', 'new-ids.json'))).toBe(false);

        // (c) A store step that cannot write its labelling input: `store` routes to
        // `release-failed`, so the run still ends failed AND the lock is freed.
        const storePlugins = join(root, 'store-plugins');
        const storeConfig = join(root, 'store.yaml');
        const storeDb = join(root, 'store.db');
        const storeStamp = '20261007T1600Z';
        writeFileSync(storeConfig, `store:\n  db_path: ${storeDb}\n`);
        fakePlugins(storePlugins, [doc('one', 'first body')]);
        // A directory where `--new-ids` must be written: the ingest fails after the items are upserted.
        mkdirSync(join(root, '.works/kk-collect', storeStamp, 'new-ids.json'), { recursive: true });
        const storeEnv = {
            KK_PLUGIN_PATH: storePlugins,
            KK_CONFIG: storeConfig,
            SPUR_WORKFLOW_RUN_ACTIVE: undefined,
            SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
        };
        const storeFailed = withKkShim(() => runWorkflow(root, 'kk-collect-store-failed', storeStamp, storeEnv));
        expect(storeFailed.summary.finalState).toBe('failed');
        // The claim is free again: a fresh tick takes it (only a released or stale claim allows that).
        const afterStoreFailure = withKkShim(() =>
            runWorkflow(root, 'kk-collect-after-store-failure', '20261007T2000Z', storeEnv),
        );
        expect(afterStoreFailure.summary.finalState).toBe('done');

        saveArtifact(
            'kk-collect-failure-paths.json',
            `${JSON.stringify(
                {
                    degraded: degraded.summary,
                    allSourcesFailed: dead.summary,
                    storeFailed: storeFailed.summary,
                    afterStoreFailure: afterStoreFailure.summary,
                },
                null,
                2,
            )}\n`,
        );
    }, 120_000);
});
