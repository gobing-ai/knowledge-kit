import { describe, expect, it } from 'bun:test';
import {
    createBoardClient,
    DEFAULT_READER_ORIGIN,
    type FetchLike,
    isLoopbackHttpOrigin,
    readerOriginFrom,
    storeItemsQueryString,
    storeSelectionsQueryString,
} from '../../src/shared/api';

describe('isLoopbackHttpOrigin', () => {
    it('accepts only loopback http origins with no path or credentials', () => {
        expect(isLoopbackHttpOrigin('http://127.0.0.1:4340')).toBe(true);
        expect(isLoopbackHttpOrigin('http://localhost')).toBe(true);
        expect(isLoopbackHttpOrigin('https://127.0.0.1')).toBe(false);
        expect(isLoopbackHttpOrigin('http://evil.example')).toBe(false);
        expect(isLoopbackHttpOrigin('http://user:pw@127.0.0.1')).toBe(false);
        expect(isLoopbackHttpOrigin('http://127.0.0.1:4340/api')).toBe(false);
        expect(isLoopbackHttpOrigin('not a url')).toBe(false);
    });
});

describe('readerOriginFrom', () => {
    it('accepts a loopback kkApi override and refuses a non-loopback one with a diagnostic', () => {
        expect(readerOriginFrom('?kkApi=http://127.0.0.1:5000')).toEqual({
            origin: 'http://127.0.0.1:5000',
            diagnostic: null,
        });
        expect(readerOriginFrom('?tab=summary')).toEqual({ origin: DEFAULT_READER_ORIGIN, diagnostic: null });
        const refused = readerOriginFrom('?kkApi=http://evil.example');
        expect(refused.origin).toBe(DEFAULT_READER_ORIGIN);
        expect(refused.diagnostic?.code).toBe('board.reader.origin-invalid');
    });
});

describe('createBoardClient', () => {
    it('refuses a non-loopback reader or board origin', () => {
        expect(() =>
            createBoardClient({ readerOrigin: 'http://evil.example', boardOrigin: 'http://127.0.0.1:1' }),
        ).toThrow(/reader origin/);
        expect(() =>
            createBoardClient({ readerOrigin: 'http://127.0.0.1:1', boardOrigin: 'https://evil.example' }),
        ).toThrow(/board origin/);
    });

    it('builds reader and board URLs through the injected fetch', async () => {
        const seen: string[] = [];
        const fetchImpl: FetchLike = async (input) => {
            const url = String(input);
            seen.push(url);
            return new Response(JSON.stringify({ runs: [], count: 0, nextCursor: null, hasMore: false }), {
                status: 200,
            });
        };
        const client = createBoardClient({
            readerOrigin: 'http://127.0.0.1:4340/',
            boardOrigin: 'http://127.0.0.1:4310/',
            fetchImpl,
        });
        expect(client.artifactUrl('kk-collect', 'run 1', 'facts')).toBe(
            'http://127.0.0.1:4340/api/workflows/kk-collect/runs/run%201/artifacts/facts',
        );
        await client.runs('kk-collect', 'c1');
        expect(seen[0]).toBe('http://127.0.0.1:4310/api/runs?workflow=kk-collect&limit=25&cursor=c1');
    });

    it('throws on a non-ok response instead of returning an empty view', async () => {
        const fetchImpl: FetchLike = async () => new Response('nope', { status: 503 });
        const client = createBoardClient({
            readerOrigin: 'http://127.0.0.1:4340',
            boardOrigin: 'http://127.0.0.1:4310',
            fetchImpl,
        });
        await expect(client.health()).rejects.toThrow(/503/);
    });
});

describe('createBoardClient run projections', () => {
    it('routes results and config to the reader, runDetail and progress to the board', async () => {
        const seen: string[] = [];
        const fetchImpl: FetchLike = async (input) => {
            seen.push(String(input));
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        };
        const client = createBoardClient({
            readerOrigin: 'http://127.0.0.1:4340/',
            boardOrigin: 'http://127.0.0.1:4310/',
            fetchImpl,
        });
        await client.results('kk-collect', 'run 1');
        await client.config('kk-collect', 'run 1');
        expect(await client.runDetail('run 1')).toEqual({ ok: true });
        expect(await client.progress('run 1')).toEqual({ ok: true });
        expect(seen).toEqual([
            'http://127.0.0.1:4340/api/workflows/kk-collect/runs/run%201/results',
            'http://127.0.0.1:4340/api/workflows/kk-collect/runs/run%201/config',
            'http://127.0.0.1:4310/api/runs/run%201',
            'http://127.0.0.1:4310/api/runs/run%201/progress',
        ]);
    });
});

