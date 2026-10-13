/**
 * Task 0226 — `kk store label` v2: raw observations, maker priority + the kk threshold, `--replay`.
 *
 * ## Failure-first list — written before the code
 *
 *  1. A model answer below the confidence threshold is resolved to the fallback and its raw
 *     `raw_value`/`raw_confidence`/`reason` are lost (AC1).
 *  2. A routed item writes only the maker's row, so the heuristic baseline every backtest compares
 *     against is gone (R2).
 *  3. A spawn failure still writes a maker row, or the heuristic row is dropped with it.
 *  4. An out-of-vocabulary answer stores the poisoned value instead of the heuristic with
 *     `source: default`, or drops the verbatim answer from `raw_value`.
 *  5. An observation misses its `catalog_version`, the item's `content_hash` or its run id, so the
 *     evidence cannot be attributed (R1/R2).
 *  6. A below-threshold model answer becomes the CURRENT label, so `kk store extract`'s pool follows
 *     an untrusted answer (AC2).
 *  7. `--replay` overwrites another maker's row, writes a heuristic row, or runs under a non-`replay-`
 *     run id (AC3/R6).
 *  8. A `replay-*` row displaces production selection: `'*'` admits a replay row (AC3).
 *  9. A `--replay` selector matching nothing fails instead of printing `replayed: 0` (R6).
 * 10. `--replay` + `--new-ids`, `--replay` without `--maker`, a malformed selector, or `--decisions`
 *     without `--replay` is accepted (R6).
 * 11. `--decisions <ids>` routes decisions outside the requested set.
 *
 * Everything runs against a temp dir + temp DB and a stubbed `spur` (`KK_SPUR_BIN`), so no network,
 * model or operator store is touched. The labels dump is copied to `.works/test-artifacts/0226/`.
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
import {
    CHINA_POLITICS_DECISION_ID,
    itemId,
    LABEL_CONFIDENCE_LEVELS,
    type LabelPolicy,
    openStore,
    readStoreConfig,
} from '@gobing-ai/kk-store';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const ARTIFACT_DIR = join(REPO, '.works/test-artifacts/0226');
const ARTIFACT_DIR_0229 = join(REPO, '.works/test-artifacts/0229');
const CATALOG_PATH = join(REPO, 'plugins/kk/decisions/kk-items.yaml');

/** The default labels policy (R4): any maker, the keyword heuristic second, the ADR-125 threshold. */
const DEFAULT_POLICY: LabelPolicy = { priority: ['*', 'heuristic'], decisionPriority: {}, minConfidence: 0.8 };

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
    env: { KK_SPUR_BIN?: string; cwd?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    const previousBin = process.env.KK_SPUR_BIN;
    const previousCwd = process.cwd();
    if (env.KK_SPUR_BIN !== undefined) process.env.KK_SPUR_BIN = env.KK_SPUR_BIN;
    if (env.cwd !== undefined) process.chdir(env.cwd);
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
        process.chdir(previousCwd);
        if (previousBin === undefined) delete process.env.KK_SPUR_BIN;
        else process.env.KK_SPUR_BIN = previousBin;
    }
}

/**
 * The eight catalog decision ids, in the order `kk store label` writes them — the five the keyword
 * heuristic annotates, then the three judgment decisions 0229 added.
 */
const DECISION_IDS = [
    'kk-item-category',
    'kk-item-quality',
    'kk-item-importance',
    'kk-item-urgency',
    'kk-item-impact',
    'kk-item-china-politics',
    'kk-item-sensitivity',
    'kk-item-audience',
] as const;

/** The five decisions the keyword heuristic annotates (the heuristic-first routing surface). */
const HEURISTIC_IDS = DECISION_IDS.slice(0, 5);

/** The three judgment decisions 0229 added (consulted for every labelled item). */
const JUDGMENT_IDS = DECISION_IDS.slice(5);

/**
 * An accepted model answer per decision — the choice as a label, the scores as levels. The three
 * judgment decisions default to a clean, publishable answer (china 0, sensitivity 1, audience
 * general); pass `judgment` to make one speak.
 */
function acceptedAnswers(
    category: string,
    levels: [number, number, number, number],
    confidence = 0.95,
    judgment: { china?: number; sensitivity?: number; audience?: string } = {},
): Record<string, unknown> {
    const meta = { confidence, source: 'model', reason: 'accepted', maker: 'fm-local', durationMs: 100 };
    return {
        'kk-item-category': { ...meta, value: category },
        'kk-item-quality': { ...meta, value: levels[0] },
        'kk-item-importance': { ...meta, value: levels[1] },
        'kk-item-urgency': { ...meta, value: levels[2] },
        'kk-item-impact': { ...meta, value: levels[3] },
        'kk-item-china-politics': { ...meta, value: judgment.china ?? 0 },
        'kk-item-sensitivity': { ...meta, value: judgment.sensitivity ?? 1 },
        'kk-item-audience': { ...meta, value: judgment.audience ?? 'general' },
    };
}

/**
 * A model answer that reports NO `maker`, so the effective maker is the pass's own `--maker` — the
 * shape `spur decision run --maker <name>` answers with, and the one a replay's isolation depends on.
 */
function replayAnswers(
    category: string,
    levels: [number, number, number, number],
    confidence = 0.9,
): Record<string, unknown> {
    const meta = { confidence, source: 'model', reason: 'accepted', durationMs: 100 };
    return {
        'kk-item-category': { ...meta, value: category },
        'kk-item-quality': { ...meta, value: levels[0] },
        'kk-item-importance': { ...meta, value: levels[1] },
        'kk-item-urgency': { ...meta, value: levels[2] },
        'kk-item-impact': { ...meta, value: levels[3] },
        'kk-item-china-politics': { ...meta, value: 0 },
        'kk-item-sensitivity': { ...meta, value: 1 },
        'kk-item-audience': { ...meta, value: 'general' },
    };
}

/**
 * A degraded answer set (task 0268): the decision backend was unavailable, so spur answers every
 * decision with the catalog's own fail-closed default and `source: 'default'` (its `no-backend`
 * degradation). `kk-item-china-politics` carries catalog default `3` — the moderation rail.
 */
function degradedAnswers(): Record<string, unknown> {
    const meta = { confidence: null, source: 'default', reason: 'no-backend', maker: 'fm-local', durationMs: 0 };
    return {
        'kk-item-category': { ...meta, value: 'non-ai' },
        'kk-item-quality': { ...meta, value: 0 },
        'kk-item-importance': { ...meta, value: 0 },
        'kk-item-urgency': { ...meta, value: 0 },
        'kk-item-impact': { ...meta, value: 0 },
        'kk-item-china-politics': { ...meta, value: 3 },
        'kk-item-sensitivity': { ...meta, value: 1 },
        'kk-item-audience': { ...meta, value: 'general' },
    };
}

/**
 * Write an executable `spur` stub that appends the decision id it was asked for to
 * `<dir>/spawns.log` and answers from `answers` (a decision id, or `*` for every id).
 * No answer for an id → exit 1, which is the "answered nothing" degradation path.
 */
