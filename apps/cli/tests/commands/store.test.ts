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
    it('registers the store noun with migrate, lock, ingest, label, extract and mark-used and their options', () => {
        const program = createProgram();
        const store = program.commands.find((command) => command.name() === 'store');
        expect(store).toBeDefined();
        expect(store?.commands.map((command) => command.name())).toEqual([
            'migrate',
            'lock',
            'ingest',
            'label',
            'extract',
            'mark-used',
        ]);

        const lock = store?.commands.find((command) => command.name() === 'lock');
        expect(lock?.commands.map((command) => command.name())).toEqual(['acquire', 'release']);

        const label = store?.commands.find((command) => command.name() === 'label');
        expect(label?.options.map((option) => option.long)).toEqual([
            '--run',
            '--new-ids',
            '--maker',
            '--mode',
            '--db',
        ]);
        expect(label?.options.find((option) => option.long === '--maker')?.defaultValue).toBe('fm-local');
        expect(label?.options.find((option) => option.long === '--mode')?.defaultValue).toBe('heuristic');
        expect(label?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--run',
            '--new-ids',
        ]);

        const extract = store?.commands.find((command) => command.name() === 'extract');
        expect(extract?.options.map((option) => option.long)).toEqual([
            '--topic',
            '--window',
            '--limit',
            '--exclude-used',
            '--out',
            '--db',
        ]);
        expect(extract?.options.find((option) => option.long === '--window')?.defaultValue).toBe('24h');
        expect(extract?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--topic',
            '--out',
        ]);

        const markUsed = store?.commands.find((command) => command.name() === 'mark-used');
        expect(markUsed?.options.map((option) => option.long)).toEqual(['--workflow', '--run', '--in', '--db']);
        expect(markUsed?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--workflow',
            '--run',
            '--in',
        ]);
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

    it('exits non-zero when label is called without --run/--new-ids (commander required options)', async () => {
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

describe('kk store migrate', () => {
    it('prints { db, applied } and is idempotent across two runs', async () => {
        const dir = tempDir();
        const dbPath = join(dir, 'cli.db');

        const first = await run(['store', 'migrate', '--db', dbPath]);
        expect(first.code).toBe(0);
        expect(JSON.parse(first.out)).toEqual({ db: dbPath, applied: 2 });

        const second = await run(['store', 'migrate', '--db', dbPath]);
        expect(second.code).toBe(0);
        expect(JSON.parse(second.out)).toEqual({ db: dbPath, applied: 0 });

        const raw = new Database(dbPath, { readonly: true });
        const journal = raw.query('SELECT id FROM __kk_store_migrations ORDER BY id').all() as Array<{ id: string }>;
        raw.close();
        expect(journal.map((row) => row.id)).toEqual(['0001_kk_store_init', '0002_labels_confidence_run_id']);

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
            expect(JSON.parse(result.out)).toEqual({ db: join(dir, 'configured/kk.db'), applied: 2 });
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
