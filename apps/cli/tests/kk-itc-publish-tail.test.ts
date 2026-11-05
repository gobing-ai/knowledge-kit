import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const TAIL = join(REPO, 'plugins/kk/workflows/kk-itc-publish-tail.yaml');

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
                // 0247 R3: a temp cwd keeps the run row in the walk's own .spur/spur.db, not the repo's.
                cwd: workDir,
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
        expect(summary.finalState === 'done' || summary.finalState === 'dag').toBe(true);
        expect(existsSync(join(workDir, '.spur/spur.db'))).toBe(true); // 0247 R3: the row lives in the temp workspace
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});

/**
 * Task 0310 (G21 R1-R6) — the re-entry seam for a failed publish. `plugins/kk/workflows/
 * kk-itc-publish-tail.yaml` is the whole public surface: a second DAG holding only the seven
 * post-authoring nodes, so a failed tail can be re-entered without re-running authoring and
 * without any way to skip `send-confirm`. The definition tests below are the drift net for the
 * duplicated node bodies; the walk is the one-command re-entry.
 */
interface DagNode {
    id: string;
    description?: string;
    dependsOn?: string[];
    pause?: boolean;
    action?: unknown;
    condition?: unknown;
}

const nodesOf = (file: string): DagNode[] =>
    (Bun.YAML.parse(readFileSync(file, 'utf-8')) as { nodes: DagNode[] }).nodes;

const TAIL_NODES = [
    'check-targets',
    'send-confirm',
    'fanout-send',
    'fanout-recovery',
    'reconcile-settle',
    'seo',
    'report',
];
/** Authoring and plan-materializing nodes: absent so no invocation of the tail can reach them. */
const AUTHORING_NODES = [
    'prepare',
    'child-author',
    'verify-child-freeze',
    'illustrate',
    'materialize-plan',
    'adapt',
    'adapt-verify',
];

describe('kk-itc publish tail definition (0310 R1-R3)', () => {
    it('R1 — declares exactly the seven post-authoring nodes and no authoring node', () => {
        const parsed = Bun.YAML.parse(readFileSync(TAIL, 'utf-8')) as {
            name: string;
            kind: string;
            version: string;
            nodes: DagNode[];
        };
        expect(parsed.name).toBe('kk-itc-publish-tail');
        expect(parsed.kind).toBe('dag');
        expect(parsed.version).toBe('2');

        const ids = parsed.nodes.map((n) => n.id);
        expect(ids.sort()).toEqual([...TAIL_NODES].sort());
        for (const id of AUTHORING_NODES) expect(ids).not.toContain(id);
        // Run identity is frozen in itc-options.json; a fresh tail run id must never leak into a node.
        // Runtime-assembled so lint's noTemplateCurlyInString stays quiet (same dodge as varRef).
        expect(readFileSync(TAIL, 'utf-8')).not.toContain(['$' + '{vars.', 'runId}'].join('__'));
    });

    it('R1/R4 — passes spur workflow validate', () => {
        const res = Bun.spawnSync(['spur', 'workflow', 'validate', TAIL], { stdout: 'pipe', stderr: 'pipe' });
        expect(res.exitCode, res.stderr.toString()).toBe(0);
    });

    it('R3 — every shared node is byte-identical to kk-itc.yaml, naming the drifted node', () => {
        const main = new Map(nodesOf(WORKFLOW).map((n) => [n.id, n]));
        for (const node of nodesOf(TAIL)) {
            const source = main.get(node.id);
            expect(source, `${node.id}: no such node in kk-itc.yaml`).toBeDefined();
            expect({ node: node.id, action: node.action, condition: node.condition, pause: node.pause }).toEqual({
                node: node.id,
                action: source?.action,
                condition: source?.condition,
                pause: source?.pause,
            });
        }
    });

    it('R2 — keeps the judge confidence gate upstream: the tail invokes no verdict producer', () => {
        const raw = readFileSync(TAIL, 'utf-8');
        // The HIGH/MEDIUM/LOW enum is enforced where the verdict is written (`itc-author-verdict` /
        // `itc-author-complete`, covered by itc-stages and verdict-confidence tests). A re-entered
        // publish must not re-derive or launder a verdict, so neither stage is reachable from the tail
        // and no node guard reads a verdict (the shared consumer scan now covers DAG conditions too).
        expect(raw).not.toContain('itc-author-verdict');
        expect(raw).not.toContain('itc-author-complete');
        for (const node of nodesOf(TAIL)) expect(JSON.stringify(node.condition ?? '')).not.toMatch(/verdict/i);
    });

    it('R2 — the send approval still sits between the probes and the fan-out, draft plans included', () => {
        const nodes = nodesOf(TAIL);
        const byId = new Map(nodes.map((n) => [n.id, n]));
        expect(byId.get('send-confirm')?.pause).toBe(true);
        // Targets-count guard (the same bytes kk-itc.yaml carries, per the drift test above):
        // draft plans create real remote drafts too, so they pause; plan_only runs stop earlier.
        const guard = (byId.get('send-confirm')?.condition as { options?: { command?: string } } | undefined)?.options
            ?.command;
        expect(guard).toContain('(.targets // []) | length) > 0');
        expect(guard).toContain(['test "$' + '{vars.plan_only}" != "true"'].join(''));
        expect(guard).toContain('publish-plan.json');
        // The only way into fanout-send: a re-entered tail cannot reach a send without the pause.
        const senders = nodes.filter((n) => (n.dependsOn ?? []).includes('fanout-send')).map((n) => n.id);
        expect(senders).toEqual(['fanout-recovery']);
        expect(byId.get('fanout-send')?.dependsOn).toEqual(['send-confirm']);
        expect(byId.get('report')?.dependsOn).toEqual(['reconcile-settle', 'seo']);
    });
});

