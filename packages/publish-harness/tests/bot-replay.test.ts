import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { type BotTranscript, emptyTranscript } from '../src/bot-record';
import { replayBot, replayBotSession, submitStepIndex } from '../src/bot-replay';

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
                goto: async (url: string) => {
                    visited.push(url);
                    return null;
                },
                locator: (selector: string) => ({
                    count: async () => (known.includes(selector) ? 1 : 0),
                }),
                click: async (selector: string) => {
                    clicks.push(selector);
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

        const result = await replayBotSession('x', transcript(), { page: fake.page as never, submitText: 'Post' });

        const failed = result.rows.at(-1);
        expect(failed).toMatchObject({ step: 2, ok: false });
        expect(failed?.detail).toMatch(/0 visible nodes/);
        expect(fake.typed).toEqual([]);
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
            locator: (selector: string) => ({ count: async () => (known.includes(selector) ? 1 : 0) }),
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
            });

            expect(result.rows.at(-1)).toMatchObject({ step: 1, ok: false });
            expect(session.shots.map((path) => basename(path))).toEqual(['00.png', '01.png']);
            expect(readFileSync(replayPath, 'utf8')).toContain('"ok": false');
        } finally {
            rmSync(bot.dir, { recursive: true, force: true });
        }
    });
});
