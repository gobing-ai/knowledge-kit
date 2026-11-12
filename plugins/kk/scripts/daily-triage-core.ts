/**
 * Triage collector for failed daily runs (0347 F2/F3, 2026-11-10).
 *
 * A daily-run failure used to cost a 45-call forensic session across six stores before anyone
 * could name the layer (2026-11-09: two interleaved causes — a stale working-tree workflow and a
 * quota-dead executor chain). This module gathers the evidence the first five minutes actually
 * need, at failure time, into one structure:
 *
 *  - which workflow bytes executed (current checkout file + sha + git dirty flag on harness paths),
 *  - the last failed node from the parent trace, with the executor's partial-output tail,
 *  - nested runs (the safety machine) found by time-window + workflow name, with per-node receipts,
 *  - the engine escalation decision, and rule-based suggestions that name the next action.
 *
 * Pure parsing helpers are exported for tests; IO helpers are thin and never throw — a triage
 * that cannot collect must not mask the original failure it is describing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface TriageReceipt {
    status?: string;
    startedAt?: string;
    completedAt?: string;
    workDir?: string;
    agent?: string;
    retryAgent?: string;
    exitCode?: number;
    error?: string | null;
}

export interface ExecutedDefinition {
    workflow: string;
    path: string;
    sha256: string | null;
    gitDirty: string[];
}

export interface FailedNode {
    id: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    stderrTail?: string;
}

export interface NestedRun {
    runId: string;
    workflow?: string;
    status?: string;
    terminalState?: string;
    startedAt?: string;
    finalizedAt?: string;
    receipts: { node: string; ok: boolean; outcome?: string; reason?: string }[];
}

export interface TriageReport {
    runId: string;
    collectedAt: string;
    receipt: TriageReceipt | null;
    executed: ExecutedDefinition | null;
    failedNode: FailedNode | null;
    nestedRuns: NestedRun[];
    escalation: { trigger?: string; decision?: string; reason?: string; createdAt?: string } | null;
    suggestions: string[];
}

const RECEIPTS_DIR = join('.spur', 'run');
/** When the failed-node text names no nested workflow, assume the daily safety machine. */
const WORKFLOW_NESTED_FALLBACK = 'kk-daily-safety';
const RUNS_DIR = join('.spur', 'memory', 'runs');
const WORKS_FLOW_DIR = join('.works', 'kk-daily-ai-voice2');
const FAILED_RECEIPT_STATUSES = new Set(['failed', 'timed-out', 'interrupted', 'incomplete', 'preflight-refused']);
/** Receipt statuses that mean the supervisor is mid-flight, not failed. */
const ACTIVE_RECEIPT_STATUSES = new Set(['running', 'inspecting']);
const GOOD_RECEIPT_STATUSES = new Set(['done', 'no-content']);
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ANSI ESC control char is the point of the stripper
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function readText(path: string): string | null {
    try {
        return readFileSync(path, 'utf-8');
    } catch {
        return null;
    }
}

function readTriageJson(path: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
        return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function sha256File(path: string): string | null {
    try {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    } catch {
        return null;
    }
}

/** Harness paths whose dirty state invalidated the 2026-11-09 04:30 run (R1). */
export function gitDirtyPaths(repo: string): string[] {
    const result = spawnSync('git', ['status', '--porcelain', '--', 'plugins/kk', '.spur/workflows'], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 10_000,
    });
    if (result.status !== 0) return [];
    return result.stdout
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
}

export interface ParsedTrace {
    workflow?: string;
    status?: string;
    startedAt?: string;
    finalizedAt?: string;
    failedNode: FailedNode | null;
}

/** Extract the last failed action event from a `spur workflow trace --json` payload. */
export function parseTrace(stdout: string): ParsedTrace {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
        return { failedNode: null };
    }
    const run = (parsed.run ?? null) as Record<string, unknown> | null;
    const events = Array.isArray(parsed.events) ? (parsed.events as Record<string, unknown>[]) : [];
    let failedNode: FailedNode | null = null;
    for (const event of events) {
        if (event.kind !== 'action') continue;
        const status = String(event.status ?? '');
        if (status === 'done' || status === 'succeeded' || status === 'skipped') continue;
        const id = typeof event.node === 'string' ? event.node : '';
        if (id === '') continue;
        failedNode = {
            id,
            status,
            ...(typeof event.startedAt === 'string' ? { startedAt: event.startedAt } : {}),
            ...(typeof event.completedAt === 'string' ? { completedAt: event.completedAt } : {}),
            ...(typeof event.error === 'string' ? { stderrTail: event.error.slice(-400) } : {}),
        };
    }
    return {
        ...(run !== null && typeof run.workflowName === 'string' ? { workflow: run.workflowName } : {}),
        ...(run !== null && typeof run.status === 'string' ? { status: run.status } : {}),
        ...(run !== null && typeof run.startedAt === 'string' ? { startedAt: run.startedAt } : {}),
        ...(run !== null && typeof run.finalizedAt === 'string' ? { finalizedAt: run.finalizedAt } : {}),
        failedNode,
    };
}

