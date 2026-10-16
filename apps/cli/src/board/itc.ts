import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    RunCapture,
    RunResults,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import {
    type ArtifactObservation,
    descriptorFor,
    isTerminalStatus,
    markerDiagnostic,
    overallAvailability,
    type RunDetailSummary,
} from './collect';
import { isPublicHttpUrl } from './daily-voice';
import {
    type ArtifactSpec,
    artifactsFor,
    CONFIDENCE_LEVELS,
    type ConfidenceLevel,
    isConfidenceLevel,
    type MarkerState,
    type ProducerState,
    resolveAvailability,
} from './manifest';

/**
 * The IT Content projection: turn the selected run's captured record + artifact observations into
 * the reader's `RunResults` JSON.
 *
 * ITC is a state machine, so a producer is identified by its recorded `actionKey` (§9) and the
 * displayed revision counts come from recorded `draft-revise`/`draft-autorevise` VISITS — never the
 * mutable `.revise-count` files a new prepare resets. Per-target publish results are derived from
 * the run's own plan (target names are open-ended), and BOTH recorded Result shapes are parsed.
 * Anything the run did not record stays `unavailable`/unknown — never a zero.
 */

/** The content-judge confidence levels, re-exported from the manifest (its verdict owns the vocabulary). */
export { CONFIDENCE_LEVELS, type ConfidenceLevel, isConfidenceLevel } from './manifest';

/** A bounded outline/draft text preview, with the availability it was derived from. */
export interface ItcPreview {
    id: string;
    label: string;
    /** Bounded recorded text, or null when the artifact is not available. */
    text: string | null;
    availability: ArtifactDescriptor['availability'];
}

/** The judge verdict the run recorded, with anything out-of-vocabulary kept as an explicit unknown. */
export interface ItcJudge {
    verdict: string | null;
    /** A recognized level, or null when absent/out-of-vocabulary. */
    confidence: ConfidenceLevel | null;
    /** Bounded actionable revision notes, empty when none were recorded. */
    feedback: string[];
    /** True when the recorded `confidence` was present but not HIGH|MEDIUM|LOW. */
    confidenceInvalid: boolean;
}

/** Recorded revision visits and the run's revision budget. */
export interface ItcRevisions {
    /** Recorded `draft-revise` visits (interactive feedback rounds). */
    revise: number | null;
    /** Recorded `draft-autorevise` visits (the judge-driven loop). */
    autoRevise: number | null;
    /** `revise + autoRevise`, or null when no progress was recorded. */
    total: number | null;
    /** The configured revision cap (`max_revisions`), or 3 for the interactive bound. */
    budget: number | null;
    /** True only when the Board recorded a `states[]` progress projection. */
    recorded: boolean;
}

/** One publish target's recorded outcome. `ok: null` means the result was not recorded. */
export interface ItcTargetOutcome {
    target: string;
    transport: 'fanout' | 'browser';
    ok: boolean | null;
    url: string | null;
    error: string | null;
    /** Bounded recorded detail (e.g. `ok`, `failed`, `result missing`). */
    detail: string;
}

/** The typed ITC summary carried under `RunResults.summary`. */
export interface ItcSummary {
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    /** Known result outcome: `done` | `failed` | `declined` (from the report), else null. */
    outcome: string | null;
    outlines: ItcPreview[];
    selectedOutline: ItcPreview | null;
    draft: ItcPreview | null;
    judge: ItcJudge | null;
    revisions: ItcRevisions;
    targets: ItcTargetOutcome[];
    /** The final report's recorded outcome/verdict/revisions, or null when it was not recorded. */
    report: { outcome: string | null; verdict: string | null; revisions: number | null } | null;
    counts: {
        artifactsAvailable: number;
        artifactsTotal: number;
        targetsOk: number;
        targetsFailed: number;
        targetsUnknown: number;
    };
}

/** The plan group a per-target result spec belongs to. */
export type ItcResultGroup =
    | { kind: 'fanout'; variant: string; targets: string[] }
    | { kind: 'browser'; target: string };

/** One per-target result file derived from the run's plan (§9: names come from the plan, not the client). */
export interface ItcResultSpec {
    spec: ArtifactSpec;
    group: ItcResultGroup;
}

/** Characters of a text preview a Summary/Results row shows before it points at the artifact. */
const PREVIEW_CHARS = 240;

/** The names of the recorded revision loops. */
const REVISE_STATE = 'draft-revise';
const AUTOREVISE_STATE = 'draft-autorevise';

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
    if (raw === undefined) return null;
    try {
        return asRecord(JSON.parse(raw));
    } catch {
        return null;
    }
}

