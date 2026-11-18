import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId, openStore, type Store } from '@gobing-ai/kk-store';
import { main } from '../src/main';
import { captureOutput } from './capture';

/**
 * Task 0228 — `kk store select` / `mark-published` / `release`, the topic-scoped `selections`
 * ledger that replaces `episode_usage`, and the `kk daily prepare` release hint.
 *
 * ## Failure-first list — written before the code
 *
 * 1. `select` writes nothing, so a planned item is excluded from a later pool even when the run
 *    NEVER publishes (AC1).
 * 2. `select` accepts a third `--in` shape (neither `Doc[]` nor `metadata.docs`) instead of failing
 *    loud as `kk.store.select.failed`.
 * 3. `select` names a doc id the store does not hold and still writes the other rows.
 * 4. `select` on an empty list writes a row or does not print `{selected: 0}`.
 * 5. A repeated `select` duplicates rows or resets a `published`/`dropped` row.
 * 6. `mark-published` touches a `selected` row it was not asked to, or promotes `dropped` rows.
 * 7. `release` moves a `published` row, or fails to return a failed run's items to the pool (AC3).
 * 8. Exclusion is workflow-scoped, or one topic's selection leaks into another topic's pool (AC2).
 * 9. Exclusion is item-scoped: one item of a selected story re-enters the pool (AC2).
 * 10. `--include-selected` is not the explicit opt-out of the exclusion.
 * 11. `kk daily prepare` fails (or writes no hint) when another run still holds `selected` rows, or
 *     fails when the store is missing/unopenable.
 * 12. Two consecutive runs draw overlapping pools (AC4).
 */

const REPO_ROOT = realpathSync(join(import.meta.dir, '../../..'));
const ARTIFACT_DIR = join(REPO_ROOT, '.works/test-artifacts/g32');
/** The 0230 handoff artifact's frozen path (design, `Handoffs`). */
const DISJOINT_POOLS_ARTIFACT = join(REPO_ROOT, '.works/test-artifacts/g32-disjoint-pools.json');
const RESEARCH_FIXTURE = join(import.meta.dir, 'fixtures/extract/ai-research.yaml');

const tempDirs: string[] = [];
const openStores: Store[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(async () => {
    for (const store of openStores.splice(0)) await store.close();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.KK_CONFIG;
});

/** Run `kk …` in-process from `cwd`, returning the exit code plus the captured output. */
async function run(args: string[], cwd?: string): Promise<{ code: number; out: string; err: string }> {
    const previous = process.cwd();
    if (cwd !== undefined) process.chdir(cwd);
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
        process.chdir(previous);
    }
}

/** One seeded item: the Doc plus the four decision values the shipped profiles read. */
interface SeedItem {
    doc: Doc;
    /** `kk-item-category` — decides which topic profile the item enters. */
    category: string;
    urgency?: string;
}

/** Seed items + their labels through the store's own write paths (no raw SQL on the way in). */
async function seed(dbPath: string, items: readonly SeedItem[]): Promise<void> {
    const store = await openStore({ path: dbPath });
    openStores.push(store);
    await store.items.upsertDocs(
        'run-seed',
        items.map((item) => item.doc),
        Date.now(),
    );
    for (const item of items) {
        const record = await store.items.findById(itemId(item.doc));
        const contentHash = record?.contentHash ?? null;
        const label = (decisionId: string, value: string) =>
            store.labels.recordObservation({
                itemId: itemId(item.doc),
                decisionId,
                value,
                maker: 'heuristic',
                source: 'heuristic',
                runId: 'run-seed',
                contentHash,
            });
        await label('kk-item-category', item.category);
        await label('kk-item-quality', '4');
        await label('kk-item-importance', '4');
        await label('kk-item-urgency', item.urgency ?? '3');
        await label('kk-item-impact', '3');
        // The shipped ai-news profile gates on china-politics (0229 R5); a level-0 answer keeps the
        // item eligible, so the 0228 exclusion cases keep meaning what they meant.
        await label('kk-item-china-politics', '0');
    }
    await store.close();
    openStores.splice(openStores.indexOf(store), 1);
}

/** Fixture docs by slug, so `sid()` can hand back the STORE id `itemId` derives from the URL. */
const FIXTURES = new Map<string, Doc>();

