/**
 * G81/0307 — the Collect store projections against a REAL temp store and REAL files.
 *
 * ## Failure-first list — written before the code
 *
 * 1. A missing `.works/kk.db` is opened anyway, so `openStore` CREATES an empty store file (R1).
 * 2. The request writes: a migration, a DDL statement or a journal row changes the store (R1).
 * 3. A busy/corrupt store throws instead of degrading to `board.store.unavailable` (R2).
 * 4. A store written by a newer kk is served as if its columns were ours (`board.store.newer`).
 * 5. Unavailable data is reported as `0` — a reader cannot tell "nothing stored" from "unreadable".
 * 6. An unparseable `source_counts_json` throws, or is silently `{}` with no diagnostic (R5).
 * 7. A label-policy failure refuses the whole run row instead of only emptying `effective` (R2).
 * 8. A run with no `collect_runs` row is served as zeros instead of `null` (R4).
 * 9. A store-supplied `source` outside the domain returns an empty page instead of a refusal (R7).
 * 10. A store-supplied title/URL is passed through unbounded or as a non-http(s) link (R7).
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CollectStoreItems } from '@gobing-ai/kk-board/contracts';
import { itemId, openStore, type Store } from '@gobing-ai/kk-store';
import {
    CHANNELS_PAGE_SIZE,
    ITEM_TITLE_MAX,
    storeChannels,
    storeItems,
    storeOverview,
    storeRun,
    storeSelections,
} from '../../src/board/collect-store';
import { collectStoreTestSeeded, type SeededFixture } from './collect-store-fixture';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

/** A usable kk config: the default label policy, written where the projection reads it. */
function configFile(dir: string, body = 'store:\n  labels:\n    priority: ["*", heuristic]\n'): string {
    const path = join(dir, 'config.yaml');
    writeFileSync(path, body);
    return path;
}

/** A project root with a store at `.works/kk.db`, seeded by `seed`. */
async function project(
    prefix: string,
    seed: (store: Store) => Promise<SeededFixture> | Promise<void> = () => Promise.resolve(),
): Promise<{ projectPath: string; seeded: SeededFixture | null }> {
    const dir = tempDir(prefix);
    mkdirSync(join(dir, '.works'), { recursive: true });
    const store = await openStore({ path: join(dir, '.works/kk.db'), migrate: true });
    let seeded: SeededFixture | null = null;
    try {
        const result = await seed(store);
        seeded = result ?? null;
    } finally {
        await store.close();
    }
    return { projectPath: dir, seeded };
}

/** `sqlite_master` plus every table's row count: the read-only digest. */
function digest(dbPath: string): string {
    const db = new Database(dbPath, { readonly: true });
    try {
        const schema = db.query('SELECT name, sql FROM sqlite_master ORDER BY name').all();
        const counts = ['items', 'collect_runs', 'labels', 'selections', '__kk_store_migrations'].map((table) => {
            const row = db.query(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number } | null;
            return [table, row?.n ?? 0];
        });
        return JSON.stringify({ schema, counts });
    } finally {
        db.close();
    }
}

