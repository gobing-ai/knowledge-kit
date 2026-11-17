import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type BotTranscript, emptyTranscript } from '../src/bot-record';
import { selectorFor } from '../src/bot-record-normalize';
import { replayBot, replayBotSession, submitStepIndex } from '../src/bot-replay';

/** Replay narrows every recorded selector to visible, reachable nodes; the fakes key on the recorded form. */
function recorded(selector: string): string {
    return selector.replace(/ >> visible=true( >> nth=\d+)?$/, '');
}

const testid = (value: string) => ({ selector: `[data-testid="${value}"]`, rank: 'testid' as const });

describe('replayBotSession', () => {
    /** Minimal page double: records what the rail did and refuses a selector it does not hold. */
    function fakePage(known: string[]) {
        const clicks: string[] = [];
        const typed: string[] = [];
        const visited: string[] = [];
        return {
            clicks,
            typed,
            visited,
            page: {
                url: () => 'about:blank',
                goto: async (url: string) => {
                    visited.push(url);
                    return null;
                },
                locator: (selector: string) => ({
                    first: () => ({ waitFor: async () => {} }),
                    evaluateAll: async () => (known.includes(recorded(selector)) ? [true] : []),
                }),
                click: async (selector: string) => {
                    clicks.push(recorded(selector));
                },
                keyboard: { type: async (text: string) => void typed.push(text) },
                setInputFiles: async () => {},
            },
        };
    }

    const transcript = (): BotTranscript => {
        const t = emptyTranscript({ bot: 'x', startUrl: 'https://x.com/home', redacted: true });
        t.steps = [
            { i: 0, t: 1, kind: 'navigate', url: 'https://x.com/home' },
            { i: 1, t: 2, kind: 'click', url: 'https://x.com/home', target: testid('compose'), text: 'Post' },
            {
                i: 2,
                t: 3,
                kind: 'type',
                url: 'https://x.com/compose',
                target: testid('editor'),
                text: { redacted: true, length: 5 },
            },
            { i: 3, t: 4, kind: 'click', url: 'https://x.com/compose', target: testid('submit'), text: 'Post' },
        ];
        return t;
    };

    test('stops before the submit step by default and records one ok row per executed step', async () => {
        const fake = fakePage(['[data-testid="compose"]', '[data-testid="editor"]']);

        const result = await replayBotSession('x', transcript(), { page: fake.page as never, submitText: 'Post' });

        expect(fake.clicks).toEqual(['[data-testid="compose"]', '[data-testid="editor"]']);
        expect(fake.typed).toEqual(['•••••']);
        expect(result.rows.map((row) => row.ok)).toEqual([true, true, true, false]);
        expect(result.rows.at(-1)).toMatchObject({ step: 3, ok: false, skipped: 'submit' });
        expect(result.stoppedBeforeSubmit).toBe(true);
    });

    test('--submit runs the submit click too', async () => {
        const fake = fakePage(['[data-testid="compose"]', '[data-testid="editor"]', '[data-testid="submit"]']);

        const result = await replayBotSession('x', transcript(), {
            page: fake.page as never,
            submitText: 'Post',
            submit: true,
        });

        expect(fake.clicks).toEqual(['[data-testid="compose"]', '[data-testid="editor"]', '[data-testid="submit"]']);
        expect(result.stoppedBeforeSubmit).toBe(false);
    });

    test('a step whose selector resolves to no node fails that step and stops the run', async () => {
        const fake = fakePage(['[data-testid="compose"]']);

        const result = await replayBotSession('x', transcript(), {
            page: fake.page as never,
            submitText: 'Post',
            stepTimeoutMs: 50,
        });

        const failed = result.rows.at(-1);
        expect(failed).toMatchObject({ step: 2, ok: false });
        expect(failed?.detail).toMatch(/0 visible, reachable nodes/);
        expect(fake.typed).toEqual([]);
    });

    test('a transcript that does not open with a navigate step starts from its startUrl', async () => {
        const midPage = transcript();
        midPage.steps = midPage.steps.slice(1);
        const fake = fakePage(['[data-testid="compose"]', '[data-testid="editor"]']);

        await replayBotSession('x', midPage, { page: fake.page as never, submitText: 'Post' });

        expect(fake.visited).toEqual(['https://x.com/home']);
    });

    test('a transcript that opens with a navigate step is not navigated twice', async () => {
        const fake = fakePage(['[data-testid="compose"]', '[data-testid="editor"]']);

        await replayBotSession('x', transcript(), { page: fake.page as never, submitText: 'Post' });

        expect(fake.visited).toEqual(['https://x.com/home']);
    });

    test('an ambiguous target fails the step instead of narrowing to one candidate', async () => {
        const ambiguous: BotTranscript = emptyTranscript({ bot: 'x', startUrl: 'https://x.com', redacted: true });
        ambiguous.steps = [
            {
                i: 0,
                t: 1,
                kind: 'click',
                url: 'https://x.com/home',
                target: {
                    ambiguous: true,
                    candidates: ['main > button:nth-of-type(1)', 'main > button:nth-of-type(2)'],
                },
            },
        ];
        const fake = fakePage(['main > button:nth-of-type(1)']);

        const result = await replayBotSession('x', ambiguous, { page: fake.page as never, submit: true });

        expect(result.rows[0]).toMatchObject({ ok: false });
        expect(result.rows[0]?.detail).toMatch(/ambiguous/);
        expect(fake.clicks).toEqual([]);
    });

    test('a redacted type step replays as a placeholder of the recorded length', async () => {
        const fake = fakePage(['[data-testid="compose"]', '[data-testid="editor"]']);

        await replayBotSession('x', transcript(), { page: fake.page as never, submitText: 'Post' });

        expect(fake.typed[0]).toHaveLength(5);
        expect(fake.typed[0]).not.toBe('Hello');
    });
});

