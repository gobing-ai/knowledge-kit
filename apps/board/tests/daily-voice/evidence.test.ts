/**
 * 0390 — the news module's evidence narrowing (`./evidence.ts`) without a DOM.
 *
 * Failure-first list:
 * 1. a projection that predates a field narrows to null/unknown words, never a crash or an invented zero;
 * 2. only the recorded state vocabulary produces tone words — anything else passes through as neutral;
 * 3. uncaptured attempts surface exactly the `board.evidence.uncaptured` diagnostic, not results;
 * 4. artifact groups come from manifest producer keys in stage order; availability is the reader's;
 * 5. the latest actionable issue prefers a failed/uncertain target, then a stale receipt, then diagnostics.
 */

import { describe, expect, it } from 'bun:test';
import type { RunEvidence, RunResults } from '../../src/contracts';
import {
    captureState,
    engineNodeLabel,
    engineStateWord,
    generationStageRows,
    isNewsEvidence,
    latestIssue,
    newsSummaryFacts,
    newsSummaryOf,
    newsSummaryOfResults,
    outputGroups,
    provenanceRows,
    publishingWindowRows,
    targetStateWord,
    uncapturedDiagnostic,
    windowLabel,
    windowStateWord,
} from '../../src/daily-voice/evidence';

function evidence(overrides: Partial<RunEvidence> = {}, summary: Record<string, unknown> | null = null): RunEvidence {
    return {
        schemaVersion: 1,
        workflow: 'kk-news-generate',
        runId: 'run-1',
        capture: {
            capturedAt: '2026-11-17T09:00:00.000Z',
            stamp: '20261117',
            settings: { window: '24h', skip_review: 'true' },
        },
        run: {
            id: 'run-1',
            status: 'done',
            startedAt: '2026-11-17T09:00:00.000Z',
            completedAt: '2026-11-17T09:10:00.000Z',
        },
        results:
            summary === null
                ? null
                : ({
                      schemaVersion: 1,
                      workflow: 'kk-news-generate',
                      runId: 'run-1',
                      availability: 'available',
                      summary,
                      artifacts: [],
                      diagnostics: [],
                  } as RunResults),
        diagnostics: [],
        ...overrides,
    };
}

const fullSummary: Record<string, unknown> = {
    status: 'done',
    startedAt: '2026-11-17T09:00:00.000Z',
    completedAt: '2026-11-17T09:10:00.000Z',
    outcome: 'done',
    generation: {
        outcome: 'done',
        gate: { status: 'PASS' },
        launch: {
            status: 'done',
            runId: 'run-1',
            startedAt: '2026-11-17T09:00:00.000Z',
            finishedAt: '2026-11-17T09:05:00.000Z',
            reason: null,
            stale: false,
        },
        engines: [
            { node: 'voice', state: 'failure', attempts: [{ status: 'failed', timing: '12s' }] },
            {
                node: 'voice-fallback',
                state: 'success',
                attempts: [
                    { status: 'failed', timing: '9s' },
                    { status: 'passed', timing: '40s' },
                ],
            },
        ],
        progress: {
            nodes: [
                { id: 'voice', status: 'success', timing: '40s' },
                { id: 'freeze', status: 'success', timing: '2s' },
            ],
            edgesKnown: false,
        },
    },
    publishing: {
        bundle: {
            identity: '20261117-kk-news-generate',
            runDate: '20261117',
            parentRunId: 'parent-1',
            title: '每日AI乱炖',
            variants: ['podcast', 'xhs'],
            safety: 'pass',
        },
        windows: [
            {
                window: 'after-generate',
                recordedStatus: 'full',
                provenance: { dateMatch: true, bundleMatch: true, parentMatch: false, digestMatch: null },
                targets: [
                    {
                        id: 'podcast-cn',
                        tier: 1,
                        mode: 'live',
                        target: 'podcast-cn',
                        status: 'succeeded',
                        effect: 'confirmed',
                        url: 'https://example.com/ep',
                        guid: 'g1',
                        finishedAt: '2026-11-17T09:06:00.000Z',
                        error: null,
                        evidence: { plan: '4-publish/plan.json', receipt: '4-publish/receipts/podcast-cn.json' },
                    },
                ],
            },
            {
                window: 'cn-peak',
                recordedStatus: 'partial',
                provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                targets: [
                    {
                        id: 'xhs-cn',
                        status: 'uncertain',
                        effect: 'unknown',
                        url: null,
                        guid: null,
                        finishedAt: null,
                        error: 'receipt digest mismatch',
                        evidence: { plan: '4-publish/plan.cn.json', receipt: null },
                    },
                ],
            },
        ],
    },
    counts: {
        artifactsAvailable: 12,
        artifactsTotal: 27,
        targetsSucceeded: 1,
        targetsFailed: 0,
        targetsUncertain: 1,
        targetsPlanned: 0,
        windowsFull: 1,
        windowsPartial: 1,
        windowsNone: 0,
    },
};

