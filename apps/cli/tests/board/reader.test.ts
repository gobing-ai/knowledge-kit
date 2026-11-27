/**
 * G8/0252 — the loopback Board reader against a REAL Bun HTTP server and real temp files.
 *
 * Failure-first list (written before the code):
 * 1. only the configured exact Board origin may call the reader (wrong origin -> 403);
 * 2. a non-loopback Host is refused (DNS rebinding);
 * 3. an unknown capture, artifact or route -> 404; a bad workflow/run/query -> 400;
 * 4. a Board project that does not own the record -> 403; another workflow's run -> 404;
 * 5. an unlisted artifact id or a traversal id -> 404 (an id is never a path);
 * 6. a symlink escaping the workspace is not read -> 404;
 * 7. a later owner's marker makes the earlier run's files superseded (AC7/AC8);
 * 8. a failed or absent producer attempt never authorises stale content;
 * 9. >1 MiB evidence is reported oversized, never truncated silently;
 * 10. an unsatisfiable byte range -> 416, a satisfiable one -> 206 with Content-Range.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { captureRecordPath, captureRun, markerPath } from '../../src/board/capture';
import type { ArtifactObservation } from '../../src/board/collect';
import {
    artifactContent,
    artifactResponse,
    MAX_OVERVIEW_RUNS,
    MAX_PREVIEW_BYTES,
    mimeFor,
    parseChannelsQuery,
    parseItemsQuery,
    parseRunsQuery,
    producerStateFrom,
} from '../../src/board/reader';
import { collectStoreTestSeeded } from './collect-store-fixture';
import { fetchTestReader, registerTestReader } from './test-reader';

const STAMP = '20261011T1200Z';
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

/** A JSON answer. */
function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The fake Board: the two public identity routes plus the progress projection. */
function startFakeBoard(projectPath: string) {
    const state = {
        projectPath,
        run: { id: 'run-1', workflowName: 'kk-collect', status: 'done' },
        progress: {
            schemaVersion: 1,
            runId: 'run-1',
            workflow: 'kk-collect',
            status: 'done',
            states: [
                {
                    state: 'collect',
                    visit: 1,
                    status: 'passed',
                    actions: [
                        { actionKey: 'collect:onEnter:0', status: 'passed', attempts: [] },
                        { actionKey: 'collect:onEnter:1', status: 'passed', attempts: [] },
                    ],
                },
                {
                    state: 'store',
                    visit: 1,
                    status: 'passed',
                    actions: [{ actionKey: 'store:onEnter:0', status: 'passed' }],
                },
                {
                    state: 'label',
                    visit: 1,
                    status: 'passed',
                    actions: [{ actionKey: 'label:onEnter:0', status: 'passed' }],
                },
            ],
        } as unknown,
    };
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/project') return json({ name: 'proj', path: state.projectPath });
            if (url.pathname === `/api/runs/${state.run.id}`)
                return json({ run: state.run, phases: [], transitions: [], actions: [] });
            if (url.pathname === `/api/runs/${state.run.id}/progress`) {
                return state.progress === null
                    ? json({ error: 'not found', code: 'RUN_NOT_FOUND' }, 404)
                    : json(state.progress);
            }
            return json({ error: 'unknown' }, 404);
        },
    });
    servers.push(server);
    return { origin: `http://127.0.0.1:${server.port}`, state };
}

/** Mark one recorded producer action as failed inside the fake Board's progress payload. */
function failProducer(board: ReturnType<typeof startFakeBoard>, actionKey: string): void {
    const progress = board.state.progress as {
        states?: { actions?: { actionKey: string; status: string }[] }[];
    } | null;
    for (const state of progress?.states ?? []) {
        for (const action of state.actions ?? []) {
            if (action.actionKey === actionKey) action.status = 'failed';
        }
    }
}

/** A captured project root with all four collect artifacts written. */
async function seededProject(): Promise<{ root: string; workDir: string; stamp: string }> {
    const root = tempDir('kk-board-reader-');
    const workDir = join(root, '.works', 'kk-collect', STAMP);
    mkdirSync(join(workDir, '10-ingest'), { recursive: true });
    mkdirSync(join(workDir, '20-facts'), { recursive: true });
    writeFileSync(
        join(workDir, '10-ingest', `${STAMP}_02_collect_blended.json`),
        JSON.stringify([
            { id: 'a', body: 'x', metadata: { sources: [{ file: 'aihot-ingest' }] } },
            { id: 'b', body: 'y', metadata: { sources: [{ file: 'aihot-ingest' }, { file: 'horizon-ingest' }] } },
        ]),
    );
    writeFileSync(join(workDir, '20-facts', `${STAMP}_02_collect_core-facts.md`), '# Core facts\n- one\n');
    writeFileSync(join(workDir, 'store-result.json'), JSON.stringify({ inserted: 2, updated: 1, unchanged: 0 }));
    writeFileSync(
        join(workDir, 'label-result.txt'),
        JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', labeled: 2, model: 1, fallback: 1 }),
    );
    await captureRun(
        { workflow: 'kk-collect', runId: 'run-1', workDir, stamp: STAMP, settings: { limit: '10' } },
        {
            projectPath: root,
        },
    );
    return { root, workDir, stamp: STAMP };
}

