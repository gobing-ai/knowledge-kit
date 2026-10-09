/**
 * Task 0227 R1 — `itemFacts`: the deterministic, maker-independent facts that ingest moves out of
 * `metadata_json` into typed columns (G32 D2).
 *
 * ## Failure-first list — written before the code
 *
 *  1. `engagement` is absent, holds no number, or holds non-numeric strings, and is stored as `0`
 *     or `NaN` instead of NULL — a fake impact signal a backtest cannot tell from a real one.
 *  2. A numeric string (the plugin's `maxEngagement` parses it) is ignored, so ingest disagrees with
 *     the heuristic it is supposed to mirror.
 *  3. `body_chars` counts UTF-16 units, so an emoji or a beyond-plane CJK character counts 2.
 *  4. `source_tier` does not mirror `IMPORTANCE_BASE` (aihot curated, rss/hackernews community).
 *  5. `lang` ignores a declared `metadata.lang`, or does not fall back CJK-before-Latin, or returns
 *     `'en'` for a title with neither script.
 *  6. `domain` keeps a `www.` prefix or its case, or throws on an unparseable URL instead of NULL.
 */

import { describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { itemFacts, type SourceTier } from '../src/facts';

/** A `Doc` with the fields a fact test cares about; `body`/`title` default to non-empty text. */
function doc(overrides: Partial<Doc>): Doc {
    return { id: 'doc', body: 'body', title: 'Title', ...overrides };
}

describe('itemFacts.engagement', () => {
    const cases: readonly [string, Doc['metadata'], number | null][] = [
        ['absent key', {}, null],
        ['no entries', { engagement: {} }, null],
        ['numbers', { engagement: { points: 10, comments: 5 } }, 10],
        ['mixed shapes', { engagement: { points: 3, comments: '42', views: 7 } }, 42],
        ['non-numeric strings', { engagement: { points: 'n/a', comments: 'many' } }, null],
        ['a null value', { engagement: { points: null } }, null],
        ['a non-object value', { engagement: 'lots' }, null],
        ['a NaN value', { engagement: { points: Number.NaN } }, null],
        ['an infinite value', { engagement: { points: Number.POSITIVE_INFINITY, comments: 3 } }, 3],
    ];

    for (const [name, metadata, expected] of cases) {
        it(`${name} → ${JSON.stringify(expected)}`, () => {
            expect(itemFacts(doc({ metadata })).engagement).toBe(expected);
        });
    }
});

describe('itemFacts.bodyChars', () => {
    const cases: readonly [string, string, number][] = [
        ['ascii', 'abc', 3],
        ['empty', '', 0],
        ['an emoji (UTF-16 length 2)', '🎉', 1],
        ['a beyond-plane CJK ideograph (UTF-16 length 2)', '𠀀', 1],
        ['mixed', 'a🎉b𠀀', 4],
    ];

    for (const [name, body, expected] of cases) {
        it(`counts ${name} in code points`, () => {
            expect(itemFacts(doc({ body })).bodyChars).toBe(expected);
        });
    }
});

describe('itemFacts.sourceTier', () => {
    const cases: readonly [string, string, SourceTier][] = [
        ['aihot is curated', 'aihot', 'curated'],
        ['rss is community', 'rss', 'community'],
        ['hackernews is community', 'hackernews', 'community'],
        ['reddit is other', 'reddit', 'other'],
        ['an unknown source is other', 'youtube', 'other'],
    ];

    for (const [name, source, expected] of cases) {
        it(name, () => {
            expect(itemFacts(doc({ metadata: { source } })).sourceTier).toBe(expected);
        });
    }

    it('is other for a missing or non-string source', () => {
        expect(itemFacts(doc({})).sourceTier).toBe('other');
        expect(itemFacts(doc({ metadata: { source: 42 } })).sourceTier).toBe('other');
    });
});

describe('itemFacts.lang', () => {
    it('prefers a declared non-empty metadata.lang', () => {
        expect(itemFacts(doc({ title: 'OpenAI ships a model', metadata: { lang: 'ja' } })).lang).toBe('ja');
    });

    const fallback: readonly [string, string, string | null][] = [
        ['CJK ideograph → zh', '华为发布新模型', 'zh'],
        ['Latin letter → en', 'OpenAI ships a model', 'en'],
        ['mixed CJK + Latin → zh', 'CJK in en title 模型', 'zh'],
        ['digits only → null', '12345', null],
        ['emoji only → null', '🎉', null],
        ['empty → null', '', null],
        ['punctuation only → null', '--- ...', null],
    ];

    for (const [name, title, expected] of fallback) {
        it(name, () => {
            expect(itemFacts(doc({ title })).lang).toBe(expected);
        });
    }

    it('falls through an empty-string or non-string metadata.lang', () => {
        expect(itemFacts(doc({ title: '华为发布新模型', metadata: { lang: '' } })).lang).toBe('zh');
        expect(itemFacts(doc({ title: 'OpenAI ships a model', metadata: { lang: 42 } })).lang).toBe('en');
    });
});

describe('itemFacts.domain', () => {
    const cases: readonly [string, string, string | null][] = [
        ['lowercases and strips www.', 'https://WWW.Example.com/Path', 'example.com'],
        ['keeps a subdomain', 'https://news.ycombinator.com/item?id=1', 'news.ycombinator.com'],
        ['tolerates a missing scheme', 'www.example.com/x', 'example.com'],
        ['is null for an unparseable URL', 'not a url at all', null],
    ];

    for (const [name, sourceUri, expected] of cases) {
        it(name, () => {
            expect(itemFacts(doc({ sourceUri })).domain).toBe(expected);
        });
    }

    it('is null for a URL-less Doc', () => {
        expect(itemFacts(doc({})).domain).toBeNull();
    });
});
