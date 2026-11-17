import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext } from 'playwright';
import {
    applyRecordedEvent,
    attachTranscriptRecorder,
    type BotTranscript,
    defaultTranscriptPath,
    emptyTranscript,
    readTranscript,
    recordBotSession,
    redactJson,
    redactUrl,
    writeTranscript,
} from '../src/bot-record';

function human(testid: string, text = ''): { nodes: unknown[]; targetIndex: number } {
    return {
        nodes: [{ tag: 'button', testid, text, visible: true, path: `main > button[data-testid="${testid}"]` }],
        targetIndex: 0,
    };
}

function transcript(): BotTranscript {
    return emptyTranscript({ bot: 'x', startUrl: 'https://x.com/home', redacted: true });
}

describe('applyRecordedEvent', () => {
    test('a click on a visible tested node becomes a ranked click step', () => {
        const t = transcript();
        const step = applyRecordedEvent(t, {
            kind: 'click',
            url: 'https://x.com/home?ref=side',
            t: 1,
            snapshot: human('SideNav_NewTweet_Button', 'Post') as never,
            text: 'Post',
        });

        expect(step).toEqual({
            i: 0,
            t: 1,
            kind: 'click',
            url: 'https://x.com/home',
            target: { selector: '[data-testid="SideNav_NewTweet_Button"]', rank: 'testid' },
            text: 'Post',
        });
        expect(t.steps).toHaveLength(1);
    });

    test('the recorded URL drops its query, which can carry a grant', () => {
        const t = transcript();
        const step = applyRecordedEvent(t, {
            kind: 'navigate',
            url: 'https://x.com/i/flow/login?redirect_after_login=%2Fhome#frag',
            t: 2,
        });

        expect(step).toMatchObject({ kind: 'navigate', url: 'https://x.com/i/flow/login' });
    });

    test('a click on an invisible target is dropped, so no step is recorded', () => {
        const t = transcript();
        const step = applyRecordedEvent(t, {
            kind: 'click',
            url: 'https://x.com/home',
            t: 3,
            snapshot: {
                nodes: [{ tag: 'div', role: 'button', text: 'New thread', visible: false, path: 'main > div' }],
                targetIndex: 0,
            } as never,
        });

        expect(step).toBeNull();
        expect(t.steps).toHaveLength(0);
    });

    test('typed text is redacted to a length marker by default', () => {
        const t = transcript();
        const step = applyRecordedEvent(t, {
            kind: 'type',
            url: 'https://x.com/compose/post',
            t: 4,
            snapshot: human('tweetTextarea_0') as never,
            text: 'Hello X',
        });

        expect(step).toMatchObject({ kind: 'type', text: { redacted: true, length: 7 } });
        expect(JSON.stringify(t)).not.toContain('Hello X');
    });

    test('typed text is kept verbatim only when the operator opts in', () => {
        const t = emptyTranscript({ bot: 'x', startUrl: 'https://x.com', redacted: false });
        const step = applyRecordedEvent(
            t,
            { kind: 'type', url: 'https://x.com', t: 5, snapshot: human('edit') as never, text: 'Hello X' },
            { includeText: true },
        );

        expect(step).toMatchObject({ kind: 'type', text: 'Hello X' });
    });

    test('consecutive keystrokes on one target coalesce into a single type step', () => {
        const t = transcript();
        for (const chunk of ['Hel', 'lo']) {
            applyRecordedEvent(t, {
                kind: 'type',
                url: 'https://x.com/compose/post',
                t: 6,
                snapshot: human('tweetTextarea_0') as never,
                text: chunk,
            });
        }

        expect(t.steps).toHaveLength(1);
        expect(t.steps[0]).toMatchObject({ kind: 'type', text: { redacted: true, length: 5 } });
    });

    test('a non-printable key breaks the type run', () => {
        const t = transcript();
        applyRecordedEvent(t, {
            kind: 'type',
            url: 'https://x.com',
            t: 7,
            snapshot: human('edit') as never,
            text: 'A',
        });
        applyRecordedEvent(t, {
            kind: 'key',
            url: 'https://x.com',
            t: 8,
            snapshot: human('edit') as never,
            key: 'Enter',
        });
        applyRecordedEvent(t, {
            kind: 'type',
            url: 'https://x.com',
            t: 9,
            snapshot: human('edit') as never,
            text: 'B',
        });

        expect(t.steps.map((step) => step.kind)).toEqual(['type', 'key', 'type']);
    });

    test('a file choice records the basename only', () => {
        const t = transcript();
        const step = applyRecordedEvent(t, {
            kind: 'file',
            url: 'https://x.com/compose/post',
            t: 10,
            snapshot: human('fileInput') as never,
            fileName: '/Users/robin/Pictures/secret-path/cover.png',
        });

        expect(step).toMatchObject({ kind: 'file', fileName: 'cover.png' });
        expect(JSON.stringify(t)).not.toContain('secret-path');
    });

    test('an ambiguous target is recorded as ambiguous, never narrowed', () => {
        const t = transcript();
        applyRecordedEvent(t, {
            kind: 'click',
            url: 'https://x.com/home',
            t: 11,
            snapshot: {
                nodes: [
                    { tag: 'button', testid: 'post', visible: true, path: 'main > button:nth-of-type(1)' },
                    { tag: 'button', testid: 'post', visible: true, path: 'main > button:nth-of-type(2)' },
                ],
                targetIndex: 1,
            } as never,
        });

        expect(t.steps[0]).toMatchObject({
            target: { ambiguous: true, candidates: ['main > button:nth-of-type(1)', 'main > button:nth-of-type(2)'] },
        });
    });

    test('step indexes stay contiguous', () => {
        const t = transcript();
        applyRecordedEvent(t, { kind: 'navigate', url: 'https://x.com/a', t: 12 });
        applyRecordedEvent(t, { kind: 'click', url: 'https://x.com/a', t: 13, snapshot: human('go') as never });

        expect(t.steps.map((step) => step.i)).toEqual([0, 1]);
    });
});

