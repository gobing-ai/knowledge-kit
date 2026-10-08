/**
 * Task 0211 — `kk-daily-ai-voice2` (kind: dag) + its nested safety state machine.
 *
 * Failure-first list (written before the code):
 * 1. the store pool is empty → the content and publish subtrees must all be skipped, and the run
 *    must still end `done` with `run-report` and `ledger` executed (they list `extract` in
 *    `dependsOn`) and `run-report.summary.txt` reading `no-content`;
 * 2. content QC admits zero of the pooled items → same no-content ending (not an empty episode);
 * 3. two independent branches of one wave must actually run concurrently (wall clock ≈ the slowest
 *    branch, not the sum) and a fan-in node must still see every leaf's outcome;
 * 4. `publish_enabled=false` → the whole publish subtree is skipped, including the fan-in;
 * 5. a nested `spur workflow run` from a shell node is refused while the launcher vars are set —
 *    the `safety` node must strip them (the same two vars the stage runner's `NESTED_SPUR_UNSET`
 *    strips) or the whole daily run fails at the content-safety gate;
 * 6. a judge verdict whose PASS carries a missing/out-of-enum confidence must be refused by the
 *    safety sub-workflow's accept guard, name the offending value, and never deadlock the loop
 *    (the unconditional `judge -> block` still takes the transition);
 * 7. a node that acts twice in one action (a `bun -e`, an inline `jq`, a path-arithmetic chain)
 *    must not exist — one action per node, `kk`/`agent.run`/`file.read.into-var` only;
 * 8. anything that writes vars after the first fan-out (`setVars`) would be last-writer-wins across
 *    concurrent nodes, so the head chain is the only var-projecting part and there is none later;
 * 9. `kk-daily-ai-voice.yaml` must stay byte-identical (the DAG supersedes it without editing it).
 *
 * The DAG runs for real against a PATH `kk` shim that records every call, composes the workspace,
 * and returns fixture pools — plus the real `kk store pool-count` / `kk store extract` conditions and
 * the real `kk daily run-report` no-content path. The traces, the run-report summary and the call log
 * are copied to `.works/test-artifacts/0211/`.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const CLI = join(REPO, 'apps/cli/src/index.ts');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice2.yaml');
const SAFETY = join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml');
const VOICE1 = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice.yaml');
const ARTIFACT_DIR = join(REPO, '.works/test-artifacts/0211');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Copy one artifact of this test run into `.works/test-artifacts/0211/`. */
function saveArtifact(name: string, content: string): void {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, name), content);
}

interface DagNode {
    id: string;
    description?: string;
    dependsOn?: string[];
    dependencyPolicy?: string;
    pause?: boolean;
    condition?: { kind?: string; options?: { command?: string } };
    action?: { kind?: string; options?: Record<string, unknown>; onError?: string };
}

interface DagDefinition {
    name: string;
    kind: string;
    vars?: Record<string, string>;
    nodes: DagNode[];
}

function loadDag(): DagDefinition {
    return Bun.YAML.parse(readFileSync(WORKFLOW, 'utf-8')) as DagDefinition;
}

/** Every node that depends on `nodeId` (the graph is acyclic, so one pass is a full expansion). */
function dependentsOf(workflow: DagDefinition, nodeId: string): string[] {
    return workflow.nodes.filter((node) => (node.dependsOn ?? []).includes(nodeId)).map((node) => node.id);
}

/** The state-machine transitions of a workflow file, with their shell guard command unwrapped. */
function loadTransitions(rel: string): { from: string; to: string; command: string | null }[] {
    const parsed = Bun.YAML.parse(readFileSync(join(REPO, rel), 'utf-8')) as {
        transitions: { from: string; to: string; guard?: { kind?: string; options?: { command?: unknown } } }[];
    };
    return parsed.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        command: t.guard?.kind === 'shell' ? String(t.guard?.options?.command ?? '') : null,
    }));
}

/** The `${vars.*}` names a guard command references (the engine resolves only those from vars). */
function varsRefs(command: string): string[] {
    return [...command.matchAll(/\$\{vars\.([\w.]+)\}/g)].map((m) => m[1] ?? '');
}