/** Start a reader wired to one fake Board + one project root (optionally a readonly fs seam). */
function startReader(boardOrigin: string, projectPath: string, fs?: FileSystem) {
    const reader = registerTestReader({ boardOrigin, projectPath, ...(fs === undefined ? {} : { fs }) });
    servers.push(reader);
    return reader.url;
}

/** The reader's JSON shapes the assertions read (kept loose on purpose: a projection, not a schema). */
interface ResultsJson {
    availability: string;
    summary: Record<string, unknown>;
    artifacts: { id: string; availability: string }[];
    diagnostics: { code: string }[];
}

/** GET a reader URL and decode its JSON body with the test's own shape. */
async function getJson<T = ResultsJson>(url: string): Promise<T> {
    return (await (await fetchTestReader(url)).json()) as T;
}

const resultsUrl = (reader: string) => `${reader}/api/workflows/kk-collect/runs/run-1/results`;
const artifactUrl = (reader: string, id = 'facts') => `${reader}/api/workflows/kk-collect/runs/run-1/artifacts/${id}`;

/** The named diagnostic code from a reader error body. */
async function errorCode(response: Response): Promise<string | undefined> {
    return ((await response.json()) as { code?: string }).code;
}

describe('reader authorization', () => {
    it('answers health and refuses a foreign origin without separate CORS headers', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const health = await fetchTestReader(`${reader}/api/health`);
        expect(health.status).toBe(200);
        expect(
            (await fetchTestReader(`${reader}/api/health`, { headers: { origin: 'http://evil.example' } })).status,
        ).toBe(403);
        const sameOrigin = await fetchTestReader(`${reader}/api/health`, { headers: { origin: board.origin } });
        expect(sameOrigin.status).toBe(200);
        expect(sameOrigin.headers.has('access-control-allow-origin')).toBe(false);
        expect((await fetchTestReader(`${reader}/api/health`, { method: 'POST' })).status).toBe(405);
    });

    it('returns 400 for an unknown workflow, an unsafe run id and an unknown query', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        expect((await fetchTestReader(`${reader}/api/workflows/nope/runs/run-1/results`)).status).toBe(400);
        expect(
            (await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/${encodeURIComponent('../x')}/results`))
                .status,
        ).toBe(400);
        const badQuery = await fetchTestReader(`${resultsUrl(reader)}?limit=5`);
        expect(badQuery.status).toBe(400);
        expect(await badQuery.json()).toMatchObject({ code: 'board.query.invalid' });
    });

    it('returns 404 for an unknown capture and 403 when the Board project does not own it', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        expect((await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-unknown/results`)).status).toBe(404);
        board.state.projectPath = tempDir('kk-other-project-');
        expect((await fetchTestReader(resultsUrl(reader))).status).toBe(403);
    });

    it('returns 404 when the Board has no matching run or the workflow differs', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        board.state.run = { id: 'run-1', workflowName: 'kk-itc', status: 'done' };
        expect((await fetchTestReader(resultsUrl(reader))).status).toBe(404);
    });
});

describe('reader projections', () => {
    it('serves results and config built from the captured artifacts', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.summary).toMatchObject({
            sourceCounts: { 'aihot-ingest': 2, 'horizon-ingest': 1 },
            inserted: 2,
            updated: 1,
            unchanged: 0,
            labeled: 2,
            model: 1,
            fallback: 1,
            verdict: 'PASS',
            confidence: 'HIGH',
        });
        expect(results.summary.factsPreview).toContain('# Core facts');
        expect(results.artifacts.map((artifact: { availability: string }) => artifact.availability)).toEqual([
            'available',
            'available',
            'available',
            'available',
        ]);
        const config = await getJson<{
            settings: Record<string, string>;
            capturedAt: string;
            unavailableKeys: string[];
        }>(`${reader}/api/workflows/kk-collect/runs/run-1/config`);
        expect(config.settings).toEqual({ limit: '10' });
        expect(config.capturedAt).toBeTruthy();
        expect(config.unavailableKeys).toEqual(['horizon_hours']);
    });

    it('never invents counts when an artifact is absent', async () => {
        const { root, workDir } = await seededProject();
        rmSync(join(workDir, 'store-result.json'));
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.summary.inserted).toBeNull();
        expect(results.summary.updated).toBeNull();
    });
});