function traceStderrTail(repo: string, runId: string, failedNode: FailedNode): string | undefined {
    if (failedNode.stderrTail) return failedNode.stderrTail;
    const partial = readText(join(repo, RECEIPTS_DIR, `${runId}-${failedNode.id}-partial.md`));
    if (partial === null) return undefined;
    return partial.replace(ANSI, '').trimEnd().slice(-400);
}

/** Nested runs overlap the parent's wall clock and are not the parent workflow itself. */
export function findNestedRuns(
    runsDir: string,
    parent: { runId: string; startedAt?: string; finalizedAt?: string; workflow?: string },
    workflowFilter: Set<string> | null = null,
): NestedRun[] {
    let entries: string[] = [];
    try {
        entries = readdirSync(runsDir).filter((name) => name.endsWith('.state.json'));
    } catch {
        return [];
    }
    const start = parent.startedAt ? Date.parse(parent.startedAt) : Number.NaN;
    const end = parent.finalizedAt ? Date.parse(parent.finalizedAt) : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end)) return [];
    const nested: NestedRun[] = [];
    for (const entry of entries) {
        const state = readTriageJson(join(runsDir, entry));
        if (state === null) continue;
        const runId = String(state.runId ?? basename(entry, '.state.json'));
        if (runId === '' || runId === parent.runId) continue;
        if (
            workflowFilter !== null &&
            (typeof state.workflowName !== 'string' || !workflowFilter.has(state.workflowName))
        )
            continue;
        const runStart = typeof state.startedAt === 'string' ? Date.parse(state.startedAt) : Number.NaN;
        if (Number.isNaN(runStart) || runStart < start - 1000 || runStart > end) continue;
        const receiptsDir = join(runsDir, '..', '..', '..', RECEIPTS_DIR, runId, 'receipts');
        const receipts: NestedRun['receipts'] = [];
        try {
            for (const file of readdirSync(receiptsDir)) {
                if (!file.endsWith('.json')) continue;
                const receipt = readTriageJson(join(receiptsDir, file));
                const outcome = receipt === null ? undefined : String(receipt.outcome ?? '');
                receipts.push({
                    node: basename(file, '.json'),
                    ok: outcome === 'succeeded' || outcome === 'done',
                    outcome,
                    ...(receipt !== null && typeof receipt.reason === 'string' ? { reason: receipt.reason } : {}),
                });
            }
        } catch {
            // No receipts dir: record the run without receipt detail.
        }
        nested.push({
            runId,
            ...(typeof state.workflowName === 'string' ? { workflow: state.workflowName } : {}),
            ...(typeof state.status === 'string' ? { status: state.status } : {}),
            ...(typeof state.terminalState === 'string' ? { terminalState: state.terminalState } : {}),
            ...(typeof state.startedAt === 'string' ? { startedAt: state.startedAt } : {}),
            ...(typeof state.finalizedAt === 'string' ? { finalizedAt: state.finalizedAt } : {}),
            receipts,
        });
    }
    return nested.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
}

/** Rule-based next actions, most specific first. Evidence: executor reasons + failed-node stderr. */
export function suggestionsFor(report: Omit<TriageReport, 'suggestions' | 'collectedAt' | 'runId'>): string[] {
    const evidence = [
        report.failedNode?.stderrTail ?? '',
        ...report.nestedRuns.flatMap((run) => run.receipts.map((receipt) => receipt.reason ?? '')),
        report.receipt?.error ?? '',
    ]
        .join('\n')
        .toLowerCase();
    const suggestions: string[] = [];
    if (
        /accountquotaexceeded|monthly usage quota|weekly limit|no credits remaining|invalid credential/.test(evidence)
    ) {
        suggestions.push(
            'executor account exhausted (quota/credits/credential) — probe healthy executors (spur agent run --agent <name> "Reply with exactly: OK"), switch the schedule entry to a healthy pair, and rerun; preflight will refuse the day otherwise',
        );
    } else if (/exit code 3|exhausted/.test(evidence)) {
        suggestions.push(
            'agent executor outage — verify the primary/retry executors, then rerun; the 07:00 retrigger retries automatically once the receipt is failed',
        );
    }
    if (/plan item count/.test(evidence)) {
        suggestions.push(
            'script/article section divergence — move aside 21-plan/<date>_03_plan_plan.json, 21-plan/<date>_03_curate_excluded.json, 24-script/<date>_08_script-write_plan.json and 24-script/<date>_08_script_voicescript.yaml so curate re-splits consistently, then rerun',
        );
    }
    if (report.nestedRuns.some((run) => run.terminalState === 'infra-fail')) {
        suggestions.push(
            'safety reached infra-fail — the gate refused for missing evidence (executor outage), not a content verdict; recover executors and rerun',
        );
    } else if (report.nestedRuns.some((run) => run.terminalState === 'block')) {
        suggestions.push(
            'safety verdict block — inspect the 09_safety-* artifacts (report/verdict/status) under the scope dir before any rerun',
        );
    }
    if (report.executed !== null && report.executed.gitDirty.length > 0) {
        suggestions.push(
            `harness paths are dirty right now (${report.executed.gitDirty.slice(0, 3).join(', ')}) — the NEXT scheduled run executes the working tree; commit or stash first`,
        );
    }
    if (suggestions.length === 0) {
        suggestions.push('inspect the failed node stderr and nested receipts, then decide');
    }
    return suggestions;
}