/**
 * Run one workflow guard the way the engine does: substitute every `${vars.*}` from the scenario
 * table and run the real command string through bash (exit 0 = transition taken).
 */
function runGuard(
    command: string,
    vars: Record<string, string>,
    cwd: string,
): { matched: boolean; stdout: string; stderr: string } {
    const resolved = command.replace(/\$\{vars\.([\w.]+)\}/g, (_all, name: string) => vars[name] ?? '');
    const result = Bun.spawnSync(['bash', '-c', resolved], { cwd, env: { ...process.env, ...vars } });
    return {
        matched: result.exitCode === 0,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

/**
 * The `kk` PATH shim the workflow's shell nodes execute.
 *
 * It records every call (order + nanosecond stamp → the concurrency and ordering evidence),
 * composes the workspace for `daily prepare` (including the two fixed anchor files the read chain
 * projects), answers `store extract` from a fixture pool, writes the QC candidates file, sleeps for
 * the concurrency probe stages, and delegates the two data-shape-sensitive calls
 * (`store pool-count`, `daily run-report`) to THIS checkout's source entry — so the empty-pool
 * ending is produced by real code, not by the fixture.
 */
function writeKkShim(binDir: string, fixtures: { pool: string; candidates: string; sleepMs: number }): void {
    const script = [
        '#!/bin/bash',
        `LOG="\${KK_STUB_LOG}"`,
        `printf '%s %s\\n' "$(date +%s%N)" "$*" >> "$LOG"`,
        `REAL="${process.execPath} ${CLI}"`,
        `out_arg() { local prev=""; for a in "$@"; do if [ "$prev" = "$1" ]; then echo "$a"; return; fi; prev="$a"; done; }`,
        'case "$1 $2" in',
        '  "daily prepare")',
        `    works="\${KK_STUB_WORKS}"`,
        '    date_arg=""; prev=""',
        '    for a in "$@"; do if [ "$prev" = "--run-date" ]; then date_arg="$(echo "$a" | tr -d "-")"; fi; prev="$a"; done',
        '    [ -n "$date_arg" ] || date_arg="20261007"',
        '    wd="$works/kk-daily-ai-voice2/$date_arg"',
        '    mkdir -p "$wd/10-collect" "$wd/21-plan" "$wd/24-script" "$wd/31-publish" "$wd/30-audio" "$wd/23-cover"',
        '    printf "%s\\n" "$wd" > "$wd/run-date.txt.bak"; rm -f "$wd/run-date.txt.bak"',
        '    printf "%s\\n" "$date_arg" > "$wd/run-date.txt"',
        '    mkdir -p .spur/runs/kk-daily-ai-voice2',
        '    printf "%s\\n" "$wd" > .spur/runs/kk-daily-ai-voice2/work-dir.txt',
        `    printf '%s\\n' '${fixtures.pool}' > "$wd/10-collect/pool.json"`,
        `    printf '%s\\n' '${fixtures.candidates}' > "$wd/21-plan/$date_arg""_04_quality-control-content_candidates.json"`,
        '    echo "{\\"workDir\\":\\"$wd\\"}"',
        '    exit 0 ;;',
        '  "store pool-count")',
        '    exec $REAL "$@" ;;',
        '  "daily run-report")',
        `    if [ "\${KK_STUB_REAL_RUNREPORT}" = "1" ]; then exec $REAL "$@"; fi`,
        '    printf "%s\\n" "$*" > "$(out_arg --work-dir)/stub-run-report.txt"',
        '    exit 0 ;;',
        '  "stage daily-generate"|"stage daily-wrap-docs")',
        `    sleep ${fixtures.sleepMs} ; exit 0 ;;`,
        'esac',
        'exit 0',
    ].join('\n');
    const path = join(binDir, 'kk');
    writeFileSync(path, `${script}\n`);
    chmodSync(path, 0o755);
}

/** Run one command from the shim with `PATH` scoped to it; restores the original PATH. */
function withKkShim<T>(binDir: string, fn: () => T): T {
    const original = process.env.PATH;
    process.env.PATH = `${binDir}:${original ?? ''}`;
    try {
        return fn();
    } finally {
        if (original === undefined) delete process.env.PATH;
        else process.env.PATH = original;
    }
}

interface RunOutcome {
    code: number;
    status: string;
    /** Every recorded `kk` call, timestamp stripped — the dispatch order. */
    log: string[];
    /** The same calls as `<epoch-ns> <command>`, for the concurrency probe. */
    rawLog: string[];
    stderr: string;
    workDir: string;
    runId: string;
}

/**
 * Run the real DAG from `cwd` with the `kk` shim on PATH, then read back the recorded call log.
 * `fixture` decides the pool: an EMPTY pool (the no-content ending) or a pool with items plus a
 * candidate list (the content branches).
 */
function runDag(
    cwd: string,
    options: {
        runId: string;
        pool: string;
        candidates: string;
        sleepMs?: number;
        realRunReport?: boolean;
        vars?: Record<string, string>;
    },
): RunOutcome {
    const binDir = tempDir(`voice2-bin-${options.runId}-`);
    const works = tempDir(`voice2-works-${options.runId}-`);
    const logPath = join(cwd, 'kk-calls.log');
    writeKkShim(binDir, { pool: options.pool, candidates: options.candidates, sleepMs: options.sleepMs ?? 0 });
    const vars = {
        publish_enabled: 'false',
        skip_review: 'true',
        agent: 'inline',
        cover_enabled: 'false',
        xhs_enabled: 'false',
        wechat_enabled: 'false',
        plan_translate_enabled: 'false',
        article_write_enabled: 'false',
        script_write_enabled: 'false',
        run_date: '2026-10-07',
        ...options.vars,
    };
    const result = withKkShim(binDir, () =>
        Bun.spawnSync(
            ['spur', 'workflow', 'run', WORKFLOW, '--run-id', options.runId, '--json', '--vars', JSON.stringify(vars)],
            {
                cwd,
                env: {
                    ...process.env,
                    // A parent spur run (e.g. the feature-verification gate) exports these; inherited,
                    // either one makes this nested run refuse and the status read back is 'unknown'.
                    SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                    SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
                    KK_STUB_LOG: logPath,
                    KK_STUB_WORKS: works,
                    ...(options.realRunReport === true ? { KK_STUB_REAL_RUNREPORT: '1' } : {}),
                },
            },
        ),
    );
    let summary: { status?: string } = {};
    try {
        summary = JSON.parse(result.stdout.toString()) as { status?: string };
    } catch {
        summary = {};
    }
    const rawLog = existsSync(logPath) ? readFileSync(logPath, 'utf-8').trim().split('\n') : [];
    const log = rawLog.map((line) => line.replace(/^\d+ /, ''));
    const outcome: RunOutcome = {
        code: result.exitCode ?? 1,
        status: summary.status ?? 'unknown',
        log,
        rawLog,
        stderr: result.stderr.toString(),
        workDir: join(works, 'kk-daily-ai-voice2', '20261007'),
        runId: options.runId,
    };
    if (outcome.status !== 'done') {
        saveArtifact(`${options.runId}-failed.stdout.txt`, result.stdout.toString());
        saveArtifact(`${options.runId}-failed.stderr.txt`, outcome.stderr);
        saveArtifact(`${options.runId}-calls.log`, outcome.log.join('\n'));
    }
    return outcome;
}

/** Whether any recorded `kk` call is exactly this command prefix. */
function called(outcome: RunOutcome, prefix: string): boolean {
    return outcome.log.some((line) => line.startsWith(prefix));
}

/** Timestamps (ms) of every recorded call whose command starts with `prefix`. */
function callTimes(outcome: RunOutcome, prefix: string): number[] {
    return outcome.rawLog
        .filter((line) => line.replace(/^\d+ /, '').startsWith(prefix))
        .map((line) => Number(line.split(' ')[0]) / 1_000_000);
}

/** One Doc for the fixture pool (the shape `kk store extract --out` writes). */
function doc(id: string): Record<string, unknown> {
    return { id, title: id, body: `${id} body`, metadata: { source: 'fixture' } };
}

const POOL_EMPTY = '[]';
const POOL_FULL = JSON.stringify([doc('a'), doc('b'), doc('c')]);
const CANDIDATES_EMPTY = JSON.stringify({ metadata: { docs: [] } });
const CANDIDATES_FULL = JSON.stringify({ metadata: { docs: [doc('a'), doc('b')] } });

describe('kk-daily-ai-voice2 — the DAG definition (R1–R8)', () => {
    const dag = loadDag();

    it('is a kind: dag workflow whose head chain starts from the store, in single-node waves', () => {
        expect(dag.kind).toBe('dag');
        const order = ['prepare', 'read-work-dir', 'read-run-date', 'extract'];
        for (const [index, id] of order.entries()) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(node, `node ${id} is missing`).toBeDefined();
            if (index > 0) expect(node?.dependsOn).toEqual([String(order[index - 1])]);
        }
        // The head chain has no collect / ingest / label node and projects vars only before the
        // first fan-out (`prepare` → read chain); nothing re-projects them afterwards.
        expect(dag.nodes.map((node) => node.id)).not.toContain('collect');
        expect(dag.nodes.map((node) => node.id)).not.toContain('ingest');
        expect(dag.nodes.map((node) => node.id)).not.toContain('label');
        const readers = dag.nodes.filter((node) => node.action?.kind === 'file.read.into-var').map((node) => node.id);
        expect(readers).toEqual(['read-work-dir', 'read-run-date'] as string[]);
        const extract = dag.nodes.find((node) => node.id === 'extract');
        expect(String(extract?.action?.options?.command)).toContain('kk store extract --topic ai-news');
        expect(String(extract?.action?.options?.command)).toContain('--exclude-used kk-daily-ai-voice2');
    });

    it('gives every node exactly one action, and only kk / agent.run / file.read.into-var (R3)', () => {
        const allowed = new Set(['shell', 'agent.run', 'file.read.into-var']);
        for (const node of dag.nodes) {
            if (node.pause === true && node.action === undefined) continue; // the pause node's action IS the resume
            expect(node.action, `node ${node.id} has no action`).toBeDefined();
            expect(allowed.has(String(node.action?.kind))).toBe(true);
            if (node.action?.kind !== 'shell') continue;
            // One command per node: an env prefix (`OMNIVOICE_SPEED=… kk …`) is still one command.
            const command = String(node.action.options?.command ?? '').replace(/^(?:[A-Z_]+=\S+ )+/, '');
            expect(
                command.startsWith('kk ') || command.startsWith('spur workflow run ') || command.startsWith('env -u '),
            ).toBe(true);
            expect(command).not.toContain('bun -e');
            expect(command).not.toContain('jq ');
            expect(/[;&|]{1,2}\s*$/.test(command.trim())).toBe(false);
        }
    });

    it('guards the fan-out after extract and lists extract in the no-content nodes (R5/AC3)', () => {
        const plan = dag.nodes.find((node) => node.id === 'plan');
        expect(String(plan?.condition?.options?.command)).toContain('kk store pool-count');
        expect(String(plan?.condition?.options?.command)).toContain('--min 1');
        // The pool guard sits on every fan-out root of the content tree: `plan` (the only node whose
        // whole dependency set is the extract chain) and `mark-used` (which also pins `extract`).
        const direct = dag.nodes.filter((node) => (node.dependsOn ?? []).join(',') === 'extract').map((n) => n.id);
        expect(direct).toEqual(['plan']);
        for (const id of ['run-report', 'ledger']) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(node?.dependsOn, `${id} must still run on an empty pool`).toContain('extract');
            expect(node?.condition, `${id} must not be pool-gated`).toBeUndefined();
        }
        // The QC-zero case ends the same way: every content root fanned out of qc-content is gated
        // on the candidates file, whose count the same `kk store pool-count` verb reads.
        const contentRoots = dag.nodes.filter((node) => (node.dependsOn ?? []).includes('qc-content'));
        expect(contentRoots.map((node) => node.id).sort()).toEqual([
            'article',
            'article-write',
            'cover-brief',
            'plan-translate',
            'script-style',
        ]);
        // …and the nodes that settle either way (article/script/wrap-docs/generate) keep the same
        // guard, so a pool that filtered to zero items builds nothing.
        for (const id of ['article', 'script', 'wrap-docs', 'generate']) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(String(node?.condition?.options?.command), id).toContain(
                '_04_quality-control-content_candidates.json',
            );
        }
        for (const root of contentRoots) {
            expect(String(root.condition?.options?.command), root.id).toContain(
                '_04_quality-control-content_candidates.json',
            );
        }
    });

    it('fans in every publish leaf in publish-classify, and skips the publish subtree when disabled (R6)', () => {
        const leaves = ['publish-podcast', 'publish-surfdash', 'xhs-publish', 'wechat-publish', 'translate-sync'];
        const classify = dag.nodes.find((node) => node.id === 'publish-classify');
        expect(classify?.dependsOn?.sort()).toEqual([...leaves].sort());
        expect(classify?.dependencyPolicy).toBe('all');
        expect(String(classify?.condition?.options?.command)).toBe(`test "\${vars.publish_enabled}" = "true"`);
        for (const id of [
            'publish-prep',
            'publish-surfdash',
            'publish-podcast',
            'translate-localize',
            'wechat-publish',
        ]) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(String(node?.condition?.options?.command), `${id} must be publish-gated`).toContain(
                'publish_enabled',
            );
        }
        // The soft channels stay exit-0-on-soft-failure `kk` stages, never agent-owned steps.
        for (const id of ['xhs-publish', 'wechat-publish']) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(node?.action?.kind).toBe('shell');
            expect(String(node?.action?.options?.command)).toContain('kk stage daily-publish-');
        }
    });

    it('orders mark-used after publish-classify and leaves ledger as the final node (R8)', () => {
        const markUsed = dag.nodes.find((node) => node.id === 'mark-used');
        expect(markUsed?.dependsOn).toContain('publish-classify');
        expect(String(markUsed?.action?.options?.command)).toContain(
            'kk store mark-used --workflow kk-daily-ai-voice2',
        );
        expect(dependentsOf(dag, 'ledger')).toEqual([]);
        expect(String(dag.nodes.find((node) => node.id === 'ledger')?.action?.options?.command)).toContain(
            'kk ledger append --workflow kk-daily-ai-voice2',
        );
        // run-report sits between them, so the ledger's Result cell can carry `no-content`.
        expect(dag.nodes.find((node) => node.id === 'ledger')?.dependsOn).toContain('run-report');
    });

    it('runs the safety loop as a nested state machine and the operator review as a pause node (R4)', () => {
        const safety = dag.nodes.find((node) => node.id === 'safety');
        const command = String(safety?.action?.options?.command);
        expect(command).toContain('spur workflow run plugins/kk/workflows/kk-daily-safety.yaml');
        expect(command).toContain('--vars');
        // The nested run is refused while the launcher marker is set: the node must strip it.
        expect(command).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST');
        expect(dag.nodes.find((node) => node.id === 'review')?.pause).toBe(true);
        expect(dag.nodes.find((node) => node.id === 'review')?.dependsOn).toEqual(['safety']);
    });

    it('threads the 0219 xhs_fallback opt-in into the 8-arg daily-xhs-render call', () => {
        const yaml = readFileSync(WORKFLOW, 'utf-8');
        expect(yaml).toContain('xhs_fallback: "true"');
        expect(yaml).toContain(
            `kk stage daily-xhs-render "${'$'}{vars.work_dir}" "${'$'}{vars.run_date}" "${'$'}{vars.plugins_path}" "${'$'}{vars.xhs_cards}" "${'$'}{vars.xhs_style}" "${'$'}{vars.xhs_provider}" "${'$'}{vars.xhs_model}" "${'$'}{vars.xhs_fallback}"`,
        );
    });

    it('leaves kk-daily-ai-voice.yaml byte-identical (R1)', () => {
        expect(existsSync(VOICE1)).toBe(true);
        const diff = Bun.spawnSync(
            ['git', 'diff', '--exit-code', '--', 'plugins/kk/workflows/kk-daily-ai-voice.yaml'],
            {
                cwd: REPO,
            },
        );
        expect(diff.exitCode, `kk-daily-ai-voice.yaml changed:\n${diff.stdout.toString()}`).toBe(0);
    });
});