/** The fully-recorded projection, narrowed once for the tests that assert on it. */
function fullNews() {
    const news = newsSummaryOf(evidence({}, fullSummary));
    if (news === null) throw new Error('fixture projection failed to narrow');
    return news;
}

/** A window/target with no recorded fields, for fallback assertions. */
function fallbackWindow() {
    const news = newsSummaryOf(evidence({}, { publishing: { windows: [{ window: 'cn-peak', targets: [] }] } }));
    const windowRow = news?.publishing.windows[0];
    if (windowRow === undefined) throw new Error('fixture window failed to narrow');
    return windowRow;
}

function unknownTarget() {
    const row = fullNews().publishing.windows[1]?.targets[0];
    if (row === undefined) throw new Error('fixture target failed to narrow');
    return row;
}

function staleNews() {
    const news = newsSummaryOf(
        evidence(
            {},
            {
                ...fullSummary,
                publishing: { ...(fullSummary.publishing as object), windows: [] },
                generation: {
                    ...(fullSummary.generation as object),
                    launch: { ...(fullSummary.generation as { launch: object }).launch, stale: true, runId: 'other' },
                },
            },
        ),
    );
    if (news === null) throw new Error('fixture projection failed to narrow');
    return news;
}

describe('captureState and uncaptured attempts', () => {
    it('reports captured vs uncaptured and the single uncaptured diagnostic', () => {
        expect(captureState(evidence())).toBe('captured');
        const uncaptured = evidence(
            {
                capture: null,
                results: null,
                diagnostics: [{ code: 'board.evidence.uncaptured', message: 'no capture record' }],
            },
            null,
        );
        expect(captureState(uncaptured)).toBe('uncaptured');
        expect(uncapturedDiagnostic(uncaptured)?.message).toBe('no capture record');
        expect(uncapturedDiagnostic(evidence())).toBeNull();
        // A captured run carries no uncaptured diagnostic; a captured-but-unlisted code stays null.
        expect(uncapturedDiagnostic(evidence({ diagnostics: [{ code: 'board.other', message: 'x' }] }))).toBeNull();
    });

    it('narrows an uncaptured envelope to a null projection with authorized run state only', () => {
        expect(newsSummaryOf(evidence({ capture: null, results: null }, null))).toBeNull();
        const facts = newsSummaryFacts(
            evidence(
                {
                    capture: null,
                    results: null,
                    run: { id: 'r', status: 'running', startedAt: null, completedAt: null },
                },
                null,
            ),
        );
        expect(facts[0]).toEqual({ label: 'Status', value: 'running', availability: 'available' });
        expect(facts[1]?.availability).toBe('unverified');
    });
});

