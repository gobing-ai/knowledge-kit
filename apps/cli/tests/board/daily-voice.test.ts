/**
 * G8/0253 — the Daily AI Voice projection, the DAG producer fallback and the reader's daily route.
 *
 * Failure-first list (written before the code):
 * 1. a DAG producer's state comes from run-detail actions keyed by NODE, never a state actionKey;
 * 2. a failed primary + a successful retry sibling stay DISTINCT nodes (the retry never hides);
 * 3. quality/safety/channel evidence is parsed from the recorded files, else explicit unknowns;
 * 4. channel outcomes are semantic (draft/live/skipped/error), independent of engine status;
 * 5. a missing/failed producer never authorises stale content;
 * 6. channel links are exposed only when the recorded target carries a valid http(s) URL;
 * 7. no captured topology => dependency edges are UNKNOWN (never an invented edge);
 * 8. the nested safety child run id is exposed only when the safety action recorded one;
 * 9. a no-content run and a same-day supersession keep a truthful view;
 * 10. a configured works root outside the project captures only its canonical child workspace.
 *
 * Real temporary directories and a real Bun HTTP server observe the reader/capture boundary.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowName } from '@gobing-ai/kk-board/contracts';
import { captureRun } from '../../src/board/capture';
import {
    CONFIDENCE_LEVELS,
    channelOutcomes,
    type DailySummary,
    dagProducerState,
    isConfidenceLevel,
    isPublicHttpUrl,
    projectDailyResults,
    projectProgress,
} from '../../src/board/daily-voice';
import { createBoardReader } from '../../src/board/reader';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const STAMP = '20261011';
const tempDirs: string[] = [];
const servers: { stop(): void }[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const server of servers) server.stop();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One recorded run-detail action row (§9 frozen detail shape). */
interface ActionRow {
    id: string;
    node: string;
    status: string;
    ok: boolean;
    durationMs?: number;
    resultSummary?: unknown;
}

/** The fake Board: project identity + run detail actions; the DAG progress route 404s. */
function startFakeBoard(projectPath: string, actions: ActionRow[], workflowName = 'kk-daily-ai-voice2') {
    const state = { projectPath, run: { id: 'run-1', workflowName, status: 'done' }, actions };
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/project') return json({ name: 'proj', path: state.projectPath });
            if (url.pathname === `/api/runs/${state.run.id}`)
                return json({ run: state.run, phases: [], transitions: [], actions: state.actions });
            if (url.pathname === `/api/runs/${state.run.id}/progress`)
                return json({ code: 'RUN_NOT_FOUND', message: 'orphan-row' }, 404);
            return json({ error: 'unknown' }, 404);
        },
    });
    servers.push(server);
    return { origin: `http://127.0.0.1:${server.port}`, state };
}

/** All node actions a completed daily run recorded, as 'passed'. */
function passedActions(): ActionRow[] {
    return [
        'prepare',
        'article',
        'cover-normalize',
        'script',
        'safety',
        'generate',
        'show-notes',
        'publish-surfdash',
        'publish-classify',
        'publish-podcast',
        'xhs-publish',
        'wechat-publish',
        'translate-sync',
        'run-report',
    ].map((node) => ({ id: `${node}-1`, node, status: 'passed', ok: true, durationMs: 1200 }));
}

