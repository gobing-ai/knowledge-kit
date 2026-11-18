/**
 * 0391 — the news projection: a current `kk-news-generate` attempt bound to Board evidence.
 *
 * Failure-first list (written before the code):
 * 1. a plan/receipt/outcome file binds to THIS attempt by identity (digest, parent run, date,
 *    bundle), never by timestamp or directory name — a mismatch is a diagnostic plus a withheld
 *    fact, never a rewritten status;
 * 2. a malformed recorded receipt/plan/outcome is reported, its contents never surfaced;
 * 3. a receipt row id that is not a safe token is never read (an id is never a path);
 * 4. a loud fallback that recorded success authorises the SAME fixed artifact (voice chain);
 * 5. a superseded (foreign-marker) workspace serves no publish bytes at all;
 * 6. outcome/receipt disagreement is reported; neither file silently overrides the other;
 * 7. a launch receipt naming another run is stale: reported, not treated as this attempt's state;
 * 8. a no-content day and an empty workspace stay explicit unknowns, never invented outcomes.
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    RunCapture,
    RunResults,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import type { ArtifactObservation } from '../../src/board/collect';
import { dagProducerState, sanitizeFunnelArtifact } from '../../src/board/daily-voice';
import { type ArtifactSpec, expandPattern, type MarkerState } from '../../src/board/manifest';
import { type NewsSummary, projectNewsResults } from '../../src/board/news';

const STAMP = '20261117';
const RUN_ID = 'kk-news-generate-20261117-1763370000000';

/** The plan digest the receipts must carry — the writer hashed the same bytes it wrote. */
const digestOf = (text: string): string => createHash('sha256').update(text).digest('hex');

/** One window's publish plan as the matrix records it (`4-publish/plan.<window>.json`). */
function planText(
    rows: Record<string, unknown>[] | undefined = undefined,
    excluded: Record<string, unknown>[] | undefined = undefined,
): string {
    return JSON.stringify({
        schemaVersion: 1,
        window: 'after-generate',
        bundleRunId: 'bundle-1',
        parentRunId: 'parent-1',
        presetName: 'daily-ai-voice',
        presetDigest: 'sha256:aa',
        runDate: STAMP,
        rows: rows ?? [
            {
                id: 'podcast-cn',
                plugin: 'podcast',
                variant: 'podcast',
                tier: 1,
                window: 'after-generate',
                mode: 'live',
                required: true,
                approval: 'none',
                status: 'planned',
                transport: 'fanout',
                payloadPath: '30-variants/podcast/episode.json',
                payloadDigest: 'sha256:bb',
            },
            {
                id: 'xhs-cn',
                plugin: 'xhs',
                variant: 'xhs',
                tier: 2,
                window: 'after-generate',
                mode: 'draft',
                required: false,
                approval: 'none',
                status: 'planned',
                transport: 'browser',
                payloadPath: '30-variants/xhs/thread.json',
                payloadDigest: 'sha256:cc',
            },
        ],
        excluded: excluded ?? [
            { id: 'rss-off', plugin: 'rss', reason: 'mode: off' },
            { id: '../escape', plugin: 'rss', reason: 'an unsafe id stays unread' },
        ],
    });
}

/** A receipt bound to the plan above (`4-publish/receipts/<id>.json`). */
function receiptText(overrides: Record<string, unknown> = {}, digest = digestOf(planText())): string {
    return JSON.stringify({
        schemaVersion: 1,
        parentRunId: 'parent-1',
        planDigest: digest,
        plugin: 'podcast',
        profile: 'default',
        mode: 'live',
        attemptId: 'attempt-1',
        status: 'succeeded',
        effect: 'confirmed',
        target: 'podcast-cn',
        window: 'after-generate',
        url: 'https://example.com/episode',
        guid: 'episode-guid',
        finishedAt: '2026-11-17T06:00:00.000Z',
        ...overrides,
    });
}