describe('newsSummaryOf narrowing', () => {
    it('narrowed the full projection: outcome, gate, launch, bundle, windows and counts', () => {
        const news = newsSummaryOf(evidence({}, fullSummary));
        expect(news?.outcome).toBe('done');
        expect(news?.generation.gate.status).toBe('PASS');
        expect(news?.generation.launch.stale).toBe(false);
        expect(news?.publishing.bundle?.title).toBe('每日AI乱炖');
        expect(news?.publishing.windows).toHaveLength(2);
        expect(news?.counts.targetsUncertain).toBe(1);
    });

    it('degrades a projection that predates fields to null words and empty rows', () => {
        const news = newsSummaryOf(evidence({}, { status: 'done' }));
        expect(news?.outcome).toBeNull();
        expect(news?.generation.engines).toEqual([]);
        expect(news?.publishing.bundle).toBeNull();
        expect(news?.publishing.windows).toEqual([]);
        // An unrecorded count is null — the module's unrecorded word, never an invented zero.
        expect(news?.counts.artifactsTotal).toBeNull();
        expect(news?.counts.targetsSucceeded).toBeNull();
    });

    it('returns null for a non-record summary bag', () => {
        expect(newsSummaryOfResults({} as unknown as RunResults)).toBeNull();
        expect(newsSummaryOf(evidence({}, { status: 42 }))).not.toBeNull();
    });

    it('drops malformed engine/window/target rows instead of rendering broken values', () => {
        const news = newsSummaryOf(
            evidence(
                {},
                {
                    generation: {
                        engines: [
                            'nope',
                            { attempts: 'x' },
                            { node: 'voice', state: 'pending', attempts: [null, { status: 'failed', timing: '1s' }] },
                        ],
                    },
                    publishing: { windows: [42, { window: 'cn-peak', targets: [{}, { id: 'x' }] }] },
                },
            ),
        );
        // A non-object row is dropped; an object without recorded fields degrades to the unknown word.
        expect(news?.generation.engines).toEqual([
            { node: 'unknown', state: 'unknown', attempts: [] },
            { node: 'voice', state: 'pending', attempts: [{ status: 'failed', timing: '1s' }] },
        ]);
        expect(news?.publishing.windows).toHaveLength(1);
        expect(news?.publishing.windows[0]?.targets).toHaveLength(1);
    });
});

describe('state words', () => {
    it('maps the recorded producer vocabulary to words with tones and passes unknowns through neutrally', () => {
        expect(engineStateWord('success')).toEqual({ word: 'done', tone: 'success' });
        expect(engineStateWord('failure')).toEqual({ word: 'failed', tone: 'error' });
        expect(engineStateWord('pending')).toEqual({ word: 'active', tone: 'info' });
        expect(engineStateWord('weird')).toEqual({ word: 'weird', tone: 'neutral' });
    });

    it('maps target and window states, and unknown target statuses fall back neutrally', () => {
        const succeeded = fullNews().publishing.windows[0]?.targets[0];
        const uncertain = unknownTarget();
        expect(succeeded === undefined || targetStateWord(succeeded).word === 'sent').toBe(true);
        expect(targetStateWord(succeeded ?? unknownTarget())).toEqual({ word: 'sent', tone: 'success' });
        expect(targetStateWord(uncertain)).toEqual({ word: 'uncertain', tone: 'warn' });
        expect(targetStateWord({ ...uncertain, status: 'skipped' as const })).toEqual({
            word: 'skipped',
            tone: 'neutral',
        });
        expect(windowStateWord('full')).toEqual({ word: 'all targets sent', tone: 'success' });
        expect(windowStateWord('none')).toEqual({ word: 'nothing sent', tone: 'error' });
        expect(windowStateWord(null)).toBeNull();
    });

    it('labels known windows and DAG nodes, and keeps unknown ids as-is', () => {
        expect(windowLabel('after-generate')).toBe('After generate');
        expect(windowLabel('cn-peak')).toBe('CN peak');
        expect(windowLabel('other')).toBe('other');
        expect(engineNodeLabel('voice-fallback')).toBe('Generate audio (retry A)');
        expect(engineNodeLabel('mystery')).toBe('mystery');
    });

    it('renders provenance checks in the fixed identity order', () => {
        const rows = provenanceRows(fullNews().publishing.windows[0] ?? fallbackWindow());
        expect(rows.map((r) => r.matched)).toEqual([true, true, false, null]);
        expect(rows[2]?.label).toContain('parent run');
    });
});

