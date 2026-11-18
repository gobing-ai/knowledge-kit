/**
 * Replayable calibration harness for the daily topic/selection boundary (task 0392 R1).
 *
 * The problem the task names: the deterministic floor (`topic-boundary.json`, since 2026-10-22 the
 * single `prc-leadership` rule) is narrow, but the editorial Agent still excluded whole
 * public-affairs classes (`plugins/kk/skills/news-editorial/SKILL.md` "Topic boundary"), so the
 * shipped policy excluded AI-industry mainlines — regulation, litigation, export controls,
 * procurement — that the column exists to cover. Narrowing that policy by opinion is how 0189's
 * five broad rules happened. This module makes the calibration evidence-based: every sample is a
 * TAGGED fixture (historical exclusion / counterexample) with an expected verdict, replayed against
 * the spec in force, so a rule change that re-breaks a known-good AI story fails a test.
 *
 * Fixtures are data (`tests/fixtures/topic-selection-cases.json`), not code, so the record of which
 * historical exclusions were replayed — and under which rule they once hit — survives without
 * editing a prompt.
 *
 * Node/Bun builtins only plus the sibling boundary engine.
 */
import { applyTopicBoundary, type TopicBoundarySpec } from './kk-workflow-stages.ts';

/** `historical` = a real prior exclusion; `counterexample` = a sample the policy must NOT drop. */
export type CalibrationTag = 'historical' | 'counterexample';

export interface CalibrationCaseDoc {
    id: string;
    title: string;
    body: string;
    publishedAt?: string;
}

export interface CalibrationCase {
    id: string;
    tag: CalibrationTag;
    /** Where the sample came from (run id, store item, date) — the audit trail. */
    source: string;
    /** What this case proves, in one line. */
    note: string;
    doc: CalibrationCaseDoc;
    expect: 'kept' | 'excluded';
    /** Rule id expected to exclude it; absent when `expect === 'kept'`. */
    expectRule?: string;
}

export interface CalibrationCaseResult {
    id: string;
    tag: CalibrationTag;
    note: string;
    expected: 'kept' | 'excluded';
    actual: 'kept' | 'excluded';
    rule: string | null;
    matched: string | null;
    agrees: boolean;
}

export interface CalibrationSummary {
    cases: number;
    kept: number;
    excluded: number;
    /** Rule id → hits across all replayed cases. */
    perRuleHits: Record<string, number>;
    /** Unique candidate IDs excluded — the count the report must use, not `ruleHits`. */
    uniqueIds: number;
    ruleHits: number;
    mismatches: CalibrationCaseResult[];
    /** tag → case/mismatch counts, so a regression names which sample class broke. */
    byTag: Record<CalibrationTag, { cases: number; mismatches: number }>;
    passes: boolean;
}

/** Replay every fixture through the boundary spec in force, recording the verdict and the rule. */
export function replayCalibrationCases(
    cases: CalibrationCase[],
    spec: TopicBoundarySpec,
    runDate = '20261117',
): CalibrationCaseResult[] {
    return cases.map((entry) => {
        // `applyTopicBoundary` reads `publishedAt` from `metadata` (the store's Doc shape); the
        // fixtures keep it flat on the sample so a reviewer can read one line per case.
        const doc = {
            id: entry.doc.id,
            title: entry.doc.title,
            body: entry.doc.body,
            metadata: entry.doc.publishedAt === undefined ? {} : { publishedAt: entry.doc.publishedAt },
        };
        const { excluded } = applyTopicBoundary([doc], runDate, spec);
        const hit = excluded[0];
        const actual: 'kept' | 'excluded' = hit === undefined ? 'kept' : 'excluded';
        const rule = hit?.rule ?? null;
        const agrees = actual === entry.expect && (entry.expectRule === undefined || entry.expectRule === rule);
        return {
            id: entry.id,
            tag: entry.tag,
            note: entry.note,
            expected: entry.expect,
            actual,
            rule,
            matched: hit?.matched ?? null,
            agrees,
        };
    });
}

/** Fold per-case results into the numbers the calibration record and its test assert on. */
export function summarizeCalibration(results: CalibrationCaseResult[]): CalibrationSummary {
    const perRuleHits: Record<string, number> = {};
    for (const result of results) {
        if (result.rule !== null) perRuleHits[result.rule] = (perRuleHits[result.rule] ?? 0) + 1;
    }
    const mismatches = results.filter((result) => !result.agrees);
    const byTag: CalibrationSummary['byTag'] = {
        historical: { cases: 0, mismatches: 0 },
        counterexample: { cases: 0, mismatches: 0 },
    };
    for (const result of results) {
        byTag[result.tag].cases += 1;
        if (!result.agrees) byTag[result.tag].mismatches += 1;
    }
    const excluded = results.filter((result) => result.actual === 'excluded');
    return {
        cases: results.length,
        kept: results.length - excluded.length,
        excluded: excluded.length,
        perRuleHits,
        uniqueIds: excluded.length,
        ruleHits: Object.values(perRuleHits).reduce((total, hits) => total + hits, 0),
        mismatches,
        byTag,
        passes: mismatches.length === 0,
    };
}

/** Parse the fixture file's cases, rejecting a case that forgets its tag or its expectation. */
export function parseCalibrationCases(raw: unknown): CalibrationCase[] {
    if (!Array.isArray(raw)) throw new Error('topic-selection fixtures: expected a case array');
    return raw.map((value, index) => {
        const entry = (value ?? {}) as Record<string, unknown>;
        const tag = entry.tag;
        if (tag !== 'historical' && tag !== 'counterexample') {
            throw new Error(`topic-selection fixtures[${index}]: tag must be historical|counterexample`);
        }
        const expect = entry.expect;
        if (expect !== 'kept' && expect !== 'excluded') {
            throw new Error(`topic-selection fixtures[${index}]: expect must be kept|excluded`);
        }
        const doc = (entry.doc ?? {}) as Record<string, unknown>;
        return {
            id: String(entry.id ?? ''),
            tag,
            source: String(entry.source ?? ''),
            note: String(entry.note ?? ''),
            doc: {
                id: String(doc.id ?? entry.id ?? ''),
                title: String(doc.title ?? ''),
                body: String(doc.body ?? ''),
                ...(typeof doc.publishedAt === 'string' ? { publishedAt: doc.publishedAt } : {}),
            },
            expect,
            ...(typeof entry.expectRule === 'string' ? { expectRule: entry.expectRule } : {}),
        };
    });
}
