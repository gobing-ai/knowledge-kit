import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

/**
 * 0347 F6 (2026-11-10) — when the plan fingerprint no longer matches (pool drift between the
 * authoring day and a rerun) but downstream artifacts exist, daily-plan keeps the existing plan:
 * old artifacts stay paired with the plan that produced them. The old fail-closed refusal made
 * every next-day rerun of a failed episode unrecoverable. Rebuilding is explicit — delete the
 * plan outputs and descendants.
 */
describe('daily-plan freeze on pool drift with authored descendants (0347 F6)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
    const date = '20261109';

    function fingerprint(poolText: string): string {
        return createHash('sha256')
            .update(JSON.stringify({ version: 1, source: poolText, inputs: { runDate: date, planMaxItems: '8', deferPlanDocs: 'true' } }))
            .digest('hex');
    }

    function withFixture(): {
        root: string;
        workDir: string;
        logFile: string;
        run: () => ReturnType<typeof spawnSync>;
    } {
        const root = mkdtempSync(join(tmpdir(), 'kk-plan-freeze-'));
        const workDir = join(root, 'works');
        const binDir = join(root, 'bin');
        const logFile = join(root, 'shim.jsonl');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '10-collect'), { recursive: true });
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '22-article'), { recursive: true });
        // The kk shim records any stage-driven executor invocation; a frozen plan must not run one.
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { appendFileSync } from 'node:fs';
if (process.env.KK_SHIM_LOG) appendFileSync(process.env.KK_SHIM_LOG, process.argv.slice(2).join(' ') + '\\n');
process.exit(3);
`,
        );
        chmodSync(shimPath, 0o755);
        const run = () =>
            spawnSync('bun', [runner, 'daily-plan', workDir, date, '/nonexistent-plugins', '8', 'true'], {
                encoding: 'utf-8',
                env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KK_SHIM_LOG: logFile },
            });
        return { root, workDir, logFile, run };
    }

    it('keeps the plan and exits 0 when the pool changed after authoring', () => {
        const { root, workDir, logFile, run } = withFixture();
        const poolNow = JSON.stringify([{ id: 'drifted' }]);
        const planJson = JSON.stringify({ schema: 'content.v1', metadata: { docs: [{ id: 'a' }] } });
        writeFileSync(join(workDir, '10-collect', 'pool.json'), poolNow);
        writeFileSync(join(workDir, '21-plan', `${date}_03_plan_content.json`), planJson);
        // Cache stamped against the ORIGINAL pool — deliberately mismatched.
        writeFileSync(
            join(workDir, '21-plan', `${date}_03_plan_content.json.cache.json`),
            JSON.stringify({ version: 1, fingerprint: fingerprint(JSON.stringify([{ id: 'original' }])) }),
        );
        writeFileSync(join(workDir, '22-article', `${date}_06_article_article.md`), '# authored');

        const res = run();
        expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
        expect(res.stderr).toContain('keeping the existing plan');
        expect(readFileSync(join(workDir, '21-plan', `${date}_03_plan_content.json`), 'utf-8')).toBe(planJson);
        // No regeneration ran — a frozen plan must not invoke the executor.
        expect(existsSync(logFile)).toBe(false);
        rmSync(root, { recursive: true, force: true });
    });

    it('regenerates the plan when the pool changed but nothing was authored', () => {
        const { root, workDir, logFile, run } = withFixture();
        writeFileSync(join(workDir, '10-collect', 'pool.json'), JSON.stringify([{ id: 'drifted' }]));
        writeFileSync(join(workDir, '21-plan', `${date}_03_plan_content.json`), '{"stale":true}');
        writeFileSync(
            join(workDir, '21-plan', `${date}_03_plan_content.json.cache.json`),
            JSON.stringify({ version: 1, fingerprint: fingerprint(JSON.stringify([{ id: 'original' }])) }),
        );

        const res = run();
        // The shim exits 3 — proof the stage reached the executor path instead of refusing.
        expect(res.status).toBe(3);
        expect(readFileSync(logFile, 'utf-8')).toContain('episode-plan-gen');
        rmSync(root, { recursive: true, force: true });
    });
});