describe('generationStageRows', () => {
    it('puts the engine chain first with attempt counts, then unrecorded-by-engine progress nodes', () => {
        const rows = generationStageRows(fullNews());
        expect(rows[0]?.label).toBe('Generate audio');
        expect(rows[0]?.word).toBe('failed');
        // The fallback engine folds two attempts into one row.
        expect(rows[1]?.word).toBe('done after 2 attempts');
        expect(rows[1]?.timing).toBe('40s');
        // `voice` appears in progress too, so only `freeze` is appended after the engines.
        expect(rows.map((r) => r.id)).toEqual(['voice', 'voice-fallback', 'freeze']);
    });

    it('falls back to progress nodes alone when no engines were recorded', () => {
        const news = newsSummaryOf(
            evidence({}, { generation: { progress: { nodes: [{ id: 'curate', status: 'success' }] } } }),
        );
        if (news === null) throw new Error('fixture projection failed to narrow');
        const rows = generationStageRows(news);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.word).toBe('done');
    });
});

describe('publishingWindowRows', () => {
    it('carries recorded words, provenance rows and enriched target rows in recorded order', () => {
        const rows = publishingWindowRows(fullNews());
        expect(rows.map((r) => r.label)).toEqual(['After generate', 'CN peak']);
        expect(rows[0]?.recorded?.word).toBe('all targets sent');
        expect(rows[1]?.targets[0]?.word).toBe('uncertain');
        expect(rows[1]?.targets[0]?.evidence.receipt).toBeNull();
    });
});

describe('outputGroups', () => {
    it('groups reader-resolved artifact views by manifest producer in stage order', () => {
        const projection = evidence({}, fullSummary).results;
        if (projection === null) throw new Error('fixture projection missing');
        const results = projection;
        const withArtifacts = [
            { id: 'script', label: 'Script', kind: 'text', availability: 'available', producerNode: 'script-write' },
            { id: 'audio', label: 'Episode audio', kind: 'audio', availability: 'available', producerNode: 'voice' },
            { id: 'bundle', label: 'Bundle', kind: 'text', availability: 'missing', producerNode: 'freeze' },
            { id: 'mystery', label: 'Mystery', kind: 'text', availability: 'available', producerNode: 'unlisted' },
        ] as unknown as RunResults['artifacts'];
        const groups = outputGroups(
            { ...results, artifacts: withArtifacts },
            (_workflow, _runId, artifactId) => `/artifacts/${artifactId}`,
        );
        // Known producers get human labels in stage order; an unlisted producer keeps its raw id.
        expect(groups.map((g) => g.label)).toEqual(['Write script', 'Generate audio', 'Freeze bundle', 'unlisted']);
        expect(groups[1]?.artifacts).toHaveLength(1);
        expect(groups[3]?.artifacts[0]?.state).toBe('Available');
    });
});

