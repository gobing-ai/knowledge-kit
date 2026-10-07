/**
 * kk decision catalog contract (task 0209 R1/R2).
 *
 * Failure-first list (written before the code):
 *  1. the catalog file is absent, not YAML, or misses its bundled `$schema` ref or `version: 1`
 *     (the loader would reject it before any decision is served);
 *  2. an id outside `^[a-z][a-z0-9_-]*$` — the loader's `propertyNames` pattern, so an
 *     underscore- or upper-cased id never loads;
 *  3. an id set other than the five labels `kk store label` writes — a missing or extra
 *     decision means a silently unlabeled column;
 *  4. the choice criteria not carrying exactly the MECE v1 vocabulary, or the fallback not
 *     being one of its labels (the `source: default` value would be out of vocabulary);
 *  5. a score rubric without levels 0–5, or a fallback outside `0..levels-1`;
 *  6. a decision that declares no `title`/`source` string parameter — `kk store label` passes
 *     both, and an undeclared parameter makes `spur decision run` exit 1 (a caller mistake);
 *  7. `.spur/config.yaml` not registering `plugins/kk/decisions`, which would leave the
 *     catalog in no served layer at all.
 *
 * The real load check (`spur decision status --json` → `ok: true`, empty `loadErrors`) is
 * exercised by the task's verify step; this test pins the file contract hermetically.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const CATALOG_PATH = join(REPO, 'plugins/kk/decisions/kk-items.yaml');
const CONFIG_PATH = join(REPO, '.spur/config.yaml');

/** The five decision ids `kk store label` labels every routed item with, in catalog order. */
const DECISION_IDS = ['kk-item-category', 'kk-item-quality', 'kk-item-importance', 'kk-item-urgency', 'kk-item-impact'];

/** The MECE v1 choice vocabulary, verbatim from episode-plan-gen's `Category`. */
const CATEGORY_LABELS = ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'];

interface CatalogDecision {
    type: string;
    criteria: unknown;
    fallback: unknown;
    parameters: Record<string, { type: string }>;
}

interface Catalog {
    version: number;
    decisions: Record<string, CatalogDecision>;
}

function readCatalog(): Catalog {
    return Bun.YAML.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog;
}

describe('kk-items decision catalog (R1)', () => {
    it('is the bundled schema version 1 with the five dash-named ids', () => {
        // `$schema` is checked on the raw text: Bun's YAML reader drops `$`-prefixed keys, and the
        // spur loader validates the ref itself (design decision-catalog §3.1).
        const schemaLine = readFileSync(CATALOG_PATH, 'utf-8')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '' && !line.startsWith('#'));
        expect(schemaLine).toBe('$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"');

        const catalog = readCatalog();
        expect(catalog.version).toBe(1);
        expect(Object.keys(catalog.decisions)).toEqual(DECISION_IDS);
        for (const id of Object.keys(catalog.decisions)) {
            expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
    });

    it('declares the MECE choice vocabulary with non-ai as its fallback', () => {
        const category = readCatalog().decisions['kk-item-category'];
        expect(category.type).toBe('choice');
        const criteria = category.criteria as Record<string, string>;
        expect(Object.keys(criteria)).toEqual(CATEGORY_LABELS);
        for (const description of Object.values(criteria)) {
            expect(description.length).toBeGreaterThan(10);
        }
        expect(category.fallback).toBe('non-ai');
        expect(CATEGORY_LABELS).toContain(category.fallback);
    });

    it('gives every score decision a 6-level rubric (0–5) with fallback 2', () => {
        const decisions = readCatalog().decisions;
        for (const id of DECISION_IDS.filter((decisionId) => decisionId !== 'kk-item-category')) {
            const decision = decisions[id];
            expect(decision.type, id).toBe('score');
            const rubric = decision.criteria as string[];
            expect(Array.isArray(rubric), id).toBe(true);
            expect(rubric.length, id).toBe(6);
            for (const level of rubric) {
                expect(typeof level, id).toBe('string');
                expect(level.length, id).toBeGreaterThan(10);
            }
            expect(decision.fallback, id).toBe(2);
            expect(decision.fallback as number).toBeGreaterThanOrEqual(0);
            expect(decision.fallback as number).toBeLessThan(rubric.length);
        }
    });

    it('declares the title and source string parameters every kk label call passes', () => {
        const decisions = readCatalog().decisions;
        for (const id of DECISION_IDS) {
            expect(Object.keys(decisions[id].parameters).sort(), id).toEqual(['source', 'title']);
            expect(decisions[id].parameters.title.type, id).toBe('string');
            expect(decisions[id].parameters.source.type, id).toBe('string');
        }
    });
});

describe('kk-items decision catalog registration (R2)', () => {
    it('registers plugins/kk/decisions in .spur/config.yaml decisions.paths', () => {
        const config = Bun.YAML.parse(readFileSync(CONFIG_PATH, 'utf-8')) as {
            decisions?: { paths?: string[] };
        };
        expect(config.decisions?.paths).toEqual(['plugins/kk/decisions']);
    });
});
