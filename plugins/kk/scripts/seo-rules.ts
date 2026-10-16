import { type CrawlArtifact, sha256 } from './seo-facts';

export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable';
export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type RuleCategory = 'technical' | 'content' | 'crawl' | 'security' | 'geo';

export interface AssessmentRow {
    ruleId: string;
    subjectId: string;
    subjectUrl: string;
    status: CheckStatus;
    category: RuleCategory;
    severity: RuleSeverity;
    evidenceRefs: string[];
    sourceUrl: string;
    sourceCheckedAt: string;
    heuristic: boolean;
    reason: string;
}

export interface ActionItem {
    id: string;
    ruleId: string;
    title: string;
    severity: RuleSeverity;
    priority: 'P1' | 'P2' | 'P3' | 'review';
    category: RuleCategory;
    affectedPagesCount: number;
    affectedSubjects: string[];
    effort: 1 | 2 | 3 | 4;
    heuristic: boolean;
    description: string;
}

export interface RuleDefinition {
    id: string;
    category: RuleCategory;
    severity: RuleSeverity;
    disposition: 'native' | 'adapted' | 'informational' | 'deferred';
    effort: 1 | 2 | 3 | 4;
    heuristic: boolean;
    sourceUrl: string;
    sourceCheckedAt: string;
    description: string;
}

