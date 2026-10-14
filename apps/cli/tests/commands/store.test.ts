import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const ARTIFACT_DIR = join(import.meta.dir, '../../../..', '.works/test-artifacts/0206');

const tempDirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-store-cmd-')));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.KK_CONFIG;
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

describe('registerStoreCommand', () => {
    it('registers the store noun with migrate, lock, ingest, backfill-facts, label, extract, pool-count and the selection verbs', () => {
        const program = createProgram();
        const store = program.commands.find((command) => command.name() === 'store');
        expect(store).toBeDefined();
        expect(store?.commands.map((command) => command.name())).toEqual([
            'migrate',
            'lock',
            'ingest',
            'backfill-facts',
            'label',
            'extract',
            'pool-count',
            'select',
            'mark-published',
            'release',
        ]);

        // 0275 R3: what was `kk store lock` is now the hidden legacy spelling of the top-level
        // `kk lock` group — still registered with the identical verb/flag contract, just invisible.
        const lock = store?.commands.find((command) => command.name() === 'lock');
        expect(lock?.commands.map((command) => command.name())).toEqual(['acquire', 'release']);
        expect(
            store &&
                program
                    .createHelp()
                    .visibleCommands(store)
                    .map((command) => command.name()),
        ).not.toContain('lock');

        const backfillFacts = store?.commands.find((command) => command.name() === 'backfill-facts');
        expect(backfillFacts?.options.map((option) => option.long)).toEqual(['--db']);

        const label = store?.commands.find((command) => command.name() === 'label');
        expect(label?.options.map((option) => option.long)).toEqual([
            '--run',
            '--new-ids',
            '--replay',
            '--decisions',
            '--maker',
            '--mode',
            '--window',
            '--db',
        ]);
        expect(label?.options.find((option) => option.long === '--maker')?.defaultValue).toBeUndefined();
        expect(label?.options.find((option) => option.long === '--mode')?.defaultValue).toBe('heuristic');
        expect(label?.options.find((option) => option.long === '--window')?.defaultValue).toBe('24h');
        // 0226 R6 turns the label mode choice into a runtime validation: `--run`/`--new-ids` OR
        // `--replay`/`--maker`, never a commander-level requirement.
        expect(label?.options.filter((option) => option.mandatory)).toEqual([]);

        const extract = store?.commands.find((command) => command.name() === 'extract');
        expect(extract?.options.map((option) => option.long)).toEqual([
            '--topic',
            '--window',
            '--limit',
            '--include-selected',
            '--out',
            '--db',
        ]);
        expect(extract?.options.find((option) => option.long === '--window')?.defaultValue).toBe('24h');
        expect(extract?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--topic',
            '--out',
        ]);

        // 0228 R1/R2/R3: the three selection verbs. `select` and `mark-published` name a topic;
        // `release` may release a whole run across topics.
        const select = store?.commands.find((command) => command.name() === 'select');
        expect(select?.options.map((option) => option.long)).toEqual([
            '--topic',
            '--workflow',
            '--run',
            '--in',
            '--db',
        ]);
        expect(select?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--topic',
            '--workflow',
            '--run',
            '--in',
        ]);

        const markPublished = store?.commands.find((command) => command.name() === 'mark-published');
        expect(markPublished?.options.map((option) => option.long)).toEqual(['--topic', '--run', '--in', '--db']);
        expect(markPublished?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--topic',
            '--run',
        ]);

        const release = store?.commands.find((command) => command.name() === 'release');
        expect(release?.options.map((option) => option.long)).toEqual(['--run', '--topic', '--db']);
        expect(release?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual(['--run']);
    });

    it('exits non-zero when extract is called without --topic/--out (commander required options)', async () => {
        const capture = captureOutput();
        let code: number;
        try {
            code = await main(['node', 'kk', 'store', 'extract']);
        } finally {
            capture.restore();
        }
        expect(code).not.toBe(0);
    });

    it('exits non-zero when label is called with no usable mode (neither --new-ids nor --replay)', async () => {
        const capture = captureOutput();
        let code: number;
        try {
            code = await main(['node', 'kk', 'store', 'label']);
        } finally {
            capture.restore();
        }
        expect(code).not.toBe(0);
    });
});