describe('store routes', () => {
    const client = (seen: string[]) =>
        createBoardClient({
            readerOrigin: 'http://127.0.0.1:4340',
            boardOrigin: 'http://127.0.0.1:4310',
            fetchImpl: async (input) => {
                seen.push(String(input));
                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            },
        });

    it('sends the page ids to the overview route and caps them at the route limit', async () => {
        const seen: string[] = [];
        const ids = Array.from({ length: 30 }, (_, index) => `r-${index}`);
        await client(seen).storeOverview(ids);
        expect(seen[0]).toBe(
            `http://127.0.0.1:4340/api/workflows/kk-collect/store/overview?runs=${encodeURIComponent(ids.slice(0, 25).join(','))}`,
        );
    });

    it('addresses the per-run store, items and selections routes', async () => {
        const seen: string[] = [];
        const board = client(seen);
        await board.storeRun('run 1');
        await board.storeItems('run 1', { page: 2, source: 'hn-ingest', seen: 'new' });
        await board.storeSelections({ page: 1, topic: 'ai-news', status: 'published', search: 'quantum' });
        expect(seen).toEqual([
            'http://127.0.0.1:4340/api/workflows/kk-collect/runs/run%201/store',
            'http://127.0.0.1:4340/api/workflows/kk-collect/runs/run%201/store/items?page=2&source=hn-ingest&seen=new',
            'http://127.0.0.1:4340/api/workflows/kk-collect/store/selections?page=1&topic=ai-news&status=published&search=quantum',
        ]);
    });
});

describe('storeItemsQueryString', () => {
    it('writes only declared filters, and a decision only with its value', () => {
        expect(storeItemsQueryString({})).toBe('');
        expect(storeItemsQueryString({ decision: 'kk-item-quality' })).toBe('');
        expect(storeItemsQueryString({ value: 'HIGH' })).toBe('');
        expect(storeItemsQueryString({ decision: 'kk-item-quality', value: 'HIGH', selection: 'published' })).toBe(
            'decision=kk-item-quality&value=HIGH&selection=published',
        );
    });

    it('drops a blank search and trims a real one', () => {
        expect(storeItemsQueryString({ search: '   ' })).toBe('');
        expect(storeItemsQueryString({ search: ' quantum ' })).toBe('search=quantum');
    });
});

describe('storeSelectionsQueryString', () => {
    it('writes each declared filter and omits the empty ones', () => {
        expect(storeSelectionsQueryString({})).toBe('');
        expect(storeSelectionsQueryString({ topic: '', runId: '', search: ' ' })).toBe('');
        expect(storeSelectionsQueryString({ page: 2, topic: 'ai-news', status: 'dropped' })).toBe(
            'page=2&topic=ai-news&status=dropped',
        );
        expect(storeSelectionsQueryString({ runId: 'run 1' })).toBe('runId=run+1');
        expect(storeSelectionsQueryString({ search: ' error correction ' })).toBe('search=error+correction');
    });
});

/**
 * The native path — reader origin equals board origin, so every view reads Spur's own
 * `/api/project/database/tables/*` pages instead of the kk reader routes.
 *
 * Failure-first list:
 *  1. A label fetch that fails must leave the item's labels empty, never drop the item.
 *  2. `source_counts_json` that does not parse (or parses to an array) must not throw.
 *  3. An unknown DB cell type must read `null`, not the raw token or `undefined`.
 *  4. A selection whose item row is gone must still render, falling back to the item id.
 */