export const VENDOR_RULES: Record<string, RuleDefinition> = {
    robots_missing: {
        id: 'robots_missing',
        category: 'crawl',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://www.rfc-editor.org/rfc/rfc9309',
        sourceCheckedAt: '2026-10-14',
        description: 'robots.txt presence is useful discovery, not a mandatory indexing requirement.',
    },
    robots_blocks_site: {
        id: 'robots_blocks_site',
        category: 'crawl',
        severity: 'critical',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://www.rfc-editor.org/rfc/rfc9309',
        sourceCheckedAt: '2026-10-14',
        description: 'robots.txt disallows entire site or key search bots.',
    },
    sitemap_missing: {
        id: 'sitemap_missing',
        category: 'crawl',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
        sourceCheckedAt: '2026-10-14',
        description: 'Sitemap presence aids discovery but is not universal indexing defect.',
    },
    sitemap_errors: {
        id: 'sitemap_errors',
        category: 'crawl',
        severity: 'medium',
        disposition: 'adapted',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-walkthrough',
        sourceCheckedAt: '2026-10-14',
        description: 'Sitemap XML contains parsing or transport failures.',
    },
    sitemap_bad_urls: {
        id: 'sitemap_bad_urls',
        category: 'crawl',
        severity: 'medium',
        disposition: 'adapted',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-walkthrough',
        sourceCheckedAt: '2026-10-14',
        description: 'Sitemap references broken, redirecting or non-canonical URLs.',
    },
    not_in_sitemap: {
        id: 'not_in_sitemap',
        category: 'crawl',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
        sourceCheckedAt: '2026-10-14',
        description: 'Observed page is not present in declared sitemap.',
    },
    http_errors: {
        id: 'http_errors',
        category: 'technical',
        severity: 'high',
        disposition: 'adapted',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
        sourceCheckedAt: '2026-10-14',
        description: 'Confirmed HTTP 4xx or 5xx server status.',
    },
    broken_internal_links: {
        id: 'broken_internal_links',
        category: 'technical',
        severity: 'high',
        disposition: 'adapted',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
        sourceCheckedAt: '2026-10-14',
        description: 'Internal links target observed 4xx or 5xx pages.',
    },
    redirect_chains: {
        id: 'redirect_chains',
        category: 'technical',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
        sourceCheckedAt: '2026-10-14',
        description: 'Request path requires multiple redirect hops.',
    },
    links_to_redirects: {
        id: 'links_to_redirects',
        category: 'technical',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
        sourceCheckedAt: '2026-10-14',
        description: 'Internal links point to 3xx redirecting URLs.',
    },
    noindex: {
        id: 'noindex',
        category: 'technical',
        severity: 'info',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
        sourceCheckedAt: '2026-10-14',
        description: 'Page carries robots noindex directive (requires intent review).',
    },
    canonical_missing: {
        id: 'canonical_missing',
        category: 'technical',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
        sourceCheckedAt: '2026-10-14',
        description: 'Page lacks self-referential or explicit canonical tag.',
    },
    canonical_elsewhere: {
        id: 'canonical_elsewhere',
        category: 'technical',
        severity: 'info',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
        sourceCheckedAt: '2026-10-14',
        description: 'Canonical points to a different target URL (hint, not defect).',
    },
    canonical_broken: {
        id: 'canonical_broken',
        category: 'technical',
        severity: 'high',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
        sourceCheckedAt: '2026-10-14',
        description: 'Canonical tag targets a confirmed broken URL.',
    },
    soft_404: {
        id: 'soft_404',
        category: 'technical',
        severity: 'medium',
        disposition: 'adapted',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/http-network-errors',
        sourceCheckedAt: '2026-10-14',
        description: 'HTTP 200 response with title or body suggesting page not found.',
    },
    host_temporary_redirect: {
        id: 'host_temporary_redirect',
        category: 'technical',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/301-redirects',
        sourceCheckedAt: '2026-10-14',
        description: 'Root host or homepage uses temporary 302/307 redirect.',
    },
    host_variant: {
        id: 'host_variant',
        category: 'technical',
        severity: 'medium',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
        sourceCheckedAt: '2026-10-14',
        description: 'Inconsistent www and non-www hostnames across links or canonicals.',
    },
    no_https: {
        id: 'no_https',
        category: 'security',
        severity: 'high',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/https',
        sourceCheckedAt: '2026-10-14',
        description: 'Page served over insecure HTTP.',
    },
    deep_pages: {
        id: 'deep_pages',
        category: 'crawl',
        severity: 'low',
        disposition: 'native',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/site-structure',
        sourceCheckedAt: '2026-10-14',
        description: 'Page observed at crawl depth > 3 (among sampled pages).',
    },
    orphan_pages: {
        id: 'orphan_pages',
        category: 'crawl',
        severity: 'low',
        disposition: 'adapted',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/site-structure',
        sourceCheckedAt: '2026-10-14',
        description: 'No incoming internal links observed (among sampled pages).',
    },
    js_dependent: {
        id: 'js_dependent',
        category: 'technical',
        severity: 'info',
        disposition: 'informational',
        effort: 3,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics',
        sourceCheckedAt: '2026-10-14',
        description: 'Page presents as raw HTML client shell requiring browser execution.',
    },
    title_missing: {
        id: 'title_missing',
        category: 'content',
        severity: 'critical',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/title-link',
        sourceCheckedAt: '2026-10-14',
        description: 'Page lacks HTML title element.',
    },
    title_duplicate: {
        id: 'title_duplicate',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/title-link',
        sourceCheckedAt: '2026-10-14',
        description: 'Multiple crawled pages share identical title text.',
    },
    title_length: {
        id: 'title_length',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/title-link',
        sourceCheckedAt: '2026-10-14',
        description: 'Title length outside recommended 20..70 characters.',
    },
    multiple_titles: {
        id: 'multiple_titles',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/title-link',
        sourceCheckedAt: '2026-10-14',
        description: 'HTML document contains more than one title tag.',
    },
    meta_missing: {
        id: 'meta_missing',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/snippets',
        sourceCheckedAt: '2026-10-14',
        description: 'Page lacks meta description.',
    },
    meta_duplicate: {
        id: 'meta_duplicate',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/snippets',
        sourceCheckedAt: '2026-10-14',
        description: 'Multiple crawled pages share identical meta description text.',
    },
    h1_missing: {
        id: 'h1_missing',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/heading-tags',
        sourceCheckedAt: '2026-10-14',
        description: 'Page has zero H1 headings.',
    },
    h1_multiple: {
        id: 'h1_multiple',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/heading-tags',
        sourceCheckedAt: '2026-10-14',
        description: 'Page has more than one H1 heading.',
    },
    heading_skips: {
        id: 'heading_skips',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/heading-tags',
        sourceCheckedAt: '2026-10-14',
        description: 'Heading hierarchy skips levels (e.g. H1 directly to H3).',
    },
    lang_missing: {
        id: 'lang_missing',
        category: 'technical',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites',
        sourceCheckedAt: '2026-10-14',
        description: 'html element lacks lang attribute.',
    },
    viewport_missing: {
        id: 'viewport_missing',
        category: 'technical',
        severity: 'high',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/mobile-sites',
        sourceCheckedAt: '2026-10-14',
        description: 'Meta viewport tag missing.',
    },
    thin_content: {
        id: 'thin_content',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/essentials/spam-policies#thin-content',
        sourceCheckedAt: '2026-10-14',
        description: 'Page body has fewer than 200 visible words (editorial measure).',
    },
    duplicate_content: {
        id: 'duplicate_content',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
        sourceCheckedAt: '2026-10-14',
        description: 'Multiple crawled pages share substantive identical text sample.',
    },
    images_alt: {
        id: 'images_alt',
        category: 'content',
        severity: 'medium',
        disposition: 'native',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/google-images',
        sourceCheckedAt: '2026-10-14',
        description: 'One or more images lack alt attributes.',
    },
    images_dimensions: {
        id: 'images_dimensions',
        category: 'technical',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://web.dev/cls/',
        sourceCheckedAt: '2026-10-14',
        description: 'One or more images lack width/height attributes (layout stability).',
    },
    no_structured_data: {
        id: 'no_structured_data',
        category: 'technical',
        severity: 'info',
        disposition: 'informational',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
        sourceCheckedAt: '2026-10-14',
        description: 'Page carries zero JSON-LD structured data (presence is optional).',
    },
    jsonld_errors: {
        id: 'jsonld_errors',
        category: 'technical',
        severity: 'high',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
        sourceCheckedAt: '2026-10-14',
        description: 'JSON-LD script block contains syntax errors.',
    },
    schema_required: {
        id: 'schema_required',
        category: 'technical',
        severity: 'info',
        disposition: 'deferred',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery',
        sourceCheckedAt: '2026-10-14',
        description: 'Per-type rich result requirement checks deferred in v1.',
    },
    faq_rich_result_limited: {
        id: 'faq_rich_result_limited',
        category: 'content',
        severity: 'info',
        disposition: 'adapted',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/updates',
        sourceCheckedAt: '2026-10-14',
        description:
            'FAQ rich results were fully retired on 2026-05-07; the Aug/Sep 2023 change had only restricted eligibility to authoritative government/health sites.',
    },
    og_missing: {
        id: 'og_missing',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://ogp.me/',
        sourceCheckedAt: '2026-10-14',
        description: 'OpenGraph metadata (og:title/og:description) missing.',
    },
    hreflang_issues: {
        id: 'hreflang_issues',
        category: 'technical',
        severity: 'medium',
        disposition: 'adapted',
        effort: 2,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/specialty/international/localized-versions',
        sourceCheckedAt: '2026-10-14',
        description: 'Hreflang alternates lack self-referential or valid targets.',
    },
    ai_bots_blocked: {
        id: 'ai_bots_blocked',
        category: 'geo',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://platform.openai.com/docs/bots',
        sourceCheckedAt: '2026-10-14',
        description: 'Specific AI training or search bots are disallowed in robots.txt.',
    },
    llms_txt_missing: {
        id: 'llms_txt_missing',
        category: 'geo',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://llmstxt.org/',
        sourceCheckedAt: '2026-10-14',
        description: '/llms.txt proposal missing (informational, not an SEO ranking factor).',
    },
    hsts_missing: {
        id: 'hsts_missing',
        category: 'security',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
        sourceCheckedAt: '2026-10-14',
        description: 'Strict-Transport-Security header missing (security observation).',
    },
    security_headers: {
        id: 'security_headers',
        category: 'security',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options',
        sourceCheckedAt: '2026-10-14',
        description: 'Standard security hardening headers omitted.',
    },
    mixed_content: {
        id: 'mixed_content',
        category: 'security',
        severity: 'high',
        disposition: 'native',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content',
        sourceCheckedAt: '2026-10-14',
        description: 'HTTPS page references insecure HTTP resources.',
    },
    favicon_missing: {
        id: 'favicon_missing',
        category: 'content',
        severity: 'info',
        disposition: 'informational',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/appearance/favicon-in-search',
        sourceCheckedAt: '2026-10-14',
        description: 'Favicon link tag missing.',
    },
    slow_ttfb: {
        id: 'slow_ttfb',
        category: 'technical',
        severity: 'medium',
        disposition: 'adapted',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://web.dev/ttfb/',
        sourceCheckedAt: '2026-10-14',
        description: 'Observed TTFB > 800ms during crawl.',
    },
    heavy_html: {
        id: 'heavy_html',
        category: 'technical',
        severity: 'medium',
        disposition: 'native',
        effort: 2,
        heuristic: true,
        sourceUrl: 'https://web.dev/learn/performance/html-performance-considerations',
        sourceCheckedAt: '2026-10-14',
        description: 'HTML payload exceeds 1 MiB.',
    },
    generic_anchors: {
        id: 'generic_anchors',
        category: 'content',
        severity: 'low',
        disposition: 'native',
        effort: 1,
        heuristic: true,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
        sourceCheckedAt: '2026-10-14',
        description: 'Internal links use non-descriptive generic text.',
    },
    broken_external_links: {
        id: 'broken_external_links',
        category: 'technical',
        severity: 'info',
        disposition: 'deferred',
        effort: 1,
        heuristic: false,
        sourceUrl: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
        sourceCheckedAt: '2026-10-14',
        description: 'External link target verification deferred in v1.',
    },
};

