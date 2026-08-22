import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { initializeLogger } from '@gobing-ai/ts-infra';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    buildFixtureDocs,
    computeId,
    type FetchLike,
    main,
    parseInput,
    realMarkitdown,
    scrapeAndCacheDocs,
    searchFirecrawl,
} from '../src/index';

const NOW = new Date('2026-08-14T12:00:00.000Z');

/** Build a minimal fake Response for injected-fetch tests. */
function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

/** Wrap a fake fetch body as `FetchLike`. */
function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): FetchLike {
    return impl;
}

const TMP_DIR = join(import.meta.dir, 'tmp');
const IN_FILE = join(TMP_DIR, 'in.json');
const OUT_FILE = join(TMP_DIR, 'docs.json');

// ADR-013 R6 — live mode probes `markitdown` on PATH before any network call. A stub
// binary (stdin → stdout passthrough) keeps the suite hermetic: no real markitdown, and
// deterministic probe results on machines without the tool installed.
const STUB_BIN_DIR = join(import.meta.dir, 'tmp-stub-bin');
const ORIGINAL_PATH = process.env.PATH;

beforeAll(async () => {
    await mkdir(STUB_BIN_DIR, { recursive: true });
    await writeFile(join(STUB_BIN_DIR, 'markitdown'), '#!/bin/sh\nexec cat\n', { mode: 0o755 });
    process.env.PATH = `${STUB_BIN_DIR}:${ORIGINAL_PATH ?? ''}`;
});

afterAll(async () => {
    process.env.PATH = ORIGINAL_PATH;
    await rm(STUB_BIN_DIR, { recursive: true, force: true });
});

async function writeInput(topic: string, extra: Record<string, unknown> = {}): Promise<void> {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(IN_FILE, JSON.stringify({ topic, ...extra }), 'utf-8');
}

const ORIGINAL_ARGV = process.argv;

afterEach(async () => {
    process.argv = ORIGINAL_ARGV;
    await rm(TMP_DIR, { recursive: true, force: true });
});

async function captureEchoErrors(fn: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
    const errTarget = createBufferTarget();
    const restore = setDefaultOutputTargets({ stderr: errTarget });
    try {
        const code = await fn();
        const raw = errTarget.text();
        const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw ? raw.split('\n') : [];
        return { code, lines };
    } finally {
        restore();
    }
}

async function captureLogWarns<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[] }> {
    const warns: string[] = [];
    await initializeLogger({
        console: false,
        fileSink: (line) => warns.push(line),
        level: 'debug',
    });
    try {
        const result = await fn();
        return { result, warns };
    } finally {
        await initializeLogger({ console: false, level: 'warn' });
    }
}

