import { describe, expect, it } from 'bun:test';
import {
    createBoardClient,
    DEFAULT_READER_ORIGIN,
    type FetchLike,
    isLoopbackHttpOrigin,
    readerOriginFrom,
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
