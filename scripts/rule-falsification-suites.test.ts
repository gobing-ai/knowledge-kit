import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The rule checkers under `.spur/rules/**` ship a shell falsification suite beside each checker
 * (`<checker>.test.sh`), and until now nothing ran them: `spur rule run` executes the checker
 * against the corpus, so a suite's cases were documentation that could rot silently. This test is
 * the runner — it pairs each checker with its suite and executes every suite, so a rule that stops
 * refusing what it must refuse fails `bun test` instead of waiting for a human to run it by hand.
 */
const REPO_ROOT = join(import.meta.dir, '..');
const RULES_DIR = join(REPO_ROOT, '.spur', 'rules');

/** Every file under `dir` whose name ends in `suffix`, sorted for a deterministic report. */
function filesEndingWith(dir: string, suffix: string): string[] {
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) return filesEndingWith(path, suffix);
            return entry.name.endsWith(suffix) ? [path] : [];
        })
        .sort();
}

const checkers = filesEndingWith(RULES_DIR, '.sh').filter((path) => !path.endsWith('.test.sh'));
const suites = filesEndingWith(RULES_DIR, '.test.sh');

describe('rule falsification suites', () => {
    it('every shell checker has a suite beside it', () => {
        const missing = checkers.filter((checker) => !suites.includes(`${checker.slice(0, -3)}.test.sh`));
        expect(missing.map((path) => relative(REPO_ROOT, path))).toEqual([]);
    });

    for (const suite of suites) {
        it(`${relative(REPO_ROOT, suite)} refutes what its rule must refuse`, () => {
            const result = spawnSync('sh', [suite], { cwd: REPO_ROOT, encoding: 'utf8' });
            const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
            // A suite prints its own tally; asserting both keeps the failure readable (bun prints
            // the compared object) and stops a suite that silently ran zero cases from passing.
            expect(output).toMatch(/\d+ passed, 0 failed$/);
            expect(result.status).toBe(0);
        });
    }
});
