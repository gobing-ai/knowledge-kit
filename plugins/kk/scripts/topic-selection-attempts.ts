/**
 * The versioned per-attempt selection-counts artifact (task 0392 R1/R2).
 *
 * Before 0392 the QC/curation path recorded exclusion evidence only when a rule actually hit
 * (`${run_date}_04_quality-control-content_exclusions.json`), so a day that kept everything and a day
 * whose boundary never ran produced the same files: nothing. The report could therefore only say
 * "QC admitted zero" without saying how the pool shrank, and a retry overwrote the previous
 * attempt's numbers instead of reconciling against them.
 *
 * This module owns the deterministic half: one artifact, `21-plan/topic-selection-attempts.json`,
 * `version`-stamped, holding an append-only list of attempts. Each attempt captures
 *  - one record per selection stage that actually ran, `{stage, input, kept, dropped[]}`, so each
 *    stage is provable on its own (`input === kept + dropped.length`) instead of being inferred
 *    from a single cross-stage sum,
 *  - per-rule hit counts (rule hits are NOT unique IDs: one doc can be counted under several rules
 *    across attempts, and the UI/report must not add the two numbers together),
 *  - the editorial (curation) exclusions with the agent's own reason, kept apart from mechanical
 *    rule hits because they answer a different question,
 *  - the channel-admission decisions per target, which are an outcome of the run and never change
 *    the candidate totals,
 *  - which stages have observed evidence, so a stage that never ran stays `unknown` instead of
 *    being inferred as zero.
 *
 * A retry appends rather than replaces. The reconciliation block always describes the LATEST
 * attempt (a retry must not inherit a stale reason from the attempt it supersedes) while the earlier
 * attempts stay inspectable, marked `superseded`.
 *
 * Node/Bun builtins plus the sibling boundary engine only — the stage runner imports this file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TopicBoundaryExclusion, TopicBoundarySpec } from './kk-workflow-stages.ts';

/** Bump when the attempt/reconciliation shape changes; readers must tolerate older versions. */
export const SELECTION_ATTEMPTS_VERSION = 2;

/**
 * Selection stages in pipeline order.
 *
 * `qc` is the raw pool entering the QC filter and its output; `topicBoundary` → `dedup` → `floor`
 * run inside `daily-qc-content`; `curation` → `plan` are the agent's curated split (written by
 * `daily-curate-check`); `channelAdmission` is the content-safety gate's per-target decision.
 */
export const SELECTION_STAGES = [
    'qc',
    'topicBoundary',
    'dedup',
    'floor',
    'curation',
    'plan',
    'channelAdmission',
] as const;

export type SelectionStage = (typeof SELECTION_STAGES)[number];

/** Stages that move candidates, and so carry `input = kept + dropped`. */
export const COUNT_STAGES = ['qc', 'topicBoundary', 'dedup', 'floor', 'curation', 'plan'] as const;

export type CountStage = (typeof COUNT_STAGES)[number];

/** One stage's observed arithmetic. `dropped` holds distinct candidate IDs, never rule hits. */
export interface SelectionStageCount {
    stage: CountStage;
    /** Candidates entering the stage. */
    input: number;
    /** Candidates the stage kept. */
    kept: number;
    /** Distinct candidate IDs the stage dropped. */
    dropped: string[];
}

/**
 * Counts the report totals use. Kept for shape compatibility with the v1 artifact; every field is
 * derived from `stages[]` (`null` when the stage that produces it left no evidence).
 */
export interface SelectionStageCounts {
    /** Raw pool entering QC (`qc` stage input). */
    preFilter: number | null;
    /** Final kept count — the curated plan when curation ran, else the post-dedup survivors. */
    kept: number | null;
    /** Distinct candidate IDs dropped by a mechanical boundary rule. */
    uniqueExcluded: number | null;
    /** Near-duplicate drops (`null` = the dedup stage left no evidence). */
    deduped: number | null;
    /** Curated plan item count (`null` = curation left no evidence). */
    planned: number | null;
}

