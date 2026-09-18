import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import {
    corpusComposition,
    main,
    processGeneratorIO,
    readBlendedCorpus,
    readQcSummary,
    readRejectedAudit,
    readTiming,
    rejectedCounts,
    renderReportMarkdown,
    scoreAggregates,
    sourceBreakdown,
} from '../src/index';

function candidate(
    scores: Partial<Record<'quality' | 'importance' | 'urgency' | 'impact', number>>,
    overrides: Partial<Doc> = {},
): Doc {
    return {
        id: 'd1',
        title: 'Sora 2 发布',
        body: 'x',
        sourceUri: 'https://example.com/a',
        mediaType: 'text/markdown',
        metadata: { category: 'ai-news', scores: { quality: 5, importance: 4, urgency: 3, impact: 2, ...scores } },
        ...overrides,
    };
}

afterEach(() => delete process.env.QC_MIN_QUALITY);

describe('news-report-gen scoring', () => {
    const docs = [
        candidate({ quality: 5, importance: 4, urgency: 3, impact: 2 }),
        candidate(
            {},
            {
                id: 'd2',
                metadata: { category: 'ai-industry', scores: { quality: 3, importance: 4, urgency: 3, impact: 1 } },
            },
        ),
    ];

    test('per-candidate scores appear in the table and aggregates are min/max/avg/count', () => {
        const md = renderReportMarkdown(docs, '2026-09-12');
        expect(md).toContain('Sora 2 发布');
        expect(md).toContain('5');
        const agg = scoreAggregates(docs);
        expect(agg.quality).toEqual({ min: 3, max: 5, avg: 4, count: 2 });
        expect(agg.impact).toEqual({ min: 1, max: 2, avg: 1.5, count: 2 });
    });

    test('empty candidate list renders the zero-state without throwing', () => {
        const md = renderReportMarkdown([], '2026-09-12');
        expect(md).toContain('本期无保留候选');
        expect(md).toContain('阈值拒绝计数');
    });
});

describe('news-report-gen rejected counts', () => {
    test('counts per dimension from filter reasons and category rejects', () => {
        const counts = rejectedCounts([
            { doc: candidate({}), reasons: ['category:not-in-allowlist', 'quality:1<2', 'impact:0<1'] },
            { doc: candidate({}), reasons: ['quality:1<2'] },
            { doc: candidate({}), reasons: ['category:not-in-allowlist'] },
        ]);
        expect(counts.quality).toBe(2);
        expect(counts.impact).toBe(1);
        expect(counts.category).toBe(2);
    });

    test('threshold values echo the QC_MIN_* envs (missing -> —)', () => {
        process.env.QC_MIN_QUALITY = '2';
        const md = renderReportMarkdown([candidate({})], '2026-09-12', { rejected: [] });
        expect(md).toContain('| quality | 2 | 0 |');
        delete process.env.QC_MIN_QUALITY;
        const none = renderReportMarkdown([candidate({})], '2026-09-12', {});
        expect(none).toContain('| quality | — | 0 |');
    });
});

describe('news-report-gen timing', () => {
    test('assembles the per-step table from the JSONL sidecar and dedups last-per-step', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-'));
        const path = join(dir, 'step-timing.json');
        await writeFile(
            path,
            [
                JSON.stringify({ step: 'collect', startedAt: '2026-09-12T00:00:00Z', endedAt: '2026-09-12T00:00:05Z' }),
                JSON.stringify({ step: 'plan', startedAt: '2026-09-12T00:00:05Z', endedAt: '2026-09-12T00:00:10Z' }),
                JSON.stringify({ step: 'collect', startedAt: '2026-09-12T00:01:00Z', endedAt: '2026-09-12T00:01:20Z' }),
                'not json',
            ].join('\n'),
        );
        const entries = await readTiming(path);
        expect(entries).toHaveLength(2);
        const md = renderReportMarkdown([candidate({})], '2026-09-12', { timing: entries });
        expect(md).toContain('20000 ms'); // last collect entry wins: 20s
        await rm(dir, { recursive: true, force: true });
    });

    test('missing/unreadable timing file -> section omitted, never throws', async () => {
        expect(await readTiming(undefined)).toEqual([]);
        expect(await readTiming('/nonexistent/step-timing.json')).toEqual([]);
        const md = renderReportMarkdown([candidate({})], '2026-09-12');
        expect(md).not.toContain('## 步耗时');
    });
});

