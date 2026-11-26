import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    processPublishIO,
    resolveOperation,
    THREADS_API_BASE,
    THREADS_OPERATIONS,
    ThreadsPostApiTransport,
    ThreadsPostBrowserTransport,
} from '../src/index';

const TOKEN = 'THREADS-TOKEN-value-9';
const USER = '17841400000000000';
const TMP_DIR = join(process.cwd(), '.works/tmp/test-threads-pub');

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const originals = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        originals.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return fn().finally(() => {
        for (const [key, value] of originals) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

const credentials = { THREADS_ACCESS_TOKEN: TOKEN, THREADS_USER_ID: USER };
const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };

interface FetchCall {
    url: string;
    method: string;
    body: string;
    signal: unknown;
}

/**
 * The live `globalThis.fetch` stub. Bun runs every test file in one process, so a leaked spy makes
 * an unrelated suite's fetch throw (observed: surfdash-pub's 2 s `awaitArticleLive` budget expiring
 * with 2012 ms spent on retries); `afterEach` restores it.
 */
let activeFetchSpy: { mockRestore: () => void } | undefined;

/** Records every fetch call and replays the queued responses in order. */
function stubFetch(responses: Array<Response | Error>): FetchCall[] {
    const calls: FetchCall[] = [];
    activeFetchSpy?.mockRestore();
    activeFetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
        const next = responses.shift();
        calls.push({
            url: String(input),
            method: String(init?.method),
            body: String(init?.body ?? ''),
            signal: init?.signal,
        });
        if (next instanceof Error) throw next;
        if (next === undefined) throw new Error('unexpected fetch call');
        return next;
    }) as unknown as typeof fetch);
    return calls;
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const CONTAINER_URL = `${THREADS_API_BASE}/${USER}/threads`;
const PUBLISH_URL = `${THREADS_API_BASE}/${USER}/threads_publish`;

/** The published-media happy path: container 200, publish 200, permalink 200. */
function happyResponses(permalink = 'https://www.threads.net/@someone/post/Cxyz'): Array<Response | Error> {
    return [
        jsonResponse({ id: '17900000000000001' }),
        jsonResponse({ id: '18000000000000002' }),
        jsonResponse({ permalink }),
    ];
}

const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(() => {
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
});

afterEach(() => {
    activeFetchSpy?.mockRestore();
    activeFetchSpy = undefined;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
});

describe('threads-pub credentials and text refusals (R3)', () => {
    test('a missing THREADS_ACCESS_TOKEN is named and no request is made', async () => {
        const calls = stubFetch([]);
        await withEnv({ ...credentials, THREADS_ACCESS_TOKEN: undefined }, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('THREADS_ACCESS_TOKEN');
            expect(result.error).toContain('does not fall back to a browser');
        });
        expect(calls).toHaveLength(0);
    });

    test('a missing THREADS_USER_ID is named and no request is made', async () => {
        const calls = stubFetch([]);
        await withEnv({ ...credentials, THREADS_USER_ID: undefined }, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('THREADS_USER_ID');
        });
        expect(calls).toHaveLength(0);
    });

    test('a blank (whitespace) credential counts as missing', async () => {
        const calls = stubFetch([]);
        await withEnv({ ...credentials, THREADS_ACCESS_TOKEN: '   ' }, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('THREADS_ACCESS_TOKEN');
        });
        expect(calls).toHaveLength(0);
    });

    test('an empty body and title is refused before any request', async () => {
        const calls = stubFetch([]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { body: '   ', title: '  ', format: 'markdown' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('Content.body or Content.title');
        });
        expect(calls).toHaveLength(0);
    });

    test('501 code points is refused without truncation, 500 is accepted', async () => {
        const refused = stubFetch([]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { body: 'あ'.repeat(501), format: 'markdown' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('501');
            expect(result.error).toContain('500');
        });
        expect(refused).toHaveLength(0);

        const accepted = stubFetch(happyResponses());
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { body: 'あ'.repeat(500), format: 'markdown' },
            });
            expect(result.ok).toBe(true);
            expect(accepted[0]?.body).toContain(encodeURIComponent('あ'.repeat(500)));
        });
    });

    test('the title is the text when the body is blank', async () => {
        const calls = stubFetch(happyResponses());
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { body: '  ', title: 'Only a title', format: 'markdown' },
            });
            expect(result.ok).toBe(true);
        });
        expect(new URLSearchParams(String(calls[0]?.body)).get('text')).toBe('Only a title');
    });
});

