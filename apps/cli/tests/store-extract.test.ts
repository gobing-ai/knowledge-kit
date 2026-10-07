import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId, openStore, resolveStorePath, type Store } from '@gobing-ai/kk-store';
import { main } from '../src/main';
import { captureOutput } from './capture';

/**
 * Failure-first list for `kk store extract` / `kk store mark-used` — before the code:
 *
 * 1. `extract` returns an item outside the profile's `where` predicates.
 * 2. `extract` returns an item first seen before `now - window` (or the `--window` unit is
 *    ignored, so `--window 24h` means something else).
 * 3. `extract` drops the profile's `order`, so the pool is not the urgency/impact-ranked list.
 * 4. `extract` writes Docs missing `metadata.labels`, a `sourceUri`, or `mediaType`, so
 *    episode-plan-gen cannot consume the pool unchanged.
 * 5. `extract` writes a non-`Doc[]` payload (a Content wrapper, a bare item list) and
 *    `DocListSchema` would reject it.
 * 6. An empty pool exits non-zero or writes no file, so the DAG cannot condition on `count`.
 * 7. A profile with an unknown key or an unknown decision id is accepted (silently widening or
 *    emptying the pool) instead of exiting 1 with `kk.store.profile.invalid`.
 * 8. `--limit 0`, `--window 24` (no unit) or an unknown topic is accepted.
 * 9. `extract` mutates the store (it must be a pure read: no ingest, no labelling).
 * 10. `mark-used` does not write `episode_usage`, writes the wrong workflow, or duplicates rows
 *     on a retry, so a second extract with `--exclude-used` still returns the aired items.
 * 11. `mark-used` omits a duplicate id from the input twice, or fails on a non-Doc[] input.
 */

const REPO_ROOT = realpathSync(join(import.meta.dir, '../../..'));
const ARTIFACT_DIR = join(REPO_ROOT, '.works/test-artifacts/0210');
const RESEARCH_FIXTURE = join(import.meta.dir, 'fixtures/extract/ai-research.yaml');

