/**
 * Task 0209 — `kk store label`: heuristic-first item labelling E2E.
 *
 * Failure-first list (written before the implementation):
 *  1. `--new-ids` missing, unreadable or not a JSON string array → exit 1 with
 *     `kk.store.label.failed`, no `labels` row written (R4).
 *  2. An item the heuristic classifies confidently → heuristic rows only, `spur decision run`
 *     never spawned (R5, the cost contract).
 *  3. An item the heuristic files `non-ai` while seeing an AI keyword → routed to the
 *     catalog in heuristic mode (R5).
 *  4. `--mode decision` → every listed item routed, five decisions each (R5).
 *  5. A decision answered `source: default` (backend down, `reason: no-backend`) → the row
 *     keeps the HEURISTIC value and records `source: default` (R6/AC2).
 *  6. The `spur` binary cannot be spawned at all → same degraded rows, exit 0 (R6).
 *  7. A model value outside the decision's vocabulary (`ai-magic` for the choice, `9` for a
 *     0–5 score) → the heuristic value with `source: default`, never a poisoned row (R4/R6).
 *  8. An id listed in `--new-ids` that the store does not hold → skipped, no crash (R4).
 *  9. A second pass over the same ids → still one row per (item, decision), updated in place
 *     (R4; the DAO's upsert identity).
 * 10. `--mode` outside `heuristic|decision` → caller mistake, exit 1 (R4).
 * 11. A written row drops the decision's `confidence` or the `--run` value → the store cannot
 *     report per-decision reliability or trace a label back to its collect run (R4).
 *
 * Everything runs against a temp dir + temp DB and a stubbed `spur` (`KK_SPUR_BIN`), so no
 * network, model or operator store is touched. The labels table dump is copied to
 * `.works/test-artifacts/0209/`.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const ARTIFACT_DIR = join(REPO, '.works/test-artifacts/0209');

const tempDirs: string[] = [];

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-store-label-')));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.KK_SPUR_BIN;
    delete process.env.KK_CONFIG;
});

/** Run `kk …` in-process, returning the exit code plus the captured echo/echoError output. */
async function run(
    args: string[],
    env: { KK_SPUR_BIN?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    const previous = process.env.KK_SPUR_BIN;
    if (env.KK_SPUR_BIN !== undefined) {
        process.env.KK_SPUR_BIN = env.KK_SPUR_BIN;
    }
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
        if (previous === undefined) {
            delete process.env.KK_SPUR_BIN;
        } else {
            process.env.KK_SPUR_BIN = previous;
        }
    }
}

/** The five catalog decision ids, in the order `kk store label` labels them. */
const DECISION_IDS = [
    'kk-item-category',
    'kk-item-quality',
    'kk-item-importance',
    'kk-item-urgency',
    'kk-item-impact',
] as const;

/** An accepted model answer per decision — the choice as a label, the four scores as levels 0–5. */
function acceptedAnswers(category: string, levels: [number, number, number, number]): Record<string, unknown> {
    const meta = { confidence: 0.95, source: 'model', reason: 'accepted', maker: 'fm-local' };
    return {
        'kk-item-category': { ...meta, value: category },
        'kk-item-quality': { ...meta, value: levels[0] },
        'kk-item-importance': { ...meta, value: levels[1] },
        'kk-item-urgency': { ...meta, value: levels[2] },
        'kk-item-impact': { ...meta, value: levels[3] },
    };
}

/**
 * Write an executable `spur` stub that appends the decision id it was asked for to
 * `<dir>/spawns.log` and answers from `<dir>/decision-<id>.json` when that file exists.
 * No answer file → exit 1, which is the "spawn answered nothing" degradation path.
 *
 * `answers` maps a decision id (or `*` for every id) to the JSON payload to print.
 */
function stubSpur(dir: string, answers: Record<string, unknown>): string {
    const lines = [
        '#!/bin/sh',
        '# $1=decision $2=run $3=<decision id>',
        `printf "%s\\n" "$3" >> "${join(dir, 'spawns.log')}"`,
    ];
    for (const id of DECISION_IDS) {
        const payload = answers[id] ?? answers['*'];
        if (payload !== undefined) {
            lines.push(`if [ "$3" = "${id}" ]; then`);
            lines.push(`  printf '%s\\n' '${JSON.stringify(payload)}'`);
            lines.push('  exit 0');
            lines.push('fi');
        }
    }
    lines.push('echo "no stub answer for $3" >&2', 'exit 1');
    const stub = join(dir, 'spur-stub.sh');
    writeFileSync(stub, `${lines.join('\n')}\n`);
    chmodSync(stub, 0o755);
    return stub;
}