describe('submitStepIndex', () => {
    const transcript = (): BotTranscript => {
        const t = emptyTranscript({ bot: 'x', startUrl: 'https://x.com/home', redacted: true });
        t.steps = [
            { i: 0, t: 1, kind: 'navigate', url: 'https://x.com/home' },
            { i: 1, t: 2, kind: 'click', url: 'https://x.com/home', target: testid('compose'), text: 'Open' },
            { i: 2, t: 3, kind: 'click', url: 'https://x.com/compose', target: testid('submit'), text: 'Post' },
        ];
        return t;
    };

    test('named submit text wins over the last click', () => {
        expect(submitStepIndex(transcript(), 'Open')).toBe(1);
    });

    test('without a name the last click is the submit step', () => {
        expect(submitStepIndex(transcript())).toBe(2);
    });

    test('an unmatched name falls back to the last click instead of stopping nowhere', () => {
        expect(submitStepIndex(transcript(), 'NotAClick')).toBe(2);
    });

    test('a transcript with no click reports no submit step', () => {
        const t = emptyTranscript({ bot: 'x', startUrl: 'https://x.com', redacted: true });
        t.steps = [{ i: 0, t: 1, kind: 'navigate', url: 'https://x.com' }];

        expect(submitStepIndex(t)).toBe(-1);
    });
});

