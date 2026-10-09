/**
 * Task 0227 R2 — `storyTokens` / `storyIdFor`: the deterministic title-similarity key that lets the
 * same event under two URLs share one story (G32 D5).
 *
 * ## Failure-first list — written before the code
 *
 *  1. An empty, whitespace-only, emoji- or punctuation-only title yields tokens, so it matches
 *     whatever candidate it is compared against (an empty token set must NEVER match).
 *  2. A trailing outlet suffix (` - `, ` | `, `｜`, ` — `) is not stripped, so the same headline from
 *     two outlets does not cluster.
 *  3. A long ` - ` clause that is not an outlet suffix is stripped anyway, truncating a real title.
 *  4. The ≤30-char suffix guard is off by one, or strips a suffix longer than 30 characters.
 *  5. Latin titles are tokenized as character bigrams (the plugin's `titleSimilarity`), so unrelated
 *     English headlines over-merge.
 *  6. A CJK run is not bigrammed, or a single-character CJK run is dropped instead of kept.
 *  7. Punctuation inside a title merges two words, or splits a Latin word that the reader sees whole.
 *  8. The Jaccard comparison ignores the threshold, or matches a candidate below it.
 *  9. A tie is broken by input order instead of earliest `first_seen_at`, then smallest `id`.
 * 10. `storyIdFor` returns the matching candidate's id instead of its `storyId`, so a cluster is
 *     re-rooted on every later member.
 */

import { describe, expect, it } from 'bun:test';
import { type StoryCandidate, storyIdFor, storyTokens } from '../src/story';

/** The token set as a sorted array, so assertions read as the exact expected tokenization. */
function tokens(title: string): string[] {
    return [...storyTokens(title)].sort();
}

/** One clustering candidate; `firstSeenAt`/`id` exist for the tie-break cases. */
function candidate(overrides: Partial<StoryCandidate> & { id: string }): StoryCandidate {
    return { storyId: `story-${overrides.id}`, title: 'title', firstSeenAt: 0, ...overrides };
}

describe('storyTokens', () => {
    it('has no tokens for an empty, blank, punctuation-only or emoji-only title', () => {
        for (const title of ['', '   ', '!!! ???', '🎉🎉', ' - ', '...']) {
            expect(storyTokens(title).size, JSON.stringify(title)).toBe(0);
        }
    });

    it('tokenizes Latin/digit runs as words, never character bigrams', () => {
        expect(tokens('OpenAI releases GPT-5')).toEqual(['5', 'gpt', 'openai', 'releases']);
    });

    it('bigrams CJK runs and keeps a single-character run as that character', () => {
        expect(tokens('华为发布新模型')).toEqual(['为发', '华为', '发布', '布新', '新模', '模型']);
        expect(tokens('猫')).toEqual(['猫']);
        expect(tokens('好猫')).toEqual(['好猫']);
    });

    it('splits a mixed CJK + Latin title into its two script token families', () => {
        expect(tokens('华为发布 GPT-5 模型')).toEqual(['5', 'gpt', '为发', '华为', '发布', '模型']);
    });

    it('normalizes NFKC and lowercases before tokenizing', () => {
        expect(tokens('ＯＰＥＮＡＩ')).toEqual(['openai']);
        expect(tokens('NAÏVE')).toEqual(['naïve']);
    });

    it('splits on punctuation and symbols rather than merging across them', () => {
        expect(tokens('a-b/c')).toEqual(['a', 'b', 'c']);
        expect(tokens('well-known')).toEqual(['known', 'well']);
    });

    it('strips a trailing outlet suffix', () => {
        const headline = tokens('OpenAI ships GPT-5 | The Verge');
        expect(headline).toEqual(tokens('OpenAI ships GPT-5'));
        expect(headline).toEqual(['5', 'gpt', 'openai', 'ships']);

        for (const suffix of [' - Reuters', ' | Reuters', '｜Reuters', ' — Reuters']) {
            expect(tokens(`OpenAI ships GPT-5${suffix}`), suffix).toEqual(headline);
        }
    });

    it('keeps a long trailing clause that is not an outlet suffix', () => {
        const long = 'OpenAI ships GPT-5 - a deep dive into the training run and its many surprises';
        expect(tokens(long)).not.toEqual(tokens('OpenAI ships GPT-5'));
        expect(storyTokens(long).size).toBeGreaterThan(4);
    });

    it('strips a suffix of exactly 30 characters but not 31', () => {
        const exactly30 = 'x'.repeat(30);
        const exactly31 = 'x'.repeat(31);
        expect(tokens(`Headline | ${exactly30}`)).toEqual(tokens('Headline'));
        expect(tokens(`Headline | ${exactly31}`)).not.toEqual(tokens('Headline'));
    });
});

describe('storyIdFor', () => {
    it('never matches on an empty token set, even at threshold 0', () => {
        const candidates = [candidate({ id: 'a', title: 'OpenAI ships GPT-5' })];
        expect(storyIdFor('', candidates, 0)).toBeNull();
        expect(storyIdFor('🎉', candidates, 0)).toBeNull();
        expect(storyIdFor('OpenAI ships GPT-5', [candidate({ id: 'b', title: '!!! ???' })], 0)).toBeNull();
    });

    it('returns the matching candidate story root, not the candidate id', () => {
        const candidates = [candidate({ id: 'b', storyId: 'root-a', title: 'OpenAI ships GPT-5 | The Verge' })];
        expect(storyIdFor('OpenAI ships GPT-5 - Reuters', candidates, 0.6)).toBe('root-a');
    });

    it('matches at exactly the threshold and refuses below it', () => {
        // {alpha, beta, gamma} vs {alpha, beta, delta}: 2 identical / 4 union = 0.5.
        const candidates = [candidate({ id: 'a', title: 'alpha beta gamma' })];
        expect(storyIdFor('alpha beta delta', candidates, 0.5)).toBe('story-a');
        expect(storyIdFor('alpha beta delta', candidates, 0.51)).toBeNull();
    });

    it('picks the best candidate, then the earliest first_seen_at, then the smallest id', () => {
        const best = candidate({ id: 'best', title: 'OpenAI ships GPT-5' });
        const near = candidate({ id: 'near', storyId: 'story-near', title: 'OpenAI releases a model' });
        expect(storyIdFor('OpenAI ships GPT-5', [near, best], 0.6)).toBe('story-best');

        const later = candidate({ id: 'later', title: 'OpenAI ships GPT-5', firstSeenAt: 200 });
        const earlier = candidate({ id: 'earlier', title: 'OpenAI ships GPT-5', firstSeenAt: 100 });
        expect(storyIdFor('OpenAI ships GPT-5', [later, earlier], 0.6)).toBe('story-earlier');

        const bigId = candidate({ id: 'z', title: 'OpenAI ships GPT-5', firstSeenAt: 100 });
        const smallId = candidate({ id: 'a', title: 'OpenAI ships GPT-5', firstSeenAt: 100 });
        expect(storyIdFor('OpenAI ships GPT-5', [bigId, smallId], 0.6)).toBe('story-a');
    });

    it('returns null with no candidates so the caller uses the item’s own id', () => {
        expect(storyIdFor('OpenAI ships GPT-5', [], 0.6)).toBeNull();
    });

    it('does not merge unrelated Latin titles that share character bigrams', () => {
        const candidates = [candidate({ id: 'a', title: 'Attention Is All You Need' })];
        expect(storyIdFor('An Analysis of Integer Encoding', candidates, 0.6)).toBeNull();
    });
});