/** Write the daily workspace artifacts the projection reads. */
function seedDailyWorkspace(workDir: string, overrides: Record<string, string | null> = {}): void {
    for (const rel of ['22-article', '23-cover', '24-script', '30-audio', '31-publish']) {
        mkdirSync(join(workDir, rel), { recursive: true });
    }
    const files: Record<string, string> = {
        [`22-article/${STAMP}_06_article_content.json`]: JSON.stringify({ title: 'Daily title', body: 'Body' }),
        [`22-article/${STAMP}_06_article_article.md`]: '# Daily title\n\nBody\n',
        [`23-cover/${STAMP}_07_cover_cover.png`]: 'PNG-BYTES',
        [`24-script/${STAMP}_08_script_voicescript.yaml`]: 'segments:\n  - text: hi\n',
        [`24-script/${STAMP}_09_safety-judge_verdict.json`]: JSON.stringify({ verdict: 'PASS', confidence: 'HIGH' }),
        [`24-script/${STAMP}_09_safety-review_report.json`]: JSON.stringify({ platforms: [] }),
        [`30-audio/${STAMP}_11_generate_content.json`]: JSON.stringify({
            metadata: { qc: { overallScore: 98, passed: true, criticalIssues: [] } },
        }),
        [`30-audio/${STAMP}_11_generate_content.mp3`]: 'MP3-BYTES-0123456789',
        [`31-publish/${STAMP}_14_publish-surfdash_result.json`]: JSON.stringify({
            targets: [{ target: 'surfdash-pub', ok: true, status: 'published', url: 'https://surf.example/post' }],
        }),
        [`31-publish/${STAMP}_15_show-notes_show-notes.md`]: '# notes\n',
        [`31-publish/${STAMP}_16_publish-podcast_result.json`]: JSON.stringify({
            targets: [{ target: 'podcast-pub', ok: true, status: 'published' }],
        }),
        [`31-publish/${STAMP}_17_publish_publish-status.txt`]: 'full',
        [`31-publish/${STAMP}_19_publish-xhs_result.json`]: JSON.stringify({
            ok: true,
            target: 'xhs-pub',
            metadata: { publishStatus: 'draft' },
        }),
        [`31-publish/${STAMP}_20_publish-wechat_result.json`]: JSON.stringify({
            ok: true,
            target: 'wechatmp-pub',
            metadata: { publishStatus: 'draft' },
        }),
        [`31-publish/${STAMP}_24_translate-sync_sync-result.json`]: JSON.stringify({
            ok: true,
            target: 'translate-sync',
            metadata: { publishStatus: 'draft' },
        }),
        [`${STAMP}_19_run-report_report.md`]: '# Daily run report\n\nAll good.\n',
    };
    for (const [rel, body] of Object.entries({ ...files, ...overrides })) {
        if (body === null) continue;
        mkdirSync(join(workDir, rel, '..'), { recursive: true });
        writeFileSync(join(workDir, rel), body);
    }
}

const SETTINGS = { publish_enabled: 'true', xhs_enabled: 'true', wechat_enabled: 'true' };

/** Seed a project root with one captured daily workspace. */
async function seededProject(overrides?: Record<string, string | null>) {
    const root = tempDir('kk-daily-proj-');
    const workDir = join(root, '.works', 'kk-daily-ai-voice2', STAMP);
    mkdirSync(workDir, { recursive: true });
    seedDailyWorkspace(workDir, overrides ?? {});
    await captureRun(
        { workflow: 'kk-daily-ai-voice2', runId: 'run-1', workDir, stamp: STAMP, settings: SETTINGS },
        { projectPath: root },
    );
    return { root, workDir };
}

function startReader(boardOrigin: string, projectPath: string) {
    const reader = createBoardReader({ boardOrigin, port: 0, projectPath });
    servers.push(reader);
    return reader.url;
}

interface ResultsJson {
    availability: string;
    summary: DailySummary;
    artifacts: { id: string; availability: string }[];
    diagnostics: { code: string }[];
}

const resultsUrl = (reader: string) => `${reader}/api/workflows/kk-daily-ai-voice2/runs/run-1/results`;

async function getResults(reader: string): Promise<ResultsJson> {
    return (await (await fetch(resultsUrl(reader))).json()) as ResultsJson;
}