/** The window's recorded group truth (`4-publish/outcome.<window>.json`). */
function outcomeText(overrides: Record<string, unknown> = {}, runDate = STAMP): string {
    return JSON.stringify({
        schemaVersion: 1,
        window: 'after-generate',
        runDate,
        status: 'full',
        published: 1,
        targets: 2,
        excluded: [],
        rows: [
            { id: 'podcast-cn', tier: 1, required: true, status: 'succeeded', dummy: false },
            { id: 'xhs-cn', tier: 2, required: false, status: 'missing', dummy: false },
        ],
        ...overrides,
    });
}

/** The bounded workspace files the default scenario reads; `null` deletes, text overrides. */
function newsWorkspace(overrides: Record<string, string | null> = {}, plan = planText()): Record<string, string> {
    const files: Record<string, string> = {
        'pool-gate.json': JSON.stringify({ status: 'PASS' }),
        'run-report.summary.txt': 'run ok',
        'schedule-receipt.json': JSON.stringify({
            runId: RUN_ID,
            status: 'done',
            startedAt: '2026-11-17T04:30:00.000Z',
            finishedAt: '2026-11-17T05:10:00.000Z',
        }),
        'bundle.json': JSON.stringify({
            runId: 'bundle-1',
            runDate: STAMP,
            parentRunId: 'parent-1',
            episode: { title: '每日AI乱炖' },
            variants: { podcast: {}, xhs: {} },
            safety: { status: 'pass' },
        }),
        '4-publish/plan.after-generate.json': plan,
        '4-publish/receipts/podcast-cn.json': receiptText(undefined, digestOf(plan)),
        '4-publish/outcome.after-generate.json': outcomeText(),
    };
    for (const [relative, text] of Object.entries(overrides)) {
        if (text === null) delete files[relative];
        else files[relative] = text;
    }
    return files;
}

/** The news DAG action rows; every node passed unless overridden. */
function newsActions(overrides: Record<string, { status: string; ok: boolean }> = {}): unknown[] {
    const nodes = [
        'prepare',
        'curate',
        'script-write',
        'editorial-judge',
        'render',
        'safety',
        'voice',
        'voice-fallback',
        'voice-fallback2',
        'cards',
        'safety-variants',
        'freeze',
    ];
    return nodes.map((node) => {
        const override = overrides[node];
        return {
            id: `${node}-1`,
            node,
            status: override?.status ?? 'passed',
            ok: override?.ok ?? true,
            durationMs: 1200,
        };
    });
}

/** Run the pure projection over an in-memory workspace, mirroring the reader's wiring. */
async function project(
    files: Record<string, string> = newsWorkspace(),
    actions: unknown[] = newsActions(),
    marker: MarkerState = 'owned',
): Promise<{ results: RunResults; summary: NewsSummary; reads: string[] }> {
    const reads: string[] = [];
    const observe = (relative: string): ArtifactObservation => {
        const text = files[relative];
        return text === undefined
            ? { state: 'absent' }
            : { state: 'present', bytes: text.length, text, path: `/w/${relative}` };
    };
    const record: RunCapture = {
        schemaVersion: 1,
        projectPath: '/proj',
        workflow: 'kk-news-generate' as WorkflowName,
        runId: RUN_ID,
        workspacePath: '/proj/.works/kk-news-generate/20261117',
        stamp: STAMP,
        capturedAt: '2026-11-17T04:29:00.000Z',
        settings: { skip_review: 'true' },
    };
    const results = await projectNewsResults({
        record,
        detail: { id: RUN_ID, workflowName: 'kk-news-generate', status: 'done' },
        marker,
        actions,
        producerOf: (spec: ArtifactSpec) => dagProducerState(actions, spec.producerNode, spec.producerFallbackNodes),
        observationOf: (spec: ArtifactSpec) => observe(expandPattern(spec.pattern, STAMP)),
        readWorkspaceFile: (relative: string) => {
            reads.push(relative);
            return Promise.resolve(observe(relative));
        },
    });
    return { results, summary: results.summary as unknown as NewsSummary, reads };
}