/** Collect everything knowable about one failed run. Never throws for missing pieces. */
export function collectTriage(
    repo: string,
    runId: string,
    opts: { receiptPath?: string; receipt?: TriageReceipt; workflow?: string; env?: NodeJS.ProcessEnv } = {},
): TriageReport {
    const report: TriageReport = {
        runId,
        collectedAt: new Date().toISOString(),
        receipt: null,
        executed: null,
        failedNode: null,
        nestedRuns: [],
        escalation: null,
        suggestions: [],
    };
    if (opts.receipt !== undefined) {
        report.receipt = opts.receipt;
    } else {
        const receiptPath = opts.receiptPath ?? findReceiptByRunId(repo, runId);
        if (receiptPath !== null) {
            const raw = readTriageJson(receiptPath);
            if (raw !== null) {
                report.receipt = {
                    ...(typeof raw.status === 'string' ? { status: raw.status } : {}),
                    ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
                    ...(typeof raw.completedAt === 'string' ? { completedAt: raw.completedAt } : {}),
                    ...(typeof raw.workDir === 'string' ? { workDir: raw.workDir } : {}),
                    ...(typeof raw.agent === 'string' ? { agent: raw.agent } : {}),
                    ...(typeof raw.retryAgent === 'string' ? { retryAgent: raw.retryAgent } : {}),
                    ...(typeof raw.exitCode === 'number' ? { exitCode: raw.exitCode } : {}),
                    ...(typeof raw.error === 'string' || raw.error === null
                        ? { error: raw.error as string | null }
                        : {}),
                };
            }
        }
    }
    const trace = spawnSync('spur', ['--no-logo', 'workflow', 'trace', runId, '--json'], {
        cwd: repo,
        encoding: 'utf-8',
        timeout: 20_000,
        // opts.env layers over the inherited environment (tests shim `spur` through PATH).
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
    });
    if (trace.status === 0 && trace.stdout.trim() !== '') {
        const parsed = parseTrace(trace.stdout);
        const workflow = opts.workflow ?? parsed.workflow ?? '';
        report.failedNode = parsed.failedNode;
        if (report.failedNode !== null) {
            report.failedNode.stderrTail = traceStderrTail(repo, runId, report.failedNode);
        }
        const workflowFile = join(repo, 'plugins', 'kk', 'workflows', `${workflow}.yaml`);
        if (workflow !== '' && existsSync(workflowFile)) {
            report.executed = {
                workflow,
                path: workflowFile,
                sha256: sha256File(workflowFile),
                gitDirty: gitDirtyPaths(repo),
            };
        }
        // Nested machines are the ones the parent's failing command itself names (…\.yaml); a bare
        // time-window scan also catches neighbor jobs (kk-collect, wrapup pipelines) that merely
        // overlapped the parent's wall clock.
        const nestedNames = new Set(
            (report.failedNode?.stderrTail ?? '').match(/[\w.-]+\.yaml/g)?.map((file) => file.replace(/\.yaml$/, '')) ??
                [],
        );
        report.nestedRuns = findNestedRuns(
            join(repo, RUNS_DIR),
            {
                runId,
                startedAt: parsed.startedAt,
                finalizedAt: parsed.finalizedAt,
                workflow: workflow || undefined,
            },
            nestedNames.size > 0 ? nestedNames : new Set([WORKFLOW_NESTED_FALLBACK]),
        );
    }
    const escalation = readTriageJson(join(repo, RECEIPTS_DIR, `${runId}-escalation.json`));
    if (escalation !== null) {
        const decision = (escalation.decision ?? null) as Record<string, unknown> | null;
        report.escalation = {
            ...(typeof escalation.trigger === 'string' ? { trigger: escalation.trigger } : {}),
            ...(decision !== null && typeof decision.kind === 'string' ? { decision: decision.kind } : {}),
            ...(decision !== null && typeof decision.reason === 'string' ? { reason: decision.reason } : {}),
            ...(typeof escalation.createdAt === 'string' ? { createdAt: escalation.createdAt } : {}),
        };
    }
    report.suggestions = suggestionsFor({
        receipt: report.receipt,
        executed: report.executed,
        failedNode: report.failedNode,
        nestedRuns: report.nestedRuns,
        escalation: report.escalation,
    });
    return report;
}