describe('artifact access', () => {
    it('serves an allowlisted artifact and refuses an unlisted or traversal id', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const facts = await fetchTestReader(artifactUrl(reader));
        expect(facts.status).toBe(200);
        expect(await facts.text()).toContain('# Core facts');
        expect((await fetchTestReader(artifactUrl(reader, 'unknown-id'))).status).toBe(404);
        expect((await fetchTestReader(artifactUrl(reader, encodeURIComponent('../../etc/passwd')))).status).toBe(404);
    });

    it('does not follow a symlink that escapes the workspace', async () => {
        const { root, workDir } = await seededProject();
        const outside = join(tempDir('kk-outside-'), 'secret.md');
        writeFileSync(outside, 'TOP SECRET');
        rmSync(join(workDir, '20-facts', `${STAMP}_02_collect_core-facts.md`));
        symlinkSync(outside, join(workDir, '20-facts', `${STAMP}_02_collect_core-facts.md`));
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        expect((await fetchTestReader(artifactUrl(reader))).status).toBe(404);
    });

    it('marks a later owner and a failed producer as unavailable, never stale content', async () => {
        const { root, workDir } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        // A later run claims the same workspace: the earlier run's files are superseded (AC7).
        await captureRun(
            { workflow: 'kk-collect', runId: 'run-2', workDir, stamp: STAMP, settings: {} },
            { projectPath: root },
        );
        const superseded = await getJson(resultsUrl(reader));
        expect(superseded.artifacts[0]?.availability).toBe('superseded');
        expect((await fetchTestReader(artifactUrl(reader))).status).toBe(404);
        // Re-claim the workspace for run-1, then fail its facts producer.
        await captureRun(
            { workflow: 'kk-collect', runId: 'run-1', workDir, stamp: STAMP, settings: { limit: '10' } },
            {
                projectPath: root,
            },
        );
        failProducer(board, 'collect:onEnter:1');
        const failed = await getJson(resultsUrl(reader));
        expect(failed.artifacts.find((artifact) => artifact.id === 'facts')?.availability).toBe('missing');
        expect((await fetchTestReader(artifactUrl(reader, 'blended'))).status).toBe(200);
    });

    it('reports an unavailable progress projection as unverified', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        board.state.progress = null;
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.availability).toBe('unverified');
        expect(results.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toContain(
            'board.progress.unavailable',
        );
        expect((await fetchTestReader(artifactUrl(reader))).status).toBe(404);
    });

    it('reports evidence over the preview cap as oversized instead of truncating it', async () => {
        const { root, workDir } = await seededProject();
        writeFileSync(
            join(workDir, '20-facts', `${STAMP}_02_collect_core-facts.md`),
            'x'.repeat(MAX_PREVIEW_BYTES + 10),
        );
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.artifacts.find((artifact) => artifact.id === 'facts')?.availability).toBe('oversized');
        expect((await fetchTestReader(artifactUrl(reader))).status).toBe(404);
    });

    it('serves a satisfiable byte range as 206 and refuses an unsatisfiable one with 416', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const ranged = await fetchTestReader(artifactUrl(reader), { headers: { range: 'bytes=0-3' } });
        expect(ranged.status).toBe(206);
        expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-3\/\d+$/);
        expect(await ranged.text()).toBe('# Co');
        expect((await fetchTestReader(artifactUrl(reader), { headers: { range: 'bytes=99999999-' } })).status).toBe(
            416,
        );
    });
});

