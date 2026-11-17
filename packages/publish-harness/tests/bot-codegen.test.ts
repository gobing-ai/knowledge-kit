import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateRail } from '../src/bot-codegen';
import { type BotTranscript, emptyTranscript, readTranscript } from '../src/bot-record';

const testid = (value: string) => ({ selector: `[data-testid="${value}"]`, rank: 'testid' as const });

function composeTranscript(): BotTranscript {
    const transcript = emptyTranscript({ bot: 'x', startUrl: 'https://x.com/home', redacted: true });
    transcript.steps = [
        { i: 0, t: 1, kind: 'navigate', url: 'https://x.com/home' },
        {
            i: 1,
            t: 2,
            kind: 'click',
            url: 'https://x.com/home',
            target: testid('SideNav_NewTweet_Button'),
            text: 'Post',
        },
        {
            i: 2,
            t: 3,
            kind: 'type',
            url: 'https://x.com/compose/post',
            target: testid('tweetTextarea_0'),
            text: { redacted: true, length: 42 },
        },
        { i: 3, t: 4, kind: 'click', url: 'https://x.com/compose/post', target: testid('tweetButton'), text: 'Post' },
        {
            i: 4,
            t: 5,
            kind: 'response',
            method: 'POST',
            url: 'https://x.com/i/api/graphql/abc/CreateTweet',
            status: 200,
            body: {
                data: { create_tweet: { tweet_results: { result: { rest_id: '1900123' } } }, auth_token: '<redacted>' },
            },
        },
    ];
    return transcript;
}

describe('generateRail', () => {
    test('emits a selector table, the ordered steps over the harness helpers, and a response receipt', () => {
        const { source, warnings } = generateRail(composeTranscript(), {
            plugin: 'x-pub',
            operation: 'post',
            transcriptPath: 'packages/publish-harness/tests/fixtures/bot-record/x.json',
        });

        expect(warnings).toEqual([]);
        expect(source).toContain('// transcript: packages/publish-harness/tests/fixtures/bot-record/x.json');
        expect(source).toContain('export const SELECTORS = {');
        expect(source).toContain(`step1: '[data-testid="SideNav_NewTweet_Button"]',`);
        expect(source).toContain(`step2: '[data-testid="tweetTextarea_0"]',`);
        expect(source).toContain('await resolveSelector(page, [SELECTORS.step1 as string]);');
        expect(source).toContain('await page.keyboard.type(input.text);');
        expect(source).toContain('// receipt');
        expect(source).toContain('page.waitForResponse(');
        expect(source).toContain("'POST'");
        expect(source).toContain('/i/api/graphql/abc/CreateTweet');
        expect(source).toContain("'data.create_tweet.tweet_results.result.rest_id'");
        expect(source).toContain('export async function runPost(');
    });

    test('an upload response recorded before the submit is an intermediate id, never the receipt', () => {
        const transcript = composeTranscript();
        transcript.steps.splice(2, 0, {
            i: 0,
            t: 3,
            kind: 'response',
            method: 'POST',
            url: 'https://x.com/i/api/1.1/media/upload.json',
            status: 200,
            body: { media_id_string: '77' },
        });

        const { source } = generateRail(transcript, { plugin: 'x-pub', operation: 'post' });
        const receipt = source.slice(source.indexOf('// receipt'));
        expect(receipt).toContain('CreateTweet');
        expect(receipt).not.toContain('media/upload.json');
    });

    test('a background endpoint that also fired before the submit is never the receipt, even when it lands last', () => {
        // Live x (2026-11-17): HomeTimeline and update_subscriptions poll before and after CreateTweet.
        const poll = (i: number, body: unknown) => ({
            i,
            t: i,
            kind: 'response' as const,
            method: 'POST' as const,
            url: 'https://api.x.com/1.1/live_pipeline/update_subscriptions',
            status: 200,
            body,
        });
        const transcript = composeTranscript();
        transcript.steps.splice(1, 0, poll(0, { subscriptions: { id: 'before' } }));
        transcript.steps.push(poll(11, { subscriptions: { id: 'after' } }));

        const { source, warnings } = generateRail(transcript, { plugin: 'x-pub', operation: 'post' });

        expect(warnings).toEqual([]);
        expect(source.slice(source.indexOf('// receipt'))).toContain('CreateTweet');
        expect(source).not.toContain('update_subscriptions');
    });

    test('the uploadFile helper is imported exactly when a file step uses it', () => {
        const plain = generateRail(composeTranscript(), { plugin: 'x-pub', operation: 'post' }).source;
        const transcript = composeTranscript();
        transcript.steps.splice(3, 0, {
            i: 5,
            t: 4,
            kind: 'file',
            url: 'https://x.com/compose/post',
            target: testid('fileInput'),
            fileName: 'card.png',
        });
        const withFile = generateRail(transcript, { plugin: 'x-pub', operation: 'post' }).source;

        expect(plain).toContain("import { expectOutcome, resolveSelector } from '@gobing-ai/publish-harness/browser';");
        expect(withFile).toContain(
            "import { expectOutcome, resolveSelector, uploadFile } from '@gobing-ai/publish-harness/browser';",
        );
        expect(withFile).toContain('await uploadFile(page,');
    });

    test('an explicit receipt path wins over the picked one', () => {
        const { source } = generateRail(composeTranscript(), {
            plugin: 'x-pub',
            operation: 'post',
            receiptPath: 'data.create_tweet.tweet_results.result.rest_id',
        });

        expect(source).toContain("'data.create_tweet.tweet_results.result.rest_id'");
    });

    test('a transcript with no mutating response still emits a rail, with a receipt TODO and a warning', () => {
        const transcript = composeTranscript();
        transcript.steps = transcript.steps.filter((step) => step.kind !== 'response');

        const { source, warnings } = generateRail(transcript, { plugin: 'x-pub', operation: 'post' });

        expect(source).toContain('TODO receipt');
        expect(source).not.toContain('waitForResponse');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/receipt/i);
    });

    test('an ambiguous step aborts codegen and names its index', () => {
        const transcript = composeTranscript();
        const click = transcript.steps[1];
        if (click?.kind !== 'click') throw new Error('fixture drift');
        click.target = {
            ambiguous: true,
            candidates: ['main > button:nth-of-type(1)', 'main > button:nth-of-type(2)'],
        };

        expect(() => generateRail(transcript, { plugin: 'x-pub', operation: 'post' })).toThrow(/step 1\b.*ambiguous/);
    });

    test('a structural-only step aborts codegen instead of emitting a brittle selector', () => {
        const transcript = composeTranscript();
        const click = transcript.steps[1];
        if (click?.kind !== 'click') throw new Error('fixture drift');
        click.target = { selector: 'main > div:nth-of-type(2) > button', rank: 'path' };

        expect(() => generateRail(transcript, { plugin: 'x-pub', operation: 'post' })).toThrow(/step 1\b.*structural/);
    });

    test('an operation name is camel-cased into the exported runner', () => {
        const { source } = generateRail(composeTranscript(), { plugin: 'x-pub', operation: 'post-thread' });

        expect(source).toContain('export async function runPostThread(');
    });
});