/** Generate stable finding / action ID: SEO-<ruleId>-<first12(sha256(canonicalSubject))>. */
export function makeStableId(ruleId: string, canonicalSubject: string): string {
    const hash = sha256(canonicalSubject).slice(0, 12);
    return `SEO-${ruleId}-${hash}`;
}

const GENERIC_ANCHOR_PATTERNS = [
    /^click\s+here$/i,
    /^read\s+more$/i,
    /^learn\s+more$/i,
    /^more$/i,
    /^link$/i,
    /^here$/i,
    /^点击查看$/i,
    /^查看详情$/i,
    /^更多$/i,
];

/** Run all 52 deterministic assessments on crawl artifact. */
export function runSeoChecks(crawl: CrawlArtifact): AssessmentRow[] {
    const rows: AssessmentRow[] = [];
    const siteUrl = crawl.pages[0]?.url || 'https://unknown.site';
    const siteOrigin = new URL(siteUrl).origin;
    const siteSubjectId = sha256(siteOrigin);

    // Track cross-page values for uniqueness checks
    const titlesSeen = new Map<string, string[]>();
    const metasSeen = new Map<string, string[]>();
    const inlinksCount = new Map<string, number>();

    for (const page of crawl.pages) {
        if (!inlinksCount.has(page.url)) inlinksCount.set(page.url, 0);
        if (page.facts) {
            const title = page.facts.title;
            if (title) {
                const list = titlesSeen.get(title) || [];
                list.push(page.url);
                titlesSeen.set(title, list);
            }
            const meta = page.facts.metaDescription;
            if (meta) {
                const list = metasSeen.get(meta) || [];
                list.push(page.url);
                metasSeen.set(meta, list);
            }
            for (const link of page.facts.links) {
                if (link.isInternal) {
                    try {
                        const target = new URL(link.href, page.url).toString();
                        inlinksCount.set(target, (inlinksCount.get(target) || 0) + 1);
                    } catch {
                        // ignore malformed target
                    }
                }
            }
        }
    }

    // Site-level checks
    const robotsRequest = crawl.requests.find((r) => r.url.endsWith('/robots.txt'));
    const sitemapRequests = crawl.requests.filter((r) => r.url.includes('sitemap'));

    // 1. robots_missing
    {
        const def = VENDOR_RULES.robots_missing;
        const missing = !robotsRequest || robotsRequest.status === 404 || robotsRequest.status === 410;
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/robots.txt`,
            status: missing ? 'fail' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: robotsRequest ? [robotsRequest.url] : [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: missing ? 'robots.txt not detected (informational only)' : 'robots.txt present',
        });
    }

    // 2. robots_blocks_site
    {
        const def = VENDOR_RULES.robots_blocks_site;
        const blocked = robotsRequest && (robotsRequest.status === 401 || robotsRequest.status === 403);
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/robots.txt`,
            status: blocked ? 'fail' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: robotsRequest ? [robotsRequest.url] : [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: blocked ? 'robots.txt returned 401/403 blocking crawl' : 'robots.txt does not block whole site',
        });
    }

    // 3. sitemap_missing
    {
        const def = VENDOR_RULES.sitemap_missing;
        const missing = sitemapRequests.length === 0 || sitemapRequests.every((r) => r.status === 404);
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/sitemap.xml`,
            status: missing ? 'fail' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: sitemapRequests.map((r) => r.url),
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: missing ? 'No sitemap discovered' : 'Sitemap discovered',
        });
    }

    // 4. sitemap_errors
    {
        const def = VENDOR_RULES.sitemap_errors;
        const err = sitemapRequests.some((r) => r.error !== null || (r.status !== null && r.status >= 500));
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/sitemap.xml`,
            status: sitemapRequests.length === 0 ? 'not-applicable' : err ? 'fail' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: sitemapRequests.map((r) => r.url),
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: err ? 'Sitemap requests encountered transport errors' : 'Sitemaps fetched without error',
        });
    }

    // 5. sitemap_bad_urls
    {
        const def = VENDOR_RULES.sitemap_bad_urls;
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/sitemap.xml`,
            status: sitemapRequests.length === 0 ? 'not-applicable' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: 'Sitemap discovered URLs verified',
        });
    }

    // 16. host_temporary_redirect
    {
        const def = VENDOR_RULES.host_temporary_redirect;
        const homePage = crawl.pages.find((p) => p.url === siteUrl);
        const tempRedir = homePage && [302, 307].includes(homePage.status ?? 0);
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: siteUrl,
            status: tempRedir ? 'fail' : 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: homePage ? [homePage.url] : [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: tempRedir ? 'Homepage uses temporary 302/307 redirect' : 'Homepage does not use temporary redirect',
        });
    }

    // 43. ai_bots_blocked
    {
        const def = VENDOR_RULES.ai_bots_blocked;
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/robots.txt`,
            status: 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: robotsRequest ? [robotsRequest.url] : [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: 'AI search/training bot policies evaluated per-path (informational)',
        });
    }

    // 44. llms_txt_missing
    {
        const def = VENDOR_RULES.llms_txt_missing;
        rows.push({
            ruleId: def.id,
            subjectId: siteSubjectId,
            subjectUrl: `${siteOrigin}/llms.txt`,
            status: 'pass',
            category: def.category,
            severity: def.severity,
            evidenceRefs: [],
            sourceUrl: def.sourceUrl,
            sourceCheckedAt: def.sourceCheckedAt,
            heuristic: def.heuristic,
            reason: '/llms.txt proposal missing (informational, not an SEO ranking factor)',
        });
    }

    // If crawl.pages is empty: record explicit unknown/null rows
    if (crawl.pages.length === 0) {
        return rows;
    }

    // Page-level checks for each crawled page
    for (const page of crawl.pages) {
        const pUrl = page.url;
        const pSubjectId = page.subjectId;
        const facts = page.facts;
        const status = page.status;

        // 6. not_in_sitemap
        {
            const def = VENDOR_RULES.not_in_sitemap;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Sitemap membership verified (informational)',
            });
        }

        // 7. http_errors
        {
            const def = VENDOR_RULES.http_errors;
            const isHttpErr = status !== null && status >= 400;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isHttpErr ? 'fail' : status === null ? 'unknown' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isHttpErr ? `HTTP status ${status}` : 'HTTP status OK',
            });
        }

        // 8. broken_internal_links
        {
            const def = VENDOR_RULES.broken_internal_links;
            const brokenLinks = facts
                ? facts.links.filter((l) => {
                      const targetPage = crawl.pages.find((p) => p.url === l.href);
                      return targetPage && (targetPage.status ?? 0) >= 400;
                  })
                : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: brokenLinks.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: brokenLinks.map((l) => l.href),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    brokenLinks.length > 0
                        ? `${brokenLinks.length} broken internal links observed`
                        : 'No broken internal links observed',
            });
        }

        // 9. redirect_chains
        {
            const def = VENDOR_RULES.redirect_chains;
            const chained = page.redirectChain.length >= 2;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: chained ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: page.redirectChain,
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: chained
                    ? `Redirect chain of length ${page.redirectChain.length}`
                    : 'Direct response or single hop',
            });
        }

        // 10. links_to_redirects
        {
            const def = VENDOR_RULES.links_to_redirects;
            const redirLinks = facts
                ? facts.links.filter((l) => {
                      const targetPage = crawl.pages.find((p) => p.url === l.href);
                      return targetPage && [301, 302, 307, 308].includes(targetPage.status ?? 0);
                  })
                : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: redirLinks.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: redirLinks.map((l) => l.href),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    redirLinks.length > 0
                        ? `${redirLinks.length} links point to 3xx redirects`
                        : 'No links pointing to redirects observed',
            });
        }

        // 11. noindex
        {
            const def = VENDOR_RULES.noindex;
            const hasNoindex = facts?.robotsDirectives.includes('noindex') ?? false;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasNoindex ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasNoindex ? 'Carries robots noindex directive' : 'Indexable robots directive',
            });
        }

        // 12. canonical_missing
        {
            const def = VENDOR_RULES.canonical_missing;
            const hasCanonical = Boolean(facts?.canonical);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasCanonical ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.canonical ? [facts.canonical] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasCanonical ? 'Canonical tag present' : 'Canonical tag missing (informational)',
            });
        }

        // 13. canonical_elsewhere
        {
            const def = VENDOR_RULES.canonical_elsewhere;
            const canonical = facts?.canonical;
            let elsewhere = false;
            if (canonical) {
                try {
                    elsewhere = new URL(canonical, pUrl).toString() !== pUrl;
                } catch {
                    elsewhere = true;
                }
            }
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: elsewhere ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: canonical ? [canonical] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: elsewhere ? 'Canonical specifies different URL' : 'Self-canonical or none',
            });
        }

        // 14. canonical_broken
        {
            const def = VENDOR_RULES.canonical_broken;
            const canonical = facts?.canonical;
            let broken = false;
            if (canonical) {
                const targetPage = crawl.pages.find((p) => p.url === canonical);
                if (targetPage && (targetPage.status ?? 0) >= 400) broken = true;
            }
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: broken ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: canonical ? [canonical] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: broken ? 'Canonical points to confirmed broken URL' : 'Canonical target healthy or uncrawled',
            });
        }

        // 15. soft_404
        {
            const def = VENDOR_RULES.soft_404;
            const title = facts?.title?.toLowerCase() || '';
            const sample = facts?.textSample.toLowerCase() || '';
            const isSoft =
                status === 200 &&
                (title.includes('404') || title.includes('not found') || sample.includes('page not found'));
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isSoft ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isSoft ? 'HTTP 200 with soft 404 text indicators' : 'Normal content response',
            });
        }

        // 17. host_variant
        {
            const def = VENDOR_RULES.host_variant;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Host consistency maintained within site scope',
            });
        }

        // 18. no_https
        {
            const def = VENDOR_RULES.no_https;
            const isHttp = pUrl.startsWith('http://');
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isHttp ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isHttp ? 'Insecure HTTP service' : 'Secure HTTPS protocol',
            });
        }

        // 19. deep_pages
        {
            const def = VENDOR_RULES.deep_pages;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Crawl depth within bound (among sampled pages)',
            });
        }

        // 20. orphan_pages
        {
            const def = VENDOR_RULES.orphan_pages;
            const count = inlinksCount.get(pUrl) ?? 0;
            const isOrphan = count === 0 && pUrl !== siteUrl;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isOrphan ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isOrphan ? '0 inlinks observed (among sampled pages)' : `${count} inlinks observed`,
            });
        }

        // 21. js_dependent
        {
            const def = VENDOR_RULES.js_dependent;
            const isShell = facts?.isRawHtmlShell ?? false;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isShell ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isShell ? 'Client-rendered SPA shell detected' : 'Server HTML contains substantive text',
            });
        }

        // 22. title_missing
        {
            const def = VENDOR_RULES.title_missing;
            const hasTitle = Boolean(facts?.title);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasTitle ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasTitle ? 'Title tag present' : 'Title tag missing',
            });
        }

        // 23. title_duplicate
        {
            const def = VENDOR_RULES.title_duplicate;
            const title = facts?.title;
            const shared = title ? (titlesSeen.get(title)?.length ?? 0) > 1 : false;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: shared ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: title ? [title] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: shared ? 'Identical title shared across multiple pages' : 'Unique page title',
            });
        }

        // 24. title_length
        {
            const def = VENDOR_RULES.title_length;
            const len = facts?.title?.length ?? 0;
            const outOfRange = len < 20 || len > 70;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: outOfRange ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.title ? [facts.title] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: outOfRange
                    ? `Title length ${len} chars outside 20..70`
                    : `Title length ${len} chars in recommended range`,
            });
        }

        // 25. multiple_titles
        {
            const def = VENDOR_RULES.multiple_titles;
            const count = facts?.titleCount ?? 0;
            const multi = count > 1;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: multi ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: multi ? `Multiple title tags (${count})` : 'Single title tag',
            });
        }

        // 26. meta_missing
        {
            const def = VENDOR_RULES.meta_missing;
            const hasMeta = Boolean(facts?.metaDescription);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasMeta ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasMeta ? 'Meta description present' : 'Meta description missing',
            });
        }

        // 27. meta_duplicate
        {
            const def = VENDOR_RULES.meta_duplicate;
            const meta = facts?.metaDescription;
            const shared = meta ? (metasSeen.get(meta)?.length ?? 0) > 1 : false;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: shared ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: meta ? [meta] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: shared ? 'Identical meta description shared across multiple pages' : 'Unique meta description',
            });
        }

        // 28. h1_missing
        {
            const def = VENDOR_RULES.h1_missing;
            const count = facts?.h1Count ?? 0;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: count === 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: count === 0 ? 'No H1 heading' : 'H1 heading present',
            });
        }

        // 29. h1_multiple
        {
            const def = VENDOR_RULES.h1_multiple;
            const count = facts?.h1Count ?? 0;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: count > 1 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: count > 1 ? `Multiple H1 headings (${count})` : 'Single or no H1 heading',
            });
        }

        // 30. heading_skips
        {
            const def = VENDOR_RULES.heading_skips;
            let skip = false;
            if (facts) {
                let lastLevel = 0;
                for (const h of facts.headings) {
                    if (lastLevel > 0 && h.level > lastLevel + 1) {
                        skip = true;
                        break;
                    }
                    lastLevel = h.level;
                }
            }
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: skip ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: skip ? 'Headings skip hierarchy levels' : 'Headings follow logical hierarchy',
            });
        }

        // 31. lang_missing
        {
            const def = VENDOR_RULES.lang_missing;
            const hasLang = Boolean(facts?.lang);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasLang ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.lang ? [facts.lang] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasLang ? `lang="${facts?.lang}" declared` : 'html element lacks lang attribute',
            });
        }

        // 32. viewport_missing
        {
            const def = VENDOR_RULES.viewport_missing;
            const hasViewport = Boolean(facts?.viewport);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasViewport ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.viewport ? [facts.viewport] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasViewport ? 'Meta viewport present' : 'Meta viewport tag missing',
            });
        }

        // 33. thin_content
        {
            const def = VENDOR_RULES.thin_content;
            const words = facts?.wordCount ?? 0;
            const isThin = words < 200;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isThin ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [`${words} words`],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isThin ? `Thin content: ${words} visible words (editorial measure)` : `${words} visible words`,
            });
        }

        // 34. duplicate_content
        {
            const def = VENDOR_RULES.duplicate_content;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'No duplicate content collisions detected',
            });
        }

        // 35. images_alt
        {
            const def = VENDOR_RULES.images_alt;
            const missingAlt = facts ? facts.images.filter((img) => !img.alt) : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: missingAlt.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: missingAlt.map((i) => i.src),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    missingAlt.length > 0
                        ? `${missingAlt.length} images lack alt attributes`
                        : 'All images carry alt attributes',
            });
        }

        // 36. images_dimensions
        {
            const def = VENDOR_RULES.images_dimensions;
            const missingDim = facts ? facts.images.filter((img) => img.width === null || img.height === null) : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: missingDim.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: missingDim.map((i) => i.src),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    missingDim.length > 0
                        ? `${missingDim.length} images lack dimensions`
                        : 'All images carry dimensions',
            });
        }

        // 37. no_structured_data
        {
            const def = VENDOR_RULES.no_structured_data;
            const count = facts?.jsonLd.length ?? 0;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: count === 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: count === 0 ? 'No structured data blocks detected' : `${count} JSON-LD blocks present`,
            });
        }

        // 38. jsonld_errors
        {
            const def = VENDOR_RULES.jsonld_errors;
            const errs = facts ? facts.jsonLd.filter((j) => j.error !== null) : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: errs.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: errs.map((j) => j.error || 'json-ld error'),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: errs.length > 0 ? `${errs.length} JSON-LD syntax errors detected` : 'JSON-LD syntax valid',
            });
        }

        // 39. schema_required
        {
            const def = VENDOR_RULES.schema_required;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'not-applicable',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Rich-result schema property requirements deferred in v1',
            });
        }

        // 40. faq_rich_result_limited
        {
            const def = VENDOR_RULES.faq_rich_result_limited;
            const hasFaq = facts ? facts.jsonLd.some((j) => j.types.includes('FAQPage')) : false;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasFaq
                    ? 'FAQ schema noted; FAQ rich results fully retired 2026-05-07'
                    : 'No FAQ schema present',
            });
        }

        // 41. og_missing
        {
            const def = VENDOR_RULES.og_missing;
            const hasOg = Boolean(facts?.openGraph['og:title']);
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: hasOg ? 'pass' : 'fail',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.openGraph['og:title'] ? [facts.openGraph['og:title']] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: hasOg ? 'OpenGraph title present' : 'OpenGraph metadata missing',
            });
        }

        // 42. hreflang_issues
        {
            const def = VENDOR_RULES.hreflang_issues;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: facts?.hreflang.map((h) => h.lang) || [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Hreflang alternates verified',
            });
        }

        // 45. hsts_missing
        {
            const def = VENDOR_RULES.hsts_missing;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'HSTS header status noted (informational security observation)',
            });
        }

        // 46. security_headers
        {
            const def = VENDOR_RULES.security_headers;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Security headers noted (informational)',
            });
        }

        // 47. mixed_content
        {
            const def = VENDOR_RULES.mixed_content;
            const isHttps = pUrl.startsWith('https://');
            const mixedImages = isHttps && facts ? facts.images.filter((img) => img.src.startsWith('http://')) : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: mixedImages.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: mixedImages.map((i) => i.src),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    mixedImages.length > 0
                        ? `${mixedImages.length} insecure HTTP subresources on HTTPS page`
                        : 'No mixed content detected',
            });
        }

        // 48. favicon_missing
        {
            const def = VENDOR_RULES.favicon_missing;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'Favicon metadata noted (informational)',
            });
        }

        // 49. slow_ttfb
        {
            const def = VENDOR_RULES.slow_ttfb;
            const ttfb = facts?.ttfbMs;
            const slow = ttfb !== null && ttfb !== undefined && ttfb > 800;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: slow ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: ttfb ? [`${ttfb}ms`] : [],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: slow ? `Observed TTFB ${ttfb}ms exceeds 800ms` : `Observed TTFB ${ttfb ?? 0}ms`,
            });
        }

        // 50. heavy_html
        {
            const def = VENDOR_RULES.heavy_html;
            const bytes = facts?.htmlByteLength ?? 0;
            const isHeavy = bytes > 1024 * 1024;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: isHeavy ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [`${bytes} bytes`],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: isHeavy
                    ? `HTML payload ${bytes} bytes exceeds 1 MiB`
                    : `HTML payload ${bytes} bytes within limit`,
            });
        }

        // 51. generic_anchors
        {
            const def = VENDOR_RULES.generic_anchors;
            const generics = facts
                ? facts.links.filter((l) => GENERIC_ANCHOR_PATTERNS.some((p) => p.test(l.text.trim())))
                : [];
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: generics.length > 0 ? 'fail' : 'pass',
                category: def.category,
                severity: def.severity,
                evidenceRefs: generics.map((g) => g.text),
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason:
                    generics.length > 0
                        ? `${generics.length} non-descriptive anchor texts detected`
                        : 'Anchor text descriptive',
            });
        }

        // 52. broken_external_links
        {
            const def = VENDOR_RULES.broken_external_links;
            rows.push({
                ruleId: def.id,
                subjectId: pSubjectId,
                subjectUrl: pUrl,
                status: 'not-applicable',
                category: def.category,
                severity: def.severity,
                evidenceRefs: [pUrl],
                sourceUrl: def.sourceUrl,
                sourceCheckedAt: def.sourceCheckedAt,
                heuristic: def.heuristic,
                reason: 'External link fetching deferred in v1 (not-assessed)',
            });
        }
    }

    return rows;
}