describe('marker re-verification and malformed evidence', () => {
    it('discards a read whose workspace owner changed mid-read (P2)', async () => {
        const { root, workDir } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root, swappingMarkerFs(root, workDir));
        // The capture revokes run-1's ownership and writes run-2's marker while the facts file is
        // being read: the successor's bytes must never be served under run-1's identity.
        const full = await fetchTestReader(artifactUrl(reader));
        expect(full.status).toBe(404);
        expect(await errorCode(full)).toBe('board.artifact.owner-changed');
    });

    it('re-verifies ownership per bounded range chunk too (P2)', async () => {
        const { root, workDir } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root, swappingMarkerFs(root, workDir));
        const ranged = await fetchTestReader(artifactUrl(reader), { headers: { range: 'bytes=0-3' } });
        expect(ranged.status).toBe(404);
    });

    it('answers 422 for a malformed capture record, never 404', async () => {
        const { root } = await seededProject();
        writeFileSync(join(root, '.works/.board/runs/run-1.json'), '{not json');
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const response = await fetchTestReader(resultsUrl(reader));
        expect(response.status).toBe(422);
        expect(await errorCode(response)).toBe('board.capture.invalid');
    });

    it('answers 422 for a malformed marker file, not unverified (P3)', async () => {
        const { root, workDir } = await seededProject();
        // A marker without `schemaVersion: 1` is malformed stored evidence.
        writeFileSync(
            markerPath(workDir),
            JSON.stringify({ projectPath: root, workflow: 'kk-collect', runId: 'run-1' }),
        );
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.availability).toBe('invalid');
        const artifact = await fetchTestReader(artifactUrl(reader));
        expect(artifact.status).toBe(422);
        expect(await errorCode(artifact)).toBe('board.artifact.invalid');
    });

    it('resolves a same-run retry across visits instead of the first visit (P3)', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const progress = board.state.progress as { states?: unknown[] } | null;
        if (progress !== null) {
            progress.states = [
                {
                    state: 'collect',
                    visit: 1,
                    status: 'failed',
                    actions: [
                        { actionKey: 'collect:onEnter:0', status: 'failed' },
                        { actionKey: 'collect:onEnter:1', status: 'failed' },
                    ],
                },
                {
                    state: 'collect',
                    visit: 2,
                    status: 'passed',
                    actions: [
                        { actionKey: 'collect:onEnter:0', status: 'passed' },
                        { actionKey: 'collect:onEnter:1', status: 'passed' },
                    ],
                },
                {
                    state: 'store',
                    visit: 1,
                    status: 'passed',
                    actions: [{ actionKey: 'store:onEnter:0', status: 'passed' }],
                },
                {
                    state: 'label',
                    visit: 1,
                    status: 'passed',
                    actions: [{ actionKey: 'label:onEnter:0', status: 'passed' }],
                },
            ];
        }
        const reader = startReader(board.origin, root);
        const results = await getJson(resultsUrl(reader));
        expect(results.artifacts.find((artifact) => artifact.id === 'blended')?.availability).toBe('available');
        expect((await fetchTestReader(artifactUrl(reader, 'blended'))).status).toBe(200);
    });
});

describe('producerStateFrom', () => {
    it('aggregates every recorded attempt for one action key across visits', () => {
        const retried = {
            states: [
                { actions: [{ actionKey: 'k', status: 'failed' }] },
                { actions: [{ actionKey: 'k', status: 'passed' }] },
            ],
        };
        expect(producerStateFrom(retried, 'k', 'n')).toBe('success');
        expect(
            producerStateFrom(
                {
                    states: [
                        { actions: [{ actionKey: 'k', status: 'failed' }] },
                        { actions: [{ actionKey: 'k', status: 'running' }] },
                    ],
                },
                'k',
                'n',
            ),
        ).toBe('pending');
        expect(producerStateFrom({ states: [{ actions: [{ actionKey: 'k', status: 'failed' }] }] }, 'k', 'n')).toBe(
            'failure',
        );
        expect(producerStateFrom({ states: [] }, 'k', 'n')).toBe('unknown');
        expect(producerStateFrom(retried, undefined, 'n')).toBe('unknown');
        expect(producerStateFrom(null, 'k', 'n')).toBe('unknown');
    });
});

describe('artifact bytes and mime', () => {
    it('prefers a declared mime and serves real media bytes sliced by range', async () => {
        expect(mimeFor('audio', 'audio/ogg')).toBe('audio/ogg');
        expect(mimeFor('audio')).toBe('audio/mpeg');
        expect(mimeFor('image')).toBe('image/png');
        expect(mimeFor('json')).toBe('application/json');
        const root = tempDir('kk-board-media-');
        const file = join(root, 'clip.bin');
        writeFileSync(file, new Uint8Array([0, 1, 2, 3, 4]));
        const observed: ArtifactObservation = { state: 'present', bytes: 5, path: file };
        const whole = await artifactContent('audio', observed, null, 5);
        expect(whole).toBeInstanceOf(Uint8Array);
        expect([...(whole as Uint8Array)]).toEqual([0, 1, 2, 3, 4]);
        const sliced = await artifactContent('audio', observed, { start: 1, end: 2 }, 5);
        expect([...(sliced as Uint8Array)]).toEqual([1, 2]);
        // An in-memory observation (no file) falls back to a character slice.
        expect(await artifactContent('text', { state: 'present', text: 'hello' }, { start: 1, end: 3 }, 5)).toBe('ell');
        // With a real file the text slice is cut by BYTE, so it agrees with `Content-Range`.
        const facts = join(root, 'facts.md');
        writeFileSync(facts, 'héllo');
        const rangedText = await artifactContent(
            'text',
            { state: 'present', bytes: 6, path: facts, text: 'héllo' },
            { start: 0, end: 2 },
            6,
        );
        expect(new TextEncoder().encode(String(rangedText)).byteLength).toBeLessThanOrEqual(3);
        expect(String(rangedText).startsWith('h')).toBe(true);
    });

    it('sends media bytes with their real content-length and content-range', () => {
        const response = artifactResponse({
            status: 206,
            body: {
                __binary: true,
                mime: 'audio/mpeg',
                text: new Uint8Array([9, 8, 7]),
                bytes: 10,
                range: { start: 0, end: 2 },
            },
        });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-type')).toBe('audio/mpeg');
        expect(response.headers.get('content-length')).toBe('3');
        expect(response.headers.get('content-range')).toBe('bytes 0-2/10');
    });
});

