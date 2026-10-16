import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CrawlArtifact } from '../scripts/seo-facts';
import { type AuditArtifact, type ReportJsonArtifact, renderReportMarkdown } from '../scripts/seo-report';
import {
    type AssessmentRow,
    buildPrioritizedActions,
    calculateScoresAndCoverage,
    makeStableId,
    runSeoChecks,
    VENDOR_RULES,
} from '../scripts/seo-rules';
import { seoCheck, seoReport, seoScore } from '../scripts/seo-stages';

// seo-stages.ts ships as a node-builtin-only script, so console.error IS its progress channel.
// Mute it per test so in-process stage runs don't pollute the test reporter.
let stageProgress: { mockRestore(): void };
beforeEach(() => {
    stageProgress = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => stageProgress.mockRestore());

describe('Smart SEO Rule Inventory & Dispositions (R1 / AC1)', () => {
    it('verifies all 52 deterministic vendor rules are accounted for in VENDOR_RULES', () => {
        const ruleKeys = Object.keys(VENDOR_RULES);
        expect(ruleKeys.length).toBe(52);

        // Verify categories and dispositions
        const counts = { native: 0, adapted: 0, informational: 0, deferred: 0 };
        for (const def of Object.values(VENDOR_RULES)) {
            counts[def.disposition] += 1;
            expect(def.sourceCheckedAt).toBe('2026-10-14');
            expect(def.sourceUrl).toMatch(/^https?:\/\//);
            expect(def.effort).toBeGreaterThanOrEqual(1);
            expect(def.effort).toBeLessThanOrEqual(4);
        }

        expect(counts.native).toBe(24);
        expect(counts.adapted).toBe(15);
        expect(counts.informational).toBe(11);
        expect(counts.deferred).toBe(2);
    });

    it('generates stable action and finding identifiers that never renumber', () => {
        const id1 = makeStableId('title_missing', 'https://example.com/about');
        const id2 = makeStableId('title_missing', 'https://example.com/about');
        const id3 = makeStableId('title_missing', 'https://example.com/contact');

        expect(id1).toBe(id2);
        expect(id1).not.toBe(id3);
        expect(id1).toMatch(/^SEO-title_missing-[0-9a-f]{12}$/);
    });
});

describe('Smart SEO Assessments Execution (R1, R2 / AC1, AC2)', () => {
    const fixturePath = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');
    let minimalCrawl: CrawlArtifact;

    beforeAll(() => {
        minimalCrawl = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    });

    it('runs checks on minimal crawl fixture and produces valid assessment rows', () => {
        const assessments = runSeoChecks(minimalCrawl);
        expect(assessments.length).toBeGreaterThanOrEqual(52);

        for (const row of assessments) {
            expect(['pass', 'fail', 'unknown', 'not-applicable']).toContain(row.status);
            expect(['critical', 'high', 'medium', 'low', 'info']).toContain(row.severity);
            expect(row.sourceCheckedAt).toBe('2026-10-14');
            expect(row.reason).toBeDefined();
        }

        // Title and H1 present in fixture -> pass
        const titleRow = assessments.find((r) => r.ruleId === 'title_missing');
        expect(titleRow?.status).toBe('pass');
        const h1Row = assessments.find((r) => r.ruleId === 'h1_missing');
        expect(h1Row?.status).toBe('pass');

        // Deferred rules emit not-applicable
        const schemaRow = assessments.find((r) => r.ruleId === 'schema_required');
        expect(schemaRow?.status).toBe('not-applicable');
        const extLinkRow = assessments.find((r) => r.ruleId === 'broken_external_links');
        expect(extLinkRow?.status).toBe('not-applicable');

        // Dated FAQ rich-result retirement info
        const faqRow = assessments.find((r) => r.ruleId === 'faq_rich_result_limited');
        expect(faqRow?.status).toBe('pass');
        expect(VENDOR_RULES.faq_rich_result_limited.description).toContain('fully retired on 2026-05-07');
    });

    it('names one FAQ rich-result retirement date across every shipped surface', () => {
        // 0304 residual: the rule description, the check reason, the report limits block and the
        // skill reference restate the same fact, so a second retirement date must fail here. The
        // reason is read from a real run of the FAQ-present branch, not from the rule's prose.
        const faqCrawl: CrawlArtifact = {
            ...minimalCrawl,
            pages: minimalCrawl.pages.map((page) => ({
                ...page,
                facts: { ...page.facts, jsonLd: [{ raw: '{}', parsed: null, types: ['FAQPage'], error: null }] },
            })),
        };
        const reason = runSeoChecks(faqCrawl).find((row) => row.ruleId === 'faq_rich_result_limited')?.reason ?? '';
        expect(reason).toContain('2026-05-07'); // the FAQ-present branch actually ran

        // Every `retir…` claim in the three shipped files must name that one date (Google Search
        // updates: retired 2026-05-07; Aug/Sep 2023 only restricted eligibility).
        const retiredDates = (text: string): string[] =>
            [...text.matchAll(/retir\w*[^.;]{0,60}?(\d{4}-\d{2}-\d{2}|202\d)/gi)].map((match) => match[1] ?? '');
        for (const surface of [
            'plugins/kk/scripts/seo-report.ts',
            'plugins/kk/scripts/seo-rules.ts',
            'plugins/kk/skills/smart-seo/references/seo-geo-sources.md',
        ]) {
            const claims = retiredDates(readFileSync(resolve(surface), 'utf-8'));
            expect(claims.length, surface).toBeGreaterThan(0);
            expect(claims, surface).toEqual(claims.map(() => '2026-05-07'));
        }
    });

    it('correctly assesses defects and heuristics across pages', () => {
        const badCrawl: CrawlArtifact = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'bad-crawl-1',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            predecessorDigests: {},
            status: 'complete',
            pages: [
                {
                    subjectId: 'p1',
                    url: 'http://example.com/bad', // http -> no_https
                    status: 500, // http_errors
                    availability: 'unavailable',
                    redirectChain: ['http://example.com/r1', 'http://example.com/r2'], // redirect_chains
                    evidencePath: null,
                    evidenceHash: null,
                    facts: {
                        url: 'http://example.com/bad',
                        title: null, // title_missing
                        titleCount: 0,
                        metaDescription: null, // meta_missing
                        metaDescriptionCount: 0,
                        canonical: 'http://example.com/broken-canonical', // canonical_elsewhere
                        robotsDirectives: ['noindex'], // noindex
                        viewport: null, // viewport_missing
                        lang: null, // lang_missing
                        headings: [], // h1_missing
                        h1Count: 0,
                        images: [{ src: 'http://example.com/test.png', alt: null, width: null, height: null }], // images_alt, images_dimensions
                        links: [{ href: 'http://example.com/link', text: 'click here', rel: null, isInternal: true }], // generic_anchors
                        openGraph: {}, // og_missing
                        hreflang: [],
                        jsonLd: [{ raw: '{invalid', parsed: null, types: [], error: 'JSON error' }], // jsonld_errors
                        wordCount: 15, // thin_content
                        textSample: 'Bad content sample',
                        ttfbMs: 1200, // slow_ttfb
                        htmlByteLength: 2000000, // heavy_html
                        isRawHtmlShell: true, // js_dependent
                    },
                    error: null,
                },
                {
                    subjectId: 'p2',
                    url: 'https://example.com/soft-404',
                    status: 200,
                    availability: 'available',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: {
                        url: 'https://example.com/soft-404',
                        title: '404 Page Not Found',
                        titleCount: 1,
                        metaDescription: 'Error',
                        metaDescriptionCount: 1,
                        canonical: 'https://example.com/soft-404',
                        robotsDirectives: [],
                        viewport: 'width=device-width',
                        lang: 'en',
                        headings: [],
                        h1Count: 0,
                        images: [],
                        links: [],
                        openGraph: {},
                        hreflang: [],
                        jsonLd: [],
                        wordCount: 50,
                        textSample: '404 not found page sorry',
                        ttfbMs: 100,
                        htmlByteLength: 1000,
                        isRawHtmlShell: false,
                    },
                    error: null,
                },
            ],
            requests: [
                {
                    url: 'http://example.com/robots.txt',
                    method: 'GET',
                    status: 403, // robots_blocks_site
                    durationMs: 20,
                    bytesReceived: 50,
                    error: null,
                    timestamp: new Date().toISOString(),
                },
            ],
            limits: {
                pagesVisited: 1,
                requestsMade: 2,
                totalBytes: 2000050,
                elapsedSeconds: 2,
                hitLimit: null,
            },
        };

        const rows = runSeoChecks(badCrawl);
        const hasFail = (ruleId: string) => rows.some((r) => r.ruleId === ruleId && r.status === 'fail');

        expect(hasFail('robots_blocks_site')).toBe(true);
        expect(hasFail('http_errors')).toBe(true);
        expect(hasFail('redirect_chains')).toBe(true);
        expect(hasFail('no_https')).toBe(true);
        expect(hasFail('title_missing')).toBe(true);
        expect(hasFail('meta_missing')).toBe(true);
        expect(hasFail('h1_missing')).toBe(true);
        expect(hasFail('images_alt')).toBe(true);
        expect(hasFail('images_dimensions')).toBe(true);
        expect(hasFail('jsonld_errors')).toBe(true);
        expect(hasFail('thin_content')).toBe(true);
        expect(hasFail('soft_404')).toBe(true);
        expect(hasFail('slow_ttfb')).toBe(true);
        expect(hasFail('heavy_html')).toBe(true);
        expect(hasFail('generic_anchors')).toBe(true);
        expect(hasFail('js_dependent')).toBe(true);
    });

    it('propagates null scores when denominator is zero without inventing clean 100s', () => {
        const emptyCrawl: CrawlArtifact = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'empty-run',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            predecessorDigests: {},
            status: 'partial',
            pages: [],
            requests: [],
            limits: { pagesVisited: 0, requestsMade: 0, totalBytes: 0, elapsedSeconds: 0, hitLimit: null },
        };

        const rows = runSeoChecks(emptyCrawl);
        // Only applicable site checks run, page categories remain unpopulated
        const { scores, coverage } = calculateScoresAndCoverage(rows);
        expect(scores.content).toBeNull(); // No content checks evaluated
        expect(coverage.totalRules).toBe(52);
    });

    it('never lets an informational rule deduct from or inflate a category score', () => {
        const row = (ruleId: string, status: 'pass' | 'fail'): AssessmentRow => ({
            ruleId,
            subjectId: `s-${ruleId}`,
            subjectUrl: 'https://example.com/',
            status,
            category: VENDOR_RULES[ruleId]?.category ?? 'technical',
            severity: VENDOR_RULES[ruleId]?.severity ?? 'info',
            evidenceRefs: [],
            sourceUrl: '',
            sourceCheckedAt: '',
            heuristic: false,
            reason: '',
        });
        const { scores } = calculateScoresAndCoverage([
            row('robots_missing', 'fail'), // informational, crawl
            row('canonical_missing', 'fail'), // informational, technical
            row('hsts_missing', 'pass'), // informational, security
            row('title_missing', 'pass'), // native, content
        ]);
        expect(scores.crawl).toBeNull();
        expect(scores.technical).toBeNull();
        expect(scores.security).toBeNull();
        expect(scores.content).toBe(100);
    });

    it('covers sitemap request evaluations and full action sorting branches', () => {
        const sitemapCrawl: CrawlArtifact = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'sm-crawl',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            predecessorDigests: {},
            status: 'complete',
            pages: [
                {
                    subjectId: 'p1',
                    url: 'https://example.com/p1',
                    status: 200,
                    availability: 'available',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: {
                        url: 'https://example.com/p1',
                        title: 'Page One Long Enough Title',
                        titleCount: 1,
                        metaDescription: 'Description One Long Enough',
                        metaDescriptionCount: 1,
                        canonical: 'https://example.com/broken-target',
                        robotsDirectives: [],
                        viewport: 'width=device-width',
                        lang: 'en',
                        headings: [
                            { level: 1, text: 'Heading One' },
                            { level: 3, text: 'Skipped to Three' },
                        ],
                        h1Count: 1,
                        images: [
                            { src: '/img1.png', alt: null, width: 100, height: 100 },
                            { src: '/img2.png', alt: null, width: 100, height: 100 },
                        ],
                        links: [
                            { href: 'https://example.com/r', text: 'click here', rel: null, isInternal: true },
                            { href: 'https://example.com/broken-target', text: 'broken', rel: null, isInternal: true },
                        ],
                        openGraph: { 'og:title': 'OG Title' },
                        hreflang: [{ lang: 'en', href: 'https://example.com/p1' }],
                        jsonLd: [
                            {
                                raw: '{"@type":"FAQPage"}',
                                parsed: { '@type': 'FAQPage' },
                                types: ['FAQPage'],
                                error: null,
                            },
                        ],
                        wordCount: 250,
                        textSample: 'Sample content here',
                        ttfbMs: 200,
                        htmlByteLength: 1000,
                        isRawHtmlShell: false,
                    },
                    error: null,
                },
                {
                    subjectId: 'p2',
                    url: 'https://example.com/p2',
                    status: 200,
                    availability: 'available',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: {
                        url: 'https://example.com/p2',
                        title: 'Page Two Long Enough Title',
                        titleCount: 1,
                        metaDescription: 'Description Two Long Enough',
                        metaDescriptionCount: 1,
                        canonical: 'https://example.com/p2',
                        robotsDirectives: [],
                        viewport: 'width=device-width',
                        lang: 'en',
                        headings: [{ level: 1, text: 'Heading Two' }],
                        h1Count: 1,
                        images: [{ src: '/img3.png', alt: null, width: null, height: null }],
                        links: [],
                        openGraph: { 'og:title': 'OG Title Two' },
                        hreflang: [],
                        jsonLd: [],
                        wordCount: 250,
                        textSample: 'Sample content two',
                        ttfbMs: 200,
                        htmlByteLength: 1000,
                        isRawHtmlShell: false,
                    },
                    error: null,
                },
                {
                    subjectId: 'p3',
                    url: 'https://example.com/r',
                    status: 301,
                    availability: 'available',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: null,
                    error: null,
                },
                {
                    subjectId: 'p4',
                    url: 'https://example.com/broken-target',
                    status: 500,
                    availability: 'unavailable',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: null,
                    error: '500 error',
                },
            ],
            requests: [
                {
                    url: 'https://example.com/robots.txt',
                    method: 'GET',
                    status: 200,
                    durationMs: 20,
                    bytesReceived: 50,
                    error: null,
                    timestamp: new Date().toISOString(),
                },
                {
                    url: 'https://example.com/sitemap.xml',
                    method: 'GET',
                    status: 200,
                    durationMs: 50,
                    bytesReceived: 500,
                    error: null,
                    timestamp: new Date().toISOString(),
                },
                {
                    url: 'https://example.com/sitemap-sub.xml',
                    method: 'GET',
                    status: 500,
                    durationMs: 50,
                    bytesReceived: 0,
                    error: '500 error',
                    timestamp: new Date().toISOString(),
                },
            ],
            limits: { pagesVisited: 4, requestsMade: 7, totalBytes: 2500, elapsedSeconds: 2, hitLimit: null },
        };

        const rows = runSeoChecks(sitemapCrawl);
        expect(rows.length).toBeGreaterThan(52);

        // Check sitemap_errors fired due to 500 on sitemap-sub.xml
        const smErr = rows.find((r) => r.ruleId === 'sitemap_errors');
        expect(smErr?.status).toBe('fail');

        // Check canonical_broken fired
        const cb = rows.find((r) => r.ruleId === 'canonical_broken');
        expect(cb?.status).toBe('fail');

        // Check links_to_redirects fired
        const ltr = rows.find((r) => r.ruleId === 'links_to_redirects');
        expect(ltr?.status).toBe('fail');

        // Test action sorting with ties
        const actions = buildPrioritizedActions(rows);
        expect(actions.length).toBeGreaterThan(1);
    });

    it('builds prioritized action items with deterministic order and effort bands', () => {
        const failingRows = runSeoChecks({
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'test-fail-p',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            predecessorDigests: {},
            status: 'complete',
            pages: [
                {
                    subjectId: 'p1',
                    url: 'https://example.com/p1',
                    status: 200,
                    availability: 'available',
                    redirectChain: [],
                    evidencePath: null,
                    evidenceHash: null,
                    facts: {
                        url: 'https://example.com/p1',
                        title: null, // critical title_missing
                        titleCount: 0,
                        metaDescription: null, // medium meta_missing
                        metaDescriptionCount: 0,
                        canonical: null,
                        robotsDirectives: [],
                        viewport: 'width=device-width',
                        lang: 'en',
                        headings: [], // medium h1_missing
                        h1Count: 0,
                        images: [],
                        links: [],
                        openGraph: {}, // low og_missing
                        hreflang: [],
                        jsonLd: [],
                        wordCount: 300,
                        textSample: 'Sample text',
                        ttfbMs: 100,
                        htmlByteLength: 1000,
                        isRawHtmlShell: false,
                    },
                    error: null,
                },
            ],
            requests: [],
            limits: { pagesVisited: 1, requestsMade: 1, totalBytes: 1000, elapsedSeconds: 1, hitLimit: null },
        });

        const actions = buildPrioritizedActions(failingRows);
        expect(actions.length).toBeGreaterThan(0);

        // First action must be critical/high severity (P1 priority)
        expect(actions[0]?.severity).toBe('critical');
        expect(actions[0]?.priority).toBe('P1');
        expect(actions[0]?.id).toContain('SEO-title_missing');

        // Actions are sorted: critical before medium before low
        const priorities = actions.map((a) => a.priority);
        expect(priorities.indexOf('P1')).toBeLessThan(priorities.indexOf('P2'));
    });
});

