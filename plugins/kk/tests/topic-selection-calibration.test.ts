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
    amendSelectionAttempt,
    appendSelectionAttempt,
    buildSelectionAttempt,
    countRuleHits,
    multipleHitIds,
    readSelectionAttempts,
    reconcileSelectionAttempts,
    recordSelectionAttempt,
    recordSelectionStage,
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

/** The QC-side stage records: 5 planned docs → QC keeps 5 → boundary drops x,y → dedup drops none. */
const qcStages = [
    { stage: 'qc' as const, input: 5, kept: 5, dropped: [] as string[] },
    { stage: 'topicBoundary' as const, input: 5, kept: 3, dropped: ['x', 'y'] },
    { stage: 'dedup' as const, input: 3, kept: 3, dropped: [] as string[] },
];

const attemptBase = {
    runDate: '20261117',
    spec,
    stages: qcStages,
    keptIds: ['a', 'b', 'c'],
    excluded: [
        { id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' },
        { id: 'y', title: 'Y', rule: 'prc-leadership', reason: 'r', matched: '总书记' },
    ],
    recordedAt: '2026-11-17T04:30:00.000Z',
};

describe('per-attempt selection counts artifact (0392 R1)', () => {
    test('every observed stage holds input = kept + dropped, with rule hits counted separately', () => {
        const attempt = buildSelectionAttempt({ ...attemptBase, attemptId: 'run1#1' }, 1);
        expect(attempt.counts).toEqual({ preFilter: 5, kept: 3, uniqueExcluded: 2, deduped: 0, planned: null });
        expect(attempt.perRuleHits).toEqual({ 'prc-leadership': 2 });
        expect(attempt.specVersion).toBe(spec.version);
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(true);
        expect(reconciliation.uniqueIds).toBe(2);
        expect(reconciliation.ruleHits).toBe(2);
        expect(reconciliation.zeroKept).toBe(false);
        // The floor, curation and safety stages run after the QC stage writes this artifact, so
        // they are unknown here rather than assumed to be zero.
        expect(reconciliation.skippedStages).toEqual(['floor', 'curation', 'plan', 'channelAdmission']);
        expect(reconciliation.issues).toEqual([]);
    });

    test('a stage that cannot prove its own arithmetic is named, not smoothed over', () => {
        const attempt = buildSelectionAttempt(
            {
                ...attemptBase,
                attemptId: 'run1#1',
                stages: [{ stage: 'qc', input: 9, kept: 5, dropped: [] }],
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.issues).toEqual(['qc: input 9 ≠ kept 5 + dropped 0']);
    });

    test('a stage that starts from a count the previous stage never handed over is a chain break', () => {
        const attempt = buildSelectionAttempt(
            {
                ...attemptBase,
                attemptId: 'run1#1',
                stages: [
                    { stage: 'qc', input: 5, kept: 5, dropped: [] },
                    { stage: 'dedup', input: 4, kept: 3, dropped: ['dup'] },
                ],
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(false);
        expect(reconciliation.issues[0]).toContain('qc → dedup: previous kept 5 ≠ next input 4');
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
                stages: [
                    { stage: 'qc', input: 2, kept: 2, dropped: [] },
                    { stage: 'topicBoundary', input: 2, kept: 0, dropped: ['x', 'y'] },
                    { stage: 'dedup', input: 0, kept: 0, dropped: [] },
                ],
                keptIds: [],
                excluded: [
                    { id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' },
                    { id: 'y', title: 'Y', rule: 'date-conflict', reason: 'r', matched: '2026-12-01' },
                ],
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.zeroKept).toBe(true);
        expect(reconciliation.reconciled).toBe(true);
        expect(attempt.counts.kept).toBe(0);
        expect(reconciliation.skippedStages).toContain('plan');
    });

    test('a skipped stage stays unknown instead of counting as zero', () => {
        const attempt = buildSelectionAttempt(
            { ...attemptBase, attemptId: 'run1#1', stages: [qcStages[0] as (typeof qcStages)[0]] },
            1,
        );
        expect(attempt.counts.deduped).toBeNull();
        expect(attempt.counts.planned).toBeNull();
        expect(attempt.stageEvidence.dedup).toBe('unknown');
        expect(attempt.stageEvidence.qc).toBe('observed');
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.skippedStages).toEqual([
            'topicBoundary',
            'dedup',
            'floor',
            'curation',
            'plan',
            'channelAdmission',
        ]);
        // Absent evidence leaves the reconciliation unproven, never violated.
        expect(reconciliation.issues).toEqual([]);
    });

    test('a dedup day reconciles: the near-duplicate drop sits in its own stage', () => {
        const attempt = buildSelectionAttempt(
            {
                ...attemptBase,
                attemptId: 'run1#1',
                stages: [
                    { stage: 'qc', input: 5, kept: 5, dropped: [] },
                    { stage: 'topicBoundary', input: 5, kept: 4, dropped: ['x'] },
                    { stage: 'dedup', input: 4, kept: 3, dropped: ['dup'] },
                ],
                excluded: [{ id: 'x', title: 'X', rule: 'prc-leadership', reason: 'r', matched: '习近平' }],
            },
            1,
        );
        const reconciliation = reconcileSelectionAttempts([attempt]);
        expect(reconciliation.reconciled).toBe(true);
        expect(reconciliation.issues).toEqual([]);
        expect(attempt.counts.deduped).toBe(1);
        // Dedup evidence was observed, so it must not be reported as a skipped stage either.
        expect(reconciliation.skippedStages).not.toContain('dedup');
    });

    test('curation and plan amend the SAME attempt and chain their counts', () => {
        const first = recordSelectionAttempt(mkdtempSync(join(tmpdir(), 'kk-selection-amend-')), {
            ...attemptBase,
            attemptId: 'run1#1',
        });
        const amended = amendSelectionAttempt(first, '20261117', {
            stages: [
                { stage: 'curation', input: 3, kept: 2, dropped: ['c'] },
                { stage: 'plan', input: 2, kept: 2, dropped: [] },
            ],
            curationExcluded: [{ id: 'c', reason: '与主线重复的背景消息' }],
        });
        expect(amended?.attempts).toHaveLength(1);
        const latest = amended?.attempts[0];
        // The curated plan is the headline kept count, and the editorial reason is retained.
        expect(latest?.counts.kept).toBe(2);
        expect(latest?.counts.planned).toBe(2);
        expect(latest?.curationExcluded).toEqual([{ id: 'c', reason: '与主线重复的背景消息' }]);
        expect(latest?.stageEvidence.curation).toBe('observed');
        expect(latest?.stageEvidence.plan).toBe('observed');
        expect(amended?.reconciliation.reconciled).toBe(true);
        expect(amended?.reconciliation.skippedStages).toEqual(['floor', 'channelAdmission']);
    });

    test('an amend with no attempt on disk leaves the stage unknown instead of inventing one', () => {
        expect(amendSelectionAttempt(null, '20261117', { channelAdmission: [] })).toBeNull();
        const otherDay = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        expect(amendSelectionAttempt(otherDay, '20261118', {})).toBeNull();
    });

    test('channel admission is a target outcome and never moves the candidate totals', () => {
        const first = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        const amended = amendSelectionAttempt(first, '20261117', {
            channelAdmission: [
                {
                    scope: 'drafts',
                    targets: [
                        { target: 'xiaoyuzhou', decision: 'OK' },
                        { target: 'wechatmp', decision: 'BLOCK' },
                    ],
                    status: 'exclude',
                },
            ],
        });
        const latest = amended?.attempts[0];
        expect(latest?.counts).toEqual(first.attempts[0]?.counts ?? null);
        expect(latest?.stageEvidence.channelAdmission).toBe('observed');
        expect(amended?.reconciliation.skippedStages).not.toContain('channelAdmission');
        // A re-run of the same scope replaces it; a new scope appends.
        const rescoped = amendSelectionAttempt(amended ?? first, '20261117', {
            channelAdmission: [
                { scope: 'variants', targets: [{ target: 'apple-podcasts', decision: 'OK' }], status: 'pass' },
            ],
        });
        expect(rescoped?.attempts[0]?.channelAdmission.map((entry) => entry.scope)).toEqual(['drafts', 'variants']);
    });

    test('a retry appends and supersedes the earlier attempt without inheriting its reasons', () => {
        const first = appendSelectionAttempt(null, { ...attemptBase, attemptId: 'run1#1' });
        expect(first.version).toBe(SELECTION_ATTEMPTS_VERSION);
        expect(first.attempts).toHaveLength(1);
        // Retry: the second attempt excludes nothing, so the day's rule hits must come from it alone.
        const second = appendSelectionAttempt(first, {
            ...attemptBase,
            attemptId: 'run1#2',
            stages: [
                { stage: 'qc', input: 4, kept: 4, dropped: [] },
                { stage: 'topicBoundary', input: 4, kept: 4, dropped: [] },
                { stage: 'dedup', input: 4, kept: 4, dropped: [] },
            ],
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
        // The stage writer amends the CURRENT attempt, so a curation pass after the retry lands on
        // attempt 2 and never resurrects attempt 1's numbers.
        recordSelectionStage(workDir, '20261117', {
            stages: [{ stage: 'curation', input: 3, kept: 3, dropped: [] }],
        });
        expect(readSelectionAttempts(workDir)?.attempts[1]?.stageEvidence.curation).toBe('observed');
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