describe('dagProducerState', () => {
    it('aggregates node attempts across rows into success/pending/failure/unknown', () => {
        const actions = [
            { node: 'plan-translate', status: 'failed', ok: false },
            { node: 'plan-translate-retry', status: 'passed', ok: true },
        ];
        expect(dagProducerState(actions, 'plan-translate-retry')).toBe('success');
        expect(dagProducerState(actions, 'plan-translate')).toBe('failure');
        expect(dagProducerState([{ node: 'x', status: 'running' }], 'x')).toBe('pending');
        expect(dagProducerState(actions, 'absent')).toBe('unknown');
        // A same-run retry row that passed resolves to success even beside an earlier failure.
        expect(
            dagProducerState(
                [
                    { node: 'article', status: 'failed', ok: false },
                    { node: 'article', status: 'passed', ok: true },
                ],
                'article',
            ),
        ).toBe('success');
    });
});

describe('confidence levels', () => {
    it('accepts only HIGH/MEDIUM/LOW, in strength order', () => {
        expect([...CONFIDENCE_LEVELS]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
        for (const level of CONFIDENCE_LEVELS) expect(isConfidenceLevel(level)).toBe(true);
        expect(isConfidenceLevel('high')).toBe(false);
        expect(isConfidenceLevel('CERTAIN')).toBe(false);
        expect(isConfidenceLevel('')).toBe(false);
        expect(isConfidenceLevel(null)).toBe(false);
    });
});

describe('projectProgress', () => {
    it('keeps retry siblings distinct and reports an unknown topology as unknown edges', () => {
        const progress = projectProgress(
            [
                { node: 'plan-translate', status: 'failed', ok: false, id: 'a' },
                { node: 'plan-translate', status: 'failed', ok: false, id: 'b' },
                { node: 'plan-translate-retry', status: 'passed', ok: true, id: 'c', durationMs: 2000 },
            ],
            undefined,
        );
        expect(progress.edges).toBeNull();
        expect(progress.edgesKnown).toBe(false);
        expect(progress.childRunId).toBeNull();
        const retry = progress.nodes.find((node) => node.id === 'plan-translate-retry');
        expect(retry).toMatchObject({ status: 'passed', attempts: 1, timing: '2s' });
        expect(progress.nodes.find((node) => node.id === 'plan-translate')?.attempts).toBe(2);
    });

    it('exposes the nested safety child run only when the action recorded one', () => {
        const withChild = projectProgress(
            [{ node: 'safety', status: 'passed', ok: true, resultSummary: { runId: 'safety-run-9' } }],
            { nodes: ['safety'], edges: [] },
        );
        expect(withChild.childRunId).toBe('safety-run-9');
        expect(withChild.edgesKnown).toBe(true);
        const textChild = projectProgress(
            [{ node: 'safety', status: 'passed', resultSummary: 'done runId=safety-3' }],
            undefined,
        );
        expect(textChild.childRunId).toBe('safety-3');
        const without = projectProgress([{ node: 'safety', status: 'passed', resultSummary: 'ok' }], undefined);
        expect(without.childRunId).toBeNull();
    });
});

describe('isPublicHttpUrl', () => {
    it('accepts only absolute http(s) links', () => {
        expect(isPublicHttpUrl('https://example.com/a')).toBe(true);
        expect(isPublicHttpUrl('http://127.0.0.1:1/x')).toBe(true);
        expect(isPublicHttpUrl('javascript:alert(1)')).toBe(false);
        expect(isPublicHttpUrl('/relative')).toBe(false);
        expect(isPublicHttpUrl('not a url')).toBe(false);
    });
});

describe('channelOutcomes', () => {
    const availability = (map: Record<string, string>) =>
        new Map(Object.entries(map)) as ReadonlyMap<string, 'available'>;

    it('marks a disabled channel skipped and a recorded draft/live outcome distinctly', () => {
        const texts: Record<string, string> = {
            'surfdash-result': JSON.stringify({
                targets: [{ target: 'surfdash-pub', ok: true, status: 'published', url: 'https://surf.example/post' }],
            }),
            'xhs-result': JSON.stringify({
                targets: [{ target: 'xhs-pub', ok: true, metadata: { publishStatus: 'draft' } }],
            }),
        };
        const outcomes = channelOutcomes(
            { publish_enabled: 'true', xhs_enabled: 'false' },
            availability({ 'surfdash-result': 'available' }),
            (id) => texts[id],
        );
        expect(outcomes.find((o) => o.channel === 'surfdash')).toMatchObject({
            outcome: 'live',
            url: 'https://surf.example/post',
        });
        expect(outcomes.find((o) => o.channel === 'xhs')).toMatchObject({ outcome: 'skipped' });
        expect(outcomes.find((o) => o.channel === 'podcast')).toMatchObject({ outcome: 'unavailable' });
    });

    it('treats a present-but-failed result as a channel error, never a live post', () => {
        const failed = channelOutcomes(
            { publish_enabled: 'true' },
            availability({ 'surfdash-result': 'available' }),
            () => JSON.stringify({ targets: [{ target: 'surfdash-pub', ok: false, status: 'failed' }] }),
        );
        expect(failed.find((o) => o.channel === 'surfdash')?.outcome).toBe('error');
        // A single top-level `Result` object is ONE implicit target (the real xhs/wechat/locale shape,
        // review P1): `ok: true` is a success, not the old "no targets recorded" error.
        const single = channelOutcomes(
            { publish_enabled: 'true', xhs_enabled: 'true', xhs_live: 'false' },
            availability({ 'xhs-result': 'available', 'locales-result': 'available' }),
            (id) =>
                JSON.stringify(
                    id === 'xhs-result'
                        ? { ok: true, target: 'xhs-pub', metadata: { publishStatus: 'draft' } }
                        : { ok: true, target: 'translate-sync', metadata: { publishStatus: 'draft' } },
                ),
        );
        expect(single.find((o) => o.channel === 'xhs')).toMatchObject({ outcome: 'draft', detail: 'recorded ok' });
        expect(single.find((o) => o.channel === 'locales')).toMatchObject({ outcome: 'draft' });
        const singleFailed = channelOutcomes(
            { publish_enabled: 'true', xhs_enabled: 'true' },
            availability({ 'xhs-result': 'available' }),
            () => JSON.stringify({ ok: false, target: 'xhs-pub', error: 'login required' }),
        );
        expect(singleFailed.find((o) => o.channel === 'xhs')).toMatchObject({
            outcome: 'error',
            detail: 'recorded not ok',
        });
        const empty = channelOutcomes(
            { publish_enabled: 'true' },
            availability({ 'surfdash-result': 'available' }),
            () => JSON.stringify({}),
        );
        expect(empty.find((o) => o.channel === 'surfdash')?.outcome).toBe('error');
        const pending = channelOutcomes(
            { publish_enabled: 'true' },
            availability({ 'surfdash-result': 'pending' }),
            () => undefined,
        );
        expect(pending.find((o) => o.channel === 'surfdash')?.outcome).toBe('pending');
    });
});

describe('projectDailyResults (pure)', () => {
    const record = {
        schemaVersion: 1 as const,
        projectPath: '/proj',
        workflow: 'kk-daily-ai-voice2' as WorkflowName,
        runId: 'run-1',
        workspacePath: '/proj/.works/kk-daily-ai-voice2/S',
        stamp: 'S',
        capturedAt: '2026-10-11T12:00:00.000Z',
        settings: SETTINGS,
    };
    const detail = {
        id: 'run-1',
        workflowName: 'kk-daily-ai-voice2',
        status: 'done',
        startedAt: null,
        completedAt: null,
    };

    it('keeps a no-content outcome explicit and never invents channel success', () => {
        const results = projectDailyResults({
            record,
            detail,
            marker: 'owned',
            actions: [],
            producerOf: () => 'success',
            observationOf: (spec) =>
                spec.id === 'report'
                    ? { state: 'present', text: 'no-content: the store pool was empty' }
                    : { state: 'absent' },
        });
        expect(results.summary).toMatchObject({ outcome: 'no-content' });
        expect((results.summary as unknown as DailySummary).channels.every((c) => c.outcome === 'unavailable')).toBe(
            true,
        );
    });

    it('parses quality and safety evidence and the artifact availability', () => {
        const results = projectDailyResults({
            record,
            detail,
            marker: 'owned',
            actions: passedActions(),
            producerOf: () => 'success',
            observationOf: (spec) =>
                spec.id === 'audio-record'
                    ? {
                          state: 'present',
                          text: JSON.stringify({
                              metadata: { qc: { overallScore: 91, passed: true, criticalIssues: ['x'] } },
                          }),
                      }
                    : spec.id === 'safety-verdict'
                      ? { state: 'present', text: JSON.stringify({ verdict: 'PASS', confidence: 'HIGH' }) }
                      : { state: 'absent' },
        });
        const summary = results.summary as unknown as DailySummary;
        expect(summary.quality).toEqual({ overallScore: 91, passed: true, criticalIssues: ['x'] });
        expect(summary.safety).toEqual({ verdict: 'PASS', confidence: 'HIGH' });
        expect(results.diagnostics.map((d) => d.code)).toContain('board.progress.topology-unknown');
    });

    it('treats malformed JSON evidence as absent without throwing (AC5)', () => {
        const results = projectDailyResults({
            record,
            detail,
            marker: 'owned',
            actions: [],
            producerOf: () => 'success',
            observationOf: (spec) =>
                spec.id === 'article-content'
                    ? { state: 'present', text: '{not json' }
                    : spec.id === 'publish-status'
                      ? { state: 'present', text: '   ' }
                      : { state: 'absent' },
        });
        const summary = results.summary as unknown as DailySummary;
        expect(summary.articleTitle).toBeNull();
        expect(summary.outcome).toBeNull();
    });

    it('recognizes only HIGH/MEDIUM/LOW as the safety confidence and nulls the rest (AC2/AC4)', () => {
        const confidenceFor = (raw: unknown): string | null | undefined =>
            (
                projectDailyResults({
                    record,
                    detail,
                    marker: 'owned',
                    actions: [],
                    producerOf: () => 'success',
                    observationOf: (spec) =>
                        spec.id === 'safety-verdict'
                            ? { state: 'present', text: JSON.stringify({ verdict: 'PASS', confidence: raw }) }
                            : { state: 'absent' },
                }).summary as unknown as DailySummary
            ).safety?.confidence;
        expect(confidenceFor('HIGH')).toBe('HIGH');
        expect(confidenceFor('MEDIUM')).toBe('MEDIUM');
        expect(confidenceFor('LOW')).toBe('LOW');
        // An out-of-vocabulary confidence is NOT echoed as a level — it stays explicit as unknown.
        expect(confidenceFor('CERTAIN')).toBeNull();
        expect(confidenceFor('high')).toBeNull();
        expect(confidenceFor(undefined)).toBeNull();
    });

    it('marks every artifact superseded for a foreign owner (AC6)', () => {
        const results = projectDailyResults({
            record,
            detail,
            marker: 'foreign',
            actions: [],
            producerOf: () => 'success',
            observationOf: () => ({ state: 'present' }),
        });
        expect(results.availability).toBe('superseded');
        expect(results.diagnostics.map((d) => d.code)).toContain('board.artifact.superseded');
    });
});

describe('reader daily route (real server + files)', () => {
    it('projects the daily summary, channels, quality and DAG progress from recorded evidence', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root, passedActions());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.summary.status).toBe('done');
        expect(results.summary.outcome).toBe('full');
        expect(results.summary.articleTitle).toBe('Daily title');
        expect(results.summary.quality?.overallScore).toBe(98);
        expect(results.summary.safety?.verdict).toBe('PASS');
        const channels = Object.fromEntries(results.summary.channels.map((c) => [c.channel, c]));
        expect(channels.surfdash).toMatchObject({ outcome: 'live', url: 'https://surf.example/post' });
        expect(channels.podcast).toMatchObject({ outcome: 'live' });
        expect(channels.xhs).toMatchObject({ outcome: 'draft' });
        expect(channels.wechat).toMatchObject({ outcome: 'draft' });
        // The cover, audio and article are all available.
        const ids = Object.fromEntries(results.artifacts.map((a) => [a.id, a.availability]));
        expect(ids.cover).toBe('available');
        expect(ids.audio).toBe('available');
        expect(ids['article-body']).toBe('available');
        // The progress route 404s (orphan-row), yet node attempts come from the run detail.
        expect(results.summary.progress?.nodes.length).toBeGreaterThan(0);
        expect(results.summary.progress?.edgesKnown).toBe(false);
    });

    it('separates a failed primary from its successful retry sibling (AC3)', async () => {
        const { root } = await seededProject();
        const actions = [
            { id: 'p1', node: 'plan-translate', status: 'failed', ok: false },
            { id: 'p2', node: 'plan-translate-retry', status: 'passed', ok: true },
            ...passedActions(),
        ];
        const board = startFakeBoard(root, actions);
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        const nodes = Object.fromEntries(results.summary.progress?.nodes.map((n) => [n.id, n]) ?? []);
        expect(nodes['plan-translate']).toMatchObject({ status: 'failed' });
        expect(nodes['plan-translate-retry']).toMatchObject({ status: 'passed' });
    });

    it('exposes the nested safety run only when it was recorded, and captured edges when present', async () => {
        const { root } = await seededProject();
        const digest = `sha256:${'a'.repeat(64)}`;
        await captureRun(
            {
                workflow: 'kk-daily-ai-voice2',
                runId: 'run-1',
                workDir: join(root, '.works/kk-daily-ai-voice2', STAMP),
                stamp: STAMP,
                settings: SETTINGS,
                definitionDigest: digest,
            },
            {
                projectPath: root,
                lookupTopology: () => ({ nodes: ['safety', 'generate'], edges: [{ from: 'safety', to: 'generate' }] }),
            },
        );
        const actions = [
            { id: 's1', node: 'safety', status: 'passed', ok: true, resultSummary: { runId: 'safety-run-42' } },
            ...passedActions(),
        ];
        const board = startFakeBoard(root, actions);
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.summary.progress?.childRunId).toBe('safety-run-42');
        expect(results.summary.progress?.edgesKnown).toBe(true);
        expect(results.summary.progress?.edges).toEqual([{ from: 'safety', to: 'generate' }]);
    });

    it('never authorises stale content when the producer failed (AC5)', async () => {
        const { root } = await seededProject();
        const actions = passedActions().map((action) =>
            action.node === 'generate' ? { ...action, status: 'failed', ok: false } : action,
        );
        const board = startFakeBoard(root, actions);
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.artifacts.find((a) => a.id === 'audio')?.availability).toBe('missing');
        const artifact = await fetch(`${reader}/api/workflows/kk-daily-ai-voice2/runs/run-1/artifacts/audio`);
        expect(artifact.status).toBe(404);
    });

    it('serves a satisfiable audio byte range as 206 and refuses an unsatisfiable one', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root, passedActions());
        const reader = startReader(board.origin, root);
        const ranged = await fetch(`${reader}/api/workflows/kk-daily-ai-voice2/runs/run-1/artifacts/audio`, {
            headers: { range: 'bytes=0-2' },
        });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get('content-type')).toBe('audio/mpeg');
        expect(await ranged.text()).toBe('MP3');
        const refused = await fetch(`${reader}/api/workflows/kk-daily-ai-voice2/runs/run-1/artifacts/audio`, {
            headers: { range: 'bytes=9999-' },
        });
        expect(refused.status).toBe(416);
    });

    it('refuses a foreign Board origin and an unknown artifact (AC7/AC5)', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root, passedActions());
        const reader = startReader(board.origin, root);
        expect((await fetch(resultsUrl(reader), { headers: { origin: 'http://evil.example' } })).status).toBe(403);
        expect((await fetch(`${reader}/api/workflows/kk-daily-ai-voice2/runs/run-1/artifacts/nope`)).status).toBe(404);
    });

    it('marks the daily artifacts superseded for a same-day later owner (AC6)', async () => {
        const { root, workDir } = await seededProject();
        await captureRun(
            { workflow: 'kk-daily-ai-voice2', runId: 'run-2', workDir, stamp: STAMP, settings: SETTINGS },
            { projectPath: root },
        );
        const board = startFakeBoard(root, passedActions());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.availability).toBe('superseded');
        expect(results.diagnostics.map((d) => d.code)).toContain('board.artifact.superseded');
    });
});