function stubSpur(dir: string, answers: Record<string, unknown>, name = 'spur-stub.sh'): string {
    const lines = [
        '#!/bin/sh',
        '# $1=decision $2=run $3=<decision id>',
        `printf "%s\\n" "$3" >> "${join(dir, name.replace(/\.sh$/, '.spawns.log'))}"`,
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
    const stub = join(dir, name);
    writeFileSync(stub, `${lines.join('\n')}\n`);
    chmodSync(stub, 0o755);
    return stub;
}

/** One Doc for the store: identity is content-addressed (`itemId` of the canonical URL). */
function doc(url: string, title: string, body: string, metadata: Record<string, unknown>): Doc {
    return { id: url, title, body, sourceUri: `https://example.com/${url}`, metadata };
}

/** An item the keyword heuristic files `non-ai` while seeing an AI signal — `metadata.needs_model`. */
const AMBIGUOUS = (): Doc =>
    doc('ambiguous', 'Prices rise', 'OpenAI raised prices this week.', { source: 'rss', tags: ['geopolitics'] });

/** An item the heuristic classifies confidently — never routed in heuristic mode. */
const CONFIDENT = (): Doc => doc('confident', 'Something ships', 'A body about the release.', { source: 'aihot' });

/** Store one `Doc[]` run and return its item ids plus the `--new-ids` path. */
async function seed(dir: string, docs: Doc[], runId = 'run-1'): Promise<{ db: string; newIds: string; ids: string[] }> {
    const db = join(dir, 'kk.db');
    const input = join(dir, `docs-${runId}.json`);
    const newIds = join(dir, `new-ids-${runId}.json`);
    writeFileSync(input, JSON.stringify(docs));
    const result = await run(['store', 'ingest', '--run', runId, '--in', input, '--new-ids', newIds, '--db', db]);
    expect(result.code, result.err).toBe(0);
    return { db, newIds, ids: JSON.parse(readFileSync(newIds, 'utf-8')) as string[] };
}

/** One `labels` row of the store, with every 0226 evidence column, ordered deterministically. */
interface LabelRowDump {
    item_id: string;
    decision_id: string;
    value: string;
    score: number | null;
    confidence: string | null;
    run_id: string;
    maker: string;
    source: string;
    raw_value: string | null;
    raw_confidence: number | null;
    reason: string | null;
    duration_ms: number | null;
    catalog_version: string | null;
    content_hash: string | null;
}

function labelRows(db: string, where = ''): LabelRowDump[] {
    const raw = new Database(db, { readonly: true });
    try {
        return raw
            .query(
                `SELECT item_id, decision_id, value, score, confidence, run_id, maker, source, raw_value,
                        raw_confidence, reason, duration_ms, catalog_version, content_hash
                 FROM labels ${where}
                 ORDER BY item_id, decision_id, maker, run_id`,
            )
            .all() as LabelRowDump[];
    } finally {
        raw.close();
    }
}

/** Every non-replay row — the production selection a replay must not disturb. */
function productionRows(db: string): LabelRowDump[] {
    return labelRows(db, "WHERE run_id NOT LIKE 'replay-%'");
}

/** The rows for one item and one maker, keyed by decision id. */
function rowsFor(db: string, id: string, maker: string): Map<string, LabelRowDump> {
    return new Map(
        labelRows(db)
            .filter((row) => row.item_id === id && row.maker === maker)
            .map((row) => [row.decision_id, row]),
    );
}

/** The item's stored `content_hash` — the value every observation of it must carry (R2). */
function itemHash(db: string, id: string): string {
    const raw = new Database(db, { readonly: true });
    try {
        const row = raw.query('SELECT content_hash FROM items WHERE id = ?').get(id) as { content_hash: string };
        return row.content_hash;
    } finally {
        raw.close();
    }
}

/** The decision ids a stub was asked for, in spawn order. */
function spawns(dir: string, name = 'spur-stub.sh'): string[] {
    const log = join(dir, name.replace(/\.sh$/, '.spawns.log'));
    if (!existsSync(log)) return [];
    return readFileSync(log, 'utf-8')
        .trim()
        .split('\n')
        .filter((line) => line !== '');
}

/** The verdict line `kk store label` prints (G31 R14) plus the R6 counters. */
function labelLine(counts: {
    labeled: number;
    model: number;
    fallback: number;
    consults: number;
    consultMs: number;
    confidence: string;
    degraded?: boolean;
    refused?: Record<string, number>;
}): Record<string, unknown> {
    // The `degraded` flag (task 0268 R2) defaults to false so a healthy line stays the old shape.
    return {
        verdict: 'PASS',
        degraded: counts.degraded ?? false,
        refused: counts.refused ?? {},
        ...counts,
    };
}

/** The id at `index` of a seeded run — a short seed is a broken test, never a silent skip. */
function idAt(ids: readonly string[], index: number): string {
    const id = ids[index];
    if (id === undefined) throw new Error(`seed returned ${ids.length} ids, expected index ${index}`);
    return id;
}

/** Copy a labels dump into `.works/test-artifacts/0226/` as repeatable evidence. */
function saveArtifact(name: string, content: string): void {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(join(ARTIFACT_DIR, name), content);
}

describe('kk store label — raw observations (0226 R1/R2)', () => {
    it('R1 — the catalog declares the schema-pinned version 1 and accepts every answer raw', () => {
        const catalog = readFileSync(CATALOG_PATH, 'utf-8');
        expect(catalog).toContain('version: 1');
        expect(catalog).toMatch(/minConfidence:\s*0\b/);
    });

    it('AC1 — a below-threshold model answer is stored raw, with the mapped value unchanged', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);
        const id = idAt(seeded.ids, 0);
        // The category answer is BELOW the config's 0.8 threshold; the quality answer is outside the
        // 0–5 vocabulary. Both are still evidence, and neither poisons the mapped value.
        const stub = stubSpur(dir, {
            'kk-item-category': {
                value: 'ai-industry',
                confidence: 0.3,
                source: 'model',
                reason: 'low-confidence',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-quality': {
                value: 9,
                confidence: 0.95,
                source: 'model',
                reason: 'out-of-vocab',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-importance': {
                value: 4,
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-urgency': {
                value: 3,
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-impact': {
                value: 2,
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
            // The three judgment decisions are consulted for every labelled item (0229 R3).
            'kk-item-china-politics': {
                value: 1,
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-sensitivity': {
                value: 1,
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
            'kk-item-audience': {
                value: 'general',
                confidence: 0.9,
                source: 'model',
                reason: 'accepted',
                maker: 'fm-local',
                durationMs: 100,
            },
        });

        const result = await run(
            ['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--mode', 'decision', '--db', seeded.db],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        // 5 heuristic rows + 8 maker rows; 4 existing + 3 judgment accepted model answers.
        expect(JSON.parse(result.out)).toEqual(
            labelLine({
                labeled: 13,
                model: 7,
                fallback: 1,
                consults: 8,
                consultMs: 800,
                confidence: 'LOW',
                refused: { 'kk-item-quality@fm-local': 1 },
            }),
        );

        const maker = rowsFor(seeded.db, id, 'fm-local');
        const category = maker.get('kk-item-category');
        expect(category?.source).toBe('model');
        expect(category?.value).toBe('ai-industry'); // in vocabulary, so the model value is stored
        expect(category?.raw_value).toBe('ai-industry'); // and the answer verbatim
        expect(category?.raw_confidence).toBe(0.3); // below the threshold, still evidence
        expect(category?.reason).toBe('low-confidence');
        expect(category?.duration_ms).toBe(100);
        expect(category?.confidence).toBe('LOW'); // 0.3 is LOW on the G31 R14 mapping

        const quality = maker.get('kk-item-quality');
        const heuristicQuality = rowsFor(seeded.db, id, 'heuristic').get('kk-item-quality');
        expect(quality?.source).toBe('default'); // out of vocabulary: the heuristic answer stands
        expect(quality?.value).toBe(heuristicQuality?.value);
        expect(quality?.raw_value).toBe('9'); // the rejected answer is still recorded
        expect(quality?.raw_confidence).toBe(0.95);
        expect(quality?.reason).toBe('out-of-vocab');
        expect(maker.get('kk-item-importance')?.confidence).toBe('HIGH');

        // 0229 R3: the judgment decisions are answered for a routed item too, and validated against
        // their own table entry (choices in vocabulary, scores in 0..levels-1).
        expect(maker.get('kk-item-china-politics')?.value).toBe('1');
        expect(maker.get('kk-item-china-politics')?.score).toBe(1);
        expect(maker.get('kk-item-sensitivity')?.value).toBe('1');
        expect(maker.get('kk-item-audience')?.value).toBe('general');
        expect(maker.get('kk-item-audience')?.score).toBeNull();

        // R2 — every row carries the catalog version, the item's current hash and its run id.
        for (const row of labelRows(seeded.db)) {
            expect(row.catalog_version).toBe('1');
            expect(row.content_hash).toBe(itemHash(seeded.db, id));
            expect(row.run_id).toBe('run-1');
            expect(LABEL_CONFIDENCE_LEVELS.some((level) => level === row.confidence)).toBe(true);
        }

        saveArtifact(
            'kk-store-label-raw.json',
            `${JSON.stringify({ output: JSON.parse(result.out), rows: labelRows(seeded.db) }, null, 2)}\n`,
        );
    });

    it('R2/R3 — an unrouted item keeps its heuristic rows and consults only the three judgment decisions', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [CONFIDENT()]);
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2]));

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        // 5 heuristic rows + the three judgment maker rows (R3: no heuristic signal → always consulted).
        expect(JSON.parse(result.out)).toEqual(
            labelLine({ labeled: 8, model: 3, fallback: 0, consults: 3, consultMs: 300, confidence: 'LOW' }),
        );

        const rows = rowsFor(seeded.db, idAt(seeded.ids, 0), 'heuristic');
        expect([...rows.keys()].sort()).toEqual([...HEURISTIC_IDS].sort());
        for (const row of rows.values()) {
            expect(row.source).toBe('heuristic');
            expect(row.raw_value).toBeNull();
            expect(row.raw_confidence).toBeNull();
            expect(row.reason).toBe('heuristic');
            expect(row.confidence).toBe('LOW');
        }
        // R5 cost contract: the heuristic's five are not spawned; the judgment three always are.
        expect(spawns(dir).sort()).toEqual([...JUDGMENT_IDS].sort());
        const judgment = rowsFor(seeded.db, idAt(seeded.ids, 0), 'fm-local');
        expect([...judgment.keys()].sort()).toEqual([...JUDGMENT_IDS].sort());
        expect(judgment.get('kk-item-china-politics')?.value).toBe('0');
        expect(judgment.get('kk-item-audience')?.value).toBe('general');
    });

    it('R2 — a routed item keeps BOTH observations: the heuristic baseline and the maker', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);
        const id = idAt(seeded.ids, 0);
        const stub = stubSpur(dir, acceptedAnswers('ai-industry', [5, 4, 3, 2]));

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual(
            labelLine({ labeled: 13, model: 8, fallback: 0, consults: 8, consultMs: 800, confidence: 'LOW' }),
        );
        expect(spawns(dir).sort()).toEqual([...DECISION_IDS].sort());

        expect([...rowsFor(seeded.db, id, 'heuristic').keys()].sort()).toEqual([...HEURISTIC_IDS].sort());
        const model = rowsFor(seeded.db, id, 'fm-local');
        expect([...model.keys()].sort()).toEqual([...DECISION_IDS].sort());
        expect(model.get('kk-item-category')?.value).toBe('ai-industry');
        expect(model.get('kk-item-importance')?.value).toBe('4');
        expect(model.get('kk-item-importance')?.score).toBe(4);
        expect(labelRows(seeded.db)).toHaveLength(13);
    });

    it('R2 — a spawn failure writes no maker row, keeping the heuristic observation', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: join(dir, 'no-such-spur'),
        });
        expect(result.code, result.err).toBe(0);
        // The consults were attempted (8: five routed heuristic + three judgment) but answered
        // nothing, so only the heuristic rows exist — and no judgment row, which the gate excludes.
        expect(JSON.parse(result.out)).toEqual(
            labelLine({ labeled: 5, model: 0, fallback: 0, consults: 8, consultMs: 0, confidence: 'LOW' }),
        );
        const rows = labelRows(seeded.db);
        expect(rows).toHaveLength(5);
        for (const row of rows) {
            expect(row.source).toBe('heuristic');
            expect(row.maker).toBe('heuristic');
        }
    });

    it('R2 — a source: default answer keeps the heuristic value and records the raw answer', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);
        const id = idAt(seeded.ids, 0);
        const stub = stubSpur(dir, {
            '*': { value: 'ai-industry', confidence: null, source: 'default', reason: 'no-backend', maker: 'fm-local' },
        });

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        // A `source: default` answer keeps the heuristic value for the heuristic's five; the judgment
        // decisions have no heuristic value, and 'ai-industry' is not a valid answer for either a
        // 0-3 score or the audience choice, so they write no row at all.
        expect(JSON.parse(result.out)).toEqual(
            labelLine({
                labeled: 10,
                model: 0,
                fallback: 5,
                consults: 8,
                consultMs: 0,
                confidence: 'LOW',
                degraded: true,
            }),
        );

        const rows = rowsFor(seeded.db, id, 'fm-local');
        expect(rows.get('kk-item-china-politics')).toBeUndefined();
        expect(rows.get('kk-item-audience')).toBeUndefined();
        expect(rows.get('kk-item-category')?.value).toBe('non-ai'); // the heuristic's own answer
        expect(rows.get('kk-item-category')?.source).toBe('default');
        expect(rows.get('kk-item-category')?.raw_value).toBe('ai-industry');
        expect(rows.get('kk-item-category')?.raw_confidence).toBeNull();
        expect(rows.get('kk-item-category')?.reason).toBe('no-backend');
    });

    it('AC1/R2 (0268) — a pass whose consults mostly fell back reports `degraded` and warns on stderr', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);
        const id = idAt(seeded.ids, 0);
        // A dead decision backend: every consult answers `source: default` (spur's no-backend rail).
        const stub = stubSpur(dir, degradedAnswers());

        const degraded = await run(
            ['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--mode', 'decision', '--db', seeded.db],
            { KK_SPUR_BIN: stub },
        );
        expect(degraded.code, degraded.err).toBe(0);
        // 5 heuristic + 8 default rows = 13 labelled; every one of the 8 consults fell back, so the
        // pass flags `degraded` — yet keeps `verdict: PASS`, so the collect run keeps the labels it
        // wrote (R2 tradeoff: a non-PASS verdict would route kk-collect to `release-failed`).
        expect(JSON.parse(degraded.out)).toEqual(
            labelLine({
                labeled: 13,
                model: 0,
                fallback: 8,
                consults: 8,
                consultMs: 0,
                confidence: 'LOW',
                degraded: true,
            }),
        );
        // R1 — the greppable warning lands on the boundary kk-collect reads (launchd.log/the ledger),
        // carrying the incident's own shape: the fallback count AND the consults denominator.
        expect(degraded.err).toContain('kk.store.label.degraded:');
        expect(degraded.err).toContain('fallback: 8/8 consults');

        // R3/AC2 — the rail itself is untouched: china-politics still lands on its catalog default 3
        // and the row names `source: default`, so nothing is silently reclassified as model output.
        const china = rowsFor(seeded.db, id, 'fm-local').get('kk-item-china-politics');
        expect(china?.value).toBe('3');
        expect(china?.score).toBe(3);
        expect(china?.source).toBe('default');
        expect(china?.reason).toBe('no-backend');

        // A healthy pass over the same item is unaffected: no `degraded` flag and no stderr warning.
        const healthyDir = tempDir();
        const healthySeeded = await seed(healthyDir, [AMBIGUOUS()]);
        const healthyStub = stubSpur(healthyDir, acceptedAnswers('ai-industry', [5, 4, 3, 2]));
        const healthy = await run(
            [
                'store',
                'label',
                '--run',
                'run-1',
                '--new-ids',
                healthySeeded.newIds,
                '--mode',
                'decision',
                '--db',
                healthySeeded.db,
            ],
            { KK_SPUR_BIN: healthyStub },
        );
        expect(healthy.code, healthy.err).toBe(0);
        expect(JSON.parse(healthy.out)).toEqual(
            labelLine({
                labeled: 13,
                model: 8,
                fallback: 0,
                consults: 8,
                consultMs: 800,
                confidence: 'LOW',
                degraded: false,
            }),
        );
        expect(healthy.err).not.toContain('kk.store.label.degraded:');
    });

    it('R5 — every row earns exactly one HIGH|MEDIUM|LOW level, derived from its own raw payload', async () => {
        const levels: [number, string][] = [
            [0.95, 'HIGH'],
            [0.8, 'HIGH'],
            [0.6, 'MEDIUM'],
            [0.5, 'MEDIUM'],
            [0.3, 'LOW'],
        ];
        for (const [confidence, expected] of levels) {
            const dir = tempDir();
            const seeded = await seed(dir, [CONFIDENT()]);
            const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2], confidence));

            const result = await run(
                [
                    'store',
                    'label',
                    '--run',
                    'run-1',
                    '--new-ids',
                    seeded.newIds,
                    '--mode',
                    'decision',
                    '--db',
                    seeded.db,
                ],
                { KK_SPUR_BIN: stub },
            );
            expect(result.code, result.err).toBe(0);
            // The heuristic baseline is always LOW, so the pass can never claim more than LOW — but
            // each MODEL row still carries the level its own payload earned.
            expect(JSON.parse(result.out)).toEqual(
                labelLine({ labeled: 13, model: 8, fallback: 0, consults: 8, consultMs: 800, confidence: 'LOW' }),
            );
            const modelRows = labelRows(seeded.db, "WHERE source = 'model'");
            expect(modelRows).toHaveLength(8);
            for (const row of modelRows) expect(row.confidence).toBe(expected);
            saveArtifact(
                `kk-store-label-level-${expected}-${confidence}.json`,
                `${JSON.stringify(modelRows, null, 2)}\n`,
            );
        }
    });

    it('labels only the ids --new-ids lists, skipping ids the store does not hold', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [
            CONFIDENT(),
            doc('two', 'Another ships', 'A second body.', { source: 'aihot' }),
        ]);
        const subset = join(dir, 'subset.json');
        writeFileSync(subset, JSON.stringify([idAt(seeded.ids, 0), 'not-a-stored-id']));
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2]));

        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', subset, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toEqual(
            labelLine({ labeled: 8, model: 3, fallback: 0, consults: 3, consultMs: 300, confidence: 'LOW' }),
        );
        const rows = labelRows(seeded.db);
        expect(new Set<string>(rows.map((row) => row.item_id))).toEqual(new Set<string>([idAt(seeded.ids, 0)]));

        // The run id is part of the observation identity (0225): a repeat of the same run updates in
        // place, a later run adds a second observation.
        const again = await run(['store', 'label', '--run', 'run-1', '--new-ids', subset, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(again.code, again.err).toBe(0);
        expect(labelRows(seeded.db)).toHaveLength(rows.length);
        const later = await run(['store', 'label', '--run', 'run-2', '--new-ids', subset, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(later.code, later.err).toBe(0);
        expect(labelRows(seeded.db)).toHaveLength(rows.length * 2);
    });
});

