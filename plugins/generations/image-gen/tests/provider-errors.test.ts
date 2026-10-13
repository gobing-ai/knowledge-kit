import { describe, expect, test } from 'bun:test';
import type { ProviderErrorClass } from '../src/providers/errors';
import { classifyProviderError, isFallbackEligible, isTransientRetry } from '../src/providers/errors';

/**
 * Task 0164 — fixtures copy the real adapter throw strings (see `rg "throw new Error" src/providers`),
 * so wording drift in an adapter surfaces here as a test to update.
 */
const CASES: ReadonlyArray<readonly [string, unknown, ProviderErrorClass]> = [
    ['seedream HTTP 401', new Error('seedream HTTP 401: {"error":{"code":"InvalidAccessToken"}}'), 'auth'],
    ['seedream missing key', new Error("Provider 'seedream' requires ARK_API_KEY"), 'auth'],
    ['minimax 429', new Error('MiniMax API error (429): {"base_resp":{"status_code":1002}}'), 'quota'],
    ['minimax insufficient balance', new Error('insufficient balance'), 'quota'],
    [
        'huggingface 503 while model loads',
        new Error('HuggingFace model loading (HTTP 503): {"error":"Model is loading"}'),
        'transient',
    ],
    ['request timeout abort', new DOMException('The operation was timed out.', 'TimeoutError'), 'transient'],
    [
        'openai content-policy rejection',
        new Error('OpenAI API error: {"error":{"code":"content_policy_violation","message":"rejected"}}'),
        'policy',
    ],
    ['google safety rejection on 400', new Error('Google API error (400): prompt blocked: SAFETY'), 'policy'],
    ['google 403 permission denied', new Error('Google API error (403): permission denied'), 'auth'],
    ['minimax image download 401', new Error('Failed to download image from MiniMax: 401'), 'auth'],
    ['huggingface generic 500', new Error('HuggingFace HTTP 500: boom'), 'transient'],
    ['minimax no image data', new Error('No image data in MiniMax response'), 'unknown'],
    ['plain string value', 'boom', 'unknown'],
];

describe('classifyProviderError', () => {
    test.each(CASES)('%s → %s', (_label, err, expected) => {
        expect(classifyProviderError(err)).toBe(expected);
    });

    test('never throws on junk values; every non-Error value is unknown', () => {
        const junk: unknown[] = [null, undefined, 42, true, Symbol('x'), {}, [], new Date()];
        for (const value of junk) expect(classifyProviderError(value)).toBe('unknown');
    });

    test('reads name and message duck-typed from any thrown object', () => {
        expect(classifyProviderError({ name: 'TimeoutError', message: '' })).toBe('transient');
    });
});

describe('classification precedence (first matching row wins)', () => {
    test('policy beats auth: a safety rejection arriving on 403 never falls back (R4)', () => {
        expect(classifyProviderError(new Error('Google API error (403): prompt blocked by safety systems'))).toBe(
            'policy',
        );
    });

    test('auth beats quota: credential wording carrying a 429 status stays auth', () => {
        expect(classifyProviderError(new Error('OpenAI API error (429): invalid api key'))).toBe('auth');
    });

    test('quota beats transient: rate-limit wording carrying a 5xx status stays quota', () => {
        expect(classifyProviderError(new Error('Replicate poll error (503): rate limit exceeded'))).toBe('quota');
    });

    test('transient matches the AbortError abort name', () => {
        expect(classifyProviderError(new DOMException('The user aborted a request.', 'AbortError'))).toBe('transient');
    });

    test('transient matches a 408 status with no keyword', () => {
        expect(classifyProviderError(new Error('Replicate poll error (408): upstream stalled'))).toBe('transient');
    });
});

describe('isTransientRetry', () => {
    test('0269 R1: transient and quota are retried on the same provider; auth, policy, unknown never', () => {
        for (const cls of ['transient', 'quota'] as const) {
            expect(isTransientRetry(cls)).toBe(true);
        }
        for (const cls of ['auth', 'policy', 'unknown'] as const) {
            expect(isTransientRetry(cls)).toBe(false);
        }
    });
});

describe('isFallbackEligible', () => {
    test('policy is the only non-eligible class', () => {
        for (const cls of ['auth', 'quota', 'transient', 'unknown'] as const) {
            expect(isFallbackEligible(cls)).toBe(true);
        }
        expect(isFallbackEligible('policy')).toBe(false);
    });

    test('classified policy rejections are never fallback-eligible (AC1)', () => {
        const policyCases = CASES.filter((caseRow) => caseRow[2] === 'policy');
        expect(policyCases.length).toBeGreaterThan(0);
        for (const [, err] of policyCases) {
            expect(isFallbackEligible(classifyProviderError(err))).toBe(false);
        }
    });
});