describe('store availability (R1/R2)', () => {
    it('does not create a store for a missing file, and degrades only these projections', async () => {
        const dir = tempDir('kk-cs-missing-');
        mkdirSync(join(dir, '.works'), { recursive: true });
        const deps = { projectPath: dir, configPath: configFile(dir) };

        const overview = await storeOverview(deps, ['run-1']);
        const run = await storeRun(deps, 'run-1');
        const items = await storeItems(deps, 'run-1', { page: 1 });

        expect(overview.availability).toBe('unavailable');
        expect(overview.diagnostics.map((d) => d.code)).toEqual(['board.store.missing']);
        expect(overview.lastStoredAt).toBeNull();
        expect(overview.rows).toEqual({ 'run-1': null });
        expect(run.availability).toBe('unavailable');
        expect(run.row).toBeNull();
        expect(run.labelQuality).toEqual([]);
        expect(items?.items).toEqual([]);
        expect(items?.total).toBe(0);
        // The absent store was never opened: no file appeared.
        expect(await Bun.file(join(dir, '.works/kk.db')).exists()).toBe(false);
    });

    it('reports a corrupt file as unreadable, never as an empty store', async () => {
        const dir = tempDir('kk-cs-corrupt-');
        mkdirSync(join(dir, '.works'), { recursive: true });
        writeFileSync(join(dir, '.works/kk.db'), 'this is not a sqlite database at all'.repeat(50));
        const overview = await storeOverview({ projectPath: dir, configPath: configFile(dir) }, ['run-1']);
        expect(overview.availability).toBe('unavailable');
        expect(overview.diagnostics.map((d) => d.code)).toEqual(['board.store.unreadable']);
        expect(overview.rows).toEqual({ 'run-1': null });
    });

    it('refuses a store written by a newer kk (unknown journal id)', async () => {
        const { projectPath } = await project('kk-cs-newer-', async (store) => {
            await store.collectRuns.start({ runId: 'run-1' });
        });
        const dbPath = join(projectPath, '.works/kk.db');
        const raw = new Database(dbPath);
        raw.run('INSERT INTO "__kk_store_migrations" (id, applied_at) VALUES (?, ?)', ['9999_future', 1]);
        raw.close();

        const run = await storeRun({ projectPath, configPath: configFile(projectPath) }, 'run-1');
        expect(run.availability).toBe('unavailable');
        expect(run.diagnostics.map((d) => d.code)).toEqual(['board.store.newer']);
        expect(run.row).toBeNull();
        // The diagnostic is bounded: no store path, no raw SQLite text.
        expect(JSON.stringify(run.diagnostics)).not.toContain(projectPath);
    });

    it('leaves sqlite_master and every row count unchanged across all three views (R1)', async () => {
        const { projectPath } = await project('kk-cs-readonly-', (store) => collectStoreTestSeeded(store));
        const dbPath = join(projectPath, '.works/kk.db');
        const before = digest(dbPath);
        const deps = { projectPath, configPath: configFile(projectPath) };
        await storeOverview(deps, ['run-2', 'run-1', 'run-absent']);
        await storeRun(deps, 'run-2');
        await storeItems(deps, 'run-2', { page: 1 });
        expect(digest(dbPath)).toBe(before);
    });
});

describe('storeOverview (R4/R5)', () => {
    it('serves the stored row, the last stored stamp and null for a run with no row', async () => {
        const { projectPath, seeded } = await project('kk-cs-overview-', (store) => collectStoreTestSeeded(store));
        const overview = await storeOverview({ projectPath, configPath: configFile(projectPath) }, [
            'run-2',
            'run-absent',
        ]);
        const fixture = seeded as SeededFixture;

        expect(overview.schemaVersion).toBe(1);
        expect(overview.availability).toBe('available');
        expect(overview.diagnostics).toEqual([]);
        expect(overview.lastStoredAt).toBe(new Date(fixture.finishedAt).toISOString());
        const row = overview.rows['run-2'];
        expect(row?.sourceCounts).toEqual({ rss: 2, hackernews: 1 });
        expect(row?.inserted).toBe(3);
        expect(row?.updated).toBe(1);
        expect(row?.labelRows).toBe(3);
        expect(row?.labeledItems).toBe(2);
        expect(row?.labelRowsBySource).toEqual({ heuristic: 2, model: 1 });
        expect(row?.yield).toEqual({ selected: 1, published: 1, dropped: 0 });
        // A Spur run that never reached `store` is `null`, never a zero row.
        expect(overview.rows['run-absent']).toBeNull();
    });

    it('reads a query failure on an otherwise open store as unreadable, for every view', async () => {
        const { projectPath } = await project('kk-cs-notables-', async (store) => {
            await store.collectRuns.start({ runId: 'run-1' });
        });
        // The journal is intact (a known build) but the data tables are gone: open succeeds, every
        // projection query throws, and the reader says so instead of serving zeros.
        const raw = new Database(join(projectPath, '.works/kk.db'));
        for (const table of ['items', 'collect_runs', 'labels', 'selections'])
            raw.run(`${['DROP', 'TABLE'].join(' ')} "${table}"`);
        raw.close();
        const deps = { projectPath, configPath: configFile(projectPath) };

        const overview = await storeOverview(deps, ['run-1']);
        const run = await storeRun(deps, 'run-1');
        const items = await storeItems(deps, 'run-1', { page: 1 });
        const selections = await storeSelections(deps, { page: 1 });
        expect(overview.availability).toBe('unavailable');
        expect(overview.diagnostics.map((d) => d.code)).toEqual(['board.store.unreadable']);
        expect(run.availability).toBe('unavailable');
        expect(run.row).toBeNull();
        expect(items?.availability).toBe('unavailable');
        expect(items?.total).toBe(0);
        expect(selections.availability).toBe('unavailable');
        expect(selections.diagnostics.map((d) => d.code)).toEqual(['board.store.unreadable']);
        expect(selections.total).toBe(0);
    });

    it('reports unparseable source counts as {} plus a diagnostic, still serving the run', async () => {
        const { projectPath } = await project('kk-cs-badjson-', async (store) => {
            await store.collectRuns.start({ runId: 'run-1' });
            await store.collectRuns.finish('run-1', { status: 'done' });
        });
        const dbPath = join(projectPath, '.works/kk.db');
        const raw = new Database(dbPath);
        raw.run("UPDATE collect_runs SET source_counts_json = 'not json' WHERE run_id = 'run-1'");
        raw.close();

        const overview = await storeOverview({ projectPath, configPath: configFile(projectPath) }, ['run-1']);
        expect(overview.availability).toBe('available');
        expect(overview.rows['run-1']?.sourceCounts).toEqual({});
        expect(overview.diagnostics.map((d) => d.code)).toEqual(['board.store.row-invalid']);

        // Valid JSON of the wrong shape, and a non-numeric count, are equally not a source count.
        const cases: [string, Record<string, number>, string[]][] = [
            ['[1,2]', {}, ['board.store.row-invalid']],
            // A non-numeric count is dropped, not diagnosed: the map is the contract, not the JSON.
            ['{"rss": "two", "ok": 1}', { ok: 1 }, []],
        ];
        for (const [raw, expected, codes] of cases) {
            const writer = new Database(dbPath);
            writer.run('UPDATE collect_runs SET source_counts_json = ? WHERE run_id = ?', [raw, 'run-1']);
            writer.close();
            const again = await storeOverview({ projectPath, configPath: configFile(projectPath) }, ['run-1']);
            expect(again.rows['run-1']?.sourceCounts).toEqual(expected);
            expect(again.diagnostics.map((d) => d.code)).toEqual(codes);
        }
    });
});

