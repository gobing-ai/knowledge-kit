import { describe, expect, test } from 'bun:test';
import {
    ANALYZE_PATH,
    createInstanceClient,
    GENERATE_PATH,
    InstanceError,
    LIBRARY_PATH,
    STATUS_PATH,
} from '../src/adapter/instance';
import { renderGenerateRequest } from '../src/request';
import { loadGoldenJob } from './goldens';
import {
    audioResponse,
    hangingBody,
    jsonResponse,
    libraryTake,
    mp3Bytes,
    networkFailure,
    neverResponds,
    steppingClock,
    stubFetch,
} from './stub-instance';

/**
 * AC2 / AC3 / AC5 (R2, R3, R7) — the paid-call policy and cache-first analyse,
 * all against an injected fetch stub. No socket, no paid call, no global mutated.
 */

const REQUEST = renderGenerateRequest(loadGoldenJob('clip'));

/** A client wired to `stub.fetch` with deadlines small enough to keep the suite fast. */
function makeClient(fetchImpl: ReturnType<typeof stubFetch>['fetch'], clock = steppingClock()) {
    return createInstanceClient({
        baseUrl: 'http://instance.test',
        timeoutMs: 60,
        connectTimeoutMs: 25,
        fetch: fetchImpl,
        connectAttempts: 3,
        retryDelayMs: 1,
        sleep: async () => {},
        now: clock.now,
    });
}

/** The manifest the stub answers a successful generate with. */
function successManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'gen_1',
        audioUrl: '/files/gen_1.mp3',
        prompt: REQUEST.prompt,
        model: 'clip',
        generatedAt: new Date(1_700_000_100_000).toISOString(),
        language: 'EN',
        batchCount: 1,
        ...overrides,
    };
}

describe('AC2 — one take round-trips through the adapter', () => {
    test('exactly one POST is sent with the kk prompt and request fields, and the format comes from the bytes', async () => {
        const bytes = mp3Bytes();
        const stub = stubFetch((call) => {
            if (call.method === 'POST' && call.url.endsWith(GENERATE_PATH)) {
                return jsonResponse(successManifest());
            }
            if (call.method === 'GET' && call.url.endsWith('/files/gen_1.mp3')) {
                return audioResponse(bytes);
            }
            return jsonResponse({ error: `unexpected ${call.method} ${call.url}` }, 500);
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);

        const posts = stub.calls.filter((call) => call.method === 'POST');
        expect(posts).toHaveLength(1);
        const post = posts[0];
        if (post === undefined) {
            throw new Error('no POST reached the stub');
        }
        const body = post.body as Record<string, unknown>;
        expect(body).toEqual(REQUEST as unknown as Record<string, unknown>);
        expect(body.prompt).toBe(REQUEST.prompt);
        expect(body.model).toBe('clip');
        expect(body.language).toBe('EN');
        expect('durationTarget' in body).toBe(false);

        expect(take.id).toBe('gen_1');
        expect(take.format).toBe('mp3');
        expect(Array.from(take.bytes)).toEqual(Array.from(bytes));
        expect(take.adoptedByReconciliation).toBe(false);
        expect(take.audioUrl).toBe('http://instance.test/files/gen_1.mp3');
    });

    test('the delivered bytes win over the manifest format claim', async () => {
        const wav = new Uint8Array(44);
        wav.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
        wav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
        const stub = stubFetch((call) =>
            call.method === 'POST'
                ? jsonResponse(successManifest({ format: 'mp3' }))
                : audioResponse(wav, 'audio/mpeg'),
        );
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.format).toBe('wav');
    });

    test('the streaming shape (audio body plus a generation-id header) is accepted', async () => {
        const stub = stubFetch(
            () =>
                new Response(mp3Bytes(), {
                    status: 200,
                    headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen_inline' },
                }),
        );
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
        expect(take.id).toBe('gen_inline');
        expect(take.format).toBe('mp3');
    });

    test('request echoes come from the manifest and stay absent when the manifest omits them', async () => {
        const stub = stubFetch((call) =>
            call.method === 'POST'
                ? jsonResponse({ id: 'gen_2', audioUrl: '/files/gen_2.mp3', prompt: REQUEST.prompt, model: 'clip' })
                : audioResponse(mp3Bytes()),
        );
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.language).toBeUndefined();
        expect(take.durationTarget).toBeUndefined();
        expect(take.batchCount).toBeUndefined();
    });
});