describe('web-search fixture plugin', () => {
    test('writes a schema-valid Doc[] to --out via --in/--out', async () => {
        await writeInput('STORM topic research', { fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);

        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs.length).toBeGreaterThanOrEqual(2);
        for (const doc of docs) {
            expect(doc.id).toMatch(/^[0-9a-f]{16}$/);
            expect(doc.body.length).toBeGreaterThan(0);
            expect(doc.sourceUri).toBeDefined();
            expect(doc.title).toBeDefined();
            expect(doc.mediaType).toBe('text/markdown');
            expect(doc.metadata?.query).toBe('STORM topic research');
            expect(typeof doc.metadata?.rank).toBe('number');
        }
    });

    test('Doc ids are deterministic across two runs', async () => {
        await writeInput('STORM topic research', { fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);
        const firstIds = (JSON.parse(await readFile(OUT_FILE, 'utf-8')) as { id: string }[]).map((d) => d.id);

        expect(await main()).toBe(0);
        const secondIds = (JSON.parse(await readFile(OUT_FILE, 'utf-8')) as { id: string }[]).map((d) => d.id);
        expect(secondIds).toEqual(firstIds);
    });

    test('maxResults caps the emitted Doc list', async () => {
        await writeInput('STORM topic research', { maxResults: 2, fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs.length).toBe(2);
    });

    test('invocable via kk executor run (runInvoke)', async () => {
        await writeInput('STORM topic research', { fixture: true });
        try {
            const exitCode = await runInvoke({
                plugin: 'web-search',
                inPath: IN_FILE,
                outPath: OUT_FILE,
                pluginsRoot: join(import.meta.dir, '../..'),
            });
            expect(exitCode).toBe(0);

            const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
            expect(docs.length).toBeGreaterThanOrEqual(2);
        } finally {
            await rm(OUT_FILE, { force: true });
        }
    });

    test('live mode (fixture absent) uses injected fetch and never sets FIRECRAWL_API_KEY in env', async () => {
        // Guard: the live happy path must run entirely on the injected fetch — no real network.
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const docs = await searchFirecrawl(parseInput('{"topic":"STORM topic research"}'), {
            fetch: async () =>
                jsonResponse(200, {
                    success: true,
                    data: {
                        web: [{ url: 'https://a.example/a', title: 'A', markdown: '# A\n\nbody', position: 1 }],
                    },
                }),
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
        });
        expect(docs).toHaveLength(1);
        const first = docs[0];
        if (!first) throw new Error('expected one doc');
        expect(first.id).toBe(computeId('https://a.example/a'));
        expect(first.mediaType).toBe('text/markdown');
        expect(first.metadata?.query).toBe('STORM topic research');
        expect(first.metadata?.rank).toBe(0);
        expect(first.metadata?.scraped_at).toBe(NOW.toISOString());
    });

    test('live happy path via main() writes schema-valid Doc[] to --out (fixture absent)', async () => {
        // Scrape pass warns per URL (mock returns search-shaped data for /v2/scrape) — capture, don't leak.
        const fakeFetch = mockFetch(async () =>
            jsonResponse(200, {
                success: true,
                data: {
                    web: [
                        { url: 'https://a.example/a', title: 'A', markdown: '# A\n\nbody', position: 1 },
                        { url: 'https://b.example/b', title: 'B', markdown: '## B\n\nbody2', position: 2 },
                    ],
                },
            }),
        );
        await writeInput('STORM topic research', {}); // fixture absent → live path
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        try {
            const res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(0);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs).toHaveLength(2);
        for (const doc of docs) {
            expect(doc.id).toMatch(/^[0-9a-f]{16}$/);
            expect(doc.mediaType).toBe('text/markdown');
            expect(typeof doc.metadata?.rank).toBe('number');
        }
    });

    test('R2: live run without FIRECRAWL_API_KEY exits 1 with exact stderr and no --out', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(200, { success: true, data: { web: [] } }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        delete process.env.FIRECRAWL_API_KEY;
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines).toEqual(['web-search failed: FIRECRAWL_API_KEY is unset']);
    });

    test('live HTTP 401 exits 1 with status + error and no --out', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(401, { success: false, error: 'Unauthorized' }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines).toHaveLength(1);
        expect(res.lines[0]).toBe('web-search failed: Firecrawl HTTP 401: Unauthorized');
    });

    test('live transport error (fetch throws) exits 1 with network message and no --out', async () => {
        const fakeFetch = mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines[0]).toBe('web-search failed: Firecrawl network error: ECONNREFUSED');
    });

    test('live 200 with success:false exits 1 with status + error and no --out', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(200, { success: false, error: 'Something went wrong' }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines[0]).toBe('web-search failed: Firecrawl HTTP 200: Something went wrong');
    });

    test('live HTTP 429 exits 1 with status + error (no silent retry)', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(429, { success: false, error: 'Rate limit exceeded' }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] } = { code: 0, lines: [] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines[0]).toBe('web-search failed: Firecrawl HTTP 429: Rate limit exceeded');
    });

    test('zero web hits writes [] and exits 0', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(200, { success: true, data: { web: [] } }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        try {
            expect(await main({ fetch: fakeFetch })).toBe(0);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        expect(JSON.parse(await readFile(OUT_FILE, 'utf-8'))).toEqual([]);
    });

    test('partial skip: one good + one empty markdown returns the good Doc and warns', async () => {
        // Pre-seed the cache for the surviving doc (R4) so the scrape pass is a pure
        // cache hit — the assertion below counts exactly the original skip warning.
        await mkdir(join(TMP_DIR, 'references'), { recursive: true });
        await writeFile(join(TMP_DIR, 'references', `${computeId('https://a.example/a')}.md`), '# A cached', 'utf-8');
        const fakeFetch = mockFetch(async () =>
            jsonResponse(200, {
                success: true,
                data: {
                    web: [
                        { url: 'https://a.example/a', title: 'A', markdown: '# A\n\nbody', position: 1 },
                        { url: 'https://b.example/b', title: 'B', markdown: '   ', position: 2 },
                    ],
                },
            }),
        );
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        const { result: exitCode, warns } = await captureLogWarns(async () => {
            try {
                return await main({ fetch: fakeFetch });
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
        });
        expect(exitCode).toBe(0);
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs).toHaveLength(1);
        expect(docs[0]?.sourceUri).toBe('https://a.example/a');
        expect(warns.length).toBe(1);
    });

    test('all empty markdown (hits but no usable bodies) exits 1 with no --out', async () => {
        const fakeFetch = mockFetch(async () =>
            jsonResponse(200, {
                success: true,
                data: {
                    web: [
                        { url: 'https://a.example/a', title: 'A', markdown: '' },
                        { url: 'https://b.example/b', title: 'B', markdown: null },
                    ],
                },
            }),
        );
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines[0]).toBe('web-search failed: Firecrawl returned hits but no usable markdown bodies');
    });

    test('malformed 200 (success:true with data missing) exits 1 with no --out', async () => {
        const fakeFetch = mockFetch(async () => jsonResponse(200, { success: true }));
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        let res: { code: number; lines: string[] };
        try {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines[0]).toBe('web-search failed: Firecrawl malformed response: data missing');
    });

    test('R3: computeId is stable and exported as a 16-char hex string', () => {
        const uri = 'https://example.org/research/stable';
        expect(computeId(uri)).toMatch(/^[0-9a-f]{16}$/);
        expect(computeId(uri)).toBe(computeId(uri));
        expect(computeId(uri)).not.toBe(computeId(`${uri}/other`));
    });

    test('fixture mode creates no references/ cache dir (R8/R9)', async () => {
        await writeInput('STORM topic research', { fixture: true });
        let fetchCalls = 0;
        const fakeFetch = mockFetch(async () => {
            fetchCalls += 1;
            throw new Error('fixture mode must not fetch');
        });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main({ fetch: fakeFetch })).toBe(0);
        expect(fetchCalls).toBe(0);
        let entries: string[] = [];
        try {
            entries = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: join(TMP_DIR, 'references') }));
        } catch {
            // references/ absent — expected when the fixture path never scrapes.
        }
        expect(entries).toEqual([]);
    });

    test('missing topic exits 1 and writes no --out', async () => {
        await writeInput('   ');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        await rm(OUT_FILE, { force: true });
        const res = await captureEchoErrors(() => main());
        expect(res.code).toBe(1);
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines).toEqual(['web-search failed: --in "topic" is required and must be a non-empty string']);
    });

    test('buildFixtureDocs emits D4-citation-surviving docs with stable ids', () => {
        const docs = buildFixtureDocs('stable topic', 8);
        expect(docs.length).toBeGreaterThanOrEqual(2);
        const ids = new Set(docs.map((d) => d.id));
        expect(ids.size).toBe(docs.length);
        expect(docs.every((d) => d.id && d.sourceUri && d.title && d.body.length > 0)).toBe(true);
    });
});