describe('kk-itc publish tail re-entry (0310 R4, R5)', () => {
    const FAILED_RUN = 'kk-itc-failed-0310';

    /** The work dir a failed publish left behind: frozen snapshot, plan and draft, one target. */
    function seedFailedWorkDir(): string {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-itc-tail-reentry-'));
        mkdirSync(join(workDir, '4-publish'), { recursive: true });
        writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Re-entry\n\nBody of the re-entered draft.\n');
        writeFileSync(
            join(workDir, 'itc-options.json'),
            JSON.stringify({ parentRunId: FAILED_RUN, seo: 'prepublish', maxRevisions: 2 }),
        );
        writeFileSync(
            join(workDir, '4-publish/publish-plan.json'),
            JSON.stringify({
                schemaVersion: 1,
                parentRunId: FAILED_RUN,
                live: false,
                targets: [
                    {
                        plugin: 'zenn-pub',
                        profile: 'article',
                        mode: 'draft',
                        variant: 'en-article',
                        payloadPath: '4-publish/content.json',
                    },
                ],
            }),
        );
        return workDir;
    }

    /** One re-entry dry-run against a work dir; returns the parsed summary plus exit code. */
    function reentry(workDir: string, vars: Record<string, string>) {
        const env = { ...process.env, SPUR_WORKFLOW_RUN_ACTIVE: undefined, SPUR_EXPECTED_DEFINITION_DIGEST: undefined };
        const result = Bun.spawnSync(
            [
                'spur',
                'workflow',
                'run',
                TAIL,
                '--dry-run',
                '--no-log',
                '--json',
                '--vars',
                JSON.stringify({ work_dir: workDir, ...vars }),
            ],
            // A temp cwd keeps the run row out of the repo's .spur/spur.db (0247 R3).
            { cwd: workDir, env, stdout: 'pipe', stderr: 'pipe' },
        );
        return {
            exitCode: result.exitCode,
            stdout: result.stdout.toString(),
            stderr: result.stderr.toString(),
            summary: JSON.parse(result.stdout.toString()) as {
                status: string;
                workflowName: string;
                finalState?: string;
            },
            traceNames: (): string[] => {
                const trace = Bun.spawnSync(['spur', 'workflow', 'trace', '--json'], {
                    cwd: workDir,
                    env,
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                const entries = (JSON.parse(trace.stdout.toString()) as { entries: { workflowName: string }[] })
                    .entries;
                return entries.map((e) => e.workflowName);
            },
        };
    }

    it('R4 (item 5) — a re-entry with a draft plan now pauses at send-confirm: draft saves are real remote effects', () => {
        const workDir = seedFailedWorkDir();
        const run = reentry(workDir, {});
        expect(run.summary, `${run.stdout}\n${run.stderr}`).toMatchObject({
            status: 'paused',
            workflowName: 'kk-itc-publish-tail',
            finalState: 'send-confirm',
        });
        // A fresh run of the tail itself: not the failed run, not the author DAG.
        expect(run.traceNames()).toEqual(['kk-itc-publish-tail']);
        // The freeze belongs to the failed run and stays untouched by the re-entry.
        expect(JSON.parse(readFileSync(join(workDir, 'itc-options.json'), 'utf-8')).parentRunId).toBe(FAILED_RUN);
    }, 30_000);

    it('R4 (item 4) — a plan_only re-entry stops after check-targets without pausing or sending', () => {
        const workDir = seedFailedWorkDir();
        const run = reentry(workDir, { plan_only: 'true' });
        expect(run.exitCode, `${run.stdout}\n${run.stderr}`).toBe(0);
        expect(run.summary).toMatchObject({ status: 'done', workflowName: 'kk-itc-publish-tail' });
        expect(run.traceNames()).toEqual(['kk-itc-publish-tail']);
        // The freeze belongs to the failed run and stays untouched by the re-entry.
        expect(JSON.parse(readFileSync(join(workDir, 'itc-options.json'), 'utf-8')).parentRunId).toBe(FAILED_RUN);
    }, 30_000);
});
