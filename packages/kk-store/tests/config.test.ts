import { describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
    CHINA_POLITICS_DECISION_ID,
    DEFAULT_CHINA_POLITICS_DECISION_PRIORITY,
    DEFAULT_CHINA_POLITICS_TERMS,
    DEFAULT_LABEL_PRIORITY,
    DEFAULT_MIN_CONFIDENCE,
    DEFAULT_STORY_THRESHOLD,
    DEFAULT_STORY_WINDOW_HOURS,
    readStoreConfig,
    resolveStorePath,
    StoreConfigInvalidError,
} from '../src/index';
import { makeTempDir } from './helpers';

describe('resolveStorePath', () => {
    it('defaults to .works/kk.db under the cwd and creates the parent dir', async () => {
        const dir = makeTempDir();
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            expect(await resolveStorePath()).toBe(join(dir, '.works/kk.db'));
            expect(existsSync(join(dir, '.works'))).toBe(true);
        } finally {
            process.chdir(cwd);
        }
    });

    it('reads store.db_path and resolves a relative path against the cwd', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, 'works_dir: /tmp/works\nstore:\n  db_path: data/kk.db\n');
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            expect(await resolveStorePath(configFile)).toBe(join(dir, 'data/kk.db'));
            expect(existsSync(join(dir, 'data'))).toBe(true);
        } finally {
            process.chdir(cwd);
        }
    });

    it('lets an explicit path win over the config (kk store migrate --db)', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, 'store:\n  db_path: from-config.db\n');
        const explicit = join(dir, 'nested/explicit.db');

        expect(await resolveStorePath(configFile, explicit)).toBe(explicit);
        expect(existsSync(join(dir, 'nested'))).toBe(true);
    });

    it('expands a leading ~ against the home dir', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');

        // Neither form creates anything under the real home: `~` is an existing dir, and
        // `~/kk.db`'s parent is the home dir itself, so the ensureDir is a no-op.
        writeFileSync(configFile, 'store:\n  db_path: "~"\n');
        expect(await resolveStorePath(configFile)).toBe(homedir());

        writeFileSync(configFile, 'store:\n  db_path: ~/kk.db\n');
        expect(await resolveStorePath(configFile)).toBe(join(homedir(), 'kk.db'));
    });

    it('falls back to the default for every unusable config shape', async () => {
        const dir = makeTempDir();
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            const expected = join(dir, '.works/kk.db');

            expect(await resolveStorePath(join(dir, 'absent.yaml'))).toBe(expected);

            const blank = join(dir, 'blank.yaml');
            writeFileSync(blank, 'store:\n  db_path: "   "\n');
            expect(await resolveStorePath(blank)).toBe(expected);

            const wrongType = join(dir, 'wrong-type.yaml');
            writeFileSync(wrongType, 'store:\n  db_path: 42\n');
            expect(await resolveStorePath(wrongType)).toBe(expected);

            const notAMap = join(dir, 'not-a-map.yaml');
            writeFileSync(notAMap, 'store: 7\n');
            expect(await resolveStorePath(notAMap)).toBe(expected);

            const brokenYaml = join(dir, 'broken.yaml');
            writeFileSync(brokenYaml, 'store: [unclosed\n');
            expect(await resolveStorePath(brokenYaml)).toBe(expected);

            // A directory is `exists` but not readable as a file.
            expect(await resolveStorePath(dir)).toBe(expected);
        } finally {
            process.chdir(cwd);
        }
    });
});

/**
 * `readStoreConfig` — the ONE kk config reader (task 0226 R3).
 *
 * ## Failure-first list — written before the code
 *
 * 1. A missing, unreadable, unparseable or non-mapping config throws instead of yielding defaults —
 *    the store and the label policy must work on a zero-config machine.
 * 2. `store.labels.min_confidence` is out of [0, 1], or not a number at all, and is silently
 *    defaulted: a wrong threshold silently re-ranks which label is current.
 * 3. `store.labels.priority` is not a non-empty string array and is silently defaulted or ignored.
 * 4. `store.labels.decisions.<id>.priority` is dropped, so a per-decision override never applies.
 * 5. The failing key is not named in the error, so the operator cannot find the typo.
 * 6. `resolveStorePath` (reimplemented on top) loses `store.db_path` handling.
 * 7. `store.story.threshold` is outside `(0, 1]` (or not a number) and is silently defaulted — a
 *    wrong threshold merges unrelated titles or splits a story (0227 R3).
 * 8. `store.story.window_hours` is not a positive integer and is silently defaulted (0227 R3).
 * 9. `store.labels.china_politics_terms` is silently defaulted when present but malformed, or the
 *    per-decision china-politics priority default is lost, so the R4 keyword floor never holds (0229).
 */