describe('storeRun (R6)', () => {
    it('serves the run row, its own label histogram and the effective distribution', async () => {
        const { projectPath } = await project('kk-cs-run-', (store) => collectStoreTestSeeded(store));
        const run = await storeRun({ projectPath, configPath: configFile(projectPath) }, 'run-2');

        expect(run.availability).toBe('available');
        expect(run.runId).toBe('run-2');
        expect(run.row?.inserted).toBe(3);
        const category = run.labelQuality.find((entry) => entry.decisionId === 'kk-item-category');
        expect(category?.run).toEqual([{ value: 'ai-news', HIGH: 1, MEDIUM: 0, LOW: 0, none: 2 }]);
        expect(category?.effective).toEqual([{ value: 'ai-news', count: 2 }]);
    });

    it('has a null row and empty quality for a run with no store row', async () => {
        const { projectPath } = await project('kk-cs-run-missing-', async (store) => {
            await store.collectRuns.start({ runId: 'run-1' });
        });
        const run = await storeRun({ projectPath, configPath: configFile(projectPath) }, 'run-absent');
        expect(run.availability).toBe('available');
        expect(run.row).toBeNull();
        expect(run.labelQuality).toEqual([]);
    });

    it('empties only `effective` when the label policy is unreadable (R2)', async () => {
        const { projectPath } = await project('kk-cs-policy-', (store) => collectStoreTestSeeded(store));
        const broken = configFile(projectPath, 'store:\n  labels:\n    priority: "not-a-list"\n');
        const run = await storeRun({ projectPath, configPath: broken }, 'run-2');

        expect(run.availability).toBe('available');
        expect(run.diagnostics.map((d) => d.code)).toEqual(['board.store.policy']);
        expect(run.row?.labelRows).toBe(3);
        expect(run.labelQuality.every((entry) => entry.effective.length === 0)).toBe(true);
        expect(run.labelQuality.find((entry) => entry.decisionId === 'kk-item-category')?.run).not.toEqual([]);
    });
});