describe('newsSummaryFacts', () => {
    it('keeps recorded values and never infers availability from a timestamp', () => {
        const facts = newsSummaryFacts(evidence({}, fullSummary));
        const byLabel = Object.fromEntries(facts.map((f) => [f.label, f]));
        expect(byLabel.Outcome?.availability).toBe('available');
        expect(byLabel.Completed?.value).toContain('2026');
        expect(byLabel.Publishing?.value).toBe('1 sent, 1 failed or uncertain');
        // A two-day-old completed run still reads the RECORDED word: DTO honesty rule 1 forbids
        // deriving availability from age, so nothing here turns `superseded` on by itself.
        const old = newsSummaryFacts(
            evidence({}, { ...fullSummary, startedAt: '2020-01-01T00:00:00.000Z', completedAt: 'nonsense' }),
        );
        const oldByLabel = Object.fromEntries(old.map((f) => [f.label, f]));
        expect(oldByLabel.Started?.availability).toBe('available');
        expect(oldByLabel.Completed?.availability).toBe('available');
        // The envelope's own recorded word is what shows through, and only on recorded values.
        const superseded = newsSummaryFacts(
            evidence(
                {
                    results: {
                        schemaVersion: 1,
                        workflow: 'kk-news-generate',
                        runId: 'run-1',
                        availability: 'superseded',
                        summary: fullSummary,
                        artifacts: [],
                        diagnostics: [],
                    } as RunResults,
                },
                fullSummary,
            ),
        );
        expect(Object.fromEntries(superseded.map((f) => [f.label, f])).Started?.availability).toBe('superseded');
        // An unrecorded timestamp stays `missing` whatever the envelope says.
        const noStamps = newsSummaryFacts(
            evidence({}, { ...fullSummary, startedAt: undefined, completedAt: undefined }),
        );
        const noStampsByLabel = Object.fromEntries(noStamps.map((f) => [f.label, f]));
        expect(noStampsByLabel.Started?.value).toBe('not recorded');
        expect(noStampsByLabel.Started?.availability).toBe('missing');
    });

    it('labels a recorded value available even when the run-level roll-up reads missing', () => {
        const base = evidence({}, fullSummary);
        const rolledUp = {
            ...base,
            results: { ...(base.results as NonNullable<RunEvidence['results']>), availability: 'missing' as const },
        };
        const byLabel = Object.fromEntries(newsSummaryFacts(rolledUp).map((f) => [f.label, f]));
        // The roll-up word describes the run's artifact set, not an individual recorded value.
        expect(byLabel.Started?.availability).toBe('available');
        expect(byLabel.Completed?.availability).toBe('available');
        expect(byLabel.Publishing?.availability).toBe('available');
    });

    it('renders an unrecorded word for counts the projection never recorded', () => {
        const absent = newsSummaryFacts(evidence({}, { status: 'done', generation: {}, publishing: {}, counts: {} }));
        const absentByLabel = Object.fromEntries(absent.map((f) => [f.label, f]));
        expect(absentByLabel.Outcome?.availability).toBe('missing');
        // A projection predating `counts` is unrecorded — never "0 available of 0" / "0 sent".
        expect(absentByLabel.Artifacts?.value).toBe('not recorded');
        expect(absentByLabel.Artifacts?.availability).toBe('unverified');
        expect(absentByLabel.Publishing?.value).toBe('not recorded');
        expect(absentByLabel.Publishing?.availability).toBe('unverified');
        // Recorded zeros are still zeros: only a MISSING count degrades.
        const zeros = newsSummaryFacts(
            evidence(
                {},
                {
                    ...fullSummary,
                    counts: {
                        artifactsAvailable: 0,
                        artifactsTotal: 0,
                        targetsSucceeded: 0,
                        targetsFailed: 0,
                        targetsUncertain: 0,
                    },
                },
            ),
        );
        const zerosByLabel = Object.fromEntries(zeros.map((f) => [f.label, f]));
        expect(zerosByLabel.Artifacts?.value).toBe('0 available of 0');
        // A recorded zero is recorded data — labelling it `missing` would contradict the value shown.
        expect(zerosByLabel.Artifacts?.availability).toBe('available');
        expect(zerosByLabel.Publishing?.value).toBe('0 sent');
        expect(zerosByLabel.Publishing?.availability).toBe('available');
        // A PARTIALLY recorded set is unrecorded too: the sum would have to invent the rest.
        const partial = newsSummaryFacts(evidence({}, { ...fullSummary, counts: { targetsSucceeded: 0 } }));
        expect(Object.fromEntries(partial.map((f) => [f.label, f])).Publishing?.value).toBe('not recorded');
    });
});

describe('latestIssue', () => {
    it('prefers the first failed/uncertain target over a stale receipt and diagnostics', () => {
        const news = newsSummaryOf(evidence({}, fullSummary));
        expect(latestIssue(news, [{ code: 'board.x', message: 'boom' }])?.title).toContain('xhs-cn uncertain');
        const stale = staleNews();
        expect(latestIssue(stale, [])?.title).toContain('another run');
        expect(latestIssue(null, [{ code: 'board.e', message: 'reader offline' }])).toEqual({
            title: 'board.e',
            detail: 'reader offline',
        });
        expect(latestIssue(null, [])).toBeNull();
    });
});

describe('isNewsEvidence', () => {
    it('accepts only the current news family envelope', () => {
        expect(isNewsEvidence(evidence())).toBe(true);
        expect(isNewsEvidence(evidence({ workflow: 'kk-daily-ai-voice2' }))).toBe(false);
    });
});
