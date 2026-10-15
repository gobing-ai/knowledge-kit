/**
 * `kk ledger` rendering core — the pure half of the run ledger (task 0207).
 *
 * Everything here is a pure function of the `spur workflow trace --json` payload:
 * no file IO, no process spawn, no clock. `apps/cli/src/commands/ledger.ts` owns the
 * spawn and the writes, so the markdown contract can be pinned by fixtures.
 *
 * The ledger is append-only and idempotent by run id: the `<!-- run:<id> -->` marker
 * R2 emits is also the key `ledgerHasRun` reads (see docs/design/kk-collect-and-daily-voice2.md §7).
 */

/** Reasons a ledger operation can fail; the code contract is `kk.ledger.<reason>`. */
export type LedgerReason =
    | 'trace.invalid'
    | 'trace.not-found'
    | 'trace.spawn-failed'
    | 'run.running'
    | 'list.invalid'
    | 'workflow.invalid'
    | 'write.failed';

/** Failure raised by the ledger core; `code` carries the `kk.ledger.<reason>` contract. */
export class LedgerError extends Error {
    readonly reason: LedgerReason;

    constructor(reason: LedgerReason, detail?: string) {
        super(`kk.ledger.${reason}${detail === undefined ? '' : `: ${detail}`}`);
        this.name = 'LedgerError';
        this.reason = reason;
    }

    /** Operator-facing error code, `kk.ledger.<reason>`. */
    get code(): string {
        return `kk.ledger.${this.reason}`;
    }
}

/** Token totals as `spur workflow trace` emits them under `cost.exact` / `cost.estimated`. */
export interface TraceCostTotals {
    inputTokens: number;
    outputTokens: number;
}

/** One cost attribution class — present only for `agent.run` actions spur could join. */
export interface TraceCost {
    totals: TraceCostTotals;
}

/** Exact vs estimated attribution. Estimated figures are never rendered (AC2). */
export interface TraceCostAttribution {
    exact: TraceCost | null;
    estimated: TraceCost | null;
}

/** One `spur workflow trace` timeline event; only `kind: "action"` events feed the table. */
export interface TraceActionEvent {
    kind: string;
    node?: string;
    actionKind?: string;
    status?: string;
    durationMs?: number | null;
    ok?: boolean;
    error?: string | null;
    cost?: TraceCostAttribution | null;
}

/** The per-run trace payload (`spur workflow trace <run-id> --json`). */
export interface TraceRun {
    runId: string;
    workflowName?: string;
    status: string;
    startedAt: string;
    completedAt?: string | null;
    durationMs?: number | null;
    outcome?: string;
}

/** The per-run trace payload (`spur workflow trace <run-id> --json`). */
export interface TraceJson {
    run: TraceRun;
    events: TraceActionEvent[];
}

/** One `spur workflow trace --workflow <name> --json` list entry. */
export interface TraceListEntry {
    runId: string;
    workflowName?: string;
    status?: string;
    startedAt?: string;
    /** `--dry-run` launches record `done` with no steps; they are rehearsals, not executions. */
    isDryRun?: boolean;
}

/** Options for {@link renderLedgerSection}. */
export interface LedgerRenderOptions {
    /** `<node>.summary.txt` first lines, keyed by step node — read by the command from `--work-dir`. */
    summaries?: ReadonlyMap<string, string>;
}

/** Longest rendered result cell (R5). */
const MAX_RESULT_CHARS = 120;
/** Token table cell for a step with no agent action (R4). */
const NO_TOKENS_CELL = '—';
/** Token table cell for an agent step whose usage spur could not report exactly (R4/AC2). */
const UNKNOWN_TOKENS_CELL = 'unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the trace payload R1 reads. Missing `run` or `events` is a contract
 * violation, not an empty ledger row — the caller maps it to `kk.ledger.trace.invalid`.
 */