describe('kk store label — the current label and the kk threshold (0226 AC2)', () => {
    it('AC2 — a below-threshold model answer is stored but is NOT the current label', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [AMBIGUOUS()]);
        const id = idAt(seeded.ids, 0);
        const stub = stubSpur(dir, {
            ...acceptedAnswers('ai-industry', [5, 4, 3, 2]),
            'kk-item-category': {
                value: 'ai-industry',
                confidence: 0.3,
                source: 'model',
                reason: 'low-confidence',
                maker: 'fm-local',
                durationMs: 100,
            },
        });

        const result = await run(
            ['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--mode', 'decision', '--db', seeded.db],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);

        const store = await openStore({ path: seeded.db });
        try {
            const current = await store.labels.currentFor([id], DEFAULT_POLICY);
            // Seven accepted model rows are current (four existing + the three judgment decisions);
            // only the below-threshold category row was rejected, so its heuristic observation (LOW)
            // is what a consumer reads.
            expect(current).toHaveLength(8);
            expect(current.filter((row) => row.source === 'model')).toHaveLength(7);
            const category = current.find((row) => row.decisionId === 'kk-item-category');
            expect(category?.value).toBe('non-ai'); // the heuristic stands, not 'ai-industry'
            expect(category?.maker).toBe('heuristic');

            // The threshold IS the gate: lowered, the same stored row becomes current.
            const lowered = await store.labels.currentFor([id], { ...DEFAULT_POLICY, minConfidence: 0.2 });
            expect(lowered.find((row) => row.decisionId === 'kk-item-category')?.value).toBe('ai-industry');
        } finally {
            await store.close();
        }
        saveArtifact('kk-store-label-current.json', `${JSON.stringify(labelRows(seeded.db), null, 2)}\n`);
    });
});