/** `observed` only when a stage wrote evidence for this attempt. */
export type StageEvidence = Record<SelectionStage, 'observed' | 'unknown'>;

export interface SelectionExclusionRecord {
    /** Candidate id. */
    id: string;
    /** Rule that excluded it in this attempt. */
    rule: string;
    /** The keyword/text the rule matched. */
    matched: string;
}

/** An editorial (curation) exclusion: the agent's own reason, not a mechanical rule id. */
export interface CurationExclusionRecord {
    id: string;
    reason: string;
}

/** Per-target channel decision. A target outcome, never a candidate count. */
export interface ChannelAdmissionRecord {
    /** Scope the review ran over (`drafts`, `variants`). */
    scope: string;
    /** Target platform → decision (`OK` | `RISK` | `BLOCK`), plus the gate's own status. */
    targets: { target: string; decision: string }[];
    /** The gate's classification for this scope (`pass` | `revise` | `exclude` | `escalate` | `block`). */
    status: string;
}

export interface SelectionAttempt {
    /** 1-based ordinal within the run day; a retry is attempt 2, 3, … */
    attempt: number;
    /** Run id + ordinal, so evidence binds to an attempt even when the work dir is reused. */
    attemptId: string;
    recordedAt: string;
    /** `topic-boundary.json` version in force for this attempt. */
    specVersion: number;
    counts: SelectionStageCounts;
    /** One record per stage that ran, in pipeline order. */
    stages: SelectionStageCount[];
    /** Rule id → number of hits in this attempt (a hit count, not a unique-ID count). */
    perRuleHits: Record<string, number>;
    /** The unique excluded candidate IDs this attempt recorded, with their rule. */
    exclusions: SelectionExclusionRecord[];
    /** Editorial exclusions with the agent's own reason. */
    curationExcluded: CurationExclusionRecord[];
    /** Candidate IDs excluded under more than one distinct rule across the run day's attempts. */
    multipleHitIds: string[];
    /** Kept candidate IDs (the decisions, so a loss is attributable, not just counted). */
    keptIds: string[];
    /** Channel-admission outcomes; `null` until the safety gate recorded a decision. */
    channelAdmission: ChannelAdmissionRecord[];
    stageEvidence: StageEvidence;
}

export interface SelectionReconciliation {
    /**
     * Every observed count stage satisfies `input === kept + dropped.length`, and consecutive
     * observed stages chain (`next.input === previous.kept`). A stage with no evidence leaves the
     * reconciliation unproven (reported through `skippedStages`), never violated.
     */
    reconciled: boolean;
    /** Unique excluded IDs in the latest attempt — count distinct candidates, not rule hits. */
    uniqueIds: number | null;
    /** Sum of the latest attempt's per-rule hits. May exceed `uniqueIds`. */
    ruleHits: number;
    /** Candidate IDs the day excluded under ≥2 distinct rules. */
    multipleHits: number;
    /** A `kept === 0` day is a valid outcome, reported as such (never as a failure). */
    zeroKept: boolean;
    /** Stages with no evidence in the latest attempt — the report prints these as unknown. */
    skippedStages: SelectionStage[];
    /** Attempts whose numbers a later attempt supersedes (kept for history, never inherited). */
    supersededAttempts: number[];
    /** Human-readable contradictions found while reconciling. */
    issues: string[];
}

export interface SelectionAttemptsArtifact {
    version: number;
    runDate: string;
    specVersion: number;
    attempts: SelectionAttempt[];
    reconciliation: SelectionReconciliation;
}

