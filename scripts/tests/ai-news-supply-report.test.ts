/**
 * Task 0337 R4 — failure-first subprocess contract for the read-only AI-news supply report.
 *
 * Failures enumerated before implementation:
 *  1. Inspection opens a writer/migrator and changes the store it is meant to diagnose.
 *  2. Gate counts drift from labelsCurrentSql or ItemsDao.selectByProfile semantics.
 *  3. Replayed, stale, low-confidence or losing-maker observations become current answers.
 *  4. Shared stories, repeated selections or null story ids are double counted.
 *  5. A profile cap is reported as total eligible supply, or either window uses the wrong bound.
 *  6. Bad flags, timestamps, config, profile or schema fail silently or create partial output.
 */

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { compileProfile, openStore, parseProfile, readStoreConfig } = await import(
    Bun.resolveSync('@gobing-ai/kk-store', resolve(import.meta.dir, '../../packages/kk-store'))
);

const SCRIPT = resolve(import.meta.dir, '../ai-news-supply-report.ts');
const AT = '2026-11-03T12:00:00.000Z';
const NOW = Date.parse(AT);
const HOUR = 3_600_000;
const REPEAT_COMMAND = 'bun test scripts/tests/ai-news-supply-report.test.ts';
const PROFILE_YAML = `topic: ai-news
where:
  kk-item-category: { in: [ai-news, ai-industry, ai-technical, ai-research] }
  kk-item-quality: { gte: 2 }
  kk-item-importance: { gte: 2 }
  kk-item-china-politics: { lte: 1 }
order: [kk-item-urgency desc, kk-item-impact desc, first_seen_at desc]
limit: 2
`;
const CONFIG_YAML = `store:
  labels:
    priority: ['*', heuristic]
    min_confidence: 0.8
    decisions:
      kk-item-china-politics:
        priority: [keyword, '*', heuristic]
`;

interface Fixture {
    dir: string;
    dbPath: string;
    configPath: string;
    profilePath: string;
}

interface ItemInput {
    id: string;
    ageHours: number;
    storyId?: string | null;
    source?: string;
    bodyLength?: number;
    urgency?: number;
}

let fixture: Fixture;

function runReport(args: readonly string[], timeout = 120_000) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: resolve(import.meta.dir, '../..'),
        encoding: 'utf-8',
        timeout,
        maxBuffer: 1024 * 1024,
    });
}

function validArgs(overrides: Partial<Fixture> = {}): string[] {
    return [
        '--db',
        overrides.dbPath ?? fixture.dbPath,
        '--config',
        overrides.configPath ?? fixture.configPath,
        '--profile',
        overrides.profilePath ?? fixture.profilePath,
        '--at',
        AT,
    ];
}

function parseSuccess(args = validArgs()) {
    const result = runReport(args);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    return JSON.parse(result.stdout) as {
        version: number;
        at: string;
        windows: Array<{
            hours: number;
            gates: Array<{
                name: string;
                items: number;
                stories: number;
                nullStoryItems: number;
                removedItems: number;
            }>;
            cappedItemIds: string[];
            sources: Array<{
                source: string;
                items: number;
                bodyBuckets: Record<string, number>;
                qualityMakers: Record<string, number>;
            }>;
            labelCoverage: Record<string, { current: number; staleOnly: number; missing: number }>;
            blockedStories: { published: number; selectedOnly: number };
        }>;
    };
}

function gate(report: ReturnType<typeof parseSuccess>, hours: number, name: string) {
    const window = report.windows.find((candidate) => candidate.hours === hours);
    const row = window?.gates.find((candidate) => candidate.name === name);
    if (row === undefined) throw new Error(`missing gate ${hours}/${name}`);
    return row;
}