describe('web-search fail-loud validation (parseInput)', () => {
    test('rejects invalid JSON with a clear error', () => {
        expect(() => parseInput('{not json')).toThrow('--in is not valid JSON');
    });

    test('rejects non-object JSON with a clear error', () => {
        expect(() => parseInput('"just a string"')).toThrow('--in must be a JSON object');
        expect(() => parseInput('null')).toThrow('--in must be a JSON object');
    });

    test('rejects non-positive or non-integer maxResults', () => {
        const bad = (maxResults: unknown) => parseInput(JSON.stringify({ topic: 't', maxResults }));
        expect(() => bad(0)).toThrow('--in "maxResults" must be a positive integer when present');
        expect(() => bad(2.5)).toThrow('--in "maxResults" must be a positive integer when present');
    });
});

describe('web-search CLI failure paths', () => {
    test('missing --in/--out exits 1', async () => {
        process.argv = ['bun', 'test'];
        const res = await captureEchoErrors(() => main());
        expect(res.code).toBe(1);
        expect(res.lines).toEqual(['Error: Missing required arguments --in and --out']);
    });

    test('write failure exits 1 with a message', async () => {
        await writeInput('STORM topic research', { fixture: true });
        await writeFile(join(TMP_DIR, 'blocker'), 'file, not a dir', 'utf-8');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', join(TMP_DIR, 'blocker', 'docs.json')];
        const res = await captureEchoErrors(() => main());
        expect(res.code).toBe(1);
        expect(res.lines).toHaveLength(1);
        expect(res.lines[0]).toContain('web-search failed:');
    });
});