/** A fixture doc whose `id` is the store id (`itemId`), the way `extract --out` writes one. */
function doc(id: string, title = id): Doc {
    const base: Doc = { id, title, body: `${id} body`, sourceUri: `https://example.com/${id}` };
    const stored: Doc = { ...base, id: itemId(base) };
    FIXTURES.set(id, stored);
    return stored;
}

/** The store id of a fixture doc created by {@link doc}. */
function sid(slug: string): string {
    const stored = FIXTURES.get(slug);
    if (stored === undefined) throw new Error(`unknown fixture doc '${slug}'`);
    return stored.id;
}

/** Write a `Doc[]` file (the `extract --out` shape). */
function writeDocs(dir: string, name: string, docs: readonly Doc[]): string {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(docs, null, 2)}\n`);
    return path;
}

/** Write a `metadata.docs` Content file (the QC candidates shape). */
function writeCandidates(dir: string, name: string, docs: readonly Doc[]): string {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify({ metadata: { docs } }, null, 2)}\n`);
    return path;
}

function pool(path: string): Doc[] {
    return JSON.parse(readFileSync(path, 'utf-8')) as Doc[];
}

/** One column of one `selections` row, or `undefined` when the row is absent. */
function selectionRow(dbPath: string, itemId: string, runId: string): Record<string, unknown> | undefined {
    const raw = new Database(dbPath, { readonly: true });
    try {
        return raw.query('SELECT * FROM selections WHERE item_id = ? AND run_id = ?').get(itemId, runId) as
            | Record<string, unknown>
            | undefined;
    } finally {
        raw.close();
    }
}