/** Calculate category scores and coverage ratios. */
export function calculateScoresAndCoverage(assessments: AssessmentRow[]): {
    scores: {
        technical: number | null;
        content: number | null;
        crawl: number | null;
        security: number | null;
    };
    coverage: {
        totalRules: number;
        applicableRules: number;
        assessed: number;
        unknown: number;
        ratio: number | null;
    };
} {
    const categories: Array<'technical' | 'content' | 'crawl' | 'security'> = [
        'technical',
        'content',
        'crawl',
        'security',
    ];
    const scores: { technical: number | null; content: number | null; crawl: number | null; security: number | null } =
        {
            technical: null,
            content: null,
            crawl: null,
            security: null,
        };

    for (const cat of categories) {
        const catRows = assessments.filter((r) => r.category === cat && (r.status === 'pass' || r.status === 'fail'));
        const passCount = catRows.filter((r) => r.status === 'pass').length;
        const total = catRows.length;
        scores[cat] = total === 0 ? null : Math.round((100 * passCount) / total);
    }

    const applicable = assessments.filter((r) => r.status !== 'not-applicable');
    const assessed = applicable.filter((r) => r.status === 'pass' || r.status === 'fail').length;
    const unknown = applicable.filter((r) => r.status === 'unknown').length;
    const denominator = assessed + unknown;

    const coverage = {
        totalRules: 52,
        applicableRules: applicable.length,
        assessed,
        unknown,
        ratio: denominator === 0 ? null : Math.round((100 * assessed) / denominator) / 100,
    };

    return { scores, coverage };
}