function insertItem(db: Database, input: ItemInput): void {
    const storyId = input.storyId === undefined ? `story-${input.id}` : input.storyId;
    db.run(
        `INSERT INTO items
         (id, content_hash, title, body, source, metadata_json, first_seen_run, last_seen_run,
          first_seen_at, created_at, updated_at, story_id)
         VALUES (?, ?, ?, ?, ?, '{}', 'fixture', 'fixture', ?, ?, ?, ?)`,
        [
            input.id,
            `hash-${input.id}`,
            input.id,
            'x'.repeat(input.bodyLength ?? 400),
            input.source ?? 'rss',
            NOW - input.ageHours * HOUR,
            NOW,
            NOW,
            storyId,
        ],
    );
}

function insertLabel(
    db: Database,
    itemId: string,
    decisionId: string,
    value: string,
    options: {
        maker?: string;
        source?: 'model' | 'heuristic' | 'default';
        runId?: string;
        rawConfidence?: number | null;
        contentHash?: string;
        labeledAt?: number;
    } = {},
): void {
    db.run(
        `INSERT INTO labels
         (item_id, decision_id, value, score, maker, source, confidence, run_id, labeled_at,
          raw_confidence, content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'HIGH', ?, ?, ?, ?, ?, ?)`,
        [
            itemId,
            decisionId,
            value,
            /^\d+$/.test(value) ? Number(value) : null,
            options.maker ?? 'heuristic',
            options.source ?? 'heuristic',
            options.runId ?? 'fixture-labels',
            options.labeledAt ?? 100,
            options.rawConfidence ?? null,
            options.contentHash ?? `hash-${itemId}`,
            NOW,
            NOW,
        ],
    );
}

function insertBaseLabels(db: Database, item: ItemInput, skipQuality = false): void {
    insertLabel(db, item.id, 'kk-item-category', 'ai-news');
    if (!skipQuality) insertLabel(db, item.id, 'kk-item-quality', '2');
    insertLabel(db, item.id, 'kk-item-importance', '2');
    insertLabel(db, item.id, 'kk-item-china-politics', '0');
    insertLabel(db, item.id, 'kk-item-urgency', String(item.urgency ?? 1));
    insertLabel(db, item.id, 'kk-item-impact', '1');
}

function replaceLabel(db: Database, itemId: string, decisionId: string, value: string): void {
    db.run('DELETE FROM labels WHERE item_id = ? AND decision_id = ?', [itemId, decisionId]);
    insertLabel(db, itemId, decisionId, value);
}