/** Bound a text preview for one summary row and report the truncation instead of hiding it. */
export function boundedPreview(text: string | null | undefined, max = PREVIEW_CHARS): string | null {
    if (text === null || text === undefined) return null;
    const flat = text.replaceAll(/\s+/g, ' ').trim();
    if (flat === '') return null;
    return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

/** The recognized confidence as a level, or null when absent/out-of-vocabulary (§9 judge gate contract). */
export function asJudgeConfidence(value: unknown): ConfidenceLevel | null {
    return isConfidenceLevel(value) && CONFIDENCE_LEVELS.includes(value) ? value : null;
}

/** True when a recorded `confidence` was present but not one of HIGH|MEDIUM|LOW. */
export function isOutOfVocabularyConfidence(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '' && !isConfidenceLevel(value);
}

/** Bounded actionable feedback notes from a verdict's `feedback[]`. */
function feedbackNotes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === 'string' ? boundedPreview(entry) : null))
        .filter((entry): entry is string => entry !== null);
}

/** Project the recorded judge verdict, keeping an out-of-vocabulary confidence explicit as unknown. */
export function projectJudge(verdictRecord: Record<string, unknown> | null): ItcJudge | null {
    if (verdictRecord === null) return null;
    return {
        verdict: stringOrNull(verdictRecord.verdict),
        confidence: asJudgeConfidence(verdictRecord.confidence),
        feedback: feedbackNotes(verdictRecord.feedback),
        confidenceInvalid: isOutOfVocabularyConfidence(verdictRecord.confidence),
    };
}