describe('web-search live error-body branches (extractError + empty-body + success-missing)', () => {
    const withKey = async (fn: () => Promise<unknown>): Promise<void> => {
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        try {
            await fn();
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
    };
    const runLive = async (fetchImpl: () => Response | Promise<Response>): Promise<string> => {
        const fakeFetch = mockFetch(async () => fetchImpl());
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        let res: { code: number; lines: string[] } = { code: 0, lines: [] };
        await withKey(async () => {
            res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
            expect(res.code).toBe(1);
        });
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(res.lines).toHaveLength(1);
        return res.lines[0] as string;
    };

    test('HTTP error with a non-JSON body falls back to an empty error message', async () => {
        // 0054 Block 5 row 4 — 4xx/5xx with a non-JSON body; extractError must not throw.
        const err = await runLive(() => new Response('gateway timeout page', { status: 502 }));
        expect(err).toBe('web-search failed: Firecrawl HTTP 502: ');
    });

    test('HTTP error with an object error body stringifies it', async () => {
        // extractError JSON.stringify branch — error is a non-string, non-null object.
        const err = await runLive(() => jsonResponse(400, { success: false, error: { code: 42 } }));
        expect(err).toBe('web-search failed: Firecrawl HTTP 400: {"code":42}');
    });

    test('HTTP error with an empty-string error is stringified (non-null branch)', async () => {
        // extractError: error is a string but empty — still a non-null value, so JSON.stringify('') → "".
        const err = await runLive(() => jsonResponse(400, { success: false, error: '' }));
        expect(err).toBe('web-search failed: Firecrawl HTTP 400: ""');
    });

    test('200 body that is not JSON reports malformed response (invalid JSON)', async () => {
        // Row 5 — HTTP 200 with a non-JSON body string.
        const err = await runLive(() => new Response('<html>oops</html>', { status: 200 }));
        expect(err).toBe('web-search failed: Firecrawl malformed response: invalid JSON');
    });

    test('200 body whose text() throws reports empty response body', async () => {
        // Row 5 — res.text() rejecting surfaces as an empty-body diagnostic.
        const throwing = new Response('', { status: 200 });
        (throwing as unknown as { text: () => Promise<string> }).text = async () => {
            throw new Error('stream closed');
        };
        const err = await runLive(() => throwing);
        expect(err).toBe('web-search failed: Firecrawl HTTP 200: empty response body');
    });

    test('200 body with success missing (not true/false) is malformed', async () => {
        // Row 5 — success key absent entirely, not false.
        const err = await runLive(() => jsonResponse(200, { data: { web: [] } }));
        expect(err).toBe('web-search failed: Firecrawl malformed response: success missing');
    });
});

describe('web-search evidence cache (ADR-013 R1–R11)', () => {
    const searchBody = (urls: string[]): unknown => ({
        success: true,
        data: { web: urls.map((url, i) => ({ url, title: `T${i}`, markdown: `# snippet ${i}`, position: i + 1 })) },
    });

    const withKeyEnv = async (fn: () => Promise<unknown>): Promise<void> => {
        const saved = process.env.FIRECRAWL_API_KEY;
        process.env.FIRECRAWL_API_KEY = 'test-key';
        try {
            await fn();
        } finally {
            if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
            else process.env.FIRECRAWL_API_KEY = saved;
        }
    };

    test('R1/R2: live main() scrapes, caches references/<doc-id>.md, swaps bodies; docs.json schema-valid', async () => {
        const scrapeCalls: string[] = [];
        // /v2/search → 2 docs; /v2/scrape → html for both (stub markitdown = cat passthrough).
        const fakeFetch = mockFetch(async (input: string, init?: RequestInit) => {
            if (input.includes('/v2/scrape')) {
                const url = (JSON.parse(String(init?.body)) as { url: string }).url;
                scrapeCalls.push(url);
                return jsonResponse(200, { success: true, data: { html: `<h1>full ${url}</h1>` } });
            }
            return jsonResponse(200, searchBody(['https://a.example/a', 'https://b.example/b']));
        });
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        await withKeyEnv(async () => {
            expect(await main({ fetch: fakeFetch })).toBe(0);
        });
        expect(scrapeCalls).toHaveLength(2);
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs).toHaveLength(2);
        for (const doc of docs) {
            if (!doc.sourceUri) throw new Error('expected sourceUri');
            const cache = await readFile(join(TMP_DIR, 'references', `${computeId(doc.sourceUri)}.md`), 'utf-8');
            expect(cache).toBe(doc.body);
            expect(doc.body).toBe(`<h1>full ${doc.sourceUri}</h1>`);
        }
    });

    test('R4: pre-seeded references cache skips the /v2/scrape call for that doc', async () => {
        const cachedA = '# A cached full content';
        await mkdir(join(TMP_DIR, 'references'), { recursive: true });
        await writeFile(join(TMP_DIR, 'references', `${computeId('https://a.example/a')}.md`), cachedA, 'utf-8');
        const scrapeCalls: string[] = [];
        const fakeFetch = mockFetch(async (input: string, init?: RequestInit) => {
            if (input.includes('/v2/scrape')) {
                const url = (JSON.parse(String(init?.body)) as { url: string }).url;
                scrapeCalls.push(url);
                return jsonResponse(200, { success: true, data: { markdown: '# b full' } });
            }
            return jsonResponse(200, searchBody(['https://a.example/a', 'https://b.example/b']));
        });
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        await withKeyEnv(async () => {
            expect(await main({ fetch: fakeFetch })).toBe(0);
        });
        expect(scrapeCalls).toEqual(['https://b.example/b']);
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs[0]?.body).toBe(cachedA);
        expect(docs[1]?.body).toBe('# b full');
    });

    test('R3: one failed /v2/scrape warns, keeps the snippet body, exits 0, writes docs.json', async () => {
        const fakeFetch = mockFetch(async (input: string, init?: RequestInit) => {
            if (input.includes('/v2/scrape')) {
                const url = (JSON.parse(String(init?.body)) as { url: string }).url;
                if (url === 'https://b.example/b') return jsonResponse(500, { success: false, error: 'boom' });
                return jsonResponse(200, { success: true, data: { markdown: '# a full' } });
            }
            return jsonResponse(200, searchBody(['https://a.example/a', 'https://b.example/b']));
        });
        await writeInput('STORM topic research', {});
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        const { warns } = await captureLogWarns(async () => {
            await withKeyEnv(async () => {
                expect(await main({ fetch: fakeFetch })).toBe(0);
            });
        });
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs[0]?.body).toBe('# a full');
        expect(docs[1]?.body).toBe('# snippet 1');
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain('https://b.example/b');
    });

    test('R6: live main() without markitdown on PATH exits 1 naming markitdown, no docs.json, no network', async () => {
        let fetchCalls = 0;
        const fakeFetch = mockFetch(async () => {
            fetchCalls += 1;
            return jsonResponse(200, { success: true, data: { web: [] } });
        });
        const savedPath = process.env.PATH;
        process.env.PATH = '/nonexistent-path-for-kk-test';
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            let res: { code: number; lines: string[] } = { code: 0, lines: [] };
            await withKeyEnv(async () => {
                res = await captureEchoErrors(() => main({ fetch: fakeFetch }));
                expect(res.code).toBe(1);
            });
            expect(fetchCalls).toBe(0); // fail loud happens before any network call
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(res.lines).toEqual(['web-search failed: markitdown is not on PATH']);
        } finally {
            process.env.PATH = savedPath;
        }
    });

    test('R11 (unit): scrape returning unusable content falls back to the snippet body and warns', async () => {
        const deps = {
            fetch: (async () => {
                throw new Error('search not used in this seam test');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async () =>
                jsonResponse(200, { success: true, data: { html: '  ', markdown: ' ' } })) as FetchLike,
            markitdown: (async (html: string) => `# md ${html}`) as (html: string) => Promise<string>,
        };
        const doc = {
            id: computeId('https://x.example/x'),
            body: '# snippet',
            title: 'X',
            sourceUri: 'https://x.example/x',
            mediaType: 'text/markdown',
            metadata: {},
        };
        const { result: out, warns } = await captureLogWarns(async () => scrapeAndCacheDocs([doc], deps, OUT_FILE));
        expect(out).toHaveLength(1);
        expect(out[0]?.body).toBe('# snippet');
        expect(warns).toHaveLength(1);
        expect(warns[0]).toContain('https://x.example/x');
    });

    test('R3 (unit): scrape transport throw keeps the snippet body without rejecting the pass', async () => {
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async () => {
                throw new Error('ECONNRESET');
            }) as FetchLike,
            markitdown: (async (html: string) => `# md ${html}`) as (html: string) => Promise<string>,
        };
        const doc = { id: computeId('https://y.example/y'), body: '# snippet y', sourceUri: 'https://y.example/y' };
        const { result: out, warns } = await captureLogWarns(async () => scrapeAndCacheDocs([doc], deps, OUT_FILE));
        expect(out[0]?.body).toBe('# snippet y');
        expect(warns[0]).toContain('ECONNRESET');
    });

    test('R9 (unit): html → markitdown invoked; markdown-only → used as-is without markitdown', async () => {
        const mdCalls: string[] = [];
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async (_input: string, init?: RequestInit) => {
                const url = (JSON.parse(String(init?.body)) as { url: string }).url;
                if (url === 'https://a.example/a') {
                    return jsonResponse(200, { success: true, data: { html: '<p>raw</p>' } });
                }
                return jsonResponse(200, { success: true, data: { markdown: '# already md' } });
            }) as FetchLike,
            markitdown: (async (html: string) => {
                mdCalls.push(html);
                return '# normalized from html';
            }) as (html: string) => Promise<string>,
        };
        const docs = [
            { id: computeId('https://a.example/a'), body: 's', sourceUri: 'https://a.example/a' },
            { id: computeId('https://b.example/b'), body: 's', sourceUri: 'https://b.example/b' },
        ];
        const out = await scrapeAndCacheDocs(docs, deps, OUT_FILE);
        expect(mdCalls).toEqual(['<p>raw</p>']);
        expect(out[0]?.body).toBe('# normalized from html');
        expect(out[1]?.body).toBe('# already md');
        const cacheA = await readFile(join(TMP_DIR, 'references', `${computeId('https://a.example/a')}.md`), 'utf-8');
        expect(cacheA).toBe('# normalized from html');
    });

    test('R8 (unit): a whitespace-only cache file is a miss — scrapes and overwrites', async () => {
        await mkdir(join(TMP_DIR, 'references'), { recursive: true });
        const cacheFile = join(TMP_DIR, 'references', `${computeId('https://a.example/a')}.md`);
        await writeFile(cacheFile, '   \n  ', 'utf-8');
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async () => jsonResponse(200, { success: true, data: { markdown: '# fresh full' } })) as FetchLike,
        };
        const doc = { id: computeId('https://a.example/a'), body: '# snippet', sourceUri: 'https://a.example/a' };
        const out = await scrapeAndCacheDocs([doc], deps, OUT_FILE);
        expect(out[0]?.body).toBe('# fresh full');
        expect(await readFile(cacheFile, 'utf-8')).toBe('# fresh full');
    });

    test('R5 (unit): a Doc without sourceUri passes through untouched, no scrape call', async () => {
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async () => {
                throw new Error('scrape must not be called without a sourceUri');
            }) as FetchLike,
        };
        const doc = { id: 'no-uri-doc', body: '# local doc' };
        const out = await scrapeAndCacheDocs([doc as Doc], deps, OUT_FILE);
        expect(out).toEqual([doc]);
    });

    test('R11 (unit): scrape pass without FIRECRAWL_API_KEY warns and keeps the snippet (non-fatal)', async () => {
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: {},
            now: () => NOW,
        };
        const doc = { id: computeId('https://z.example/z'), body: '# snippet z', sourceUri: 'https://z.example/z' };
        const { result: out, warns } = await captureLogWarns(async () => scrapeAndCacheDocs([doc], deps, OUT_FILE));
        expect(out[0]?.body).toBe('# snippet z');
        expect(warns[0]).toContain('FIRECRAWL_API_KEY is unset');
    });

    test('R11 (unit): malformed scrape 200 (success:false) warns and keeps the snippet (non-fatal)', async () => {
        const deps = {
            fetch: (async () => {
                throw new Error('unused');
            }) as unknown as typeof fetch,
            env: { FIRECRAWL_API_KEY: 'k' },
            now: () => NOW,
            scrape: (async () => jsonResponse(200, { success: false })) as FetchLike,
        };
        const doc = { id: computeId('https://w.example/w'), body: '# snippet w', sourceUri: 'https://w.example/w' };
        const { result: out, warns } = await captureLogWarns(async () => scrapeAndCacheDocs([doc], deps, OUT_FILE));
        expect(out[0]?.body).toBe('# snippet w');
        expect(warns[0]).toContain('Firecrawl malformed scrape response');
    });
});

