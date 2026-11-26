/**
 * G83/0441 — the Generation and Publishing detail view models.
 *
 * Failure list written before the code:
 * 1. a node the run never charted still appears when `step-timing.json` recorded it, with an
 *    explicit `state unrecorded` — never a fabricated producer state;
 * 2. a missing `durationMs` renders as unknown, never as 0;
 * 3. a voice fallback row reads the same step's duration instead of claiming a gap;
 * 4. an uncaptured attempt answers `no-capture-record` rather than an empty projection;
 * 5. a planned row with no receipt never reads as succeeded;
 * 6. provenance is a three-state word (yes / no / not checked), never a silent pass;
 * 7. only a public http(s) URL becomes a link — a receipt path or a loopback URL never does;
 * 8. the diagnostics list is bounded at the documented cap.
 */

import { describe, expect, it } from 'bun:test';
import type { DailyDigest, RunEvidence } from '../../src/contracts';
import {
    generationDetail,
    isPublicHttpUrl,
    NODE_DIAGNOSTIC_CAP,
    provenanceRows,
    provenanceWord,
    publishingDetail,
} from '../../src/daily-voice/detail-view';

/** A digest with one recorded step and no window, which is the minimum a timeline needs. */
function digest(overrides: Partial<DailyDigest> = {}): DailyDigest {
    return {
        schemaVersion: 1,
        day: '20261125',
        status: 'attention',
        generation: {
            runId: 'run-25',
            launchStatus: 'done',
            exitCode: 0,
            startedAt: '2026-11-25T12:30:00Z',
            finishedAt: '2026-11-25T14:26:00Z',
            outcome: 'episode',
            attempts: [{ runId: 'run-25', capturedAt: '2026-11-25T12:30:00Z', status: 'done' }],
            bundle: null,
            durations: [
                {
                    step: 'script',
                    startedAt: '2026-11-25T12:44:30Z',
                    endedAt: '2026-11-25T12:44:31Z',
                    durationMs: 1_000,
                },
                {
                    step: 'voice',
                    startedAt: '2026-11-25T13:00:00Z',
                    endedAt: '2026-11-25T13:10:00Z',
                    durationMs: 600_000,
                },
            ],
            unknownReason: null,
        },
        windows: [],
        safety: { verdict: 'pass', judge: 'PASS', unknownReason: null },
        attention: [],
        actions: { enabled: false, lines: [] },
        sources: {},
        diagnostics: [],
        ...overrides,
    };
}

/** A news evidence envelope whose projection carries one engine chain and one progress node. */
function evidence(overrides: Partial<RunEvidence> = {}): RunEvidence {
    return {
        schemaVersion: 1,
        workflow: 'kk-news-generate',
        runId: 'run-25',
        capture: {
            capturedAt: '2026-11-25T12:30:11Z',
            stamp: '20261125',
            settings: {},
        },
        run: { id: 'run-25', status: 'done', startedAt: '2026-11-25T12:30:00Z', completedAt: null },
        results: {
            schemaVersion: 1,
            workflow: 'kk-news-generate',
            runId: 'run-25',
            availability: 'available',
            summary: {
                status: 'done',
                startedAt: '2026-11-25T12:30:00Z',
                completedAt: '2026-11-25T14:26:00Z',
                outcome: 'episode',
                generation: {
                    outcome: 'episode',
                    gate: { status: 'PASS' },
                    launch: {
                        status: 'done',
                        runId: 'run-25',
                        startedAt: null,
                        finishedAt: null,
                        reason: null,
                        stale: false,
                    },
                    engines: [
                        {
                            node: 'voice',
                            state: 'failed',
                            attempts: [{ status: 'failed', timing: '90s' }],
                        },
                        {
                            node: 'voice-fallback',
                            state: 'passed',
                            attempts: [{ status: 'passed', timing: '600s' }],
                        },
                    ],
                    progress: {
                        nodes: [{ id: 'script', status: 'passed', attempts: 1, timing: '1s' }],
                        edges: null,
                        edgesKnown: false,
                    },
                },
                publishing: { bundle: null, windows: [] },
                counts: {
                    artifactsAvailable: 1,
                    artifactsTotal: 2,
                    targetsSucceeded: 0,
                    targetsFailed: 0,
                    targetsUncertain: 0,
                    targetsPlanned: 0,
                    windowsFull: 0,
                    windowsPartial: 0,
                    windowsNone: 0,
                },
            },
            artifacts: [
                {
                    id: 'script',
                    label: 'Voice script',
                    kind: 'text',
                    mime: 'text/plain',
                    availability: 'available',
                    producerNode: 'script',
                },
                {
                    id: 'audio',
                    label: 'Episode audio',
                    kind: 'audio',
                    mime: 'audio/mpeg',
                    availability: 'missing',
                    producerNode: 'voice',
                },
            ],
            diagnostics: [],
        },
        diagnostics: [{ code: 'board.launch.receipt-invalid', message: 'the receipt is malformed' }],
        ...overrides,
    };
}