const tempDirs: string[] = [];
const openStores: Store[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(async () => {
    for (const store of openStores.splice(0)) {
        await store.close();
    }
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
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

/** A second topic's profile directory inside a scratch checkout — the R5 "no code change" seam. */
function writeProfile(root: string, topic: string, contents: string): string {
    const path = join(root, 'plugins/kk/decisions/extract', `${topic}.yaml`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return path;
}

/** A pool file with every Doc repeated — `mark-used` must collapse duplicate ids to one row. */
function writeDuplicateInput(dir: string, docs: readonly Doc[]): string {
    const path = join(dir, 'duplicated-pool.json');
    writeFileSync(path, JSON.stringify([...docs, ...docs]));
    return path;
}

/** The seeded corpus: every predicate and exclusion `extract` has to honour. */
const NOW = Date.now();
const DAY_MS = 86_400_000;
const CORPUS = {
    newsB: { id: 'news-b', title: 'Model launch', body: 'launch body', sourceUri: 'https://example.com/news-b' },
    newsA: { id: 'news-a', title: 'Chip funding', body: 'funding body', sourceUri: 'https://example.com/news-a' },
    research: { id: 'r-1', title: 'Alignment paper', body: 'paper body', metadata: { source: 'rss' } },
    research2: { id: 'r-2', title: 'Benchmark paper', body: 'benchmark body' },
    stale: { id: 'stale', title: 'Old news', body: 'old body', sourceUri: 'https://example.com/stale' },
    unlabelled: { id: 'unlabelled', title: 'No importance', body: 'unlabelled body' },
} satisfies Record<string, Doc>;

/**
 * Seed a temp store: two ai-news items (urgency 5 / 2), two research items (importance 5 / 4),
 * one ai-news item 30 days old and one missing the `kk-item-importance` label. The seeding
 * connection is closed again so the store checkpoints its WAL — a copied `kk.db` then carries
 * the rows, not just the schema (the 0210 artifact keeps a copy).
 */
async function seedStore(name: string): Promise<{ dbPath: string; dir: string }> {
    const dir = tempDir('kk-store-extract-');
    const dbPath = join(dir, name);
    const store = await openStore({ path: dbPath });
    const label = (doc: Doc, decisionId: string, value: string) =>
        store.labels.upsertLabel({ itemId: itemId(doc), decisionId, value, maker: 'heuristic', source: 'heuristic' });

    await store.items.upsertDocs('run-seed', [CORPUS.stale], NOW - 30 * DAY_MS);
    await store.items.upsertDocs('run-seed', [CORPUS.unlabelled], NOW - DAY_MS / 2);
    await store.items.upsertDocs('run-seed', [CORPUS.newsA, CORPUS.newsB, CORPUS.research, CORPUS.research2], NOW);

    for (const [doc, category, quality, importance, urgency, impact] of [
        [CORPUS.newsA, 'ai-industry', '4', '3', '2', '3'],
        [CORPUS.newsB, 'ai-news', '5', '4', '5', '4'],
        [CORPUS.research, 'ai-research', '4', '5', '3', '2'],
        [CORPUS.research2, 'ai-research', '3', '4', '2', '1'],
        [CORPUS.stale, 'ai-news', '5', '5', '5', '5'],
        [CORPUS.unlabelled, 'ai-news', '5', '5', '4', '4'],
    ] as const) {
        await label(doc, 'kk-item-category', category);
        await label(doc, 'kk-item-quality', quality);
        await label(doc, 'kk-item-urgency', urgency);
        await label(doc, 'kk-item-impact', impact);
        if (doc !== CORPUS.unlabelled) await label(doc, 'kk-item-importance', importance);
    }
    await store.close();
    return { dbPath, dir };
}

/** Row counts the "extract is a pure read" assertion compares. */
function counts(dbPath: string): Record<string, number> {
    const raw = new Database(dbPath, { readonly: true });
    try {
        const one = (table: string): number =>
            (raw.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
        return {
            items: one('items'),
            labels: one('labels'),
            episode_usage: one('episode_usage'),
            collect_runs: one('collect_runs'),
        };
    } finally {
        raw.close();
    }
}

/** Parse an `extract --out` payload and keep the evidence. */
function pool(path: string): Doc[] {
    return JSON.parse(readFileSync(path, 'utf-8')) as Doc[];
}

function artifact(name: string, contents: unknown): void {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, name), `${JSON.stringify(contents, null, 2)}\n`);
}

describe('kk store extract', () => {
    it('selects the ai-news pool from the shipped profile labels and prints {count}', async () => {
        const { dbPath, dir } = await seedStore('ai-news.db');
        const out = join(dir, 'out/pool.json');
        const before = counts(dbPath);

        const result = await run(['store', 'extract', '--topic', 'ai-news', '--db', dbPath, '--out', out]);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ count: 2 });
        const docs = pool(out);
        expect(docs.map((doc) => doc.id)).toEqual([itemId(CORPUS.newsB), itemId(CORPUS.newsA)]);
        expect(docs.map((doc) => doc.title)).toEqual(['Model launch', 'Chip funding']);
        expect(docs[0]).toEqual({
            id: itemId(CORPUS.newsB),
            title: 'Model launch',
            body: 'launch body',
            sourceUri: 'https://example.com/news-b',
            metadata: {
                labels: {
                    'kk-item-category': 'ai-news',
                    'kk-item-quality': '5',
                    'kk-item-urgency': '5',
                    'kk-item-impact': '4',
                    'kk-item-importance': '4',
                },
            },
        });
        // R6: the only write extract makes is its own output file.
        expect(counts(dbPath)).toEqual(before);
        expect(existsSync(out)).toBe(true);

        artifact('ai-news-pool.json', docs);
        artifact('ai-news-summary.json', { printed: JSON.parse(result.out), before, after: counts(dbPath) });
    });

    it('honours --limit and --window', async () => {
        const { dbPath, dir } = await seedStore('window.db');
        const capped = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--limit',
            '1',
            '--db',
            dbPath,
            '--out',
            join(dir, 'capped.json'),
        ]);
        expect(JSON.parse(capped.out)).toEqual({ count: 1 });
        expect(pool(join(dir, 'capped.json')).map((doc) => doc.id)).toEqual([itemId(CORPUS.newsB)]);

        const wide = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--window',
            '40d',
            '--db',
            dbPath,
            '--out',
            join(dir, 'wide.json'),
        ]);
        // `stale` re-enters the wider window; `unlabelled` still cannot (no importance label).
        expect(JSON.parse(wide.out)).toEqual({ count: 3 });
    });

    it('writes [] and prints {count: 0} with exit 0 for an empty pool', async () => {
        const dir = tempDir('kk-store-empty-');
        const dbPath = join(dir, 'old.db');
        const store = await openStore({ path: dbPath });
        // One ai-news item, 30 days old: the profile matches it, the 24h window does not.
        await store.items.upsertDocs('run-seed', [CORPUS.stale], NOW - 30 * DAY_MS);
        for (const [decisionId, value] of [
            ['kk-item-category', 'ai-news'],
            ['kk-item-quality', '5'],
            ['kk-item-importance', '5'],
        ] as const) {
            await store.labels.upsertLabel({
                itemId: itemId(CORPUS.stale),
                decisionId,
                value,
                maker: 'heuristic',
                source: 'heuristic',
            });
        }
        await store.close();
        const out = join(dir, 'empty.json');

        const result = await run(['store', 'extract', '--topic', 'ai-news', '--db', dbPath, '--out', out]);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ count: 0 });
        expect(result.err).toBe('');
        expect(readFileSync(out, 'utf-8')).toBe('[]\n');
        artifact('empty-pool.json', { stdout: result.out.trim(), file: readFileSync(out, 'utf-8') });
    });

    it('extracts a second topic from a fixture profile with no code change (R5/AC2)', async () => {
        const { dbPath, dir } = await seedStore('research.db');
        const scratch = tempDir('kk-store-research-');
        // The fixture profile is copied verbatim into a scratch checkout's profile dir.
        writeProfile(scratch, 'ai-research', readFileSync(RESEARCH_FIXTURE, 'utf-8'));
        const out = join(dir, 'research-pool.json');

        const result = await run(['store', 'extract', '--topic', 'ai-research', '--db', dbPath, '--out', out], scratch);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ count: 2 });
        const docs = pool(out);
        expect(docs.map((doc) => doc.id)).toEqual([itemId(CORPUS.research), itemId(CORPUS.research2)]);
        expect(docs[0]?.metadata).toEqual({
            source: 'rss',
            labels: {
                'kk-item-category': 'ai-research',
                'kk-item-quality': '4',
                'kk-item-importance': '5',
                'kk-item-urgency': '3',
                'kk-item-impact': '2',
            },
        });
        // The shipped topic is untouched by the second one.
        expect(readFileSync(join(REPO_ROOT, 'plugins/kk/decisions/extract/ai-news.yaml'), 'utf-8')).toContain(
            'topic: ai-news',
        );
        expect(pool(join(dir, 'research-pool.json'))).toHaveLength(2);
        artifact('ai-research-pool.json', docs);
    });

    it('exits 1 with kk.store.profile.invalid for an unknown key, decision id or topic mismatch', async () => {
        const { dbPath, dir } = await seedStore('invalid.db');
        const scratch = tempDir('kk-store-invalid-');
        const aiNews = readFileSync(join(REPO_ROOT, 'plugins/kk/decisions/extract/ai-news.yaml'), 'utf-8');
        writeProfile(scratch, 'ai-news', `${aiNews}order_by: [nope]\n`);
        writeProfile(scratch, 'typo', 'topic: typo\nwhere:\n  kk-item-typo: { in: [ai-news] }\n');
        writeProfile(scratch, 'mismatch', 'topic: something-else\nwhere:\n  kk-item-category: { in: [ai-news] }\n');
        writeProfile(
            scratch,
            'bad-limit',
            'topic: bad-limit\nwhere:\n  kk-item-category: { in: [ai-news] }\nlimit: 0\n',
        );
        writeProfile(scratch, 'bad-op', 'topic: bad-op\nwhere:\n  kk-item-category: { gt: 3 }\n');

        const failures: Array<{ topic: string; code: number; err: string }> = [];
        for (const topic of ['ai-news', 'typo', 'mismatch', 'bad-limit', 'bad-op']) {
            const out = join(dir, `${topic}.json`);
            const result = await run(['store', 'extract', '--topic', topic, '--db', dbPath, '--out', out], scratch);
            expect(result.code).toBe(1);
            expect(result.err).toContain('kk.store.profile.invalid:');
            expect(result.out).toBe('');
            expect(existsSync(out)).toBe(false);
            failures.push({ topic, code: result.code, err: result.err.trim() });
        }
        artifact('profile-invalid.json', failures);
    });

    it('exits 1 with kk.store.extract.failed for a bad window, limit or unknown topic', async () => {
        const { dbPath, dir } = await seedStore('badargs.db');
        const cases: Array<{ args: string[]; cause: string }> = [
            { args: ['--topic', 'ai-news', '--window', '24'], cause: '--window must be' },
            { args: ['--topic', 'ai-news', '--window', '0h'], cause: '--window must be' },
            { args: ['--topic', 'ai-news', '--limit', '0'], cause: '--limit must be' },
            { args: ['--topic', 'no-such-topic'], cause: "no profile for topic 'no-such-topic'" },
            { args: ['--topic', '../etc/passwd'], cause: '--topic must be a lowercase slug' },
        ];
        for (const { args, cause } of cases) {
            const result = await run(['store', 'extract', ...args, '--db', dbPath, '--out', join(dir, 'x.json')]);
            expect(result.code).toBe(1);
            expect(result.err).toContain('kk.store.extract.failed:');
            expect(result.err).toContain(cause);
        }
    });
});