describe('projectNewsResults — publish provenance (0391 R2)', () => {
    it('binds plan, receipt and outcome identities for a full window and counts the targets', async () => {
        const { results, summary, reads } = await project();
        expect(results.schemaVersion).toBe(1);
        expect(summary.status).toBe('done');
        expect(summary.outcome).toBe('done');
        expect(summary.generation.gate).toEqual({ status: 'PASS' });
        expect(summary.generation.launch).toMatchObject({ status: 'done', runId: RUN_ID, stale: false });
        expect(summary.publishing.bundle).toMatchObject({
            identity: 'bundle-1',
            runDate: STAMP,
            parentRunId: 'parent-1',
            title: '每日AI乱炖',
            variants: ['podcast', 'xhs'],
            safety: 'pass',
        });
        const [window] = summary.publishing.windows;
        expect(window?.window).toBe('after-generate');
        expect(window?.recordedStatus).toBe('full');
        expect(window?.provenance).toEqual({
            dateMatch: true,
            bundleMatch: true,
            parentMatch: true,
            digestMatch: true,
        });
        const [podcast, xhs, rss] = window?.targets ?? [];
        expect(podcast).toMatchObject({
            id: 'podcast-cn',
            status: 'succeeded',
            effect: 'confirmed',
            url: 'https://example.com/episode',
            guid: 'episode-guid',
            evidence: { plan: '4-publish/plan.after-generate.json', receipt: '4-publish/receipts/podcast-cn.json' },
        });
        expect(xhs).toMatchObject({ id: 'xhs-cn', status: 'planned', evidence: { receipt: null } });
        expect(rss).toMatchObject({ id: 'rss-off', status: 'skipped', error: 'mode: off' });
        expect(summary.counts).toMatchObject({
            targetsSucceeded: 1,
            targetsPlanned: 1,
            windowsFull: 1,
            artifactsTotal: results.artifacts.length,
        });
        // Every workspace read stayed inside the fixed publish vocabulary — never a plan-derived path.
        for (const read of reads) {
            expect(read === 'schedule-receipt.json' || read.startsWith('4-publish/')).toBe(true);
        }
        // The other two windows are unplanned: empty groups, no diagnostics.
        expect(summary.publishing.windows).toHaveLength(3);
        expect(summary.publishing.windows[1]).toMatchObject({ targets: [], recordedStatus: null });
        const codes = results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code);
        expect(codes).not.toContain('board.publish.receipt-mismatch');
        expect(codes).not.toContain('board.publish.outcome-disagreement');
    });

    it('reports a receipt that does not bind to this attempt and withholds its send facts', async () => {
        const plan = planText();
        const { summary, results } = await project(
            newsWorkspace(
                {
                    '4-publish/receipts/podcast-cn.json': receiptText(
                        { url: 'https://evil.example/x' },
                        'sha256:wrong',
                    ),
                },
                plan,
            ),
        );
        const [podcast] = summary.publishing.windows[0]?.targets ?? [];
        expect(podcast).toMatchObject({ id: 'podcast-cn', status: 'uncertain', url: null, effect: null });
        expect(summary.publishing.windows[0]?.provenance.digestMatch).toBe(false);
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.receipt-mismatch',
        );
    });

    it('never reads a receipt for an unsafe target id', async () => {
        const unsafePlan = planText(
            [
                {
                    id: '../evil',
                    plugin: 'podcast',
                    variant: 'podcast',
                    tier: 1,
                    window: 'after-generate',
                    mode: 'live',
                    required: true,
                    approval: 'none',
                    status: 'planned',
                    payloadPath: 'x',
                    payloadDigest: 'sha256:bb',
                },
            ],
            [],
        );
        const { summary, reads } = await project(newsWorkspace({}, unsafePlan));
        const [window] = summary.publishing.windows;
        expect(window?.targets[0]).toMatchObject({ id: '../evil', status: 'planned' });
        expect(reads).not.toContain('4-publish/receipts/../evil.json');
        expect(window?.provenance.digestMatch).toBeNull();
    });
});