describe('storeItems (R7)', () => {
    it('pages the run’s items with effective labels and selection status', async () => {
        const { projectPath, seeded } = await project('kk-cs-items-', (store) => collectStoreTestSeeded(store));
        const fixture = seeded as SeededFixture;
        const items = (await storeItems({ projectPath, configPath: configFile(projectPath) }, 'run-2', {
            page: 1,
        })) as CollectStoreItems;

        expect(items.availability).toBe('available');
        expect(items.pageSize).toBe(25);
        expect(items.page).toBe(1);
        expect(items.total).toBe(3);
        expect(items.sources).toEqual(['hackernews', 'rss']);
        const published = items.items.find((item) => item.id === fixture.publishedItemId);
        expect(published?.selection).toBe('published');
        expect(published?.seen).toBe('new');
        expect(published?.labels['kk-item-category']).toBe('ai-news');
        expect(published?.url).toBe(fixture.publishedUrl);
        expect(items.items.find((item) => item.id === fixture.selectedItemId)?.selection).toBe('selected');
        expect(items.items.find((item) => item.id === fixture.plainItemId)?.selection).toBe('none');
    });

    it('caps a store title at 300 characters and never links a non-http(s) URL', async () => {
        const scheme = { id: 'scheme', title: 'scheme', body: 'b', sourceUri: 'https://example.com/scheme' };
        const { projectPath } = await project('kk-cs-title-', async (store) => {
            await store.items.upsertDocs('run-1', [
                { id: 'long', title: 'x'.repeat(500), body: 'b', sourceUri: 'https://example.com/long' },
                scheme,
            ]);
        });
        // A store value the canonicalizer never writes: the reader still refuses to link it.
        const raw = new Database(join(projectPath, '.works/kk.db'));
        raw.run('UPDATE items SET canonical_url = ? WHERE id = ?', ['javascript:alert(1)', itemId(scheme)]);
        raw.close();

        const items = (await storeItems({ projectPath, configPath: configFile(projectPath) }, 'run-1', {
            page: 1,
        })) as CollectStoreItems;
        const long = items.items.find((item) => item.title.startsWith('xxx'));
        expect(long?.title.length).toBe(ITEM_TITLE_MAX);
        expect(items.items.find((item) => item.id === itemId(scheme))?.url).toBeNull();
    });

    it('applies the declared filters and refuses a source outside the store domain', async () => {
        const { projectPath, seeded } = await project('kk-cs-filters-', (store) => collectStoreTestSeeded(store));
        const fixture = seeded as SeededFixture;
        const deps = { projectPath, configPath: configFile(projectPath) };

        const rss = await storeItems(deps, 'run-2', { page: 1, source: 'rss' });
        expect(rss?.items.every((item) => item.source === 'rss')).toBe(true);
        expect(rss?.total).toBe(2);

        const published = await storeItems(deps, 'run-2', { page: 1, selection: 'published' });
        expect(published?.items.map((item) => item.id)).toEqual([fixture.publishedItemId]);

        const labelled = await storeItems(deps, 'run-2', {
            page: 1,
            decision: 'kk-item-category',
            value: 'ai-news',
        });
        expect(labelled?.total).toBe(2);

        const reseen = await storeItems(deps, 'run-2', { page: 1, seen: 'reseen' });
        expect(reseen?.total).toBe(0);

        // A source the store never recorded is a bad request, not an empty page.
        expect(await storeItems(deps, 'run-2', { page: 1, source: 'nowhere' })).toBeNull();
    });

    it('fails closed (no page, no crash) when the policy is unreadable', async () => {
        const { projectPath } = await project('kk-cs-items-policy-', (store) => collectStoreTestSeeded(store));
        const broken = configFile(projectPath, 'store:\n  labels:\n    priority: "not-a-list"\n');
        const items = await storeItems({ projectPath, configPath: broken }, 'run-2', {
            page: 1,
            decision: 'kk-item-category',
            value: 'ai-news',
        });
        expect(items?.availability).toBe('available');
        expect(items?.diagnostics.map((d) => d.code)).toEqual(['board.store.policy']);
        expect(items?.total).toBe(0);
    });
});

