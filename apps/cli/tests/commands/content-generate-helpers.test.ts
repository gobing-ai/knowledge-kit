import { describe, expect, test } from 'bun:test';
import { Command } from 'commander';
import {
    itemCount,
    registerContentGenerateCommand,
    resolveNewsSettings,
    selectedCountOf,
} from '../../src/commands/content-generate';

/**
 * The `news`/`article` content-generate surface at unit grain: the command registration, the
 * pool-item counter and the config block reader.
 *
 * These exist because `content-generate.ts` carries a per-file function-coverage threshold and its
 * verbs are driven end to end elsewhere (`content-generate-inproc.test.ts`) — this file pins the
 * parts a verb run cannot reach cheaply: the registration seam host integrations call, the shapes
 * `itemCount` must and must not read as a doc list, and every refusal `resolveNewsSettings` owns
 * (a silently ignored key would change what a stage renders).
 */

describe('registerContentGenerateCommand', () => {
    test('registers the noun with every generation verb and its own options', () => {
        const program = new Command();
        registerContentGenerateCommand(program, 'news', 'news');
        const group = program.commands.find((command) => command.name() === 'news');
        expect(group).toBeDefined();
        expect(group?.commands.map((command) => command.name()).sort()).toEqual([
            'generate-bundle',
            'generate-cards',
            'generate-check',
            'generate-render',
            'generate-voice',
            'prepare',
            'report',
        ]);
        // The bundle verb is the one whose stage decides between variants and a frozen bundle.
        const bundle = group?.commands.find((command) => command.name() === 'generate-bundle');
        expect(bundle?.options.map((option) => option.long)).toContain('--stage');
    });

    test('a caller-owned noun and default type are honoured (the article verb reuses the same table)', () => {
        const program = new Command();
        registerContentGenerateCommand(program, 'article', 'article');
        expect(program.commands.map((command) => command.name())).toEqual(['article']);
    });
});

describe('itemCount', () => {
    test('a bare Doc[] is counted by length', () => {
        expect(itemCount([{ title: 'a' }, { title: 'b' }])).toBe(2);
        expect(itemCount([])).toBe(0);
    });

    test('an object payload counts metadata.docs, never its other keys', () => {
        expect(itemCount({ metadata: { docs: [{}, {}, {}] }, docs: 'not-a-list' })).toBe(3);
        expect(itemCount({ metadata: { docs: [] } })).toBe(0);
    });

    test('shapes that cannot be a doc list count zero rather than guessing', () => {
        // 0374's lesson: an object without metadata.docs is not a pool, and a bare array is not an
        // envelope — each caller reads the shape it expects through the reader it names.
        for (const value of [null, undefined, 42, 'doc', { metadata: 'nope' }, { metadata: { docs: {} } }]) {
            expect(itemCount(value)).toBe(0);
        }
    });
});

describe('resolveNewsSettings', () => {
    test('absent blocks fall back to the documented defaults', () => {
        const settings = resolveNewsSettings({});
        expect(settings.plan_max_items).toBeGreaterThan(0);
        expect(resolveNewsSettings({ workflows: 'not-a-map' })).toEqual(settings);
        expect(resolveNewsSettings({ workflows: { 'kk-news-generate': 'not-a-map' } })).toEqual(settings);
    });

    test('declared keys of the right type override the default', () => {
        const settings = resolveNewsSettings({
            workflows: { 'kk-news-generate': { plan_max_items: 40, episode_min_minutes: 4 } },
        });
        expect(settings.plan_max_items).toBe(40);
        expect(settings.episode_min_minutes).toBe(4);
    });

    test('an undeclared key, a non-positive number, and a wrong-typed value each refuse loudly', () => {
        const cases: Array<Record<string, unknown>> = [
            { not_a_setting: 1 },
            { plan_max_items: 0 },
            { plan_max_items: '40' },
            { episode_min_minutes: Number.POSITIVE_INFINITY },
        ];
        for (const block of cases) {
            expect(() => resolveNewsSettings({ workflows: { 'kk-news-generate': block } })).toThrow();
        }
    });
});

describe('selectedCountOf — the store route stdout is the only selection evidence', () => {
    test('reads the last JSON line the route printed', () => {
        expect(selectedCountOf('{"selected":7}')).toBe(7);
        // The route narrates before its one JSON object, so the LAST line is the payload.
        expect(selectedCountOf('extract: 40 items\n{"selected":3}\n')).toBe(3);
    });

    test('a shape-less or unreadable payload counts zero, never NaN', () => {
        for (const stdout of [undefined, '', 'no json here', '{"selected":"7"}', '{"other":1}', '[1,2,3]']) {
            expect(selectedCountOf(stdout)).toBe(0);
        }
    });
});