/** `SELECT COUNT(*)` over one table — the "nothing was written" evidence. */
function countRows(dbPath: string, table: string): number {
    const raw = new Database(dbPath, { readonly: true });
    try {
        return (raw.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    } finally {
        raw.close();
    }
}

/** One raw `selections` query, so an assertion never leaks a sqlite handle. */
function selectionRowOf(dbPath: string, sql: string): Record<string, unknown> | undefined {
    const raw = new Database(dbPath, { readonly: true });
    try {
        return raw.query(sql).get() as Record<string, unknown> | undefined;
    } finally {
        raw.close();
    }
}

/** One raw write against a fixture database (never a production store). */
function writeRaw(dbPath: string, sql: string, params: readonly (string | number)[] = []): void {
    const raw = new Database(dbPath);
    try {
        raw.query(sql).run(...params);
    } finally {
        raw.close();
    }
}

/** The story id the ingest pass clustered onto one item. */
function storyOf(dbPath: string, id: string): string | null {
    const raw = new Database(dbPath, { readonly: true });
    try {
        const row = raw.query('SELECT story_id FROM items WHERE id = ?').get(id) as { story_id: string | null } | null;
        return row?.story_id ?? null;
    } finally {
        raw.close();
    }
}

/** Four ai-news items; `a`/`b` carry high urgency so the profile's order is deterministic. */
const NEWS: readonly SeedItem[] = [
    { doc: doc('news-a', 'Model launch'), category: 'ai-news', urgency: '5' },
    { doc: doc('news-b', 'Chip funding'), category: 'ai-industry', urgency: '4' },
    { doc: doc('news-c', 'Agent release'), category: 'ai-news', urgency: '3' },
    { doc: doc('news-d', 'Robot factory'), category: 'ai-news', urgency: '2' },
];

async function seedNews(dbPath: string): Promise<string[]> {
    await seed(dbPath, NEWS);
    return NEWS.map((item) => itemId(item.doc));
}

/** Extract the ai-news pool and return its doc ids. */
async function extractIds(dbPath: string, out: string, extra: string[] = []): Promise<string[]> {
    const result = await run(['store', 'extract', '--topic', 'ai-news', '--db', dbPath, '--out', out, ...extra]);
    expect(result.code).toBe(0);
    return pool(out).map((entry) => entry.id);
}

describe('kk store select (R1)', () => {
    it('records one selected row per distinct doc, in input order, and excludes the pool (R4/AC1)', async () => {
        const dir = tempDir('kk-select-');
        const dbPath = join(dir, 'select.db');
        const ids = await seedNews(dbPath);
        // Two docs the run planned, in the plan's order, in the QC candidates shape.
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[1]?.doc as Doc, NEWS[0]?.doc as Doc]);

        const result = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ selected: 2 });
        const first = selectionRow(dbPath, ids[1] as string, 'run-1');
        expect(first).toMatchObject({
            topic: 'ai-news',
            story_id: ids[1],
            workflow: 'kk-daily-ai-voice2',
            rank: 1,
            reason: null,
            status: 'selected',
            published_at: null,
        });
        expect(first?.selected_at).toEqual(expect.any(Number));
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')?.rank).toBe(2);

        // The run never published: the next day's extract still excludes the planned items (AC1).
        const nextDay = await extractIds(dbPath, join(dir, 'next.json'));
        expect(nextDay).toEqual(ids.slice(2));

        // A repeat writes nothing and leaves the rows as they are (idempotent per run).
        const repeat = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        expect(JSON.parse(repeat.out)).toEqual({ selected: 0 });
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')?.status).toBe('selected');

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR, 'select.json'),
            `${JSON.stringify(
                {
                    planned: [ids[1], ids[0]],
                    printed: JSON.parse(result.out),
                    repeat: JSON.parse(repeat.out),
                    nextDayPool: nextDay,
                },
                null,
                2,
            )}\n`,
        );
    });

    it('accepts a Doc[] input as well as the metadata.docs shape', async () => {
        const dir = tempDir('kk-select-shapes-');
        const dbPath = join(dir, 'shapes.db');
        const ids = await seedNews(dbPath);
        const docsFile = writeDocs(dir, 'docs.json', [NEWS[0]?.doc as Doc, NEWS[1]?.doc as Doc]);

        const result = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            docsFile,
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ selected: 2 });
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')?.status).toBe('selected');
    });

    it('fails loud on a third input shape, writing nothing', async () => {
        const dir = tempDir('kk-select-badshape-');
        const dbPath = join(dir, 'badshape.db');
        await seedNews(dbPath);
        const bad = join(dir, 'bad.json');
        writeFileSync(bad, JSON.stringify({ docs: [doc('news-a')] }));

        const result = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            bad,
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('kk.store.select.failed:');
        expect(result.err).toContain('Doc[]');
        expect(countRows(dbPath, 'selections')).toBe(0);
    });

    it('names an unknown doc id and writes nothing at all', async () => {
        const dir = tempDir('kk-select-unknown-');
        const dbPath = join(dir, 'unknown.db');
        await seedNews(dbPath);
        // A valid doc id first: the failure must still leave ZERO rows behind. The ghost doc is the
        // literal id the failure must name — not an `itemId` hash.
        const ghost: Doc = { id: 'ghost', title: 'ghost', body: 'ghost body' };
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc, ghost]);

        const result = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('kk.store.select.failed:');
        expect(result.err).toContain('ghost');
        expect(countRows(dbPath, 'selections')).toBe(0);
    });

    it('writes nothing and prints {selected: 0} for an empty list', async () => {
        const dir = tempDir('kk-select-empty-');
        const dbPath = join(dir, 'empty.db');
        await seedNews(dbPath);
        const candidates = writeCandidates(dir, 'candidates.json', []);

        const result = await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ selected: 0 });
        expect(countRows(dbPath, 'selections')).toBe(0);
    });
});

