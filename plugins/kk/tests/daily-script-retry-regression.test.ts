import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedItemSections } from '../../../plugins/kk/scripts/daily-stages';

/**
 * 0347 F5 (2026-11-10) — regression for the 2026-11-09 script/article exclusion divergence.
 *
 * What failed: the article writer recorded 3 of 8 plan items as excluded (`22-article/…_06_…`
 * metadata `excludedIds`) while the script build kept all 8 item sections, so the generate guard
 * (`expectedItemSections` vs the VoiceScript's item sections) refused the run — three times, once
 * through the `script-write-fix` retry whose revalidation flows back through `daily-script-check`.
 *
 * What must hold: BOTH kk-plugin call sites (script write + script check revalidation) hand the
 * validator the curate exclusion record (`DAILYNEWS_CURATE_EXCLUDED`), the `script-write-fix`
 * agent prompt points at the same record, and the guard arithmetic counts article-excluded items
 * out of the expected section count.
 */
describe('script/article exclusion divergence regression (0347 F5)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
    const stagesSource = readFileSync(resolve(import.meta.dir, '../scripts/daily-stages.ts'), 'utf-8');

    it('both script call sites pass DAILYNEWS_CURATE_EXCLUDED to the dailynews-gen validator', () => {
        // script write (4041) + script check (4124) — exactly two: the retry path revalidates
        // through daily-script-check, so a third (or missing) site is the divergence risk again.
        expect(stagesSource.match(/DAILYNEWS_CURATE_EXCLUDED:/g)?.length).toBe(2);
    });

    it('expectedItemSections — article-excluded items drop out of the expected section count', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-f5-guard-'));
        const date = '20261109';
        const article = join(dir, '22-article', `${date}_06_article_content.json`);
        mkdirSync(join(article, '..'), { recursive: true });
        writeFileSync(
            article,
            JSON.stringify({ schema: 'content.v1', title: 't', body: 'b', metadata: { excludedIds: ['a', 'c'] } }),
        );
        const planItems = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
        expect(expectedItemSections(dir, date, planItems)).toBe(2);
        // No exclusion record, or an empty one: every plan item is expected.
        writeFileSync(article, JSON.stringify({ schema: 'content.v1', title: 't', body: 'b' }));
        expect(expectedItemSections(dir, date, planItems)).toBe(4);
        writeFileSync(
            article,
            JSON.stringify({ schema: 'content.v1', title: 't', body: 'b', metadata: { excludedIds: [] } }),
        );
        expect(expectedItemSections(dir, date, planItems)).toBe(4);
        rmSync(dir, { recursive: true, force: true });
    });

    it('daily-script-check hands the exclusion record to the validator and clears stale errors on acceptance', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-f5-check-'));
        const binDir = join(root, 'bin');
        const workDir = join(root, 'work');
        const logFile = join(root, 'calls.log');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '22-article'), { recursive: true });
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        const date = '20261109';
        writeFileSync(join(workDir, '21-plan', `${date}_03_plan_plan.json`), JSON.stringify({ items: [{ id: 'a' }] }));
        // A poisoned retry plan (e.g. what script-write-fix just wrote).
        writeFileSync(
            join(workDir, '24-script', `${date}_08_script-write_plan.json`),
            JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] }),
        );
        // Stale errors from the previous validator pass — acceptance must clear them.
        writeFileSync(
            join(workDir, '24-script', `${date}_08_script-write_errors.json`),
            JSON.stringify([{ itemId: 'a', rule: 'item-section-mismatch' }]),
        );
        const excludedPath = join(workDir, '21-plan', `${date}_03_curate_excluded.json`);
        writeFileSync(excludedPath, JSON.stringify(['b']));
        writeFileSync(
            join(workDir, '22-article', `${date}_06_article_content.json`),
            JSON.stringify({ schema: 'content.v1', title: 't', body: 'b', metadata: { excludedIds: ['b'] } }),
        );
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
if (process.env.KK_SHIM_LOG) {
    appendFileSync(process.env.KK_SHIM_LOG, JSON.stringify({
        excluded: process.env.DAILYNEWS_CURATE_EXCLUDED ?? null,
        plan: process.env.DAILYNEWS_SCRIPT_PLAN ?? null,
    }) + '\\n');
}
writeFileSync(outPath, JSON.stringify({ metadata: { scriptSource: 'plan' } }));
`,
        );
        chmodSync(shimPath, 0o755);
        const res = spawnSync('bun', [runner, 'daily-script-check', workDir, date], {
            encoding: 'utf-8',
            env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KK_SHIM_LOG: logFile },
        });
        expect(res.status).toBe(0);
        expect(readFileSync(logFile, 'utf-8')).toContain(`"excluded":"${excludedPath}"`);
        expect(existsSync(join(workDir, '24-script', `${date}_08_script-write_errors.json`))).toBe(false);
        expect(res.stdout).toContain('script plan accepted by the validator');
        rmSync(root, { recursive: true, force: true });
    });

    it('daily-script-check — a template fallback writes the errors file the retry fix reads', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-f5-reject-'));
        const binDir = join(root, 'bin');
        const workDir = join(root, 'work');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        const date = '20261109';
        writeFileSync(join(workDir, '21-plan', `${date}_03_plan_plan.json`), JSON.stringify({ items: [{ id: 'a' }] }));
        writeFileSync(
            join(workDir, '24-script', `${date}_08_script-write_plan.json`),
            JSON.stringify({ items: [{ id: 'a' }] }),
        );
        const errorsOut = join(workDir, '24-script', `${date}_08_script-write_errors.json`);
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(args[args.indexOf('--out') + 1] ?? '', JSON.stringify({
    metadata: { scriptSource: 'template', scriptPlanErrors: [{ itemId: 'a', rule: 'item-section-mismatch' }] },
}));
`,
        );
        chmodSync(shimPath, 0o755);
        const res = spawnSync('bun', [runner, 'daily-script-check', workDir, date], {
            encoding: 'utf-8',
            env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        });
        expect(res.status).toBe(0);
        const errors = JSON.parse(readFileSync(errorsOut, 'utf-8')) as { rule: string }[];
        expect(errors).toEqual([{ itemId: 'a', rule: 'item-section-mismatch' }]);
        expect(res.stdout).toContain('script plan rejected');
        rmSync(root, { recursive: true, force: true });
    });
});