describe('replayBot', () => {
    /** Fake headed session: one context holding one page that records what the replay did. */
    function fakeSession(known: string[]) {
        const shots: string[] = [];
        const page = {
            goto: async () => null,
            locator: (selector: string) => ({
                first: () => ({ waitFor: async () => {} }),
                evaluateAll: async () => (known.includes(recorded(selector)) ? [true] : []),
            }),
            click: async () => {},
            keyboard: { press: async () => {}, type: async () => {} },
            setInputFiles: async () => {},
            screenshot: async ({ path }: { path: string }) => {
                shots.push(path);
                writeFileSync(path, 'png');
            },
        };
        const context = { pages: () => [page], once: () => {}, on: () => {}, close: async () => {} };
        return { shots, context, launcher: { launch: async () => context as never } };
    }

    const transcript = (): BotTranscript => {
        const t = emptyTranscript({ bot: 'x', startUrl: 'https://x.com/home', redacted: true });
        t.steps = [
            { i: 0, t: 1, kind: 'navigate', url: 'https://x.com/home' },
            { i: 1, t: 2, kind: 'click', url: 'https://x.com/home', target: testid('compose'), text: 'Post' },
            { i: 2, t: 3, kind: 'click', url: 'https://x.com/compose', target: testid('submit'), text: 'Post' },
        ];
        return t;
    };

    function tempBot() {
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-replay-'));
        const root = join(dir, 'profiles');
        mkdirSync(join(root, 'x'), { recursive: true });
        return { dir, root, leaseRoot: join(dir, 'leases') };
    }

    test('writes one screenshot per executed step plus replay.json, and stops before the submit', async () => {
        const bot = tempBot();
        try {
            const session = fakeSession(['[data-testid="compose"]']);
            const { result, replayPath, outDir } = await replayBot('x', transcript(), {
                root: bot.root,
                leaseRoot: bot.leaseRoot,
                outDir: join(bot.dir, 'evidence'),
                submitText: 'Post',
                launcher: session.launcher as never,
            });

            expect(result.stoppedBeforeSubmit).toBe(true);
            expect(result.rows).toHaveLength(3);
            // navigate + the resolved click; the skipped submit step gets no screenshot.
            expect(session.shots.map((path) => basename(path))).toEqual(['00.png', '01.png']);
            const written = JSON.parse(readFileSync(replayPath, 'utf8')) as { rows: unknown[]; screenshots: string[] };
            expect(written.rows).toHaveLength(3);
            expect(written.screenshots).toHaveLength(2);
            expect(outDir).toBe(join(bot.dir, 'evidence'));
        } finally {
            rmSync(bot.dir, { recursive: true, force: true });
        }
    });

    test('a step that resolves nothing still leaves its screenshot in the evidence directory', async () => {
        const bot = tempBot();
        try {
            const session = fakeSession([]);
            const { result, replayPath } = await replayBot('x', transcript(), {
                root: bot.root,
                leaseRoot: bot.leaseRoot,
                outDir: join(bot.dir, 'evidence'),
                submitText: 'Post',
                launcher: session.launcher as never,
                stepTimeoutMs: 50,
            });

            expect(result.rows.at(-1)).toMatchObject({ step: 1, ok: false });
            expect(session.shots.map((path) => basename(path))).toEqual(['00.png', '01.png']);
            expect(readFileSync(replayPath, 'utf8')).toContain('"ok": false');
        } finally {
            rmSync(bot.dir, { recursive: true, force: true });
        }
    });
});

describe('replay in real headless Chromium', () => {
    const PAGE = `<!doctype html>
<button data-testid="go" style="display:none" onclick="document.title='hidden'">Go</button>
<button data-testid="go" onclick="document.title='visible'">Go</button>
<button data-testid="ghost" style="display:none">Ghost</button>`;

    function steps(selector: string): BotTranscript {
        const t = {
            ...emptyTranscript({ bot: 'fixture', startUrl: 'about:blank', redacted: true }),
            startUrl: 'about:blank',
        };
        t.steps.push({ i: 0, t: 0, kind: 'click', url: 'about:blank', target: { selector, rank: 'testid' } } as never);
        return t;
    }

    test('a hidden duplicate does not fail the step, and the click lands on the visible node', async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(PAGE);

            const result = await replayBotSession('fixture', steps('[data-testid="go"]'), { page, submit: true });

            expect(result.rows[0]).toMatchObject({ ok: true, selectorCount: 1 });
            expect(await page.title()).toBe('visible');
        } finally {
            await browser.close();
        }
    }, 30_000);

    test('a target that only exists hidden fails the step instead of passing', async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(PAGE);

            const result = await replayBotSession('fixture', steps('[data-testid="ghost"]'), {
                page,
                submit: true,
                stepTimeoutMs: 500,
            });

            expect(result.rows[0]).toMatchObject({ ok: false, selectorCount: 0 });
        } finally {
            await browser.close();
        }
    }, 30_000);
});