/** A fs seam whose artifact read revokes run-1's ownership and writes run-2's marker mid-read. */
function swappingMarkerFs(root: string, workDir: string): FileSystem {
    const base = createNodeFileSystem();
    let swapped = false;
    return new Proxy(base, {
        get(target, property, receiver) {
            if (property === 'readFile') {
                return async (path: string): Promise<string> => {
                    if (!swapped && path.endsWith('core-facts.md')) {
                        swapped = true;
                        writeFileSync(
                            markerPath(workDir),
                            JSON.stringify({
                                schemaVersion: 1,
                                projectPath: root,
                                workflow: 'kk-collect',
                                runId: 'run-2',
                            }),
                        );
                    }
                    return base.readFile(path);
                };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === 'function' ? value.bind(base) : value;
        },
    }) as FileSystem;
}

describe('structurally invalid stored evidence (P3, second review)', () => {
    it('answers 422 for a record that parses but is missing required fields, never 500', async () => {
        const { root } = await seededProject();
        // The reviewer's repro: valid JSON, a known workflow, schemaVersion 1 — but no workspacePath,
        // which the routes dereference. Validating the shape at the read keeps 422 the only answer.
        writeFileSync(
            join(root, '.works/.board/runs/run-1.json'),
            JSON.stringify({
                schemaVersion: 1,
                workflow: 'kk-collect',
                projectPath: root,
                runId: 'run-1',
                settings: { limit: '10' },
            }),
        );
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const results = await fetchTestReader(resultsUrl(reader));
        expect(results.status).toBe(422);
        expect(await errorCode(results)).toBe('board.capture.invalid');
        const artifact = await fetchTestReader(artifactUrl(reader));
        expect(artifact.status).toBe(422);
    });
});

describe('text byte ranges (P4-6)', () => {
    it('cuts a ranged text preview by BYTE, matching the Content-Range it promises', async () => {
        const dir = tempDir('kk-board-range-');
        const file = join(dir, 'facts.md');
        writeFileSync(file, 'héllo');
        const observed = { state: 'present' as const, path: file, bytes: 6, text: 'héllo' };
        expect(await artifactContent('text', observed, null, 6)).toBe('héllo');
        // Bytes 0-2 are 'h' + the first of the two 0xC3 0xA9 bytes that make 'é' — 3 bytes, not 3 chars.
        const ranged = await artifactContent('text', observed, { start: 0, end: 2 }, 6);
        expect(new TextEncoder().encode(String(ranged)).byteLength).toBeLessThanOrEqual(3);
    });
});

describe('collect store routes (0307 R4/R6/R7/R8)', () => {
    const originalConfig = process.env.KK_CONFIG;

    afterAll(() => {
        if (originalConfig === undefined) delete process.env.KK_CONFIG;
        else process.env.KK_CONFIG = originalConfig;
    });

    /** The captured project plus a REAL seeded store, and a kk config the projection reads. */
    async function storeProject(): Promise<{ root: string; publishedItemId: string }> {
        const { root } = await seededProject();
        const store = await openStore({ path: join(root, '.works', 'kk.db') });
        const seeded = await collectStoreTestSeeded(store);
        await store.close();
        const config = join(root, 'kk-config.yaml');
        writeFileSync(config, 'store:\n  labels:\n    priority: ["*", heuristic]\n');
        process.env.KK_CONFIG = config;
        return { root, publishedItemId: seeded.publishedItemId };
    }

    it('serves the overview without any Board call, and never invents a row', async () => {
        const { root } = await storeProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        // A foreign Board would refuse every capture-gated route; the overview needs none of it.
        board.state.projectPath = tempDir('kk-foreign-project-');
        const overview = await getJson<{
            availability: string;
            rows: Record<string, { inserted: number } | null>;
            lastStoredAt: string | null;
        }>(`${reader}/api/workflows/kk-collect/store/overview?runs=run-2,run-gone`);
        expect(overview.availability).toBe('available');
        expect(overview.rows['run-2']?.inserted).toBe(3);
        expect(overview.rows['run-gone']).toBeNull();
        expect(overview.lastStoredAt).not.toBeNull();
    });

    it('refuses a malformed overview query', async () => {
        const { root } = await storeProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const overview = `${reader}/api/workflows/kk-collect/store/overview`;
        for (const query of [
            '',
            '?runs=',
            '?runs=../etc',
            '?runs=run-1&limit=2',
            `?runs=${Array.from({ length: MAX_OVERVIEW_RUNS + 1 }, () => 'r').join(',')}`,
        ]) {
            const response = await fetchTestReader(`${overview}${query}`);
            expect(response.status).toBe(400);
            expect(await errorCode(response)).toBe('board.query.invalid');
        }
        // Duplicates collapse; one safe id list is accepted.
        expect((await fetchTestReader(`${overview}?runs=run-2,run-2`)).status).toBe(200);
    });

    it('serves a run detail with no capture record (store rows predate capture)', async () => {
        const { root } = await storeProject();
        const board = startFakeBoard(root);
        board.state.run = { id: 'run-2', workflowName: 'kk-collect', status: 'done' };
        const reader = startReader(board.origin, root);
        const detail = await getJson<{
            availability: string;
            row: { inserted: number } | null;
            labelQuality: { decisionId: string; run: unknown[]; effective: unknown[] }[];
        }>(`${reader}/api/workflows/kk-collect/runs/run-2/store`);
        expect(detail.availability).toBe('available');
        expect(detail.row?.inserted).toBe(3);
        const category = detail.labelQuality.find((entry) => entry.decisionId === 'kk-item-category');
        expect(category?.effective.length).toBe(1);
        // §3 declares "Query: none" for this route: an undeclared parameter is refused (0307 P3).
        const refused = await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-2/store?page=2`);
        expect(refused.status).toBe(400);
        expect(await errorCode(refused)).toBe('board.query.invalid');
    });

    it('keeps the shipped security envelope on the store routes', async () => {
        const { root } = await storeProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const itemsUrl = `${reader}/api/workflows/kk-collect/runs/run-2/store/items`;
        // Wrong origin, and the workflow that is not kk-collect.
        expect((await fetchTestReader(itemsUrl, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
        expect((await fetchTestReader(`${reader}/api/workflows/kk-itc/store/overview?runs=run-2`)).status).toBe(404);
        expect((await fetchTestReader(`${reader}/api/workflows/kk-itc/runs/run-2/store`)).status).toBe(404);
        // The Board does not own this project, or does not know the run.
        board.state.projectPath = tempDir('kk-store-other-');
        expect((await fetchTestReader(itemsUrl)).status).toBe(403);
        board.state.projectPath = root;
        board.state.run = { id: 'run-1', workflowName: 'kk-collect', status: 'done' };
        const unknownRun = await fetchTestReader(itemsUrl);
        expect(unknownRun.status).toBe(404);
        expect(await errorCode(unknownRun)).toBe('board.run.unknown');
        // A Board that cannot be reached at all is 503, not an empty payload.
        const offline = startReader('http://127.0.0.1:1', root);
        expect((await fetchTestReader(`${offline}/api/workflows/kk-collect/runs/run-2/store`)).status).toBe(503);
    });

    it('serves items with the declared query only, and refuses everything else', async () => {
        const { root, publishedItemId } = await storeProject();
        const board = startFakeBoard(root);
        board.state.run = { id: 'run-2', workflowName: 'kk-collect', status: 'done' };
        const reader = startReader(board.origin, root);
        const items = `${reader}/api/workflows/kk-collect/runs/run-2/store/items`;

        const page = await getJson<{ items: { id: string }[]; total: number; sources: string[] }>(
            `${items}?page=1&selection=published`,
        );
        expect(page.items.map((item) => item.id)).toEqual([publishedItemId]);
        expect(page.sources).toEqual(['hackernews', 'rss']);

        for (const query of [
            '?tab=items',
            '?page=0',
            '?page=abc',
            '?seen=stale',
            '?decision=kk-item-category',
            '?value=ai-news',
            '?value=bad%20value&decision=kk-item-category',
            '?decision=nope&value=ai-news',
            '?selection=maybe',
            '?source=nowhere',
        ]) {
            const response = await fetchTestReader(`${items}${query}`);
            expect([400, response.status]).toContain(400);
            expect(await errorCode(response)).toBe('board.query.invalid');
        }
        // The shipped routes still take no query at all.
        expect((await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-2/results?page=1`)).status).toBe(
            400,
        );
    });

    it('parses the store queries by contract, not by prefix', () => {
        expect('response' in parseRunsQuery(new URLSearchParams(''))).toBe(true);
        expect(parseRunsQuery(new URLSearchParams('runs=a,b'))).toEqual({ runIds: ['a', 'b'] });
        expect('query' in parseItemsQuery(new URLSearchParams('page=2&seen=new&selection=none'))).toBe(true);
        const parsed = parseItemsQuery(new URLSearchParams('page=2'));
        expect('query' in parsed && parsed.query.page).toBe(2);
    });
});