export interface SelectionAttemptInput {
    runDate: string;
    attemptId: string;
    recordedAt?: string;
    spec: Pick<TopicBoundarySpec, 'version'>;
    /** Stage observations this invocation made, in pipeline order. */
    stages: SelectionStageCount[];
    /** Mechanical boundary exclusions (rule-level records). */
    excluded: TopicBoundaryExclusion[];
    /** Candidate IDs kept by the last stage in `stages`. */
    keptIds: string[];
    /** Editorial exclusions, when this invocation produced them (curation). */
    curationExcluded?: CurationExclusionRecord[];
    /** Channel decisions, when this invocation produced them (the safety gate). */
    channelAdmission?: ChannelAdmissionRecord[];
}

/** A later stage's evidence attached to the attempt already on disk. */
export interface SelectionAttemptPatch {
    /** Stage observations to merge; an existing record for the same stage is replaced. */
    stages?: SelectionStageCount[];
    curationExcluded?: CurationExclusionRecord[];
    channelAdmission?: ChannelAdmissionRecord[];
    /** Overrides the attempt identity — a curation pass after a QC retry belongs to that retry. */
    attemptId?: string;
}

/** Rule id → hit count. A hit is an (item, rule) event; the same item can hit one rule per attempt. */
export function countRuleHits(excluded: TopicBoundaryExclusion[]): Record<string, number> {
    const hits: Record<string, number> = {};
    for (const entry of excluded) hits[entry.rule] = (hits[entry.rule] ?? 0) + 1;
    return hits;
}

/** Candidate IDs this run day excluded under more than one DISTINCT rule (retries included). */
export function multipleHitIds(attempts: SelectionAttempt[]): string[] {
    const rulesById = new Map<string, Set<string>>();
    for (const attempt of attempts) {
        for (const entry of attempt.exclusions) {
            const rules = rulesById.get(entry.id) ?? new Set<string>();
            rules.add(entry.rule);
            rulesById.set(entry.id, rules);
        }
    }
    return [...rulesById.entries()].filter(([, rules]) => rules.size > 1).map(([id]) => id);
}

function stageMap(stages: SelectionStageCount[]): Map<CountStage, SelectionStageCount> {
    return new Map(stages.map((entry) => [entry.stage, entry]));
}

/** Sort by pipeline order and drop duplicates, so `stages[]` is always canonical. */
function orderStages(stages: SelectionStageCount[]): SelectionStageCount[] {
    const byStage = stageMap(stages);
    return COUNT_STAGES.filter((stage) => byStage.has(stage)).map((stage) => byStage.get(stage) as SelectionStageCount);
}

function evidenceFor(attempt: Pick<SelectionAttempt, 'stages' | 'channelAdmission'>): StageEvidence {
    const evidence = {} as StageEvidence;
    const observed = new Set<string>(attempt.stages.map((entry) => entry.stage));
    if (attempt.channelAdmission.length > 0) observed.add('channelAdmission');
    for (const stage of SELECTION_STAGES) evidence[stage] = observed.has(stage) ? 'observed' : 'unknown';
    return evidence;
}

/**
 * Project `stages[]` onto the report totals. `kept` is the LAST count stage's kept value (the
 * curated plan once curation ran), so the headline number never regresses to a pre-curation count.
 */
function countsFor(stages: SelectionStageCount[], uniqueExcluded: number): SelectionStageCounts {
    const byStage = stageMap(stages);
    const last = stages[stages.length - 1];
    const dedup = byStage.get('dedup');
    const plan = byStage.get('plan');
    return {
        preFilter: byStage.get('qc')?.input ?? null,
        kept: last === undefined ? null : last.kept,
        uniqueExcluded,
        deduped: dedup === undefined ? null : dedup.dropped.length,
        planned: plan === undefined ? null : plan.kept,
    };
}