describe('generateRail over the committed fixtures', () => {
    const fixtures = join(import.meta.dir, 'fixtures', 'bot-record');

    // Both fixtures are live `kk bot record` sessions (2026-11-17) that replayed live, every step
    // resolving one node, stopped before Post (.spur/run/dogfood/2026-11-17-bot-replay/{x,threads}-rec4).
    test('the recorded x session generates testid selectors and a CreateTweet receipt past the polling endpoints', async () => {
        const transcript = await readTranscript(join(fixtures, 'x.json'));
        const { source, warnings } = generateRail(transcript, {
            plugin: 'x-pub',
            operation: 'post',
            transcriptPath: 'packages/publish-harness/tests/fixtures/bot-record/x.json',
        });

        expect(warnings).toEqual([]);
        expect(source).toContain('[data-testid="SideNav_NewTweet_Button"]');
        expect(source).toContain('[data-testid="tweetButton"]');
        expect(source).toContain(
            "new URL(candidate.url()).pathname === '/i/api/graphql/l4hk8uVGvR-a8kzQ4nOhPA/CreateTweet'",
        );
        expect(source).toContain("const receiptPath = 'data.create_tweet.tweet_results.result.rest_id';");
        expect(source).not.toContain('update_subscriptions');
        expect(source).not.toContain('HomeTimeline');
    });

    test('the recorded threads session generates role-engine selectors and the configure_text_only_post receipt', async () => {
        const transcript = await readTranscript(join(fixtures, 'threads.json'));
        const { source, warnings } = generateRail(transcript, { plugin: 'threads-pub', operation: 'post' });

        expect(warnings).toEqual([]);
        expect(source).toContain('role=button[name="New thread" s]');
        expect(source).toContain('role=button[name="Post" s]');
        expect(source).toContain("new URL(candidate.url()).pathname === '/api/v1/media/configure_text_only_post/'");
        expect(source).toContain("const receiptPath = 'media.id';");
        expect(source).not.toContain('/graphql/query');
    });

    test('every committed fixture generates a rail that type-checks under the repo compiler settings', async () => {
        // AC4: a promoted rail must pass `bun run lint`, so check with the shared strict base
        // (noUnusedLocals included) against the real harness exports, not a string match.
        const root = join(import.meta.dir, '..');
        const dir = mkdtempSync(join(root, '.codegen-typecheck-'));
        try {
            const files: string[] = [];
            for (const [fixture, plugin] of [
                ['x', 'x-pub'],
                ['threads', 'threads-pub'],
                ['local-post', 'local-pub'],
            ] as const) {
                const transcript = await readTranscript(join(fixtures, `${fixture}.json`));
                writeFileSync(
                    join(dir, `${fixture}.ts`),
                    generateRail(transcript, { plugin, operation: 'post' }).source,
                );
                files.push(`${fixture}.ts`);
            }
            writeFileSync(
                join(dir, 'tsconfig.json'),
                JSON.stringify({
                    extends: '../../../tooling/typescript/base.json',
                    compilerOptions: { noEmit: true, rootDir: '..' },
                    include: files,
                }),
            );

            const tsc = Bun.spawnSync(['bunx', 'tsc', '-p', join(dir, 'tsconfig.json')], { cwd: root });

            expect(tsc.stdout.toString()).toBe('');
            expect(tsc.exitCode).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);

    test('the synthetic local session picks the submit response, not the earlier upload', async () => {
        const transcript = await readTranscript(join(fixtures, 'local-post.json'));
        const { source, warnings } = generateRail(transcript, { plugin: 'local-pub', operation: 'post' });

        expect(warnings).toEqual([]);
        expect(source).toContain(
            "candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/posts'",
        );
        expect(source).toContain("const receiptPath = 'data.id';");
        expect(source).not.toContain("'/api/upload'");
    });
});