function insertSelection(
    db: Database,
    itemId: string,
    storyId: string,
    status: 'selected' | 'published' | 'dropped',
    runId: string,
    topic = 'ai-news',
): void {
    db.run(
        `INSERT INTO selections
         (topic, item_id, run_id, story_id, status, selected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [topic, itemId, runId, storyId, status, NOW, NOW, NOW],
    );
}

async function createFixture(): Promise<Fixture> {
    const dir = join(tmpdir(), `kk-supply-report-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'fixture.db');
    const configPath = join(dir, 'config.yaml');
    const profilePath = join(dir, 'profile.yaml');
    writeFileSync(configPath, CONFIG_YAML);
    writeFileSync(profilePath, PROFILE_YAML);
    const store = await openStore({ path: dbPath });
    await store.close();

    const db = new Database(dbPath);
    const items: ItemInput[] = [
        { id: 'a', ageHours: 1, storyId: 'story-a', bodyLength: 100, urgency: 5 },
        { id: 'a2', ageHours: 2, storyId: 'story-a', bodyLength: 400, urgency: 4 },
        { id: 'b', ageHours: 2, storyId: 'story-b', bodyLength: 500 },
        { id: 'c', ageHours: 3, storyId: 'story-c', source: 'aihot', bodyLength: 1600 },
        { id: 'd', ageHours: 4, storyId: 'story-d', bodyLength: 300, urgency: 3 },
        { id: 'bad-category', ageHours: 5 },
        { id: 'bad-quality', ageHours: 5 },
        { id: 'bad-importance', ageHours: 5 },
        { id: 'bad-moderation', ageHours: 5 },
        { id: 'missing-quality', ageHours: 5 },
        { id: 'stale-quality', ageHours: 5 },
        { id: 'policy-rejected', ageHours: 5 },
        { id: 'null-story', ageHours: 6, storyId: null, bodyLength: 200, urgency: 2 },
        { id: 'e', ageHours: 30, storyId: 'story-e', source: 'web', bodyLength: 299, urgency: 1 },
        { id: 'expired', ageHours: 169, bodyLength: 400 },
        { id: 'boundary-24', ageHours: 24, storyId: 'story-boundary-24', urgency: 0 },
        { id: 'boundary-168', ageHours: 168, storyId: 'story-boundary-168', urgency: 0 },
    ];
    for (const item of items) {
        insertItem(db, item);
        insertBaseLabels(
            db,
            item,
            item.id === 'missing-quality' || item.id === 'stale-quality' || item.id === 'policy-rejected',
        );
    }
    replaceLabel(db, 'bad-category', 'kk-item-category', 'other');
    replaceLabel(db, 'bad-quality', 'kk-item-quality', '1');
    replaceLabel(db, 'bad-importance', 'kk-item-importance', '1');
    replaceLabel(db, 'bad-moderation', 'kk-item-china-politics', '2');

    // A named model beats the wildcard; the keyword decision override beats a rejecting model answer.
    insertLabel(db, 'a', 'kk-item-quality', '4', { maker: 'model', source: 'model', rawConfidence: 0.95 });
    insertLabel(db, 'a', 'kk-item-china-politics', '3', { maker: 'model', source: 'model', rawConfidence: 0.95 });
    insertLabel(db, 'a', 'kk-item-china-politics', '0', { maker: 'keyword' });
    // A replay maker admitted only by '*' is not current; a wildcard alone cannot admit replay output.
    insertLabel(db, 'a2', 'kk-item-quality', '5', {
        maker: 'replay-maker',
        source: 'model',
        runId: 'replay-1',
        rawConfidence: 1,
    });
    // Repeated observations do not create items; latest current observation wins.
    insertLabel(db, 'd', 'kk-item-quality', '1', { runId: 'older', labeledAt: 50 });
    insertLabel(db, 'd', 'kk-item-quality', '3', { runId: 'newer', labeledAt: 200 });
    insertLabel(db, 'stale-quality', 'kk-item-quality', '5', { contentHash: 'stale-hash' });
    insertLabel(db, 'policy-rejected', 'kk-item-quality', '5', {
        maker: 'model',
        source: 'model',
        rawConfidence: 0.5,
    });

    insertSelection(db, 'b', 'story-b', 'selected', 'run-b1');
    insertSelection(db, 'b', 'story-b', 'selected', 'run-b2');
    insertSelection(db, 'c', 'story-c', 'published', 'run-c1');
    insertSelection(db, 'c', 'story-c', 'selected', 'run-c2');
    insertSelection(db, 'd', 'story-d', 'dropped', 'run-d1');
    insertSelection(db, 'e', 'story-e', 'selected', 'run-e1', 'other-topic');
    db.close();
    return { dir, dbPath, configPath, profilePath };
}

beforeAll(async () => {
    fixture = await createFixture();
});

afterAll(() => {
    rmSync(fixture.dir, { recursive: true, force: true });
});