describe('collect channels route (0319 R3/R4/R6)', () => {
    /** The captured project plus a REAL seeded store with controlled item/tick timestamps. */
    async function channelsProject(): Promise<{ root: string; now: number }> {
        const { root } = await seededProject();
        const now = Date.now();
        const dayMs = 86_400_000;
        const store = await openStore({ path: join(root, '.works', 'kk.db') });
        try {
            await store.collectRuns.start({
                runId: 'c-1',
                startedAt: now - dayMs,
                sourceCounts: { 'aihot-ingest': 3, 'horizon-ingest': 1 },
            });
            await store.collectRuns.finish('c-1', { status: 'done', finishedAt: now - dayMs + 1 });
            await store.items.upsertDocs(
                'c-1',
                [
                    {
                        id: 'c-i1',
                        title: 'a',
                        body: 'b',
                        sourceUri: 'https://example.com/c-i1',
                        metadata: { source: 'aihot' },
                    },
                ],
                now - dayMs,
            );
        } finally {
            await store.close();
        }
        return { root, now };
    }

    it('parses the channels query by contract and refuses malformed values', () => {
        const ok = parseChannelsQuery(new URLSearchParams('from=0&until=1000'));
        expect('query' in ok && ok.query).toEqual({ fromMs: 0, untilMs: 1000, page: 1 });
        const paged = parseChannelsQuery(new URLSearchParams('from=0&until=1000&page=2'));
        expect('query' in paged && paged.query.page).toBe(2);

        for (const query of [
            '',
            'from=0',
            'until=1000',
            'from=-1&until=1000',
            'from=abc&until=1000',
            'from=0&until=0',
            'from=10&until=5',
            'from=0&until=1000&page=0',
            'from=0&until=1000&page=1.5',
            'from=0&until=1000&extra=1',
            'from=0&from=1&until=1000',
            'from=0&until=1000&page=1&page=2',
        ]) {
            expect('response' in parseChannelsQuery(new URLSearchParams(query)), query).toBe(true);
        }
    });

    it('serves the two aggregate tables through the loopback security envelope', async () => {
        const { root, now } = await channelsProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const dayMs = 86_400_000;
        const url = `${reader}/api/workflows/kk-collect/store/channels?from=${now - 2 * dayMs}&until=${now + dayMs}&page=1`;
        const response = await fetchTestReader(url, { headers: { origin: board.origin } });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            availability: string;
            sources: string[];
            bySource: Record<string, number>;
            runsByDay: { runs: number }[];
            lastPositiveAt: Record<string, number | null>;
        };
        expect(body.availability).toBe('available');
        expect(body.sources).toEqual(['aihot']);
        expect(body.bySource).toEqual({ aihot: 1 });
        expect(body.runsByDay.map((day) => day.runs)).toEqual([1]);
        expect(body.lastPositiveAt['aihot-ingest']).toBe(now - dayMs);
        // No Board call is needed: a foreign project still answers the aggregate.
        board.state.projectPath = tempDir('kk-foreign-project-');
        expect((await fetchTestReader(url, { headers: { origin: board.origin } })).status).toBe(200);
    });

    it('refuses non-GET, malformed and cross-workflow channels requests', async () => {
        const { root, now } = await channelsProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const dayMs = 86_400_000;
        const good = `${reader}/api/workflows/kk-collect/store/channels?from=${now - 2 * dayMs}&until=${now + dayMs}&page=1`;
        // Method envelope (405) and origin (403).
        expect((await fetchTestReader(good, { method: 'POST' })).status).toBe(405);
        expect((await fetchTestReader(good, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
        // Malformed query (400), and another workflow on a store route (404).
        expect((await fetchTestReader(`${reader}/api/workflows/kk-collect/store/channels?from=0`)).status).toBe(400);
        expect(
            (await fetchTestReader(`${reader}/api/workflows/kk-collect/store/channels?from=0&until=1&page=0`)).status,
        ).toBe(400);
        expect((await fetchTestReader(`${reader}/api/workflows/kk-itc/store/channels?from=0&until=1`)).status).toBe(
            404,
        );
    });
});

/** The fake Board for one DAG run (news or voice2): project identity + run-detail action rows. */
function startDagBoard(projectPath: string, runId: string, workflowName: string, actions: unknown[] = []) {
    const state = { projectPath, run: { id: runId, workflowName, status: 'done' }, actions };
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/project') return json({ name: 'proj', path: state.projectPath });
            if (url.pathname === `/api/runs/${runId}`)
                return json({ run: state.run, phases: [], transitions: [], actions: state.actions });
            if (url.pathname === `/api/runs/${runId}/progress`)
                return json({ code: 'RUN_NOT_FOUND', message: 'orphan-row' }, 404);
            return json({ error: 'unknown' }, 404);
        },
    });
    servers.push(server);
    return { origin: `http://127.0.0.1:${server.port}`, state };
}

