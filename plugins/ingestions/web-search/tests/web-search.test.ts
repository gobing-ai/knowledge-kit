import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocListSchema } from '@gobing-ai/kk-core';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { buildFixtureDocs, computeId, main, parseInput, searchFirecrawl } from '../src/index';

const NOW = new Date('2026-08-14T12:00:00.000Z');

/** Build a minimal fake Response for injected-fetch tests. */
function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
}

/** Wrap a fake fetch body as `typeof fetch` so it can be assigned to `globalThis.fetch`. */
function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): typeof fetch {
    return impl as unknown as typeof fetch;
}

const TMP_DIR = join(import.meta.dir, 'tmp');
const IN_FILE = join(TMP_DIR, 'in.json');
const OUT_FILE = join(TMP_DIR, 'docs.json');

async function writeInput(topic: string, extra: Record<string, unknown> = {}): Promise<void> {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(IN_FILE, JSON.stringify({ topic, ...extra }), 'utf-8');
}

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_CONSOLE_ERROR = console.error;

afterEach(async () => {
    process.argv = ORIGINAL_ARGV;
    console.error = ORIGINAL_CONSOLE_ERROR;
    await rm(TMP_DIR, { recursive: true, force: true });
});

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
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () =>
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
        try {
            await writeInput('STORM topic research', {}); // fixture absent → live path
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(0);
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
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('R2: live run without FIRECRAWL_API_KEY exits 1 with exact stderr and no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(200, { success: true, data: { web: [] } }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            delete process.env.FIRECRAWL_API_KEY;
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors).toEqual(['web-search failed: FIRECRAWL_API_KEY is unset']);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('live HTTP 401 exits 1 with status + error and no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(401, { success: false, error: 'Unauthorized' }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors).toHaveLength(1);
            expect(errors[0]).toBe('web-search failed: Firecrawl HTTP 401: Unauthorized');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('live transport error (fetch throws) exits 1 with network message and no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => {
            throw new Error('ECONNREFUSED');
        });
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors[0]).toBe('web-search failed: Firecrawl network error: ECONNREFUSED');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('live 200 with success:false exits 1 with status + error and no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(200, { success: false, error: 'Something went wrong' }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors[0]).toBe('web-search failed: Firecrawl HTTP 200: Something went wrong');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('live HTTP 429 exits 1 with status + error (no silent retry)', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(429, { success: false, error: 'Rate limit exceeded' }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors[0]).toBe('web-search failed: Firecrawl HTTP 429: Rate limit exceeded');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('zero web hits writes [] and exits 0', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(200, { success: true, data: { web: [] } }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(0);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            expect(JSON.parse(await readFile(OUT_FILE, 'utf-8'))).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('partial skip: one good + one empty markdown returns the good Doc and warns', async () => {
        const warns: string[] = [];
        console.warn = (msg?: unknown) => warns.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () =>
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
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(0);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
            expect(docs).toHaveLength(1);
            expect(docs[0]?.sourceUri).toBe('https://a.example/a');
            expect(warns.length).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('all empty markdown (hits but no usable bodies) exits 1 with no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () =>
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
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors[0]).toBe('web-search failed: Firecrawl returned hits but no usable markdown bodies');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('malformed 200 (success:true with data missing) exits 1 with no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => jsonResponse(200, { success: true }));
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            const saved = process.env.FIRECRAWL_API_KEY;
            process.env.FIRECRAWL_API_KEY = 'test-key';
            try {
                expect(await main()).toBe(1);
            } finally {
                if (saved === undefined) delete process.env.FIRECRAWL_API_KEY;
                else process.env.FIRECRAWL_API_KEY = saved;
            }
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors[0]).toBe('web-search failed: Firecrawl malformed response: data missing');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('R3: computeId is stable and exported as a 16-char hex string', () => {
        const uri = 'https://example.org/research/stable';
        expect(computeId(uri)).toMatch(/^[0-9a-f]{16}$/);
        expect(computeId(uri)).toBe(computeId(uri));
        expect(computeId(uri)).not.toBe(computeId(`${uri}/other`));
    });

    test('missing topic exits 1 and writes no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        await writeInput('   ');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        await rm(OUT_FILE, { force: true });
        expect(await main()).toBe(1);
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(errors).toEqual(['web-search failed: --in "topic" is required and must be a non-empty string']);
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
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        process.argv = ['bun', 'test'];
        expect(await main()).toBe(1);
        expect(errors).toEqual(['Error: Missing required arguments --in and --out']);
    });

    test('write failure exits 1 with a message', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        await writeInput('STORM topic research', { fixture: true });
        await writeFile(join(TMP_DIR, 'blocker'), 'file, not a dir', 'utf-8');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', join(TMP_DIR, 'blocker', 'docs.json')];
        expect(await main()).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('web-search failed:');
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
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mockFetch(async () => fetchImpl());
        try {
            await writeInput('STORM topic research', {});
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            await withKey(async () => {
                expect(await main()).toBe(1);
            });
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
            expect(errors).toHaveLength(1);
            return errors[0] as string;
        } finally {
            globalThis.fetch = originalFetch;
        }
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