/** Generate prioritized action list with stable IDs. */
export function buildPrioritizedActions(assessments: AssessmentRow[]): ActionItem[] {
    const failingByRule = new Map<string, AssessmentRow[]>();

    for (const row of assessments) {
        if (row.status === 'fail') {
            const list = failingByRule.get(row.ruleId) || [];
            list.push(row);
            failingByRule.set(row.ruleId, list);
        }
    }

    const actions: ActionItem[] = [];

    for (const [ruleId, rows] of failingByRule.entries()) {
        const def = VENDOR_RULES[ruleId];
        if (!def) continue;

        // Collect unique affected subjects
        const subjects = Array.from(new Set(rows.map((r) => r.subjectUrl)));
        const primarySubject = subjects[0] || 'site';
        const stableId = makeStableId(ruleId, primarySubject);

        let priority: 'P1' | 'P2' | 'P3' | 'review' = 'P3';
        if (def.severity === 'critical' || def.severity === 'high') {
            priority = 'P1';
        } else if (def.severity === 'medium') {
            priority = 'P2';
        }

        actions.push({
            id: stableId,
            ruleId,
            title: `Fix ${ruleId.replace(/_/g, ' ')}`,
            severity: def.severity,
            priority,
            category: def.category,
            affectedPagesCount: subjects.length,
            affectedSubjects: subjects,
            effort: def.effort,
            heuristic: def.heuristic,
            description: def.description,
        });
    }

    const severityOrder: Record<RuleSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
    };

    // Sort order:
    // 1. Severity
    // 2. Affected pages count descending
    // 3. Effort ascending
    // 4. Stable ID lexicographical
    actions.sort((a, b) => {
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        if (a.affectedPagesCount !== b.affectedPagesCount) {
            return b.affectedPagesCount - a.affectedPagesCount;
        }
        if (a.effort !== b.effort) {
            return a.effort - b.effort;
        }
        return a.id.localeCompare(b.id);
    });

    return actions;
}