describe('threads-pub happy path (R2)', () => {
    test('creates a TEXT container then publishes it with the returned creation_id', async () => {
        const calls = stubFetch(happyResponses());
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { ...content, body: 'Hello Threads' },
            });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('threads');
            expect(result.id).toBe('18000000000000002');
            expect(result.url).toBe('https://www.threads.net/@someone/post/Cxyz');
            expect(result.metadata).toEqual({ operation: 'post' });
            expect(ResultSchema.parse(result).ok).toBe(true);
        });
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
            `POST ${CONTAINER_URL}`,
            `POST ${PUBLISH_URL}`,
            `GET ${THREADS_API_BASE}/18000000000000002?fields=permalink&access_token=${TOKEN}`,
        ]);
        const containerBody = new URLSearchParams(calls[0]?.body);
        expect(containerBody.get('media_type')).toBe('TEXT');
        expect(containerBody.get('text')).toBe('Hello Threads');
        expect(containerBody.get('access_token')).toBe(TOKEN);
        // No URL in the copy → no card to request: the parameter must be absent, not empty.
        expect(containerBody.get('link_attachment')).toBeNull();
    });

    test('a URL in the body rides the container as an explicit link_attachment', async () => {
        const calls = stubFetch(happyResponses());
        const url = 'https://podcast.salty.vip/i/daily-ai-2026-11-25/';
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { ...content, body: `🎧 完整节目：${url}。` },
            });
            expect(result.ok).toBe(true);
        });
        // Meta's opt-in card parameter; the trailing full-width period is not part of the link.
        expect(new URLSearchParams(calls[0]?.body).get('link_attachment')).toBe(url);
        const publishBody = new URLSearchParams(calls[1]?.body);
        expect(publishBody.get('creation_id')).toBe('17900000000000001');
        expect(publishBody.get('access_token')).toBe(TOKEN);
    });

    test('every request carries an abort timeout signal', async () => {
        const calls = stubFetch(happyResponses());
        await withEnv(credentials, async () => {
            await new ThreadsPostApiTransport().publish({ content });
        });
        expect(calls).toHaveLength(3);
        for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
    });

    test('a failed permalink lookup still reports success without a url', async () => {
        const calls = stubFetch([
            jsonResponse({ id: '17900000000000001' }),
            jsonResponse({ id: '18000000000000002' }),
            jsonResponse({ error: { message: 'boom' } }, 500),
        ]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(true);
            expect(result.id).toBe('18000000000000002');
            expect(result.url).toBeUndefined();
        });
        expect(calls).toHaveLength(3);
    });

    test('a permalink that is not an https Threads URL is omitted', async () => {
        await withEnv(credentials, async () => {
            stubFetch(happyResponses('http://evil.example.com/post/1'));
            expect((await new ThreadsPostApiTransport().publish({ content })).url).toBeUndefined();
            stubFetch(happyResponses('https://evil.example.com/post/1'));
            expect((await new ThreadsPostApiTransport().publish({ content })).url).toBeUndefined();
            stubFetch(happyResponses(`https://www.threads.net/post/1?access_token=${TOKEN}`));
            expect((await new ThreadsPostApiTransport().publish({ content })).url).toBeUndefined();
        });
    });
});

