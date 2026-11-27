import { describe, expect, it } from 'bun:test';
import {
    createBoardClient,
    type FetchLike,
    isHttpOrigin,
    storeItemsQueryString,
    storeSelectionsQueryString,
} from '../../src/shared/api';

describe('isHttpOrigin', () => {
    it('accepts any http(s) origin with no path or credentials, including LAN and TLS ones', () => {
        expect(isHttpOrigin('http://192.168.87.27:3003')).toBe(true);
        expect(isHttpOrigin('https://board.example')).toBe(true);
        expect(isHttpOrigin('http://127.0.0.1:4340/')).toBe(true);
        expect(isHttpOrigin('ftp://board.example')).toBe(false);
        expect(isHttpOrigin('http://user:pw@board.example')).toBe(false);
        expect(isHttpOrigin('http://board.example/board')).toBe(false);
        expect(isHttpOrigin('board.example')).toBe(false);
    });
});

describe('createBoardClient', () => {
    it('rejects a malformed Board origin', () => {
        expect(() => createBoardClient({ moduleId: 'kk-collect', boardOrigin: 'http://board.example/api' })).toThrow(
            /board origin/,
        );
    });

    it('routes module reads, writes and Spur runs through the project gateway prefix', async () => {
        const seen: Array<[string, RequestInit | undefined]> = [];
        const client = createBoardClient({
            moduleId: 'kk-daily-ai-voice2',
            boardOrigin: 'https://board.example',
            pathname: '/knowledge-kit/board/modules/kk-daily-ai-voice2',
            fetchImpl: async (url, init) => {
                seen.push([String(url), init]);
                return Response.json({ schemaVersion: 1 });
            },
        });
        await client.health();
        await client.days('20261101', '20261127');
        await client.day('20261127');
        await client.dayArtifact('20261127', 'article');
        await client.action('publish-retry', { params: { day: '20261127' } });
        await client.runs('kk-daily-ai-voice2');
        const base = 'https://board.example/knowledge-kit';
        const moduleBase = `${base}/api/modules/kk-daily-ai-voice2`;
        expect(seen.map(([url]) => url)).toEqual([
            `${moduleBase}/api/health`,
            `${moduleBase}/api/days?from=20261101&until=20261127`,
            `${moduleBase}/api/days/20261127`,
            `${moduleBase}/api/days/20261127/artifacts/article`,
            `${moduleBase}/api/actions/publish-retry`,
            `${base}/api/runs?workflow=kk-daily-ai-voice2&limit=25`,
        ]);
        expect(seen[4]?.[1]).toMatchObject({ method: 'POST', headers: { 'x-kk-action': '1' } });
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
            moduleId: 'kk-collect',
            boardOrigin: 'http://127.0.0.1:4310/',
            fetchImpl,
        });
        expect(client.artifactUrl('kk-collect', 'run 1', 'facts')).toBe(
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/runs/run%201/artifacts/facts',
        );
        await client.runs('kk-collect', 'c1');
        expect(seen[0]).toBe('http://127.0.0.1:4310/api/runs?workflow=kk-collect&limit=25&cursor=c1');
    });

    it('throws on a non-ok response instead of returning an empty view', async () => {
        const fetchImpl: FetchLike = async () => new Response('nope', { status: 503 });
        const client = createBoardClient({
            moduleId: 'kk-collect',
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
            moduleId: 'kk-collect',
            boardOrigin: 'http://127.0.0.1:4310/',
            fetchImpl,
        });
        await client.results('kk-collect', 'run 1');
        await client.config('kk-collect', 'run 1');
        expect(await client.runDetail('run 1')).toEqual({ ok: true });
        expect(await client.progress('run 1')).toEqual({ ok: true });
        expect(seen).toEqual([
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/runs/run%201/results',
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/runs/run%201/config',
            'http://127.0.0.1:4310/api/runs/run%201',
            'http://127.0.0.1:4310/api/runs/run%201/progress',
        ]);
    });
});

describe('store routes', () => {
    const client = (seen: string[]) =>
        createBoardClient({
            moduleId: 'kk-collect',
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
            `http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/store/overview?runs=${encodeURIComponent(ids.slice(0, 25).join(','))}`,
        );
    });

    it('addresses the per-run store, items and selections routes', async () => {
        const seen: string[] = [];
        const board = client(seen);
        await board.storeRun('run 1');
        await board.storeItems('run 1', { page: 2, source: 'hn-ingest', seen: 'new' });
        await board.storeSelections({ page: 1, topic: 'ai-news', status: 'published', search: 'quantum' });
        expect(seen).toEqual([
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/runs/run%201/store',
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/runs/run%201/store/items?page=2&source=hn-ingest&seen=new',
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-collect/store/selections?page=1&topic=ai-news&status=published&search=quantum',
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

it('requests the channel aggregate through the Collect module', async () => {
    const seen: string[] = [];
    const client = createBoardClient({
        moduleId: 'kk-collect',
        boardOrigin: 'http://192.168.87.27:3003',
        fetchImpl: async (url) => {
            seen.push(String(url));
            return Response.json({ ok: true });
        },
    });
    await client.storeChannels({ fromMs: 0, untilMs: 1, page: 2 });
    expect(seen).toEqual([
        'http://192.168.87.27:3003/api/modules/kk-collect/api/workflows/kk-collect/store/channels?from=0&until=1&page=2',
    ]);
});

describe('0390 evidence route', () => {
    it('requests the versioned evidence envelope from the reader', async () => {
        const calls: string[] = [];
        const fetchImpl: FetchLike = async (input) => {
            calls.push(String(input));
            return new Response(
                JSON.stringify({
                    schemaVersion: 1,
                    workflow: 'kk-news-generate',
                    runId: 'run 7',
                    capture: null,
                    run: { id: 'run 7', status: 'done', startedAt: null, completedAt: null },
                    results: null,
                    diagnostics: [],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        };
        const client = createBoardClient({
            fetchImpl,
            moduleId: 'kk-collect',
            boardOrigin: 'http://127.0.0.1:4310',
        });
        const envelope = await client.evidence('kk-news-generate', 'run 7');
        expect(envelope.schemaVersion).toBe(1);
        expect(envelope.results).toBeNull();
        expect(calls[0]).toBe(
            'http://127.0.0.1:4310/api/modules/kk-collect/api/workflows/kk-news-generate/runs/run%207/evidence',
        );
    });
});