/** One Doc for the store: identity is content-addressed (`itemId` of the canonical URL). */
function doc(url: string, title: string, body: string, metadata: Record<string, unknown>): Doc {
    return { id: url, title, body, sourceUri: `https://example.com/${url}`, metadata };
}

/** Store one `Doc[]` run and return its item ids plus the `--new-ids` path. */
async function seed(dir: string, docs: Doc[]): Promise<{ db: string; newIds: string; ids: string[] }> {
    const db = join(dir, 'kk.db');
    const input = join(dir, 'docs.json');
    const newIds = join(dir, 'new-ids.json');
    writeFileSync(input, JSON.stringify(docs));
    const result = await run(['store', 'ingest', '--run', 'run-1', '--in', input, '--new-ids', newIds, '--db', db]);
    expect(result.code, result.err).toBe(0);
    return { db, newIds, ids: JSON.parse(readFileSync(newIds, 'utf-8')) as string[] };
}

/** Every `labels` row of the store, ordered for a stable assertion and artifact. */
function labelRows(db: string): Array<{
    item_id: string;
    decision_id: string;
    value: string;
    score: number | null;
    confidence: number | null;
    run_id: string;
    maker: string;
    source: string;
}> {
    const raw = new Database(db, { readonly: true });
    const rows = raw
        .query(
            'SELECT item_id, decision_id, value, score, confidence, run_id, maker, source FROM labels ORDER BY item_id, decision_id',
        )
        .all() as Array<{
        item_id: string;
        decision_id: string;
        value: string;
        score: number | null;
        confidence: number | null;
        run_id: string;
        maker: string;
        source: string;
    }>;
    raw.close();
    return rows;
}

/** The id at `index` of a seeded run — a short seed is a broken test, never a silent skip. */
function idAt(ids: readonly string[], index: number): string {
    const id = ids[index];
    if (id === undefined) throw new Error(`seed returned ${ids.length} ids, expected index ${index}`);
    return id;
}

/** The rows for one item, keyed by decision id. */
function rowsFor(
    db: string,
    id: string,
): Map<string, { value: string; score: number | null; maker: string; source: string }> {
    return new Map(
        labelRows(db)
            .filter((row) => row.item_id === id)
            .map((row) => [
                row.decision_id,
                { value: row.value, score: row.score, maker: row.maker, source: row.source },
            ]),
    );
}

/** copy the labels dump + the run summary into `.works/test-artifacts/0209/`. */
function saveArtifact(name: string, content: string): void {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, name), content);
}

