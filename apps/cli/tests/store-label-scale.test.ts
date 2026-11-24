/**
 * Task 0317 R1/AC1 — the score scale model and heuristic answers share.
 *
 * ## Failure-first list — written before the assertions
 *
 *  1. A model answer on the catalog's rubric index is stored shifted (`level + 1`) while the
 *     heuristic writes its own level, so two rows for one dimension are not comparable.
 *  2. The rubric's level count drifts from the catalog (`LABEL_DECISIONS.levels` ≠ criteria length),
 *     so a valid model answer is refused or an impossible one accepted.
 *  3. The heuristic emits a level outside the catalog's ladder, which would make "same scale" false.
 *  4. A catalog fallback points outside its own ladder.
 *
 * Evidence for "no shift is needed": `scoreDimensions` in
 * `plugins/generations/episode-plan-gen/src/index.ts` and the four `kk-item-*` rubrics in
 * `plugins/kk/decisions/kk-items.yaml` describe the same ladder index for index — rubric 0 is the
 * "no signal" level only a model can answer, and 1..5 coincide with the heuristic's emitted values.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const CATALOG_PATH = join(REPO, 'plugins/kk/decisions/kk-items.yaml');

/** The four graded dimensions, in catalog order. */
const SCORE_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;

const tempDirs: string[] = [];

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-store-scale-')));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.KK_DECISION_HUB;
    delete process.env.KK_DECISION_HUB_ANSWERS;
    delete process.env.KK_DECISION_HUB_SPAWNS;
});

interface CatalogDecision {
    type: string;
    criteria?: unknown;
    fallback: unknown;
}

/** The catalog as an object, parsed with Bun's YAML reader (the loader `kk` itself uses). */
function catalog(): Record<string, CatalogDecision> {
    const parsed = Bun.YAML.parse(readFileSync(CATALOG_PATH, 'utf-8')) as {
        decisions: Record<string, CatalogDecision>;
    };
    return parsed.decisions;
}