/** The five lines an operator reads before deciding anything else. */
export function summarizeTriage(report: TriageReport): string[] {
    const receipt = report.receipt;
    const line1 =
        receipt !== null
            ? `trigger: ${receipt.status ?? '?'} (exit ${receipt.exitCode ?? '?'}) completedAt=${receipt.completedAt ?? '?'} agent=${receipt.agent ?? '?'}`
            : `trigger: unknown (no receipt found for ${report.runId})`;
    const executed = report.executed;
    const line2 =
        executed !== null
            ? `executed: ${executed.workflow} sha256=${executed.sha256?.slice(0, 8) ?? '?'} harnessDirty=${executed.gitDirty.length}`
            : 'executed: unknown (trace unavailable)';
    const failed = report.failedNode;
    const line3 =
        failed !== null
            ? `failed node: ${failed.id} (${failed.status})${
                  failed.stderrTail ? ` — ${failed.stderrTail.split('\n').slice(-1)[0]?.slice(0, 140) ?? ''}` : ''
              }`
            : 'failed node: not identified from trace';
    const nested = report.nestedRuns;
    const line4 =
        nested.length > 0
            ? nested
                  .map((run) => {
                      const bad = run.receipts.filter((receipt) => !receipt.ok).length;
                      return `${run.workflow ?? '?'}:${run.terminalState ?? run.status ?? '?'} receipts ${run.receipts.length - bad}/${run.receipts.length} ok (${run.runId.slice(0, 8)})`;
                  })
                  .join('; ')
            : 'nested: none';
    return [line1, line2, line3, line4, `suggestion: ${report.suggestions[0] ?? '?'}`];
}

/** Locate the schedule receipt for a run id across the voice2 works root (stamps newest first). */
export function findReceiptByRunId(repo: string, runId: string): string | null {
    const root = join(repo, WORKS_FLOW_DIR);
    let stamps: string[] = [];
    try {
        stamps = readdirSync(root).filter((name) => /^\d{8}$/.test(name));
    } catch {
        return null;
    }
    for (const stamp of stamps.reverse()) {
        const receiptPath = join(root, stamp, 'schedule-receipt.json');
        const receipt = readTriageJson(receiptPath);
        if (receipt !== null && receipt.runId === runId) return receiptPath;
    }
    return null;
}

/** Newest failed daily-run receipt across the voice2 works root, for `daily-triage --latest`. */
export function latestFailedRun(repo: string): { runId: string; receiptPath: string } | null {
    const root = join(repo, WORKS_FLOW_DIR);
    let stamps: string[] = [];
    try {
        stamps = readdirSync(root).filter((name) => /^\d{8}$/.test(name));
    } catch {
        return null;
    }
    const candidates: { runId: string; receiptPath: string; completedAt: number }[] = [];
    for (const stamp of stamps.reverse()) {
        const receiptPath = join(root, stamp, 'schedule-receipt.json');
        const receipt = readTriageJson(receiptPath);
        if (receipt === null || typeof receipt.status !== 'string') continue;
        if (!FAILED_RECEIPT_STATUSES.has(receipt.status)) continue;
        const completedAt =
            typeof receipt.completedAt === 'string' ? Date.parse(receipt.completedAt) : statSync(receiptPath).mtimeMs;
        candidates.push({
            runId: typeof receipt.runId === 'string' ? receipt.runId : `${stamp}-unknown`,
            receiptPath,
            completedAt: Number.isNaN(completedAt) ? 0 : completedAt,
        });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.completedAt - a.completedAt);
    return candidates[0] ?? null;
}

export const TRIAGE_FAILED_RECEIPT_STATUSES = FAILED_RECEIPT_STATUSES;
export const TRIAGE_GOOD_RECEIPT_STATUSES = GOOD_RECEIPT_STATUSES;
export const TRIAGE_ACTIVE_RECEIPT_STATUSES = ACTIVE_RECEIPT_STATUSES;