describe('kk store mark-published (R2)', () => {
    it('promotes only the listed ids and stamps published_at', async () => {
        const dir = tempDir('kk-mark-published-');
        const dbPath = join(dir, 'published.db');
        const ids = await seedNews(dbPath);
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc, NEWS[1]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);

        // Only the ids `--in` lists move; the rest stay selected.
        const subset = writeCandidates(dir, 'subset.json', [NEWS[0]?.doc as Doc]);
        const one = await run([
            'store',
            'mark-published',
            '--topic',
            'ai-news',
            '--run',
            'run-1',
            '--in',
            subset,
            '--db',
            dbPath,
        ]);
        expect(one.code).toBe(0);
        expect(JSON.parse(one.out)).toEqual({ published: 1 });
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')).toMatchObject({ status: 'published' });
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')?.published_at).toEqual(expect.any(Number));
        expect(selectionRow(dbPath, ids[1] as string, 'run-1')?.status).toBe('selected');

        // Without `--in`, the run's remaining selected rows are promoted.
        const rest = await run(['store', 'mark-published', '--topic', 'ai-news', '--run', 'run-1', '--db', dbPath]);
        expect(JSON.parse(rest.out)).toEqual({ published: 1 });

        // Nothing left to promote.
        const again = await run(['store', 'mark-published', '--topic', 'ai-news', '--run', 'run-1', '--db', dbPath]);
        expect(again.code).toBe(0);
        expect(JSON.parse(again.out)).toEqual({ published: 0 });
    });

    it('prints {published: 0} and exits 0 for a run with no rows', async () => {
        const dir = tempDir('kk-mark-published-none-');
        const dbPath = join(dir, 'none.db');
        await seedNews(dbPath);

        const result = await run([
            'store',
            'mark-published',
            '--topic',
            'ai-news',
            '--run',
            'no-such-run',
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ published: 0 });
        expect(result.err).toBe('');
    });

    it('never promotes a dropped row', async () => {
        const dir = tempDir('kk-mark-published-dropped-');
        const dbPath = join(dir, 'dropped.db');
        const ids = await seedNews(dbPath);
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        expect(JSON.parse((await run(['store', 'release', '--run', 'run-1', '--db', dbPath])).out)).toEqual({
            released: 1,
        });

        const result = await run(['store', 'mark-published', '--topic', 'ai-news', '--run', 'run-1', '--db', dbPath]);
        expect(JSON.parse(result.out)).toEqual({ published: 0 });
        expect(selectionRow(dbPath, ids[0] as string, 'run-1')?.status).toBe('dropped');
    });
});

describe('kk store release (R3)', () => {
    it('returns a failed run’s selected items to the pool and never touches published rows', async () => {
        const dir = tempDir('kk-release-');
        const dbPath = join(dir, 'release.db');
        const ids = await seedNews(dbPath);
        const candidatos = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc, NEWS[1]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidatos,
            '--db',
            dbPath,
        ]);
        expect(await extractIds(dbPath, join(dir, 'during.json'))).toEqual(ids.slice(2));

        // AC3: releasing the run re-admits exactly its items.
        const released = await run(['store', 'release', '--run', 'run-1', '--db', dbPath]);
        expect(released.code).toBe(0);
        expect(JSON.parse(released.out)).toEqual({ released: 2 });
        expect(await extractIds(dbPath, join(dir, 'after.json'))).toEqual(ids);

        // A published row is NOT released.
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-2',
            '--in',
            candidatos,
            '--db',
            dbPath,
        ]);
        await run(['store', 'mark-published', '--topic', 'ai-news', '--run', 'run-2', '--db', dbPath]);
        const second = await run(['store', 'release', '--run', 'run-2', '--db', dbPath]);
        expect(JSON.parse(second.out)).toEqual({ released: 0 });
        expect(await extractIds(dbPath, join(dir, 'still.json'))).toEqual(ids.slice(2));

        // `--topic` narrows the release; another topic's selection of the same run is untouched.
        const researchCandidates = writeCandidates(dir, 'research.json', [NEWS[2]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-research',
            '--workflow',
            'w',
            '--run',
            'run-3',
            '--in',
            researchCandidates,
            '--db',
            dbPath,
        ]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-3',
            '--in',
            researchCandidates,
            '--db',
            dbPath,
        ]);
        const narrowed = await run(['store', 'release', '--run', 'run-3', '--topic', 'ai-news', '--db', dbPath]);
        expect(JSON.parse(narrowed.out)).toEqual({ released: 1 });
        expect(selectionRow(dbPath, ids[2] as string, 'run-3')?.topic).toBe('ai-research');
        expect(
            selectionRowOf(dbPath, "SELECT status FROM selections WHERE run_id = 'run-3' AND topic = 'ai-research'"),
        ).toEqual({ status: 'selected' });
    });

    it('exits 0 with {released: 0} for an unknown run', async () => {
        const dir = tempDir('kk-release-none-');
        const dbPath = join(dir, 'none.db');
        await seedNews(dbPath);
        const result = await run(['store', 'release', '--run', 'no-such-run', '--db', dbPath]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ released: 0 });
    });
});

