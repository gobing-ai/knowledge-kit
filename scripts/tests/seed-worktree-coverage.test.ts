/**
 * Task 0383-R3 — failure-first contract for the worktree coverage seed.
 *
 * Failures enumerated before the implementation:
 *  1. A tree at a different commit gets another commit's coverage and calls it its own.
 *  2. A source tree with uncommitted source changes seeds stale numbers.
 *  3. A missing corpus seeds nothing but reports success.
 *  4. An existing corpus is silently overwritten (destroying the tree's real evidence).
 *  5. Non-source dirt (task docs, scratch) wrongly refuses — it cannot invalidate coverage.
 *  6. The CLI path exits 0 on a refusal or 1 on success (an inverted contract a caller cannot use).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, planSeed, seedCoverage } from '../seed-worktree-coverage';

const SCRIPT = join(import.meta.dir, '..', 'seed-worktree-coverage.ts');
let root = '';
let source = '';

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe', encoding: 'utf8' });
}

/** A commit every target clones, so HEADs compare equal by construction. */
function makeSource(): string {
    const tree = join(root, 'source');
    mkdirSync(join(tree, 'apps', 'cli', 'src'), { recursive: true });
    writeFileSync(join(tree, 'apps', 'cli', 'src', 'a.ts'), 'export const a = 1;\n');
    git(tree, 'init', '-q');
    git(tree, 'add', '.');
    git(tree, 'config', 'user.email', 'test@example.com');
    git(tree, 'config', 'user.name', 'test');
    git(tree, 'commit', '-qm', 'init');
    return tree;
}

/** A second tree at the same commit (a clone never carries the corpus: it is untracked). */
function cloneOf(name: string): string {
    const tree = join(root, name);
    git(root, 'clone', '-q', '--no-hardlinks', source, tree);
    return tree;
}

function writeCorpus(tree: string): void {
    mkdirSync(join(tree, '.coverage'), { recursive: true });
    writeFileSync(join(tree, '.coverage', 'lcov.info'), 'SF:apps/cli/src/a.ts\nLF:1\nLH:1\nend_of_record\n');
}

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'seed-cov-'));
    source = makeSource();
    writeCorpus(source);
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('seed-worktree-coverage (0383 R3)', () => {
    it('copies the corpus between trees at the same commit', () => {
        const target = cloneOf('same-commit');
        const result = seedCoverage(source, target);
        expect(result.ok).toBe(true);
        expect(readFileSync(join(target, '.coverage', 'lcov.info'), 'utf8')).toContain('SF:apps/cli/src/a.ts');
    });

    it('refuses a tree at a different commit', () => {
        const target = cloneOf('other-commit');
        writeFileSync(join(target, 'apps', 'cli', 'src', 'b.ts'), 'export const b = 2;\n');
        git(target, 'add', '.');
        git(target, 'commit', '-qm', 'second');
        const result = planSeed(source, target);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('trees differ');
    });

    it('refuses a source tree with uncommitted source changes', () => {
        const dirty = cloneOf('dirty-source');
        writeCorpus(dirty);
        const target = cloneOf('dirty-target');
        writeFileSync(join(dirty, 'apps', 'cli', 'src', 'a.ts'), 'export const a = 2;\n');
        const result = planSeed(dirty, target);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('uncommitted source changes');
    });

    it('ignores non-source dirt', () => {
        const clean = cloneOf('clean-source');
        writeCorpus(clean);
        const target = cloneOf('docs-dirt-target');
        writeFileSync(join(clean, 'notes.md'), 'scratch\n');
        writeFileSync(join(clean, 'docs-tasks-note.txt'), 'scratch\n');
        expect(planSeed(clean, target).ok).toBe(true);
    });

    it('refuses to overwrite an existing corpus', () => {
        const target = cloneOf('has-corpus');
        writeCorpus(target);
        const result = planSeed(source, target);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('already has its own coverage corpus');
    });

    it('refuses when the source has no corpus', () => {
        const empty = cloneOf('no-corpus');
        const result = planSeed(empty, cloneOf('wants-corpus'));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('no coverage corpus');
    });

    it('exits non-zero on a refusal so a caller can gate on it', () => {
        const empty = cloneOf('cli-no-corpus');
        const run = Bun.spawnSync([process.execPath, SCRIPT, empty, '--root', cloneOf('cli-target')], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(run.exitCode).toBe(1);
        expect(new TextDecoder().decode(run.stderr)).toContain('refused');
    });

    it('exits zero and reports the copied corpus on success', () => {
        const seeded = cloneOf('cli-source');
        writeCorpus(seeded);
        const target = cloneOf('cli-target-ok');
        const run = Bun.spawnSync([process.execPath, SCRIPT, seeded, '--root', target], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(run.exitCode).toBe(0);
        expect(new TextDecoder().decode(run.stdout)).toContain('copied');
        expect(existsSync(join(target, '.coverage', 'lcov.info'))).toBe(true);
    });
});

describe('seed-worktree-coverage main (0383 R3)', () => {
    it('returns 0 when it seeded, 1 when refused and 2 on usage', () => {
        const seeded = cloneOf('main-source');
        writeCorpus(seeded);
        expect(main([seeded, '--root', cloneOf('main-target')])).toBe(0);
        expect(main([seeded, '--root', cloneOf('main-target-refused')])).toBe(0);
        expect(main(['/nonexistent/source', '--root', cloneOf('main-target-missing')])).toBe(1);
        expect(main([])).toBe(2);
    });
});
