import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    buildCompactEvidencePacket,
    type DecisionStubHandler,
    executeDecisionRun,
    executeSeoJudgeStage,
    validateAndNormalizeDecisionResult,
} from '../scripts/seo-decisions';
import type { PageRecord } from '../scripts/seo-facts';
import { seoJudge } from '../scripts/seo-stages';

// seo-stages.ts ships as a node-builtin-only script, so console.error IS its progress channel.
// Mute it per test so in-process stage runs don't pollute the test reporter.
let stageProgress: { mockRestore(): void };
beforeEach(() => {
    stageProgress = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => stageProgress.mockRestore());

// Real `spur decision run` children inherit this env. Without it every test run wrote its
// deliberate input rejections and live-maker fallbacks into the project's .spur/spur.db, where
// they showed up on the Board observability page as production decision failures.
const testDbDir = mkdtempSync(join(tmpdir(), 'kk-seo-decisions-db-'));
const savedDatabaseUrl = process.env.DATABASE_URL;
beforeAll(() => {
    process.env.DATABASE_URL = join(testDbDir, 'spur.db');
});
afterAll(() => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    rmSync(testDbDir, { recursive: true, force: true });
});

describe('Smart SEO Catalogs and Declarations (R1 / AC1)', () => {
    it('verifies the existence and validity of all four flat catalogs', () => {
        const catalogFiles = [
            'plugins/kk/decisions/kk-seo-site.yaml',
            'plugins/kk/decisions/kk-seo-page.yaml',
            'plugins/kk/decisions/kk-seo-pair.yaml',
            'plugins/kk/decisions/kk-seo-keyword.yaml',
        ];

        for (const file of catalogFiles) {
            const p = resolve(file);
            expect(existsSync(p)).toBe(true);
            const content = readFileSync(p, 'utf-8');
            expect(content).toContain('version: 1');
            expect(content).toContain('minConfidence: 0');
        }
    });

    it('verifies spur decision list loads all 22 decisions across the catalogs', () => {
        const proc = Bun.spawnSync(['spur', 'decision', 'list', '--json'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(0);
        const list = JSON.parse(proc.stdout.toString());
        const seoDecisions = list.filter((d: { id: string }) => d.id.startsWith('kk-seo-'));
        expect(seoDecisions.length).toBe(22);

        // Verify key decisions exist
        const ids = seoDecisions.map((d: { id: string }) => d.id);
        expect(ids).toContain('kk-seo-business-model');
        expect(ids).toContain('kk-seo-page-type');
        expect(ids).toContain('kk-seo-intent-overlap');
        expect(ids).toContain('kk-seo-keyword-page');
    });
});

describe('Compact Evidence Packet Serialization (R1)', () => {
    it('ensures compact evidence packets never exceed 1,800 UTF-16 units even with large multibyte text', () => {
        const largeText = '这是用于测试的多字节长文本段落。'.repeat(300); // ~4800 chars
        const mockPage: PageRecord = {
            subjectId: 'p-large',
            url: 'https://example.com/large',
            status: 200,
            availability: 'available',
            redirectChain: [],
            evidencePath: null,
            evidenceHash: null,
            facts: {
                url: 'https://example.com/large',
                title: '大标题 '.repeat(100),
                titleCount: 1,
                metaDescription: '长描述 '.repeat(100),
                metaDescriptionCount: 1,
                canonical: 'https://example.com/large',
                robotsDirectives: [],
                viewport: 'width=device-width',
                lang: 'zh',
                headings: [{ level: 1, text: '主标题 '.repeat(50) }],
                h1Count: 1,
                images: [],
                links: [],
                openGraph: {},
                hreflang: [],
                jsonLd: [],
                wordCount: 2000,
                textSample: largeText,
                ttfbMs: 150,
                htmlByteLength: 50000,
                isRawHtmlShell: false,
            },
            error: null,
        };

        const { factsJson, excerptJson } = buildCompactEvidencePacket(mockPage, 'https://example.com');
        expect(factsJson.length).toBeLessThanOrEqual(1800);
        expect(excerptJson.length).toBeLessThanOrEqual(1800);

        const parsedExcerpt = JSON.parse(excerptJson);
        expect(parsedExcerpt.truncated).toBe(true);

        // Exercise secondary truncation branch when initial JSON is > 1800
        const extremePage: PageRecord = {
            ...mockPage,
            facts: mockPage.facts
                ? {
                      ...mockPage.facts,
                      title: 'T'.repeat(1200),
                      metaDescription: 'M'.repeat(1200),
                  }
                : null,
        };
        const res2 = buildCompactEvidencePacket(extremePage, 'https://example.com');
        expect(res2.factsJson.length).toBeLessThanOrEqual(1800);

        // Exercise excerptJson secondary truncation
        const longOrigin = `https://${'a'.repeat(1600)}.com`;
        const res3 = buildCompactEvidencePacket(mockPage, longOrigin);
        expect(res3.excerptJson.length).toBeLessThanOrEqual(1800);
    });
});

describe('Outcome Validation and Qualification (R2 / AC2)', () => {
    it('qualifies model decisions only when confidence threshold is satisfied', () => {
        // High confidence model choice -> qualified
        const q1 = validateAndNormalizeDecisionResult('kk-seo-page-type', 'p1', 'https://example.com/p1', {
            type: 'choice',
            value: 'article',
            confidence: 0.9,
            source: 'model',
            maker: 'claude',
            reason: 'Clear editorial blog structure',
        });
        expect(q1.qualified).toBe(true);
        expect(q1.value).toBe('article');

        // Low confidence model choice -> not qualified (review)
        const q2 = validateAndNormalizeDecisionResult('kk-seo-page-type', 'p1', 'https://example.com/p1', {
            type: 'choice',
            value: 'article',
            confidence: 0.65,
            source: 'model',
            maker: 'claude',
            reason: 'Uncertain signals',
        });
        expect(q2.qualified).toBe(false);

        // Fallback or default source -> never qualified
        const q3 = validateAndNormalizeDecisionResult('kk-seo-page-type', 'p1', 'https://example.com/p1', {
            type: 'choice',
            value: 'unclear',
            confidence: 0,
            source: 'default',
            maker: 'fallback',
            reason: 'Decision backend unavailable',
        });
        expect(q3.qualified).toBe(false);
        expect(q3.source).toBe('default');

        // Noul probability threshold (>= 0.8 or <= 0.2)
        const q4 = validateAndNormalizeDecisionResult('kk-seo-entity-clarity', 's1', 'https://example.com', {
            type: 'noul',
            noul: true,
            probability: 0.85,
            source: 'model',
            maker: 'claude',
        });
        expect(q4.qualified).toBe(true);

        const q5 = validateAndNormalizeDecisionResult('kk-seo-entity-clarity', 's1', 'https://example.com', {
            type: 'noul',
            noul: false,
            probability: 0.5,
            source: 'model',
            maker: 'claude',
        });
        expect(q5.qualified).toBe(false);
    });

    it('handles stub errors and malformed output safely without throwing', () => {
        const errorStub: DecisionStubHandler = () => {
            throw new Error('Simulated backend timeout');
        };

        const res = executeDecisionRun('kk-seo-business-model', { subject_id: 's1' }, [], { stub: errorStub });
        expect(res.source).toBe('fallback');
        expect(res.qualified).toBe(false);
        expect(res.reason).toContain('Simulated backend timeout');
    });
});

describe('Stage Execution: seo-judge (R1, R2 / AC1, AC2)', () => {
    // OS tmpdir, like every other suite here: scratch inside the repo tree would sit in the
    // pipeline's proof-input digest and drift it on each gate run.
    const testDir = mkdtempSync(join(tmpdir(), 'kk-seo-judge-'));
    const workDir = join(testDir, 'workdir');
    const fixtureCrawl = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');

    beforeAll(() => {
        mkdirSync(workDir, { recursive: true });
        const opt = {
            url: 'https://example.com/',
            locale: 'en-US',
            business_context: 'B2B developer tools',
            semantic_pages: 5,
            max_decision_calls: 50,
        };
        const man = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'judge-run-1',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            stage: 'collect',
            options: opt,
        };
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(opt));
        writeFileSync(join(workDir, 'manifest.json'), JSON.stringify(man));
        writeFileSync(join(workDir, 'crawl.json'), readFileSync(fixtureCrawl, 'utf-8'));
    });

    afterAll(() => {
        try {
            rmSync(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('executes seo-judge stage with stubs, writes judgments.json, and suppresses inapplicable questions', async () => {
        const mockStub: DecisionStubHandler = (id) => {
            if (id === 'kk-seo-business-model') {
                return { type: 'choice', value: 'software', confidence: 0.95, source: 'model', maker: 'stub-model' };
            }
            if (id.includes('overlap')) {
                return { type: 'noul', value: false, probability: 0.1, source: 'model', maker: 'stub-model' };
            }
            return { type: 'score', value: 2, confidence: 0.85, source: 'model', maker: 'stub-model' };
        };

        await seoJudge([workDir], { stub: mockStub });

        const judgmentsPath = join(workDir, 'judgments.json');
        expect(existsSync(judgmentsPath)).toBe(true);

        const data = JSON.parse(readFileSync(judgmentsPath, 'utf-8'));
        expect(data.schemaVersion).toBe(1);
        expect(data.status).toBe('complete');
        expect(data.entries.length).toBeGreaterThan(0);
        expect(data.summary.totalCalls).toBeGreaterThan(0);

        // Verify deterministic homepage type
        const homeType = data.entries.find((e: { id: string }) => e.id === 'kk-seo-page-type');
        expect(homeType?.value).toBe('homepage');
        expect(homeType?.maker).toBe('deterministic');
        // A rule-derived answer must never carry model provenance (R2).
        expect(homeType?.source).toBe('deterministic');

        // Check site business model
        const bm = data.entries.find((e: { id: string }) => e.id === 'kk-seo-business-model');
        expect(bm?.value).toBe('software');
        expect(bm?.qualified).toBe(true);
    });

    it('executes real child process spur decision run when no stub is provided and handles failure', () => {
        // A live maker may answer slowly; bound the child well inside the test budget so either the
        // answer or the timeout fallback lands deterministically.
        const real = executeDecisionRun('kk-seo-business-model', { subject_id: 'example.com', locale: 'en-US' }, [], {
            timeoutMs: 2000,
        });
        expect(real.id).toBe('kk-seo-business-model');
        expect(real.source).toBeDefined();

        // Exercise spawn error fallback
        const failRun = executeDecisionRun(
            'kk-seo-business-model',
            { subject_id: 'example.com', locale: 'en-US' },
            [],
            {
                spurBin: 'nonexistent-spur-bin-xyz',
            },
        );
        expect(failRun.source).toBe('fallback');
        expect(failRun.qualified).toBe(false);
    });

    it('records a timed-out decision child as a fallback instead of a stage cancellation', () => {
        // spawnSync kills a timed-out child with SIGTERM — the same signal an operator cancel uses.
        const binDir = mkdtempSync(join(tmpdir(), 'kk-seo-slow-spur-'));
        const slowSpur = join(binDir, 'slow-spur');
        writeFileSync(slowSpur, '#!/bin/sh\nsleep 5\n', { mode: 0o755 });
        try {
            const res = executeDecisionRun('kk-seo-business-model', { subject_id: 'example.com' }, [], {
                spurBin: slowSpur,
                timeoutMs: 200,
            });
            expect(res.source).toBe('fallback');
            expect(res.qualified).toBe(false);
            expect(res.reason).toMatch(/timed out/);
        } finally {
            rmSync(binDir, { recursive: true, force: true });
        }
    });

    it('respects max_decision_calls cap and marks stage partial on exhaustion', async () => {
        const capDir = join(testDir, 'cap-workdir');
        mkdirSync(capDir, { recursive: true });
        const capOpt = {
            url: 'https://example.com/',
            locale: 'en-US',
            business_context: 'Testing',
            semantic_pages: 5,
            max_decision_calls: 2, // strictly capped
        };
        const capMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'cap-run-1',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            stage: 'collect',
            options: capOpt,
        };
        writeFileSync(join(capDir, 'options.json'), JSON.stringify(capOpt));
        writeFileSync(join(capDir, 'manifest.json'), JSON.stringify(capMan));
        writeFileSync(join(capDir, 'crawl.json'), readFileSync(fixtureCrawl, 'utf-8'));

        const mockStub: DecisionStubHandler = () => ({ type: 'score', value: 1, source: 'model', confidence: 0.9 });
        const res = await executeSeoJudgeStage(capDir, { stub: mockStub });
        expect(res.status).toBe('partial');
        expect(res.summary.totalCalls).toBe(2);
        // The deterministic homepage entry is not a call, so it never inflates the qualified tally.
        expect(res.summary.qualifiedCalls).toBe(2);
    });

    it('validates CLI arguments for seo-judge and supports visibility snapshots', async () => {
        await expect(seoJudge([])).rejects.toThrow(/usage/);
        await expect(seoJudge(['nonexistent-dir'])).rejects.toThrow(/missing crawl.json/);

        const visDir = join(testDir, 'vis-workdir');
        mkdirSync(visDir, { recursive: true });
        const visSnapshot = join(visDir, 'visibility.json');
        writeFileSync(
            visSnapshot,
            JSON.stringify({
                schemaVersion: 1,
                siteOrigin: 'https://example.com',
                locale: 'en-US',
                source: 'test-gsc',
                collectedAt: '2026-10-15T00:00:00Z',
                measurementKind: 'measured',
                rows: [
                    { query: 'seo audit tool', url: 'https://example.com/', clicks: 50, impressions: 500, position: 3 },
                ],
            }),
            'utf-8',
        );

        const visOpt = {
            url: 'https://example.com/',
            locale: 'en-US',
            visibility_file: visSnapshot,
            semantic_pages: 5,
        };
        const visMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'vis-run-1',
            createdAt: new Date().toISOString(),
            inputDigest: 'v123',
            stage: 'collect',
            options: visOpt,
        };
        const multiPageCrawl = {
            ...JSON.parse(readFileSync(fixtureCrawl, 'utf-8')),
            pages: [
                JSON.parse(readFileSync(fixtureCrawl, 'utf-8')).pages[0],
                {
                    ...JSON.parse(readFileSync(fixtureCrawl, 'utf-8')).pages[0],
                    subjectId: 'p2',
                    url: 'https://example.com/page2',
                },
            ],
        };
        writeFileSync(join(visDir, 'options.json'), JSON.stringify(visOpt));
        writeFileSync(join(visDir, 'manifest.json'), JSON.stringify(visMan));
        writeFileSync(join(visDir, 'crawl.json'), JSON.stringify(multiPageCrawl));

        const mockStub: DecisionStubHandler = () => ({ type: 'score', value: 3, source: 'model', confidence: 0.9 });
        await seoJudge([visDir], { stub: mockStub });
        expect(existsSync(join(visDir, 'judgments.json'))).toBe(true);
    });
});

/**
 * The four SEO catalogs declare exactly `subject_id` and `locale` (plus `candidates` on
 * kk-seo-keyword-page), and spur rejects an undeclared `--param` before any maker runs. Forwarding
 * a non-parameter (the page URL travelled as `url`) therefore degraded every page and pair judgment
 * to `source: fallback` while the stage still reported success. The shim below enforces spur's
 * contract so that class of caller mistake fails here instead of in a real audit.
 */
describe('seo-judge parameter contract (R1 / AC1)', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'kk-seo-params-'));
    const workDir = join(testDir, 'workdir');
    const shimDir = join(testDir, 'bin');
    const shimPath = join(shimDir, 'spur');
    const fixtureCrawl = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');

    beforeAll(() => {
        mkdirSync(workDir, { recursive: true });
        mkdirSync(shimDir, { recursive: true });
        // argv: decision run <id> --param k=v … --evidence f --json
        writeFileSync(
            shimPath,
            [
                '#!/bin/sh',
                'id="$3"',
                'shift 3',
                'while [ "$#" -gt 0 ]; do',
                '  case "$1" in',
                '    --param)',
                '      case "$2" in',
                '        subject_id=*|locale=*) ;;',
                '        candidates=*) [ "$id" = "kk-seo-keyword-page" ] || { echo "unknown --param (shim mirror of spur)" >&2; exit 1; } ;;',
                '        *) echo "unknown --param (shim mirror of spur)" >&2; exit 1 ;;',
                '      esac',
                '      shift 2 ;;',
                '    --evidence) shift 2 ;;',
                '    *) shift ;;',
                '  esac',
                'done',
                'echo \'{"type":"score","value":2,"confidence":0.9,"source":"model","maker":"shim-model"}\'',
                '',
            ].join('\n'),
            { mode: 0o755 },
        );

        const crawl = JSON.parse(readFileSync(fixtureCrawl, 'utf-8'));
        const homepage = crawl.pages[0];
        const options = {
            url: 'https://example.com/',
            locale: 'en-US',
            business_context: 'B2B developer tools',
            semantic_pages: 5,
            max_pairs: 5,
        };
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(options));
        writeFileSync(
            join(workDir, 'manifest.json'),
            JSON.stringify({
                schemaVersion: 1,
                methodVersion: '1.0.0',
                runId: 'params-run-1',
                createdAt: new Date().toISOString(),
                inputDigest: 'abc',
                stage: 'collect',
                options,
            }),
        );
        // Two pages so the page loop AND the pair loop both dispatch real children.
        writeFileSync(
            join(workDir, 'crawl.json'),
            JSON.stringify({
                ...crawl,
                pages: [homepage, { ...homepage, subjectId: 'page-002', url: 'https://example.com/about' }],
            }),
        );
    });

    afterAll(() => {
        try {
            rmSync(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('dispatches page and pair judgments with declared parameters only, so none falls back', async () => {
        const result = await executeSeoJudgeStage(workDir, { spurBin: shimPath });

        // Guard: the shim really served the calls (a spawn failure would also yield fallbacks).
        expect(result.summary.totalCalls).toBeGreaterThan(10);
        expect(result.entries.some((e) => e.id === 'kk-seo-intent-overlap')).toBe(true);

        const rejected = result.entries.filter((e) => e.reason.includes('unknown --param'));
        expect(rejected.map((e) => `${e.id}: ${e.reason}`)).toEqual([]);
        // `deterministic` is the homepage page-type entry; everything else is a served model answer.
        for (const entry of result.entries) {
            expect(entry.source, `${entry.id} (${entry.subjectUrl})`).not.toBe('fallback');
        }
        expect(result.entries.filter((e) => e.source === 'model').length).toBeGreaterThan(10);
    });
});

/** Recorded confidence-level check outcomes, aggregated into `.spur/run/seo-confidence/summary.json`. */
const confidenceChecks: { id: string; ok: boolean; detail: string }[] = [];
const recordConfidenceCheck = (id: string, ok: boolean, detail = ''): boolean => {
    confidenceChecks.push({ id, ok, detail });
    return ok;
};

/**
 * Confidence-level verification (20261016). Spur serves `confidenceLevel` on every `decision run`
 * (`HIGH` >= 0.8, `MEDIUM` >= 0.5, else `LOW`; a null, non-numeric or out-of-range confidence is
 * `LOW`). KK stores the raw number, so this block re-derives the level from the artifact the
 * operator reads and verifies the boundaries, the provenance rule (only a model answer or the
 * rule-derived homepage entry may be confident) and that a rejected input is a LOW-confidence
 * fallback naming the input error, never an under-confident judgment.
 */
describe('Confidence level (HIGH/MEDIUM/LOW) verification (R2 / AC2)', () => {
    /** Spur's banding, re-derived at the KK boundary (`HIGH` >= 0.8, `MEDIUM` >= 0.5, else LOW). */
    const HIGH_AT = 0.8;
    const MEDIUM_AT = 0.5;
    type Level = 'HIGH' | 'MEDIUM' | 'LOW';
    const levelOf = (confidence: number | null): Level => {
        if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return 'LOW';
        if (confidence >= HIGH_AT) return 'HIGH';
        return confidence >= MEDIUM_AT ? 'MEDIUM' : 'LOW';
    };
    const served = (confidence: unknown): Record<string, unknown> => ({
        type: 'score',
        value: 2,
        confidence,
        source: 'model',
        maker: 'shim-model',
        reason: 'accepted',
    });
    const validated = (confidence: unknown) =>
        validateAndNormalizeDecisionResult('kk-seo-importance', 'p1', 'https://example.com/p1', served(confidence));

    const testDir = mkdtempSync(join(tmpdir(), 'kk-seo-confidence-'));
    const workDir = join(testDir, 'workdir');

    beforeAll(() => {
        mkdirSync(workDir, { recursive: true });
        const options = {
            url: 'https://example.com/',
            locale: 'en-US',
            business_context: '',
            semantic_pages: 5,
            max_decision_calls: 40,
        };
        writeFileSync(join(workDir, 'options.json'), JSON.stringify(options));
        writeFileSync(
            join(workDir, 'manifest.json'),
            JSON.stringify({
                schemaVersion: 1,
                methodVersion: '1.0.0',
                runId: 'confidence-run-1',
                createdAt: new Date().toISOString(),
                inputDigest: 'abc',
                stage: 'collect',
                options,
            }),
        );
        writeFileSync(
            join(workDir, 'crawl.json'),
            readFileSync(resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json'), 'utf-8'),
        );
    });

    afterAll(() => {
        try {
            rmSync(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('bands a served confidence at the 0.8 / 0.5 boundaries', () => {
        const rows: [number, Level][] = [
            [1, 'HIGH'],
            [0.95, 'HIGH'],
            [0.8, 'HIGH'],
            [0.7999, 'MEDIUM'],
            [0.7, 'MEDIUM'],
            [0.5, 'MEDIUM'],
            [0.4999, 'LOW'],
            [0.2, 'LOW'],
            [0, 'LOW'],
        ];
        for (const [confidence, expected] of rows) {
            const entry = validated(confidence);
            expect(entry.confidence, `confidence ${confidence}`).toBe(confidence);
            expect(levelOf(entry.confidence), `confidence ${confidence}`).toBe(expected);
            // KK's sufficiency gate for choice/score is exactly the HIGH band (design §7).
            expect(entry.qualified, `confidence ${confidence}`).toBe(expected === 'HIGH');
        }
        expect(recordConfidenceCheck('band-boundaries', true, `${rows.length} confidences banded at 0.8 / 0.5`)).toBe(
            true,
        );
    });

    it('never bands a missing or out-of-range confidence as confident', () => {
        for (const confidence of [undefined, null, Number.NaN, 'high']) {
            const entry = validated(confidence);
            expect(entry.confidence).toBeNull();
            expect(levelOf(entry.confidence)).toBe('LOW');
            expect(entry.qualified).toBe(false);
        }
        // Documented validation is "confidence null or finite 0–1" (design §7): a number outside the
        // range is neither a level nor sufficient confidence, whatever the raw payload carried.
        for (const confidence of [1.5, -0.1]) {
            const entry = validated(confidence);
            expect(levelOf(entry.confidence), `confidence ${confidence}`).toBe('LOW');
            expect(entry.qualified, `confidence ${confidence}`).toBe(false);
        }
        expect(
            recordConfidenceCheck('unusable-confidence-is-low', true, 'absent, non-numeric and out-of-range inputs'),
        ).toBe(true);
    });

    it('keeps every judgments.json entry at an honest level, with LOW for every fallback', async () => {
        const stub: DecisionStubHandler = (id) => {
            if (id === 'kk-seo-business-model') {
                return { type: 'choice', value: 'software', confidence: 0.9, source: 'model', maker: 'm', reason: 'a' };
            }
            if (id === 'kk-seo-value-proposition') {
                return { type: 'score', value: 2, confidence: 0.6, source: 'model', maker: 'm', reason: 'a' };
            }
            if (id === 'kk-seo-entity-clarity') {
                return { type: 'noul', value: true, probability: 0.9, source: 'model', maker: 'm', reason: 'a' };
            }
            if (id === 'kk-seo-topical-focus') {
                return { type: 'score', value: 2, confidence: 1.5, source: 'model', maker: 'm', reason: 'a' };
            }
            if (id === 'kk-seo-local-intent') {
                return { type: 'noul', value: false, probability: 0.5, confidence: 0.55, source: 'model', maker: 'm' };
            }
            throw new Error('backend unavailable');
        };
        const result = await executeSeoJudgeStage(workDir, { stub });
        const byId = (id: string) => result.entries.find((e) => e.id === id);

        expect(levelOf(byId('kk-seo-business-model')?.confidence ?? null)).toBe('HIGH');
        expect(byId('kk-seo-business-model')?.qualified).toBe(true);
        expect(levelOf(byId('kk-seo-value-proposition')?.confidence ?? null)).toBe('MEDIUM');
        expect(byId('kk-seo-value-proposition')?.qualified).toBe(false);
        expect(levelOf(byId('kk-seo-local-intent')?.confidence ?? null)).toBe('MEDIUM');
        expect(byId('kk-seo-local-intent')?.qualified).toBe(false);
        // Out of the documented 0–1 range: spur bands it LOW, so KK must not read it as sufficient.
        expect(levelOf(byId('kk-seo-topical-focus')?.confidence ?? null)).toBe('LOW');
        expect(byId('kk-seo-topical-focus')?.qualified).toBe(false);
        // A noul answer is judged by its served probability, so it can be qualified while the raw
        // confidence stays null (design §7): the level is LOW and the provenance carries the meaning.
        expect(byId('kk-seo-entity-clarity')?.confidence).toBeNull();
        expect(levelOf(byId('kk-seo-entity-clarity')?.confidence ?? null)).toBe('LOW');
        expect(byId('kk-seo-entity-clarity')?.qualified).toBe(true);

        for (const entry of result.entries) {
            const level = levelOf(entry.confidence);
            if (entry.source === 'fallback' || entry.source === 'default') {
                expect(level, entry.id).toBe('LOW');
                expect(entry.confidence, entry.id).toBeNull();
                expect(entry.qualified, entry.id).toBe(false);
                expect(entry.reason, entry.id).toContain('backend unavailable');
            }
            // Only the rule-derived homepage entry may be confident without a model answer, and it
            // names that provenance rather than passing as HIGH-confidence model judgment.
            if (entry.qualified && entry.source !== 'model') {
                expect(entry.source, entry.id).toBe('deterministic');
            }
            if (entry.source === 'model' && (entry.type === 'choice' || entry.type === 'score')) {
                expect(entry.qualified, entry.id).toBe(level === 'HIGH');
            }
        }
        // The tallies the operator reads agree with the per-entry levels.
        expect(result.summary.qualifiedCalls).toBe(
            result.entries.filter((e) => e.qualified && e.source !== 'deterministic').length,
        );
        expect(result.summary.fallbackCalls).toBe(
            result.entries.filter((e) => e.source === 'fallback' || e.source === 'default').length,
        );
        expect(
            recordConfidenceCheck(
                'artifact-levels',
                true,
                `${result.entries.length} entries; ${result.summary.qualifiedCalls} sufficient-confidence, ${result.summary.fallbackCalls} fallback`,
            ),
        ).toBe(true);
    });

    it('reports a rejected input as a LOW-confidence fallback that names the input error', () => {
        // Real children: both argv problems are rejected before any maker runs.
        const missingLocale = executeDecisionRun('kk-seo-page-type', { subject_id: 'x' }, [], { timeoutMs: 20000 });
        const undeclared = executeDecisionRun(
            'kk-seo-page-type',
            { subject_id: 'x', locale: 'en-US', url: 'https://example.com/x' },
            [],
            { timeoutMs: 20000 },
        );

        for (const entry of [missingLocale, undeclared]) {
            expect(entry.source).toBe('fallback');
            expect(entry.confidence).toBeNull();
            expect(levelOf(entry.confidence)).toBe('LOW');
            expect(entry.qualified).toBe(false);
            expect(entry.reason).toMatch(/parameter|--param/);
        }
        // LOW-for-rejected is tellable from LOW-for-weak-answer by source plus the named input error.
        expect(missingLocale.reason).toContain('locale');
        expect(undeclared.reason).toContain('url');
        expect(
            recordConfidenceCheck('rejected-input-is-not-a-judgment', true, 'missing `locale` and undeclared `url`'),
        ).toBe(true);
    });

    it('derives the same level spur serves for the same payload', () => {
        const proc = Bun.spawnSync(
            [
                'spur',
                'decision',
                'run',
                'kk-seo-heading-fit',
                '--param',
                'subject_id=https://example.com',
                '--param',
                'locale=en-US',
                '--maker',
                'typesafe',
                '--json',
            ],
            // Bun.spawnSync does not see runtime process.env mutations; pass the test DB explicitly.
            { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } },
        );
        expect(proc.exitCode).toBe(0);
        const payload = JSON.parse(proc.stdout.toString()) as {
            confidence: number | null;
            confidenceLevel: Level;
        };
        expect(['HIGH', 'MEDIUM', 'LOW']).toContain(payload.confidenceLevel);
        const entry = validateAndNormalizeDecisionResult(
            'kk-seo-heading-fit',
            'https://example.com',
            'https://example.com',
            payload as unknown as Record<string, unknown>,
        );
        // KK stores the served number verbatim, so the level the decision log shows and the level
        // the judgment artifact implies cannot drift apart at the band boundary.
        expect(entry.confidence).toBe(payload.confidence);
        expect(levelOf(entry.confidence)).toBe(payload.confidenceLevel);
        expect(
            recordConfidenceCheck(
                'spur-level-agreement',
                true,
                `served confidence ${payload.confidence} -> ${payload.confidenceLevel}`,
            ),
        ).toBe(true);
    });
});

describe('seo-confidence artifact', () => {
    it('writes a repeatable summary of every confidence-level check', () => {
        const failed = confidenceChecks.filter((check) => !check.ok).map((check) => check.id);
        const dir = resolve('.spur/run/seo-confidence');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'summary.json'),
            `${JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    contract:
                        'a seo-judge confidence bands HIGH >= 0.8 / MEDIUM >= 0.5 / else LOW, and only a model answer or the rule-derived homepage entry may be sufficient confidence',
                    thresholds: { high: 0.8, medium: 0.5 },
                    ok: failed.length === 0,
                    failed,
                    checks: confidenceChecks,
                },
                null,
                2,
            )}\n`,
        );
        expect(failed).toEqual([]);
    });
});