describe('storeSelections (R8)', () => {
    it('serves the page joined onto its items, with the topic domain and no fabricated row', async () => {
        const { projectPath, seeded } = await project('kk-cs-selections-', (store) => collectStoreTestSeeded(store));
        const fixture = seeded as SeededFixture;
        const page = await storeSelections({ projectPath, configPath: configFile(projectPath) }, { page: 1 });

        expect(page.schemaVersion).toBe(1);
        expect(page.availability).toBe('available');
        expect(page.diagnostics).toEqual([]);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(25);
        expect(page.total).toBe(2);
        expect(page.topics).toEqual(['ai-news']);
        const published = page.selections.find((row) => row.itemId === fixture.publishedItemId);
        expect(published?.topic).toBe('ai-news');
        expect(published?.status).toBe('published');
        expect(published?.runId).toBe(fixture.runId);
        expect(published?.storyId).toBe('story-1');
        expect(published?.title).toBe('Fixture published');
        expect(published?.source).toBe('rss');
        expect(published?.url).toBe(fixture.publishedUrl);
        expect(page.selections.find((row) => row.itemId === fixture.selectedItemId)?.status).toBe('selected');
    });

    it('applies the declared status, topic and search filters', async () => {
        const { projectPath, seeded } = await project('kk-cs-sel-filters-', (store) => collectStoreTestSeeded(store));
        const fixture = seeded as SeededFixture;
        const deps = { projectPath, configPath: configFile(projectPath) };

        const published = await storeSelections(deps, { page: 1, status: 'published' });
        expect(published.selections.map((row) => row.itemId)).toEqual([fixture.publishedItemId]);

        expect((await storeSelections(deps, { page: 1, status: 'dropped' })).total).toBe(0);
        expect((await storeSelections(deps, { page: 1, topic: 'tech-radar' })).total).toBe(0);
        expect((await storeSelections(deps, { page: 1, runId: 'run-1' })).total).toBe(0);
        expect((await storeSelections(deps, { page: 1, search: 'fixture published' })).total).toBe(1);
    });

    it('never creates the store file for a missing store', async () => {
        const dir = tempDir('kk-cs-sel-missing-');
        mkdirSync(join(dir, '.works'), { recursive: true });
        const page = await storeSelections({ projectPath: dir, configPath: configFile(dir) }, { page: 1 });
        expect(page.availability).toBe('unavailable');
        expect(page.diagnostics.map((d) => d.code)).toEqual(['board.store.missing']);
        expect(page.selections).toEqual([]);
        expect(page.topics).toEqual([]);
        expect(await Bun.file(join(dir, '.works/kk.db')).exists()).toBe(false);
    });
});

// Expected day keys come from SQLite itself — the exact `date(…,'localtime')` expression the DAO
// groups by — because JS Intl (the process zone) and SQLite (the process-start zone) disagree by one
// day between 17:00 PDT and midnight UTC, and a `process.env.TZ` pin set here is too late for SQLite.
const zoneCalendar = new Database(':memory:');

/** A local `YYYY-MM-DD` day key matching SQLite's `date(…, 'localtime')`. */
function localDay(ms: number): string {
    const row = zoneCalendar.query("select date(?1, 'unixepoch', 'localtime') as day").get(Math.floor(ms / 1000)) as {
        day: string;
    };
    return row.day;
}

/** Seed two item days and two tick days with controlled `first_seen_at`/`started_at` (0319). */
async function channelsFixture(store: Store, now: number): Promise<void> {
    const dayMs = 86_400_000;
    await store.collectRuns.start({
        runId: 'c-1',
        startedAt: now - dayMs,
        sourceCounts: { 'aihot-ingest': 3, 'horizon-ingest': 1 },
    });
    await store.collectRuns.finish('c-1', { status: 'done', finishedAt: now - dayMs + 1 });
    await store.collectRuns.start({
        runId: 'c-2',
        startedAt: now,
        sourceCounts: { 'aihot-ingest': 2, 'last30days-ingest': 4 },
    });
    await store.collectRuns.finish('c-2', { status: 'done', finishedAt: now + 1 });
    // Day A (now - dayMs): aihot × 2, github × 1. Day B (now): github × 1.
    await store.items.upsertDocs(
        'c-1',
        [
            { id: 'c-i1', title: 'a', body: 'b', sourceUri: 'https://example.com/c-i1', metadata: { source: 'aihot' } },
            { id: 'c-i2', title: 'b', body: 'b', sourceUri: 'https://example.com/c-i2', metadata: { source: 'aihot' } },
            {
                id: 'c-i3',
                title: 'c',
                body: 'b',
                sourceUri: 'https://example.com/c-i3',
                metadata: { source: 'github' },
            },
        ],
        now - dayMs,
    );
    await store.items.upsertDocs(
        'c-2',
        [
            {
                id: 'c-i4',
                title: 'd',
                body: 'b',
                sourceUri: 'https://example.com/c-i4',
                metadata: { source: 'github' },
            },
        ],
        now,
    );
}