/** Turn one stage invocation into an attempt record. Pure: no IO, no clock unless asked to stamp one. */
export function buildSelectionAttempt(input: SelectionAttemptInput, attempt = 1): SelectionAttempt {
    const stages = orderStages(input.stages);
    return {
        attempt,
        attemptId: input.attemptId,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        specVersion: input.spec.version,
        counts: countsFor(stages, input.excluded.length),
        stages,
        perRuleHits: countRuleHits(input.excluded),
        exclusions: input.excluded.map((entry) => ({ id: entry.id, rule: entry.rule, matched: entry.matched })),
        curationExcluded: input.curationExcluded ?? [],
        multipleHitIds: [],
        keptIds: [...input.keptIds],
        channelAdmission: input.channelAdmission ?? [],
        stageEvidence: evidenceFor({ stages, channelAdmission: input.channelAdmission ?? [] }),
    };
}

/**
 * Reconcile one run day's attempts. The latest attempt owns every number; earlier attempts are
 * history only (a retry must never inherit a stale reason), and its missing stages stay unknown.
 */
export function reconcileSelectionAttempts(attempts: SelectionAttempt[]): SelectionReconciliation {
    const latest = attempts[attempts.length - 1];
    const issues: string[] = [];
    if (latest === undefined) {
        return {
            reconciled: false,
            uniqueIds: null,
            ruleHits: 0,
            multipleHits: 0,
            zeroKept: false,
            skippedStages: [...SELECTION_STAGES],
            supersededAttempts: [],
            issues: ['no selection attempt was recorded for this run day'],
        };
    }
    // Per-stage arithmetic first: a stage that reports more or fewer drops than it actually moved
    // candidates is the failure mode this artifact exists to catch.
    for (const entry of latest.stages) {
        const sum = entry.kept + entry.dropped.length;
        if (entry.input !== sum) {
            issues.push(`${entry.stage}: input ${entry.input} ≠ kept ${entry.kept} + dropped ${entry.dropped.length}`);
        }
    }
    // Then the chain: a stage that starts from a count the previous stage did not hand over means
    // the numbers were recorded across different inputs (a retry mid-pipeline, or a stale artifact).
    for (let index = 1; index < latest.stages.length; index += 1) {
        const previous = latest.stages[index - 1] as SelectionStageCount;
        const current = latest.stages[index] as SelectionStageCount;
        if (current.input !== previous.kept) {
            issues.push(
                `${previous.stage} → ${current.stage}: previous kept ${previous.kept} ≠ next input ${current.input}`,
            );
        }
    }
    const kept = latest.counts.kept;
    const ruleHits = Object.values(latest.perRuleHits).reduce((total, hits) => total + hits, 0);
    return {
        reconciled: issues.length === 0 && latest.stages.length > 0,
        uniqueIds: latest.counts.uniqueExcluded,
        ruleHits,
        multipleHits: multipleHitIds(attempts).length,
        zeroKept: kept === 0,
        skippedStages: SELECTION_STAGES.filter((stage) => latest.stageEvidence[stage] === 'unknown'),
        supersededAttempts: attempts.slice(0, -1).map((attempt) => attempt.attempt),
        issues,
    };
}

function artifactFor(input: {
    runDate: string;
    specVersion: number;
    attempts: SelectionAttempt[];
}): SelectionAttemptsArtifact {
    const attempts = [...input.attempts];
    const latest = attempts[attempts.length - 1] as SelectionAttempt;
    attempts[attempts.length - 1] = { ...latest, multipleHitIds: multipleHitIds(attempts) };
    return {
        version: SELECTION_ATTEMPTS_VERSION,
        runDate: input.runDate,
        specVersion: input.specVersion,
        attempts,
        reconciliation: reconcileSelectionAttempts(attempts),
    };
}

/** Append an attempt to the run day's artifact (a retry appends; nothing is overwritten). */
export function appendSelectionAttempt(
    previous: SelectionArtifact | null,
    input: SelectionAttemptInput,
): SelectionArtifact {
    const history = previous !== null && previous.runDate === input.runDate ? previous.attempts : [];
    const attempt = buildSelectionAttempt(input, history.length + 1);
    return artifactFor({
        runDate: input.runDate,
        specVersion: attempt.specVersion,
        attempts: [...history, attempt],
    });
}