describe('kk-daily-safety — judge verdict confidence routing (AC6)', () => {
    const transitions = loadTransitions('plugins/kk/workflows/kk-daily-safety.yaml');
    const safety = Bun.YAML.parse(readFileSync(SAFETY, 'utf-8')) as {
        kind: string;
        vars: Record<string, string>;
        initialStates?: string[];
        initialState: string;
        states: { id: string }[];
    };

    /** Write the verdict + admission stamp a gate run leaves behind, and run the accept guard. */
    function routeJudge(options: { verdict: Record<string, unknown> | null; status: string; stamp?: boolean }): {
        matched: boolean;
        stderr: string;
        dir: string;
    } {
        const dir = tempDir('voice2-safety-');
        mkdirSync(join(dir, '24-script'), { recursive: true });
        const verdictPath = join(dir, '24-script', '20261007_09_safety-judge_verdict.json');
        if (options.verdict !== null) writeFileSync(verdictPath, JSON.stringify(options.verdict));
        if (options.stamp === true) {
            writeFileSync(
                join(dir, '24-script', '20261007_09_safety-judge_stamp.json'),
                JSON.stringify({ status: options.status }),
            );
        }
        const guard = transitions.find((t) => t.from === 'judge' && t.to === 'clean');
        expect(guard?.command).not.toBeNull();
        const vars = { ...safety.vars, work_dir: dir, run_date: '20261007', safety_status: options.status };
        const result = runGuard(String(guard?.command), vars, dir);
        return { ...result, dir };
    }

    it('is a state machine whose loop is the review → judge → revise chain', () => {
        expect(safety.kind).toBe('state-machine');
        expect(safety.initialState).toBe('review');
        expect(safety.states.map((state) => state.id)).toEqual(['review', 'judge', 'revise', 'clean', 'block']);
        expect(transitions.some((t) => t.from === 'revise' && t.to === 'review')).toBe(true);
        // The revise transition is bounded by the gate's budget var, which the DAG forwards.
        expect(safety.vars.safety_max_revise).toBe('2');
    });

    it.each([
        ['PASS + HIGH on admitted drafts', { verdict: 'PASS', confidence: 'HIGH' }, 'pass', true, true],
        ['PASS + MEDIUM on an escalated run', { verdict: 'PASS', confidence: 'MEDIUM' }, 'escalate', true, true],
        ['PASS + LOW after an admission-only exclusion', { verdict: 'PASS', confidence: 'LOW' }, 'exclude', true, true],
        ['PASS without a confidence field', { verdict: 'PASS' }, 'pass', true, false],
        ['PASS + out-of-enum confidence', { verdict: 'PASS', confidence: 'SURE' }, 'pass', true, false],
        ['PASS + lowercase confidence', { verdict: 'PASS', confidence: 'high' }, 'pass', true, false],
        ['a verdict that is not a PASS at all', { verdict: 'FAIL', confidence: 'HIGH' }, 'block', true, false],
        ['no verdict file (unreadable contract)', null, 'block', false, false],
    ])('%s is accepted or refused by the real accept guard', (_name, verdict, status, stamp, expected) => {
        const result = routeJudge({ verdict, status, stamp });
        expect(result.matched).toBe(expected);
        if (!expected) {
            expect(result.stderr).toContain('kk-daily-safety.judge.confidence-refused');
        }
    });

    it('names the refusal and never deadlocks the loop', () => {
        const refused = routeJudge({ verdict: { verdict: 'PASS', confidence: 'SURE' }, status: 'pass', stamp: true });
        expect(refused.matched).toBe(false);
        expect(refused.stderr).toContain('kk-daily-safety.judge.confidence-refused');
        expect(refused.stderr).toContain('PASS!');
        expect(refused.stderr).toContain('HIGH|MEDIUM|LOW');
        // Fail-closed without deadlock: the unconditional `judge -> block` always matches.
        const block = transitions.filter((t) => t.from === 'judge' && t.to === 'block');
        expect(block.length).toBe(1);
        expect(block[0]?.command).toBeNull();
    });

    it('the gate stage names the raw verdict/confidence it refused', () => {
        const dir = tempDir('voice2-safety-gate-');
        const runner = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');
        mkdirSync(join(dir, '24-script'), { recursive: true });
        mkdirSync(join(dir, '22-article'), { recursive: true });
        writeFileSync(join(dir, '24-script', '20261007_08_script_voicescript.yaml'), 'segments: []\n');
        writeFileSync(
            join(dir, '22-article', '20261007_06_article_content.json'),
            JSON.stringify({ title: 't', body: 'b' }),
        );
        // The request carries the draft digest: the prep stage writes it (and clears stale
        // report/verdict files), exactly as the review state does before the judge runs.
        const prep = Bun.spawnSync([process.execPath, runner, 'daily-safety-prep', dir, '20261007', 'xiaoyuzhou']);
        expect(prep.exitCode).toBe(0);
        writeFileSync(
            join(dir, '24-script', '20261007_09_safety-review_report.json'),
            JSON.stringify({ platforms: [{ decision: 'OK' }] }),
        );
        writeFileSync(
            join(dir, '24-script', '20261007_09_safety-judge_verdict.json'),
            JSON.stringify({ verdict: 'PASS', confidence: 'SURE' }),
        );
        const result = Bun.spawnSync([process.execPath, runner, 'daily-safety-gate', dir, '20261007', '2']);
        const stdout = result.stdout.toString();
        // Fail-closed and named: the gate blocks on the out-of-contract confidence and says why.
        expect(result.exitCode).toBe(0);
        expect(stdout).toContain('status=block');
        expect(stdout).toContain('no confidence');
        expect(readFileSync(join(dir, '24-script', '20261007_09_safety-judge_status.txt'), 'utf-8')).toBe('block');
    });

    it('resolves the verdict through the same confidence-aware filter as the other judges', () => {
        const guard = transitions.find((t) => t.from === 'judge' && t.to === 'clean');
        const filter = String(guard?.command).match(/jq -r '([^']*)'/)?.[1] ?? '';
        expect(filter).toBe(
            'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end',
        );
        // Every `${…}` the guard carries is a declared var (a builtin reference fails the run).
        for (const name of varsRefs(String(guard?.command))) expect(safety.vars[name]).toBeDefined();
    });
});