export function parseTrace(raw: unknown): TraceJson {
    if (!isRecord(raw) || !isRecord(raw.run) || typeof raw.run.runId !== 'string' || !Array.isArray(raw.events)) {
        throw new LedgerError('trace.invalid', 'expected { run: { runId }, events: [] }');
    }
    if (typeof raw.run.status !== 'string') {
        throw new LedgerError('trace.invalid', `run ${raw.run.runId} carries no status`);
    }
    return { run: raw.run as unknown as TraceRun, events: raw.events as TraceActionEvent[] };
}

/** Validate the list payload `kk ledger sync` reads; `list.invalid` when `.entries` is absent. */
export function parseTraceList(raw: unknown): TraceListEntry[] {
    if (!isRecord(raw) || !Array.isArray(raw.entries)) {
        throw new LedgerError('list.invalid', 'expected { entries: [] }');
    }
    return raw.entries.filter((entry): entry is TraceListEntry => isRecord(entry) && typeof entry.runId === 'string');
}

/**
 * Parse the raw stdout of `spur workflow trace <run-id> --json` into a validated trace
 * (R7: a payload without `run`/`events` is `kk.ledger.trace.invalid`).
 *
 * The JSON decode lives here rather than in the command module: the CLI surface rule
 * `cli-no-parse-at-module-scope` bans a bare `JSON.parse(` token under `commands/*.ts`
 * (it cannot tell `JSON.parse` from `program.parse`), so commands get this text form.
 */
export function parseTraceJson(text: string): TraceJson {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new LedgerError('trace.invalid', 'spur workflow trace did not return JSON');
    }
    return parseTrace(raw);
}

/** Same, for the `--workflow` list form: `{ entries: [...] }` (R6). */
export function parseTraceListJson(text: string): TraceListEntry[] {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new LedgerError('list.invalid', 'spur workflow trace --workflow did not return JSON');
    }
    return parseTraceList(raw);
}

/** `# <workflow> ledger` — the file heading written when the ledger does not exist yet (R1). */
export function ledgerHeading(workflow: string): string {
    return `# ${workflow} ledger`;
}

/** True when the markdown already records `runId` (the `<!-- run:<id> -->` marker, R2/R6). */
export function ledgerHasRun(markdown: string, runId: string): boolean {
    return markdown.includes(`<!-- run:${runId} -->`);
}