describe('news-report-gen rejected audit', () => {
    test('absent path -> empty list, never throws', async () => {
        expect(await readRejectedAudit(undefined)).toEqual([]);
        expect(await readRejectedAudit('/nonexistent/rejected.json')).toEqual([]);
    });

    // AC1 (0138 R1): both writer shapes. episode-plan-gen's `processFilterIO` writes the
    // `{rejected, config, total}` envelope; the array-only reader silently reported 0 rejections.
    test('accepts a bare RejectedAudit[] and the {rejected, config, total} envelope', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-audit-'));
        const bare = join(dir, 'bare.json');
        const enveloped = join(dir, 'enveloped.json');
        const entries = [{ doc: candidate({}), reasons: ['category:not-in-allowlist'] }];
        await writeFile(bare, JSON.stringify(entries));
        await writeFile(enveloped, JSON.stringify({ rejected: entries, config: { minQuality: 2 }, total: 20 }));
        expect(await readRejectedAudit(bare)).toEqual(entries);
        expect(await readRejectedAudit(enveloped)).toEqual(entries);
        await rm(dir, { recursive: true, force: true });
    });

    test('malformed, non-array, and an envelope without `rejected` -> [], never throws', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-audit-bad-'));
        const notJson = join(dir, 'not-json.json');
        const object = join(dir, 'object.json');
        await writeFile(notJson, '{ truncated');
        await writeFile(object, JSON.stringify({ config: {}, total: 0 }));
        expect(await readRejectedAudit(notJson)).toEqual([]);
        expect(await readRejectedAudit(object)).toEqual([]);
        expect(await readRejectedAudit(join(dir, 'absent.json'))).toEqual([]);
        await rm(dir, { recursive: true, force: true });
    });

    test('the 2026-09-16 envelope counts 13 category / 6 importance rejections into the report', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-audit-real-'));
        const path = join(dir, 'candidates.rejected.json');
        // Measured shape of 20260916_04_quality-control-content_candidates.rejected.json:
        // 13 entries, all `category:not-in-allowlist`, 6 of them also `importance:2<3`.
        const rejected = Array.from({ length: 13 }, (_, i) => ({
            doc: candidate({}, { id: `r${i}` }),
            reasons: i < 6 ? ['category:not-in-allowlist', 'importance:2<3'] : ['category:not-in-allowlist'],
        }));
        await writeFile(path, JSON.stringify({ rejected, config: {}, total: 20 }));
        const audit = await readRejectedAudit(path);
        const counts = rejectedCounts(audit);
        expect(counts.category).toBe(13);
        expect(counts.importance).toBe(6);
        expect(renderReportMarkdown([candidate({})], '2026-09-16', { rejected: audit })).toContain(
            '| category allowlist | — | 13 |',
        );
        await rm(dir, { recursive: true, force: true });
    });
});

describe('news-report-gen IO', () => {
    test('processGeneratorIO reads Doc[] and writes report Content with env-consistency thresholds', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-io-'));
        const inPath = join(dir, 'episode-plan.json');
        const outPath = join(dir, 'run-report-content.json');
        await writeFile(inPath, JSON.stringify([candidate({})]));
        process.env.QC_MIN_QUALITY = '2';
        const content = (await processGeneratorIO(inPath, outPath)) as Content;
        expect(content.format).toBe('markdown');
        expect(content.metadata?.generator).toBe('kk:news-report');
        expect(content.body).toContain('# 每日 AI 语音运行报告');
        const onDisk = (await Bun.file(outPath).json()) as Content;
        expect(onDisk.body).toBe(content.body);
        await rm(dir, { recursive: true, force: true });
    });

    test('sourceBreakdown groups kept candidates by ingest source with domain sub-counts', () => {
        const grouped = sourceBreakdown([
            candidate({}, { metadata: { source: 'hackernews', sourceName: 'news.ycombinator.com' } }),
            candidate({}, { metadata: { source: 'hackernews', sourceName: 'news.ycombinator.com' } }),
            candidate({}, { metadata: { source: 'aihot', sourceName: 'techcrunch.com' } }),
            candidate({}, { metadata: { source: 'aihot', sourceName: 'arxiv.org' } }),
            candidate({}, { metadata: {} }),
        ]);
        expect(grouped.map((g) => [g.source, g.items])).toEqual([
            ['aihot', 2],
            ['hackernews', 2],
            ['未知', 1],
        ]);
        expect(grouped[0]?.domains.map((d) => `${d.domain}(${d.items})`)).toEqual([
            'arxiv.org(1)',
            'techcrunch.com(1)',
        ]);
        expect(grouped[2]?.domains.map((d) => `${d.domain}(${d.items})`)).toEqual(['example.com(1)']);
    });

    test('renderReportMarkdown renders the per-source section', () => {
        const md = renderReportMarkdown(
            [candidate({}, { metadata: { source: 'rss', sourceName: 'openai.com|blog', scores: {} } })],
            '2026-09-12',
        );
        expect(md).toContain('## 来源分布');
        expect(md).toContain('| rss | 1 | openai.com\\|blog (1) |');
    });

    test('main exits 1 with the standard error shape on missing args', async () => {
        const code = await main();
        expect(code).toBe(1);
    });
});