describe('kk store label --replay (0226 R6/AC3)', () => {
    /** A seeded store with two unrouted items labelled by one production pass. */
    async function seedProduction(): Promise<{ dir: string; db: string; ids: string[]; production: LabelRowDump[] }> {
        const dir = tempDir();
        const seeded = await seed(dir, [
            CONFIDENT(),
            doc('two', 'Another ships', 'A second body.', { source: 'aihot' }),
        ]);
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2]));
        const result = await run(['store', 'label', '--run', 'run-1', '--new-ids', seeded.newIds, '--db', seeded.db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        return { dir, db: seeded.db, ids: seeded.ids, production: labelRows(seeded.db) };
    }

    it('AC3 — a replay re-labels the pool under replay-<epoch> without touching production rows', async () => {
        const { dir, db, ids, production } = await seedProduction();
        const stub = stubSpur(dir, replayAnswers('ai-industry', [5, 4, 3, 2]));

        const result = await run(['store', 'label', '--replay', 'run:run-1', '--maker', 'backtest-a', '--db', db], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code, result.err).toBe(0);
        const output = JSON.parse(result.out) as { replayed: number; consults: number; consultMs: number; run: string };
        // The replay default is the whole table: 8 decisions x 2 items (0229 R3).
        expect(output).toMatchObject({ replayed: 2, consults: 16, consultMs: 1600 });
        expect(output.run).toMatch(/^replay-\d+$/);

        // Only maker rows, under the replay run id.
        const replayRows = labelRows(db, "WHERE run_id LIKE 'replay-%'");
        expect(replayRows).toHaveLength(16);
        for (const row of replayRows) {
            expect(row.maker).toBe('backtest-a');
            expect(row.source).toBe('model'); // the stub's accepted answers omit `maker`, so --maker wins
            expect(row.raw_value).not.toBeNull();
            expect(row.catalog_version).toBe('1');
            expect(row.content_hash).toBe(itemHash(db, row.item_id));
        }
        expect(replayRows.some((row) => row.source === 'heuristic')).toBe(false);

        // Not one production row changed, and none was deleted.
        expect(productionRows(db)).toEqual(production);

        // Production selection is undisturbed: '*' never admits a replay row, so the heuristic stays
        // current — and the backtest maker is current only when it is named explicitly.
        const store = await openStore({ path: db });
        try {
            for (const id of ids) {
                const current = await store.labels.currentFor([id], DEFAULT_POLICY);
                expect(current).toHaveLength(8);
                expect(new Set(current.map((row) => row.maker))).toEqual(new Set(['heuristic', 'fm-local']));
                const replayed = await store.labels.currentFor([id], {
                    priority: ['backtest-a'],
                    decisionPriority: {},
                    minConfidence: 0.8,
                });
                expect(new Set(replayed.map((row) => row.maker))).toEqual(new Set(['backtest-a']));
                expect(replayed).toHaveLength(8);
                expect(replayed.find((row) => row.decisionId === 'kk-item-category')?.value).toBe('ai-industry');
            }
        } finally {
            await store.close();
        }
        saveArtifact('kk-store-label-replay.json', `${JSON.stringify(labelRows(db), null, 2)}\n`);
    });

    it('R6 — --decisions routes exactly the requested decisions', async () => {
        const { dir, db } = await seedProduction();
        const stub = stubSpur(dir, replayAnswers('ai-industry', [5, 4, 3, 2]));
        // The production pass spawns the judgment decisions; clear the shared log so this test
        // counts only the replay's spawns.
        rmSync(join(dir, 'spur-stub.spawns.log'), { force: true });

        const result = await run(
            [
                'store',
                'label',
                '--replay',
                'run:run-1',
                '--maker',
                'backtest-b',
                '--decisions',
                'kk-item-category, kk-item-quality',
                '--db',
                db,
            ],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ replayed: 2, consults: 4 });
        const replayed = labelRows(db, "WHERE run_id LIKE 'replay-%'");
        expect(replayed).toHaveLength(4);
        expect(new Set(replayed.map((row) => row.decision_id))).toEqual(
            new Set(['kk-item-category', 'kk-item-quality']),
        );
        expect(spawns(dir).sort()).toEqual([
            'kk-item-category',
            'kk-item-category',
            'kk-item-quality',
            'kk-item-quality',
        ]);
    });

    it('R6 — since: selects by first_seen_at and a 0-item selector reports replayed: 0', async () => {
        const { dir, db, production } = await seedProduction();
        const stub = stubSpur(dir, replayAnswers('ai-industry', [5, 4, 3, 2]));

        const empty = await run(
            ['store', 'label', '--replay', 'run:no-such-run', '--maker', 'backtest-c', '--db', db],
            {
                KK_SPUR_BIN: stub,
            },
        );
        expect(empty.code, empty.err).toBe(0);
        expect(JSON.parse(empty.out)).toMatchObject({ replayed: 0, consults: 0, consultMs: 0 });
        expect(labelRows(db, "WHERE run_id LIKE 'replay-%'")).toEqual([]);

        const windowed = await run(['store', 'label', '--replay', 'since:1d', '--maker', 'backtest-c', '--db', db], {
            KK_SPUR_BIN: stub,
        });
        expect(windowed.code, windowed.err).toBe(0);
        expect(JSON.parse(windowed.out)).toMatchObject({ replayed: 2, consults: 16 });
        expect(productionRows(db)).toEqual(production);
    });

    it('R6 — topic: re-labels the profile pool with no exclusion', async () => {
        const { dir, db, production } = await seedProduction();
        const root = tempDir();
        const profileDir = join(root, 'plugins/kk/decisions/extract');
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(
            join(profileDir, 'replay-topic.yaml'),
            ['topic: replay-topic', 'where:', '    kk-item-category: { in: [non-ai, ai-news, ai-industry] }', ''].join(
                '\n',
            ),
        );
        const stub = stubSpur(dir, replayAnswers('ai-industry', [5, 4, 3, 2]));

        const result = await run(
            ['store', 'label', '--replay', 'topic:replay-topic', '--maker', 'backtest-d', '--db', db],
            { KK_SPUR_BIN: stub, cwd: root },
        );
        expect(result.code, result.err).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ replayed: 2, consults: 16 });
        expect(productionRows(db)).toEqual(production);
        expect(new Set(labelRows(db, "WHERE run_id LIKE 'replay-%'").map((row) => row.maker))).toEqual(
            new Set(['backtest-d']),
        );
    });
});