/** `durationMs` as `XhYmZs`, leading zero units dropped (`41m12s`, `1h02m03s`, `0s`). */
export function formatDuration(durationMs: number | null | undefined): string {
    const totalSeconds =
        typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
            ? Math.floor(durationMs / 1000)
            : 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h${String(minutes).padStart(2, '0')}m${String(seconds).padStart(2, '0')}s`;
    }
    if (minutes > 0) {
        return `${minutes}m${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

/** Step node names in first-seen order — also the set of `<node>.summary.txt` files to look for. */
export function traceNodes(trace: TraceJson): string[] {
    return stepGroups(trace).map((group) => group.node);
}

interface StepGroup {
    node: string;
    actions: TraceActionEvent[];
}

function stepGroups(trace: TraceJson): StepGroup[] {
    const groups: StepGroup[] = [];
    const byNode = new Map<string, StepGroup>();
    for (const event of trace.events) {
        if (event.kind !== 'action' || typeof event.node !== 'string') {
            continue;
        }
        let group = byNode.get(event.node);
        if (group === undefined) {
            group = { node: event.node, actions: [] };
            byNode.set(event.node, group);
            groups.push(group);
        }
        group.actions.push(event);
    }
    return groups;
}

function actionFailed(action: TraceActionEvent): boolean {
    return action.ok === false || action.status === 'failed';
}

/** `XhYmZs` of the workflow's own start instant; `trace.invalid` when it is not a timestamp. */
function utcMinute(startedAt: string): string {
    const started = new Date(startedAt);
    if (Number.isNaN(started.getTime())) {
        throw new LedgerError('trace.invalid', `startedAt is not a timestamp: ${startedAt}`);
    }
    return `${started.toISOString().slice(0, 16)}Z`;
}

/** First line only, pipes escaped, cut to {@link MAX_RESULT_CHARS} — a markdown table cell (R5). */
function resultCell(value: string): string {
    const firstLine = value.split('\n', 1)[0] ?? '';
    return firstLine.replace(/\|/g, '\\|').slice(0, MAX_RESULT_CHARS);
}

interface StepRow {
    node: string;
    status: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    unknownTokens: boolean;
    hasAgentAction: boolean;
    result: string;
}

function stepRow(group: StepGroup, summaries: ReadonlyMap<string, string> | undefined): StepRow {
    const failingAction = group.actions.find(actionFailed);
    const agentActions = group.actions.filter((action) => action.actionKind === 'agent.run');
    // R4/AC2: only `cost.exact` is a reported figure. An absent cost — or an exact class that is
    // null while `estimated` exists — is unreported usage, rendered `unknown`, never estimated.
    const unknownTokens = agentActions.some((action) => action.cost?.exact == null);
    const summary = summaries?.get(group.node);
    const fallback = failingAction?.error;
    const result = summary !== undefined ? summary : typeof fallback === 'string' && fallback !== '' ? fallback : 'ok';

    return {
        node: group.node,
        status: failingAction === undefined ? (group.actions.at(-1)?.status ?? 'unknown') : 'failed',
        durationMs: group.actions.reduce((total, action) => total + (action.durationMs ?? 0), 0),
        inputTokens: unknownTokens
            ? 0
            : agentActions.reduce((total, action) => total + (action.cost?.exact?.totals.inputTokens ?? 0), 0),
        outputTokens: unknownTokens
            ? 0
            : agentActions.reduce((total, action) => total + (action.cost?.exact?.totals.outputTokens ?? 0), 0),
        unknownTokens,
        hasAgentAction: agentActions.length > 0,
        result: resultCell(result),
    };
}

function tokenCells(row: StepRow): string {
    if (!row.hasAgentAction) {
        return NO_TOKENS_CELL;
    }
    if (row.unknownTokens) {
        return UNKNOWN_TOKENS_CELL;
    }
    return `${row.inputTokens}/${row.outputTokens}`;
}

/**
 * Render one run's ledger section: heading, idempotency marker, and the per-step table
 * (`| Step | Status | Duration | Tokens in/out | Result |`). Rows follow the trace's
 * first-seen node order; several actions of one node collapse into one row (R2/R3/R4/R5).
 */
export function renderLedgerSection(trace: TraceJson, options: LedgerRenderOptions = {}): string {
    const rows = stepGroups(trace).map((group) => stepRow(group, options.summaries));
    const unknownSteps = rows.filter((row) => row.unknownTokens).length;
    const inputTokens = rows.reduce((total, row) => total + (row.hasAgentAction ? row.inputTokens : 0), 0);
    const outputTokens = rows.reduce((total, row) => total + (row.hasAgentAction ? row.outputTokens : 0), 0);

    return [
        `## ${utcMinute(trace.run.startedAt)} · run ${trace.run.runId.slice(0, 8)} · ${trace.run.status} · ${formatDuration(trace.run.durationMs)} · tokens: ${inputTokens}/${outputTokens} (+${unknownSteps} unknown)`,
        `<!-- run:${trace.run.runId} -->`,
        '',
        '| Step | Status | Duration | Tokens in/out | Result |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(
            (row) =>
                `| ${row.node} | ${row.status} | ${formatDuration(row.durationMs)} | ${tokenCells(row)} | ${row.result} |`,
        ),
    ].join('\n');
}

/**
 * Append `section` to the existing ledger document, creating the `# <workflow> ledger`
 * heading exactly once. Existing content is never rewritten (append-only invariant).
 */
export function appendLedgerSection(existing: string | null, workflow: string, section: string): string {
    const head =
        existing === null || existing.trim() === '' ? `${ledgerHeading(workflow)}\n` : `${existing.trimEnd()}\n`;
    return `${head}\n${section}\n`;
}

/**
 * Run ids from a `spur workflow trace --workflow <name> --json` list that the ledger is
 * missing, oldest first (R6). Still-`running` runs are never listed — they have no
 * completed row and `spur workflow trace <id>` would refuse them (R7). Dry runs are
 * skipped too: a 2026-10-13 `--dry-run` pair came back as two empty ledger sections,
 * which read as lost executions.
 */
export function selectMissingRuns(entries: readonly TraceListEntry[], markdown: string): string[] {
    return entries
        .filter(
            (entry) => entry.status !== 'running' && entry.isDryRun !== true && !ledgerHasRun(markdown, entry.runId),
        )
        .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? ''))
        .map((entry) => entry.runId);
}