describe('kk store label (0209 R4/R5)', () => {
    it('labels confidently classified items from the heuristic alone, with no model spawn', async () => {
        const dir = tempDir();
        // `aihot` is a curated AI source → ai-news with no keyword doubt; the second item is
        // signal-free → non-ai with no AI keyword either.
        const seeded = await seed(dir, [
            doc('confident', 'Something ships', 'A body about the release.', { source: 'aihot' }),
            doc('quiet', 'Local weather', 'Nothing to see here.', { source: 'rss' }),
        ]);
        const stub = stubSpur(dir, {
            '*': { value: 'ai-news', confidence: 1, source: 'model', reason: 'accepted', maker: 'fm-local' },
        });

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 10, model: 0, fallback: 0 });

        for (const id of seeded.ids) {
            const rows = rowsFor(seeded.db, id);
            expect([...rows.keys()].sort()).toEqual([...DECISION_IDS].sort());
            for (const row of rows.values()) {
                expect(row.source).toBe('heuristic');
                expect(row.maker).toBe('heuristic');
            }
        }
        const aiNews = idAt(seeded.ids, 0);
        const nonAi = idAt(seeded.ids, 1);
        expect(rowsFor(seeded.db, aiNews).get('kk-item-category')?.value).toBe('ai-news');
        expect(rowsFor(seeded.db, nonAi).get('kk-item-category')?.value).toBe('non-ai');
        expect(existsSync(join(dir, 'spawns.log'))).toBe(false); // R5 — not one decision spawn
        // R4 — every row carries the run, and a heuristic row has no model confidence.
        for (const row of labelRows(seeded.db)) {
            expect(row.run_id).toBe('run-1');
            expect(row.confidence).toBeNull();
        }

        saveArtifact(
            'kk-store-label-heuristic.json',
            `${JSON.stringify({ output: JSON.parse(result.out), rows: labelRows(seeded.db) }, null, 2)}\n`,
        );
    });

    it('routes only the non-ai-with-AI-keyword items to the catalog in heuristic mode', async () => {
        const dir = tempDir();
        // Tagged `geopolitics` (MECE deny → non-ai) while the body names an AI vendor: the one
        // case the plugin flags (`metadata.needs_model`).
        const seeded = await seed(dir, [
            doc('ambiguous', 'Prices rise', 'OpenAI raised prices this week.', {
                source: 'rss',
                tags: ['geopolitics'],
            }),
            doc('confident', 'Something ships', 'A body about the release.', { source: 'aihot' }),
        ]);
        const stub = stubSpur(dir, acceptedAnswers('ai-industry', [5, 4, 3, 2]));

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 10, model: 5, fallback: 0 });

        const spawns = readFileSync(join(dir, 'spawns.log'), 'utf-8').trim().split('\n');
        expect(spawns.sort()).toEqual([...DECISION_IDS].sort()); // exactly the ambiguous item's five

        const ambiguous = idAt(seeded.ids, 0);
        const confident = idAt(seeded.ids, 1);
        expect(rowsFor(seeded.db, ambiguous).get('kk-item-category')).toEqual({
            value: 'ai-industry',
            score: null,
            maker: 'fm-local',
            source: 'model',
        });
        expect(rowsFor(seeded.db, ambiguous).get('kk-item-importance')).toEqual({
            value: '4',
            score: 4,
            maker: 'fm-local',
            source: 'model',
        });
        expect(rowsFor(seeded.db, confident).get('kk-item-category')?.source).toBe('heuristic');
    });

    it('--mode decision routes every listed item and records model rows', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            doc('confident', 'Something ships', 'A body about the release.', { source: 'aihot' }),
        ]);
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 5, 5, 5]));

        const result = await run(
            ['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--mode', 'decision', '--db', seeded.db],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 5, model: 5, fallback: 0 });
        for (const row of rowsFor(seeded.db, idAt(seeded.ids, 0)).values()) {
            expect(row.source).toBe('model');
            expect(row.maker).toBe('fm-local');
        }
        // R4 — a model row records the decision's parsed confidence and the `--run` value.
        for (const row of labelRows(seeded.db)) {
            expect(row.confidence).toBe(0.95);
            expect(row.run_id).toBe('run-1');
        }
    });

    it('AC2 — a degraded backend stores the heuristic value with source: default and exits 0', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            doc('ambiguous', 'Prices rise', 'OpenAI raised prices this week.', {
                source: 'rss',
                tags: ['geopolitics'],
            }),
        ]);
        // `value` deliberately differs from the heuristic answer: the row must keep the heuristic
        // value (R6), so a stored 'ai-industry' here would be the wrong behaviour.
        const stub = stubSpur(dir, {
            '*': { value: 'ai-industry', confidence: null, source: 'default', reason: 'no-backend', maker: 'fm-local' },
        });

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 5, model: 0, fallback: 5 });

        const rows = rowsFor(seeded.db, idAt(seeded.ids, 0));
        for (const row of rows.values()) {
            expect(row.source).toBe('default');
            expect(row.maker).toBe('fm-local');
        }
        expect(rows.get('kk-item-category')?.value).toBe('non-ai'); // the heuristic's own answer
        expect(rows.get('kk-item-quality')?.score).toBe(1);

        saveArtifact(
            'kk-store-label-fallback.json',
            `${JSON.stringify({ output: JSON.parse(result.out), rows: labelRows(seeded.db) }, null, 2)}\n`,
        );
    });

    it('R6 — a spur binary that cannot be spawned degrades to source: default and exits 0', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            doc('ambiguous', 'Prices rise', 'OpenAI raised prices this week.', {
                source: 'rss',
                tags: ['geopolitics'],
            }),
        ]);

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: join(dir, 'no-such-spur'),
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 5, model: 0, fallback: 5 });
        expect(rowsFor(seeded.db, idAt(seeded.ids, 0)).get('kk-item-category')?.value).toBe('non-ai');
    });

    it('rejects a model value outside the decision vocabulary, keeping the heuristic row', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            doc('ambiguous', 'Prices rise', 'OpenAI raised prices this week.', {
                source: 'rss',
                tags: ['geopolitics'],
            }),
        ]);
        const stub = stubSpur(dir, {
            'kk-item-category': {
                value: 'ai-magic',
                confidence: 0.99,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
            },
            'kk-item-quality': { value: 9, confidence: 0.99, source: 'model', reason: 'accepted', maker: 'fm-local' },
            'kk-item-importance': {
                value: 4,
                confidence: 0.99,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
            },
            'kk-item-urgency': { value: 3, confidence: 0.99, source: 'model', reason: 'accepted', maker: 'fm-local' },
            'kk-item-impact': { value: 2, confidence: 0.99, source: 'model', reason: 'accepted', maker: 'fm-local' },
        });
        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 5, model: 3, fallback: 2 });

        const rows = rowsFor(seeded.db, idAt(seeded.ids, 0));
        expect(rows.get('kk-item-category')).toEqual({
            value: 'non-ai',
            score: null,
            maker: 'fm-local',
            source: 'default',
        });
        expect(rows.get('kk-item-quality')).toEqual({ value: '1', score: 1, maker: 'fm-local', source: 'default' });
        expect(rows.get('kk-item-importance')?.source).toBe('model');
        expect(rows.get('kk-item-importance')?.value).toBe('4');
    });

    it('labels only the ids --new-ids lists, skipping ids the store does not hold', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            doc('one', 'Something ships', 'A body about the release.', { source: 'aihot' }),
            doc('two', 'Another ships', 'A second body.', { source: 'aihot' }),
            doc('three', 'A third', 'A third body.', { source: 'rss' }),
        ]);
        const subset = join(dir, 'subset.json');
        writeFileSync(subset, JSON.stringify([idAt(seeded.ids, 0), 'not-a-stored-id']));

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', subset, '--db', seeded.db]);
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual({ labeled: 5, model: 0, fallback: 0 });
        const rows = labelRows(seeded.db);
        expect(new Set<string>(rows.map((row) => row.item_id))).toEqual(new Set<string>([idAt(seeded.ids, 0)]));

        // A repeat pass updates the same rows (one row per item+decision) instead of duplicating.
        const again = await run(['store', 'label', '--run', 'run-2', '--new-ids', subset, '--db', seeded.db]);
        expect(again.code, again.err).toBe(0);
        expect(labelRows(seeded.db)).toHaveLength(rows.length);
    });
});