describe('kk store label failure paths (0226 R6)', () => {
    it('exits 1 with kk.store.label.failed, writing nothing, for every caller mistake', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [CONFIDENT()]);
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2]));
        const base = ['store', 'label', '--db', seeded.db];

        const cases: readonly [string, string[]][] = [
            ['missing --new-ids', [...base, '--run', 'run-1', '--new-ids', join(dir, 'nope.json')]],
            ['non-array --new-ids', [...base, '--run', 'run-1', '--new-ids', join(dir, 'invalid.json')]],
            ['unknown --mode', [...base, '--run', 'run-1', '--new-ids', seeded.newIds, '--mode', 'model']],
            ['--new-ids without --run', [...base, '--new-ids', seeded.newIds]],
            [
                '--replay with --new-ids',
                [...base, '--run', 'run-1', '--new-ids', seeded.newIds, '--replay', 'run:run-1', '--maker', 'm'],
            ],
            ['--replay without --maker', [...base, '--replay', 'run:run-1']],
            ['--replay with a bare selector', [...base, '--replay', 'run-1', '--maker', 'm']],
            ['--replay with an empty selector value', [...base, '--replay', 'topic:', '--maker', 'm']],
            ['--replay since: without a unit', [...base, '--replay', 'since:5', '--maker', 'm']],
            ['--replay since:0s', [...base, '--replay', 'since:0s', '--maker', 'm']],
            [
                '--decisions without --replay',
                [...base, '--run', 'run-1', '--new-ids', seeded.newIds, '--decisions', 'kk-item-category'],
            ],
            [
                '--decisions naming an unknown id',
                [...base, '--replay', 'run:run-1', '--maker', 'm', '--decisions', 'kk-item-nope'],
            ],
            ['neither --new-ids nor --replay', [...base, '--run', 'run-1']],
        ];
        writeFileSync(join(dir, 'invalid.json'), '{"ids":["a"]}');

        const evidence: string[] = [];
        for (const [label, args] of cases) {
            const result = await run(args, { KK_SPUR_BIN: stub });
            expect(result.code, `${label}: ${result.err}`).toBe(1);
            expect(result.err, label).toContain('kk.store.label.failed:');
            expect(result.out, label).toBe('');
            evidence.push(`${label}: exit ${result.code} ${result.err.trim()}`);
        }
        expect(labelRows(seeded.db)).toEqual([]);
        saveArtifact('kk-store-label-failures.txt', `${evidence.join('\n')}\n`);
    });
});