describe('replay waits for a target a live page renders late', () => {
    test('a button that appears after the step starts still resolves within the step timeout', async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(
                `<!doctype html><script>setTimeout(() => { const b = document.createElement('button'); b.dataset.testid = 'late'; b.onclick = () => { document.title = 'clicked'; }; b.textContent = 'Late'; document.body.append(b); }, 400);</script>`,
            );
            const t = {
                ...emptyTranscript({ bot: 'fixture', startUrl: 'about:blank', redacted: true }),
                startUrl: 'about:blank',
            };
            t.steps.push({ i: 0, t: 0, kind: 'click', url: 'about:blank', target: testid('late') });

            const result = await replayBotSession('fixture', t, { page, submit: true, stepTimeoutMs: 5_000 });

            expect(result.rows[0]).toMatchObject({ ok: true, selectorCount: 1 });
            expect(await page.title()).toBe('clicked');
        } finally {
            await browser.close();
        }
    }, 30_000);

    test('a visible aria-hidden twin does not end the wait before the reachable target renders', async () => {
        // X: the background composer is visible under aria-hidden while the compose modal is still
        // mounting; waiting on the first visible match counted before the modal editor existed (2026-11-17).
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(
                `<!doctype html><main aria-hidden="true"><button data-testid="editor">bg</button></main><script>setTimeout(() => { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.innerHTML = '<button data-testid="editor" onclick="document.title=\\'modal\\'">modal</button>'; document.body.append(d); }, 400);</script>`,
            );
            const t = {
                ...emptyTranscript({ bot: 'fixture', startUrl: 'about:blank', redacted: true }),
                startUrl: 'about:blank',
            };
            t.steps.push({ i: 0, t: 0, kind: 'click', url: 'about:blank', target: testid('editor') });

            const result = await replayBotSession('fixture', t, { page, submit: true, stepTimeoutMs: 5_000 });

            expect(result.rows[0]).toMatchObject({ ok: true, selectorCount: 1 });
            expect(await page.title()).toBe('modal');
        } finally {
            await browser.close();
        }
    }, 30_000);

    test('a role-text selector resolves a control whose label sits in a child span', async () => {
        // Threads wraps every button label in spans; a `:text-is` role selector resolved 0 (2026-11-17).
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(
                `<!doctype html><div role="button" onclick="document.title='post'"><div><span>Post</span></div></div><div role="button"><span>Post</span> Options</div>`,
            );
            const target = selectorFor('div[role="button"]', 'Post');
            const t = {
                ...emptyTranscript({ bot: 'fixture', startUrl: 'about:blank', redacted: true }),
                startUrl: 'about:blank',
            };
            if (!('selector' in target)) throw new Error('expected a resolved selector');
            t.steps.push({ i: 0, t: 0, kind: 'click', url: 'about:blank', target });

            const result = await replayBotSession('fixture', t, { page, submit: true, stepTimeoutMs: 1_000 });

            expect(target.rank).toBe('role-text');
            expect(result.rows[0]).toMatchObject({ ok: true, selectorCount: 1 });
            expect(await page.title()).toBe('post');
        } finally {
            await browser.close();
        }
    }, 30_000);

    test('a twin under aria-hidden or inert does not count, and the reachable node is the one clicked', async () => {
        // X keeps its background composer under aria-hidden behind the compose modal (2026-11-17).
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setContent(
                `<!doctype html><main aria-hidden="true"><button data-testid="editor" onclick="document.title='hidden'">E</button></main><section inert><button data-testid="editor" onclick="document.title='inert'">E</button></section><div role="dialog"><button data-testid="editor" onclick="document.title='modal'">E</button></div>`,
            );
            const t = {
                ...emptyTranscript({ bot: 'fixture', startUrl: 'about:blank', redacted: true }),
                startUrl: 'about:blank',
            };
            t.steps.push({ i: 0, t: 0, kind: 'click', url: 'about:blank', target: testid('editor') });

            const result = await replayBotSession('fixture', t, { page, submit: true, stepTimeoutMs: 1_000 });

            expect(result.rows[0]).toMatchObject({ ok: true, selectorCount: 1 });
            expect(await page.title()).toBe('modal');
        } finally {
            await browser.close();
        }
    }, 30_000);
});