/** A captured kk-news-generate project with one gate verdict on the news layout. */
async function seededNewsProject(): Promise<{ root: string; workDir: string }> {
    const root = tempDir('kk-board-news-');
    const workDir = join(root, '.works', 'kk-news-generate', '20261117');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'pool-gate.json'), JSON.stringify({ status: 'PASS' }));
    await captureRun(
        {
            workflow: 'kk-news-generate',
            runId: 'run-news',
            workDir,
            stamp: '20261117',
            settings: { skip_review: 'true' },
        },
        { projectPath: root },
    );
    return { root, workDir };
}

describe('run evidence envelope (0391)', () => {
    interface EvidenceJson {
        schemaVersion: number;
        workflow: string;
        runId: string;
        capture: { stamp: string; settings: Record<string, string> } | null;
        run: { id: string; status: string } | null;
        results: { summary: Record<string, unknown> } | null;
        diagnostics: { code: string }[];
    }

    it('serves a captured run: capture metadata, authorized run state and the full projection', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const response = await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-1/evidence`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as EvidenceJson;
        expect(body.schemaVersion).toBe(1);
        expect(body.capture).toMatchObject({ stamp: STAMP, settings: { limit: '10' } });
        expect(body.run).toMatchObject({ id: 'run-1', status: 'done' });
        expect(body.results?.summary).toMatchObject({ verdict: 'PASS' });
    });

    it('answers an authorized uncaptured attempt with Spur state only and the uncaptured diagnostic', async () => {
        const root = tempDir('kk-board-uncaptured-');
        const board = startFakeBoard(root); // run-1 is Board-authorized but never captured
        const reader = startReader(board.origin, root);
        const response = await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-1/evidence`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as EvidenceJson;
        expect(body.capture).toBeNull();
        expect(body.results).toBeNull();
        expect(body.run).toMatchObject({ id: 'run-1' });
        expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['board.evidence.uncaptured']);
    });

    it('answers a malformed capture record with 422, never 200', async () => {
        const root = tempDir('kk-board-invalid-');
        mkdirSync(join(root, '.works', '.board', 'runs'), { recursive: true });
        writeFileSync(captureRecordPath(root, 'run-1'), 'not json {');
        const board = startFakeBoard(root);
        const reader = startReader(board.origin, root);
        const response = await fetchTestReader(`${reader}/api/workflows/kk-collect/runs/run-1/evidence`);
        expect(response.status).toBe(422);
        expect(await errorCode(response)).toBe('board.capture.invalid');
    });

    it('serves the news projection and news artifact ids on the existing routes', async () => {
        const { root } = await seededNewsProject();
        const board = startDagBoard(root, 'run-news', 'kk-news-generate', [
            { id: 'prepare-1', node: 'prepare', status: 'passed', ok: true, durationMs: 900 },
        ]);
        const reader = startReader(board.origin, root);
        const results = await getJson(`${reader}/api/workflows/kk-news-generate/runs/run-news/results`);
        expect(results.summary.generation).toBeDefined();
        expect(results.summary.publishing).toBeDefined();
        expect(results.artifacts.find((artifact: { id: string }) => artifact.id === 'pool-gate')).toMatchObject({
            availability: 'available',
        });
        const gate = await fetchTestReader(
            `${reader}/api/workflows/kk-news-generate/runs/run-news/artifacts/pool-gate`,
        );
        expect(gate.status).toBe(200);
        // The gate verdict serves its sanitized projection (status only), never the raw body.
        expect(((await gate.json()) as { projection: unknown }).projection).toEqual({ status: 'PASS' });
        const evidence = (await getJson(
            `${reader}/api/workflows/kk-news-generate/runs/run-news/evidence`,
        )) as unknown as EvidenceJson;
        expect(evidence.capture).toMatchObject({ stamp: '20261117', settings: { skip_review: 'true' } });
        expect(evidence.results).not.toBeNull();
        const newsSummary = (evidence.results as { summary: Record<string, unknown> }).summary;
        expect(newsSummary.generation).toBeDefined();
    });

    it('keeps the legacy voice2 results route on the daily projection', async () => {
        const root = tempDir('kk-board-voice2-');
        const workDir = join(root, '.works', 'kk-daily-ai-voice2', '20261011');
        mkdirSync(workDir, { recursive: true });
        await captureRun(
            { workflow: 'kk-daily-ai-voice2', runId: 'run-voice', workDir, stamp: '20261011', settings: {} },
            { projectPath: root },
        );
        const board = startDagBoard(root, 'run-voice', 'kk-daily-ai-voice2');
        const reader = startReader(board.origin, root);
        const results = await getJson(`${reader}/api/workflows/kk-daily-ai-voice2/runs/run-voice/results`);
        expect('generation' in results.summary).toBe(false);
        expect(Array.isArray(results.summary.channels)).toBe(true);
        expect(results.summary.outcome).toBeNull();
    });
});