describe('kk store backfill-facts (0227 R4)', () => {
    it('recomputes the facts and prints {updated}, then is idempotent', async () => {
        const dir = tempDir();
        const dbPath = join(dir, 'backfill.db');
        const input = join(dir, 'docs.json');
        writeFileSync(
            input,
            JSON.stringify([
                {
                    id: 'a',
                    title: 'OpenAI ships GPT-5',
                    body: 'body 🎉',
                    sourceUri: 'https://www.example.com/a',
                    metadata: { source: 'aihot', engagement: { points: 11 } },
                },
            ]),
        );
        const ingest = await run([
            'store',
            'ingest',
            '--run',
            'run-1',
            '--in',
            input,
            '--new-ids',
            join(dir, 'ids.json'),
            '--db',
            dbPath,
        ]);
        expect(ingest.code).toBe(0);

        // Stage the pre-0227 state the backfill exists to repair (0225 left these NULL).
        const staging = new Database(dbPath);
        staging.run(
            'UPDATE items SET engagement = NULL, body_chars = NULL, source_tier = NULL, lang = NULL, domain = NULL, story_id = id',
        );
        staging.close();

        const first = await run(['store', 'backfill-facts', '--db', dbPath]);
        expect(first.code).toBe(0);
        expect(JSON.parse(first.out)).toEqual({ updated: 1 });

        const raw = new Database(dbPath, { readonly: true });
        const row = raw.query('SELECT engagement, body_chars, source_tier, domain, story_id, id FROM items').get() as {
            engagement: number;
            body_chars: number;
            source_tier: string;
            domain: string;
            story_id: string;
            id: string;
        };
        raw.close();
        expect(row).toEqual({
            engagement: 11,
            body_chars: 6,
            source_tier: 'curated',
            domain: 'example.com',
            story_id: row.id,
            id: row.id,
        });

        const second = await run(['store', 'backfill-facts', '--db', dbPath]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.out)).toEqual({ updated: 0 });
    });

    it('uses the store.story.threshold from the kk config', async () => {
        const dir = tempDir();
        const dbPath = join(dir, 'threshold.db');
        const configFile = join(dir, 'config.yaml');
        // 0.9 refuses the 0.8-similar pair the default 0.6 would merge (R3).
        writeFileSync(configFile, 'store:\n  story:\n    threshold: 0.9\n');
        process.env.KK_CONFIG = configFile;
        try {
            const ingestOne = async (id: string, title: string) => {
                const input = join(dir, `${id}.json`);
                writeFileSync(
                    input,
                    JSON.stringify([{ id, title, body: 'body', sourceUri: `https://example.com/${id}` }]),
                );
                const result = await run([
                    'store',
                    'ingest',
                    '--run',
                    `run-${id}`,
                    '--in',
                    input,
                    '--new-ids',
                    join(dir, `${id}-ids.json`),
                    '--db',
                    dbPath,
                ]);
                expect(result.code).toBe(0);
            };
            await ingestOne('first', 'OpenAI ships GPT-5');
            await ingestOne('second', 'OpenAI ships GPT-5 model');

            const raw = new Database(dbPath, { readonly: true });
            const rows = raw.query('SELECT id, story_id FROM items ORDER BY id').all() as Array<{
                id: string;
                story_id: string;
            }>;
            raw.close();
            expect(rows).toHaveLength(2);
            expect(new Set(rows.map((r) => r.story_id)).size).toBe(2);
        } finally {
            delete process.env.KK_CONFIG;
        }
    });

    it('exits 1 with kk.store.backfill-facts.failed for a database it cannot open', async () => {
        const dir = tempDir();
        const result = await run(['store', 'backfill-facts', '--db', dir]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('kk.store.backfill-facts.failed:');
        expect(result.out).toBe('');
    });
});

