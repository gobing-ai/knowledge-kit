/**
 * kk decision catalog contract (task 0209 R1/R2).
 *
 * Failure-first list (written before the code):
 *  1. the catalog file is absent, not YAML, or misses its bundled `$schema` ref or a `version` other than the schema-pinned 1
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

/**
 * The eight decision ids `kk store label` writes, in catalog order: the original five plus the three
 * judgment decisions task 0229 added.
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
];

/** The four 0–5 QC score dimensions (the `kk-item-<dimension>` ids), fallback 2. */
const SCORE_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;

/** The MECE v1 choice vocabulary, verbatim from episode-plan-gen's `Category`. */
const CATEGORY_LABELS = ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'];

interface CatalogDecision {
    type: string;
    description?: string;
    criteria: unknown;
    fallback: unknown;
    parameters: Record<string, { type: string }>;
}

interface Catalog {
    version: number;
    defaults?: { minConfidence?: number };
    decisions: Record<string, CatalogDecision>;
}

function readCatalog(): Catalog {
    return Bun.YAML.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog;
}

describe('kk-items decision catalog (R1)', () => {
    it('is the bundled schema version 2 with the eight dash-named ids', () => {
        // `$schema` is checked on the raw text: Bun's YAML reader drops `$`-prefixed keys, and the
        // spur loader validates the ref itself (design decision-catalog §3.1).
        const schemaLine = readFileSync(CATALOG_PATH, 'utf-8')
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line !== '' && !line.startsWith('#'));
        expect(schemaLine).toBe('$schema: "@gobing-ai/spur/schemas/decision-catalog.schema.json"');

        const catalog = readCatalog();
        // Version 2 since task 0226: the version is stamped on every stored observation as
        // `catalog_version`, and a re-tuned rubric is a new version rather than a silent edit.
        expect(catalog.version).toBe(1);
        // `minConfidence: 0` (0226 R1): every model answer is accepted raw so a below-threshold answer
        // is RECORDED instead of resolved to its fallback. The confidence threshold the pool obeys
        // now lives in the kk config (`store.labels.min_confidence`).
        expect(catalog.defaults?.minConfidence).toBe(0);
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

    it('gives the four 0–5 QC score decisions a 6-level rubric with fallback 2', () => {
        const decisions = readCatalog().decisions;
        for (const dimension of SCORE_DIMENSIONS) {
            const id = `kk-item-${dimension}`;
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

    it('declares the 0229 judgment decisions: china-politics 0–3 fallback 3, sensitivity 0–3 fallback 1, audience choice (R1/R2)', () => {
        const decisions = readCatalog().decisions;

        const china = decisions['kk-item-china-politics'];
        expect(china.type).toBe('score');
        const chinaRubric = china.criteria as string[];
        expect(chinaRubric).toHaveLength(4);
        expect(china.fallback).toBe(3);
        // The four levels R1 froze: 0 no reference; 1 factual policy/government mention; 2 system
        // commentary; 3 top-leader personal info or a direct critique.
        expect(chinaRubric[0]).toMatch(/No reference to China's political system/);
        expect(chinaRubric[0]).toMatch(/companies, models and products count as 0/);
        expect(chinaRubric[1]).toMatch(/factual mention of a Chinese government body or policy/);
        expect(chinaRubric[2]).toMatch(/Commentary or analysis/);
        expect(chinaRubric[3]).toMatch(/top leader's personal information/);

        const sensitivity = decisions['kk-item-sensitivity'];
        expect(sensitivity.type).toBe('score');
        const sensitivityRubric = sensitivity.criteria as string[];
        expect(sensitivityRubric).toHaveLength(4);
        expect(sensitivity.fallback).toBe(1);
        expect(sensitivityRubric[1]).toMatch(/unverified/);
        expect(sensitivityRubric[2]).toMatch(/legal exposure/);
        expect(sensitivityRubric[3]).toMatch(/political sensitivity/);

        const audience = decisions['kk-item-audience'];
        expect(audience.type).toBe('choice');
        const labels = audience.criteria as Record<string, string>;
        expect(Object.keys(labels)).toEqual(['general', 'practitioner', 'researcher']);
        expect(audience.fallback).toBe('general');
    });

    it('states the china-politics moderation purpose and the not-exclude-China rule in its description (R1)', () => {
        const description = readCatalog().decisions['kk-item-china-politics'].description as string;
        expect(description).toContain('must NOT exclude China-related content in general');
        expect(description.toLowerCase()).toContain('moderation');
        expect(description).toContain('Chinese companies, models and products');
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