describe('ai-news supply report (0337)', () => {
    it('preserves the fixture bytes/schema and emits deterministic policy-correct windows', async () => {
        const bytesBefore = readFileSync(fixture.dbPath);
        const schemaBefore = new Database(fixture.dbPath, { readonly: true })
            .query('SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name')
            .all();
        const first = parseSuccess();
        const second = parseSuccess();
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(first.version).toBe(1);
        expect(first.at).toBe(AT);
        expect(readFileSync(fixture.dbPath)).toEqual(bytesBefore);
        const schemaDb = new Database(fixture.dbPath, { readonly: true });
        expect(schemaDb.query('SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name').all()).toEqual(
            schemaBefore,
        );
        schemaDb.close();

        const expected = {
            24: [
                ['seen', 14, 12, 1, 0],
                ['category', 13, 11, 1, 1],
                ['quality', 9, 7, 1, 4],
                ['importance', 8, 6, 1, 1],
                ['moderation', 7, 5, 1, 1],
                ['reservationExclusion', 5, 3, 1, 2],
                ['cap', 2, 1, 0, 3],
            ],
            168: [
                ['seen', 16, 14, 1, 0],
                ['category', 15, 13, 1, 1],
                ['quality', 11, 9, 1, 4],
                ['importance', 10, 8, 1, 1],
                ['moderation', 9, 7, 1, 1],
                ['reservationExclusion', 7, 5, 1, 2],
                ['cap', 2, 1, 0, 5],
            ],
        } as const;
        for (const hours of [24, 168] as const) {
            for (const [name, items, stories, nullStoryItems, removedItems] of expected[hours]) {
                expect(gate(first, hours, name)).toEqual({ name, items, stories, nullStoryItems, removedItems });
            }
            const window = first.windows.find((candidate) => candidate.hours === hours);
            expect(window?.cappedItemIds).toEqual(['a', 'a2']);
            expect(window?.blockedStories).toEqual({ published: 1, selectedOnly: 1 });
            expect(window?.labelCoverage['kk-item-quality']).toEqual({
                current: hours === 24 ? 11 : 13,
                staleOnly: 1,
                missing: 2,
            });
            expect((window?.sources ?? []).reduce((sum, row) => sum + row.items, 0)).toBe(hours === 24 ? 14 : 16);
            const rss = window?.sources.find((row) => row.source === 'rss');
            expect(rss?.qualityMakers.model).toBe(1);
            expect(
                (window?.sources ?? []).reduce(
                    (sum, row) => sum + Object.values(row.bodyBuckets).reduce((inner, count) => inner + count, 0),
                    0,
                ),
            ).toBe(hours === 24 ? 14 : 16);
        }

        const store = await openStore({ path: fixture.dbPath, migrate: false });
        try {
            const profile = parseProfile(PROFILE_YAML);
            const policy = (await readStoreConfig(fixture.configPath)).labels;
            for (const hours of [24, 168]) {
                const docs = await store.items.selectByProfile(
                    compileProfile(profile, { now: NOW, windowMs: hours * HOUR, excludeTopic: 'ai-news' }),
                    policy,
                );
                expect(first.windows.find((window) => window.hours === hours)?.cappedItemIds).toEqual(
                    docs.map((doc) => doc.id),
                );
            }
        } finally {
            await store.close();
        }

        mkdirSync('.spur/run', { recursive: true });
        writeFileSync(
            '.spur/run/0337-supply-fixture.json',
            `${JSON.stringify(
                {
                    version: 1,
                    repeatCommand: REPEAT_COMMAND,
                    checks: [
                        'readonly-bytes-and-schema',
                        'deterministic-output',
                        'label-priority-confidence-hash-replay',
                        'gate-attrition-and-window-boundaries',
                        'reservation-and-null-story-counts',
                        'dao-capped-item-parity',
                    ],
                    windows: first.windows.map((window) => ({ hours: window.hours, gates: window.gates })),
                },
                null,
                2,
            )}\n`,
        );
    });

    it('fails nonzero without partial JSON or creating a missing database', () => {
        const missingDb = join(fixture.dir, 'absent.db');
        const cases: Array<{ name: string; args: string[]; error: string }> = [
            { name: 'missing-db', args: validArgs({ dbPath: missingDb }), error: 'database' },
            { name: 'invalid-at', args: [...validArgs().slice(0, -1), 'not-a-date'], error: '--at' },
            {
                name: 'missing-config',
                args: validArgs({ configPath: join(fixture.dir, 'absent.yaml') }),
                error: 'config',
            },
            { name: 'unknown-flag', args: [...validArgs(), '--topic', 'other'], error: 'unknown' },
            { name: 'duplicate-flag', args: [...validArgs(), '--at', AT], error: 'duplicate' },
            { name: 'missing-flag', args: validArgs().slice(2), error: 'missing' },
            { name: 'zero-hours', args: [...validArgs(), '--hours', '0'], error: '--hours' },
            { name: 'non-integer-hours', args: [...validArgs(), '--hours', '24,3d'], error: '--hours' },
            { name: 'repeated-hours', args: [...validArgs(), '--hours', '72,72'], error: '--hours' },
        ];
        for (const testCase of cases) {
            const result = runReport(testCase.args);
            expect(result.status, testCase.name).not.toBe(0);
            expect(result.stdout, testCase.name).toBe('');
            expect(result.stderr.toLowerCase(), testCase.name).toContain(testCase.error);
        }
        expect(existsSync(missingDb)).toBe(false);

        const invalidConfig = join(fixture.dir, 'invalid-config.yaml');
        writeFileSync(invalidConfig, 'store:\n  labels:\n    min_confidence: 2\n');
        expect(runReport(validArgs({ configPath: invalidConfig })).status).not.toBe(0);
        const malformedConfig = join(fixture.dir, 'malformed-config.yaml');
        writeFileSync(malformedConfig, 'store: [\n');
        const malformedResult = runReport(validArgs({ configPath: malformedConfig }));
        expect(malformedResult.status).not.toBe(0);
        expect(malformedResult.stdout).toBe('');
        expect(malformedResult.stderr.toLowerCase()).toContain('config');
        const malformedProfile = join(fixture.dir, 'bad-profile.yaml');
        writeFileSync(malformedProfile, 'topic: [ai-news\n');
        expect(runReport(validArgs({ profilePath: malformedProfile })).status).not.toBe(0);
        const wrongTopic = join(fixture.dir, 'wrong-topic.yaml');
        writeFileSync(wrongTopic, PROFILE_YAML.replace('topic: ai-news', 'topic: other'));
        expect(runReport(validArgs({ profilePath: wrongTopic })).status).not.toBe(0);
        const extraPredicate = join(fixture.dir, 'extra-predicate.yaml');
        writeFileSync(extraPredicate, PROFILE_YAML.replace('order:', '  kk-item-sensitivity: { lte: 1 }\norder:'));
        const unsupported = runReport(validArgs({ profilePath: extraPredicate }));
        expect(unsupported.status).not.toBe(0);
        expect(unsupported.stderr).toContain('profile');

        const schemaPath = join(fixture.dir, 'missing-schema.db');
        const schemaDb = new Database(schemaPath);
        schemaDb.run('CREATE TABLE items (id TEXT)');
        schemaDb.close();
        const missingSchema = runReport(validArgs({ dbPath: schemaPath }));
        expect(missingSchema.status).not.toBe(0);
        expect(missingSchema.stdout).toBe('');
        expect(missingSchema.stderr.toLowerCase()).toContain('schema');
        expect(runReport(validArgs({ dbPath: fixture.dir })).status).not.toBe(0);
    });

    it('reports the production 72h extract window by default and honors an explicit --hours list', () => {
        // voice3 is scheduled with `--window 72h` (design §8): a diagnostic without that window
        // cannot explain a production no-content close.
        expect(parseSuccess().windows.map((window) => window.hours)).toEqual([24, 72, 168]);
        const only72 = parseSuccess([...validArgs(), '--hours', '72']);
        expect(only72.windows.map((window) => window.hours)).toEqual([72]);
        const all = parseSuccess();
        expect(JSON.stringify(only72.windows[0])).toBe(
            JSON.stringify(all.windows.find((window) => window.hours === 72)),
        );
    });

    it('names each gate by its decision, not by the profile key order', () => {
        const reordered = join(fixture.dir, 'reordered-profile.yaml');
        const lines = PROFILE_YAML.split('\n');
        // Swap category (removes 1) with quality (removes 4); the ladder must still run category first.
        [lines[2], lines[3]] = [lines[3] as string, lines[2] as string];
        writeFileSync(reordered, lines.join('\n'));
        const base = parseSuccess();
        const swapped = parseSuccess(validArgs({ profilePath: reordered }));
        expect(swapped.windows.map((window) => window.gates)).toEqual(base.windows.map((window) => window.gates));
    });
});
