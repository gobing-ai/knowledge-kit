import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The `prepare-commit-msg` half of the merge story: git writes `Merge branch 'main' of <url>`, cog
 * rejects that as a Conventional Commit, and the merge is left uncommitted with `MERGE_HEAD` set.
 * These cases pin the rewrite and, more importantly, that nothing else is touched.
 */
describe('merge-commit-subject (prepare-commit-msg hook body)', () => {
    const script = join(import.meta.dir, '..', 'merge-commit-subject.ts');

    /** Run the hook body over `message` and return what the commit would carry. */
    const run = (message: string, args: string[] = ['merge', 'abc1234', 'main']) => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-merge-msg-'));
        const file = join(dir, 'COMMIT_EDITMSG');
        try {
            writeFileSync(file, message);
            const result = spawnSync(process.execPath, [script, file, ...args], { encoding: 'utf-8' });
            expect(result.status).toBe(0);
            return readFileSync(file, 'utf-8');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };

    it('rewrites a generated merge subject and keeps git’s text as the body', () => {
        expect(run("Merge branch 'main' of https://example.com/repo.git\n\n# Please enter a message\n")).toBe(
            "chore: merge abc1234 into main\n\nMerge branch 'main' of https://example.com/repo.git\n\n# Please enter a message\n",
        );
    });

    it('rewrites the plural subject a `git pull -a` merge produces', () => {
        expect(run("Merge branches 'main' and 'main' of /repo\n")).toStartWith('chore: merge abc1234 into main\n');
    });

    it('leaves a human message alone', () => {
        expect(run('feat(cli): add the thing\n', ['message'])).toBe('feat(cli): add the thing\n');
    });

    it('leaves an already conventional merge subject alone', () => {
        expect(run('chore: merge origin/main into main\n')).toBe('chore: merge origin/main into main\n');
    });

    it('does nothing without a message file', () => {
        const result = spawnSync(process.execPath, [script], { encoding: 'utf-8' });
        expect(result.status).toBe(0);
    });
});
