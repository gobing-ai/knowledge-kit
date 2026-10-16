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