describe('generationDetail (AC1, R1)', () => {
    it('joins the recorded engine chain and progress nodes with the day’s step durations', () => {
        const detail = generationDetail(evidence(), digest());
        expect(detail.runId).toBe('run-25');
        expect(detail.captureState).toBe('captured');
        const byId = new Map(detail.timeline.map((node) => [node.id, node]));
        expect(byId.get('voice')?.durationMs).toBe(600_000);
        expect(byId.get('voice')?.status).toBe('failed');
        expect(byId.get('voice-fallback')?.durationMs).toBe(600_000);
        expect(byId.get('voice-fallback')?.engine).toBe(true);
        expect(byId.get('script')?.durationMs).toBe(1_000);
    });

    it('keeps a step the run never charted, with an explicit unrecorded state', () => {
        const detail = generationDetail(evidence(), digest());
        const script = detail.timeline.find((node) => node.id === 'script');
        expect(script?.status).toBe('passed');
        const bare = generationDetail(evidence({ results: null }), digest());
        const timed = bare.timeline.find((node) => node.id === 'voice');
        expect(timed?.status).toBe('unknown');
        expect(timed?.word).toBe('state unrecorded');
        expect(timed?.durationMs).toBe(600_000);
        expect(bare.unknownReason).toBe('no-recorded-projection');
    });

    it('answers no-capture-record for an attempt that predates capture binding', () => {
        const detail = generationDetail(evidence({ capture: null, results: null }), digest());
        expect(detail.captureState).toBe('uncaptured');
        expect(detail.unknownReason).toBe('no-capture-record');
        // The facts still render, but every unrecorded one is labelled unverified — never a value.
        expect(detail.facts.map((fact) => fact.availability)).toEqual(['available', 'unverified']);
        expect(detail.facts[1]?.value).toContain('No captured projection');
    });

    it('lists artifacts with their availability reason, never an available-and-missing row', () => {
        const detail = generationDetail(evidence(), digest());
        expect(detail.artifacts).toEqual([
            { id: 'script', label: 'Voice script', availability: 'available', reason: null },
            { id: 'audio', label: 'Episode audio', availability: 'missing', reason: 'missing' },
        ]);
    });

    it('carries the engine chain and bounds the diagnostics', () => {
        const detail = generationDetail(evidence(), digest());
        expect(detail.engines.map((engine) => engine.node)).toEqual(['voice', 'voice-fallback']);
        expect(detail.engines[1]?.label).toBe('voice-fallback (retry)');
        expect(detail.diagnostics).toHaveLength(1);
        const many = generationDetail(
            evidence({
                diagnostics: Array.from({ length: 40 }, (_, index) => ({
                    code: `board.diagnostic.${index}`,
                    message: 'bounded',
                })),
            }),
            digest(),
        );
        expect(many.diagnostics).toHaveLength(NODE_DIAGNOSTIC_CAP);
    });
});

