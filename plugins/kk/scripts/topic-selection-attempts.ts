/**
 * The versioned per-attempt selection-counts artifact (task 0392 R1/R14).
 *
 * Before 0392 the QC/curation path recorded exclusion evidence only when a rule actually hit
 * (`${run_date}_04_quality-control-content_exclusions.json`), so a day that kept everything and a day
 * whose boundary never ran produced the same files: nothing. The report could therefore only say
 * "QC admitted zero" without saying how the pool shrank, and a retry overwrote the previous
 * attempt's numbers instead of reconciling against them.
 *
 * This module owns the deterministic half: one artifact, `21-plan/topic-selection-attempts.json`,
 * `version`-stamped, holding an append-only list of attempts. Each attempt captures
 *  - the raw pre-filter count (taken before any mutation of the candidates file),
 *  - the kept count and the unique excluded IDs,
 *  - per-rule hit counts (rule hits are NOT unique IDs: one doc can be counted under several rules
 *    across attempts, and the UI/report must not add the two numbers together),
 *  - which stages have observed evidence, so a stage that never ran stays `unknown` instead of
 *    being inferred as zero,
 *  - the decisions themselves (kept / excluded / deduped IDs).
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
export const SELECTION_ATTEMPTS_VERSION = 1;

/** Selection stages whose counts the artifact projects, in pipeline order. */
export const SELECTION_STAGES = ['preFilter', 'topicBoundary', 'dedup', 'plan', 'floor'] as const;

export type SelectionStage = (typeof SELECTION_STAGES)[number];

/**
 * Counts per stage. `null` means the stage's evidence is missing — never 0, because "we did not
 * observe it" and "it observed nothing" are different facts (0392 R14: leave it unknown).
 */