describe('kk store extract — topic- and story-scoped exclusion (R4/AC2)', () => {
    it('excludes every item of a selected story, and only under the selecting topic', async () => {
        const dir = tempDir('kk-story-');
        const dbPath = join(dir, 'story.db');
        // Two items of ONE story (identical titles ⇒ 0227 clusters them), each in a different topic.
        await seed(dbPath, [
            { doc: doc('n1', 'OpenAI ships GPT-5'), category: 'ai-news' },
            { doc: doc('r1', 'OpenAI ships GPT-5'), category: 'ai-research' },
        ]);
        expect(storyOf(dbPath, sid('n1'))).toBe(storyOf(dbPath, sid('r1')));
        expect(storyOf(dbPath, sid('n1'))).not.toBeNull();

        // Select the story under the ai-news topic only.
        const candidates = writeCandidates(dir, 'candidates.json', [doc('n1', 'OpenAI ships GPT-5')]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);

        // Story-scoped: the ai-news pool is empty, so no sibling of the story re-enters.
        expect(await extractIds(dbPath, join(dir, 'news.json'))).toEqual([]);

        // Topic-scoped: the other topic's extraction of the SAME story is untouched.
        const scratch = tempDir('kk-story-research-');
        const profilePath = join(scratch, 'plugins/kk/decisions/extract/ai-research.yaml');
        mkdirSync(dirname(profilePath), { recursive: true });
        writeFileSync(profilePath, readFileSync(RESEARCH_FIXTURE, 'utf-8'));
        const research = await run(
            ['store', 'extract', '--topic', 'ai-research', '--db', dbPath, '--out', join(dir, 'research.json')],
            scratch,
        );
        expect(research.code).toBe(0);
        expect(pool(join(dir, 'research.json')).map((entry) => entry.id)).toEqual([sid('r1')]);
    });

    it('--include-selected is the explicit opt-out of the exclusion', async () => {
        const dir = tempDir('kk-include-selected-');
        const dbPath = join(dir, 'include.db');
        const ids = await seedNews(dbPath);
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'w',
            '--run',
            'run-1',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);

        expect(await extractIds(dbPath, join(dir, 'excluded.json'))).toEqual(ids.slice(1));
        expect(await extractIds(dbPath, join(dir, 'included.json'), ['--include-selected'])).toEqual(ids);
    });

    it('no longer accepts --exclude-used and always excludes the topic’s selected stories', async () => {
        const dir = tempDir('kk-no-exclude-used-');
        const dbPath = join(dir, 'no-flag.db');
        await seedNews(dbPath);
        const result = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--exclude-used',
            'w',
            '--db',
            dbPath,
            '--out',
            join(dir, 'x.json'),
        ]);
        expect(result.code).not.toBe(0);
        expect(existsSync(join(dir, 'x.json'))).toBe(false);
    });
});

describe('two consecutive runs draw disjoint pools, and release re-admits (AC3/AC4)', () => {
    it('leaves the second run exactly the items the first did not select', async () => {
        const dir = tempDir('kk-disjoint-');
        const dbPath = join(dir, 'disjoint.db');
        const ids = await seedNews(dbPath);

        const run1Out = join(dir, 'run1.json');
        const run1Pool = await extractIds(dbPath, run1Out);
        expect(run1Pool).toHaveLength(4);
        // Run 1 plans two of the four items.
        const planned = run1Pool.slice(0, 2);
        const candidates = writeCandidates(
            dir,
            'candidates.json',
            planned.map((id) => ({ id, title: id, body: `${id} body` }) as Doc),
        );
        expect(
            JSON.parse(
                (
                    await run([
                        'store',
                        'select',
                        '--topic',
                        'ai-news',
                        '--workflow',
                        'kk-daily-ai-voice2',
                        '--run',
                        'run-1',
                        '--in',
                        candidates,
                        '--db',
                        dbPath,
                    ])
                ).out,
            ),
        ).toEqual({ selected: 2 });

        // Run 2 (the next day) draws a pool disjoint from run 1's — even though run 1 never published.
        const run2Out = join(dir, 'run2.json');
        const run2Pool = await extractIds(dbPath, run2Out);
        expect(run2Pool).toHaveLength(2);
        expect(run2Pool.filter((id) => planned.includes(id))).toEqual([]);

        // Releasing run 1 returns its items to the pool.
        const released = await run(['store', 'release', '--run', 'run-1', '--db', dbPath]);
        expect(JSON.parse(released.out)).toEqual({ released: 2 });
        const reentered = await extractIds(dbPath, join(dir, 'reentered.json'));
        expect([...reentered].sort()).toEqual([...ids].sort());

        const storyIds = (dbPath2: string, poolIds: string[]): string[] =>
            poolIds.map((id) => storyOf(dbPath2, id) ?? id);
        mkdirSync(dirname(DISJOINT_POOLS_ARTIFACT), { recursive: true });
        writeFileSync(
            DISJOINT_POOLS_ARTIFACT,
            `${JSON.stringify(
                {
                    run1: { run: 'run-1', storyIds: storyIds(dbPath, planned) },
                    run2: { run: 'run-2', storyIds: storyIds(dbPath, run2Pool) },
                    intersection: planned.filter((id) => run2Pool.includes(id)),
                    releasedReentered: [...reentered].sort().join(',') === [...ids].sort().join(','),
                },
                null,
                2,
            )}\n`,
        );
        expect(existsSync(DISJOINT_POOLS_ARTIFACT)).toBe(true);
    });
});

