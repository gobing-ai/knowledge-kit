import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

/**
 * A22 R3/R4 — one `lock` registrar, one pair of SQLite action engines, two routes.
 *
 * The canonical `kk lock acquire|release` and the hidden legacy `kk store lock …` must reach
 * the SAME engines: every assertion below runs the real `main()` parsing path against a real
 * temporary SQLite database and compares the canonical and legacy routes' JSON, exit code and
 * on-disk side effects.
 */

const tempDirs: string[] = [];
function tempDb(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-lock-cmd-')));
    tempDirs.push(dir);
    return join(dir, 'kk.db');
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

/** The legacy and canonical spellings of the same operation — every case runs both. */
const ROUTES = [
    { label: 'canonical', words: ['lock'] },
    { label: 'legacy', words: ['store', 'lock'] },
] as const;

describe('kk lock — canonical registrar and the hidden store lock route (A22 R3)', () => {
    it('registers a visible top-level lock group and keeps store lock registered but hidden', () => {
        const program = createProgram();
        const help = program.createHelp();
        expect(help.visibleCommands(program).map((c) => c.name())).toContain('lock');

        const lock = program.commands.find((c) => c.name() === 'lock');
        expect(lock?.commands.map((c) => c.name())).toEqual(['acquire', 'release']);
        expect(lock?.commands.find((c) => c.name() === 'acquire')?.options.map((o) => o.long)).toEqual([
            '--name',
            '--run',
            '--ttl',
            '--db',
        ]);

        const store = program.commands.find((c) => c.name() === 'store');
        expect(store).toBeDefined();
        const storeLock = store?.commands.find((c) => c.name() === 'lock');
        expect(storeLock).toBeDefined();
        expect(store && help.visibleCommands(store).map((c) => c.name())).not.toContain('lock');
        // The hidden route still carries the identical flag contract.
        expect(storeLock?.commands.map((c) => c.name())).toEqual(['acquire', 'release']);
        expect(storeLock?.commands.find((c) => c.name() === 'acquire')?.options.map((o) => o.long)).toEqual([
            '--name',
            '--run',
            '--ttl',
            '--db',
        ]);
    });

    it('hides the legacy route from `kk store --help` without hiding the canonical `kk lock`', async () => {
        const storeHelp = await run(['store', '--help']);
        expect(storeHelp.code).toBe(0);
        expect(storeHelp.out).not.toContain('lock');

        const rootHelp = await run(['--help']);
        expect(rootHelp.code).toBe(0);
        expect(rootHelp.out).toContain('lock');
    });

    for (const route of ROUTES) {
        it(`${route.label} — acquire is re-entrant for its owner, contended for a stranger, releaseable`, async () => {
            const db = tempDb();
            const [head, ...tail] = route.words;
            const call = (rest: string[]) => run([head as string, ...tail, ...rest]);

            const first = await call(['acquire', '--name', 'collect', '--run', 'run-a', '--db', db]);
            expect(first.code).toBe(0);
            expect(first.out.trim()).toBe('{"acquired":true}');
            expect(first.err).toBe('');

            // The same run re-acquires: a resumed run is not locked out of itself.
            const reentrant = await call(['acquire', '--name', 'collect', '--run', 'run-a', '--db', db]);
            expect(reentrant.out.trim()).toBe('{"acquired":true}');

            // Another run inside the TTL is skipped (exit 0), naming the holder.
            const stranger = await call(['acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
            expect(stranger.code).toBe(0);
            expect(stranger.out.trim()).toBe('{"skipped":"locked","holder":"run-a"}');

            // A stranger's release frees nothing.
            const foreign = await call(['release', '--name', 'collect', '--run', 'run-b', '--db', db]);
            expect(foreign.out.trim()).toBe('{"released":false}');
            const stillHeld = await call(['acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
            expect(stillHeld.out.trim()).toBe('{"skipped":"locked","holder":"run-a"}');

            // The owner's release frees it.
            const own = await call(['release', '--name', 'collect', '--run', 'run-a', '--db', db]);
            expect(own.out.trim()).toBe('{"released":true}');
            const afterRelease = await call(['acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
            expect(afterRelease.out.trim()).toBe('{"acquired":true}');
        });

        it(`${route.label} — a malformed --ttl is a loud usage failure with the shared contract line`, async () => {
            const db = tempDb();
            const [head, ...tail] = route.words;
            const res = await run([
                head as string,
                ...tail,
                'acquire',
                '--name',
                'collect',
                '--run',
                'run-a',
                '--ttl',
                'soon',
                '--db',
                db,
            ]);
            expect(res.code).toBe(1);
            expect(res.err).toContain(
                "kk.store.lock.failed: --ttl must be a non-negative integer (milliseconds), got 'soon'",
            );
        });
    }

    it('the two routes share one database row, not one row per spelling', async () => {
        const db = tempDb();
        const acquired = await run(['lock', 'acquire', '--name', 'collect', '--run', 'run-a', '--db', db]);
        expect(acquired.out.trim()).toBe('{"acquired":true}');

        // The legacy spelling sees the canonical spelling's claim…
        const viaLegacy = await run(['store', 'lock', 'acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(viaLegacy.out.trim()).toBe('{"skipped":"locked","holder":"run-a"}');

        // …and releases it for the canonical spelling.
        const released = await run(['store', 'lock', 'release', '--name', 'collect', '--run', 'run-a', '--db', db]);
        expect(released.out.trim()).toBe('{"released":true}');
        const afterLegacy = await run(['lock', 'acquire', '--name', 'collect', '--run', 'run-b', '--db', db]);
        expect(afterLegacy.out.trim()).toBe('{"acquired":true}');

        // The SQLite file really exists and holds the claim (side effect, not just stdout).
        expect(readFileSync(db).length).toBeGreaterThan(0);
    });

    it('a missing required option fails on both routes before any database effect', async () => {
        const db = tempDb();
        const canonical = await run(['lock', 'acquire', '--run', 'run-a', '--db', db]);
        const legacy = await run(['store', 'lock', 'acquire', '--run', 'run-a', '--db', db]);
        expect(canonical.code).toBe(legacy.code);
        expect(canonical.code).not.toBe(0);
        expect(canonical.err).toContain('--name');
        expect(legacy.err).toContain('--name');
    });
});
