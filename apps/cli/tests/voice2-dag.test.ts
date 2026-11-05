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
 * 9. `kk-daily-ai-voice.yaml` must stay behaviourally identical — the DAG supersedes it without
 *    editing it. 0257 R4 documents the opt-in `voxcpm` alias in both workflows, so documentation
 *    (comments and `description:` scalars) may change; any state/command/edge edit still fails.
 *
 * The DAG runs for real against a PATH `kk` shim that records every call, composes the workspace,
 * and returns fixture pools — plus the real `kk store pool-count` / `kk store extract` conditions and
 * the real `kk daily run-report` no-content path. The traces, the run-report summary and the call log
 * are copied to `.works/test-artifacts/0211/`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

/**
 * `${vars.name}` assembled at runtime so the `noTemplateCurlyInString` lint stays quiet (the same
 * dodge `plugins/kk/tests/safety-reviewer-failure.test.ts` uses).
 */
const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Same store isolation as `commands/daily.test.ts` (0242 R6): this file drives `kk daily prepare`
 * in-process, which resolves `store.db_path` from `KK_CONFIG` and otherwise falls back to the
 * cwd-relative `.works/kk.db` — the operator's LIVE store when the suite runs from the repo root.
 */
let prevKkConfig: string | undefined;
beforeEach(() => {
    const dir = tempDir('kk-store-isolation-');
    const config = join(dir, 'kk.yaml');
    writeFileSync(config, `store:\n  db_path: ${join(dir, 'kk.db')}\n`);
    prevKkConfig = process.env.KK_CONFIG;
    process.env.KK_CONFIG = config;
});
afterEach(() => {
    if (prevKkConfig === undefined) delete process.env.KK_CONFIG;
    else process.env.KK_CONFIG = prevKkConfig;
    prevKkConfig = undefined;
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
        '  "stage daily-wrap-docs")',
        `    sleep ${fixtures.sleepMs} ; exit 0 ;;`,
        // The generate tier's fallback gates read the whole-document Content's generator identity,
        // so the stub writes one (voxcpm-tts = the default primary's plugin id); the fallback
        // siblings then see a valid upstream render and skip — one daily-generate call per run.
        '  "stage daily-generate")',
        `    sleep ${fixtures.sleepMs} ; wd="$3"; rd="$4"; mkdir -p "$wd/30-audio"`,
        `    printf '%s' '{"metadata":{"generator":"kk:voxcpm-tts","qc":{"passed":true},"audioPath":"a.wav"}}' > "$wd/30-audio/\${rd}_11_generate_content.json"`,
        '    exit 0 ;;',
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

/**
 * 0238 AC1–AC4 — the fake executor the agent.run nodes dispatch.
 *
 * The engine resolves a canonical agent name straight to a binary on PATH (`resolveExecutor` →
 * `{ agent: name }`), so a same-named script is a real stand-in for `pi` / `codex`. Probed shape
 * (2026-10-09): `pi --version` first (capability attestation), then
 * `pi -p "<input>" --session-dir … --model … --mode text`. A name listed in `noopAgents` answers 0
 * and writes NOTHING — the stochastic executor no-op 0238 exists for; every other name writes the
 * expectFile its own prompt names (the last `.json`/`.md` path in the input text).
 */
function writeAgentStub(binDir: string, names: string[], noopAgents: string[]): void {
    const noopPattern = noopAgents.length === 0 ? 'ZZZ_NEVER' : noopAgents.join('|');
    const script = [
        '#!/bin/bash',
        'ME="$(basename "$0")"',
        'PROBE=0',
        'for a in "$@"; do',
        '  case "$a" in',
        '    --version) echo "0.99.0"; PROBE=1 ;;',
        '    --list-models) echo "stub/model-1"; PROBE=1 ;;',
        '    --help) PROBE=1 ;;',
        '  esac',
        'done',
        '[ "$PROBE" = "1" ] && exit 0',
        // One line per PROMPT invocation (the probes are excluded), so the log is the retry order.
        '[ -n "$KK_STUB_AGENT_LOG" ] && printf "%s\n" "$ME" >> "$KK_STUB_AGENT_LOG"',
        `case "$ME" in ${noopPattern}) exit 0 ;; esac`,
        'OUT="$(printf "%s\n" "$*" | grep -oE "[^ ]+\\.(json|md)" | tail -1)"',
        '[ -n "$OUT" ] && mkdir -p "$(dirname "$OUT")" || exit 1',
        // plan-translate/plan-translate-retry deliverables must satisfy the workflow's jq validity
        // gate (array, length == candidates docs, all objects) — write the real contract shape,
        // not a scalar, or every stubbed primary "fails" and fires its retry (0238 R2 gate).
        'case "$OUT" in',
        '  *_03_plan_plan.json)',
        '    CAND="$(printf "%s\\n" "$*" | grep -oE "[^ ]+_04_quality-control-content_candidates\\.json" | head -1)"',
        '    jq -n --slurpfile c "$CAND" \'[ $c[0].metadata.docs[] | {id} ]\' > "$OUT" ;;',
        '  *) printf \'%s\' \'{"stub":true}\' > "$OUT" ;;',
        'esac',
        'exit 0',
    ].join('\n');
    for (const name of names) {
        const path = join(binDir, name);
        writeFileSync(path, `${script}\n`);
        chmodSync(path, 0o755);
    }
}

interface RunOutcome {
    code: number;
    status: string;
    /** Every recorded `kk` call, timestamp stripped — the dispatch order. */
    log: string[];
    /** The same calls as `<epoch-ns> <command>`, for the concurrency probe. */
    rawLog: string[];
    /** Every recorded agent-stub invocation (`<agent> <args>`), 0238 only. */
    agentLog: string[];
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
        /** 0238: canonical agent names to install as PATH stubs (`pi`, `codex`). */
        agentStubs?: string[];
        /** 0238: the subset of `agentStubs` that answers 0 without writing its expectFile. */
        agentNoop?: string[];
    },
): RunOutcome {
    const binDir = tempDir(`voice2-bin-${options.runId}-`);
    const works = tempDir(`voice2-works-${options.runId}-`);
    const logPath = join(cwd, 'kk-calls.log');
    const agentLogPath = join(cwd, 'agent-calls.log');
    writeKkShim(binDir, { pool: options.pool, candidates: options.candidates, sleepMs: options.sleepMs ?? 0 });
    if (options.agentStubs !== undefined) {
        writeAgentStub(binDir, options.agentStubs, options.agentNoop ?? []);
    }
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
                    KK_STUB_AGENT_LOG: agentLogPath,
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
    const agentLog = existsSync(agentLogPath)
        ? readFileSync(agentLogPath, 'utf-8').trim().split('\n').filter(Boolean)
        : [];
    const outcome: RunOutcome = {
        code: result.exitCode ?? 1,
        status: summary.status ?? 'unknown',
        log,
        rawLog,
        agentLog,
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

/** 0238: the agent names the stub recorded running, first invocation first. */
function agentsCalled(outcome: RunOutcome): string[] {
    return outcome.agentLog.map((line) => line.split(' ')[0] ?? '');
}

/** 0238: one node's action event in the run trace — proves the node actually dispatched. */
function traceAction(
    runId: string,
    nodeId: string,
    cwd: string,
): { status?: string; startedAt?: string; completedAt?: string } | undefined {
    const trace = Bun.spawnSync(['spur', 'workflow', 'trace', runId, '--json'], { cwd });
    const parsed = JSON.parse(trace.stdout.toString()) as {
        events: { kind: string; node?: string; status?: string; startedAt?: string; completedAt?: string }[];
    };
    return parsed.events.find((event) => event.kind === 'action' && event.node === nodeId);
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
        // 2026-10-19: the pool comes through the `daily-extract` stage, which owns the conditional
        // window ladder; the topic and the floor/vdriver inputs that gate that ladder stay pinned.
        expect(String(extract?.action?.options?.command)).toContain('kk stage daily-extract');
        expect(String(extract?.action?.options?.command)).toContain('ai-news');
        expect(String(extract?.action?.options?.command)).toContain(`"${varRef('episode_min_minutes')}"`);
        // 0228 R6c: exclusion is topic-scoped and always on; the workflow-scoped flag is gone.
        expect(String(extract?.action?.options?.command)).not.toContain('--exclude-used');
        // …and the old workflow-keyed ledger verb is gone from the DAG entirely (R5).
        expect(dag.nodes.map((node) => node.id)).not.toContain('mark-used');
    });

    it('probes the enabled channels\u2019 saved sessions up front, warning-only (20261012)', () => {
        const node = dag.nodes.find((candidate) => candidate.id === 'session-preflight');
        expect(node, 'session-preflight node is missing').toBeDefined();
        // A leaf off the head chain, deliberately: nothing may depend on it, or a refused session
        // would start routing the run instead of only warning about it, and `extract` must keep
        // `read-run-date` as its sole dependency for the single-node head waves above.
        expect(dependentsOf(dag, 'session-preflight')).toEqual([]);
        expect(node?.dependsOn).toEqual(['read-run-date']);
        // Only a publishing run needs a console session.
        expect(String(node?.condition?.options?.command)).toContain('publish_enabled');
        expect(String(node?.condition?.options?.command)).toContain('wechat_enabled');
        // Warning-only: the probe exits non-zero on a refused session, and the channel's own publish
        // node stays the authority on whether it published (2026-10-12: a dead session failed soft at
        // the very end of a 40-minute run, so the probe names it at the start instead).
        expect(node?.action?.options?.onError).toBe('continue');
        expect(String(node?.action?.options?.command)).toContain('kk plugin check wechatmp-pub');
        expect(String(node?.action?.options?.command)).toContain('profile-check.ts login');
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
        // whole dependency set is the extract chain) and `mark-published` (which also pins `extract`).
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
            'select',
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
        const leaves = ['publish-podcast', 'publish-surfdash', 'xhs-publish', 'wechat-publish', 'translate-validate'];
        const classify = dag.nodes.find((node) => node.id === 'publish-classify');
        expect(classify?.dependsOn?.sort()).toEqual([...leaves].sort());
        expect(classify?.dependencyPolicy).toBe('all');
        expect(String(classify?.condition?.options?.command)).toBe(`test "\${vars.publish_enabled}" = "true"`);
        for (const id of [
            'publish-prep',
            'publish-surfdash-prepare',
            'publish-surfdash',
            'publish-podcast',
            'translate-localize',
            'translate-refine',
            'translate-validate',
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

    it('settles Surfdash before WeChat so the original link is available without blocking the soft channel on failure', () => {
        const wechat = dag.nodes.find((node) => node.id === 'wechat-publish');
        expect(wechat?.dependsOn).toContain('publish-surfdash');
        expect(wechat?.dependencyPolicy).toBe('all');
        expect(dag.nodes.findIndex((node) => node.id === 'wechat-publish')).toBeGreaterThan(
            dag.nodes.findIndex((node) => node.id === 'publish-surfdash'),
        );
    });

    it('prepares zh before locale translation and invokes final Surfdash publish only after local validation (two-phase locale gate)', () => {
        const prepare = dag.nodes.find((node) => node.id === 'publish-surfdash-prepare');
        const localize = dag.nodes.find((node) => node.id === 'translate-localize');
        const refine = dag.nodes.find((node) => node.id === 'translate-refine');
        const sync = dag.nodes.find((node) => node.id === 'translate-validate');
        const publish = dag.nodes.find((node) => node.id === 'publish-surfdash');

        expect(prepare?.dependsOn).toEqual(['publish-prep']);
        expect(String(prepare?.action?.options?.command)).toContain('daily-prepare-surfdash');
        expect(localize?.dependsOn).toEqual(['publish-surfdash-prepare']);
        expect(refine?.dependsOn).toEqual(['translate', 'translate-retry']);
        expect(refine?.action?.onError).toBe('continue');
        expect(String(refine?.action?.options?.command)).toContain('daily-surfdash-refine');
        expect(sync?.dependsOn).toEqual(['translate-refine']);
        expect(sync?.action?.onError).toBe('continue');
        expect(String(sync?.action?.options?.command)).toContain('daily-translate-validate');
        expect(publish?.dependsOn).toEqual(['publish-prep', 'translate-validate']);
        const publishCommand = String(publish?.action?.options?.command);
        expect(publishCommand).toContain(`"\${vars.plugins_path}" "true"`);
        expect(publishCommand).toContain('daily-publish-surfdash');
    });

    it('declares every DAG dependency before its dependent node (engine declaration-order contract)', () => {
        const ids = dag.nodes.map((node) => node.id);
        for (const [nodeIndex, node] of dag.nodes.entries()) {
            for (const dependency of node.dependsOn ?? []) {
                const dependencyIndex = ids.indexOf(dependency);
                expect(
                    dependencyIndex,
                    `${node.id} references missing dependency ${dependency}`,
                ).toBeGreaterThanOrEqual(0);
                expect(dependencyIndex, `${node.id} must be declared after ${dependency}`).toBeLessThan(nodeIndex);
            }
        }
    });

    it('records the planned set in `select` right after qc-content, and promotes it only when publishing (R6)', () => {
        // 0228 R6a: the selection is recorded at QC — the invoke point no longer depends on the DAG
        // reaching its tail, so a run that fails, pauses or skips publish still excludes its set.
        const ids = dag.nodes.map((node) => node.id);
        expect(ids[ids.indexOf('qc-content') + 1]).toBe('select');
        const select = dag.nodes.find((node) => node.id === 'select');
        expect(select?.dependsOn).toEqual(['qc-content']);
        expect(String(select?.condition?.options?.command)).toContain('_04_quality-control-content_candidates.json');
        const selectCommand = String(select?.action?.options?.command);
        expect(selectCommand).toContain('kk store select --topic ai-news --workflow kk-daily-ai-voice2');
        expect(selectCommand).toContain(`--run "\${vars.__runId}"`);
        expect(selectCommand).toContain(
            `--in "\${vars.work_dir}/21-plan/\${vars.run_date}_04_quality-control-content_candidates.json"`,
        );

        // 0228 R6b: `mark-published` keeps mark-used's position, and its guard refuses a dry run.
        const markPublished = dag.nodes.find((node) => node.id === 'mark-published');
        expect(markPublished?.dependsOn).toEqual(['publish-classify', 'extract']);
        const guard = String(markPublished?.condition?.options?.command);
        expect(guard).toContain('_04_quality-control-content_candidates.json');
        expect(guard).toContain(`test "\${vars.publish_enabled}" = "true"`);
        expect(String(markPublished?.action?.options?.command)).toContain(
            `kk store mark-published --topic ai-news --run "\${vars.__runId}"`,
        );
        expect(dag.nodes.find((node) => node.id === 'run-report')?.dependsOn).toContain('mark-published');
        expect(dependentsOf(dag, 'ledger')).toEqual([]);
        // The tail cannot write its OWN section (the trace is still `running` there), so it runs the
        // verb that can act: a backfill of every finished run the ledger is missing. `kk ledger append`
        // here made every green run record a false `ledger | failed` (20261012).
        expect(String(dag.nodes.find((node) => node.id === 'ledger')?.action?.options?.command)).toContain(
            'kk ledger sync --workflow kk-daily-ai-voice2',
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

    it('threads the 0219 xhs_fallback opt-in and the 0235 note scope into the daily-xhs-render call', () => {
        const yaml = readFileSync(WORKFLOW, 'utf-8');
        expect(yaml).toContain('xhs_fallback: "true"');
        expect(yaml).toContain(
            `kk stage daily-xhs-render "${'$'}{vars.work_dir}" "${'$'}{vars.run_date}" "${'$'}{vars.plugins_path}" "${'$'}{vars.xhs_cards}" "${'$'}{vars.xhs_style}" "${'$'}{vars.xhs_provider}" "${'$'}{vars.xhs_model}" "${'$'}{vars.xhs_fallback}" "episode"`,
        );
    });

    it('threads the 0236 发播客 follow-up arg into the voice2 daily-publish-xhs call only', () => {
        const yaml = readFileSync(WORKFLOW, 'utf-8');
        // voice2 asks for the episode's 发播客 note in the same visit; voice1 (behaviourally identical,
        // asserted below) passes no fifth arg, so its packaged note is untouched.
        expect(yaml).toContain(
            `kk stage daily-publish-xhs "${'$'}{vars.work_dir}" "${'$'}{vars.run_date}" "${'$'}{vars.plugins_path}" "${'$'}{vars.xhs_live}" "true"`,
        );
    });

    it('orders publish-prep before xhs-publish — the 发播客 note reads its Content (0236 P1)', () => {
        // publish-prep is a data dependency, not a sibling: daily-publish-xhs reads
        // `31-publish/<date>_13_publish-prep_content.json` for the 发播客 note. Without the edge the
        // two nodes race and the note is dropped silently (the stage logs and still exits 0).
        expect(dag.nodes.find((node) => node.id === 'xhs-publish')?.dependsOn).toEqual(['xhs-render', 'publish-prep']);
    });

    it('gates xhs-render and xhs-publish on xhs_enabled — a skipped xhs-write still admits its dependents (0236)', () => {
        // Without their own gate, a publishing run with xhs_enabled=false would re-package and
        // re-publish a stale same-day `25-xhs/content.json` as a draft. xhs-render additionally
        // carries the candidates pool gate (0266): a duration-refused run emptied the candidates,
        // so re-packaging that stale series is exactly what the gate stops.
        const render = String(
            dag.nodes.find((candidate) => candidate.id === 'xhs-render')?.condition?.options?.command,
        );
        expect(render).toContain('kk store pool-count');
        expect(render).toContain('_04_quality-control-content_candidates.json" --min 1');
        expect(render).toContain(`test "\${vars.xhs_enabled}" = "true"`);
        expect(String(dag.nodes.find((node) => node.id === 'xhs-publish')?.condition?.options?.command)).toBe(
            `test "\${vars.xhs_enabled}" = "true"`,
        );
    });

    it('passes vdriver to the duration gate and pool-gates the publish fan after a duration refusal (0266 R2)', () => {
        // The measured gate needs the driver id to recompute the pre-spend estimate for its refusal
        // artifact (the same SPEAK_CHAR_EXPANSION/spokenCharRate arithmetic the floor gate uses).
        const duration = String(dag.nodes.find((node) => node.id === 'duration')?.action?.options?.command);
        expect(duration).toContain('kk stage daily-episode-duration');
        expect(duration).toContain(`"\${vars.episode_min_minutes}" "\${vars.episode_max_minutes}" "\${vars.vdriver}"`);
        // A duration refusal empties the candidates file, so the publish fan mirrors the QC-zero
        // guards: pool-count first, then the channel enable flag.
        for (const [id, flag] of [
            ['publish-prep', 'publish_enabled'],
            ['xhs-render', 'xhs_enabled'],
        ] as const) {
            const condition = String(dag.nodes.find((candidate) => candidate.id === id)?.condition?.options?.command);
            expect(condition, id).toContain('kk store pool-count');
            expect(condition, id).toContain('_04_quality-control-content_candidates.json" --min 1');
            expect(condition, id).toContain(`test "\${vars.${flag}}" = "true"`);
        }
        // show-notes had no condition of its own - a refusal must skip it too.
        const showNotes = String(
            dag.nodes.find((candidate) => candidate.id === 'show-notes')?.condition?.options?.command,
        );
        expect(showNotes).toContain('kk store pool-count');
        expect(showNotes).toContain('_04_quality-control-content_candidates.json" --min 1');
    });

    it('keeps the voice2 xhs-write prompt inside the ADR-115 1000-char cap (0235)', () => {
        // Measured on the parsed scalar — the prompt the agent receives, YAML indentation stripped.
        const input = String(dag.nodes.find((node) => node.id === 'xhs-write')?.action?.options?.input);
        expect(input).toContain('itemId');
        expect(input.length).toBeLessThanOrEqual(1000);
    });

    it('leaves kk-daily-ai-voice.yaml behaviourally identical (R1; 0257 allows docs-only edits)', () => {
        expect(existsSync(VOICE1)).toBe(true);
        const diff = Bun.spawnSync(['git', 'diff', '--', 'plugins/kk/workflows/kk-daily-ai-voice.yaml'], {
            cwd: REPO,
        });
        const changed = diff.stdout
            .toString()
            .split('\n')
            .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
        // Only comments and `description:` scalars may differ. A changed state id, command, edge,
        // var default or condition line still fails here — the behaviour is what R1 froze.
        // Exception (2026-10-20): `intro_music` points at the sting under the config root (ADR-042)
        // in BOTH workflows. Same file as the retired works-tree symlink, and `dailyIntro` expands
        // `~` for either workflow, so the frozen voice1 behaviour is unchanged.
        const docOnly = (line: string): boolean =>
            /^[+-]\s*#/.test(line) || /^[+-]\s*description:/.test(line) || /^[+-]\s*intro_music:/.test(line);
        const behavioural = changed.filter((line) => !docOnly(line));
        expect(behavioural, `kk-daily-ai-voice.yaml changed beyond docs:\n${diff.stdout.toString()}`).toEqual([]);
    });
});

describe('kk-daily-safety — decision-bound publish verdict (AC6, 0317 R6)', () => {
    const transitions = loadTransitions('plugins/kk/workflows/kk-daily-safety.yaml');
    const safety = Bun.YAML.parse(readFileSync(SAFETY, 'utf-8')) as {
        kind: string;
        vars: Record<string, string>;
        initialStates?: string[];
        initialState: string;
        states: { id: string; onEnter?: { kind: string; onError?: string; options?: Record<string, unknown> }[] }[];
    };
    const STAGE_RUNNER = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');

    /**
     * Write the gate's classification + stamp and the `kk-safety-verdict` decision row a judge run
     * leaves behind, fold them through `kk stage daily-safety-verdict`, and run the accept guard.
     * `decision: null` means the decide action was tolerated away (`onError: continue`), so no row
     * exists — the fail-closed case.
     */
    function routeJudge(options: { status: string; stamp?: boolean; decision?: string | null }): {
        matched: boolean;
        stderr: string;
        dir: string;
    } {
        const dir = tempDir('voice2-safety-');
        mkdirSync(join(dir, '24-script'), { recursive: true });
        writeFileSync(join(dir, '24-script', '20261007_09_safety-judge_status.txt'), options.status);
        if (options.stamp !== false) {
            writeFileSync(
                join(dir, '24-script', '20261007_09_safety-judge_stamp.json'),
                JSON.stringify({ status: options.status }),
            );
        }
        if (options.decision !== null) {
            writeFileSync(
                join(dir, '24-script', '20261007_09_safety-verdict.decision'),
                JSON.stringify({ value: options.decision ?? options.status, degraded: false, source: 'model' }),
            );
        }
        const stage = Bun.spawnSync([process.execPath, STAGE_RUNNER, 'daily-safety-verdict', dir, '20261007'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(stage.exitCode).toBe(0);
        const guard = transitions.find((t) => t.from === 'judge' && t.to === 'clean');
        expect(guard?.command).not.toBeNull();
        const vars = { ...safety.vars, work_dir: dir, run_date: '20261007', safety_status: options.status };
        const result = runGuard(String(guard?.command), vars, REPO);
        return { ...result, stderr: `${stage.stderr.toString()}${result.stderr}`, dir };
    }

    it('names the judge verdict path with its step prefix and stays inside the ADR-115 prompt cap', () => {
        const yaml = readFileSync(SAFETY, 'utf-8');
        const block = yaml.match(/- id: judge-retry\n[\s\S]*?(?=\n {2}- id: )/)?.[0] ?? '';
        // The judge prompt is a shared YAML anchor (`&safety-judge-input`) so the primary and its
        // retry cannot drift (2026-10-24); the anchored body is the contract, not the reference.
        const anchored = yaml.match(/input: &safety-judge-input \|\n([\s\S]*?)(?=\n {0,10}\S)/)?.[1] ?? '';
        const ref = block.match(/input: (\*[\w-]+)/)?.[1];
        const input = ref === undefined ? anchored : anchored;
        expect(ref, 'judge steps must reference the shared anchor').toBe('*safety-judge-input');
        // On 2026-10-10 the safety-judge agent wrote its verdict to ..._08_safety-judge_verdict.json
        // instead of ..._09_..., which spur reports as a contract violation and fails the run with no
        // verdict at all. The prompt must name the prefix, and it must stay under the 1000-char cap.
        expect(input).toContain('prefix `09_`, never `08_`');
        expect(input).toContain('_09_safety-judge_verdict.json');
        expect(input.length).toBeLessThanOrEqual(1000);
        expect(block, 'the judge carries one prompt, shared by both attempts').not.toContain('input: |');
    });

    it('retries each agent step on a capable tier when the primary leaves no artifact (2026-10-24)', () => {
        // The failure this pins: `opencode ... Invalid credential` failed `review`, then `judge`, on
        // every attempt because both named `${vars.agent}` (a scribe/cheap rung). With no report the
        // gate scored `block` — an episode withheld although nothing had reviewed it. A retry on a
        // DIFFERENT, higher rung is what recovered the run the same day.
        type SafetyAction = { kind?: string; options?: Record<string, unknown> };
        const parsed = Bun.YAML.parse(readFileSync(SAFETY, 'utf-8')) as {
            vars: Record<string, string>;
            states: { id: string; onEnter?: SafetyAction[] }[];
        };
        const agentSteps = (id: string): SafetyAction[] =>
            (parsed.states.find((state) => state.id === id)?.onEnter ?? []).filter(
                (action) => action.kind === 'agent.run',
            );
        for (const [id, retryId] of [
            ['review', 'review-retry'],
            ['judge-primary', 'judge-retry'],
            ['revise', 'revise-retry'],
        ] as const) {
            const steps = agentSteps(id);
            expect(String(steps[0]?.options?.agent ?? ''), `${id}'s primary keeps the caller executor`).toContain(
                'vars.agent',
            );
            expect(steps).toHaveLength(1);
            const retry = agentSteps(retryId ?? '');
            expect(retry).toHaveLength(1);
            expect(String(retry[0]?.options?.agent ?? ''), `${id} must retry on vars.agent_retry`).toContain(
                'vars.agent_retry',
            );
        }
        // Declared, not an inline literal, so an operator can re-point it without editing the graph.
        expect(parsed.vars.agent_retry).toBeTruthy();
    });

    it('is a state machine whose loop is the review → judge → revise chain', () => {
        expect(safety.kind).toBe('state-machine');
        expect(safety.initialState).toBe('review');
        expect(safety.states.map((state) => state.id)).toEqual([
            'review',
            'review-retry',
            'judge-primary',
            'judge-retry',
            'judge',
            'revise',
            'revise-retry',
            'revise-apply',
            'clean',
            'block',
        ]);
        expect(transitions.some((t) => t.from === 'revise-apply' && t.to === 'review')).toBe(true);
        expect(transitions.find((t) => t.from === 'review' && t.to === 'review-retry')?.command).toContain(
            'report-valid',
        );
        expect(transitions.find((t) => t.from === 'judge-primary' && t.to === 'judge-retry')?.command).toContain(
            'judge-valid',
        );
        // The revise transition is bounded by the gate's budget var, which the DAG forwards.
        expect(safety.vars.safety_max_revise).toBe('2');
    });

    it('every agent step tolerates its own failure so the gate, not the step, owns fail-closed (0270)', () => {
        type SafetyAction = { kind?: string; onError?: string; options?: Record<string, unknown> };
        const states = (
            Bun.YAML.parse(readFileSync(SAFETY, 'utf-8')) as { states: { id: string; onEnter?: SafetyAction[] }[] }
        ).states;
        const agentSteps = states.flatMap((state) =>
            (state.onEnter ?? [])
                .filter((action) => action.kind === 'agent.run')
                .map((action) => ({ state: state.id, onError: action.onError })),
        );
        // Non-vacuous: review, judge and revise each run an agent step — and since 2026-10-24 each
        // carries a `-retry` sibling here (a capable-tier second attempt), because the state
        // machine has no back-edge for `review`/`judge` and a failed first attempt used to leave no
        // artifact at all, which the gate then failed CLOSED as `block`.
        expect(agentSteps.map((step) => step.state).sort()).toEqual([
            'judge-primary',
            'judge-retry',
            'review',
            'review-retry',
            'revise',
            'revise-retry',
        ]);
        // 0270: an untolerated agent failure aborts the machine at that node, so `daily-safety-gate`
        // never runs and the nested run ends `-> review` having written no status (2026-10-12 — an out
        // of balance executor plus a refusing failover model took the whole daily DAG down that way).
        // The gate is what writes `safety_status` and routes to a declared terminal, so every agent
        // step must hand its failure to it instead of claiming the machine.
        for (const step of agentSteps)
            expect(step.onError, `${step.state} must tolerate its agent failing`).toBe('continue');
        // …and the gate really does follow the agent step in the SAME state (verified engine behaviour:
        // a later onEnter action still runs after a tolerated failure), so tolerating it cannot skip it.
        for (const id of ['review', 'judge-primary']) {
            const actions = states.find((state) => state.id === id)?.onEnter ?? [];
            const agentAt = actions.findIndex((action) => action.kind === 'agent.run');
            const commandAt = actions.findIndex((action) => action.kind === 'shell');
            expect(agentAt, `${id} has no agent.run step`).toBeGreaterThanOrEqual(0);
            if (id === 'review') expect(commandAt, 'prep precedes the primary reviewer').toBeLessThan(agentAt);
        }
        expect(
            states
                .find((state) => state.id === 'judge')
                ?.onEnter?.some(
                    (action) =>
                        action.kind === 'shell' && String(action.options?.command).includes('daily-safety-gate'),
                ),
        ).toBe(true);
        expect(
            states.find((state) => state.id === 'judge')?.onEnter?.some((action) => action.kind === 'agent.run'),
        ).toBe(false);
    });

    it.each([
        ['a gate pass the decision confirms', 'pass', 'pass', true],
        ['a human escalation the decision confirms', 'escalate', 'escalate', true],
        ['an admission-only exclusion the decision confirms', 'exclude', 'exclude', true],
        ['a decide action that was tolerated away (no row)', 'pass', null, false],
        ['a decision outside the admitted vocabulary', 'pass', 'block', false],
        ['a gate block the decision cannot overrule', 'block', 'pass', false],
        ['a gate revise the decision cannot overrule', 'revise', 'pass', false],
        ['a missing admission stamp', 'pass', 'pass', false],
    ])('%s is accepted or refused by the real accept guard', (_name, status, decision, expected) => {
        const result = routeJudge({ status, decision, stamp: !(_name === 'a missing admission stamp') });
        expect(result.matched).toBe(expected);
        if (!expected) {
            expect(result.stderr).toMatch(/kk-daily-safety\.judge\.(verdict|decision)-refused/);
        }
    });

    it('declares kk-safety-verdict with escalate as its fallback, over the report as evidence', () => {
        const catalog = Bun.YAML.parse(readFileSync(join(REPO, 'plugins/kk/decisions/kk-safety.yaml'), 'utf-8')) as {
            decisions: Record<string, { type: string; fallback: string; criteria: Record<string, string> }>;
        };
        const decision = catalog.decisions['kk-safety-verdict'];
        expect(decision?.type).toBe('choice');
        expect(decision?.fallback).toBe('escalate');
        expect(Object.keys(decision?.criteria ?? {}).sort()).toEqual(['escalate', 'exclude', 'pass']);
        const judge = safety.states.find((state) => state.id === 'judge');
        const decide = judge?.onEnter?.find((action) => action.kind === 'decide');
        expect(decide?.options?.decision).toBe('kk-safety-verdict');
        expect(decide?.options?.evidence).toEqual(
            expect.arrayContaining([
                `${varRef('work_dir')}/${varRef('safety_scope_dir')}/${varRef('run_date')}_09_safety-review_report.json`,
            ]),
        );
        // A tolerated decide failure must never fail the run; the guard reads a missing row as a refusal.
        expect(decide?.onError).toBe('continue');
    });

    it('names the refusal and never deadlocks the loop', () => {
        const refused = routeJudge({ status: 'pass', decision: null });
        expect(refused.matched).toBe(false);
        expect(refused.stderr).toContain('kk-daily-safety.judge.decision-refused');
        expect(refused.stderr).toContain('pass|escalate|exclude');
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

    it('uses one predicate over the folded verdict and unattended escalation policy', () => {
        const guard = transitions.find((t) => t.from === 'judge' && t.to === 'clean');
        expect(String(guard?.command).trim()).toBe(
            [
                'bun plugins/kk/scripts/safety-artifact-check.ts publish-valid "',
                varRef('work_dir'),
                '" "',
                varRef('run_date'),
                '" "',
                varRef('unattended'),
                '" "',
                // 0331: the guard reads the scope-tagged artifacts; voice2 passes no scope var so
                // the default keeps the pre-0331 drafts paths.
                varRef('safety_scope_dir'),
                '"',
            ].join(''),
        );
        // Every `${…}` the guard carries is a declared var (a builtin reference fails the run).
        for (const name of varsRefs(String(guard?.command))) expect(safety.vars[name]).toBeDefined();
    });
});

describe('kk-daily-ai-voice2 — agent.run recovery siblings (0238 AC1–AC4)', () => {
    /** Only the two hard-fail producers are active: every other agent.run branch stays disabled. */
    const baseVars = {
        plan_translate_enabled: 'true',
        article_write_enabled: 'false',
        script_write_enabled: 'false',
        cover_enabled: 'false',
        agent: 'pi',
        // `codex`, not `claude`: a name that matches a configured executor profile is refused by
        // the engine while that profile is disabled (e.g. the quota guard), before PATH is consulted.
        agent_retry: 'codex',
    };

    it('AC1 — a primary that exits 0 without its expectFile is recovered by the retry sibling', () => {
        const cwd = tempDir('voice2-retry-');
        const outcome = runDag(cwd, {
            runId: 'voice2-retry-recover',
            pool: POOL_FULL,
            candidates: CANDIDATES_FULL,
            vars: baseVars,
            agentStubs: ['pi', 'codex'],
            agentNoop: ['pi'],
        });
        // The stub answers 0 with no tool call, exactly the observed executor no-op, so the retry
        // sibling is the only writer of the plan file.
        expect(agentsCalled(outcome)).toEqual(['pi', 'codex']);
        expect(outcome.status).toBe('done');
        expect(existsSync(join(outcome.workDir, '21-plan', '20261007_03_plan_plan.json'))).toBe(true);
        // The failing primary still preserved its contract-violation sidecar.
        expect(existsSync(join(cwd, '.spur/run/voice2-retry-recover-plan-translate-partial.md'))).toBe(true);
        expect(existsSync(join(cwd, '.spur/run/voice2-retry-recover-plan-translate-retry-partial.md'))).toBe(false);
    }, 180_000);

    it('AC2 — both attempts missing the file ends the run failed at the retry, keeping both sidecars', () => {
        const cwd = tempDir('voice2-retry-fail-');
        const outcome = runDag(cwd, {
            runId: 'voice2-retry-both-noop',
            pool: POOL_FULL,
            candidates: CANDIDATES_FULL,
            vars: baseVars,
            agentStubs: ['pi', 'codex'],
            agentNoop: ['pi', 'codex'],
        });
        expect(outcome.status).toBe('failed');
        for (const nodeId of ['plan-translate', 'plan-translate-retry']) {
            const sidecar = join(cwd, `.spur/run/voice2-retry-both-noop-${nodeId}-partial.md`);
            expect(existsSync(sidecar), `${nodeId} must keep its contract-violation sidecar`).toBe(true);
        }
    }, 180_000);

    it('AC3 — a successful primary skips the retry while the downstream readers still run', () => {
        const cwd = tempDir('voice2-retry-skip-');
        const outcome = runDag(cwd, {
            runId: 'voice2-retry-primary-ok',
            pool: POOL_FULL,
            candidates: CANDIDATES_FULL,
            vars: { ...baseVars, article_write_enabled: 'true', cover_enabled: 'true', script_write_enabled: 'true' },
            agentStubs: ['pi', 'codex'],
            agentNoop: [],
        });
        expect(outcome.status).toBe('done');
        // The primary wrote its file (pi is not a no-op here), so the retry's condition is false and
        // the engine records no action event for it — the done+skipped mix the design relies on.
        expect(traceAction(outcome.runId, 'plan-translate', cwd)).toBeDefined();
        expect(traceAction(outcome.runId, 'plan-translate-retry', cwd)).toBeUndefined();
        for (const nodeId of ['article-write', 'cover-brief', 'script-write']) {
            expect(traceAction(outcome.runId, nodeId, cwd), `${nodeId} must still run`).toBeDefined();
        }
    }, 180_000);

    it('AC4 — every plan.json reader starts after the plan producers settle', () => {
        const cwd = tempDir('voice2-retry-order-');
        const outcome = runDag(cwd, {
            runId: 'voice2-retry-order',
            pool: POOL_FULL,
            candidates: CANDIDATES_FULL,
            vars: { ...baseVars, article_write_enabled: 'true', cover_enabled: 'true', script_write_enabled: 'true' },
            agentStubs: ['pi', 'codex'],
            agentNoop: [],
        });
        expect(outcome.status).toBe('done');
        const primary = traceAction(outcome.runId, 'plan-translate', cwd);
        expect(primary?.completedAt).toBeDefined();
        const settled = Date.parse(String(primary?.completedAt));
        for (const nodeId of ['article-write', 'cover-brief', 'script-write']) {
            const reader = traceAction(outcome.runId, nodeId, cwd);
            expect(reader?.startedAt, `${nodeId} must have started`).toBeDefined();
            expect(
                Date.parse(String(reader?.startedAt)),
                `${nodeId} started before plan-translate settled`,
            ).toBeGreaterThanOrEqual(settled);
        }
        // The declared graph is the contract the engine enforces — validate it as well as observe it.
        const validation = Bun.spawnSync(['spur', 'workflow', 'validate', WORKFLOW, '--json'], { cwd: REPO });
        expect(validation.exitCode).toBe(0);
        const dag = loadDag();
        for (const nodeId of ['article-write', 'cover-brief', 'script-write']) {
            const node = dag.nodes.find((candidate) => candidate.id === nodeId);
            expect(node?.dependsOn, `${nodeId} must depend on both plan producers`).toContain('plan-translate-retry');
        }
        const article = dag.nodes.find((candidate) => candidate.id === 'article');
        for (const dep of ['plan-translate', 'plan-translate-retry', 'article-write', 'article-write-retry']) {
            expect(article?.dependsOn, `article must depend on ${dep}`).toContain(dep);
        }
    }, 180_000);

    it('declares the retry siblings on a different tier, with the same input and expectFile, no onError', () => {
        const dag = loadDag();
        for (const [primaryId, retryId] of [
            ['plan-translate', 'plan-translate-retry'],
            ['article-write', 'article-write-retry'],
        ] as const) {
            const primary = dag.nodes.find((node) => node.id === primaryId);
            const retry = dag.nodes.find((node) => node.id === retryId);
            expect(primary?.action?.onError, `${primaryId} must continue so the retry can decide`).toBe('continue');
            expect(retry, `${retryId} must be declared`).toBeDefined();
            // No onError on the retry: a second miss must fail the run loudly.
            expect(retry?.action?.onError).toBeUndefined();
            const primaryOptions = primary?.action?.options as Record<string, unknown> | undefined;
            const retryOptions = retry?.action?.options as Record<string, unknown> | undefined;
            expect(retryOptions?.input, `${retryId} must reuse the primary's prompt byte-for-byte`).toBe(
                primaryOptions?.input,
            );
            expect(retryOptions?.expectFile).toBe(primaryOptions?.expectFile);
            // 0238 P2: a cheap primary climbs to standard when its rung is unusable (ac5-live-1 landed
            // scribe on pi-deepseek), so a `coder` retry resolved to the SAME executor. The retry must
            // start two rungs above the primary — above any rung the primary reaches by one climb.
            const ladder = ['scribe', 'coder', 'reviewer', 'planner'];
            expect(retryOptions?.role).toBe('reviewer');
            expect(ladder.indexOf(String(retryOptions?.role))).toBeGreaterThanOrEqual(
                ladder.indexOf(String(primaryOptions?.role)) + 2,
            );
            expect(String(retryOptions?.agent)).toContain('agent_retry');
            expect(String(primaryOptions?.agent)).toContain('vars.agent');
        }
        expect(dag.vars?.agent_retry).toBeDefined();
    });

    it('guards every authoring agent with its own output, so a resume cannot re-author the script', () => {
        // A resume that re-runs an authoring agent rewrites the plan / script-plan and therefore the
        // VoiceScript text, which invalidates every cached audio section and (before this guard) could
        // leave `_08_script-write_plan.json` disagreeing with the script the stage then refuses.
        // `cover-brief` has always carried the pattern; the three authors must carry it too.
        const dag = loadDag();
        const guards: Record<string, string> = {
            'cover-brief': `test ! -f "\${vars.work_dir}/23-cover/\${vars.run_date}_07_cover_cover.png"`,
            // plan-translate guards on JSON validity (0238 R2 gate), not just existence.
            'plan-translate': `jq -e --argjson n "$(jq '.metadata.docs|length' "\${vars.work_dir}/21-plan/\${vars.run_date}_04_quality-control-content_candidates.json")" 'type=="array" and length==$n and all(.[];type=="object")' "\${vars.work_dir}/21-plan/\${vars.run_date}_03_plan_plan.json"`,
            'article-write': `! test -s "\${vars.work_dir}/22-article/\${vars.run_date}_06_article-write_body.md"`,
            'script-write': `! test -s "\${vars.work_dir}/24-script/\${vars.run_date}_08_script-write_plan.json"`,
        };
        for (const [id, guard] of Object.entries(guards)) {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(node, `${id} is missing`).toBeDefined();
            expect(node?.condition?.options?.command, `${id} must skip when its own output exists`).toContain(guard);
        }
    });
    it('chains the voice tier voxcpm -> gemini -> omni, each gated on a valid upstream Content', () => {
        // 2026-10-15 operator decision, reaffirmed 2026-10-20: voxcpm stays primary for its speed and
        // cost even though its long renders carry a measured 40 ms reflection and a 16-22 dB pause
        // floor; gemini is the dry escape hatch in the first fallback slot. The gates accept ANY upstream
        // plugin id (stage stamps metadata.generator + qc.passed), so a failed attempt can neither
        // be relabeled nor mixed into the episode, and a successful primary makes its siblings skip.
        const dag = loadDag();
        const nodes = ['generate', 'generate-fallback', 'generate-fallback2'].map((id) => {
            const node = dag.nodes.find((candidate) => candidate.id === id);
            expect(node, `${id} is missing`).toBeDefined();
            if (!node) throw new Error(`${id} is missing`);
            return node;
        });
        // The primary reads vars.vdriver, so the default is a one-var switch; the fallbacks pin
        // the remaining order.
        const primary = nodes[0]?.action?.options?.command ?? '';
        expect(primary).toContain('vars.vdriver');
        expect(primary).not.toContain('"gemini"');
        expect(nodes[1]?.action?.options?.command).toContain('"gemini"');
        expect(dag.vars?.vdriver).toBe('voxcpm');
        expect(nodes[2]?.action?.options?.command).toContain('"ominivoice"');
        expect(nodes[2]?.action?.options?.command).toContain('OMNIVOICE_SPEED=1.06');
        expect(nodes[1]?.dependsOn).toContain('generate');
        expect(nodes[2]?.dependsOn).toContain('generate-fallback');
        expect(nodes[0]?.action?.onError).toBe('continue');
        expect(nodes[1]?.action?.onError).toBe('continue');
        expect(nodes[2]?.action?.onError).toBeUndefined();
        expect(nodes[1]?.condition?.options?.command).toContain('kk:voxcpm-tts');
        expect(nodes[1]?.condition?.options?.command).toContain('kk:gemini-tts');
        expect(nodes[1]?.condition?.options?.command).not.toContain('kk:omni-voice-gen');
        expect(nodes[2]?.condition?.options?.command).toContain('kk:omni-voice-gen');
        expect(nodes[2]?.condition?.options?.command).toContain('qc.passed');
        const intro = dag.nodes.find((candidate) => candidate.id === 'intro');
        for (const id of ['generate', 'generate-fallback', 'generate-fallback2']) {
            expect(intro?.dependsOn, `intro must wait for ${id}`).toContain(id);
        }
    });

    it('audits the finished episode for speaker consistency, advisory-only', () => {
        // 2026-10-15: an instruct-mode profile shipped 59 different speakers and only a human
        // listening caught it. The node reports; it must never be able to fail the run.
        const node = loadDag().nodes.find((candidate) => candidate.id === 'voice-audit');
        expect(node, 'voice-audit node is missing').toBeDefined();
        if (!node) throw new Error('voice-audit node is missing');
        expect(node.dependsOn).toContain('intro');
        expect(node.condition?.options?.command).toContain('_11_generate_content.json');
        expect(node.action?.options?.command).toContain('kk stage daily-voice-audit');
        expect(node.action?.options?.onError).toBe('continue');
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
        expect(called(outcome, 'store mark-published')).toBe(false);
        // run-report and ledger list `extract` in dependsOn, so they still ran.
        expect(called(outcome, 'daily run-report')).toBe(true);
        expect(called(outcome, 'ledger sync')).toBe(true);
        const summary = readFileSync(join(outcome.workDir, 'run-report.summary.txt'), 'utf-8');
        expect(summary).toContain('no-content');
        expect(readFileSync(join(outcome.workDir, '20261007_19_run-report_report.md'), 'utf-8')).toContain(
            'no content',
        );
        // The ledger is the final call of the run.
        expect(outcome.log[outcome.log.length - 1]).toContain('ledger sync');
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
        // 0228 R6b: a dry run (publish_enabled=false) must NOT promote its rows — the guard refuses,
        // so they stay `selected` and still exclude the next day.
        expect(called(outcome, 'store mark-published')).toBe(false);
        expect(called(outcome, 'ledger sync')).toBe(true);
        // Ordering: extract → plan → qc-content → … → run-report → ledger.
        const order = outcome.log.map((line) => line.split(' ').slice(0, 3).join(' '));
        const index = (needle: string): number => order.findIndex((line) => line.includes(needle));
        expect(index('stage daily-extract')).toBeLessThan(index('stage daily-plan'));
        expect(index('stage daily-plan')).toBeLessThan(index('stage daily-qc-content'));
        expect(index('daily run-report')).toBeLessThan(index('ledger sync'));
        saveArtifact(`${outcome.runId}-calls.log`, outcome.log.join('\n'));
    }, 120_000);
});

describe('kk daily — the DAG nodes’ commands', () => {
    /** Run `kk …` in-process, returning the exit code plus the captured echo/echoError output. */
    async function run(args: string[], cwd?: string): Promise<{ code: number; out: string; err: string }> {
        const previous = process.cwd();
        // `daily prepare` writes `.spur/runs/<workflow>/work-dir.txt` relative to the cwd, so a test
        // that runs it from the repo root rewrites (and can delete) the real anchor the DAG reads —
        // it clobbered a live run's anchor on 2026-10-12.
        if (cwd !== undefined) process.chdir(cwd);
        const capture = captureOutput();
        try {
            const code = await main(['node', 'kk', ...args]);
            return { code, out: capture.read(), err: capture.readErr() };
        } finally {
            capture.restore();
            process.chdir(previous);
        }
    }

    it('prepare composes the workspace and writes both fixed anchors', async () => {
        const dir = tempDir('kk-daily-prepare-');
        const result = await run(
            [
                'daily',
                'prepare',
                '--workflow',
                'kk-daily-ai-voice2',
                '--run-date',
                '2026-10-07',
                '--work-dir',
                join(dir, 'w'),
            ],
            dir,
        );
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

    it('publish-classify fold-tail reflects cms-resync in terminal completeness (0220 AC5)', async () => {
        const dir = tempDir('kk-daily-classify-fold-');
        const publish = join(dir, '31-publish');
        mkdirSync(publish, { recursive: true });
        writeFileSync(
            join(publish, '20261007_14_publish-surfdash_result.json'),
            JSON.stringify({ targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] }),
        );
        writeFileSync(
            join(publish, '20261007_16_publish-podcast_result.json'),
            JSON.stringify({ targets: [{ target: 'podcast-pub', ok: true, status: 'published' }] }),
        );
        writeFileSync(
            join(publish, '20261007_23_patch-surfdash_sync-result.json'),
            JSON.stringify({ ok: true, target: 'surfdash' }),
        );
        const result = await run([
            'daily',
            'publish-classify',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--fold-tail',
        ]);
        expect(result.code).toBe(0);
        // stdout stays a single JSON line
        const lines = result.out.trim().split('\n');
        expect(lines.length).toBe(1);
        const parsed = JSON.parse(lines[0] ?? '{}') as { status: string; missing: string[] };
        expect(parsed.status).toBe('full');
        expect(parsed.missing).not.toContain('cms-resync');
    });

    it('publish-classify snapshots completeness after the folded patch writes its own artifact (0220 AC5)', async () => {
        // The seeded case above passes under either order; this one does not. The folded
        // daily-patch-surfdash writes the emdash-resync skip marker itself when it runs offline, so
        // only a snapshot taken after the fold sees cms-resync=skipped. KK_SURFDASH_PATCH_OFFLINE is
        // the hermetic switch: online, the stage delegates to the surfdash-pub `patch` operation,
        // which commits into the checkout (2026-10-12 boundary move).
        process.env.KK_SURFDASH_PATCH_OFFLINE = '1';
        const dir = tempDir('kk-daily-classify-order-');
        const surfdash = join(dir, 'surfdash');
        mkdirSync(surfdash, { recursive: true });
        for (const args of [
            ['init', '-q', '-b', 'main'],
            ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'],
        ]) {
            expect(Bun.spawnSync(['git', '-C', surfdash, ...args]).exitCode).toBe(0);
        }
        const publish = join(dir, '31-publish');
        mkdirSync(publish, { recursive: true });
        writeFileSync(
            join(publish, '20261007_14_publish-surfdash_result.json'),
            JSON.stringify({
                targets: [
                    {
                        target: 'surfdash-pub',
                        ok: true,
                        status: 'published',
                        metadata: { postPath: join(surfdash, 'articles/zh/post/index.md') },
                    },
                ],
            }),
        );
        writeFileSync(
            join(publish, '20261007_16_publish-podcast_result.json'),
            JSON.stringify({ targets: [{ target: 'podcast-pub', ok: true, status: 'published' }] }),
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
            surfdash,
        ]);
        expect(result.code).toBe(0);
        expect(existsSync(join(publish, '20261007_23_patch-surfdash_emdash-resync.txt'))).toBe(true);
        const completeness = JSON.parse(
            readFileSync(join(publish, '20261007_17_publish_completeness.json'), 'utf-8'),
        ) as { rows: { channel: string; state: string }[] };
        expect(completeness.rows.find((row) => row.channel === 'cms-resync')?.state).toBe('skipped');
        delete process.env.KK_SURFDASH_PATCH_OFFLINE;
    });
});