describe('publishingDetail (AC2, R2)', () => {
    const digestWithWindow = digest({
        windows: [
            {
                window: 'after-generate',
                runId: 'kk-publish-1',
                launchStatus: 'done',
                unknownReason: null,
                recordedStatus: 'partial',
                provenance: { dateMatch: true, bundleMatch: null, parentMatch: true, digestMatch: false },
                targets: [
                    {
                        id: 'shipinhao-pub.audio',
                        tier: 0,
                        mode: 'live',
                        target: 'shipinhao-pub',
                        status: 'failed',
                        effect: 'none',
                        url: null,
                        guid: null,
                        finishedAt: null,
                        error: 'upload rejected',
                        evidence: { plan: '4-publish/plan.after-generate.json', receipt: '4-publish/receipts/a.json' },
                    },
                    {
                        id: 'x-pub.post',
                        tier: 1,
                        mode: 'live',
                        target: 'x-pub',
                        status: 'succeeded',
                        effect: 'confirmed',
                        url: 'https://x.com/i/web/status/1',
                        guid: null,
                        finishedAt: null,
                        error: null,
                        evidence: { plan: '4-publish/plan.after-generate.json', receipt: null },
                    },
                ],
            },
        ],
    });

    it('renders the matrix columns, with the receipt path as text and only a public URL as a link', () => {
        const [window] = publishingDetail(digestWithWindow);
        expect(window?.runId).toBe('kk-publish-1');
        expect(window?.recorded).toBe('partial');
        expect(window?.rows[0]).toMatchObject({
            id: 'shipinhao-pub.audio',
            tier: '0',
            mode: 'live',
            status: 'failed',
            effect: 'none',
            url: null,
            error: 'upload rejected',
            evidence: '4-publish/receipts/a.json',
        });
        expect(window?.rows[1]?.url).toBe('https://x.com/i/web/status/1');
        expect(window?.rows[1]?.tone).toBe('success');
    });

    it('reports provenance as three-state words, never a silent pass', () => {
        const [window] = publishingDetail(digestWithWindow);
        expect(window?.provenance).toEqual([
            { label: 'date', matched: true },
            { label: 'bundle', matched: null },
            { label: 'parent run', matched: true },
            { label: 'plan digest', matched: false },
        ]);
        expect(window?.provenance.map((row) => provenanceWord(row.matched))).toEqual([
            'yes',
            'not checked',
            'yes',
            'no',
        ]);
    });

    it('marks a window with no plan and no receipt as not run, with no invented row', () => {
        const [window] = publishingDetail(
            digest({
                windows: [
                    {
                        window: 'overseas-rss',
                        runId: null,
                        launchStatus: 'not-run',
                        unknownReason: null,
                        recordedStatus: null,
                        provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                        targets: [],
                    },
                ],
            }),
        );
        expect(window?.notRun).toBe(true);
        expect(window?.rows).toEqual([]);
        expect(window?.recorded).toBe('unknown');
    });

    it('keeps a plan without a receipt at planned, and its unknown reason', () => {
        const [window] = publishingDetail(
            digest({
                windows: [
                    {
                        window: 'cn-peak',
                        runId: null,
                        launchStatus: 'unknown',
                        unknownReason: 'no-launch-receipt',
                        recordedStatus: null,
                        provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                        targets: [
                            {
                                id: 'x-pub.post',
                                tier: 1,
                                mode: 'live',
                                target: 'x-pub',
                                status: 'planned',
                                effect: null,
                                url: null,
                                guid: null,
                                finishedAt: null,
                                error: null,
                                evidence: { plan: '4-publish/plan.cn-peak.json', receipt: null },
                            },
                        ],
                    },
                ],
            }),
        );
        expect(window?.rows[0]?.status).toBe('planned');
        expect(window?.rows[0]?.effect).toBe('unknown');
        expect(window?.unknownReason).toBe('no-launch-receipt');
    });
});

describe('isPublicHttpUrl (R2 anti-patterns)', () => {
    it('accepts a public https URL and refuses everything else', () => {
        expect(isPublicHttpUrl('https://x.com/i/web/status/1')).toBe(true);
        expect(isPublicHttpUrl('http://example.com/a')).toBe(true);
        expect(isPublicHttpUrl('ftp://example.com/a')).toBe(false);
        expect(isPublicHttpUrl('http://127.0.0.1:4340/api/health')).toBe(false);
        expect(isPublicHttpUrl('http://localhost/x')).toBe(false);
        expect(isPublicHttpUrl('http://192.168.1.4/x')).toBe(false);
        expect(isPublicHttpUrl('4-publish/receipts/a.json')).toBe(false);
        expect(isPublicHttpUrl(null)).toBe(false);
    });

    it('reads provenance rows from a recorded window in the design order', () => {
        expect(
            provenanceRows({
                window: 'cn-peak',
                recordedStatus: 'full',
                provenance: { dateMatch: true, bundleMatch: true, parentMatch: true, digestMatch: true },
                targets: [],
            }).map((row) => row.label),
        ).toEqual(['date', 'bundle', 'parent run', 'plan digest']);
    });
});