// ---- cutover-check (task 0212 R1) ----

/** One `| Step | ... | Result |` row of a ledger section's step table. */
export interface LedgerStep {
    node: string;
    status: string;
    result: string;
}

/** One ledger section: a finished workflow run as the 0207 renderer wrote it. */
export interface LedgerRun {
    runId: string;
    /** Heading's UTC minute (`2026-10-07T14:05Z`); the same-day baseline pairing keys off this. */
    startedAt: string;
    status: string;
    steps: LedgerStep[];
}

/** `parseLedger` output: the run sections plus any headings that never became one. */
export interface ParsedLedger {
    runs: LedgerRun[];
    /** Section headings with no `<!-- run:... -->` marker, in file order (reported, never fatal). */
    malformed: string[];
}

/** Readiness verdict: exit 0 always — `ready` is the signal, `reasons` the evidence. */
export interface CutoverVerdict {
    ready: boolean;
    /** Newest consecutive `done` candidate runs. */
    streak: number;
    required: number;
    reasons: string[];
}

/** The candidate's classify node id; the legacy baseline spells it `publish`. */
const CLASSIFY_NODE = 'publish-classify';

/** One table row split into trimmed cells; escaped pipes (`\|`) survive the split. */
const ESCAPED_PIPE_SENTINEL = '\u0000';
function rowCells(row: string): string[] {
    const cells = row.replaceAll('\\|', ESCAPED_PIPE_SENTINEL).split('|');
    cells.shift();
    cells.pop();
    return cells.map((cell) => cell.replaceAll(ESCAPED_PIPE_SENTINEL, '|').trim());
}

/**
 * Parse the 0207 ledger format (`## <ts> · run <id> · <status> · ...` sections with a
 * `<!-- run:<id> -->` marker and a step table). A heading without its marker is malformed:
 * recorded in `.malformed`, never fatal — cutover-check is read-only and must keep answering.
 */
export function parseLedger(markdown: string): ParsedLedger {
    const runs: LedgerRun[] = [];
    const malformed: string[] = [];
    let heading: string | null = null;
    let headingText = '';
    let startedAt = '';
    let status = 'unknown';
    let runId: string | null = null;
    let steps: LedgerStep[] = [];
    const flush = (): void => {
        if (heading === null) {
            return;
        }
        if (runId === null) {
            malformed.push(headingText);
        } else {
            runs.push({ runId, startedAt, status, steps });
        }
        heading = null;
        runId = null;
        steps = [];
    };
    for (const line of markdown.split('\n')) {
        if (line.startsWith('## ')) {
            flush();
            const fields = line.slice(3).trim().split(' · ');
            heading = fields[0] ?? '';
            headingText = line.slice(3).trim();
            startedAt = heading;
            status = fields[2] ?? 'unknown';
            continue;
        }
        if (heading === null) {
            continue;
        }
        const marker = /<!-- run:(\S+) -->/.exec(line);
        if (marker !== null) {
            runId = marker[1] ?? '';
            continue;
        }
        if (line.startsWith('| ')) {
            const cells = rowCells(line);
            const [node, stepStatus, , , result] = cells;
            if (cells.length === 5 && node !== undefined && node !== 'Step' && !node.startsWith('-')) {
                steps.push({ node, status: stepStatus ?? 'unknown', result: result ?? '' });
            }
        }
    }
    flush();
    return { runs, malformed };
}