describe('kk store migrate', () => {
    it('prints { db, applied } and is idempotent across two runs', async () => {
        const dir = tempDir();
        const dbPath = join(dir, 'cli.db');

        const first = await run(['store', 'migrate', '--db', dbPath]);
        expect(first.code).toBe(0);
        expect(JSON.parse(first.out)).toEqual({ db: dbPath, applied: 3 });

        const second = await run(['store', 'migrate', '--db', dbPath]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.out)).toEqual({ db: dbPath, applied: 0 });

        const raw = new Database(dbPath, { readonly: true });
        const journal = raw.query('SELECT id FROM __kk_store_migrations ORDER BY id').all() as Array<{ id: string }>;
        raw.close();
        expect(journal.map((row) => row.id)).toEqual([
            '0001_kk_store_init',
            '0002_labels_confidence_run_id',
            '0003_store_v2',
        ]);

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(join(ARTIFACT_DIR, 'kk-store-cli.db'), readFileSync(dbPath));
        writeFileSync(
            join(ARTIFACT_DIR, 'kk-store-migrate.json'),
            `${JSON.stringify({ firstRun: JSON.parse(first.out), secondRun: JSON.parse(second.out) }, null, 2)}\n`,
        );
        expect(existsSync(join(ARTIFACT_DIR, 'kk-store-cli.db'))).toBe(true);
        expect(readFileSync(join(ARTIFACT_DIR, 'kk-store-cli.db')).byteLength).toBeGreaterThan(0);
    });

    it('falls back to the kk config store.db_path when --db is absent', async () => {
        const dir = tempDir();
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, `store:\n  db_path: ${join(dir, 'configured/kk.db')}\n`);
        process.env.KK_CONFIG = configFile;
        try {
            const result = await run(['store', 'migrate']);
            expect(result.code).toBe(0);
            expect(JSON.parse(result.out)).toEqual({ db: join(dir, 'configured/kk.db'), applied: 3 });
            expect(existsSync(join(dir, 'configured/kk.db'))).toBe(true);
        } finally {
            delete process.env.KK_CONFIG;
        }
    });

    it('exits 1 with kk.store.migrate.failed for a database it cannot open', async () => {
        const dir = tempDir();
        const result = await run(['store', 'migrate', '--db', dir]);

        expect(result.code).toBe(1);
        expect(result.err).toContain('kk.store.migrate.failed:');
        expect(result.out).toBe('');

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR, 'kk-store-migrate-error.txt'),
            `exit: ${result.code}\nstderr: ${result.err.trim()}\n`,
        );
    });
});

describe('kk store pool-count (0211 R5)', () => {
    it('is 0 when the pool file holds at least --min items, 1 when it does not', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }, { id: 'b' }]));
        const enough = await run(['store', 'pool-count', pool, '--min', '2']);
        expect(enough.code).toBe(0);
        expect(JSON.parse(enough.out)).toEqual({ count: 2, min: 2 });
        const short = await run(['store', 'pool-count', pool, '--min', '3']);
        expect(short.code).toBe(1);
        expect(short.err).toContain('kk.store.pool-count.empty');
        expect(JSON.parse(short.out)).toEqual({ count: 2, min: 3 });
    });

    it('counts the QC candidates shape (metadata.docs) and treats a missing file as an empty pool', async () => {
        const dir = tempDir();
        const candidateFile = join(dir, 'candidates.json');
        writeFileSync(candidateFile, JSON.stringify({ metadata: { docs: [{ id: 'a' }] } }));
        expect((await run(['store', 'pool-count', candidateFile, '--min', '1'])).code).toBe(0);
        const missing = await run(['store', 'pool-count', join(dir, 'absent.json'), '--min', '1']);
        expect(missing.code).toBe(1);
        expect(JSON.parse(missing.out)).toEqual({ count: 0, min: 1 });
        // An empty Doc[] — what `kk store extract` writes for an empty pool — is exactly that case.
        writeFileSync(join(dir, 'empty.json'), '[]');
        expect((await run(['store', 'pool-count', join(dir, 'empty.json'), '--min', '1'])).code).toBe(1);
    });

    it('refuses a negative --min loudly', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        writeFileSync(pool, '[]');
        const result = await run(['store', 'pool-count', pool, '--min', '-1']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('--min must be a non-negative integer');
    });
});
