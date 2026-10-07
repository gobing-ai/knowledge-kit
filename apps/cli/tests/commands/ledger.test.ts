/**
 * `kk ledger` command-noun surface (task 0207).
 *
 * Registration + failure contract only: the render/append/sync behaviour lives in the
 * task-pinned E2E at `apps/cli/tests/ledger.test.ts` (and its fixture golden). This file
 * exists because every module under `apps/cli/src/commands/` mirrors into
 * `apps/cli/tests/commands/<noun>.test.ts` (`require-corresponding-test`, as in
 * `tests/commands/store.test.ts`).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const RUNNING_FIXTURE = join(import.meta.dir, '../fixtures/trace-running.json');

const tempDirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-ledger-cmd-')));
    tempDirs.push(dir);
    return dir;
}

/** Executable `spur` stub whose only answer is the running-run fixture. */
function stubSpur(dir: string): string {
    const stub = join(dir, 'spur-stub.sh');
    writeFileSync(stub, `#!/bin/sh\ncat "${RUNNING_FIXTURE}"\n`);
    chmodSync(stub, 0o755);
    return stub;
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.KK_SPUR_BIN;
});

describe('registerLedgerCommand', () => {
    it('registers the ledger noun with append and sync and their required options', () => {
        const program = createProgram();
        const ledger = program.commands.find((command) => command.name() === 'ledger');
        expect(ledger).toBeDefined();

        const verbs = ledger?.commands.map((command) => command.name());
        expect(verbs).toEqual(['append', 'sync']);

        const append = ledger?.commands.find((command) => command.name() === 'append');
        expect(append?.options.map((option) => option.long)).toEqual([
            '--workflow',
            '--run',
            '--works-dir',
            '--work-dir',
        ]);
        expect(append?.options.find((option) => option.long === '--works-dir')?.defaultValue).toBe('.works');

        const sync = ledger?.commands.find((command) => command.name() === 'sync');
        expect(sync?.options.map((option) => option.long)).toEqual(['--workflow', '--works-dir', '--work-dir']);
    });
});

describe('kk ledger failure contract', () => {
    it('exits 1 with the kk.ledger.<reason> line on the stderr seam and no stdout', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        process.env.KK_SPUR_BIN = stubSpur(dir);
        const capture = captureOutput();
        try {
            const code = await main([
                'node',
                'kk',
                'ledger',
                'append',
                '--workflow',
                'kk-collect',
                '--run',
                '3f2a4b5c-1111-4222-8333-444455556666',
                '--works-dir',
                works,
            ]);
            expect(code).toBe(1);
            expect(capture.readErr()).toContain('kk.ledger.run.running');
            expect(capture.read()).toBe('');
        } finally {
            capture.restore();
            delete process.env.KK_SPUR_BIN;
        }
        expect(existsSync(join(works, 'kk-collect/ledger.md'))).toBe(false);
    });
});