describe('kk store mark-used', () => {
    it('records used items and keeps a later pool free of them (R4/AC3)', async () => {
        const { dbPath, dir } = await seedStore('used.db');
        const airedPath = join(dir, 'aired.json');
        const extract = (excludeUsed: string | undefined, out: string) =>
            run([
                'store',
                'extract',
                '--topic',
                'ai-news',
                '--db',
                dbPath,
                '--out',
                out,
                ...(excludeUsed === undefined ? [] : ['--exclude-used', excludeUsed]),
            ]);

        const first = await extract(undefined, airedPath);
        expect(JSON.parse(first.out)).toEqual({ count: 2 });
        const aired = pool(airedPath);

        const marked = await run([
            'store',
            'mark-used',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-1',
            '--in',
            airedPath,
            '--db',
            dbPath,
        ]);
        expect(marked.code).toBe(0);
        expect(JSON.parse(marked.out)).toEqual({ marked: 2 });
        expect(counts(dbPath).episode_usage).toBe(2);

        // A second extract excluding that workflow returns nothing: no re-airing (AC3).
        const second = await extract('kk-daily-ai-voice2', join(dir, 'second.json'));
        expect(JSON.parse(second.out)).toEqual({ count: 0 });

        // A later run of the same workflow still excludes them — usage is per workflow, not per run.
        const third = await extract('kk-daily-ai-voice2', join(dir, 'third.json'));
        expect(JSON.parse(third.out)).toEqual({ count: 0 });

        // Another workflow is unaffected.
        const other = await extract('another-workflow', join(dir, 'other.json'));
        expect(JSON.parse(other.out)).toEqual({ count: 2 });

        // A retried mark-used re-uses the same rows (idempotent); duplicates in one input collapse.
        const retried = await run([
            'store',
            'mark-used',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-1',
            '--in',
            airedPath,
            '--db',
            dbPath,
        ]);
        expect(JSON.parse(retried.out)).toEqual({ marked: 2 });
        expect(counts(dbPath).episode_usage).toBe(2);

        const nextRun = await run([
            'store',
            'mark-used',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run',
            'run-2',
            '--in',
            airedPath,
            '--db',
            dbPath,
        ]);
        expect(JSON.parse(nextRun.out)).toEqual({ marked: 2 });
        expect(counts(dbPath).episode_usage).toBe(4);

        // Idempotent within one input too: the same Doc twice is one row.
        const duplicated = await run([
            'store',
            'mark-used',
            '--workflow',
            'dup-workflow',
            '--run',
            'run-3',
            '--in',
            writeDuplicateInput(dir, aired),
            '--db',
            dbPath,
        ]);
        expect(JSON.parse(duplicated.out)).toEqual({ marked: 2 });
        expect(counts(dbPath).episode_usage).toBe(6);

        artifact('mark-used.json', {
            aired: aired.map((doc) => doc.id),
            result: JSON.parse(marked.out),
            excludedPoolCount: JSON.parse(second.out),
            usageRows: counts(dbPath).episode_usage,
        });
    });

    it('exits 1 for a non-Doc[] input', async () => {
        const { dbPath, dir } = await seedStore('bad-input.db');
        const bad = join(dir, 'bad.json');
        writeFileSync(bad, JSON.stringify({ docs: [] }));

        const result = await run(['store', 'mark-used', '--workflow', 'w', '--run', 'r', '--in', bad, '--db', dbPath]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('kk.store.mark-used.failed:');
    });

    it('resolves the store path from the kk config when --db is absent', async () => {
        const dir = tempDir('kk-store-config-');
        const configFile = join(dir, 'config.yaml');
        const configured = join(dir, 'configured/kk.db');
        writeFileSync(configFile, `store:\n  db_path: ${configured}\n`);
        process.env.KK_CONFIG = configFile;
        try {
            expect(await resolveStorePath(configFile)).toBe(configured);
            const result = await run(['store', 'extract', '--topic', 'ai-news', '--out', join(dir, 'out.json')]);
            // The configured store exists but is empty: extract reports an empty pool, exit 0.
            expect(result.code).toBe(0);
            expect(JSON.parse(result.out)).toEqual({ count: 0 });
        } finally {
            delete process.env.KK_CONFIG;
        }
    });
});

/** The E2E run's repeatable artifact: the seeded corpus and the store it produced. */
describe('kk store extract artifacts', () => {
    it('leaves a repeatable summary under .works/test-artifacts/0210', async () => {
        const { dbPath, dir } = await seedStore('artifact.db');
        const result = await run([
            'store',
            'extract',
            '--topic',
            'ai-news',
            '--db',
            dbPath,
            '--out',
            join(dir, 'artifact-pool.json'),
        ]);
        expect(JSON.parse(result.out)).toEqual({ count: 2 });

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR, 'corpus.json'),
            `${JSON.stringify(
                {
                    seededAt: new Date(NOW).toISOString(),
                    items: Object.values(CORPUS),
                    profile: 'plugins/kk/decisions/extract/ai-news.yaml',
                    researchFixture: 'apps/cli/tests/fixtures/extract/ai-research.yaml',
                    aiNewsCount: JSON.parse(result.out).count,
                },
                null,
                2,
            )}\n`,
        );
        // Fold the WAL back into the main file before copying: ts-db's close does not checkpoint,
        // so a bare `kk-store-extract.db` copy carries the schema and nothing else.
        const raw = new Database(dbPath);
        try {
            raw.query('PRAGMA wal_checkpoint(TRUNCATE)').run();
        } finally {
            raw.close();
        }
        writeFileSync(join(ARTIFACT_DIR, 'kk-store-extract.db'), readFileSync(dbPath));
        expect(
            (new Database(dbPath, { readonly: true }).query('SELECT COUNT(*) AS n FROM items').get() as { n: number })
                .n,
        ).toBe(6);

        expect(existsSync(join(ARTIFACT_DIR, 'kk-store-extract.db'))).toBe(true);
        expect(existsSync(join(ARTIFACT_DIR, 'corpus.json'))).toBe(true);
    });
});