describe('native Spur board path', () => {
    /** A Spur database table page. */
    function dbPage(columns: string[], rows: Array<Array<{ t: string; v?: unknown }>>, total = rows.length) {
        return { page: 1, pageSize: 25, total, columns, rows };
    }

    /** A client whose two origins match, i.e. Spur's own board API on one port. */
    const native = (handler: (url: string) => Response) =>
        createBoardClient({
            readerOrigin: 'http://127.0.0.1:4310',
            boardOrigin: 'http://127.0.0.1:4310',
            fetchImpl: async (input) => handler(String(input)),
        });

    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    it('reads health, results and config from the board API', async () => {
        const seen: string[] = [];
        const board = native((url) => {
            seen.push(url);
            if (url.endsWith('/api/health')) return json({ ok: true });
            return json({
                run: {
                    status: 'running',
                    startedAt: '2026-10-01T00:00:00Z',
                    completedAt: '2026-10-01T00:10:00Z',
                    workflowName: 'kk-collect',
                    mode: 'state-machine',
                },
                actions: [{ durationMs: 1000 }, { durationMs: 500 }],
                phases: [{}, {}],
            });
        });
        expect(await board.health()).toEqual({ schemaVersion: 1, projectPath: 'knowledge-kit' });
        expect((await board.results('kk-collect', 'run 1')).summary).toEqual({
            status: 'running',
            startedAt: '2026-10-01T00:00:00Z',
            completedAt: '2026-10-01T00:10:00Z',
            durationMs: 1500,
            actions: 2,
            phases: 2,
        });
        const config = await board.config('kk-collect', 'run 1');
        expect(config.capturedAt).toBe('2026-10-01T00:00:00Z');
        expect(config.settings).toEqual({ workflowName: 'kk-collect', status: 'running', mode: 'state-machine' });
        expect(seen).toEqual([
            'http://127.0.0.1:4310/api/health',
            'http://127.0.0.1:4310/api/runs/run%201',
            'http://127.0.0.1:4310/api/runs/run%201',
        ]);
    });

    it('degrades to empty native views when the board API fails, instead of throwing', async () => {
        const board = native(() => new Response('nope', { status: 503 }));
        const results = await board.results('kk-collect', 'r1');
        expect(results.availability).toBe('missing');
        expect(results.summary).toEqual({});
        expect((await board.config('kk-collect', 'r1')).capturedAt).toBeNull();
        expect(await board.storeOverview(['r1', 'r2'])).toEqual({
            schemaVersion: 1,
            availability: 'available',
            lastStoredAt: null,
            rows: { r1: null, r2: null },
            diagnostics: [],
        });
        expect((await board.storeRun('r1')).row).toBeNull();
        expect((await board.storeRun('r1')).labelQuality).toEqual([]);
        expect(await board.storeItems('r1')).toMatchObject({ total: 0, items: [], sources: [] });
        expect(await board.storeSelections({})).toMatchObject({ total: 0, selections: [], topics: ['ai-news'] });
        await expect(board.health()).rejects.toThrow(/503/);
    });

    it('builds the overview from collect_runs rows, tolerating bad JSON and unknown cell types', async () => {
        const board = native(() =>
            json(
                dbPage(
                    ['run_id', 'finished_at', 'source_counts_json', 'inserted', 'updated'],
                    [
                        [
                            { t: 'text', v: 'r1' },
                            { t: 'num', v: 2000 },
                            { t: 'text', v: '{"hn":3}' },
                            { t: 'num', v: 4 },
                            { t: 'num', v: 1 },
                        ],
                        [
                            { t: 'text', v: 'r2' },
                            { t: 'null' },
                            { t: 'text', v: '[1,2]' },
                            { t: 'null' },
                            { t: 'opaque', v: 'x' },
                        ],
                    ],
                ),
            ),
        );
        const overview = await board.storeOverview(['r1', 'r-missing']);
        expect(overview.lastStoredAt).toBe(new Date(2000).toISOString());
        expect(overview.rows.r1).toMatchObject({ runId: 'r1', sourceCounts: { hn: 3 }, inserted: 4, updated: 1 });
        expect(overview.rows['r-missing']).toBeNull();
    });

    it('aggregates label quality per decision and value from the labels table', async () => {
        const board = native((url) => {
            if (url.includes('/tables/collect_runs/rows')) {
                return json(
                    dbPage(
                        ['run_id', 'source_counts_json', 'inserted', 'updated'],
                        [
                            [
                                { t: 'text', v: 'r1' },
                                { t: 'text', v: 'not json' },
                                { t: 'num', v: 2 },
                                { t: 'num', v: 0 },
                            ],
                        ],
                    ),
                );
            }
            return json(
                dbPage(
                    ['decision_id', 'value', 'confidence'],
                    [
                        [
                            { t: 'text', v: 'kk-item-quality' },
                            { t: 'text', v: '2' },
                            { t: 'text', v: 'HIGH' },
                        ],
                        [
                            { t: 'text', v: 'kk-item-quality' },
                            { t: 'text', v: '2' },
                            { t: 'text', v: 'MEDIUM' },
                        ],
                        [
                            { t: 'text', v: 'kk-item-quality' },
                            { t: 'text', v: '3' },
                            { t: 'text', v: 'unrecognized' },
                        ],
                        [{ t: 'text', v: 'kk-item-quality' }, { t: 'null' }, { t: 'null' }],
                    ],
                ),
            );
        });
        const store = await board.storeRun('r1');
        expect(store.row).toMatchObject({ runId: 'r1', sourceCounts: {}, inserted: 2 });
        expect(store.labelQuality).toEqual([
            {
                decisionId: 'kk-item-quality',
                run: [
                    { value: '2', HIGH: 1, MEDIUM: 1, LOW: 0, none: 0 },
                    { value: '3', HIGH: 0, MEDIUM: 0, LOW: 0, none: 1 },
                    { value: 'none', HIGH: 0, MEDIUM: 0, LOW: 0, none: 1 },
                ],
                effective: [
                    { value: '2', count: 2 },
                    { value: '3', count: 1 },
                    { value: 'none', count: 1 },
                ],
            },
        ]);
    });

    it('reports a run with no collect_runs row as null when the page has no rows array', async () => {
        const board = native((url) =>
            url.includes('/tables/collect_runs/rows')
                ? json({ page: 1, pageSize: 1, total: 0, columns: ['run_id'] })
                : new Response('boom', { status: 500 }),
        );
        const store = await board.storeRun('r1');
        expect(store.row).toBeNull();
        expect(store.labelQuality).toEqual([]);
    });

    it('filters and enriches native items, and survives a missing label fetch', async () => {
        const urls: string[] = [];
        const board = native((url) => {
            urls.push(url);
            if (url.includes('/tables/items/rows')) {
                return json(
                    dbPage(
                        [
                            'id',
                            'title',
                            'canonical_url',
                            'source',
                            'story_id',
                            'first_seen_run',
                            'last_seen_run',
                            'first_seen_at',
                            'published_at',
                            'domain',
                            'lang',
                            'body_chars',
                            'engagement',
                        ],
                        [
                            [
                                { t: 'text', v: 'i1' },
                                { t: 'text', v: 'A title' },
                                { t: 'text', v: 'https://ex.com/a' },
                                { t: 'text', v: 'hn' },
                                { t: 'text', v: 's1' },
                                { t: 'text', v: 'r1' },
                                { t: 'text', v: 'r2' },
                                { t: 'num', v: 1000 },
                                { t: 'null' },
                                { t: 'text', v: 'ex.com' },
                                { t: 'text', v: 'en' },
                                { t: 'num', v: 900 },
                                { t: 'num', v: 12 },
                            ],
                            [
                                { t: 'text', v: 'i2' },
                                { t: 'null' },
                                { t: 'text', v: 'javascript:alert(1)' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'text', v: 'r1' },
                                { t: 'text', v: 'r1' },
                                { t: 'null' },
                                { t: 'num', v: 2000 },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'null' },
                            ],
                        ],
                        41,
                    ),
                );
            }
            if (url.includes('/tables/labels/rows') && url.includes('filter=i1')) {
                return json(
                    dbPage(
                        ['decision_id', 'value', 'confidence', 'maker', 'score'],
                        [
                            [
                                { t: 'text', v: 'kk-item-quality' },
                                { t: 'num', v: 3 },
                                { t: 'text', v: 'HIGH' },
                                { t: 'text', v: 'fm-local' },
                                { t: 'num', v: 0.8 },
                            ],
                            [
                                { t: 'text', v: 'kk-item-importance' },
                                { t: 'text', v: 'HIGH' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'null' },
                            ],
                            [{ t: 'null' }, { t: 'text', v: '2' }, { t: 'null' }, { t: 'null' }, { t: 'null' }],
                        ],
                    ),
                );
            }
            return new Response('boom', { status: 500 });
        });
        const items = await board.storeItems('run 9', { page: 2, search: ' quantum ' });
        expect(urls[0]).toContain('filterColumn=title');
        expect(urls[0]).toContain('filter=quantum');
        expect(items.total).toBe(41);
        expect(items.items[0]).toMatchObject({
            id: 'i1',
            title: 'A title',
            url: 'https://ex.com/a',
            source: 'hn',
            seen: 'reseen',
            labels: { 'kk-item-quality': '3', 'kk-item-importance': 'HIGH' },
            labelDetails: {
                'kk-item-quality': { value: '3', confidence: 'HIGH', maker: 'fm-local', score: 0.8 },
                'kk-item-importance': { value: 'HIGH', confidence: null, maker: null, score: null },
            },
            domain: 'ex.com',
            lang: 'en',
            bodyChars: 900,
            engagement: 12,
        });
        expect(items.items[1]).toMatchObject({
            id: 'i2',
            url: null,
            source: 'unknown',
            seen: 'new',
            labels: {},
            labelDetails: {},
            storyId: null,
        });
    });

    it('picks exactly one native items filter: search, then source, then the run id', async () => {
        const urls: string[] = [];
        const board = native((url) => {
            urls.push(url);
            return json(dbPage(['id'], []));
        });
        await board.storeItems('run 1', { search: 'x' });
        await board.storeItems('run 1', { source: 'hn' });
        await board.storeItems('run 1');
        await board.storeItems(undefined);
        expect(urls[0]).toContain('filterColumn=title&filter=x');
        expect(urls[1]).toContain('filterColumn=source&filter=hn');
        expect(urls[2]).toContain('filterColumn=first_seen_run&filter=run+1');
        expect(urls[3]).not.toContain('filterColumn');
    });

    it('joins native selections with their items and falls back when the item row is gone', async () => {
        const urls: string[] = [];
        const board = native((url) => {
            urls.push(url);
            if (url.includes('/tables/selections/rows')) {
                return json(
                    dbPage(
                        [
                            'topic',
                            'item_id',
                            'run_id',
                            'story_id',
                            'workflow',
                            'rank',
                            'reason',
                            'status',
                            'selected_at',
                            'published_at',
                        ],
                        [
                            [
                                { t: 'text', v: 'ai-news' },
                                { t: 'text', v: 'i1' },
                                { t: 'text', v: 'r1' },
                                { t: 'text', v: 's1' },
                                { t: 'text', v: 'kk-collect' },
                                { t: 'num', v: 1 },
                                { t: 'text', v: 'top' },
                                { t: 'text', v: 'published' },
                                { t: 'num', v: 1000 },
                                { t: 'num', v: 2000 },
                            ],
                            [
                                { t: 'text', v: 'ai-news' },
                                { t: 'text', v: 'i2' },
                                { t: 'text', v: 'r1' },
                                { t: 'text', v: 's2' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'null' },
                                { t: 'num', v: 1001 },
                                { t: 'null' },
                            ],
                        ],
                    ),
                );
            }
            if (url.includes('filter=i1')) {
                return json(
                    dbPage(
                        ['title', 'source', 'canonical_url'],
                        [
                            [
                                { t: 'text', v: 'A title' },
                                { t: 'text', v: 'hn' },
                                { t: 'text', v: 'https://ex.com/a' },
                            ],
                        ],
                        1,
                    ),
                );
            }
            return new Response('boom', { status: 500 });
        });
        const selections = await board.storeSelections({ page: 1, topic: 'ai-news', status: 'published' });
        expect(urls[0]).toContain('filterColumn=topic&filter=ai-news');
        expect(selections.selections[0]).toMatchObject({
            topic: 'ai-news',
            itemId: 'i1',
            runId: 'r1',
            workflow: 'kk-collect',
            rank: 1,
            reason: 'top',
            status: 'published',
            publishedAt: 2000,
            title: 'A title',
            source: 'hn',
            url: 'https://ex.com/a',
        });
        expect(selections.selections[1]).toMatchObject({
            itemId: 'i2',
            workflow: null,
            rank: null,
            reason: null,
            status: 'selected',
            publishedAt: null,
            title: 'i2',
            source: 'unknown',
            url: null,
        });
        expect(selections.topics).toEqual(['ai-news']);
    });

    it('picks exactly one native selections filter: topic, then status, then the run id', async () => {
        const urls: string[] = [];
        const board = native((url) => {
            urls.push(url);
            return json(dbPage(['topic'], []));
        });
        await board.storeSelections({ topic: 'ai-news' });
        await board.storeSelections({ status: 'dropped' });
        await board.storeSelections({ runId: 'run 1' });
        await board.storeSelections({});
        expect(urls[0]).toContain('filterColumn=topic&filter=ai-news');
        expect(urls[1]).toContain('filterColumn=status&filter=dropped');
        expect(urls[2]).toContain('filterColumn=run_id&filter=run+1');
        expect(urls[3]).not.toContain('filterColumn');
    });
});