describe('replayBot in real headless Chromium against the local-post page (AC6)', () => {
    const fixture = JSON.parse(
        readFileSync(join(import.meta.dir, 'fixtures', 'bot-record', 'local-post.json'), 'utf8'),
    ) as BotTranscript;

    /** Serve the page local-post.json was recorded on; `submit: false` drops the Publish button. */
    function serve(options: { submit: boolean }) {
        const posts: string[] = [];
        const server = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch(request) {
                const url = new URL(request.url);
                if (request.method === 'POST') {
                    posts.push(url.pathname);
                    return Response.json({ data: { id: 'p-123' } }, { status: 201 });
                }
                const body =
                    url.pathname === '/compose'
                        ? `<textarea data-testid="editor"></textarea>${
                              options.submit
                                  ? `<button data-testid="submit" onclick="fetch('/api/posts?draft=1',{method:'POST'})">Publish</button>`
                                  : ''
                          }`
                        : `<button data-testid="compose" onclick="location.href='/compose'">Compose</button>`;
                return new Response(`<!doctype html>${body}`, { headers: { 'content-type': 'text/html' } });
            },
        });
        // The fixture was recorded on :4319; point it at this run's port.
        const transcript = JSON.parse(
            JSON.stringify(fixture).replaceAll('http://127.0.0.1:4319', `http://127.0.0.1:${server.port}`),
        ) as BotTranscript;
        return { posts, server, transcript };
    }

    async function run(options: { submit: boolean; withSubmit?: boolean; stepTimeoutMs?: number }) {
        const { chromium } = await import('playwright');
        const dir = mkdtempSync(join(tmpdir(), 'kk-bot-replay-live-'));
        const root = join(dir, 'profiles');
        mkdirSync(join(root, 'local-post'), { recursive: true });
        const site = serve({ submit: options.submit });
        try {
            const replay = await replayBot('local-post', site.transcript, {
                root,
                leaseRoot: join(dir, 'leases'),
                outDir: join(dir, 'evidence'),
                submit: options.withSubmit === true,
                ...(options.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: options.stepTimeoutMs }),
                launcher: {
                    launch: ({ profileDir }: { profileDir: string }) =>
                        chromium.launchPersistentContext(profileDir, { headless: true }),
                } as never,
            });
            // Give a stray submit a moment to reach the server before counting.
            await Bun.sleep(200);
            return { ...replay, posts: [...site.posts], dir };
        } finally {
            site.server.stop(true);
        }
    }

    test('stops before Publish: no POST reaches the page, one ok row and one screenshot per executed step', async () => {
        const { result, replayPath, posts, dir } = await run({ submit: true });
        try {
            expect(posts).toEqual([]);
            expect(result.stoppedBeforeSubmit).toBe(true);
            expect(result.rows.map((row) => [row.step, row.kind, row.ok])).toEqual([
                [0, 'navigate', true],
                [1, 'click', true],
                [2, 'type', true],
                [4, 'click', false],
            ]);
            const written = JSON.parse(readFileSync(replayPath, 'utf8')) as { screenshots: string[] };
            expect(written.screenshots.map((path) => basename(path))).toEqual(['00.png', '01.png', '02.png']);
            for (const shot of written.screenshots) expect(readFileSync(shot).subarray(1, 4).toString()).toBe('PNG');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);

    test('a removed button stops the run on that step with a failed row', async () => {
        const { result, posts, dir } = await run({ submit: false, withSubmit: true, stepTimeoutMs: 1_000 });
        try {
            expect(posts).toEqual([]);
            expect(result.stoppedBeforeSubmit).toBe(false);
            expect(result.rows.at(-1)).toMatchObject({ step: 4, ok: false, selectorCount: 0 });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});