describe('AC3 — analysis is paid at most once per take', () => {
    test('a manifest that already carries analysis returns it with no paid POST', async () => {
        const stub = stubFetch(() =>
            jsonResponse({ generations: [libraryTake({ id: 'gen_1', analysis: { summary: 'cached' } })] }),
        );
        const result = await makeClient(stub.fetch).analyze('gen_1');
        expect(result.cached).toBe(true);
        expect(result.paid).toBe(false);
        expect(result.analysis).toEqual({ summary: 'cached' });
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
        expect(stub.calls.every((call) => call.url.endsWith(LIBRARY_PATH))).toBe(true);
    });

    test('a take without cached analysis gets exactly one paid POST', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'POST' && call.url.endsWith(ANALYZE_PATH)) {
                return jsonResponse({ analysis: { summary: 'fresh' } });
            }
            return jsonResponse({ generations: [libraryTake({ id: 'gen_1' })] });
        });
        const result = await makeClient(stub.fetch).analyze('gen_1');
        expect(result.cached).toBe(false);
        expect(result.paid).toBe(true);
        expect(result.analysis).toEqual({ summary: 'fresh' });
        const posts = stub.calls.filter((call) => call.method === 'POST');
        expect(posts).toHaveLength(1);
        expect(posts[0]?.body).toEqual({ id: 'gen_1' });
    });

    test('an ambiguous analyse adopts the cached analysis instead of paying twice', async () => {
        let libraryReads = 0;
        const stub = stubFetch((call) => {
            if (call.method === 'POST') {
                return hangingBody(call.init);
            }
            libraryReads += 1;
            // First read: no analysis. Second read (reconciliation): the instance cached it.
            return jsonResponse({
                generations: [
                    libraryTake({ id: 'gen_1', ...(libraryReads > 1 ? { analysis: { summary: 'reconciled' } } : {}) }),
                ],
            });
        });
        const result = await makeClient(stub.fetch).analyze('gen_1');
        expect(result.paid).toBe(true);
        expect(result.cached).toBe(true);
        expect(result.analysis).toEqual({ summary: 'reconciled' });
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('an ambiguous analyse with nothing cached fails naming the endpoint and --force', async () => {
        const stub = stubFetch((call) =>
            call.method === 'POST'
                ? hangingBody(call.init)
                : jsonResponse({ generations: [libraryTake({ id: 'gen_1' })] }),
        );
        const error = await makeClient(stub.fetch)
            .analyze('gen_1')
            .catch((err: unknown) => err);
        expect(error).toBeInstanceOf(InstanceError);
        const instanceError = error as InstanceError;
        expect(instanceError.kind).toBe('ambiguous');
        expect(instanceError.message).toContain(`POST ${ANALYZE_PATH}`);
        expect(instanceError.message).toContain('--force');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
});

describe('AC5 — a paid request is never re-sent on an ambiguous outcome', () => {
    const terminalCases: Array<{ status: number; text: string; remediation: string }> = [
        { status: 401, text: 'invalid provider key', remediation: 'provider key' },
        { status: 402, text: 'insufficient credits', remediation: 'credits' },
        { status: 403, text: 'key not authorized for this model', remediation: 'restricted' },
        { status: 404, text: 'unknown route', remediation: 'music.instance.url' },
        { status: 429, text: 'rate limit exceeded', remediation: 'rate limited' },
    ];

    for (const { status, text, remediation } of terminalCases) {
        test(`${status} is terminal: one request, the instance text and a remediation`, async () => {
            const stub = stubFetch(() => jsonResponse({ error: text }, status));
            const error = await makeClient(stub.fetch)
                .generate(REQUEST)
                .catch((err: unknown) => err);
            const instanceError = error as InstanceError;
            expect(instanceError).toBeInstanceOf(InstanceError);
            expect(instanceError.kind).toBe('terminal');
            expect(instanceError.status).toBe(status);
            expect(instanceError.instanceMessage).toBe(text);
            expect(instanceError.message).toContain(text);
            expect(instanceError.message.toLowerCase()).toContain(remediation.toLowerCase());
            const posts = stub.calls.filter((call) => call.method === 'POST');
            expect(posts).toHaveLength(1);
        });
    }

    test('a 502 whose body reports every key rejected is terminal, not ambiguous', async () => {
        const stub = stubFetch(() => jsonResponse({ error: 'all provider keys were rejected' }, 502));
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error.kind).toBe('terminal');
        expect(error.status).toBe(502);
        expect(error.message).toContain('all provider keys were rejected');
        expect(error.message).toContain('key list');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('a 502 with an unrelated body is ambiguous and reconciles instead of retrying', async () => {
        const stub = stubFetch((call) =>
            call.method === 'POST'
                ? jsonResponse({ error: 'upstream gateway hiccup' }, 502)
                : jsonResponse({ generations: [] }),
        );
        await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch(() => undefined);
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
        expect(stub.calls.filter((call) => call.url.endsWith(LIBRARY_PATH)).map((call) => call.url)).toEqual([
            'http://instance.test/api/generations',
        ]);
    });

    test('connection refused retries within the bounded attempt count, then succeeds', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'POST' && stub.calls.filter((entry) => entry.method === 'POST').length === 1) {
                return networkFailure('ECONNREFUSED') as never;
            }
            if (call.method === 'POST') {
                return jsonResponse(successManifest());
            }
            return audioResponse(mp3Bytes());
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.id).toBe('gen_1');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    });

    test('a permanently unreachable instance stops at the bound and reports nothing was billed', async () => {
        const stub = stubFetch(() => networkFailure('ECONNREFUSED') as never);
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error.kind).toBe('connect');
        expect(error.attempts).toBe(3);
        expect(error.message).toContain('nothing was billed');
        expect(stub.calls).toHaveLength(3);
        expect(stub.calls.every((call) => call.method === 'GET' && call.url.endsWith(STATUS_PATH))).toBe(true);
    });

    test('a connect-phase stall is retried, not treated as an ambiguous send', async () => {
        const stub = stubFetch((call) => neverResponds(call.init));
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error.kind).toBe('connect');
        expect(stub.calls).toHaveLength(3);
        expect(stub.calls.every((call) => call.method === 'GET' && call.url.endsWith(STATUS_PATH))).toBe(true);
    });

    test('0414: a healthy connection with POST headers arriving after connectTimeoutMs is dispatched once, never retried as connect', async () => {
        const bytes = mp3Bytes();
        const stub = stubFetch(async (call) => {
            if (call.method === 'GET' && call.url.endsWith(STATUS_PATH)) {
                return jsonResponse({ ok: true });
            }
            if (call.method === 'POST' && call.url.endsWith(GENERATE_PATH)) {
                await new Promise((resolve) => setTimeout(resolve, 40));
                return jsonResponse(successManifest());
            }
            return audioResponse(bytes);
        });
        const client = createInstanceClient({
            baseUrl: 'http://instance.test',
            timeoutMs: 120,
            connectTimeoutMs: 25,
            fetch: stub.fetch,
            connectAttempts: 3,
            retryDelayMs: 1,
            sleep: async () => {},
            now: steppingClock().now,
        });
        const take = await client.generate(REQUEST);
        expect(take.id).toBe('gen_1');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('0414: a slow POST returning a terminal error after connectTimeoutMs surfaces the instance outcome without retry', async () => {
        const stub = stubFetch(async (call) => {
            if (call.method === 'GET' && call.url.endsWith(STATUS_PATH)) {
                return jsonResponse({ ok: true });
            }
            await new Promise((resolve) => setTimeout(resolve, 40));
            return jsonResponse({ error: 'rate limit exceeded' }, 429);
        });
        const client = createInstanceClient({
            baseUrl: 'http://instance.test',
            timeoutMs: 120,
            connectTimeoutMs: 25,
            fetch: stub.fetch,
            connectAttempts: 3,
            retryDelayMs: 1,
            sleep: async () => {},
            now: steppingClock().now,
        });
        const error = (await client.generate(REQUEST).catch((err: unknown) => err)) as InstanceError;
        expect(error).toBeInstanceOf(InstanceError);
        expect(error.kind).toBe('terminal');
        expect(error.status).toBe(429);
        expect(error.message).not.toContain('nothing was billed');
        expect(error.message).toContain('rate limit exceeded');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('a post-send timeout reconciles, adopts the earliest match and records the extras as unclaimed', async () => {
        const earlier = libraryTake({ id: 'gen_early', generatedAt: new Date(1_700_000_050_000).toISOString() });
        const later = libraryTake({ id: 'gen_late', generatedAt: new Date(1_700_000_200_000).toISOString() });
        const foreign = libraryTake({ id: 'gen_foreign', prompt: 'a different brief entirely' });
        const stub = stubFetch((call) => {
            if (call.method === 'POST') {
                return hangingBody(call.init);
            }
            if (call.url.endsWith(LIBRARY_PATH)) {
                return jsonResponse({ generations: [later, foreign, earlier] });
            }
            return audioResponse(mp3Bytes());
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
        expect(stub.calls.filter((call) => call.method === 'GET').map((call) => call.url)).toContain(
            'http://instance.test/api/generations',
        );
        expect(take.id).toBe('gen_early');
        expect(take.adoptedByReconciliation).toBe(true);
        expect(take.unclaimed).toEqual([{ id: 'gen_late', generatedAt: later.generatedAt ?? '' }]);
    });

    test('a post-send timeout with no matching library take fails naming the endpoint, the elapsed time and --force', async () => {
        const stub = stubFetch((call) =>
            call.method === 'POST'
                ? hangingBody(call.init)
                : jsonResponse({ generations: [libraryTake({ id: 'other', prompt: 'x' })] }),
        );
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error).toBeInstanceOf(InstanceError);
        expect(error.kind).toBe('ambiguous');
        expect(error.message).toContain(`POST ${GENERATE_PATH}`);
        expect(error.message).toMatch(/\d+ ms/);
        expect(error.message).toContain('--force');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('a library take generated before the request started is not adopted', async () => {
        const stale = libraryTake({ id: 'gen_stale', generatedAt: new Date(1_600_000_000_000).toISOString() });
        const stub = stubFetch((call) =>
            call.method === 'POST' ? hangingBody(call.init) : jsonResponse({ generations: [stale] }),
        );
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error.kind).toBe('ambiguous');
        expect(error.message).toContain('--force');
    });

    test('a 200 with malformed JSON reconciles instead of re-sending', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'POST') {
                return new Response('this is not json', {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (call.url.endsWith(LIBRARY_PATH)) {
                return jsonResponse({ generations: [libraryTake({ id: 'gen_malformed' })] });
            }
            return audioResponse(mp3Bytes());
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.id).toBe('gen_malformed');
        expect(take.adoptedByReconciliation).toBe(true);
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('a socket reset after send reconciles and is never retried', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'POST') {
                return networkFailure('ECONNRESET') as never;
            }
            if (call.url.endsWith(LIBRARY_PATH)) {
                return jsonResponse({ generations: [libraryTake({ id: 'gen_reset' })] });
            }
            return audioResponse(mp3Bytes());
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.id).toBe('gen_reset');
        expect(take.adoptedByReconciliation).toBe(true);
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('a post-send 5xx reconciles and is never retried', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'POST') {
                return jsonResponse({ error: 'internal error' }, 500);
            }
            if (call.url.endsWith(LIBRARY_PATH)) {
                return jsonResponse({ generations: [libraryTake({ id: 'gen_5xx' })] });
            }
            return audioResponse(mp3Bytes());
        });
        const take = await makeClient(stub.fetch).generate(REQUEST);
        expect(take.id).toBe('gen_5xx');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    test('an unreachable library during reconciliation still sends only one generate', async () => {
        const stub = stubFetch((call) => {
            if (call.method === 'GET' && call.url.endsWith(STATUS_PATH)) {
                return jsonResponse({ ok: true });
            }
            if (call.method === 'POST') {
                return hangingBody(call.init);
            }
            return networkFailure('ECONNREFUSED') as never;
        });
        const error = (await makeClient(stub.fetch)
            .generate(REQUEST)
            .catch((err: unknown) => err)) as InstanceError;
        expect(error.kind).toBe('ambiguous');
        expect(error.message).toContain('--force');
        expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
});
