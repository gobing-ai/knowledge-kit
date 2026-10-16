import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    compileProfile,
    DEFAULT_EXTRACT_LIMIT,
    ITEM_DECISION_IDS,
    ProfileInvalidError,
    parseProfile,
} from '../src/profile';
import { REPO_ROOT } from './helpers';

/**
 * Failure-first list — every way `parseProfile`/`compileProfile` can be wrong, before the code:
 *
 * 1. The shipped profile (`plugins/kk/decisions/extract/ai-news.yaml`) is not parseable, or
 *    drifts from design §4's shape.
 * 2. An unknown top-level key (`order_by`, `topics`) is accepted silently.
 * 3. A `where` key that is not a catalog decision id (`kk-item-typo`) is accepted, so the pool
 *    silently selects nothing.
 * 4. A `where` value with no operator, two operators, or an unknown operator is accepted.
 * 5. `{ in: [] }` or `{ in: [1] }` (non-string members) is accepted.
 * 6. `{ gte: '3' }` (string instead of integer) is accepted.
 * 7. `order` names an unknown decision, omits the direction, or uses `up`/`down`.
 * 8. `limit: 0`, `limit: -1` or `limit: 2.5` is accepted.
 * 9. A missing/blank `topic`, a non-mapping document, or invalid YAML throws something other
 *    than `ProfileInvalidError` (the caller's `kk.store.profile.invalid` branch).
 * 10. `compileProfile` loses the profile's predicates/order, or ignores the `--limit` /
 *    `excludeTopic` overrides.
 * 11. The default limit is not the episode cap.
 */

const AI_NEWS_PROFILE = join(REPO_ROOT, 'plugins/kk/decisions/extract/ai-news.yaml');

