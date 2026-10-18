import { describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { canonicalUrl, itemId, outboundUrls } from '../src/index';
import { sha256Hex } from './helpers';

describe('canonicalUrl', () => {
    it('lowercases scheme+host, drops the fragment, tracking params and a trailing slash', () => {
        expect(canonicalUrl('HTTPS://Example.COM/papers/Attention/?utm_source=X&ref=hn#section')).toBe(
            'https://example.com/papers/Attention',
        );
    });

    it('keeps content params and sorts them by name', () => {
        expect(canonicalUrl('https://example.com/p?b=2&a=1&utm_campaign=q&gclid=z')).toBe(
            'https://example.com/p?a=1&b=2',
        );
    });

    it('keeps the root slash and collapses slash-only paths', () => {
        expect(canonicalUrl('https://example.com')).toBe('https://example.com/');
        expect(canonicalUrl('https://example.com///')).toBe('https://example.com/');
    });

    it('treats a scheme-less URL as https', () => {
        expect(canonicalUrl('example.com/x?utm_source=a#f')).toBe('https://example.com/x');
    });

    it('punycodes an IDN host so two spellings of one host agree', () => {
        expect(canonicalUrl('https://例え.テスト/パス')).toBe('https://xn--r8jz45g.xn--zckzah/%E3%83%91%E3%82%B9');
    });

    it('returns unparseable input trimmed and unchanged instead of throwing', () => {
        expect(canonicalUrl('  not a url  ')).toBe('not a url');
        expect(canonicalUrl('#section')).toBe('#section');
    });

    it('is idempotent', () => {
        const once = canonicalUrl('https://Example.com/a/?utm_source=x');
        expect(canonicalUrl(once)).toBe(once);
    });
});

describe('itemId', () => {
    const urlDoc: Doc = { id: 'x', body: 'b', sourceUri: 'https://example.com/papers/attention' };

    it('hashes the canonical URL, so tracking variants of one page share an id', () => {
        const expected = sha256Hex('https://example.com/papers/attention');
        expect(itemId(urlDoc)).toBe(expected);
        expect(itemId({ ...urlDoc, sourceUri: 'https://example.com/papers/attention#other' })).toBe(expected);
    });

    it('falls back to metadata.originalUrl when sourceUri is absent', () => {
        const expected = sha256Hex('https://example.com/papers/attention');
        const doc: Doc = { id: 'x', body: 'b', metadata: { originalUrl: 'https://example.com/papers/attention' } };
        expect(itemId(doc)).toBe(expected);
    });

    it('hashes title+body for a URL-less Doc', () => {
        expect(itemId({ id: 'x', body: 'notes without a URL', title: 'Local note' })).toBe(
            sha256Hex('Local notenotes without a URL'),
        );
    });

    it('gives different text different ids', () => {
        expect(itemId({ id: 'x', body: 'a', title: 't' })).not.toBe(itemId({ id: 'x', body: 'b', title: 't' }));
    });
});

describe('outboundUrls', () => {
    it('extracts and canonicalizes the links a body points at, in appearance order', () => {
        expect(outboundUrls('See https://Example.com/a/?utm_source=x and http://b.test/p.')).toEqual([
            'https://example.com/a',
            'http://b.test/p',
        ]);
    });

    it('finds a URL inside markdown link syntax without swallowing the closing paren', () => {
        expect(
            outboundUrls('as covered in [the post](https://claude.dev/blog/solving-code-review-at-anthropic)'),
        ).toEqual(['https://claude.dev/blog/solving-code-review-at-anthropic']);
    });

    it('dedupes one page reached through two spellings', () => {
        expect(outboundUrls('https://x.test/p?utm_source=a https://X.test/p')).toEqual(['https://x.test/p']);
    });

    it('returns nothing when the text carries no http(s) URL', () => {
        expect(outboundUrls('no links here, see ftp://x.test or www.example.com')).toEqual([]);
        expect(outboundUrls('')).toEqual([]);
    });
});