describe('kk store label — the shared 0..5 score ladder (0317 R1/AC1)', () => {
    it('AC1 — every graded rubric declares the levels the label table validates against', () => {
        const decisions = catalog();
        for (const dimension of SCORE_DIMENSIONS) {
            const decision = decisions[`kk-item-${dimension}`];
            expect(decision, dimension).toBeDefined();
            expect(decision?.type).toBe('score');
            expect(Array.isArray(decision?.criteria)).toBe(true);
            // 6 rubric levels, i.e. answers 0..5 — the ladder `LABEL_DECISIONS` declares (`levels: 6`).
            expect(((decision?.criteria ?? []) as unknown[]).length).toBe(6);
            const fallback = Number(decision?.fallback);
            expect(Number.isInteger(fallback)).toBe(true);
            expect(fallback).toBeGreaterThanOrEqual(0);
            expect(fallback).toBeLessThanOrEqual(5);
        }
    });

    it('AC1 — a model level is stored as the same integer the heuristic writes for that rubric line', async () => {
        const heuristicDoc: Doc = {
            id: 'scale-heuristic',
            title: 'A short report',
            body: 'x'.repeat(400),
            sourceUri: 'https://example.com/scale-heuristic',
            metadata: { source: 'rss' },
        };
        const modelDoc: Doc = { ...heuristicDoc, id: 'scale-model', sourceUri: 'https://example.com/scale-model' };
        const dir = tempDir();
        const db = join(dir, 'kk.db');
        const input = join(dir, 'docs.json');
        const newIds = join(dir, 'ids.json');
        writeFileSync(input, JSON.stringify([heuristicDoc, modelDoc]));
        const ingest = await runKk([
            'store',
            'ingest',
            '--run',
            'run-scale',
            '--in',
            input,
            '--new-ids',
            newIds,
            '--db',
            db,
        ]);
        expect(ingest.code, ingest.err).toBe(0);
        const ids = JSON.parse(readFileSync(newIds, 'utf-8')) as string[];
        const modelItem = ids[1];
        if (modelItem === undefined) throw new Error('seed did not produce two item ids');
        // Both items are labelled in one pass: the model item carries the model answers, the
        // heuristic item is the baseline written from the plugin's own keyword scoring.
        const subset = join(dir, 'subset.json');
        writeFileSync(subset, JSON.stringify(ids));

        // The model answers BOTH ends of the ladder: 0 (its own "no signal" level) and 5 (the top).
        for (const level of [0, 5]) {
            const answers = join(dir, `answers-${level}.json`);
            writeFileSync(
                answers,
                JSON.stringify({
                    '*': { value: level, confidence: 0.9, source: 'model', reason: 'accepted', maker: 'fm-local' },
                    'kk-item-category': {
                        value: 'ai-news',
                        confidence: 0.9,
                        source: 'model',
                        reason: 'accepted',
                        maker: 'fm-local',
                    },
                    'kk-item-audience': {
                        value: 'general',
                        confidence: 0.9,
                        source: 'model',
                        reason: 'accepted',
                        maker: 'fm-local',
                    },
                }),
            );
            const labeled = await runKk(
                [
                    'store',
                    'label',
                    '--run',
                    `run-scale-${level}`,
                    '--new-ids',
                    subset,
                    '--mode',
                    'decision',
                    '--db',
                    db,
                ],
                { KK_DECISION_HUB_ANSWERS: answers },
            );
            expect(labeled.code, labeled.err).toBe(0);
        }

        const rows = readRows(db);
        for (const level of [0, 5]) {
            for (const dimension of SCORE_DIMENSIONS) {
                const row = rows.find(
                    (candidate) =>
                        candidate.run_id === `run-scale-${level}` &&
                        candidate.item_id === modelItem &&
                        candidate.decision_id === `kk-item-${dimension}` &&
                        candidate.maker === 'fm-local',
                );
                // No shift: the stored value and score equal the rubric index the model answered.
                expect(row?.value, `level ${level} ${dimension}`).toBe(String(level));
                expect(row?.score, `level ${level} ${dimension}`).toBe(level);
            }
        }

        // The heuristic writes its own level on the SAME ladder: a 400-char rss body carrying a
        // source URL is rubric line 2 — one step for the body length, one for the sourcedness bonus
        // `scoreDimensions` grants a substantiated sourced body (2026-11-23: the label pass stopped
        // dropping `sourceUri`, so that bonus applies) — and `kk-item-importance` is 3 for a ranked
        // rss feed. Neither is shifted, so a model level and a heuristic level mean the same line.
        const heuristicQuality = rows.find(
            (row) => row.run_id === 'run-scale-0' && row.item_id === ids[0] && row.decision_id === 'kk-item-quality',
        );
        expect(heuristicQuality?.value).toBe('2');
        expect(heuristicQuality?.score).toBe(2);
        const heuristicImportance = rows.find(
            (row) => row.run_id === 'run-scale-0' && row.item_id === ids[0] && row.decision_id === 'kk-item-importance',
        );
        expect(heuristicImportance?.value).toBe('3');
        expect(heuristicImportance?.score).toBe(3);
    });
});

interface LabelRow {
    run_id: string;
    item_id: string;
    decision_id: string;
    value: string;
    score: number | null;
    maker: string;
}

function readRows(db: string): LabelRow[] {
    const raw = new Database(db, { readonly: true });
    try {
        return raw
            .query(
                `SELECT run_id, item_id, decision_id, value, score, maker FROM labels
                 WHERE run_id IN ('run-scale-0', 'run-scale-5') ORDER BY run_id, decision_id`,
            )
            .all() as LabelRow[];
    } finally {
        raw.close();
    }
}

async function runKk(
    args: string[],
    env: { KK_DECISION_HUB_ANSWERS?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    const previous = {
        hub: process.env.KK_DECISION_HUB,
        answers: process.env.KK_DECISION_HUB_ANSWERS,
        spawns: process.env.KK_DECISION_HUB_SPAWNS,
    };
    process.env.KK_DECISION_HUB = join(import.meta.dir, 'fixtures/decision-hub-stub.ts');
    if (env.KK_DECISION_HUB_ANSWERS !== undefined) {
        process.env.KK_DECISION_HUB_ANSWERS = env.KK_DECISION_HUB_ANSWERS;
        process.env.KK_DECISION_HUB_SPAWNS = `${env.KK_DECISION_HUB_ANSWERS}.spawns.log`;
    }
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
        for (const [key, value] of [
            ['KK_DECISION_HUB', previous.hub],
            ['KK_DECISION_HUB_ANSWERS', previous.answers],
            ['KK_DECISION_HUB_SPAWNS', previous.spawns],
        ] as const) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}