/** The run's classify step, under either node spelling. */
function classifyStep(run: LedgerRun): LedgerStep | undefined {
    return run.steps.find((step) => step.node === CLASSIFY_NODE || step.node === 'publish');
}

/**
 * The classify Result cell as a target-set signature (`full:2/2`), or null when the cell does
 * not carry one — pre-cutover ledgers hold `ok` there and cannot prove parity.
 */
export function classifyTargetSet(result: string): string | null {
    let raw: unknown;
    try {
        raw = JSON.parse(result);
    } catch {
        return null;
    }
    if (
        isRecord(raw) &&
        typeof raw.status === 'string' &&
        typeof raw.published === 'number' &&
        typeof raw.targets === 'number'
    ) {
        return `${raw.status}:${raw.published}/${raw.targets}`;
    }
    return null;
}

/**
 * The cutover criterion: the newest `runs` candidate sections are all `done` and each one's
 * classify target set matches the newest same-day baseline run's. Pure — the command folds in
 * file-level reasons (missing ledgers, malformed sections) on top.
 */
export function cutoverCheck(candidate: LedgerRun[], baseline: LedgerRun[], runs: number): CutoverVerdict {
    const verdict: CutoverVerdict = { ready: false, streak: 0, required: runs, reasons: [] };
    if (!Number.isInteger(runs) || runs < 1) {
        verdict.reasons.push(`args: --runs must be a positive integer, got ${runs}`);
        return verdict;
    }
    const ordered = [...candidate].sort(
        (left, right) => left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId),
    );
    for (let index = ordered.length - 1; index >= 0 && ordered[index]?.status === 'done'; index--) {
        verdict.streak++;
    }
    const window = ordered.slice(-runs);
    if (window.length < runs) {
        verdict.reasons.push(`candidate: ${window.length} of ${runs} required runs recorded`);
    }
    // Newest-first baseline runs per UTC day — the pairing partner of a candidate run.
    const byDay = new Map<string, LedgerRun[]>();
    for (const run of [...baseline].sort((left, right) => right.startedAt.localeCompare(left.startedAt))) {
        const day = run.startedAt.slice(0, 10);
        const peers = byDay.get(day);
        if (peers === undefined) {
            byDay.set(day, [run]);
        } else {
            peers.push(run);
        }
    }
    for (const run of window) {
        const short = run.runId.slice(0, 8);
        if (run.status !== 'done') {
            verdict.reasons.push(`candidate ${short}: run ${run.status}`);
        }
        const step = classifyStep(run);
        if (step === undefined) {
            verdict.reasons.push(`candidate ${short}: no classify step`);
            continue;
        }
        const mine = classifyTargetSet(step.result);
        if (mine === null) {
            verdict.reasons.push(`candidate ${short}: classify result is not a target set`);
            continue;
        }
        const day = run.startedAt.slice(0, 10);
        const peer = byDay.get(day)?.[0];
        if (peer === undefined) {
            verdict.reasons.push(`baseline: no ${day} run`);
            continue;
        }
        const peerStep = classifyStep(peer);
        const theirs = peerStep === undefined ? null : classifyTargetSet(peerStep.result);
        if (theirs === null) {
            verdict.reasons.push(`baseline ${peer.runId.slice(0, 8)}: no comparable target set`);
            continue;
        }
        if (mine !== theirs) {
            verdict.reasons.push(`${day}: target set mismatch candidate ${mine} vs baseline ${theirs}`);
        }
    }
    verdict.ready = verdict.reasons.length === 0 && window.length === runs && verdict.streak >= runs;
    return verdict;
}