/** The revision budget: the captured `max_revisions` (integer), else the interactive bound of 3. */
export function revisionBudget(settings: Record<string, string>): number | null {
    const raw = settings.max_revisions;
    if (raw === undefined) return 3;
    return /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * Revision evidence from recorded state visits, never the mutable counter files (§9). A missing
 * `states[]` projection means nothing was recorded: every count stays null, never 0.
 */
export function revisionUsage(progress: unknown, settings: Record<string, string>): ItcRevisions {
    const states = asRecord(progress)?.states;
    if (!Array.isArray(states)) {
        return { revise: null, autoRevise: null, total: null, budget: revisionBudget(settings), recorded: false };
    }
    let revise = 0;
    let autoRevise = 0;
    for (const entry of states) {
        const state = stringOrNull(asRecord(entry)?.state);
        if (state === REVISE_STATE) revise += 1;
        else if (state === AUTOREVISE_STATE) autoRevise += 1;
    }
    return { revise, autoRevise, total: revise + autoRevise, budget: revisionBudget(settings), recorded: true };
}

/**
 * Authorized child-authoring evidence for an ITC run (0303 Board handoff).
 *
 * The ITC root is a `kind: dag` while revision visits live in the `kk-itc-author` child FSM, so the
 * parent projection can no longer read them from its own progress. A child is authoritative ONLY
 * when the persisted `author-run.json` binds the parent run id, the workspace and the executed child
 * definition digest — a file-provided child id alone is never trusted, and missing/mismatched
 * evidence yields nulls rather than a synthetic zero.
 */
export interface ItcChildEvidence {
    /** The child run id, present only when the binding verified. */
    childRunId: string | null;
    /** The verified child definition digest, or null when the binding did not verify. */
    definitionDigest: string | null;
    /** Why the child was rejected, for the Board diagnostic. */
    reason: string | null;
}

/** Verify an `author-run.json` document against the parent run and workspace it must bind. */
export function authorizeItcChild(
    authorRun: unknown,
    expected: { parentRunId: string; workDir: string; definitionDigest: string | null },
): ItcChildEvidence {
    const record = asRecord(authorRun);
    if (record === null)
        return { childRunId: null, definitionDigest: null, reason: 'author-run.json is missing or unreadable' };
    const parentRunId = stringOrNull(record.parentRunId);
    const childRunId = stringOrNull(record.childRunId);
    if (parentRunId !== expected.parentRunId || childRunId === null || childRunId === '') {
        return { childRunId: null, definitionDigest: null, reason: 'author-run.json does not bind this parent run' };
    }
    if (childRunId !== `${expected.parentRunId}-author`) {
        return { childRunId: null, definitionDigest: null, reason: 'author-run.json names an unexpected child run id' };
    }
    const digest = stringOrNull(record.definitionDigest);
    if (expected.definitionDigest !== null && digest !== null && digest !== expected.definitionDigest) {
        return {
            childRunId: null,
            definitionDigest: null,
            reason: 'author-run.json executed a different definition digest',
        };
    }
    return { childRunId, definitionDigest: digest, reason: null };
}

/**
 * Revision usage for an ITC run: the child's recorded visits when the child binding verified, and
 * nulls — never zero — when it did not or the child recorded nothing.
 */
export function revisionUsageFromChild(
    parentProgress: unknown,
    childEvidence: ItcChildEvidence,
    childProgress: unknown,
    settings: Record<string, string>,
): ItcRevisions {
    // A historical single-FSM capture still reads its own progress unchanged.
    const parentStates = asRecord(parentProgress)?.states;
    if (Array.isArray(parentStates)) return revisionUsage(parentProgress, settings);
    if (childEvidence.childRunId === null) {
        return { revise: null, autoRevise: null, total: null, budget: revisionBudget(settings), recorded: false };
    }
    return revisionUsage(childProgress, settings);
}

/** One recorded result row, normalized out of either Result shape. */
function resultRows(parsed: Record<string, unknown> | null): Record<string, unknown>[] {
    if (parsed === null) return [];
    // TWO shapes exist: a fan-out aggregate carries `targets[]`, while a single publish writes ONE
    // top-level `Result` object (`{ok, target, metadata:{publishStatus}, url?, error?}`). Assuming
    // one shape everywhere is the P1 bug 0253's review caught; treat a lone object as one row.
    if (Array.isArray(parsed.targets)) {
        return parsed.targets.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
    }
    return [parsed];
}

/** The public link a recorded row carries, or null (only credential-free http(s) URLs qualify). */
function publicUrl(value: unknown): string | null {
    const url = stringOrNull(value);
    return url !== null && isPublicHttpUrl(url) ? url : null;
}

/** Project one target's outcome from its group's recorded rows + the file's availability. */
function targetOutcome(
    target: string,
    transport: 'fanout' | 'browser',
    rows: Record<string, unknown>[],
    availability: ArtifactDescriptor['availability'],
): ItcTargetOutcome {
    const base: Pick<ItcTargetOutcome, 'target' | 'transport'> = { target, transport };
    if (availability !== 'available') {
        return { ...base, ok: null, url: null, error: null, detail: `result ${availability}` };
    }
    const row =
        rows.find((candidate) => stringOrNull(candidate.target) === target) ??
        (rows.length === 1 ? rows[0] : undefined);
    if (row === undefined) return { ...base, ok: null, url: null, error: null, detail: 'no result recorded' };
    const ok = row.ok === true;
    return {
        ...base,
        ok,
        url: publicUrl(row.url),
        error: stringOrNull(row.error),
        detail: ok ? 'ok' : 'failed',
    };
}

/** Parse the run's publish plan into the per-target result files it names (§9). */
export function itcResultSpecs(planText: string | undefined): ItcResultSpec[] {
    const plan = parseJsonObject(planText);
    if (plan === null) return [];
    const specs: ItcResultSpec[] = [];
    const fanout = Array.isArray(plan.fanout) ? plan.fanout : [];
    for (const entry of fanout) {
        const group = asRecord(entry);
        if (group === null) continue;
        const variant = stringOrNull(group.variant);
        if (variant === null) continue;
        const targets = (Array.isArray(group.targets) ? group.targets : [])
            .map(stringOrNull)
            .filter((target): target is string => target !== null);
        specs.push({
            group: { kind: 'fanout', variant, targets },
            spec: {
                id: `itc-fanout-${variant}`,
                label: `Publish result (${variant})`,
                kind: 'json',
                pattern: `4-publish/fanout-result.${variant}.json`,
                producerNode: 'publish-fanout',
                producerActionKey: 'publish-fanout:onEnter:0',
            },
        });
    }
    const browser = Array.isArray(plan.browser) ? plan.browser : [];
    for (const entry of browser) {
        const target = stringOrNull(asRecord(entry)?.target);
        if (target === null) continue;
        specs.push({
            group: { kind: 'browser', target },
            spec: {
                id: `itc-browser-${target}`,
                label: `Publish result (${target})`,
                kind: 'json',
                pattern: `4-publish/result.${target}.json`,
                producerNode: 'publish-agent',
                producerActionKey: 'publish-agent:onEnter:1',
            },
        });
    }
    return specs;
}

/**
 * Project one ITC run's results. Pure: the reader supplies the observed file states, the recorded
 * producer evidence, the derived per-target result specs and the recorded progress projection.
 */
export function projectItcResults(input: {
    record: RunCapture;
    detail: RunDetailSummary;
    marker: MarkerState;
    producerOf: (spec: ArtifactSpec) => ProducerState;
    observationOf: (spec: ArtifactSpec) => ArtifactObservation | undefined;
    resultSpecs?: readonly ItcResultSpec[];
    progress?: unknown;
    /** Authorized child evidence; when absent the child is treated as unverified (nulls, not zero). */
    child?: { evidence: ItcChildEvidence; progress?: unknown };
    diagnostics?: BoardDiagnostic[];
}): RunResults {
    const { record, detail, marker } = input;
    const terminal = isTerminalStatus(detail.status);
    const specs = artifactsFor(record.workflow as WorkflowName);
    const diagnostics: BoardDiagnostic[] = [...(input.diagnostics ?? []), ...markerDiagnostic(marker)];
    const availability = new Map<string, ArtifactDescriptor['availability']>();
    const artifacts: ArtifactDescriptor[] = [];
    for (const spec of specs) {
        const state = resolveAvailability(
            marker,
            input.producerOf(spec),
            input.observationOf(spec)?.state ?? 'absent',
            terminal,
        );
        availability.set(spec.id, state);
        artifacts.push(descriptorFor(spec, state, input.observationOf(spec)));
    }
    const textOf = (id: string): string | undefined => {
        if (availability.get(id) !== 'available') return undefined;
        const spec = specs.find((candidate) => candidate.id === id);
        return spec === undefined ? undefined : input.observationOf(spec)?.text;
    };
    const jsonOf = (id: string): Record<string, unknown> | null => parseJsonObject(textOf(id));

    const preview = (id: string): ItcPreview | null => {
        const spec = specs.find((candidate) => candidate.id === id);
        if (spec === undefined) return null;
        const state = availability.get(id) ?? 'unverified';
        return {
            id,
            label: spec.label,
            text: boundedPreview(spec.kind === 'image' ? null : textOf(id)),
            availability: state,
        };
    };
    const outlines = ['outline-a', 'outline-b', 'outline-c']
        .map(preview)
        .filter((entry): entry is ItcPreview => entry !== null);

    const judge = projectJudge(jsonOf('judge-verdict'));

    const resultSpecs = input.resultSpecs ?? [];
    const targets: ItcTargetOutcome[] = [];
    for (const entry of resultSpecs) {
        const state = resolveAvailability(
            marker,
            input.producerOf(entry.spec),
            input.observationOf(entry.spec)?.state ?? 'absent',
            terminal,
        );
        const raw = state === 'available' ? input.observationOf(entry.spec)?.text : undefined;
        const rows = resultRows(parseJsonObject(raw));
        if (entry.group.kind === 'fanout') {
            for (const target of entry.group.targets) targets.push(targetOutcome(target, 'fanout', rows, state));
        } else {
            targets.push(targetOutcome(entry.group.target, 'browser', rows, state));
        }
    }

    const reportRecord = jsonOf('report');
    const report =
        reportRecord === null
            ? null
            : {
                  outcome: stringOrNull(reportRecord.outcome),
                  verdict: stringOrNull(reportRecord.verdict),
                  revisions: numberOrNull(reportRecord.revisions),
              };

    const counts = {
        artifactsAvailable: artifacts.filter((artifact) => artifact.availability === 'available').length,
        artifactsTotal: artifacts.length,
        targetsOk: targets.filter((target) => target.ok === true).length,
        targetsFailed: targets.filter((target) => target.ok === false).length,
        targetsUnknown: targets.filter((target) => target.ok === null).length,
    };
    const summary: ItcSummary = {
        status: stringOrNull(detail.status) ?? detail.status,
        startedAt: detail.startedAt ?? null,
        completedAt: detail.completedAt ?? null,
        outcome: report?.outcome ?? null,
        outlines,
        selectedOutline: preview('outline-approved'),
        draft: preview('draft'),
        judge,
        revisions:
            input.child === undefined
                ? revisionUsage(input.progress, record.settings)
                : revisionUsageFromChild(input.progress, input.child.evidence, input.child.progress, record.settings),
        targets,
        report,
        counts,
    };
    if (input.child !== undefined && input.child.evidence.reason !== null) {
        diagnostics.push({
            code: 'board.itc.child-unverified',
            message: `${input.child.evidence.reason}; revision counts and child progress are unavailable.`,
        });
    }
    if (resultSpecs.length === 0 && reportRecord === null) {
        diagnostics.push({
            code: 'board.publish.unavailable',
            message: 'No publish plan or run report was recorded; per-target outcomes are unknown.',
        });
    }
    return {
        schemaVersion: 1,
        workflow: record.workflow as WorkflowName,
        runId: record.runId,
        availability: overallAvailability(artifacts.map((artifact) => artifact.availability)),
        summary: summary as unknown as Record<string, unknown>,
        artifacts,
        diagnostics,
    };
}