describe('kk daily prepare — the release hint (R7)', () => {
    /** Point the kk config at `dbPath`, then run `kk daily prepare`. */
    async function prepare(dir: string, dbPath: string): Promise<{ code: number; out: string; err: string }> {
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, `store:\n  db_path: ${dbPath}\n`);
        process.env.KK_CONFIG = configFile;
        try {
            // `daily prepare` writes its anchor relative to the cwd: run it inside the temp dir, or the
            // test rewrites the repo's real `.spur/runs/kk-daily-ai-voice2/work-dir.txt` (2026-10-12).
            return await run(
                ['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--work-dir', join(dir, 'w')],
                dir,
            );
        } finally {
            delete process.env.KK_CONFIG;
        }
    }

    it('names every other run that still holds selected rows, and is read-only', async () => {
        const dir = tempDir('kk-prepare-hint-');
        const dbPath = join(dir, 'hint.db');
        await seedNews(dbPath);
        const candidates = writeCandidates(dir, 'candidates.json', [NEWS[0]?.doc as Doc]);
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-old',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        // A published run is not a candidate for release.
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-published',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        await run(['store', 'mark-published', '--topic', 'ai-news', '--run', 'run-published', '--db', dbPath]);
        // Another workflow's selection is not this workflow's problem.
        await run([
            'store',
            'select',
            '--topic',
            'ai-news',
            '--workflow',
            'other-workflow',
            '--run',
            'run-other',
            '--in',
            candidates,
            '--db',
            dbPath,
        ]);
        const before = countRows(dbPath, 'selections');

        const result = await prepare(dir, dbPath);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).workDir).toBe(join(dir, 'w'));
        expect(result.err).toContain('kk store release --run run-old');
        expect(result.err).not.toContain('run-published');
        expect(result.err).not.toContain('run-other');
        // Read-only: the hint changes no row.
        expect(countRows(dbPath, 'selections')).toBe(before);
    });

    it('prints nothing and never fails when the store is missing or unopenable', async () => {
        const dir = tempDir('kk-prepare-nostore-');
        const missing = await prepare(dir, join(dir, 'does-not-exist.db'));
        expect(missing.code).toBe(0);
        expect(missing.err).toBe('');

        const unopenable = await prepare(dir, dir); // a directory, not a database file
        expect(unopenable.code).toBe(0);
        expect(unopenable.err).toBe('');
    });

    it('prints nothing when no run holds selected rows', async () => {
        const dir = tempDir('kk-prepare-clean-');
        const dbPath = join(dir, 'clean.db');
        await seedNews(dbPath);
        const result = await prepare(dir, dbPath);
        expect(result.code).toBe(0);
        expect(result.err).toBe('');
    });
});

/**
 * Task 0393 — series-scoped selection continuity across a story re-clustering.
 *
 * ## Failure-first list — written before the code
 *
 * 1. A selection records `story_id` BY VALUE at reservation time (`store select` →
 *    `item.storyId`). The items pass can re-derive that identity later (`kk store backfill-facts`,
 *    or a `store.story.threshold` retune), which orphans the reservation: the item selected or
 *    published for the series is then its OWN story root, the ledger no longer joins on
 *    `story_id`, and the aired item re-enters that series' pool (R15 violation).
 * 2. The fix must not weaken the other guarantees: another series keeps its reuse, a story
 *    sibling stays excluded while the identity still joins, a `dropped` reservation still
 *    re-admits, `published` stays protected, and replay is deterministic (no writes on read).
 */