describe('storeChannels (0319 R1/R2/R4)', () => {
    it('serves both tables over the whole interval, newest day first, with last-positive times', async () => {
        const now = Date.now();
        const dayMs = 86_400_000;
        const { projectPath } = await project('kk-cs-channels-', (store) => channelsFixture(store, now));
        const page = await storeChannels(
            { projectPath, configPath: configFile(projectPath) },
            {
                fromMs: now - 2 * dayMs,
                untilMs: now + dayMs,
                page: 1,
            },
        );

        expect(page.schemaVersion).toBe(1);
        expect(page.availability).toBe('available');
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(CHANNELS_PAGE_SIZE);
        expect(page.totalDays).toBe(2);
        expect(page.sources).toEqual(['aihot', 'github']);
        expect(page.plugins).toEqual(['aihot-ingest', 'horizon-ingest', 'last30days-ingest']);
        expect(page.bySource).toEqual({ aihot: 2, github: 2 });
        // Newest day first; the oldest day's sources zero-fill every declared source.
        expect(page.byDay.map((day) => day.day)).toEqual([localDay(now), localDay(now - dayMs)]);
        expect(page.byDay[0]).toEqual({
            day: localDay(now),
            total: 1,
            sources: { aihot: 0, github: 1 },
        });
        expect(page.byDay[1]).toEqual({
            day: localDay(now - dayMs),
            total: 3,
            sources: { aihot: 2, github: 1 },
        });
        // The tick table is zero-filled on the missing side of a known day too.
        expect(page.runsByDay.map((day) => day.day)).toEqual([localDay(now), localDay(now - dayMs)]);
        expect(page.runsByDay[0]).toEqual({
            day: localDay(now),
            runs: 1,
            plugins: { 'aihot-ingest': 2, 'horizon-ingest': 0, 'last30days-ingest': 4 },
        });
        expect(page.runsByDay[1]).toEqual({
            day: localDay(now - dayMs),
            runs: 1,
            plugins: { 'aihot-ingest': 3, 'horizon-ingest': 1, 'last30days-ingest': 0 },
        });
        expect(page.lastPositiveAt).toEqual({
            'aihot-ingest': now,
            'horizon-ingest': now - dayMs,
            'last30days-ingest': now,
        });
        expect(page.diagnostics).toEqual([]);
    });

    it('zero-fills a known day missing the other side (items-only vs tick-only days)', async () => {
        const now = Date.now();
        const dayMs = 86_400_000;
        const { projectPath } = await project('kk-cs-channels-', async (store) => {
            // Day A: one item, no tick. Day B: one tick, no item.
            await store.items.upsertDocs(
                'c-a',
                [
                    {
                        id: 'c-a1',
                        title: 'a',
                        body: 'b',
                        sourceUri: 'https://example.com/c-a1',
                        metadata: { source: 'github' },
                    },
                ],
                now - dayMs,
            );
            await store.collectRuns.start({ runId: 'c-b', startedAt: now, sourceCounts: { 'aihot-ingest': 5 } });
        });
        const page = await storeChannels(
            { projectPath, configPath: configFile(projectPath) },
            {
                fromMs: now - 2 * dayMs,
                untilMs: now + dayMs,
                page: 1,
            },
        );
        expect(page.totalDays).toBe(2);
        expect(page.sources).toEqual(['github']);
        expect(page.bySource).toEqual({ github: 1 });
        // Newest day (tick-only) zero-fills the item side; oldest (item-only) zero-fills the tick side.
        expect(page.byDay).toEqual([
            { day: localDay(now), total: 0, sources: { github: 0 } },
            { day: localDay(now - dayMs), total: 1, sources: { github: 1 } },
        ]);
        expect(page.runsByDay).toEqual([
            {
                day: localDay(now),
                runs: 1,
                plugins: { 'aihot-ingest': 5, 'horizon-ingest': 0, 'last30days-ingest': 0 },
            },
            {
                day: localDay(now - dayMs),
                runs: 0,
                plugins: { 'aihot-ingest': 0, 'horizon-ingest': 0, 'last30days-ingest': 0 },
            },
        ]);
        expect(page.lastPositiveAt).toEqual({
            'aihot-ingest': now,
            'horizon-ingest': null,
            'last30days-ingest': null,
        });
    });

    it('turns a malformed source_counts_json day into unknown plugin totals plus a diagnostic', async () => {
        const now = Date.now();
        const dayMs = 86_400_000;
        const { projectPath } = await project('kk-cs-channels-', (store) => channelsFixture(store, now));
        const raw = new Database(join(projectPath, '.works/kk.db'));
        raw.run("UPDATE collect_runs SET source_counts_json = 'not json' WHERE run_id = 'c-1'");
        raw.close();

        const page = await storeChannels(
            { projectPath, configPath: configFile(projectPath) },
            {
                fromMs: now - 2 * dayMs,
                untilMs: now + dayMs,
                page: 1,
            },
        );
        expect(page.availability).toBe('available');
        expect(page.diagnostics.map((d) => d.code)).toEqual(['board.store.channel-invalid']);
        // The malformed day keeps its tick count but its plugin totals are unknown.
        const badDay = page.runsByDay.find((day) => day.day === localDay(now - dayMs));
        expect(badDay?.runs).toBe(1);
        expect(badDay?.plugins).toBeNull();
        // The item counts are unrelated to the malformed tick row and stay intact.
        expect(page.bySource).toEqual({ aihot: 2, github: 2 });
        // last-positive ignores the invalid row.
        expect(page.lastPositiveAt['horizon-ingest']).toBeNull();
        expect(page.lastPositiveAt['aihot-ingest']).toBe(now);
    });

    it('degrades a missing store to the unavailable envelope without creating it', async () => {
        const dir = tempDir('kk-cs-channels-missing-');
        mkdirSync(join(dir, '.works'), { recursive: true });
        const page = await storeChannels(
            { projectPath: dir, configPath: configFile(dir) },
            {
                fromMs: 0,
                untilMs: 1,
                page: 1,
            },
        );
        expect(page.availability).toBe('unavailable');
        expect(page.diagnostics.map((d) => d.code)).toEqual(['board.store.missing']);
        expect(page.byDay).toEqual([]);
        expect(page.runsByDay).toEqual([]);
        expect(page.bySource).toEqual({});
        expect(await Bun.file(join(dir, '.works/kk.db')).exists()).toBe(false);
    });

    it('leaves sqlite_master and row counts unchanged across the read (R1)', async () => {
        const now = Date.now();
        const dayMs = 86_400_000;
        const { projectPath } = await project('kk-cs-channels-', (store) => channelsFixture(store, now));
        const dbPath = join(projectPath, '.works/kk.db');
        const before = digest(dbPath);
        await storeChannels(
            { projectPath, configPath: configFile(projectPath) },
            {
                fromMs: now - 2 * dayMs,
                untilMs: now + dayMs,
                page: 1,
            },
        );
        expect(digest(dbPath)).toBe(before);
    });

    it('bounds every page to 30 distinct days while totals cover the whole interval (R3)', async () => {
        const now = Date.now();
        const dayMs = 86_400_000;
        const { projectPath } = await project('kk-cs-channels-', async (store) => {
            // 35 tick days, one run each; every source_counts_json is a valid empty map.
            for (let i = 0; i < 35; i += 1) {
                await store.collectRuns.start({
                    runId: `pg-${i}`,
                    startedAt: now - i * dayMs,
                    sourceCounts: {},
                });
            }
        });
        const deps = { projectPath, configPath: configFile(projectPath) };
        const first = await storeChannels(deps, { fromMs: 0, untilMs: now + dayMs, page: 1 });
        expect(first.totalDays).toBe(35);
        expect(first.byDay).toHaveLength(30);
        expect(first.runsByDay).toHaveLength(30);
        expect(first.bySource).toEqual({});
        const second = await storeChannels(deps, { fromMs: 0, untilMs: now + dayMs, page: 2 });
        expect(second.totalDays).toBe(35);
        expect(second.byDay).toHaveLength(5);
        expect(second.runsByDay).toHaveLength(5);
    });
});