describe('news-report-gen corpus composition (20260917 funnel)', () => {
    // Mirrors the 2026-09-17 blended input: 3 sourced docs, one missing both fields — the
    // uncategorized mass is exactly what the section exists to expose.
    const blended = [
        { title: 'a', metadata: { source: 'aihot', category: 'AI' } },
        { title: 'b', metadata: { source: 'aihot', category: 'AI' } },
        { title: 'c', metadata: { source: 'hackernews' } },
        { title: 'd', source: 'rss' },
    ];

    test('tallies sources and categories, bucketing missing fields as （无）', () => {
        expect(corpusComposition(blended)).toEqual({
            total: 4,
            sources: [
                { key: 'aihot', count: 2 },
                { key: 'hackernews', count: 1 },
                { key: 'rss', count: 1 },
            ],
            categories: [
                { key: 'AI', count: 2 },
                { key: '（无）', count: 2 },
            ],
        });
    });

    test('readBlendedCorpus: absent/malformed/non-array -> null (never throw)', async () => {
        expect(await readBlendedCorpus(undefined)).toEqual(null);
        expect(await readBlendedCorpus('/nonexistent/blended.json')).toEqual(null);
        const dir = await mkdtemp(join(tmpdir(), 'nr-blended-'));
        try {
            const bad = join(dir, 'bad.json');
            await writeFile(bad, '{not json');
            expect(await readBlendedCorpus(bad)).toEqual(null);
            await writeFile(bad, '{"docs": []}');
            expect(await readBlendedCorpus(bad)).toEqual([]);
            await writeFile(bad, JSON.stringify(blended));
            expect(await readBlendedCorpus(bad)).toHaveLength(4);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('renderReportMarkdown: section present with blended, absent without', () => {
        const withSection = renderReportMarkdown([], '2026-09-17', { blended });
        expect(withSection).toContain('## 语料构成（fan-in 输入，共 4 条）');
        expect(withSection).toContain('| aihot | 2 |');
        expect(withSection).toContain('| AI | 2 |');
        expect(renderReportMarkdown([], '2026-09-17', {})).not.toContain('语料构成');
    });
});

describe('news-report-gen QC block (0139 R5b)', () => {
    // Fixture mirrors the 2026-09-16 audit: passed:false with per-type issue counts, including the
    // detailed `duration_anomaly: expected …` form that must roll up under one row.
    const audit = {
        metadata: {
            qc: {
                passed: false,
                overallScore: 50,
                totalDuration: 879.33,
                segmentAudits: [
                    {
                        segmentIndex: 0,
                        issues: [
                            'repetition_detected',
                            'loudness_dip:unknown',
                            'duration_anomaly: expected 1.0s, got 2.0s',
                        ],
                    },
                    { segmentIndex: 1, issues: ['loudness_dip:unknown'] },
                ],
            },
        },
    };

    async function withQcFile<T>(text: string, fn: (path: string) => Promise<T>): Promise<T> {
        const dir = await mkdtemp(join(tmpdir(), 'nr-qc-'));
        const path = join(dir, '20260916_11_generate_content.json');
        await writeFile(path, text);
        try {
            return await fn(path);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }

    test('reads the generate audit and rolls detailed issues up under their type', async () => {
        const summary = await withQcFile(JSON.stringify(audit), (path) => readQcSummary(path));
        expect(summary).toEqual({
            passed: false,
            overallScore: 50,
            issues: [
                { type: 'loudness_dip', count: 2 },
                { type: 'duration_anomaly', count: 1 },
                { type: 'repetition_detected', count: 1 },
            ],
        });
    });

    test('renders the QC block into the report markdown', async () => {
        const summary = await withQcFile(JSON.stringify(audit), (path) => readQcSummary(path));
        const md = renderReportMarkdown([candidate({})], '2026-09-16', { qc: summary });
        expect(md).toContain('## 音频 QC');
        expect(md).toContain('| 综合评分 | 50 |');
        expect(md).toContain('| 通过 | 否 |');
        expect(md).toContain('| repetition_detected | 1 |');
        expect(md).toContain('| loudness_dip | 2 |');
        expect(md).toContain('| duration_anomaly | 1 |');
    });

    test('omits the block when the audit is absent, unreadable, or malformed', async () => {
        expect(await readQcSummary(undefined)).toBeNull();
        expect(await readQcSummary('/nonexistent/generate.json')).toBeNull();
        expect(await withQcFile('{ truncated', (path) => readQcSummary(path))).toBeNull();
        expect(await withQcFile(JSON.stringify({ metadata: {} }), (path) => readQcSummary(path))).toBeNull();
        expect(renderReportMarkdown([candidate({})], '2026-09-16', { qc: null })).not.toContain('## 音频 QC');
    });

    test('processGeneratorIO reads the audit through NEWS_REPORT_QC_FILE', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'nr-qc-io-'));
        const inPath = join(dir, 'episode-plan.json');
        const outPath = join(dir, 'run-report-content.json');
        const qcPath = join(dir, 'generate.json');
        await writeFile(inPath, JSON.stringify([candidate({})]));
        await writeFile(qcPath, JSON.stringify(audit));
        process.env.NEWS_REPORT_QC_FILE = qcPath;
        try {
            const content = (await processGeneratorIO(inPath, outPath)) as Content;
            expect(content.body).toContain('## 音频 QC');
            expect(content.body).toContain('| 通过 | 否 |');
        } finally {
            delete process.env.NEWS_REPORT_QC_FILE;
            await rm(dir, { recursive: true, force: true });
        }
    });
});