describe('readStoreConfig', () => {
    /** Write a config document into a fresh temp dir and return its path. */
    function configWith(dir: string, yaml: string, name = 'config.yaml'): string {
        const path = join(dir, name);
        writeFileSync(path, yaml);
        return path;
    }

    it('yields the defaults for every unusable config shape', async () => {
        const dir = makeTempDir();
        // 0229 R4: the china-politics priority default and the prefilter terms are part of the
        // zero-config view — the keyword floor must hold without an operator config.
        const expected = {
            labels: {
                priority: [...DEFAULT_LABEL_PRIORITY],
                decisionPriority: {
                    [CHINA_POLITICS_DECISION_ID]: [...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY],
                },
                minConfidence: DEFAULT_MIN_CONFIDENCE,
                chinaPoliticsTerms: [...DEFAULT_CHINA_POLITICS_TERMS],
            },
            story: { threshold: DEFAULT_STORY_THRESHOLD, windowHours: DEFAULT_STORY_WINDOW_HOURS },
        };

        expect(await readStoreConfig(undefined)).toEqual(expected);
        expect(await readStoreConfig(join(dir, 'absent.yaml'))).toEqual(expected);
        expect(await readStoreConfig(dir)).toEqual(expected);
        for (const [name, yaml] of [
            ['blank.yaml', ''],
            ['broken.yaml', 'store: [unclosed\n'],
            ['no-store.yaml', 'works_dir: /tmp/works\n'],
            ['store-not-a-map.yaml', 'store: 7\n'],
        ] as const) {
            expect(await readStoreConfig(configWith(dir, yaml, name))).toEqual(expected);
        }
    });

    it('reads store.db_path, the priority list and the threshold', async () => {
        const dir = makeTempDir();
        const path = configWith(
            dir,
            [
                'store:',
                '  db_path: data/kk.db',
                '  labels:',
                '    priority: [fm-local, heuristic]',
                '    min_confidence: 0.5',
                '    decisions:',
                '      kk-item-category:',
                '        priority: [heuristic]',
                '  story:',
                '    threshold: 0.5',
                '    window_hours: 24',
                '',
            ].join('\n'),
        );

        expect(await readStoreConfig(path)).toEqual({
            dbPath: 'data/kk.db',
            labels: {
                priority: ['fm-local', 'heuristic'],
                // The operator named only the category override; china-politics still defaults (R4).
                decisionPriority: {
                    'kk-item-category': ['heuristic'],
                    [CHINA_POLITICS_DECISION_ID]: [...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY],
                },
                minConfidence: 0.5,
                chinaPoliticsTerms: [...DEFAULT_CHINA_POLITICS_TERMS],
            },
            story: { threshold: 0.5, windowHours: 24 },
        });
    });

    it('defaults a story key left unset but reads the story block', async () => {
        const dir = makeTempDir();
        const path = configWith(dir, 'store:\n  story:\n    threshold: 0.75\n');
        expect(await readStoreConfig(path)).toEqual({
            labels: {
                priority: [...DEFAULT_LABEL_PRIORITY],
                decisionPriority: {
                    [CHINA_POLITICS_DECISION_ID]: [...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY],
                },
                minConfidence: DEFAULT_MIN_CONFIDENCE,
                chinaPoliticsTerms: [...DEFAULT_CHINA_POLITICS_TERMS],
            },
            story: { threshold: 0.75, windowHours: DEFAULT_STORY_WINDOW_HOURS },
        });
    });

    it('reads the china-politics terms and lets an operator override the floor priority (0229 R4)', async () => {
        const dir = makeTempDir();
        const path = configWith(
            dir,
            [
                'store:',
                '  labels:',
                '    china_politics_terms: [习近平, 政治局常委, Xi Jinping]',
                '    decisions:',
                '      kk-item-china-politics:',
                '        priority: [keyword, fm-local]',
                '',
            ].join('\n'),
        );

        const config = await readStoreConfig(path);
        expect(config.labels.chinaPoliticsTerms).toEqual(['习近平', '政治局常委', 'Xi Jinping']);
        // An explicit per-decision priority REPLACES the default floor ordering.
        expect(config.labels.decisionPriority[CHINA_POLITICS_DECISION_ID]).toEqual(['keyword', 'fm-local']);
    });

    it('defaults the china-politics floor to keyword-first, and never lists a generic China term (0229 R4)', async () => {
        const config = await readStoreConfig(undefined);
        expect(config.labels.decisionPriority[CHINA_POLITICS_DECISION_ID]).toEqual([
            ...DEFAULT_CHINA_POLITICS_DECISION_PRIORITY,
        ]);
        expect(DEFAULT_CHINA_POLITICS_DECISION_PRIORITY[0]).toBe('keyword');
        // A generic term would exclude China-related content by accident (D3a). The built-in list
        // is top-leader / central-institution only.
        for (const generic of ['中国', 'China', 'Beijing', '北京', 'Chinese']) {
            expect(DEFAULT_CHINA_POLITICS_TERMS).not.toContain(generic);
        }
        expect(DEFAULT_CHINA_POLITICS_TERMS).toContain('习近平');
        expect(DEFAULT_CHINA_POLITICS_TERMS).toContain('Xi Jinping');
    });

    it('fails loud, naming the key, for a present key of the wrong type or range', async () => {
        const dir = makeTempDir();
        const cases: readonly [string, string][] = [
            ['store.labels.priority', 'store:\n  labels:\n    priority: heuristic\n'],
            ['store.labels.priority', 'store:\n  labels:\n    priority: []\n'],
            ['store.labels.priority', 'store:\n  labels:\n    priority: [1]\n'],
            ['store.labels.priority', 'store:\n  labels:\n    priority: [""]\n'],
            ['store.labels.min_confidence', 'store:\n  labels:\n    min_confidence: 1.5\n'],
            ['store.labels.min_confidence', 'store:\n  labels:\n    min_confidence: -0.1\n'],
            ['store.labels.min_confidence', 'store:\n  labels:\n    min_confidence: "0.8"\n'],
            ['store.labels', 'store:\n  labels: 7\n'],
            ['store.labels.decisions', 'store:\n  labels:\n    decisions: []\n'],
            [
                'store.labels.decisions.kk-item-category.priority',
                'store:\n  labels:\n    decisions:\n      kk-item-category: [heuristic]\n',
            ],
            ['store.story', 'store:\n  story: 7\n'],
            ['store.story.threshold', 'store:\n  story:\n    threshold: 0\n'],
            ['store.story.threshold', 'store:\n  story:\n    threshold: 1.5\n'],
            ['store.story.threshold', 'store:\n  story:\n    threshold: "0.6"\n'],
            ['store.story.window_hours', 'store:\n  story:\n    window_hours: 0\n'],
            ['store.story.window_hours', 'store:\n  story:\n    window_hours: -1\n'],
            ['store.story.window_hours', 'store:\n  story:\n    window_hours: 1.5\n'],
            ['store.story.window_hours', 'store:\n  story:\n    window_hours: "72"\n'],
            ['store.labels.china_politics_terms', 'store:\n  labels:\n    china_politics_terms: 习近平\n'],
            ['store.labels.china_politics_terms', 'store:\n  labels:\n    china_politics_terms: []\n'],
            ['store.labels.china_politics_terms', 'store:\n  labels:\n    china_politics_terms: [""]\n'],
            ['store.labels.china_politics_terms', 'store:\n  labels:\n    china_politics_terms: [3]\n'],
        ];

        for (const [key, yaml] of cases) {
            const path = configWith(dir, yaml, 'invalid.yaml');
            const failure = await readStoreConfig(path).then(
                () => undefined,
                (error: unknown) => error,
            );
            expect(failure, yaml).toBeInstanceOf(StoreConfigInvalidError);
            expect((failure as Error).message, yaml).toContain(key);
        }
    });
});
