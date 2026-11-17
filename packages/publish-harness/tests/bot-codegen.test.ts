import { describe, expect, test } from 'bun:test';
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

    test('the recorded x session generates: 9 steps, 8 testid selectors and one aria selector', async () => {
        const transcript = await readTranscript(join(fixtures, 'x.json'));
        const { source, warnings } = generateRail(transcript, {
            plugin: 'x-pub',
            operation: 'post',
            transcriptPath: 'packages/publish-harness/tests/fixtures/bot-record/x.json',
        });

        expect(transcript.steps).toHaveLength(9);
        expect(source.match(/data-testid=/g)?.length).toBe(8);
        expect(source).toContain('aria-label=');
        // The x recording predates response capture, so the receipt is an explicit TODO, not a guess.
        expect(warnings).toHaveLength(1);
        expect(source).toContain('TODO receipt');
    });

    test('the recorded threads session aborts on its one structural-only step', async () => {
        const transcript = await readTranscript(join(fixtures, 'threads.json'));
        const structural = transcript.steps.find(
            (step) => 'target' in step && !('ambiguous' in step.target) && step.target.rank === 'path',
        );

        expect(structural).toBeDefined();
        expect(() => generateRail(transcript, { plugin: 'threads-pub', operation: 'post' })).toThrow(
            new RegExp(`step ${structural?.i}\\b.*structural`),
        );
    });

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