export interface SelectionStageCounts {
    preFilter: number | null;
    kept: number | null;
    uniqueExcluded: number | null;
    deduped: number | null;
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

export interface SelectionAttempt {
    /** 1-based ordinal within the run day; a retry is attempt 2, 3, … */
    attempt: number;
    /** Run id + ordinal, so evidence binds to an attempt even when the work dir is reused. */
    attemptId: string;
    recordedAt: string;
    /** `topic-boundary.json` version in force for this attempt. */
    specVersion: number;
    counts: SelectionStageCounts;
    /** Rule id → number of hits in this attempt (a hit count, not a unique-ID count). */
    perRuleHits: Record<string, number>;
    /** The unique excluded candidate IDs this attempt recorded, with their rule. */
    exclusions: SelectionExclusionRecord[];
    /** Candidate IDs excluded under more than one distinct rule across the run day's attempts. */
    multipleHitIds: string[];
    /** Kept candidate IDs (the decisions, so a loss is attributable, not just counted). */
    keptIds: string[];
    stageEvidence: StageEvidence;
}

export interface SelectionReconciliation {
    /**
     * `preFilter === kept + uniqueExcluded + deduped` for the latest attempt. The dedup drops are
     * part of the identity: `kept` is post-dedup, so a dedup day that omitted them would report a
     * false MISMATCH. A `null` count (missing evidence) leaves the identity unproven, not violated.
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
    /** Candidate count BEFORE any stage mutated the candidates file. */
    preFilter: number;
    /** Docs the boundary kept. */
    keptIds: string[];
    /** The boundary's exclusions for this attempt. */
    excluded: TopicBoundaryExclusion[];
    /** Near-duplicate IDs the dedup pass dropped (`null` = dedup evidence missing). */
    deduped: string[] | null;
    /** Planned item count (`null` = the plan stage has not produced evidence yet). */
    planned?: number | null;
    /** Stages which actually wrote evidence this attempt. */
    observed?: Partial<Record<SelectionStage, boolean>>;
}

export interface SelectionArtifact {
    version: number;
    runDate: string;
    specVersion: number;
    attempts: SelectionAttempt[];
    reconciliation: SelectionReconciliation;
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

function evidenceFor(observed: SelectionAttemptInput['observed']): StageEvidence {
    const evidence = {} as StageEvidence;
    for (const stage of SELECTION_STAGES) evidence[stage] = observed?.[stage] === true ? 'observed' : 'unknown';
    return evidence;
}

/** Turn one stage invocation into an attempt record. Pure: no IO, no clock unless asked to stamp one. */
export function buildSelectionAttempt(input: SelectionAttemptInput, attempt = 1): SelectionAttempt {
    const deduped = input.deduped;
    const planned = input.planned ?? null;
    return {
        attempt,
        attemptId: input.attemptId,
        recordedAt: input.recordedAt ?? new Date().toISOString(),
        specVersion: input.spec.version,
        counts: {
            preFilter: input.preFilter,
            kept: input.keptIds.length,
            uniqueExcluded: input.excluded.length,
            deduped: deduped === null ? null : deduped.length,
            planned,
        },
        perRuleHits: countRuleHits(input.excluded),
        exclusions: input.excluded.map((entry) => ({ id: entry.id, rule: entry.rule, matched: entry.matched })),
        multipleHitIds: [],
        keptIds: [...input.keptIds],
        stageEvidence: evidenceFor({
            preFilter: true,
            topicBoundary: true,
            dedup: deduped !== null,
            plan: planned !== null,
            ...input.observed,
        }),
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
    const { preFilter, kept, uniqueExcluded, deduped } = latest.counts;
    // `kept` is post-dedup, so the near-duplicate drops belong on the other side of the identity:
    // preFilter = kept + uniqueExcluded + deduped. A null count means the stage left no evidence,
    // so the identity is unproven (reported through `skippedStages`), never a mismatch.
    const sum = kept === null || uniqueExcluded === null || deduped === null ? null : kept + uniqueExcluded + deduped;
    const reconciled = preFilter !== null && sum !== null && preFilter === sum;
    if (preFilter !== null && sum !== null && preFilter !== sum) {
        issues.push(
            `counts do not reconcile: preFilter ${preFilter} ≠ kept ${kept} + excluded ${uniqueExcluded} + deduped ${deduped}`,
        );
    }
    const skippedStages = SELECTION_STAGES.filter((stage) => latest.stageEvidence[stage] === 'unknown');
    const ruleHits = Object.values(latest.perRuleHits).reduce((total, hits) => total + hits, 0);
    return {
        reconciled,
        uniqueIds: uniqueExcluded,
        ruleHits,
        multipleHits: multipleHitIds(attempts).length,
        zeroKept: kept === 0,
        skippedStages,
        supersededAttempts: attempts.slice(0, -1).map((attempt) => attempt.attempt),
        issues,
    };
}

/** Append an attempt to the run day's artifact (a retry appends; nothing is overwritten). */
export function appendSelectionAttempt(
    previous: SelectionArtifact | null,
    input: SelectionAttemptInput,
): SelectionArtifact {
    const history = previous !== null && previous.runDate === input.runDate ? previous.attempts : [];
    const attempt = buildSelectionAttempt(input, history.length + 1);
    const attempts = [...history, attempt];
    attempts[attempts.length - 1] = { ...attempt, multipleHitIds: multipleHitIds(attempts) };
    return {
        version: SELECTION_ATTEMPTS_VERSION,
        runDate: input.runDate,
        specVersion: attempt.specVersion,
        attempts,
        reconciliation: reconcileSelectionAttempts(attempts),
    };
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

/**
 * Record one selection attempt for the run day. Returns the artifact it wrote; an unwritable work
 * dir throws (the caller stages it through `sted`, so the write is visible in step timing).
 */
export function recordSelectionAttempt(workDir: string, input: SelectionAttemptInput): SelectionArtifact {
    const artifact = appendSelectionAttempt(readSelectionAttempts(workDir), input);
    const path = selectionAttemptsPath(workDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
    return artifact;
}