describe('threads-pub failure reporting (R4)', () => {
    test('a container 4xx names the step and the HTTP status', async () => {
        stubFetch([jsonResponse({ error: { message: 'Invalid parameter' } }, 400)]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('threads container');
            expect(result.error).toContain('HTTP 400');
            expect(result.error).toContain('Invalid parameter');
        });
    });

    test('a publish failure names the step and the created container id', async () => {
        stubFetch([jsonResponse({ id: '17900000000000001' }), jsonResponse({ error: { message: 'not ready' } }, 500)]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('threads_publish');
            expect(result.error).toContain('HTTP 500');
            expect(result.error).toContain('17900000000000001');
        });
    });

    test('a non-JSON response names the step without echoing the body', async () => {
        stubFetch([new Response(`<html>token leak ${TOKEN}</html>`, { status: 200 })]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('threads container');
            expect(result.error).toContain('JSON');
            expect(result.error).not.toContain('<html>');
        });
    });

    test('a missing, non-string or non-decimal id is refused', async () => {
        for (const payload of [{}, { id: 42 }, { id: '' }, { id: 'abc-1' }]) {
            stubFetch([jsonResponse(payload)]);
            await withEnv(credentials, async () => {
                const result = await new ThreadsPostApiTransport().publish({ content });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('threads container');
            });
        }
    });

    test('a timeout states that no HTTP response was received', async () => {
        const timeout = new Error('The operation timed out');
        timeout.name = 'TimeoutError';
        stubFetch([timeout]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('threads container');
            expect(result.error).toContain('no HTTP response was received');
            expect(result.error).toContain('120000');
        });
    });

    test('the token never appears in an error, raw or percent-encoded', async () => {
        const rawToken = 'tok+en/with=chars';
        const encoded = encodeURIComponent(rawToken);
        stubFetch([jsonResponse({ error: { message: `bad ${rawToken} and ${encoded}` } }, 401)]);
        await withEnv({ ...credentials, THREADS_ACCESS_TOKEN: rawToken }, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).not.toContain(rawToken);
            expect(result.error).not.toContain(encoded);
            expect(result.error).toContain('***');
        });
    });
});

describe('threads-pub operation, driver and media refusals (R5, R11)', () => {
    test('only the post operation is declared', () => {
        expect([...THREADS_OPERATIONS]).toEqual(['post']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'post' });
        expect(resolveOperation({ operation: undefined }, content)).toEqual({ operation: 'post' });
        expect(resolveOperation({ operation: 'post' }, content)).toEqual({ operation: 'post' });
        expect(resolveOperation(undefined, { ...content, metadata: { operation: 'post' } })).toEqual({
            operation: 'post',
        });
    });

    test('an unknown operation is refused by name with the supported set', () => {
        const mode = resolveOperation({ operation: 'thread' });
        expect(mode.error).toContain("unsupported operation 'thread'");
        expect(mode.error).toContain('post');
        expect(resolveOperation(undefined, { ...content, metadata: { operation: 'dm' } })?.error).toContain('dm');
    });

    test('any driver option is refused before any request', async () => {
        const calls = stubFetch([]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({ content, options: { driver: 'script' } });
            expect(result.ok).toBe(false);
            expect(result.error).toContain("unsupported driver option 'script'");
            expect(result.error).toContain('text only');
        });
        expect(calls).toHaveLength(0);
    });

    test('images options are refused before any request', async () => {
        const calls = stubFetch([]);
        await withEnv(credentials, async () => {
            const byUser = await new ThreadsPostApiTransport().publish({
                content,
                options: { images: ['/tmp/a.png'] },
            });
            expect(byUser.ok).toBe(false);
            expect(byUser.error).toContain('unsupported images option');
            expect(byUser.error).toContain('text only');
        });
        const metadataCalls = stubFetch([]);
        await withEnv(credentials, async () => {
            const byMetadata = await new ThreadsPostApiTransport().publish({
                content: { ...content, metadata: { images: ['https://example.com/b.png'] } },
            });
            expect(byMetadata.ok).toBe(false);
            expect(byMetadata.error).toContain('unsupported images option');
        });
        expect(calls).toHaveLength(0);
        expect(metadataCalls).toHaveLength(0);
    });

    test('processPublishIO refuses an unknown operation before resolving a fake transport', async () => {
        const fake = new FakeFileCliTransport();
        const publish = spyOn(fake, 'publish');
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'op-in.json');
        const outPath = join(TMP_DIR, 'op-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'T', body: 'B', format: 'markdown', options: { operation: 'dm' } }),
        );
        try {
            await expect(processPublishIO(inPath, outPath, fake)).rejects.toThrow(/unsupported operation 'dm'/);
            expect(publish).not.toHaveBeenCalled();
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(false);
            expect(written.error).toContain("unsupported operation 'dm'");
        } finally {
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });

    test('fake mode does not bypass the driver and media refusals', async () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'fake-in.json');
        const outPath = join(TMP_DIR, 'fake-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'T', body: 'B', format: 'markdown', options: { images: ['/tmp/x.png'] } }),
        );
        try {
            await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/unsupported images option/);
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(false);
        } finally {
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });
});

