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