describe('kk store label failure paths (0209 R4)', () => {
    it('exits 1 with kk.store.label.failed for a missing or invalid --new-ids, writing nothing', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [doc('one', 'Something ships', 'A body.', { source: 'aihot' })]);

        const missing = await run([
            'store',
            'label',
            '--run',
            'run-1',
            '--new-ids',
            join(dir, 'nope.json'),
            '--db',
            seeded.db,
        ]);
        expect(missing.code).toBe(1);
        expect(missing.err).toContain('kk.store.label.failed:');
        expect(missing.out).toBe('');

        const invalid = join(dir, 'invalid.json');
        writeFileSync(invalid, '{"ids":["a"]}');
        const bad = await run(['store', 'label', '--run', 'run-1', '--new-ids', invalid, '--db', seeded.db]);
        expect(bad.code).toBe(1);
        expect(bad.err).toContain('kk.store.label.failed:');

        const badMode = await run([
            'store',
            'label',
            '--run',
            'run-1',
            '--new-ids',
            seeded.newIds,
            '--mode',
            'model',
            '--db',
            seeded.db,
        ]);
        expect(badMode.code).toBe(1);
        expect(badMode.err).toContain('kk.store.label.failed:');

        expect(labelRows(seeded.db)).toHaveLength(0);
        saveArtifact(
            'kk-store-label-failures.txt',
            `${[
                `missing --new-ids: exit ${missing.code} ${missing.err.trim()}`,
                `invalid --new-ids: exit ${bad.code} ${bad.err.trim()}`,
                `invalid --mode: exit ${badMode.code} ${badMode.err.trim()}`,
            ].join('\n')}\n`,
        );
    });
});