describe('Stage Execution: seo-check, seo-score, and seo-report (R1 / AC1)', () => {
    // OS tmpdir, like every other suite here: scratch inside the repo tree would sit in the
    // pipeline's proof-input digest and drift it on each gate run.
    const testDir = mkdtempSync(join(tmpdir(), 'kk-seo-analysis-'));
    const workDir = join(testDir, 'workdir-run');
    const fixtureCrawl = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');

    beforeAll(() => {
        mkdirSync(workDir, { recursive: true });
        // Seed workDir with options, manifest, crawl.json
        const opt = { url: 'https://example.com/' };
        const man = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'analysis-run-1',
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

    it('runs seo-check to evaluate all rules and writes checks.json', async () => {
        await seoCheck([workDir]);

        const checksPath = join(workDir, 'checks.json');
        expect(existsSync(checksPath)).toBe(true);

        const data = JSON.parse(readFileSync(checksPath, 'utf-8'));
        expect(data.schemaVersion).toBe(1);
        expect(data.assessments.length).toBeGreaterThanOrEqual(52);
    });

    it('runs seo-score to calculate category scores and write audit.json', async () => {
        await seoScore([workDir]);

        const auditPath = join(workDir, 'audit.json');
        expect(existsSync(auditPath)).toBe(true);

        const audit: AuditArtifact = JSON.parse(readFileSync(auditPath, 'utf-8'));
        expect(audit.schemaVersion).toBe(1);
        expect(audit.runId).toBe('fixture-run-001');
        expect(audit.scores.technical).toBeDefined();
        expect(audit.coverage.totalRules).toBe(52);
        expect(audit.judgments.status).toBe('not-assessed');
        expect(audit.performance.status).toBe('not-assessed');
        expect(audit.visibility.status).toBe('not-assessed');

        // Refuses to overwrite audit.json in same directory without revision
        await expect(seoScore([workDir])).rejects.toThrow(/already exists/);
    });

    it('supports immutable offline rescoring into a new revision directory', async () => {
        const revDir = join(testDir, 'rev-1');
        await seoScore([workDir, revDir]);

        expect(existsSync(join(revDir, 'audit.json'))).toBe(true);
        expect(existsSync(join(revDir, 'digest.md'))).toBe(true);

        const rescored: AuditArtifact = JSON.parse(readFileSync(join(revDir, 'audit.json'), 'utf-8'));
        expect(rescored.revisionId).toBeDefined();
        expect(rescored.runId).toBe('fixture-run-001'); // original runId retained
        expect(rescored.scores).toEqual(JSON.parse(readFileSync(join(workDir, 'audit.json'), 'utf-8')).scores);

        // Refuses overwrite if revision directory is non-empty
        await expect(seoScore([workDir, revDir])).rejects.toThrow(/refusing overwrite/);
    });

    it('runs seo-report to render markdown and json report artifacts with a validated narrative', async () => {
        // A validated narrative selects allow-listed headings and points at immutable audit records.
        const auditDigest = createHash('sha256')
            .update(readFileSync(join(workDir, 'audit.json'), 'utf-8'))
            .digest('hex');
        const narrative = {
            schemaVersion: 1,
            runId: 'fixture-run-001',
            auditDigest,
            sections: [
                {
                    heading: 'summary',
                    claims: [
                        {
                            template: 'fact',
                            evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/pages_visited' },
                        },
                    ],
                },
                {
                    heading: 'limits',
                    claims: [
                        {
                            template: 'limit',
                            evidenceRef: { artifact: 'audit.json', jsonPointer: '/limits/pagesVisited' },
                        },
                    ],
                },
            ],
        };
        writeFileSync(join(workDir, 'narrative.json'), JSON.stringify(narrative));

        await seoReport([workDir]);

        const reportJsonPath = join(workDir, 'report.json');
        const reportMdPath = join(workDir, 'report.md');
        expect(existsSync(reportJsonPath)).toBe(true);
        expect(existsSync(reportMdPath)).toBe(true);

        const reportJson: ReportJsonArtifact = JSON.parse(readFileSync(reportJsonPath, 'utf-8'));
        expect(reportJson.schemaVersion).toBe(1);
        expect(reportJson.status).toBe('done');
        expect(reportJson.narrativeStatus).toBe('included');
        expect(reportJson.narrativeDiagnostics).toBeUndefined();

        const reportMd = readFileSync(reportMdPath, 'utf-8');
        expect(reportMd).toContain('# Smart SEO Audit Report');
        expect(reportMd).toContain('### Summary');
        expect(reportMd).toContain('Observed fact');
        expect(reportMd).toContain('### Limits');
        expect(reportMd).toContain('RFC 9309');
        expect(reportMd).toContain('Google retired FAQ rich results');
        expect(reportMd).toContain('2026-05-07');
    });

    it('rejects free-prose or unapproved-pointer narratives and falls back to a labeled deterministic report', async () => {
        // Free prose is the historical shape: it carries a `text` key and no audit identity,
        // so the whole narrative is refused rather than rendered as unvalidated prose.
        writeFileSync(
            join(workDir, 'narrative.json'),
            JSON.stringify({
                schemaVersion: 1,
                sections: [{ heading: 'Overview', text: 'Target site has good technical structure.' }],
            }),
        );
        await seoReport([workDir]);

        let reportJson: ReportJsonArtifact = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8'));
        expect(reportJson.narrativeStatus).toBe('rejected');
        expect(existsSync(join(workDir, 'narrative-diagnostics.json'))).toBe(true);
        let reportMd = readFileSync(join(workDir, 'report.md'), 'utf-8');
        expect(reportMd).toContain('**Narrative rejected**');
        expect(reportMd).toContain('- Coverage:');

        // A well-formed envelope that points outside the approved collections is equally refused.
        const auditDigest = createHash('sha256')
            .update(readFileSync(join(workDir, 'audit.json'), 'utf-8'))
            .digest('hex');
        writeFileSync(
            join(workDir, 'narrative.json'),
            JSON.stringify({
                schemaVersion: 1,
                runId: 'fixture-run-001',
                auditDigest,
                sections: [
                    {
                        heading: 'summary',
                        claims: [
                            {
                                template: 'fact',
                                evidenceRef: { artifact: 'audit.json', jsonPointer: '/facts/not_a_recorded_fact' },
                            },
                        ],
                    },
                ],
            }),
        );
        await seoReport([workDir]);

        reportJson = JSON.parse(readFileSync(join(workDir, 'report.json'), 'utf-8'));
        expect(reportJson.narrativeStatus).toBe('rejected');
        expect(reportJson.narrativeDiagnostics?.join(' ')).toContain('unknown fact id');
        reportMd = readFileSync(join(workDir, 'report.md'), 'utf-8');
        expect(reportMd).toContain('Narrative rejected');
    });

    it('renders report markdown with escaped user strings and disclaimers', () => {
        const sampleAudit: AuditArtifact = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'r1',
            createdAt: '2026-10-15T00:00:00Z',
            inputDigest: 'd1',
            predecessorDigests: {},
            status: 'complete',
            targetUrl: 'https://example.com/test?a=1&b=2',
            scores: { technical: 95, content: 90, crawl: 100, security: 100 },
            coverage: { totalRules: 52, applicableRules: 50, assessed: 50, unknown: 0, ratio: 1.0 },
            facts: {},
            assessments: [],
            actions: [
                {
                    id: 'SEO-title_missing-123456789012',
                    ruleId: 'title_missing',
                    title: 'Fix title tag on [Page] *bold*',
                    severity: 'critical',
                    priority: 'P1',
                    category: 'content',
                    affectedPagesCount: 1,
                    affectedSubjects: ['https://example.com/test'],
                    effort: 1,
                    heuristic: false,
                    description: 'Title missing',
                },
            ],
            judgments: { status: 'not-assessed' },
            performance: { status: 'not-assessed' },
            visibility: { status: 'not-assessed' },
            limits: {},
        };

        const md = renderReportMarkdown(sampleAudit, 'Executive narrative summary');
        expect(md).toContain('Category Scores & Coverage');
        expect(md).toContain('Prioritized Action Items');
        expect(md).toContain('SEO-title_missing-123456789012');
        expect(md).toContain('Fix title tag on \\[Page\\] \\*bold\\*');
        expect(md).toContain('Primary Sources & Disclaimers');
    });

    it('validates CLI arguments for seo-check, seo-score, and seo-report', async () => {
        await expect(seoCheck([])).rejects.toThrow(/usage/);
        await expect(seoCheck(['nonexistent-dir'])).rejects.toThrow(/missing crawl.json/);

        await expect(seoScore([])).rejects.toThrow(/usage/);
        await expect(seoScore(['nonexistent-dir'])).rejects.toThrow(/missing required input artifacts/);

        await expect(seoReport([])).rejects.toThrow(/usage/);
        await expect(seoReport(['nonexistent-dir'])).rejects.toThrow(/missing audit.json/);
    });
});
