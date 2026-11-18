/**
 * Task 0392 R1 — the selection boundary is calibrated against tagged samples, and the versioned
 * per-attempt counts artifact reconciles after retries, on a zero-kept day, with multiple rule hits
 * and with stages that never wrote evidence.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TopicBoundarySpec } from '../scripts/kk-workflow-stages.ts';
import {
    appendSelectionAttempt,
    buildSelectionAttempt,
    countRuleHits,
    multipleHitIds,
    readSelectionAttempts,
    reconcileSelectionAttempts,
    recordSelectionAttempt,
    SELECTION_ATTEMPTS_VERSION,
    selectionAttemptsPath,
} from '../scripts/topic-selection-attempts.ts';
import {
    type CalibrationCase,
    parseCalibrationCases,
    replayCalibrationCases,
    summarizeCalibration,
} from '../scripts/topic-selection-calibration.ts';

const here = import.meta.dir;
const spec = JSON.parse(readFileSync(join(here, '../scripts/topic-boundary.json'), 'utf-8')) as TopicBoundarySpec;
const fixtureRaw = JSON.parse(readFileSync(join(here, 'fixtures/topic-selection-cases.json'), 'utf-8')) as {
    runDate: string;
    cases: unknown;
};

const cases = parseCalibrationCases(fixtureRaw.cases);

describe('selection calibration fixtures (0392 R1)', () => {
    const results = replayCalibrationCases(cases, spec, fixtureRaw.runDate);
    const summary = summarizeCalibration(results);

    test('every tagged sample agrees with the policy in force', () => {
        expect(summary.passes).toBe(true);
        expect(summary.mismatches).toEqual([]);
        expect(summary.cases).toBe(cases.length);
    });

    test('both sample classes are present, including an AI-relevant public-policy story', () => {
        expect(summary.byTag.historical.cases).toBeGreaterThanOrEqual(2);
        expect(summary.byTag.counterexample.cases).toBeGreaterThanOrEqual(4);
        expect(cases.some((entry) => entry.id === 'counter-ai-export-controls-lab-capacity')).toBe(true);
    });

    test('the historical `policy-dispute` lawsuits are kept by the narrowed floor', () => {
        const historical = results.filter((result) => result.tag === 'historical');
        expect(historical.length).toBeGreaterThan(0);
        for (const result of historical) expect(result.actual).toBe('kept');
    });

    test('confirmed hard constraints still drop their samples', () => {
        const byId = new Map(results.map((result) => [result.id, result]));
        expect(byId.get('hard-prc-leadership-headline')?.rule).toBe('prc-leadership');
        expect(byId.get('hard-date-conflict-future-draft')?.rule).toBe('date-conflict');
        expect(summary.perRuleHits['prc-leadership']).toBe(1);
    });

    test('unique IDs and rule hits are reported separately', () => {
        expect(summary.uniqueIds).toBe(summary.excluded);
        expect(summary.ruleHits).toBe(summary.excluded);
    });

    test('a forgotten tag or expectation is rejected', () => {
        expect(() => parseCalibrationCases([{ id: 'x', expect: 'kept' }])).toThrow(/tag must be/);
        expect(() => parseCalibrationCases([{ id: 'x', tag: 'historical' }])).toThrow(/expect must be/);
        expect(() => parseCalibrationCases({})).toThrow(/expected a case array/);
    });

    test('a re-broken policy fails the calibration instead of silently passing', () => {
        const wide: TopicBoundarySpec = {
            ...spec,
            rules: [
                ...spec.rules,
                { id: 'policy-dispute', reason: 'old wide rule', keywords: ['lawsuit', 'regulation', 'regulator'] },
            ],
        };
        const broken = summarizeCalibration(replayCalibrationCases(cases, wide, fixtureRaw.runDate));
        expect(broken.passes).toBe(false);
        expect(broken.byTag.counterexample.mismatches + broken.byTag.historical.mismatches).toBe(
            broken.mismatches.length,
        );
        expect(broken.perRuleHits['policy-dispute']).toBeGreaterThan(0);
    });
});

const attemptBase = {
    runDate: '20261117',
    spec,
    preFilter: 5,
    keptIds: ['a', 'b', 'c'],
    excluded: [
        { id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' },
        { id: 'y', title: 'Y', rule: 'prc-leadership', reason: 'r', matched: '总书记' },
    ],
    deduped: [] as string[],
    planned: 3,
    recordedAt: '2026-11-17T04:30:00.000Z',
};

describe('per-attempt selection counts artifact (0392 R14)', () => {
    test('an attempt reconciles preFilter = kept + unique excluded + deduped, with rule hits counted separately', () => {
        const attempt = buildSelectionAttempt({ ...attemptBase, attemptId: 'run1#1' }, 1);
        expect(attempt.counts).toEqual({ preFilter: 5, kept: 3, uniqueExcluded: 2, deduped: 0, planned: 3 });
        expect(attempt.perRuleHits).toEqual({ 'prc-leadership': 2 });
        expect(attempt.specVersion).toBe(spec.version);
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(true);
        expect(reconciliation.uniqueIds).toBe(2);
        expect(reconciliation.ruleHits).toBe(2);
        expect(reconciliation.zeroKept).toBe(false);
        // The floor stage runs after this artifact is written, so it is unknown at QC time.
        expect(reconciliation.skippedStages).toEqual(['floor']);
        expect(reconciliation.issues).toEqual([]);
    });

    test('multiple hits under several rules are one unique ID each', () => {
        const excluded = [
            { id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' },
            { id: 'x', title: 'X', rule: 'policy-dispute', reason: 'r', matched: 'lawsuit' },
            { id: 'y', title: 'Y', rule: 'policy-dispute', reason: 'r', matched: 'regulation' },
        ];
        expect(countRuleHits(excluded)).toEqual({ 'prc-leadership': 1, 'policy-dispute': 2 });
        const attempt = buildSelectionAttempt({ ...attemptBase, attemptId: 'run1#1', excluded }, 1);
        expect(attempt.perRuleHits['policy-dispute']).toBe(2);
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.ruleHits).toBe(3);
        expect(reconciliation.uniqueIds).toBe(3);
        expect(multipleHitIds([attempt])).toEqual(['x']);
    });

    test('a zero-kept day is reported, not treated as a contradiction', () => {
        const attempt = buildSelectionAttempt(
            {
                ...attemptBase,
                attemptId: 'run1#1',
                preFilter: 2,
                keptIds: [],
                excluded: [
                    { id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' },
                    { id: 'y', title: 'Y', rule: 'date-conflict', reason: 'r', matched: '2026-12-01' },
                ],
                deduped: [],
                planned: null,
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.zeroKept).toBe(true);
        expect(reconciliation.reconciled).toBe(true);
        expect(reconciliation.skippedStages).toContain('plan');
    });

    test('a skipped stage stays unknown instead of counting as zero', () => {
        const attempt = buildSelectionAttempt(
            { ...attemptBase, attemptId: 'run1#1', deduped: null, planned: null, observed: { floor: false } },
            1,
        );
        expect(attempt.counts.deduped).toBeNull();
        expect(attempt.counts.planned).toBeNull();
        expect(attempt.stageEvidence.dedup).toBe('unknown');
        expect(attempt.stageEvidence.preFilter).toBe('observed');
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.skippedStages).toEqual(['dedup', 'plan', 'floor']);
    });

    test('counts that do not reconcile are named, not smoothed over', () => {
        const attempt = buildSelectionAttempt({ ...attemptBase, attemptId: 'run1#1', preFilter: 9 }, 1);
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.issues[0]).toContain('do not reconcile');
    });

    test('a dedup day reconciles: preFilter = kept + unique excluded + deduped', () => {
        // 5-doc pool: 1 boundary exclusion, 1 near-duplicate drop, 3 survivors. Summing only
        // kept + excluded published a false MISMATCH for exactly this shape.
        const attempt = buildSelectionAttempt(
            {
                ...attemptBase,
                attemptId: 'run1#1',
                preFilter: 5,
                keptIds: ['a', 'b', 'c'],
                excluded: [{ id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' }],
                deduped: ['dup'],
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(true);
        expect(reconciliation.issues).toEqual([]);
        // Dedup evidence was observed, so it must not be reported as a skipped stage either.
        expect(reconciliation.skippedStages).not.toContain('dedup');
    });

    test('a dedup day that still loses a candidate names all three counts', () => {
        const attempt = buildSelectionAttempt(
            { ...attemptBase, attemptId: 'run1#1', preFilter: 7, deduped: ['dup'] },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.issues).toEqual([
            'counts do not reconcile: preFilter 7 ≠ kept 3 + excluded 2 + deduped 1',
        ]);
    });

    test('missing dedup evidence leaves the identity unproven, never violated', () => {
        const attempt = buildSelectionAttempt({ ...attemptBase, attemptId: 'run1#1', deduped: null }, 1);
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.issues).toEqual([]);
        expect(reconciliation.skippedStages).toContain('dedup');
    });

    test('a retry appends and supersedes the earlier attempt without inheriting its reasons', () => {
        const first = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        expect(first.version).toBe(SELECTION_ATTEMPTS_VERSION);
        expect(first.attempts).toHaveLength(1);
        // Retry: the second attempt excludes nothing, so the day's rule hits must come from it alone.
        const second = appendSelectionAttempt(first, {
            ...attemptBase,
            attemptId: 'run1#2',
            preFilter: 4,
            keptIds: ['a', 'b', 'c', 'd'],
            excluded: [],
        });
        expect(second.attempts.map((attempt) => attempt.attempt)).toEqual([1, 2]);
        expect(second.reconciliation.ruleHits).toBe(0);
        expect(second.reconciliation.uniqueIds).toBe(0);
        expect(second.reconciliation.supersededAttempts).toEqual([1]);
        expect(second.reconciliation.reconciled).toBe(true);
    });

    test('an ID excluded under different rules on different attempts is a multiple hit', () => {
        const first = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        const second = appendSelectionAttempt(first, {
            ...attemptBase,
            attemptId: 'run1#2',
            excluded: [{ id: 'x', title: 'X', rule: 'date-conflict', reason: 'r', matched: '2026-12-01' }],
            keptIds: ['a', 'b', 'c', 'y'],
            preFilter: 5,
        });
        expect(second.attempts[1]?.multipleHitIds).toEqual(['x']);
        expect(second.reconciliation.multipleHits).toBe(1);
    });

    test('a new run day starts a fresh history', () => {
        const first = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        const nextDay = appendSelectionAttempt(first, { ...attemptBase, runDate: '20261118', attemptId: 'run1#9' });
        expect(nextDay.attempts).toHaveLength(1);
        expect(nextDay.runDate).toBe('20261118');
    });

    test('the artifact round-trips through the work dir and tolerates junk', () => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-selection-'));
        expect(readSelectionAttempts(workDir)).toBeNull();
        expect(selectionAttemptsPath(workDir)).toBe(join(workDir, '21-plan/topic-selection-attempts.json'));
        const written = recordSelectionAttempt(workDir, { ...attemptBase, attemptId: 'run1#1' });
        const reread = readSelectionAttempts(workDir);
        expect(reread?.reconciliation).toEqual(written.reconciliation);
        expect(reread?.attempts[0]?.keptIds).toEqual(['a', 'b', 'c']);
        // A retry through the writer keeps attempt 1 in the file.
        recordSelectionAttempt(workDir, { ...attemptBase, attemptId: 'run1#2' });
        expect(readSelectionAttempts(workDir)?.attempts).toHaveLength(2);
        writeFileSync(selectionAttemptsPath(workDir), '{not json');
        expect(readSelectionAttempts(workDir)).toBeNull();
        writeFileSync(selectionAttemptsPath(workDir), JSON.stringify({ version: 1, attempts: 'nope' }));
        expect(readSelectionAttempts(workDir)).toBeNull();
    });

    test('no attempts at all leaves every stage unknown', () => {
        const reconciliation = reconcileSelectionAttempts([]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.uniqueIds).toBeNull();
        expect(reconciliation.skippedStages.length).toBeGreaterThan(0);
        expect(reconciliation.issues[0]).toContain('no selection attempt');
    });
});

/** Keep the fixture type import honest: cases are data, and their shape is asserted above. */
export type _CalibrationCaseShape = CalibrationCase;