describe('kk-daily-ai-voice2 — empty pool ends the run as no-content (AC3)', () => {
    it('skips the content and publish subtrees, still records no-content, and ends done', () => {
        const cwd = tempDir('voice2-empty-');
        const outcome = runDag(cwd, {
            runId: 'voice2-empty-pool',
            pool: POOL_EMPTY,
            candidates: CANDIDATES_EMPTY,
            realRunReport: true,
        });
        // The pool guard is real: `kk store pool-count` refused, so `plan` never dispatched.
        expect(outcome.status).toBe('done');
        expect(called(outcome, 'store pool-count')).toBe(true);
        expect(called(outcome, 'stage daily-plan')).toBe(false);
        for (const prefix of ['stage daily-qc-content', 'stage daily-article', 'stage daily-generate']) {
            expect(called(outcome, prefix), `${prefix} must be skipped on an empty pool`).toBe(false);
        }
        expect(called(outcome, 'stage daily-publish-classify')).toBe(false);
        expect(called(outcome, 'store mark-used')).toBe(false);
        // run-report and ledger list `extract` in dependsOn, so they still ran.
        expect(called(outcome, 'daily run-report')).toBe(true);
        expect(called(outcome, 'ledger append')).toBe(true);
        const summary = readFileSync(join(outcome.workDir, 'run-report.summary.txt'), 'utf-8');
        expect(summary).toContain('no-content');
        expect(readFileSync(join(outcome.workDir, '20261007_19_run-report_report.md'), 'utf-8')).toContain(
            'no content',
        );
        // The ledger is the final call of the run.
        expect(outcome.log[outcome.log.length - 1]).toContain('ledger append');
        const trace = Bun.spawnSync(['spur', 'workflow', 'trace', outcome.runId, '--json'], { cwd: REPO });
        saveArtifact(`${outcome.runId}-trace.json`, trace.stdout.toString());
        saveArtifact(`${outcome.runId}-calls.log`, outcome.log.join('\n'));
        saveArtifact(`${outcome.runId}-run-report.summary.txt`, summary);
    }, 120_000);
});

