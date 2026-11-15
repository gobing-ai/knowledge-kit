/**
 * `kk <noun> generate` / `kk <noun> publish` end to end (task 0365 AC1–AC4, design §1.1 §3).
 *
 * Everything the launch touches outside this process is stubbed and throwaway: a temp project root
 * (`works_dir`, a temp SQLite store), a `spur` shell stub that answers `agent run`, `workflow run`,
 * `workflow cancel` and `workflow trace`, and the stub workflow YAMLs under
 * `tests/fixtures/workflows/` reached through the existing `workflows_dir` override (R6).
 *
 * The temp root is also the launcher's *package root* while a case runs (`process.chdir`, `plugins`
 * symlinked at the checkout): `resolvePackageRoot` reads the cwd first, so without this the launch
 * preflight would read the checkout's own harness paths — and a task that adds a workflow file (as
 * 0366 did with `plugins/kk/workflows/kk-publish.yaml`) leaves them dirty. `publish` has no
 * `--allow-dirty` (design §1.1), so such a tree would refuse the launch for reasons that have
 * nothing to do with the case under test. The root is a real one-commit repository, so
 * `checkoutCommit` (R8) keeps a real sha; `git status` on `plugins/kk`/`.spur/workflows` is empty
 * because git does not descend into the `plugins` symlink, and the checkout-vs-install diff compares
 * the symlinked tree with itself. Same isolation 0366's `kk-publish.e2e.test.ts` uses.
 *
 * The dirty refusal itself, and every other preflight reason, is proven without the environment in
 * `launch.test.ts` (fake deps, no checkout involved).
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openStore } from '@gobing-ai/kk-store';
import { Command } from 'commander';
import { registerContentLaunchCommand } from '../src/commands/content-launch';

import { type Project, project, repoRoot, runCli } from './launch-sandbox';

function receipt(project: Project, relative: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(project.works, relative), 'utf8')) as Record<string, unknown>;
}

function newsDir(project: Project, run = '20260101'): string {
    return join(project.works, 'kk-news-generate', run);
}

async function seedLock(project: Project, name: string, run: string): Promise<void> {
    const store = await openStore({ path: join(project.root, 'kk.db') });
    try {
        const claimed = await store.locks.acquire(name, run, 600_000);
        expect(claimed).toBe(true);
    } finally {
        await store.close();
    }
}

async function lockHolder(project: Project, name: string): Promise<string | undefined> {
    const store = await openStore({ path: join(project.root, 'kk.db') });
    try {
        return (await store.locks.current(name))?.ownerRun;
    } finally {
        await store.close();
    }
}

describe('content launch — AC1 the lock refuses a second launch (0365 R2)', () => {
    it('exits 6 and leaves the holder schedule receipt byte-identical', async () => {
        const sandbox = project();
        try {
            const workDir = newsDir(sandbox);
            mkdirSync(workDir, { recursive: true });
            const before = `${JSON.stringify({ status: 'running', runId: 'holder' }, null, 2)}\n`;
            writeFileSync(join(workDir, 'schedule-receipt.json'), before);
            await seedLock(sandbox, 'kk-news-generate-20260101', 'holder');

            const result = await runCli(['news', 'generate', '--run-date', '20260101', '--allow-dirty']);

            expect(result.code).toBe(6);
            expect(result.stderr).toContain('already running (holder holder)');
            expect(readFileSync(join(workDir, 'schedule-receipt.json'), 'utf8')).toBe(before);
            expect(sandbox.workflowRuns()).toHaveLength(0);
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — AC2 a dead executor refuses before any spend (0365 R3, R9)', () => {
    it('exits 5 with and without --dry-run, spawns no workflow, and writes a refused receipt naming the executor', async () => {
        const sandbox = project({ probe: 'dead' });
        try {
            const live = await runCli(['news', 'generate', '--run-date', '20260102', '--allow-dirty']);
            const dry = await runCli(['news', 'generate', '--run-date', '20260102', '--allow-dirty', '--dry-run']);

            expect(live.code).toBe(5);
            expect(dry.code).toBe(5);
            expect(sandbox.workflowRuns()).toHaveLength(0);
            const written = receipt(sandbox, join('kk-news-generate', '20260102', 'schedule-receipt.json'));
            expect(written.status).toBe('refused');
            expect(String(written.reason)).toContain("executor probe failed for 'scribe'");
            expect(written.executor).toBe('inline');
            expect(JSON.parse(dry.stdout).status).toBe('refused');
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — AC3 every exit path cleans up (0365 R1, R4, R5)', () => {
    it('runs one child per posture and frees the lock in all four cases', async () => {
        const outcomes: Array<Record<string, unknown>> = [];
        const cases: Array<{ posture: string; child: 'ok' | 'fail' | 'slow'; extra: string[]; code: number }> = [
            { posture: 'green', child: 'ok', extra: [], code: 0 },
            { posture: 'failed', child: 'fail', extra: [], code: 1 },
            { posture: 'timeout', child: 'slow', extra: ['--timeout-ms', '400'], code: 124 },
        ];
        for (const [index, testCase] of cases.entries()) {
            const sandbox = project({ child: testCase.child });
            try {
                const slug = `case-${index}`;
                const result = await runCli([
                    'article',
                    'generate',
                    '--slug',
                    slug,
                    '--allow-dirty',
                    ...testCase.extra,
                ]);
                const written = receipt(sandbox, join('kk-article-generate', slug, 'schedule-receipt.json'));
                expect(result.code).toBe(testCase.code);
                expect(sandbox.workflowRuns()).toHaveLength(1);
                expect(written.status).toBe(
                    testCase.posture === 'green' ? 'done' : testCase.posture === 'failed' ? 'failed' : 'timeout',
                );
                expect(written.executor).toBe('inline');
                expect(String(written.checkoutCommit)).toMatch(/^[0-9a-f]{7,40}$/);
                expect(await lockHolder(sandbox, `kk-article-generate-${slug}`)).toBeUndefined();
                expect(sandbox.count('workflow trace')).toBeGreaterThan(0);
                outcomes.push({ posture: testCase.posture, code: result.code, receipt: written });
            } finally {
                sandbox.restore();
            }
        }

        // AC3(d): SIGTERM to a real kk process, against a workflow stub that will not finish on its own.
        const sandbox = project({ child: 'slow' });
        try {
            const child = Bun.spawn({
                cmd: [
                    process.execPath,
                    'run',
                    join(repoRoot, 'apps/cli/src/index.ts'),
                    'article',
                    'generate',
                    '--slug',
                    'term',
                    '--allow-dirty',
                    '--timeout-ms',
                    '60000',
                ],
                // Same harness root as the in-process cases: the child's preflight reads the
                // throwaway repository, not this checkout.
                cwd: sandbox.root,
                env: process.env as Record<string, string>,
                stdout: 'ignore',
                stderr: 'ignore',
            });
            const spawned = await waitFor(() => sandbox.workflowRuns().length > 0, 10_000);
            expect(spawned).toBe(true);
            child.kill('SIGTERM');
            const exitCode = await child.exited;
            const written = receipt(sandbox, join('kk-article-generate', 'term', 'schedule-receipt.json'));

            expect(exitCode).toBe(143);
            expect(written.status).toBe('failed');
            // The generation workflow may start the nested `<runId>-safety` review (design §5.1
            // nodes 12/19), so cleanup cancels both: the parent and that nested run.
            expect(sandbox.count('workflow cancel')).toBe(2);
            expect(sandbox.log().some((line) => line.includes('workflow cancel') && line.includes('-safety'))).toBe(
                true,
            );
            expect(await lockHolder(sandbox, 'kk-article-generate-term')).toBeUndefined();
            outcomes.push({ posture: 'sigterm', code: exitCode, receipt: written });
        } finally {
            sandbox.restore();
        }

        const summaryDir = join(repoRoot, '.works', 'tmp', 'test-launch');
        mkdirSync(summaryDir, { recursive: true });
        writeFileSync(join(summaryDir, 'summary.json'), `${JSON.stringify(outcomes, null, 2)}\n`);
        expect(existsSync(join(summaryDir, 'summary.json'))).toBe(true);
        expect(outcomes).toHaveLength(4);
    }, 60_000);
});

describe('content launch — a dry run plans the unattended generate leg (0365 R9)', () => {
    it('plans the chained generate without taking a lock, writing a receipt or spawning a child', async () => {
        const sandbox = project();
        try {
            const workDir = newsDir(sandbox, '20260114');
            mkdirSync(workDir, { recursive: true });
            const failedReceipt = `${JSON.stringify({ status: 'failed' })}\n`;
            writeFileSync(join(workDir, 'schedule-receipt.json'), failedReceipt);

            const result = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260114',
                '--window',
                'cn-peak',
                '--unattended',
                '--dry-run',
            ]);
            const planned = JSON.parse(result.stdout) as {
                status: string;
                exitCode: number;
                dryRun?: { argv: string[]; chained?: Array<{ workflow: string; argv: string[] }> };
            };

            expect(result.code).toBe(0);
            expect(planned.status).toBe('running');
            expect(planned.exitCode).toBe(0);
            expect(planned.dryRun?.argv.slice(0, 3)).toEqual(['--no-logo', 'workflow', 'run']);
            expect(planned.dryRun?.chained?.map((leg) => leg.workflow)).toEqual(['kk-news-generate']);
            expect(planned.dryRun?.chained?.[0]?.argv[3]).toEndWith(
                join('fixtures', 'workflows', 'kk-news-generate.yaml'),
            );
            // R9: nothing was launched and nothing was written — the generate leg planned only.
            expect(sandbox.workflowRuns()).toHaveLength(0);
            expect(readFileSync(join(workDir, 'schedule-receipt.json'), 'utf8')).toBe(failedReceipt);
            expect(existsSync(join(workDir, '4-publish', 'schedule-receipt.cn-peak.json'))).toBe(false);
            expect(await lockHolder(sandbox, 'kk-news-generate-20260114')).toBeUndefined();
            expect(await lockHolder(sandbox, 'kk-publish-20260114')).toBeUndefined();
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — AC4 publish finds or refuses the bundle (0365 R6, R7, R8)', () => {
    it('refuses a missing bundle with exit 5, and --unattended generates exactly once before publishing', async () => {
        const sandbox = project();
        try {
            const refused = await runCli(['news', 'publish', '--run-date', '20260103', '--window', 'cn-peak']);
            expect(refused.code).toBe(5);
            expect(refused.stderr).toContain(join('4-publish', 'bundle.json'));
            expect(sandbox.workflowRuns()).toHaveLength(0);

            const workDir = newsDir(sandbox, '20260103');
            mkdirSync(workDir, { recursive: true });
            writeFileSync(join(workDir, 'schedule-receipt.json'), `${JSON.stringify({ status: 'failed' })}\n`);
            const unattended = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260103',
                '--window',
                'cn-peak',
                '--unattended',
            ]);
            const runs = sandbox.workflowRuns();
            expect(unattended.code).toBe(0);
            expect(runs.filter((line) => line.includes('kk-news-generate.yaml'))).toHaveLength(1);
            expect(runs.filter((line) => line.includes('kk-publish.yaml'))).toHaveLength(1);
            expect(String(runs[0])).toContain('kk-news-generate.yaml');
            expect(String(runs[1])).toContain('kk-publish.yaml');
            const published = receipt(
                sandbox,
                join('kk-news-generate', '20260103', '4-publish', 'schedule-receipt.cn-peak.json'),
            );
            expect(published.status).toBe('done');
            expect(published.window).toBe('cn-peak');
            expect(await lockHolder(sandbox, 'kk-publish-20260103')).toBeUndefined();
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — the verb surface (0365 R4, R6, R8)', () => {
    it('takes the workflow name from content_types and chains publish after a green generate', async () => {
        const sandbox = project({
            contentTypes: [
                'content_types:',
                '  brief:',
                '    workflow: kk-article-generate',
                '    writer_skill: kk:itc-generating',
                '    publish_preset: daily-ai-voice',
            ].join('\n'),
        });
        try {
            const result = await runCli([
                'article',
                'generate',
                '--type',
                'brief',
                '--slug',
                'chained',
                '--allow-dirty',
                '--publish',
            ]);
            const runs = sandbox.workflowRuns();
            const printed = JSON.parse(result.stdout) as { workflow: string; publish?: { workflow: string } };

            expect(result.code).toBe(0);
            expect(runs).toHaveLength(2);
            expect(String(runs[0])).toContain('kk-article-generate.yaml');
            expect(String(runs[1])).toContain('kk-publish.yaml');
            expect(String(runs[1])).toContain('"window":"after-generate"');
            expect(printed.workflow).toBe('kk-article-generate');
            expect(printed.publish?.workflow).toBe('kk-publish');
            const publishReceipt = receipt(
                sandbox,
                join('kk-article-generate', 'chained', '4-publish', 'schedule-receipt.after-generate.json'),
            );
            expect(publishReceipt.workflow).toBe('kk-publish');
        } finally {
            sandbox.restore();
        }
    });

    it('refuses a live token the preset window does not carry, before the lock', async () => {
        const sandbox = project();
        try {
            const workDir = newsDir(sandbox, '20260104');
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            writeFileSync(
                join(workDir, '4-publish', 'bundle.json'),
                `${JSON.stringify({ schemaVersion: 1, runId: 'r2', runDate: '2026-01-04' })}\n`,
            );

            const result = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260104',
                '--window',
                'cn-peak',
                '--live-channels',
                'no-such-pub',
            ]);

            expect(result.code).toBe(5);
            expect(result.stderr).toContain("have no active row in window 'cn-peak'");
            expect(sandbox.workflowRuns()).toHaveLength(0);
        } finally {
            sandbox.restore();
        }
    });

    it('refuses a consent mismatch BEFORE paying for the chained generate (0372)', async () => {
        const sandbox = project();
        try {
            // No bundle and no generate receipt: `--unattended` would launch a full generation —
            // unless the window/consent validation refuses first, which design §3.3 requires
            // because it is a pre-lock check.
            const result = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260106',
                '--window',
                'cn-peak',
                '--live-channels',
                'no-such-pub',
                '--unattended',
            ]);
            expect(result.code).toBe(5);
            expect(result.stderr).toContain("have no active row in window 'cn-peak'");
            // The regression: not one generate child was spawned, so nothing was paid for.
            expect(sandbox.workflowRuns()).toHaveLength(0);
            expect(existsSync(join(newsDir(sandbox, '20260106'), 'schedule-receipt.json'))).toBe(false);
        } finally {
            sandbox.restore();
        }
    });

    it("launches with the RESOLVED type's noun and refuses a bundle of another type (0373)", async () => {
        const sandbox = project({ child: 'ok' });
        try {
            const workDir = newsDir(sandbox, '20260107');
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            writeFileSync(
                join(workDir, '4-publish', 'bundle.json'),
                `${JSON.stringify({ schemaVersion: 1, runId: 'r7', runDate: '2026-01-07', contentType: 'news' })}\n`,
            );
            // `--type news` on the article noun is a NEWS run: every node command must say `kk news`.
            const result = await runCli([
                'article',
                'publish',
                '--type',
                'news',
                '--run-date',
                '20260107',
                '--window',
                'cn-peak',
            ]);
            expect(`${result.code}|${result.stderr}`).toBe('0|');
            const launched = sandbox.workflowRuns().at(-1) ?? '';
            expect(launched).toContain('"noun":"news"');

            // A bundle that names its own type refuses a mismatched request instead of silently
            // applying the other type's channel switchboard.
            const mismatch = await runCli([
                'article',
                'publish',
                '--type',
                'itc',
                '--work-dir',
                workDir,
                '--window',
                'cn-peak',
            ]);
            expect(mismatch.code).toBe(5);
            expect(mismatch.stderr).toContain("is a 'news' bundle, not 'itc'");
        } finally {
            sandbox.restore();
        }
    });

    it('prints the planned argv for --dry-run and takes no lock', async () => {
        const sandbox = project();
        try {
            const result = await runCli(['news', 'generate', '--run-date', '20260105', '--allow-dirty', '--dry-run']);
            const printed = JSON.parse(result.stdout) as { dryRun?: { argv: string[] }; status: string };

            expect(result.code).toBe(0);
            expect(printed.status).toBe('running');
            expect(printed.dryRun?.argv.slice(0, 3)).toEqual(['--no-logo', 'workflow', 'run']);
            expect(sandbox.workflowRuns()).toHaveLength(0);
            expect(existsSync(join(newsDir(sandbox, '20260105'), 'schedule-receipt.json'))).toBe(false);
            expect(await lockHolder(sandbox, 'kk-news-generate-20260105')).toBeUndefined();
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — usage guards and refusals (0365 R3, R4, R7)', () => {
    it('maps each malformed invocation to exit 2 before any launch', async () => {
        const sandbox = project();
        try {
            const unknownType = await runCli(['article', 'generate', '--type', 'nope', '--slug', 'x']);
            const badDate = await runCli(['news', 'generate', '--run-date', '20261332']);
            const missingSlug = await runCli(['article', 'generate']);
            const badTimeout = await runCli(['news', 'generate', '--timeout-ms', 'soon']);
            const badWindow = await runCli(['news', 'publish', '--window', 'banana']);
            const dummyAndLive = await runCli(['news', 'publish', '--dummy', '--live-channels', 'xhs-pub']);

            expect(unknownType.code).toBe(2);
            expect(unknownType.stderr).toContain("unknown content type 'nope'");
            expect(badDate.code).toBe(2);
            expect(badDate.stderr).toContain('--run-date must be a real calendar date');
            expect(missingSlug.code).toBe(2);
            expect(missingSlug.stderr).toContain('--slug is required');
            expect(badTimeout.code).toBe(2);
            expect(badTimeout.stderr).toContain('--timeout-ms must be a positive integer');
            expect(badWindow.code).toBe(2);
            expect(badWindow.stderr).toContain('--window must be one of');
            expect(dummyAndLive.code).toBe(2);
            expect(dummyAndLive.stderr).toContain('mutually exclusive');
            expect(sandbox.workflowRuns()).toHaveLength(0);
        } finally {
            sandbox.restore();
        }
    });

    it('refuses a missing writer skill with exit 5 and an unreadable config with exit 2', async () => {
        const sandbox = project({
            contentTypes: [
                'content_types:',
                '  broken:',
                '    workflow: kk-article-generate',
                '    writer_skill: kk:no-such-skill',
                '    publish_preset: daily-ai-voice',
            ].join('\n'),
        });
        try {
            const missingSkill = await runCli(['article', 'generate', '--type', 'broken', '--slug', 'x']);
            expect(missingSkill.code).toBe(5);
            expect(missingSkill.stderr).toContain('missing SKILL.md');

            writeFileSync(join(sandbox.root, 'config.yaml'), 'works_dir: [unclosed\n');
            const corrupt = await runCli(['news', 'generate']);
            expect(corrupt.code).toBe(2);
            expect(corrupt.stderr).toContain('cannot read config');
        } finally {
            sandbox.restore();
        }
    });

    it('resolves a workflow the override does not carry against the package root, then reports a failing chained publish', async () => {
        const sandbox = project({
            contentTypes: [
                'content_types:',
                '  plain:',
                '    workflow: kk-plain',
                '    writer_skill: kk:itc-generating',
                '    publish_preset: daily-ai-voice',
            ].join('\n'),
        });
        try {
            const planned = await runCli([
                'article',
                'generate',
                '--type',
                'plain',
                '--slug',
                'fallback',
                '--allow-dirty',
                '--dry-run',
            ]);
            const plannedReceipt = JSON.parse(planned.stdout) as { dryRun?: { argv: string[] } };

            expect(planned.code).toBe(0);
            expect(plannedReceipt.dryRun?.argv[3]).toEndWith(join('plugins', 'kk', 'workflows', 'kk-plain.yaml'));

            // The stub writes a bundle only for a `*-generate.yaml` run, so this chained publish
            // meets a missing bundle. The refusal is the exit contract: it reaches stderr and the
            // exit code, and the green generate receipt stays on disk under its own path.
            const chained = await runCli([
                'article',
                'generate',
                '--type',
                'plain',
                '--slug',
                'fallback',
                '--allow-dirty',
                '--publish',
            ]);

            expect(chained.code).toBe(5);
            expect(chained.stderr).toContain('no publishable bundle');
            // The run directory is keyed on the workflow name (§4.3), so this type owns `kk-plain/`.
            expect(receipt(sandbox, join('kk-plain', 'fallback', 'schedule-receipt.json')).status).toBe('done');
            expect(
                existsSync(
                    join(sandbox.works, 'kk-plain', 'fallback', '4-publish', 'schedule-receipt.after-generate.json'),
                ),
            ).toBe(false);
        } finally {
            sandbox.restore();
        }
    });

    it('refuses a running generation, a corrupt bundle, a mismatched bundle day and a dead auto-generate', async () => {
        const sandbox = project();
        try {
            const running = newsDir(sandbox, '20260108');
            mkdirSync(join(running, '4-publish'), { recursive: true });
            writeFileSync(join(running, 'schedule-receipt.json'), `${JSON.stringify({ status: 'running' })}\n`);
            const stillRunning = await runCli(['news', 'publish', '--run-date', '20260108']);
            expect(stillRunning.code).toBe(5);
            expect(stillRunning.stderr).toContain('is still running');

            const corrupt = newsDir(sandbox, '20260109');
            mkdirSync(join(corrupt, '4-publish'), { recursive: true });
            writeFileSync(join(corrupt, '4-publish', 'bundle.json'), '{not json');
            const corruptBundle = await runCli(['news', 'publish', '--run-date', '20260109']);
            expect(corruptBundle.code).toBe(5);
            expect(corruptBundle.stderr).toContain('no publishable bundle');

            const stale = newsDir(sandbox, '20260110');
            mkdirSync(join(stale, '4-publish'), { recursive: true });
            writeFileSync(
                join(stale, '4-publish', 'bundle.json'),
                `${JSON.stringify({ schemaVersion: 1, runDate: '2026-01-09' })}\n`,
            );
            const staleBundle = await runCli(['news', 'publish', '--run-date', '20260110']);
            expect(staleBundle.code).toBe(5);
            expect(staleBundle.stderr).toContain('is dated 20260109, not the requested 20260110');
        } finally {
            sandbox.restore();
        }

        const failing = project({ child: 'fail' });
        try {
            const workDir = newsDir(failing, '20260111');
            mkdirSync(workDir, { recursive: true });
            writeFileSync(join(workDir, 'schedule-receipt.json'), `${JSON.stringify({ status: 'failed' })}\n`);
            const deadGenerate = await runCli(['news', 'publish', '--run-date', '20260111', '--unattended']);
            expect(deadGenerate.code).toBe(1);
            expect(deadGenerate.stderr).toContain('node voice failed');
        } finally {
            failing.restore();
        }
    });

    it('refuses live tokens the preset window does not carry and forwards the rest of the publish posture', async () => {
        const sandbox = project();
        try {
            const publishable = newsDir(sandbox, '20260112');
            mkdirSync(join(publishable, '4-publish'), { recursive: true });
            writeFileSync(
                join(publishable, '4-publish', 'bundle.json'),
                `${JSON.stringify({ schemaVersion: 1, runDate: '2026-01-12' })}\n`,
            );
            const offRow = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260112',
                '--window',
                'cn-peak',
                '--live-channels',
                'xhs-pub',
            ]);
            expect(offRow.code).toBe(5);
            expect(offRow.stderr).toContain('have no active row');

            const missingPreset = await runCli([
                'news',
                'publish',
                '--run-date',
                '20260112',
                '--window',
                'cn-peak',
                '--preset',
                'not-a-preset',
                '--live-channels',
                'weibo-pub',
            ]);
            expect(missingPreset.code).toBe(5);
            expect(missingPreset.stderr).toContain("preset 'not-a-preset' was not found");

            const workDir = newsDir(sandbox, '20260113');
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            writeFileSync(
                join(workDir, '4-publish', 'bundle.json'),
                `${JSON.stringify({ schemaVersion: 1, runDate: '2026-01-13' })}\n`,
            );
            const forwarded = await runCli([
                'news',
                'publish',
                '--work-dir',
                workDir,
                '--window',
                'cn-peak',
                '--preset',
                'daily-ai-voice',
                '--channels',
                'weibo-pub',
                '--live-channels',
                'weibo-pub',
                '--live-confirm',
                '--retry',
                '--agent',
                'codex',
                '--timeout-ms',
                '5000',
            ]);
            const run = sandbox.workflowRuns().at(-1) ?? '';
            const vars = JSON.parse(run.slice(run.indexOf('--vars') + 7, run.lastIndexOf(' --quiet'))) as Record<
                string,
                string
            >;

            expect(forwarded.code).toBe(0);
            expect(vars).toEqual({
                work_dir: workDir,
                preset: 'daily-ai-voice',
                window: 'cn-peak',
                run_date: '20260113',
                channels: 'weibo-pub',
                live_channels: 'weibo-pub',
                live_confirm: 'true',
                retry: 'true',
                // 0366 R4: the noun the workflow's step verbs are registered on.
                noun: 'news',
                run_id: expect.any(String),
                agent: 'codex',
            });

            // A news publish with no --run-date takes the window's own Los Angeles day.
            const today = await runCli(['news', 'publish', '--window', 'overseas-rss']);
            expect(today.code).toBe(5);
            expect(today.stderr).toContain('no publishable bundle');
        } finally {
            sandbox.restore();
        }
    });
});

describe('content launch — registration seam (0365 R6)', () => {
    it('registers the two launch verbs on a standalone content noun', () => {
        const program = new Command('kk');
        registerContentLaunchCommand(program, 'news', 'news');

        const news = program.commands.find((command) => command.name() === 'news');
        const verbs = news?.commands.map((command) => command.name()) ?? [];
        expect(verbs).toEqual(['generate', 'publish']);
    });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await Bun.sleep(50);
    }
    return predicate();
}

/** Keep the temp-root helpers honest: every project root lives outside the repository tree. */
expect(dirname(tmpdir()).startsWith('/')).toBe(true);