describe('trusted works-root capture (AC6 guard)', () => {
    it('accepts only the canonical child of an explicitly configured works root', async () => {
        const projectRoot = tempDir('kk-daily-capture-proj-');
        const worksRoot = tempDir('kk-daily-configured-works-');
        const workDir = join(worksRoot, 'kk-daily-ai-voice2', STAMP);
        mkdirSync(workDir, { recursive: true });
        const outcome = await captureRun(
            { workflow: 'kk-daily-ai-voice2', runId: 'run-extra', workDir, stamp: STAMP, settings: {} },
            { projectPath: projectRoot, trustedWorksRoot: worksRoot },
        );
        expect(outcome.captured).toBe(true);
        // The configured root itself is never a run workspace.
        await expect(
            captureRun(
                { workflow: 'kk-daily-ai-voice2', runId: 'run-root', workDir: worksRoot, stamp: STAMP, settings: {} },
                { projectPath: projectRoot, trustedWorksRoot: worksRoot },
            ),
        ).rejects.toThrow(/works root/);
        // Without the trusted binding, an external path that is not `.works`/`works`-rooted is refused.
        await expect(
            captureRun(
                { workflow: 'kk-daily-ai-voice2', runId: 'run-no-trust', workDir, stamp: STAMP, settings: {} },
                { projectPath: projectRoot },
            ),
        ).rejects.toThrow(/works root/);
    });
});