describe('kk-daily-ai-voice2 — independent branches run concurrently and fan in (AC2)', () => {
    it('waits for wrap-docs before generate and still reaches the fan-in ordering', () => {
        const cwd = tempDir('voice2-full-');
        const outcome = runDag(cwd, {
            runId: 'voice2-concurrent',
            pool: POOL_FULL,
            candidates: CANDIDATES_FULL,
            sleepMs: 2,
        });
        expect(outcome.status).toBe('done');
        // 0212 race fix: generate depends on wrap-docs, whose outputs it consumes — the render must
        // not start in the same wave as the wrap-docs write. wrap-docs holds a 2 s sleep, so
        // starting >= 2 s after wrap-docs proves generate waited for its COMPLETION, not merely its
        // declaration. (Residual AC2 overlap — xhs-write ‖ generate's render — runs through
        // agent.run branches, which this fixture stubs out; run 4a9b22f0 exercised it end to end.)
        const generate = callTimes(outcome, 'stage daily-generate')[0];
        const wrapDocs = callTimes(outcome, 'stage daily-wrap-docs')[0];
        expect(generate).toBeDefined();
        expect(wrapDocs).toBeDefined();
        expect(generate as number).toBeGreaterThanOrEqual((wrapDocs as number) + 2_000);
        // The fan-in still saw every leaf's outcome: publish stays disabled here, so the whole
        // subtree (including publish-classify) is skipped by its condition, and the run reaches the
        // tail nodes that list `extract`.
        expect(called(outcome, 'stage daily-publish-prep')).toBe(false);
        expect(called(outcome, 'stage daily-publish-classify')).toBe(false);
        expect(called(outcome, 'stage daily-quality-report')).toBe(true);
        expect(called(outcome, 'store mark-used')).toBe(true);
        expect(called(outcome, 'ledger append')).toBe(true);
        // Ordering: extract → plan → qc-content → … → run-report → ledger.
        const order = outcome.log.map((line) => line.split(' ').slice(0, 3).join(' '));
        const index = (needle: string): number => order.findIndex((line) => line.includes(needle));
        expect(index('store extract')).toBeLessThan(index('stage daily-plan'));
        expect(index('stage daily-plan')).toBeLessThan(index('stage daily-qc-content'));
        expect(index('daily run-report')).toBeLessThan(index('ledger append'));
        saveArtifact(`${outcome.runId}-calls.log`, outcome.log.join('\n'));
    }, 120_000);
});