describe('web-search realMarkitdown runner (ADR-013 D3)', () => {
    /** Write a one-shot stub markitdown into a fresh dir, prepend it to PATH; returns cleanup. */
    const withStub = async (script: string): Promise<() => Promise<void>> => {
        const dir = join(import.meta.dir, 'tmp-md-stub');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'markitdown'), script, { mode: 0o755 });
        const saved = process.env.PATH;
        process.env.PATH = `${dir}:${saved ?? ''}`;
        return async () => {
            process.env.PATH = saved;
            await rm(dir, { recursive: true, force: true });
        };
    };

    test('throws "markitdown is not on PATH" when Bun.which fails', async () => {
        const saved = process.env.PATH;
        process.env.PATH = '/nonexistent-path-for-kk-test';
        try {
            await expect(realMarkitdown('<p>x</p>')).rejects.toThrow('markitdown is not on PATH');
        } finally {
            process.env.PATH = saved;
        }
    });

    test('non-zero exit surfaces the exit code and trimmed stderr', async () => {
        const cleanup = await withStub('#!/bin/sh\ncat >/dev/null; echo "boom" >&2; exit 3\n');
        try {
            await expect(realMarkitdown('<p>x</p>')).rejects.toThrow('markitdown exited 3: boom');
        } finally {
            await cleanup();
        }
    });

    test('empty stdout (exit 0) is rejected as unusable output', async () => {
        const cleanup = await withStub('#!/bin/sh\ncat >/dev/null\n');
        try {
            await expect(realMarkitdown('<p>x</p>')).rejects.toThrow('markitdown produced empty output');
        } finally {
            await cleanup();
        }
    });
});