describe('parseProfile', () => {
    it('parses the shipped ai-news profile into the design §4 predicates and order', () => {
        const profile = parseProfile(readFileSync(AI_NEWS_PROFILE, 'utf-8'));

        expect(profile.topic).toBe('ai-news');
        expect(profile.where).toEqual([
            { decisionId: 'kk-item-category', op: 'in', values: ['ai-news', 'ai-industry'] },
            { decisionId: 'kk-item-quality', op: 'gte', value: 2 },
            { decisionId: 'kk-item-importance', op: 'gte', value: 3 },
            // Task 0229 R5: the conservative moderation gate. An inner join on `labels_current`,
            // so an item with no current china-politics answer is excluded (fail-closed).
            { decisionId: 'kk-item-china-politics', op: 'lte', value: 1 },
        ]);
        expect(profile.order).toEqual([
            { decisionId: 'kk-item-urgency', direction: 'desc' },
            { decisionId: 'kk-item-impact', direction: 'desc' },
            { column: 'first_seen_at', direction: 'desc' },
        ]);
        expect(profile.limit).toBe(DEFAULT_EXTRACT_LIMIT);
    });

    it('parses lte, an explicit limit and a first_seen_at-only order', () => {
        const profile = parseProfile(
            [
                'topic: thin-day',
                'where:',
                '  kk-item-urgency: { lte: 2 }',
                'order: [first_seen_at asc]',
                'limit: 3',
            ].join('\n'),
        );

        expect(profile.where).toEqual([{ decisionId: 'kk-item-urgency', op: 'lte', value: 2 }]);
        expect(profile.order).toEqual([{ column: 'first_seen_at', direction: 'asc' }]);
        expect(profile.limit).toBe(3);
    });

    it('defaults order to empty when the profile omits it', () => {
        const profile = parseProfile('topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\n');
        expect(profile.order).toEqual([]);
    });

    it('accepts the three judgment decisions 0229 added to the catalog (R6)', () => {
        // The profile gate is why the ids must be in `ITEM_DECISION_IDS`: a profile naming one and
        // rejected here would fail `kk.store.profile.invalid` instead of gating the pool.
        for (const id of ['kk-item-china-politics', 'kk-item-sensitivity', 'kk-item-audience']) {
            expect(ITEM_DECISION_IDS).toContain(id);
        }
        const profile = parseProfile('topic: t\nwhere:\n  kk-item-china-politics: { lte: 1 }\n');
        expect(profile.where).toEqual([{ decisionId: 'kk-item-china-politics', op: 'lte', value: 1 }]);
        const audience = parseProfile('topic: t\nwhere:\n  kk-item-audience: { in: [general, researcher] }\n');
        expect(audience.where).toEqual([
            { decisionId: 'kk-item-audience', op: 'in', values: ['general', 'researcher'] },
        ]);
    });

    it('rejects an unknown top-level key', () => {
        const yaml = 'topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\norder_by: [nope]\n';
        expect(() => parseProfile(yaml)).toThrow(ProfileInvalidError);
        expect(() => parseProfile(yaml)).toThrow(/unknown key 'order_by'/);
    });

    it('rejects an unknown decision id in where and in order', () => {
        expect(() => parseProfile('topic: t\nwhere:\n  kk-item-typo: { in: [ai-news] }\n')).toThrow(
            /unknown decision id 'kk-item-typo'/,
        );
        expect(() =>
            parseProfile('topic: t\nwhere:\n  kk-item-category:\n    in: [ai-news]\norder: [kk-item-typo desc]\n'),
        ).toThrow(/unknown decision id 'kk-item-typo'/);
    });

    it('rejects a malformed where predicate', () => {
        for (const body of [
            'kk-item-category: {}',
            'kk-item-category: { in: [], gte: 3 }',
            'kk-item-category: { gt: 3 }',
            'kk-item-category: [ai-news]',
            'kk-item-category: { in: [] }',
            'kk-item-category: { in: [1] }',
            "kk-item-category: { gte: '3' }",
            'kk-item-category: { gte: 2.5 }',
        ]) {
            expect(() => parseProfile(`topic: t\nwhere:\n  ${body}\n`)).toThrow(ProfileInvalidError);
        }
    });

    it('rejects a malformed order term', () => {
        for (const order of ['[kk-item-urgency]', '[kk-item-urgency up]', '[kk-item-urgency desc extra]', '[5]']) {
            expect(() =>
                parseProfile(`topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\norder: ${order}\n`),
            ).toThrow(ProfileInvalidError);
        }
    });

    it('rejects a non-positive or fractional limit', () => {
        for (const limit of ['0', '-1', '2.5']) {
            expect(() =>
                parseProfile(`topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\nlimit: ${limit}\n`),
            ).toThrow(ProfileInvalidError);
        }
    });

    it('rejects a missing topic, a missing where and invalid YAML', () => {
        expect(() => parseProfile('where:\n  kk-item-category: { in: [ai-news] }\n')).toThrow(/topic/);
        expect(() => parseProfile('topic: t\n')).toThrow(/where/);
        expect(() => parseProfile('[not, a, mapping]\n')).toThrow(/YAML mapping/);
        expect(() => parseProfile('topic: t\nwhere: {unclosed\n')).toThrow(ProfileInvalidError);
    });

    it('0300 — accepts optional publishPreset as lowercase hyphenated slug and rejects invalid formats', () => {
        const valid = parseProfile(
            'topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\npublishPreset: technical-article\n',
        );
        expect(valid.publishPreset).toBe('technical-article');

        for (const bad of ['Technical', 'tech article', 'tech_article', 'tech/article', '']) {
            expect(() =>
                parseProfile(
                    `topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\npublishPreset: ${JSON.stringify(bad)}\n`,
                ),
            ).toThrow(ProfileInvalidError);
        }
    });
});

describe('compileProfile', () => {
    it('carries the profile predicates and order into the query spec', () => {
        const profile = parseProfile(readFileSync(AI_NEWS_PROFILE, 'utf-8'));
        const query = compileProfile(profile, { windowMs: 86_400_000, now: 1_000_000 });

        expect(query.where).toEqual(profile.where);
        expect(query.order).toEqual(profile.order);
        expect(query.windowMs).toBe(86_400_000);
        expect(query.now).toBe(1_000_000);
        expect(query.limit).toBe(DEFAULT_EXTRACT_LIMIT);
        expect(query.excludeTopic).toBeUndefined();
    });

    it('0300 — compileProfile query is byte-equivalent with or without publishPreset', () => {
        const withPreset = parseProfile(
            'topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\npublishPreset: technical-article\n',
        );
        const withoutPreset = parseProfile('topic: t\nwhere:\n  kk-item-category: { in: [ai-news] }\n');
        const q1 = compileProfile(withPreset, { windowMs: 3600000, now: 1000, limit: 10 });
        const q2 = compileProfile(withoutPreset, { windowMs: 3600000, now: 1000, limit: 10 });
        expect(q1).toEqual(q2);
    });
});