describe('series-scoped selection continuity across re-clustering (0393 R15)', () => {
    /** Two titles one event: Jaccard ≈ 0.83, so they share a story at the 0.6 default. */
    const T1 = 'OpenAI ships GPT-5 model';
    const T2 = 'OpenAI ships GPT-5 model today';

    /** Re-run the causal clustering pass, as an operator retune of `store.story.threshold` does. */
    async function recluster(dbPath: string, threshold: number): Promise<number> {
        const store = await openStore({ path: dbPath });
        try {
            return await store.items.backfillFacts({ threshold, windowHours: 72 });
        } finally {
            await store.close();
        }
    }

    /** Seed one story reported twice, clustered at the default threshold. */
    async function seedStory(dbPath: string): Promise<{ first: string; second: string }> {
        await seed(dbPath, [
            { doc: doc('s-1', T1), category: 'ai-news' },
            { doc: doc('s-2', T2), category: 'ai-news' },
        ]);
        return { first: sid('s-1'), second: sid('s-2') };
    }

    async function selectDocs(
        dir: string,
        dbPath: string,
        runId: string,
        docs: readonly Doc[],
        topic = 'ai-news',
    ): Promise<void> {
        const path = writeCandidates(dir, `${runId}-${topic}.json`, docs);
        const result = await run([
            'store',
            'select',
            '--topic',
            topic,
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            runId,
            '--in',
            path,
            '--db',
            dbPath,
        ]);
        expect(result.code).toBe(0);
    }

    it('keeps a selected item out of its series pool after the story identity is re-derived', async () => {
        const dir = tempDir('kk-0393-drift-');
        const dbPath = join(dir, 'drift.db');
        const story = await seedStory(dbPath);
        // One event, one story: the second report clusters onto the first.
        expect(storyOf(dbPath, story.second)).toBe(story.first);

        await selectDocs(dir, dbPath, 'run-1', [doc('s-2', T2)]);
        expect(selectionRow(dbPath, story.second, 'run-1')).toMatchObject({
            story_id: story.first,
            status: 'selected',
        });
        // Before the re-clustering, both items are out of the pool (story-scoped, AC2).
        expect(await extractIds(dbPath, join(dir, 'before.json'))).toEqual([]);

        // The operator retunes the threshold; the second report no longer matches the first.
        expect(await recluster(dbPath, 0.95)).toBeGreaterThan(0);
        expect(storyOf(dbPath, story.second)).toBe(story.second);

        // R15: the item the series already committed to must NOT re-enter its pool, even though its
        // story id moved (item identity holds it out; the recorded story key still holds its
        // sibling). Before 0393 the re-rooted item came back as the whole pool.
        expect(await extractIds(dbPath, join(dir, 'after.json'))).toEqual([]);
    });

    it('keeps a published item protected after the story identity is re-derived', async () => {
        const dir = tempDir('kk-0393-published-');
        const dbPath = join(dir, 'published.db');
        const story = await seedStory(dbPath);
        await selectDocs(dir, dbPath, 'run-air', [doc('s-2', T2)]);
        const promoted = await run([
            'store',
            'mark-published',
            '--topic',
            'ai-news',
            '--run',
            'run-air',
            '--db',
            dbPath,
        ]);
        expect(JSON.parse(promoted.out)).toEqual({ published: 1 });

        await recluster(dbPath, 0.95);
        expect(storyOf(dbPath, story.second)).toBe(story.second);

        // An aired item never silently re-admits, and `release` still refuses to free it.
        expect(await extractIds(dbPath, join(dir, 'after.json'))).toEqual([]);
        expect(JSON.parse((await run(['store', 'release', '--run', 'run-air', '--db', dbPath])).out)).toEqual({
            released: 0,
        });
        expect(selectionRow(dbPath, story.second, 'run-air')?.status).toBe('published');
    });

    it('keeps an aired item out of the pool when a headline correction re-clusters it onto a story', async () => {
        // A materially updated event (the Q&A's "correction" case): the item keeps its own story key
        // until the item is edited, then the causal pass re-clusters it onto an earlier story. The
        // selection's recorded story key then matches NO item, so only item identity keeps the aired
        // item out of the series pool.
        const dir = tempDir('kk-0393-correction-');
        const dbPath = join(dir, 'correction.db');
        await seed(dbPath, [
            { doc: doc('c-1', 'Chip funding round closes'), category: 'ai-news' },
            { doc: doc('c-2', 'Robot factory opens in Osaka'), category: 'ai-news' },
        ]);
        const earlier = sid('c-1');
        const aired = sid('c-2');
        // Pin the causal order: the causal pass walks `first_seen_at, id`, and the fixture ids are
        // hashes, so the story's earlier report must actually be earlier.
        writeRaw(dbPath, 'UPDATE items SET first_seen_at = first_seen_at - 3600000 WHERE id = ?', [earlier]);
        expect(storyOf(dbPath, aired)).toBe(aired);

        await selectDocs(dir, dbPath, 'run-1', [doc('c-2', 'Robot factory opens in Osaka')]);
        expect(selectionRow(dbPath, aired, 'run-1')?.story_id).toBe(aired);
        expect(await extractIds(dbPath, join(dir, 'before.json'))).toEqual([earlier]);

        // The outlet corrects the headline; the stored item is updated, then re-clustered.
        const store = await openStore({ path: dbPath });
        try {
            await store.items.upsertDocs('run-update', [doc('c-2', 'Chip funding round closes today')], Date.now());
            // A content change invalidates the label observations, so re-label before the next pool:
            // the item must fall out of the pool because the LEDGER excludes it, not because the
            // profile's `where` join dropped it.
            const contentHash = (await store.items.findById(aired))?.contentHash ?? null;
            for (const [decisionId, value] of [
                ['kk-item-category', 'ai-news'],
                ['kk-item-quality', '4'],
                ['kk-item-importance', '4'],
                ['kk-item-urgency', '3'],
                ['kk-item-impact', '3'],
                ['kk-item-china-politics', '0'],
            ] as const) {
                await store.labels.recordObservation({
                    itemId: aired,
                    decisionId,
                    value,
                    maker: 'heuristic',
                    source: 'heuristic',
                    runId: 'run-update',
                    contentHash,
                });
            }
            await store.items.backfillFacts({ threshold: 0.6, windowHours: 72 });
        } finally {
            await store.close();
        }
        expect(storyOf(dbPath, aired)).toBe(earlier);

        // The aired item stays out; the story's never-aired sibling is free to run.
        expect(await extractIds(dbPath, join(dir, 'after.json'))).toEqual([earlier]);
    });

    it('keeps the series reusable by another topic and by a dropped reservation after a re-clustering', async () => {
        const dir = tempDir('kk-0393-reuse-');
        const dbPath = join(dir, 'reuse.db');
        const story = await seedStory(dbPath);
        await selectDocs(dir, dbPath, 'run-1', [doc('s-2', T2)]);
        await recluster(dbPath, 0.95);

        // Another series' selection of the same item is a different ledger row.
        await selectDocs(dir, dbPath, 'run-research', [doc('s-2', T2)], 'ai-research');
        expect(selectionRowOf(dbPath, `SELECT status FROM selections WHERE run_id = 'run-research'`)).toEqual({
            status: 'selected',
        });

        // Releasing the ai-news reservation returns the item to THAT series' pool only.
        expect(
            JSON.parse((await run(['store', 'release', '--run', 'run-1', '--topic', 'ai-news', '--db', dbPath])).out),
        ).toEqual({ released: 1 });
        expect(await extractIds(dbPath, join(dir, 'after.json'))).toEqual([story.first, story.second]);
    });

    it('replays the same ledger read deterministically, writing nothing', async () => {
        const dir = tempDir('kk-0393-replay-');
        const dbPath = join(dir, 'replay.db');
        const story = await seedStory(dbPath);
        await selectDocs(dir, dbPath, 'run-1', [doc('s-2', T2)]);
        await recluster(dbPath, 0.95);

        const first = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--db',
            dbPath,
            '--out',
            join(dir, 'r1.json'),
        ]);
        const rowsBefore = countRows(dbPath, 'selections');
        const second = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--db',
            dbPath,
            '--out',
            join(dir, 'r2.json'),
        ]);

        expect(first.code).toBe(0);
        expect(second.code).toBe(0);
        expect(pool(join(dir, 'r1.json'))).toEqual(pool(join(dir, 'r2.json')));
        expect(countRows(dbPath, 'selections')).toBe(rowsBefore);
        expect(selectionRow(dbPath, story.second, 'run-1')?.story_id).toBe(story.first);
    });
});