/**
 * Attach a later stage's evidence to the attempt already recorded for the run day.
 *
 * The pipeline is staged: QC writes the attempt, curation and the safety gate only run afterwards.
 * Amending keeps ONE attempt per invocation (a retry is a new attempt), which is why the identity
 * comes from the attempt already on disk rather than from a fresh `attemptId`. Returns `null` when
 * there is no attempt to amend — the caller then leaves the stage unknown instead of inventing one.
 */
export function amendSelectionAttempt(
    previous: SelectionArtifact | null,
    runDate: string,
    patch: SelectionAttemptPatch,
): SelectionArtifact | null {
    if (previous === null || previous.runDate !== runDate) return null;
    const attempts = [...previous.attempts];
    const latest = attempts[attempts.length - 1];
    if (latest === undefined) return null;
    const merged: SelectionAttempt = {
        ...latest,
        attemptId: patch.attemptId ?? latest.attemptId,
        stages: orderStages([...latest.stages, ...(patch.stages ?? [])]),
        curationExcluded: [...latest.curationExcluded, ...(patch.curationExcluded ?? [])],
        channelAdmission: mergeChannelAdmission(latest.channelAdmission, patch.channelAdmission ?? []),
    };
    // The boundary exclusion records live on the attempt; re-project from them so a curation
    // amendment cannot discard the rule counts the QC stage recorded.
    merged.counts = countsFor(merged.stages, merged.exclusions.length);
    merged.stageEvidence = evidenceFor(merged);
    attempts[attempts.length - 1] = merged;
    return artifactFor({ runDate: previous.runDate, specVersion: merged.specVersion, attempts });
}

/** A re-run of the same scope replaces that scope's decisions; a new scope appends. */
function mergeChannelAdmission(
    existing: ChannelAdmissionRecord[],
    incoming: ChannelAdmissionRecord[],
): ChannelAdmissionRecord[] {
    const merged = [...existing];
    for (const entry of incoming) {
        const index = merged.findIndex((current) => current.scope === entry.scope);
        if (index === -1) merged.push(entry);
        else merged[index] = entry;
    }
    return merged;
}

/** `21-plan/topic-selection-attempts.json` — one artifact per run day, shared by both report paths. */
export function selectionAttemptsPath(workDir: string): string {
    return join(workDir, '21-plan', 'topic-selection-attempts.json');
}

/** Tolerant read: an absent, unparsable or older artifact is `null`, never a thrown stage. */
export function readSelectionAttempts(workDir: string): SelectionArtifact | null {
    try {
        const parsed = JSON.parse(readFileSync(selectionAttemptsPath(workDir), 'utf-8')) as unknown;
        if (parsed === null || typeof parsed !== 'object') return null;
        const artifact = parsed as SelectionArtifact;
        return Array.isArray(artifact.attempts) ? artifact : null;
    } catch {
        return null;
    }
}

function persist(workDir: string, artifact: SelectionAttemptsArtifact): SelectionAttemptsArtifact {
    const path = selectionAttemptsPath(workDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifact;
}

/**
 * Record one selection attempt for the run day. Returns the artifact it wrote; an unwritable work
 * dir throws (the caller stages it through `sted`, so the write is visible in step timing).
 */
export function recordSelectionAttempt(workDir: string, input: SelectionAttemptInput): SelectionArtifact {
    return persist(workDir, appendSelectionAttempt(readSelectionAttempts(workDir), input));
}

/** Record a later stage's evidence onto the run day's current attempt; `null` when there is none. */
export function recordSelectionStage(
    workDir: string,
    runDate: string,
    patch: SelectionAttemptPatch,
): SelectionArtifact | null {
    const amended = amendSelectionAttempt(readSelectionAttempts(workDir), runDate, patch);
    return amended === null ? null : persist(workDir, amended);
}