describe('threads-pub fake transport and IO (R6)', () => {
    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects FakeFileCliTransport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
        // 2026-11-16 operator decision: the default is the `kk bot` web composer; the official Graph
        // API stays reachable through THREADS_POST_TRANSPORT=api.
        expect(getPublishTransport()).toBeInstanceOf(ThreadsPostBrowserTransport);
        process.env.THREADS_POST_TRANSPORT = 'api';
        try {
            expect(getPublishTransport()).toBeInstanceOf(ThreadsPostApiTransport);
        } finally {
            delete process.env.THREADS_POST_TRANSPORT;
        }
    });

    test('processPublishIO posts offline on the fake transport and writes a schema-valid Result', async () => {
        const fake = new FakeFileCliTransport();
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(true);
            expect(written.target).toBe('fake-file-cli');
        } finally {
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });

    test('processPublishIO reports malformed input without throwing a stack into the Result', async () => {
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'bad-in.json');
        const outPath = join(TMP_DIR, 'bad-out.json');
        await writeFile(inPath, JSON.stringify({ title: 42 }));
        try {
            await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/Invalid Content input/);
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(false);
            expect(written.error?.split('\n')).toHaveLength(1);
        } finally {
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });

    test('main returns 1 without args and 0 on the fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'main-in.json');
        const outPath = join(TMP_DIR, 'main-out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        await mkdir(TMP_DIR, { recursive: true });
        const inPath = join(TMP_DIR, 'invoke-in.json');
        const outPath = join(TMP_DIR, 'invoke-out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'threads-pub',
                    inPath,
                    outPath,
                    pluginsRoot: join(process.cwd(), 'plugins'),
                }),
            ).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(TMP_DIR, { recursive: true, force: true });
        }
    });
});

describe('task 0330 R2 — threads post refuses draft requests before credentials or HTTP', () => {
    test('an explicit draft publishStatus is refused before credential lookup and no request is made', async () => {
        const calls = stubFetch([]);
        await withEnv({ ...credentials, THREADS_ACCESS_TOKEN: undefined, THREADS_USER_ID: undefined }, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { ...content, metadata: { ...content.metadata, publishStatus: 'draft' } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('draft');
            expect(result.error).not.toContain('THREADS_ACCESS_TOKEN');
        });
        expect(calls).toHaveLength(0);
    });

    test('an unknown publishStatus fails closed before credential lookup', async () => {
        const calls = stubFetch([]);
        await withEnv(credentials, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { ...content, metadata: { ...content.metadata, publishStatus: 'queue' } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('unknown publishStatus');
        });
        expect(calls).toHaveLength(0);
    });

    test('publishStatus public proceeds to the credential check like the legacy absent mode', async () => {
        const calls = stubFetch([]);
        await withEnv({ ...credentials, THREADS_ACCESS_TOKEN: undefined }, async () => {
            const result = await new ThreadsPostApiTransport().publish({
                content: { ...content, metadata: { ...content.metadata, publishStatus: 'public' } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('THREADS_ACCESS_TOKEN');
        });
        expect(calls).toHaveLength(0);
    });
});