describe('projectNewsResults — honesty rules (0391 R3)', () => {
    it('withholds publish bytes from a superseded workspace and reports the marker', async () => {
        const { summary, results, reads } = await project(newsWorkspace(), newsActions(), 'foreign');
        expect(summary.publishing).toEqual({ bundle: null, windows: [] });
        expect(results.artifacts.every((artifact) => artifact.availability === 'superseded')).toBe(true);
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.artifact.superseded',
        );
        expect(reads.some((read) => read.startsWith('4-publish/'))).toBe(false);
    });

    it('reports a malformed receipt as uncertain without surfacing its contents', async () => {
        const plan = planText();
        const { summary, results } = await project(
            newsWorkspace({ '4-publish/receipts/podcast-cn.json': 'not json {' }, plan),
        );
        const [podcast] = summary.publishing.windows[0]?.targets ?? [];
        expect(podcast).toMatchObject({ id: 'podcast-cn', status: 'uncertain', url: null, effect: null });
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.receipt-invalid',
        );
    });

    it('reports an outcome that names another run date as not this window truth', async () => {
        const { summary, results } = await project(
            newsWorkspace({ '4-publish/outcome.after-generate.json': outcomeText({}, '20261116') }),
        );
        expect(summary.publishing.windows[0]?.recordedStatus).toBeNull();
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.outcome-mismatch',
        );
    });

    it('reports outcome/receipt disagreement while surfacing both as recorded', async () => {
        const { summary, results } = await project(
            newsWorkspace({
                '4-publish/outcome.after-generate.json': outcomeText({
                    status: 'none',
                    rows: [{ id: 'podcast-cn', tier: 1, required: true, status: 'failed', dummy: false }],
                }),
            }),
        );
        const [podcast] = summary.publishing.windows[0]?.targets ?? [];
        expect(podcast?.status).toBe('succeeded');
        expect(summary.publishing.windows[0]?.recordedStatus).toBe('none');
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.outcome-disagreement',
        );
    });

    it('reports a malformed plan without surfacing it', async () => {
        const { summary, results } = await project(
            newsWorkspace({ '4-publish/plan.after-generate.json': 'garbage{' }, planText()),
        );
        const [window] = summary.publishing.windows;
        expect(window?.targets).toEqual([]);
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.plan-invalid',
        );
    });

    it('falls back to run identity when the bundle is malformed and binds no bundle match', async () => {
        const { summary, results } = await project(newsWorkspace({ 'bundle.json': 'garbage{' }));
        expect(summary.publishing.bundle).toBeNull();
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.publish.bundle-invalid',
        );
        expect(summary.publishing.windows[0]?.provenance).toMatchObject({ bundleMatch: null, parentMatch: false });
    });

    it('keeps a no-content day explicit', async () => {
        const { summary } = await project(
            newsWorkspace({
                'run-report.summary.txt': 'no-content: the store pool was empty',
                'pool-gate.json': JSON.stringify({ status: 'EMPTY' }),
            }),
        );
        expect(summary.outcome).toBe('no-content');
        expect(summary.generation.outcome).toBe('no-content');
        expect(summary.generation.gate).toEqual({ status: 'EMPTY' });
    });

    it('reports a launch receipt naming another run as stale, never as this attempt', async () => {
        const { summary, results } = await project(
            newsWorkspace({ 'schedule-receipt.json': JSON.stringify({ runId: 'other-run', status: 'done' }) }),
        );
        expect(summary.generation.launch).toMatchObject({ runId: 'other-run', stale: true });
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.launch.receipt-mismatch',
        );
    });

    it('reports a malformed launch receipt and stays null', async () => {
        const { summary, results } = await project(newsWorkspace({ 'schedule-receipt.json': '{bad' }));
        expect(summary.generation.launch.status).toBeNull();
        expect(summary.generation.launch.stale).toBe(false);
        expect(results.diagnostics.map((diagnostic: BoardDiagnostic) => diagnostic.code)).toContain(
            'board.launch.receipt-invalid',
        );
    });

    it('serves explicit unknowns when nothing was recorded', async () => {
        const { summary } = await project({});
        expect(summary.outcome).toBeNull();
        expect(summary.generation.gate).toEqual({ status: null });
        expect(summary.generation.launch).toEqual({
            status: null,
            runId: null,
            startedAt: null,
            finishedAt: null,
            reason: null,
            stale: false,
        });
        expect(summary.publishing.bundle).toBeNull();
        expect(summary.publishing.windows.every((window) => window.targets.length === 0)).toBe(true);
    });
});