/**
 * Task 0229 — the three judgment decisions, the china-politics keyword prefilter and the gate.
 *
 * ## Failure-first list — written before the code
 *
 *  1. The backend is down, so an item has no current china-politics answer, and the ai-news gate
 *     ADMITS it (R5 is fail-closed: a `where` key is an inner join).
 *  2. An out-of-vocabulary audience answer is stored as the current label.
 *  3. A score of 4 becomes a current answer for a 0–3 decision.
 *  4. The prefilter fires on a company name (a generic China term), excluding China-related content.
 *  5. Chinese-AI-industry news scores high, so the gate drops legitimate items.
 *  6. A keyword hit where the model answers 0 is resolved by VALUE, not priority, so the model
 *     answer passes an item naming the top leader.
 *  7. The operator's per-decision china-politics priority override is ignored.
 *  8. The prefilter writes maker `heuristic`, so the 0226 default priority outranks it.
 */
describe('kk store label — china-politics prefilter and gate (0229 R3/R4/R5)', () => {
    /** One fixture item with its RECORDED maker answer for kk-item-china-politics. */
    interface ChinaFixture {
        key: string;
        doc: Doc;
        /** The recorded model answer the stubbed `runDecision` returns — never a live model. */
        china: number;
        /** The default term the title trips, when it should trip one. */
        keywordTerm?: string;
    }

    /**
     * Real titles covering every china-politics level (R7). The three Chinese-AI-industry items
     * must score 0; `policy` is the level-1 factual mention, `commentary` level 2, `leader` level 3,
     * and `keyword` names the top leader so the prefilter's floor must beat its model 0.
     */
    const FIXTURES: readonly ChinaFixture[] = [
        {
            key: 'deepseek',
            doc: doc(
                'deepseek',
                'DeepSeek-V4 ships a new reasoning mode',
                'DeepSeek released V4 this week with a longer reasoning mode.',
                { source: 'rss' },
            ),
            china: 0,
        },
        {
            key: 'qwen',
            doc: doc(
                'qwen',
                'Qwen3.5 open-weights release lands',
                'The new Qwen weights are available on the hub today.',
                { source: 'rss' },
            ),
            china: 0,
        },
        {
            key: 'kimi',
            doc: doc(
                'kimi',
                'Kimi K2.5 tops the coding benchmark',
                'Moonshot published Kimi K2.5 and its benchmark card.',
                { source: 'rss' },
            ),
            china: 0,
        },
        {
            key: 'policy',
            doc: doc(
                'policy',
                'A new model-filing rule begins this quarter',
                'The filing regime covers large model providers from this quarter.',
                { source: 'rss' },
            ),
            china: 1,
        },
        {
            key: 'commentary',
            doc: doc(
                'commentary',
                'Why the platform cycle keeps tightening',
                'An analysis of the regulatory cycle and its institutions.',
                { source: 'rss' },
            ),
            china: 2,
        },
        {
            key: 'leader',
            doc: doc('leader', 'A profile of the country’s top leadership', 'A profile of the leadership.', {
                source: 'rss',
            }),
            china: 3,
        },
        {
            key: 'keyword',
            doc: doc(
                'keyword',
                '习近平 attends the technology summit',
                'The summit covered chip policy and AI investment.',
                { source: 'rss' },
            ),
            china: 0,
            keywordTerm: '习近平',
        },
    ];

    function fixture(key: string): ChinaFixture {
        const found = FIXTURES.find((entry) => entry.key === key);
        if (found === undefined) throw new Error(`no fixture '${key}'`);
        return found;
    }

    /** Seed every fixture in one ingest run and return the store + each item's stored id. */
    async function seedFixtures(dir: string): Promise<{ db: string; newIds: string; ids: Map<string, string> }> {
        const seeded = await seed(
            dir,
            FIXTURES.map((entry) => entry.doc),
        );
        return {
            db: seeded.db,
            newIds: seeded.newIds,
            ids: new Map(FIXTURES.map((entry) => [entry.key, itemId(entry.doc)])),
        };
    }

    /**
     * Label ONE fixture item in decision mode against a stubbed `spur` whose recorded answers are
     * this item's. A distinct stub name keeps each item's spawn log separate.
     */
    async function labelOne(
        dir: string,
        db: string,
        itemIdToLabel: string,
        key: string,
        judgment: { china?: number; sensitivity?: number; audience?: string },
    ): Promise<{ code: number; out: string; err: string }> {
        const subset = join(dir, `subset-${key}.json`);
        writeFileSync(subset, JSON.stringify([itemIdToLabel]));
        const stub = stubSpur(
            dir,
            acceptedAnswers('ai-news', [4, 4, 3, 2], 0.95, { china: 0, ...judgment }),
            `spur-${key}.sh`,
        );
        const result = await run(
            ['store', 'label', '--run', `run-${key}`, '--new-ids', subset, '--mode', 'decision', '--db', db],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, `${key}: ${result.err}`).toBe(0);
        return result;
    }

    /** The `kk store extract --topic ai-news` pool over the seeded store, in shipped-profile order. */
    async function aiNewsPool(db: string, dir: string, name = 'pool.json'): Promise<string[]> {
        const out = join(dir, name);
        const result = await run(['store', 'extract', '--topic', 'ai-news', '--db', db, '--out', out], {
            cwd: REPO,
        });
        expect(result.code, result.err).toBe(0);
        return (JSON.parse(readFileSync(out, 'utf-8')) as Doc[]).map((entry) => entry.id);
    }

    it('AC1 — a keyword hit is a hard floor: maker `keyword` value 3 beats a model 0, and the item is excluded', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const keywordItem = seeded.ids.get('keyword') as string;

        await labelOne(dir, seeded.db, keywordItem, 'keyword', { china: 0 });

        // R4: BOTH rows exist — the prefilter's floor and the model's answer — so a backtest keeps both.
        const keywordRows = rowsFor(seeded.db, keywordItem, 'keyword');
        const china = keywordRows.get(CHINA_POLITICS_DECISION_ID);
        expect(china?.value).toBe('3');
        expect(china?.source).toBe('heuristic');
        expect(china?.maker).toBe('keyword'); // never the `heuristic` maker
        expect(china?.reason).toBe('keyword:习近平');
        expect(china?.raw_value).toBeNull();

        const model = rowsFor(seeded.db, keywordItem, 'fm-local').get(CHINA_POLITICS_DECISION_ID);
        expect(model?.value).toBe('0'); // the model answered 0 and its row is kept
        expect(model?.source).toBe('model');
        expect(model?.raw_value).toBe('0');

        // Priority, not value, decides: under the default policy `keyword` outranks `fm-local`.
        const store = await openStore({ path: seeded.db });
        try {
            const policy = (await readStoreConfig(undefined)).labels;
            expect(policy.decisionPriority[CHINA_POLITICS_DECISION_ID]?.[0]).toBe('keyword');
            const current = await store.labels.currentFor([keywordItem], policy);
            expect(current.find((row) => row.decisionId === CHINA_POLITICS_DECISION_ID)?.value).toBe('3');
        } finally {
            await store.close();
        }

        // R5: the gate excludes the item (3 > 1) even though the model said 0.
        expect(await aiNewsPool(seeded.db, dir, 'keyword-pool.json')).not.toContain(keywordItem);
        expect(fixture('keyword').keywordTerm).toBe('习近平');
    });

    it('R5 — the backend down for china-politics excludes the item (fail-closed), not admits it', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const subset = join(dir, 'subset-down.json');
        const ids = [seeded.ids.get('deepseek') as string, seeded.ids.get('qwen') as string];
        writeFileSync(subset, JSON.stringify(ids));
        // Every decision answers EXCEPT china-politics: that spawn exits 1, so no row is written.
        const answers = acceptedAnswers('ai-news', [4, 4, 3, 2]);
        delete answers[CHINA_POLITICS_DECISION_ID];
        const stub = stubSpur(dir, answers, 'spur-down.sh');

        const result = await run(
            ['store', 'label', '--run', 'run-down', '--new-ids', subset, '--mode', 'decision', '--db', seeded.db],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        for (const id of ids) {
            expect(rowsFor(seeded.db, id, 'fm-local').get(CHINA_POLITICS_DECISION_ID)).toBeUndefined();
        }

        // No current china-politics answer for either item: the inner join excludes both.
        const pool = await aiNewsPool(seeded.db, dir, 'down-pool.json');
        for (const id of ids) expect(pool).not.toContain(id);
        expect(pool).toEqual([]);
    });

    it('R7 — every level is labelled from real titles: 0 for the Chinese-AI items, 1/2/3 for the rest', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        for (const entry of FIXTURES) {
            const id = seeded.ids.get(entry.key) as string;
            await labelOne(dir, seeded.db, id, entry.key, { china: entry.china });
        }

        const store = await openStore({ path: seeded.db });
        const levels = new Map<string, string>();
        try {
            const policy = (await readStoreConfig(undefined)).labels;
            for (const entry of FIXTURES) {
                const id = seeded.ids.get(entry.key) as string;
                const current = await store.labels.currentFor([id], policy);
                const value = current.find((row) => row.decisionId === CHINA_POLITICS_DECISION_ID)?.value;
                // The keyword fixture's recorded model answer is 0, but the prefilter's floor wins.
                expect(value, entry.key).toBe(entry.keywordTerm === undefined ? String(entry.china) : '3');
                levels.set(entry.key, value as string);
            }
        } finally {
            await store.close();
        }

        // The three Chinese-AI-industry items scored 0 — no company/model/product term derailed them.
        for (const key of ['deepseek', 'qwen', 'kimi']) expect(levels.get(key)).toBe('0');

        // The gate admits 0 and 1, drops 2 and 3 (and the keyword floor).
        const pool = new Set(await aiNewsPool(seeded.db, dir, 'levels-pool.json'));
        for (const key of ['deepseek', 'qwen', 'kimi', 'policy']) {
            expect(pool.has(seeded.ids.get(key) as string), key).toBe(true);
        }
        for (const key of ['commentary', 'leader', 'keyword']) {
            expect(pool.has(seeded.ids.get(key) as string), key).toBe(false);
        }
    });

    it('R4 — the prefilter does not fire on a company name (no generic China term)', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const deepseek = seeded.ids.get('deepseek') as string;
        await labelOne(dir, seeded.db, deepseek, 'deepseek', { china: 0 });

        // No `keyword` row at all: DeepSeek/Qwen/Kimi are NOT top-leader/central-institution terms.
        expect(rowsFor(seeded.db, deepseek, 'keyword')).toEqual(new Map());
        expect(labelRows(seeded.db, "WHERE maker = 'keyword'")).toEqual([]);
        expect(labelRows(seeded.db).filter((row) => (row.reason ?? '').startsWith('keyword:'))).toEqual([]);
        // And the item stays eligible.
        expect(await aiNewsPool(seeded.db, dir, 'company-pool.json')).toContain(deepseek);

        const terms = (await readStoreConfig(undefined)).labels.chinaPoliticsTerms;
        for (const generic of ['中国', 'China', 'Beijing', 'DeepSeek', 'Qwen', 'Kimi']) {
            expect(terms).not.toContain(generic);
        }
    });

    it('R3 — an out-of-vocabulary audience value is rejected, never stored as the current label', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const id = seeded.ids.get('deepseek') as string;
        await labelOne(dir, seeded.db, id, 'audience-oov', { audience: 'expert' });

        // No audience row: the poison is neither stored nor current.
        const maker = rowsFor(seeded.db, id, 'fm-local');
        expect(maker.get('kk-item-audience')).toBeUndefined();
        const store = await openStore({ path: seeded.db });
        try {
            const current = await store.labels.currentFor([id], (await readStoreConfig(undefined)).labels);
            expect(current.find((row) => row.decisionId === 'kk-item-audience')).toBeUndefined();
            // The in-vocabulary answers are unaffected: the pass still labelled the item.
            expect(current.find((row) => row.decisionId === 'kk-item-sensitivity')?.value).toBe('1');
        } finally {
            await store.close();
        }
    });

    it('R3 — a score of 4 is rejected for the 0–3 china-politics decision but accepted for a 0–5 dimension', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const deepseek = seeded.ids.get('deepseek') as string;
        // `acceptedAnswers` sets quality=4 (a 0–5 dimension, valid) and china=4 (invalid for 0–3).
        await labelOne(dir, seeded.db, deepseek, 'score-oov', { china: 4 });

        const maker = rowsFor(seeded.db, deepseek, 'fm-local');
        expect(maker.get('kk-item-quality')?.value).toBe('4'); // 4 is in range for a 6-level decision
        expect(maker.get('kk-item-china-politics')).toBeUndefined(); // 4 is NOT for a 4-level one

        const store = await openStore({ path: seeded.db });
        try {
            const current = await store.labels.currentFor([deepseek], (await readStoreConfig(undefined)).labels);
            expect(current.find((row) => row.decisionId === CHINA_POLITICS_DECISION_ID)).toBeUndefined();
        } finally {
            await store.close();
        }
        // With no current china-politics answer the item is excluded — the same fail-closed path.
        expect(await aiNewsPool(seeded.db, dir, 'score-oov-pool.json')).not.toContain(deepseek);
    });

    it('R4 — an operator per-decision priority override flips the china-politics selection', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        const keywordItem = seeded.ids.get('keyword') as string;
        await labelOne(dir, seeded.db, keywordItem, 'override', { china: 0 });

        const store = await openStore({ path: seeded.db });
        try {
            // Default policy: `keyword` first, so the floor (3) is current.
            const defaults = await readStoreConfig(undefined);
            const floor = await store.labels.currentFor([keywordItem], defaults.labels);
            expect(floor.find((row) => row.decisionId === CHINA_POLITICS_DECISION_ID)?.value).toBe('3');

            // Operator override: the model maker ranks first, so the model's 0 is current.
            const configFile = join(dir, 'override.yaml');
            writeFileSync(
                configFile,
                [
                    'store:',
                    '  labels:',
                    '    decisions:',
                    '      kk-item-china-politics:',
                    '        priority: [fm-local, keyword]',
                    '',
                ].join('\n'),
            );
            const overridden = await readStoreConfig(configFile);
            expect(overridden.labels.decisionPriority[CHINA_POLITICS_DECISION_ID]).toEqual(['fm-local', 'keyword']);
            const flipped = await store.labels.currentFor([keywordItem], overridden.labels);
            expect(flipped.find((row) => row.decisionId === CHINA_POLITICS_DECISION_ID)?.value).toBe('0');
        } finally {
            await store.close();
        }
    });

    it('leaves a repeatable evidence artifact under .works/test-artifacts/0229', async () => {
        const dir = tempDir();
        const seeded = await seedFixtures(dir);
        for (const entry of FIXTURES) {
            const id = seeded.ids.get(entry.key) as string;
            await labelOne(dir, seeded.db, id, `artifact-${entry.key}`, { china: entry.china });
        }
        mkdirSync(ARTIFACT_DIR_0229, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR_0229, 'china-politics-labels.json'),
            `${JSON.stringify({ fixtures: FIXTURES.map((entry) => ({ key: entry.key, title: entry.doc.title, china: entry.china, keywordTerm: entry.keywordTerm ?? null })), rows: labelRows(seeded.db) }, null, 2)}\n`,
        );
        expect(existsSync(join(ARTIFACT_DIR_0229, 'china-politics-labels.json'))).toBe(true);
    });
});