describe('kk daily prepare capture wiring', () => {
    it('captures in the configured external works root and keeps no-flag callers unchanged', async () => {
        const cwd = process.cwd();
        const project = tempDir('kk-daily-prep-project-');
        const works = tempDir('kk-daily-prep-works-');
        const prevWorks = process.env.KK_WORKS_DIR;
        const prevConfig = process.env.KK_CONFIG;
        process.env.KK_WORKS_DIR = works;
        writeFileSync(join(project, 'kk.yaml'), `store:\n  db_path: ${join(project, 'kk.db')}\n`);
        process.env.KK_CONFIG = join(project, 'kk.yaml');
        process.chdir(project);
        const capture = captureOutput();
        try {
            const code = await main([
                'node',
                'kk',
                'daily',
                'prepare',
                '--workflow',
                'kk-daily-ai-voice2',
                '--run-date',
                '20261011',
                '--run',
                'run-1',
                '--setting',
                'publish_enabled=true',
            ]);
            expect(code).toBe(0);
            // A no-flag caller composes the workspace but captures nothing.
            const plain = await main([
                'node',
                'kk',
                'daily',
                'prepare',
                '--workflow',
                'kk-daily-ai-voice2',
                '--run-date',
                '20261012',
            ]);
            expect(plain).toBe(0);
        } finally {
            capture.restore();
            process.chdir(cwd);
            if (prevWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = prevWorks;
            if (prevConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = prevConfig;
        }
        const record = JSON.parse(readFileSync(join(project, '.works/.board/runs/run-1.json'), 'utf-8')) as {
            workflow: string;
            settings: Record<string, string>;
            workspacePath: string;
        };
        expect(record.workflow).toBe('kk-daily-ai-voice2');
        expect(record.settings).toEqual({ publish_enabled: 'true' });
        expect(record.workspacePath).toBe(join(works, 'kk-daily-ai-voice2', '20261011'));
        // The no-flag run created no second capture record.
        expect(realpathSync(join(project, '.works/.board/runs'))).toBeTruthy();
    });
});