describe('redactJson', () => {
    test('secret-shaped keys are replaced at any depth, values beside them survive', () => {
        const redacted = redactJson({
            data: { id: 'p-123', authToken: 'abc', nested: [{ cookie: 'c', session_id: 's', keep: 1 }] },
            password: 'pw',
        });

        expect(redacted).toEqual({
            data: {
                id: 'p-123',
                authToken: '<redacted>',
                nested: [{ cookie: '<redacted>', session_id: '<redacted>', keep: 1 }],
            },
            password: '<redacted>',
        });
    });
});

describe('transcript IO', () => {
    test('a written transcript is mode 0600 and reads back unchanged', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-record-'));
        try {
            const path = join(dir, 'x.json');
            const written = transcript();
            applyRecordedEvent(written, { kind: 'navigate', url: 'https://x.com/home', t: 14 });
            await writeTranscript(path, written);

            expect(statSync(path).mode & 0o777).toBe(0o600);
            expect(await readTranscript(path)).toEqual(written);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an unredacted transcript is refused unless the operator allows it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-record-'));
        try {
            const path = join(dir, 'raw.json');
            writeFileSync(path, JSON.stringify({ ...transcript(), redacted: false, steps: [] }), { mode: 0o600 });

            await expect(readTranscript(path)).rejects.toThrow(/unredacted/);
            expect((await readTranscript(path, { allowUnredacted: true })).redacted).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a version other than 1 is refused rather than guessed', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-record-'));
        try {
            const path = join(dir, 'v2.json');
            writeFileSync(path, JSON.stringify({ ...transcript(), schemaVersion: 2 }), { mode: 0o600 });

            await expect(readTranscript(path)).rejects.toThrow(/schema/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('attachTranscriptRecorder', () => {
    /** Response capture is async (the body is read off the wire), so let the handler settle. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    test('a mutating JSON response becomes a redacted response step', async () => {
        const t = transcript();
        type ResponseHandler = (response: unknown) => void;
        const handlers: ResponseHandler[] = [];
        const context = {
            on: (event: string, handler: ResponseHandler) => {
                if (event === 'response') handlers.push(handler);
            },
        } as unknown as BrowserContext;

        attachTranscriptRecorder({ context, transcript: t, fileSystem: createNodeFileSystem() });
        handlers[0]?.({
            request: () => ({ method: () => 'POST' }),
            url: () => 'https://x.com/i/api/graphql/abc/CreateTweet?variables=%7B%7D',
            status: () => 200,
            headerValue: async () => 'application/json; charset=utf-8',
            json: async () => ({ data: { create_tweet: { rest_id: '1900' }, auth_token: 'leak' } }),
        });
        await settle();

        expect(t.steps.at(-1)).toMatchObject({
            kind: 'response',
            method: 'POST',
            url: 'https://x.com/i/api/graphql/abc/CreateTweet',
            status: 200,
            body: { data: { create_tweet: { rest_id: '1900' }, auth_token: '<redacted>' } },
        });
    });

    test('a non-mutating or non-JSON response is ignored', async () => {
        const t = transcript();
        type ResponseHandler = (response: unknown) => void;
        const handlers: ResponseHandler[] = [];
        const context = {
            on: (event: string, handler: ResponseHandler) => {
                if (event === 'response') handlers.push(handler);
            },
        } as unknown as BrowserContext;

        attachTranscriptRecorder({ context, transcript: t, fileSystem: createNodeFileSystem() });
        for (const [method, contentType] of [
            ['GET', 'application/json'],
            ['POST', 'text/html'],
        ]) {
            handlers[0]?.({
                request: () => ({ method: () => method }),
                url: () => 'https://x.com/home',
                status: () => 200,
                headerValue: async () => contentType,
                json: async () => ({ id: 'nope' }),
            });
        }
        await settle();

        expect(t.steps).toHaveLength(0);
    });
});

describe('recordBotSession', () => {
    /** Fake persistent context: the recorder only needs pages, bindings, init scripts and close. */
    function fakeBrowser() {
        const state = {
            closeHandler: undefined as (() => void) | undefined,
            binding: undefined as ((source: unknown, event: unknown) => unknown) | undefined,
            initScripts: 0,
            wentTo: [] as string[],
        };
        const page = {
            goto: async (url: string) => {
                state.wentTo.push(url);
                return null;
            },
            url: () => 'https://x.com/home',
        };
        const context = {
            pages: () => [page],
            exposeBinding: (name: string, fn: (source: unknown, event: unknown) => unknown) => {
                if (name === '__kkRecord') state.binding = fn;
                return Promise.resolve();
            },
            addInitScript: () => {
                state.initScripts += 1;
                return Promise.resolve();
            },
            on: () => {},
            once: (event: string, handler: () => void) => {
                if (event === 'close') state.closeHandler = handler;
            },
            close: async () => {
                state.closeHandler?.();
            },
        };
        return { state, context };
    }

    /** Let the recorder reach its `await closed` before the test drives it. */
    async function settle(): Promise<void> {
        for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function tempSession() {
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-session-'));
        const root = join(dir, 'profiles');
        mkdirSync(join(root, 'x'), { recursive: true });
        return { dir, root, leaseRoot: join(dir, 'leases') };
    }

    test('records the posted events, flushes on window close and releases the lease', async () => {
        const session = tempSession();
        try {
            const { state, context } = fakeBrowser();
            const launched: Array<{ profileDir: string; headless: boolean }> = [];
            const out = join(session.dir, 'x.json');

            const running = recordBotSession('x', {
                out,
                root: session.root,
                leaseRoot: session.leaseRoot,
                defaultUrl: 'https://x.com/home?token=1',
                launcher: {
                    launch: async (request: { profileDir: string; headless: boolean }) => {
                        launched.push(request);
                        return context as never;
                    },
                } as never,
            });
            await settle();

            expect(launched[0]?.headless).toBe(false);
            expect(state.initScripts).toBe(1);
            // Navigation uses the caller's URL as given; only the transcript drops the query.
            expect(state.wentTo).toEqual(['https://x.com/home?token=1']);

            const accepted = state.binding?.(null, {
                kind: 'click',
                url: 'https://x.com/home',
                t: 1,
                snapshot: human('SideNav_NewTweet_Button', 'Post'),
                text: 'Post',
            });
            expect(accepted).toBe(true);
            expect(
                state.binding?.(null, {
                    kind: 'click',
                    url: 'https://x.com/home',
                    t: 2,
                    snapshot: { nodes: [{ visible: false, path: 'main > div' }], targetIndex: 0 },
                }),
            ).toBe(false);
            await settle();
            await context.close();

            const result = await running;
            // navigate (saved page) + navigate (the goto) + the accepted click.
            expect(result).toMatchObject({ name: 'x', out, stepCount: 3, redacted: true });
            // The saved-page step drops the query, so no grant lands in the transcript.
            expect(result.startUrl).toBe('https://x.com/home');
            const written = await readTranscript(out);
            expect(written.startUrl).toBe('https://x.com/home');
            expect(written.steps.map((step) => step.kind)).toEqual(['navigate', 'navigate', 'click']);
        } finally {
            rmSync(session.dir, { recursive: true, force: true });
        }
    });

    test('refuses an unsafe bot name before any filesystem or browser effect', async () => {
        const session = tempSession();
        try {
            await expect(
                recordBotSession('../escape', { root: session.root, leaseRoot: session.leaseRoot }),
            ).rejects.toThrow(/does not match/);
        } finally {
            rmSync(session.dir, { recursive: true, force: true });
        }
    });

    test('refuses a bot whose profile carries no saved page', async () => {
        const session = tempSession();
        try {
            await expect(recordBotSession('x', { root: session.root, leaseRoot: session.leaseRoot })).rejects.toThrow(
                /no saved default page|no local profile/,
            );
        } finally {
            rmSync(session.dir, { recursive: true, force: true });
        }
    });

    test('keeps typed text verbatim when the operator opts in', async () => {
        const session = tempSession();
        try {
            const { state, context } = fakeBrowser();
            const out = join(session.dir, 'x.json');
            const running = recordBotSession('x', {
                out,
                includeText: true,
                root: session.root,
                leaseRoot: session.leaseRoot,
                defaultUrl: 'https://x.com/home',
                launcher: { launch: async () => context as never } as never,
            });
            await settle();
            state.binding?.(null, {
                kind: 'type',
                url: 'https://x.com/home',
                t: 3,
                snapshot: human('tweetTextarea_0'),
                text: 'Hello X',
            });
            await settle();
            await context.close();

            const result = await running;
            expect(result.redacted).toBe(false);
            expect((await readTranscript(out, { allowUnredacted: true })).steps.at(-1)).toMatchObject({
                kind: 'type',
                text: 'Hello X',
            });
        } finally {
            rmSync(session.dir, { recursive: true, force: true });
        }
    });
});

describe('redactUrl and the default path', () => {
    test('a URL keeps origin and pathname and loses query and fragment', () => {
        expect(redactUrl('https://x.com/compose/post?text=hi#top')).toBe('https://x.com/compose/post');
    });

    test('a non-URL string is trimmed at the first query or fragment rather than thrown', () => {
        expect(redactUrl('not-a-url?token=1')).toBe('not-a-url');
        expect(redactUrl('opaque#frag')).toBe('opaque');
    });

    test('the default transcript path is run-scoped and stamped', () => {
        // The stamp keeps date and hour, so transcripts sort chronologically by name.
        expect(defaultTranscriptPath('x', new Date('2026-11-17T05:06:07.089Z'))).toBe(
            '.spur/run/bot-record-x-2026-11-17T0506.json',
        );
    });
});

describe('response bodies that cannot be read', () => {
    test('a body that is not JSON is skipped instead of failing the recording', async () => {
        const t = transcript();
        type ResponseHandler = (response: unknown) => void;
        const handlers: ResponseHandler[] = [];
        const context = {
            on: (event: string, handler: ResponseHandler) => {
                if (event === 'response') handlers.push(handler);
            },
        } as unknown as BrowserContext;

        attachTranscriptRecorder({ context, transcript: t, fileSystem: createNodeFileSystem() });
        handlers[0]?.({
            request: () => ({ method: () => 'POST' }),
            url: () => 'https://x.com/i/api/1.1/media/upload.json',
            status: () => 200,
            headerValue: async () => 'application/json',
            json: async () => {
                throw new Error('body evicted');
            },
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The step is still recorded, without a body: the response happened, the body did not survive.
        expect(t.steps.at(-1)).toMatchObject({ kind: 'response', url: 'https://x.com/i/api/1.1/media/upload.json' });
        expect(t.steps.at(-1)).not.toHaveProperty('body');
    });
});

describe('recordBotSession in real headless Chromium (AC1, AC2)', () => {
    const PAGE = `<!doctype html><title>compose</title>
<button data-testid="compose">Compose</button>
<textarea aria-label="Post body"></textarea>
<input type="file" name="media">
<button data-testid="submit" onclick="fetch('/api/post',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})">Post</button>`;

    /** Loopback compose page whose submit answers with a cookie and a secret-shaped key beside the id. */
    function startPage() {
        return Bun.serve({
            port: 0,
            fetch(request) {
                const path = new URL(request.url).pathname;
                if (path === '/api/post') {
                    return new Response(JSON.stringify({ data: { id: 'p-1' }, auth_token: 'live-secret' }), {
                        headers: { 'content-type': 'application/json', 'set-cookie': 'sid=live-cookie; Path=/' },
                    });
                }
                return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
            },
        });
    }

    async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
        for (let i = 0; i < 200; i += 1) {
            if (await check()) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`timed out waiting for ${what}`);
    }

    test('AC1: clicks, typing, a file choice and the submit response land in order, redacted, 0600', async () => {
        const { chromium } = await import('playwright');
        const server = startPage();
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-live-'));
        const upload = join(dir, 'photo.png');
        writeFileSync(upload, 'png');
        const out = join(dir, 'fixture.json');
        let context: BrowserContext | undefined;
        try {
            const running = recordBotSession('fixture', {
                out,
                root: join(dir, 'profiles'),
                leaseRoot: join(dir, 'leases'),
                defaultUrl: server.url.href,
                launcher: {
                    launch: async ({ profileDir }: { profileDir: string }) => {
                        context = await chromium.launchPersistentContext(profileDir, { headless: true });
                        return context;
                    },
                } as never,
            });
            await until(() => context?.pages()[0]?.url() === server.url.href, 'the start page');
            const page = context?.pages()[0];
            if (page === undefined) throw new Error('no page');
            await page.waitForLoadState('load');

            await page.click('[data-testid=compose]');
            await page.click('textarea');
            await page.keyboard.type('hello');
            await page.keyboard.press('Enter');
            await page.setInputFiles('input[type=file]', upload);
            const submitted = page.waitForResponse('**/api/post');
            await page.click('[data-testid=submit]');
            await submitted;
            await until(async () => {
                const raw = await Bun.file(out)
                    .text()
                    .catch(() => '');
                return raw.includes('"kind": "response"') || raw.includes('"kind":"response"');
            }, 'the response step');
            await context?.close();
            const result = await running;

            const written = await readTranscript(out);
            const kinds = written.steps.map((step) => step.kind);
            expect(kinds).toEqual([
                'navigate',
                'navigate',
                'click',
                'click',
                'type',
                'key',
                'file',
                'click',
                'response',
            ]);
            expect(result.stepCount).toBe(kinds.length);
            expect(written.steps[4]).toMatchObject({ kind: 'type', text: { redacted: true, length: 5 } });
            expect(written.steps[6]).toMatchObject({ kind: 'file', fileName: 'photo.png' });
            expect(written.steps[8]).toMatchObject({ kind: 'response', method: 'POST', status: 200 });
            const raw = await Bun.file(out).text();
            expect(raw).not.toContain('hello');
            expect(raw).not.toContain('live-secret');
            expect(raw).not.toContain('live-cookie');
            expect(raw.toLowerCase()).not.toContain('set-cookie');
            expect(statSync(out).mode & 0o777).toBe(0o600);
        } finally {
            await context?.close().catch(() => {});
            await server.stop(true);
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);

    test('AC2: SIGINT exits 130 with the transcript flushed and no lease marker left behind', async () => {
        const { acquireProfileLease, resolveBotProfileDir } = await import('../src/browser');
        const server = startPage();
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-sigint-'));
        const root = join(dir, 'profiles');
        const leaseRoot = join(dir, 'leases');
        const out = join(dir, 'fixture.json');
        try {
            const child = Bun.spawn(
                ['bun', join(import.meta.dir, 'fixtures/bot-record-runner.ts'), root, leaseRoot, out, server.url.href],
                { stdout: 'pipe', stderr: 'pipe' },
            );
            // Two navigate steps on disk means the browser is up and the recorder sits in `await closed`.
            await until(async () => {
                const raw = await Bun.file(out)
                    .text()
                    .catch(() => '');
                return (raw.match(/"navigate"/g) ?? []).length >= 2;
            }, 'the recorder to start');
            child.kill('SIGINT');
            const code = await child.exited;

            expect(code).toBe(130);
            expect((await readTranscript(out)).steps.map((step) => step.kind)).toEqual(['navigate', 'navigate']);
            const lease = await acquireProfileLease(resolveBotProfileDir('fixture', { root }), { leaseRoot });
            await lease.release();
        } finally {
            await server.stop(true);
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});