describe('projectNewsResults — engine attempts (0391 R2 fallback chain)', () => {
    it('authorises audio through the loud fallback chain and renders engine attempts', async () => {
        const actions = newsActions({
            voice: { status: 'failed', ok: false },
            'voice-fallback': { status: 'passed', ok: true },
        }).map((row) => {
            const record = row as { node: string };
            return record.node === 'voice-fallback2'
                ? {
                      id: 'vf2-1',
                      node: 'voice-fallback2',
                      status: 'done',
                      ok: true,
                      startedAt: '2026-11-17T05:00:00Z',
                      completedAt: '2026-11-17T05:01:00Z',
                  }
                : row;
        });
        const { results, summary } = await project(
            newsWorkspace({ '30-audio/20261117_11_generate_content.mp3': 'MP3-BYTES' }),
            actions,
        );
        const audio = results.artifacts.find((artifact: ArtifactDescriptor) => artifact.id === 'audio');
        expect(audio?.availability).toBe('available');
        const [voice, fallback, fallback2] = summary.generation.engines;
        expect(voice).toMatchObject({ node: 'voice', state: 'failure' });
        expect(fallback).toMatchObject({ node: 'voice-fallback', state: 'success' });
        expect(fallback2).toMatchObject({
            node: 'voice-fallback2',
            state: 'success',
            attempts: [{ status: 'done', timing: '2026-11-17T05:00:00Z → 2026-11-17T05:01:00Z' }],
        });
        expect(voice?.attempts[0]).toMatchObject({ status: 'failed', timing: '1s' });
    });
});

describe('sanitizeFunnelArtifact — news ids (0391 additive guard)', () => {
    it('serves counts and statuses only for the news funnel ids', () => {
        expect(sanitizeFunnelArtifact('kk-news-generate', 'pool-gate', '{"status":"PASS","raw":"secret"}')).toEqual({
            status: 'PASS',
        });
        expect(sanitizeFunnelArtifact('kk-news-generate', 'cards-index', '[{"title":"x"}]')).toEqual({ count: 1 });
        expect(
            sanitizeFunnelArtifact(
                'kk-news-generate',
                'variants-safety',
                '{"status":"pass","verdict":"SAFE","body":"secret"}',
            ),
        ).toEqual({ status: 'pass', verdict: 'SAFE' });
        expect(
            sanitizeFunnelArtifact(
                'kk-news-generate',
                'script-plan',
                '{"docs":[1],"cards":[1,2],"social":[],"excluded":[],"prose":"secret"}',
            ),
        ).toEqual({ docs: 1, cards: 2, social: 0, excluded: 0 });
        expect(sanitizeFunnelArtifact('kk-news-generate', 'pool-gate', 'garbage{')).toEqual({ note: 'malformed' });
        expect(sanitizeFunnelArtifact('kk-news-generate', 'pool-gate', undefined)).toBeNull();
        expect(sanitizeFunnelArtifact('kk-collect', 'pool-gate', '{"status":"PASS"}')).toBeNull();
    });
});