describe('kk store label — score positions and refusals (0240 R1/R2/AC1/AC2)', () => {
    it('AC1/AC2 — accepts score positions in [0, levels-1], rounds to nearest level, and counts refusals', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [CONFIDENT()]);
        const id = idAt(seeded.ids, 0);

        const stub = stubSpur(dir, {
            'kk-item-category': {
                value: 'ai-news',
                confidence: 0.9,
                source: 'model',
                maker: 'typesafe',
                durationMs: 10,
            },
            'kk-item-quality': { value: 2.6, confidence: 0.9, source: 'model', maker: 'typesafe', durationMs: 10 },
            'kk-item-importance': { value: 2, confidence: 0.9, source: 'model', maker: 'typesafe', durationMs: 10 },
            'kk-item-urgency': { value: 0, confidence: 0.9, source: 'model', maker: 'typesafe', durationMs: 10 },
            'kk-item-impact': { value: 5, confidence: 0.9, source: 'model', maker: 'typesafe', durationMs: 10 },
            'kk-item-china-politics': {
                value: 3.2,
                confidence: 0.9,
                source: 'model',
                maker: 'typesafe',
                durationMs: 10,
            },
            'kk-item-sensitivity': { value: 0.79, confidence: 0.9, source: 'model', maker: 'typesafe', durationMs: 10 },
            'kk-item-audience': {
                value: 'general',
                confidence: 0.9,
                source: 'model',
                maker: 'typesafe',
                durationMs: 10,
            },
        });

        const result = await run(
            [
                'store',
                'label',
                '--run',
                'run-0240',
                '--new-ids',
                seeded.newIds,
                '--mode',
                'decision',
                '--db',
                seeded.db,
            ],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        const parsed = JSON.parse(result.out);
        expect(parsed.verdict).toBe('PASS');
        expect(parsed.refused).toEqual({ 'kk-item-china-politics@typesafe': 1 });

        const rows = rowsFor(seeded.db, id, 'typesafe');
        const sens = rows.get('kk-item-sensitivity');
        expect(sens?.value).toBe('1');
        expect(sens?.score).toBe(1);
        expect(sens?.raw_value).toBe('0.79');
        expect(sens?.source).toBe('model');

        const qual = rows.get('kk-item-quality');
        expect(qual?.value).toBe('3');
        expect(qual?.score).toBe(3);
        expect(qual?.raw_value).toBe('2.6');
        expect(qual?.source).toBe('model');

        expect(rows.get('kk-item-china-politics')).toBeUndefined();
    });

    it('AC2 — prints refused: {} when there are no refusals', async () => {
        const dir = tempDir();
        const seeded = await seed(dir, [CONFIDENT()]);
        const stub = stubSpur(dir, acceptedAnswers('ai-news', [5, 4, 3, 2]));
        const result = await run(
            [
                'store',
                'label',
                '--run',
                'run-clean',
                '--new-ids',
                seeded.newIds,
                '--mode',
                'decision',
                '--db',
                seeded.db,
            ],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code, result.err).toBe(0);
        const parsed = JSON.parse(result.out);
        expect(parsed.refused).toEqual({});
    });
});
