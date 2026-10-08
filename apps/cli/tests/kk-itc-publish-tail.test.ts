import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema } from '@gobing-ai/kk-core';

/**
 * Task 0151 (F41) — the publish tail integration (R6/AC7). The real stage runner
 * (kk-workflow-stages.ts) drives materialize -> publish-plan -> publish-fanout with the real
 * `kk executor fan-out` on KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake for zenn-pub, qiita-pub and
 * surfdash-pub, then itc-report summarizes the per-target outcomes. The `kk` on PATH is a shim
 * into this checkout's CLI (apps/cli/src/index.ts), so the fan-out and plugin discovery resolve
 * to the working tree. A `spur workflow run --dry-run` walk with auto=true AND targets set must
 * reach done. Task-local check: the fake transport never performs a real network publish.
 */
const REPO = join(import.meta.dir, '../../..');
const STAGES = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');
const CLI = join(REPO, 'apps/cli/src/index.ts');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-itc.yaml');

interface RunResult {
    status: number;
    stdout: string;
    stderr: string;
}

/** Spawn one stage through the real shared runner, exactly as `kk stage <stage>` would. */
function stage(args: string[]): RunResult {
    // env must be passed explicitly: Bun's spawn uses the startup environ otherwise, so the
    // PATH shim and KNOWLEDGE_KIT_PUBLISH_TRANSPORT below would never reach the children.
    const res = Bun.spawnSync([process.execPath, STAGES, ...args], {
        cwd: REPO,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { status: res.exitCode ?? 1, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}

/** A `kk` shim on PATH that runs this checkout's CLI (source entry, no dist build needed). */
function withKkShim(fn: () => void): void {
    const binDir = mkdtempSync(join(tmpdir(), 'kk-itc-tail-bin-'));
    writeFileSync(join(binDir, 'kk'), `#!/bin/bash\nexec ${process.execPath} ${CLI} "$@"\n`);
    chmodSync(join(binDir, 'kk'), 0o755);
    const origPath = process.env.PATH;
    process.env.PATH = `${binDir}:${origPath ?? ''}`;
    try {
        fn();
    } finally {
        if (origPath === undefined) delete process.env.PATH;
        else process.env.PATH = origPath;
        rmSync(binDir, { recursive: true, force: true });
    }
}

function seedWorkDir(): string {
    const workDir = mkdtempSync(join(tmpdir(), 'kk-itc-tail-'));
    writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Tail Smoke\n\nBody of the smoke draft.\n');
    return workDir;
}

describe('kk-itc publish tail (0151)', () => {
    it('R6/AC7 — the tail stages reach draft ok results for zenn-pub, qiita-pub and surfdash-pub on the fake transport', () => {
        withKkShim(() => {
            const origTransport = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
            try {
                const workDir = seedWorkDir();
                const mat = stage(['itc-materialize', workDir, 'false']);
                expect(mat.status, mat.stderr).toBe(0);
                expect(existsSync(join(workDir, '4-publish/content.json'))).toBe(true);

                // The adapt state is an agent.run step (not executed in CI): seed its output for
                // the ja variant the zenn/qiita group plans, exactly what kk:article-adapt writes.
                const seeded = {
                    title: 'Tail Smoke',
                    format: 'article',
                    body: 'ja body',
                    metadata: {},
                    references: [],
                };
                expect(ContentSchema.safeParse(seeded).success).toBe(true); // R4: the variant is a valid Content
                writeFileSync(join(workDir, '4-publish/content.ja-article.json'), JSON.stringify(seeded));
                const plan = stage(['itc-publish-plan', workDir, 'zenn-pub,qiita-pub,surfdash-pub', 'en', 'false']);
                expect(plan.status, plan.stderr).toBe(0);

                const fan = stage(['itc-publish-fanout', workDir]);
                expect(fan.status, fan.stderr).toBe(0);
                const ja = JSON.parse(readFileSync(join(workDir, '4-publish/fanout-result.ja-article.json'), 'utf-8'));
                expect(ja.targets.map((t: { target: string }) => t.target)).toEqual(['zenn-pub', 'qiita-pub']);
                const en = JSON.parse(readFileSync(join(workDir, '4-publish/fanout-result.en-article.json'), 'utf-8'));
                expect(en.targets.map((t: { target: string }) => t.target)).toEqual(['surfdash-pub']);
                for (const t of [...ja.targets, ...en.targets] as Array<{ ok: unknown; url: unknown }>) {
                    expect(t.ok).toBe(true); // draft-mode ok Result per target on the fake transport
                    expect(typeof t.url).toBe('string');
                }
                // V3: the draft switch is stamped into each variant's metadata at send time.
                const src = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8'));
                expect(src.metadata.published).toBe(false);
                const adapted = JSON.parse(readFileSync(join(workDir, '4-publish/content.ja-article.json'), 'utf-8'));
                expect(adapted.metadata.published).toBe(false);
                expect(ContentSchema.safeParse(adapted).success).toBe(true); // R4: stamped variant parses
                expect(readFileSync(join(workDir, '4-publish/.fanout-failed'), 'utf-8')).toBe('');

                const rep = stage(['itc-report', workDir]);
                expect(rep.status, rep.stderr).toBe(0);
                const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
                expect(report.outcome).toBe('done');
                expect(report.publish.targets).toHaveLength(3);
                for (const t of report.publish.targets as Array<{ target: string; ok: unknown }>) {
                    expect(t.ok).toBe(true);
                }
                expect(report.publish.targets.map((t: { target: string }) => t.target).sort()).toEqual([
                    'qiita-pub',
                    'surfdash-pub',
                    'zenn-pub',
                ]);
                expect(report.publish.retryCommands).toEqual([]);
            } finally {
                if (origTransport === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
                else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = origTransport;
            }
        });
    });

    it("finding 3 (0152) — the adapt state's verify step rejects an unadapted variant by name, not fanout mid-tail", () => {
        const workDir = seedWorkDir();
        expect(stage(['itc-materialize', workDir, 'false']).status).toBe(0);
        // No content.ja-article.json (the agent.run adapt step is not executed here): publish-plan
        // now writes the plan (adapt runs after it, R3) and the follow-up verify fails, by name.
        expect(stage(['itc-publish-plan', workDir, 'zenn-pub,qiita-pub', 'en', 'false']).status).toBe(0);
        expect(existsSync(join(workDir, '4-publish/publish-plan.json'))).toBe(true);
        const res = stage(['itc-adapt-verify', workDir]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('ja-article');
        expect(res.stderr).toContain('content.ja-article.json');
        expect(res.stderr).toContain('title/body');
    });

    it('R6/AC7 — a spur workflow run --dry-run walk with auto=true and targets set reaches done', () => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-itc-tail-walk-'));
        const result = Bun.spawnSync(
            [
                'spur',
                'workflow',
                'run',
                WORKFLOW,
                '--run-id',
                `kk-itc-tail-${Date.now()}`,
                '--dry-run',
                '--no-log',
                '--json',
                '--vars',
                JSON.stringify({
                    work_dir: workDir,
                    auto: 'true',
                    judge: 'true',
                    unslop: 'true',
                    publish_targets: 'zenn-pub,qiita-pub,surfdash-pub',
                }),
            ],
            {
                cwd: REPO,
                // The test may run inside a pipeline step — never leak the guard into the child.
                env: {
                    ...process.env,
                    SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                    SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
        const summary = JSON.parse(result.stdout.toString());
        expect(summary.status).toBe('done');
        expect(summary.finalState).toBe('done');
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});