describe('kk daily — the DAG nodes’ commands', () => {
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

    it('prepare composes the workspace and writes both fixed anchors', async () => {
        const dir = tempDir('kk-daily-prepare-');
        const result = await run([
            'daily',
            'prepare',
            '--workflow',
            'kk-daily-ai-voice2',
            '--run-date',
            '2026-10-07',
            '--work-dir',
            join(dir, 'w'),
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).workDir).toBe(join(dir, 'w'));
        expect(readFileSync(join(dir, 'w/run-date.txt'), 'utf-8')).toBe('20261007\n');
        expect(readFileSync(join(dir, 'w/.safety-revise-count'), 'utf-8')).toBe('0\n');
    });

    it('run-report records no-content for an empty pool and refuses nothing', async () => {
        const dir = tempDir('kk-daily-report-');
        const pool = join(dir, 'pool.json');
        writeFileSync(pool, '[]');
        const result = await run([
            'daily',
            'run-report',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--pool',
            pool,
            '--candidates',
            join(dir, 'absent.json'),
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).noContent).toBe(true);
        expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain('no-content');
    });

    it('publish-classify classifies partial and folds the tail', async () => {
        const dir = tempDir('kk-daily-classify-');
        const publish = join(dir, '31-publish');
        mkdirSync(publish, { recursive: true });
        writeFileSync(
            join(publish, '20261007_14_publish-surfdash_result.json'),
            JSON.stringify({ targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] }),
        );
        writeFileSync(
            join(publish, '20261007_16_publish-podcast_result.json'),
            JSON.stringify({ targets: [{ target: 'podcast-pub', ok: false, status: 'failed' }] }),
        );
        const result = await run([
            'daily',
            'publish-classify',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--fold-tail',
            '--surfdash-root',
            join(dir, 'no-checkout'),
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).status).toBe('partial');
        expect(readFileSync(join(publish, '20261007_17_publish_publish-status.txt'), 'utf-8')).toBe('partial');
        saveArtifact(
            'publish-classify-completeness.json',
            readFileSync(join(publish, '20261007_17_publish_completeness.json'), 'utf-8'),
        );
    });
});
