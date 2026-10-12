/**
 * G8/0252 — the `kk board` noun: the registered command surface, the capture action's
 * happy/failure paths and the serve guard. The capture happy path runs as a child process
 * with its own cwd, exactly as workflow preparation invokes it.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const REPO = resolve(import.meta.dir, '../../../..');
const CLI = join(REPO, 'apps/cli/src/index.ts');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
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

describe('registerBoardCommand', () => {
    it('registers serve and capture with the frozen option surface', () => {
        const board = createProgram().commands.find((command) => command.name() === 'board');
        expect(board?.commands.map((command) => command.name())).toEqual(['serve', 'capture']);
        const serve = board?.commands.find((command) => command.name() === 'serve');
        expect(serve?.options.map((option) => option.long)).toEqual(['--board-origin', '--port']);
        const capture = board?.commands.find((command) => command.name() === 'capture');
        expect(capture?.options.map((option) => option.long)).toEqual([
            '--workflow',
            '--run',
            '--work-dir',
            '--stamp',
            '--definition-digest',
            '--trusted-root',
            '--setting',
        ]);
        expect(capture?.options.filter((option) => option.mandatory).map((option) => option.long)).toEqual([
            '--workflow',
            '--run',
            '--work-dir',
            '--stamp',
        ]);
    });

    it('fails loud when serve is given a non-loopback origin', async () => {
        const { code, err } = await run(['board', 'serve', '--board-origin', 'http://evil.example']);
        expect(code).toBe(1);
        expect(err).toContain('kk.board.serve.failed');
    });

    it('fails loud for an unknown workflow or an unknown setting value', async () => {
        const unknown = await run([
            'board',
            'capture',
            '--workflow',
            'nope',
            '--run',
            'r1',
            '--work-dir',
            '/tmp/x',
            '--stamp',
            'S1',
        ]);
        expect(unknown.code).toBe(1);
        expect(unknown.err).toContain('kk.board.capture.failed');
        const badValue = await run([
            'board',
            'capture',
            '--workflow',
            'kk-collect',
            '--run',
            'r1',
            '--work-dir',
            '/tmp/x',
            '--stamp',
            'S1',
            '--setting',
            'limit=soon',
        ]);
        expect(badValue.code).toBe(1);
    });
});

describe('kk board capture (child process)', () => {
    it('writes the record and owner marker from its own cwd', () => {
        const root = tempDir('kk-board-cli-');
        const workDir = join(root, '.works', 'kk-collect', 'S1');
        mkdirSync(workDir, { recursive: true });
        const child = Bun.spawnSync(
            [
                process.execPath,
                CLI,
                'board',
                'capture',
                '--workflow',
                'kk-collect',
                '--run',
                'r1',
                '--work-dir',
                workDir,
                '--stamp',
                'S1',
                '--setting',
                'limit=10',
                '--setting',
                'topic=ignored',
            ],
            { cwd: root, stdout: 'pipe', stderr: 'pipe' },
        );
        expect(child.exitCode).toBe(0);
        const printed = JSON.parse(child.stdout.toString()) as { captured: boolean; revoked: boolean };
        expect(printed).toMatchObject({ captured: true, revoked: false });
        expect(existsSync(join(root, '.works', '.board', 'runs', 'r1.json'))).toBe(true);
        const record = JSON.parse(readFileSync(join(root, '.works', '.board', 'runs', 'r1.json'), 'utf-8'));
        expect(record.settings).toEqual({ limit: '10' });
        expect(record.workspacePath).toBe(realpathSync(workDir));
    });
});

describe('kk board capture (in-process)', () => {
    it('rejects a non-integer port before serving', async () => {
        await expect(run(['board', 'serve', '--board-origin', 'http://127.0.0.1:1', '--port', 'abc'])).rejects.toThrow(
            /--port must be an integer/,
        );
    });

    it('prints the capture outcome and drops an unknown setting from its own cwd', async () => {
        const root = tempDir('kk-board-inproc-');
        const workDir = join(root, '.works', 'kk-collect', 'S1');
        mkdirSync(workDir, { recursive: true });
        const previousCwd = process.cwd();
        process.chdir(root);
        try {
            const { code, out } = await run([
                'board',
                'capture',
                '--workflow',
                'kk-collect',
                '--run',
                'r1',
                '--work-dir',
                workDir,
                '--stamp',
                'S1',
                '--setting',
                'limit=10',
                '--setting',
                'topic=ignored',
            ]);
            expect(code).toBe(0);
            expect(JSON.parse(out)).toMatchObject({ captured: true, revoked: false, runId: 'r1' });
            expect(existsSync(join(root, '.works', '.board', 'runs', 'r1.json'))).toBe(true);
        } finally {
            process.chdir(previousCwd);
        }
    });
});
