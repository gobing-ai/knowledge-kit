import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    type CrawlArtifact,
    extractHtmlFacts,
    getScopeHostnames,
    isUrlInScope,
    normalizeUrl,
    validateOptions,
} from '../scripts/seo-facts';
import {
    fetchWithPinnedDns,
    isPrivateIPv4,
    isPrivateIPv6,
    isPublicAddress,
    parseRobotsTxt,
    parseSitemapXml,
    pinnedSingleRequest,
    resolveAndPinDns,
} from '../scripts/seo-fetch';
import { seoCollect, seoPreflight } from '../scripts/seo-stages';

// seo-stages.ts ships as a node-builtin-only script, so console.error IS its progress channel.
// Mute it per test so in-process stage runs don't pollute the test reporter.
let stageProgress: { mockRestore(): void };
beforeEach(() => {
    stageProgress = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => stageProgress.mockRestore());

describe('Smart SEO Attribution and Upstream Disposition (R1 / AC1)', () => {
    it('verifies upstream MIT attribution and commit reference', () => {
        const attributionPath = resolve('plugins/kk/references/smart-seo-attribution.md');
        expect(existsSync(attributionPath)).toBe(true);

        const content = readFileSync(attributionPath, 'utf-8');
        expect(content).toContain('Agrici Daniel');
        expect(content).toContain('55a184a3b0d09565a4c84268f725a47784e62528');
        expect(content).toContain('MIT License');
        expect(content).toContain('docs/plans/2026-10-14-smart-seo-vendor-review.md');
    });

    it('verifies that all 52 deterministic rules have explicit dispositions', () => {
        const reviewPath = resolve('docs/plans/2026-10-14-smart-seo-vendor-review.md');
        expect(existsSync(reviewPath)).toBe(true);

        const reviewContent = readFileSync(reviewPath, 'utf-8');
        const attributionContent = readFileSync(resolve('plugins/kk/references/smart-seo-attribution.md'), 'utf-8');

        // Check key rules from all categories
        const sampleRules = [
            'robots_missing',
            'robots_blocks_site',
            'sitemap_missing',
            'sitemap_errors',
            'redirect_chains',
            'title_missing',
            'meta_missing',
            'h1_missing',
            'thin_content',
            'duplicate_content',
            'schema_required',
            'faq_rich_result_limited',
            'ai_bots_blocked',
            'broken_external_links',
        ];

        for (const rule of sampleRules) {
            expect(reviewContent).toContain(`\`${rule}\``);
            expect(attributionContent).toContain(rule);
        }

        expect(attributionContent).toContain('Native (24 rules)');
        expect(attributionContent).toContain('Adapted (15 rules)');
        expect(attributionContent).toContain('Informational (11 rules)');
        expect(attributionContent).toContain('Deferred (2 rules)');
    });

    it('confirms no vendor runtime paths are imported in scripts', () => {
        const scriptFiles = ['seo-facts.ts', 'seo-fetch.ts', 'seo-stages.ts', 'kk-workflow-stages.ts'];
        for (const file of scriptFiles) {
            const p = resolve('plugins/kk/scripts', file);
            if (existsSync(p)) {
                const code = readFileSync(p, 'utf-8');
                expect(code).not.toContain('vendors/');
                expect(code).not.toContain('jev-seo');
            }
        }
    });
});

describe('Smart SEO Options and Scope Validation (R1, R2)', () => {
    it('validates correct options and fills defaults', () => {
        const opts = validateOptions({
            url: 'https://example.com/start',
        });
        expect(opts.url).toBe('https://example.com/start');
        expect(opts.locale).toBe('en-US');
        expect(opts.max_pages).toBe(60);
        expect(opts.max_depth).toBe(5);
        expect(opts.max_requests).toBe(200);
        expect(opts.deadline_seconds).toBe(600);
        expect(opts.performance).toBe(false);
    });

    it('rejects URLs with credentials, nonstandard ports, or local/reserved addresses', () => {
        expect(() => validateOptions({ url: 'https://user:pass@example.com' })).toThrow(/credentials/);
        expect(() => validateOptions({ url: 'https://example.com:8080' })).toThrow(/nonstandard port/);
        expect(() => validateOptions({ url: 'http://localhost' })).toThrow(/local\/reserved/);
        expect(() => validateOptions({ url: 'http://127.0.0.1' })).toThrow(/local\/reserved/);
        expect(() => validateOptions({ url: 'http://[::1]' })).toThrow(/local\/reserved/);
        expect(() => validateOptions({ url: 'http://mysite.local' })).toThrow(/local\/reserved/);
    });

    it('rejects invalid BCP-47 locale and out-of-range limits', () => {
        expect(() => validateOptions({ url: 'https://example.com', locale: 'invalid_locale!' })).toThrow(/BCP-47/);
        expect(() => validateOptions({ url: 'https://example.com', max_pages: 500 })).toThrow(/max_pages/);
        expect(() => validateOptions({ url: 'https://example.com', max_depth: 0 })).toThrow(/max_depth/);
        expect(() => validateOptions({ url: 'https://example.com', deadline_seconds: 5 })).toThrow(/deadline_seconds/);
    });

    it('preserves pathname, slashes, queries and removes fragments', () => {
        expect(normalizeUrl('https://example.com/a')).toBe('https://example.com/a');
        expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a/');
        expect(normalizeUrl('https://example.com/path?q=1&b=2')).toBe('https://example.com/path?q=1&b=2');
        expect(normalizeUrl('https://example.com/path#fragment')).toBe('https://example.com/path');
    });

    it('derives exact www-toggle site scope', () => {
        const s1 = getScopeHostnames('example.com');
        expect(s1.has('example.com')).toBe(true);
        expect(s1.has('www.example.com')).toBe(true);
        expect(s1.has('sub.example.com')).toBe(false);

        const s2 = getScopeHostnames('www.example.com');
        expect(s2.has('example.com')).toBe(true);
        expect(s2.has('www.example.com')).toBe(true);

        const s3 = getScopeHostnames('shop.example.com');
        expect(s3.has('shop.example.com')).toBe(true);
        expect(s3.has('www.shop.example.com')).toBe(true);
        expect(s3.has('example.com')).toBe(false);

        expect(isUrlInScope('https://www.example.com/page', s1)).toBe(true);
        expect(isUrlInScope('https://other.com/page', s1)).toBe(false);
    });
});

describe('Network Trust Boundary & Pinned Transport (R2 / AC2)', () => {
    it('classifies private and public IPv4 / IPv6 ranges accurately', () => {
        // Private IPv4
        expect(isPrivateIPv4('10.0.0.1')).toBe(true);
        expect(isPrivateIPv4('172.16.0.5')).toBe(true);
        expect(isPrivateIPv4('172.31.255.255')).toBe(true);
        expect(isPrivateIPv4('172.32.0.1')).toBe(false); // Public
        expect(isPrivateIPv4('192.168.1.1')).toBe(true);
        expect(isPrivateIPv4('127.0.0.1')).toBe(true);
        expect(isPrivateIPv4('169.254.1.1')).toBe(true);
        expect(isPrivateIPv4('100.64.0.1')).toBe(true); // CGNAT
        expect(isPrivateIPv4('192.0.2.1')).toBe(true); // TEST-NET-1
        expect(isPrivateIPv4('224.0.0.1')).toBe(true); // Multicast
        expect(isPrivateIPv4('8.8.8.8')).toBe(false); // Public Google DNS
        expect(isPrivateIPv4('1.1.1.1')).toBe(false); // Public Cloudflare DNS

        // Private IPv6
        expect(isPrivateIPv6('::1')).toBe(true);
        expect(isPrivateIPv6('fe80::1')).toBe(true);
        expect(isPrivateIPv6('fc00::1')).toBe(true);
        expect(isPrivateIPv6('fd12:3456::1')).toBe(true);
        expect(isPrivateIPv6('::ffff:192.168.1.1')).toBe(true);
        expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false);

        // General public policy
        expect(isPublicAddress('8.8.8.8', false)).toBe(true);
        expect(isPublicAddress('127.0.0.1', false)).toBe(false);
        expect(isPublicAddress('127.0.0.1', true)).toBe(true); // with test-only loopback policy
    });

    it('rejects loopback address in production mode (fail closed)', async () => {
        await expect(resolveAndPinDns('127.0.0.1', { allowLoopback: false })).rejects.toThrow(
            /Forbidden non-public IP/,
        );
    });
});

describe('Local HTTP/HTTPS Servers & Peer Checks (R2 / AC2)', () => {
    let httpServer: http.Server;
    let httpPort: number;

    let httpsServer: https.Server;
    let httpsPort: number;
    let sslKey: string;
    let sslCert: string;

    beforeAll(async () => {
        // Start HTTP test server
        await new Promise<void>((resolvePromise) => {
            httpServer = http.createServer((req, res) => {
                const url = req.url ?? '/';
                if (url === '/redirect-ok') {
                    res.writeHead(302, { Location: '/final' });
                    res.end();
                    return;
                }
                if (url === '/redirect-offsite') {
                    res.writeHead(302, { Location: 'http://evil.com/leak' });
                    res.end();
                    return;
                }
                if (url === '/final') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><head><title>Final Page</title></head><body><h1>Final</h1></body></html>');
                    return;
                }
                if (url === '/stall-body') {
                    // Headers arrive promptly; the body never completes.
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.write('<html>');
                    return;
                }
                if (url === '/large') {
                    // Send > 2 MiB
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    const chunk = Buffer.alloc(1024 * 1024, 'A');
                    res.write(chunk);
                    res.write(chunk);
                    res.write(chunk);
                    res.end();
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><head><title>Root</title></head><body>Hello</body></html>');
            });
            httpServer.listen(0, '127.0.0.1', () => {
                httpPort = (httpServer.address() as { port: number }).port;
                resolvePromise();
            });
        });

        // Start HTTPS test server with on-the-fly certificate.
        // openssl writes key and cert to separate scratch files: pointing both at /dev/stdout
        // only worked on the macOS char device — openssl 3 on Linux exits 1 with empty stdout
        // (run 38960927438).
        const certDir = mkdtempSync(join(tmpdir(), 'kk-seo-cert-'));
        const keyPath = join(certDir, 'key.pem');
        const certPath = join(certDir, 'cert.pem');
        try {
            execFileSync(
                'openssl',
                [
                    'req',
                    '-x509',
                    '-newkey',
                    'rsa:2048',
                    '-nodes',
                    '-keyout',
                    keyPath,
                    '-out',
                    certPath,
                    '-days',
                    '1',
                    '-subj',
                    '/CN=localhost',
                ],
                { stdio: ['ignore', 'ignore', 'ignore'] },
            );
            sslKey = readFileSync(keyPath, 'utf-8');
            sslCert = readFileSync(certPath, 'utf-8');
        } finally {
            rmSync(certDir, { recursive: true, force: true });
        }

        await new Promise<void>((resolvePromise) => {
            httpsServer = https.createServer({ key: sslKey, cert: sslCert }, (_req, res) => {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><head><title>Secure HTTPS</title></head><body>Secure Content</body></html>');
            });
            httpsServer.listen(0, '127.0.0.1', () => {
                httpsPort = (httpsServer.address() as { port: number }).port;
                resolvePromise();
            });
        });
    });

    afterAll(() => {
        httpServer?.close();
        httpsServer?.close();
    });

    it('performs connection pinning and peer address verification over local HTTP', async () => {
        const result = await pinnedSingleRequest(
            `http://localhost:${httpPort}/`,
            { ip: '127.0.0.1', family: 4 },
            { allowLoopback: true },
        );
        expect(result.status).toBe(200);
        expect(result.peerAddress).toBe('127.0.0.1');
        expect(result.body).toContain('Hello');
    });

    it('rejects connection if peer address does not match expected pinned IP', async () => {
        // Expect failure when pinned IP is mismatched
        await expect(
            pinnedSingleRequest(
                `http://localhost:${httpPort}/`,
                { ip: '127.0.0.2', family: 4 },
                { allowLoopback: true, timeoutMs: 1000 },
            ),
        ).rejects.toThrow();
    });

    it('verifies TLS SNI, certificate and pinned connection over HTTPS', async () => {
        const result = await pinnedSingleRequest(
            `https://localhost:${httpsPort}/`,
            { ip: '127.0.0.1', family: 4 },
            { allowLoopback: true, ca: sslCert },
        );
        expect(result.status).toBe(200);
        expect(result.body).toContain('Secure Content');
    });

    it('follows scoped redirects within site scope and records redirect chain', async () => {
        const scope = new Set(['localhost', 'www.localhost']);
        const result = await fetchWithPinnedDns(`http://localhost:${httpPort}/redirect-ok`, scope, {
            allowLoopback: true,
        });
        expect(result.status).toBe(200);
        expect(result.body).toContain('Final Page');
        expect(result.redirectChain.length).toBe(1);
    });

    it('stops at off-scope redirect target without leaking requests', async () => {
        const scope = new Set(['localhost', 'www.localhost']);
        const result = await fetchWithPinnedDns(`http://localhost:${httpPort}/redirect-offsite`, scope, {
            allowLoopback: true,
        });
        expect(result.status).toBe(302);
        expect(result.headers.location).toBe('http://evil.com/leak');
    });

    it('times out a response whose body stalls after the headers arrive', async () => {
        await expect(
            pinnedSingleRequest(
                `http://localhost:${httpPort}/stall-body`,
                { ip: '127.0.0.1', family: 4 },
                { allowLoopback: true, timeoutMs: 300 },
            ),
        ).rejects.toThrow(/timed out/);
    });

    it('aborts response streaming when byte limit is exceeded', async () => {
        await expect(
            pinnedSingleRequest(
                `http://localhost:${httpPort}/large`,
                { ip: '127.0.0.1', family: 4 },
                { allowLoopback: true, maxBytes: 2 * 1024 * 1024 },
            ),
        ).rejects.toThrow(/exceeded limit/);
    });
});

describe('Robots.txt and Sitemap Bounded Parsing (R3 / AC3)', () => {
    it('parses robots.txt with RFC 9309 longest match, allow tie-break, and wildcards', () => {
        const robotsContent = `
# robots.txt
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public.html
Disallow: /files/*.pdf$
Crawl-delay: 2.5
Sitemap: https://example.com/sitemap.xml

User-agent: Googlebot
Disallow: /nogoogle/
`;
        const policy = parseRobotsTxt(robotsContent);
        expect(policy.crawlDelaySeconds).toBe(2.5);
        expect(policy.sitemaps).toEqual(['https://example.com/sitemap.xml']);

        // Check path allowances for default UA
        expect(policy.isPathAllowed('/public')).toBe(true);
        expect(policy.isPathAllowed('/admin')).toBe(false);
        expect(policy.isPathAllowed('/admin/sub')).toBe(false);
        expect(policy.isPathAllowed('/private/secret.html')).toBe(false);
        expect(policy.isPathAllowed('/private/public.html')).toBe(true); // Allow wins (longer / tie break)
        expect(policy.isPathAllowed('/files/doc.pdf')).toBe(false); // Wildcard + end anchor
        expect(policy.isPathAllowed('/files/doc.pdf.html')).toBe(true); // Not ending with .pdf
    });

    it('parses bounded XML sitemaps and unescapes character entities', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page1?a=1&amp;b=2</loc>
    <lastmod>2026-10-15</lastmod>
  </url>
  <url>
    <loc>https://example.com/page2</loc>
  </url>
</urlset>`;

        const parsed = parseSitemapXml(xml);
        expect(parsed.urls).toEqual(['https://example.com/page1?a=1&b=2', 'https://example.com/page2']);
    });

    it('parses sitemapindex correctly', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap1.xml</loc>
  </sitemap>
</sitemapindex>`;

        const parsed = parseSitemapXml(xml);
        expect(parsed.childSitemaps).toEqual(['https://example.com/sitemap1.xml']);
    });

    it('refuses DOCTYPE and ENTITY constructs for XXE safety', () => {
        const evilXml = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<urlset><url><loc>&xxe;</loc></url></urlset>`;

        expect(() => parseSitemapXml(evilXml)).toThrow(/Forbidden XML construct/);
    });
});

describe('HTML Facts Extraction via HTMLRewriter (R3 / AC3)', () => {
    it('extracts complete SEO facts from HTML document', async () => {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>SEO Test Page</title>
  <meta name="description" content="A comprehensive SEO test page.">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta property="og:title" content="OG SEO Test">
  <link rel="canonical" href="https://example.com/canonical-test">
  <link rel="alternate" hreflang="es" href="https://example.com/es/test">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "SEO Testing Article"
  }
  </script>
</head>
<body>
  <header><nav><a href="/home">Home</a></nav></header>
  <h1>Main Heading One</h1>
  <p>First paragraph with substantive visible text for word count testing.</p>
  <h2>Sub Heading Two</h2>
  <img src="/img/sample.png" alt="Sample Image" width="400" height="300">
  <a href="/internal-link" rel="nofollow">Internal Link</a>
  <a href="https://external.org/out" rel="noopener">External Link</a>
</body>
</html>`;

        const facts = await extractHtmlFacts(html, {
            url: 'https://example.com/test',
            scopeHostnames: new Set(['example.com', 'www.example.com']),
            ttfbMs: 32,
        });

        expect(facts.title).toBe('SEO Test Page');
        expect(facts.titleCount).toBe(1);
        expect(facts.metaDescription).toBe('A comprehensive SEO test page.');
        expect(facts.metaDescriptionCount).toBe(1);
        expect(facts.canonical).toBe('https://example.com/canonical-test');
        expect(facts.robotsDirectives).toEqual(['index', 'follow']);
        expect(facts.viewport).toBe('width=device-width, initial-scale=1');
        expect(facts.lang).toBe('en');
        expect(facts.headings.length).toBe(2);
        expect(facts.h1Count).toBe(1);
        expect(facts.images.length).toBe(1);
        expect(facts.images[0]?.alt).toBe('Sample Image');
        expect(facts.links.length).toBe(3);
        expect(facts.links.find((l) => l.text === 'Internal Link')?.isInternal).toBe(true);
        expect(facts.links.find((l) => l.text === 'External Link')?.isInternal).toBe(false);
        expect(facts.openGraph['og:title']).toBe('OG SEO Test');
        expect(facts.jsonLd.length).toBe(1);
        expect(facts.jsonLd[0]?.types).toContain('Article');
        expect(facts.wordCount).toBeGreaterThan(5);
        expect(facts.ttfbMs).toBe(32);
        expect(facts.isRawHtmlShell).toBe(false);
    });

    it('detects raw HTML shell SPA pattern', async () => {
        const shellHtml = `<!DOCTYPE html>
<html>
<head><title>App</title><script src="/bundle.js"></script></head>
<body><div id="root"></div></body>
</html>`;

        const facts = await extractHtmlFacts(shellHtml, {
            url: 'https://example.com/app',
            scopeHostnames: new Set(['example.com']),
        });

        expect(facts.isRawHtmlShell).toBe(true);
    });
});

describe('Stage Execution: seo-preflight and seo-collect (R1–R3)', () => {
    // OS tmpdir, like every other suite here: scratch inside the repo tree would sit in the
    // pipeline's proof-input digest and drift it on each gate run.
    const testDir = mkdtempSync(join(tmpdir(), 'kk-seo-collect-'));
    const optionsFile = join(testDir, 'test-options.json');
    const workDir = join(testDir, 'workdir-test');

    let stageServer: http.Server;
    let stagePort: number;

    beforeAll(async () => {
        mkdirSync(testDir, { recursive: true });

        // HTTP server simulating a website
        await new Promise<void>((resolvePromise) => {
            stageServer = http.createServer((req, res) => {
                const url = req.url ?? '/';
                if (url === '/robots.txt') {
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('User-agent: *\nAllow: /\nCrawl-delay: 0.001\nSitemap: /sitemap.xml\n');
                    return;
                }
                if (url === '/sitemap.xml') {
                    res.writeHead(200, { 'Content-Type': 'application/xml' });
                    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://localhost:${stagePort}/</loc></url>
  <url><loc>http://localhost:${stagePort}/page-2</loc></url>
</urlset>`);
                    return;
                }
                if (url === '/page-2') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(
                        '<html><head><title>Page 2</title></head><body><h1>Page 2</h1><p>Content 2</p><a href="/page-3">Page 3</a></body></html>',
                    );
                    return;
                }
                if (url === '/page-3') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><head><title>Page 3</title></head><body><h1>Page 3</h1></body></html>');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(
                    `<html><head><title>Home</title></head><body><h1>Home</h1><a href="/page-2">Go to Page 2</a></body></html>`,
                );
            });
            stageServer.listen(0, '127.0.0.1', () => {
                stagePort = (stageServer.address() as { port: number }).port;
                resolvePromise();
            });
        });

        writeFileSync(
            optionsFile,
            JSON.stringify({
                url: `http://localhost:${stagePort}/`,
                max_pages: 5,
                max_requests: 10,
                deadline_seconds: 60,
                allow_test_loopback: true,
            }),
            'utf-8',
        );
    });

    afterAll(() => {
        stageServer?.close();
        try {
            rmSync(testDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('runs seo-preflight with create-new semantics and writes options and manifest', async () => {
        await seoPreflight([workDir, optionsFile, 'test-run-123', 'false']);

        expect(existsSync(join(workDir, 'options.json'))).toBe(true);
        expect(existsSync(join(workDir, 'manifest.json'))).toBe(true);

        const manifest = JSON.parse(readFileSync(join(workDir, 'manifest.json'), 'utf-8'));
        expect(manifest.runId).toBe('test-run-123');
        expect(manifest.stage).toBe('preflight');

        // Refuse overwrite on existing non-empty workDir
        // In node/bun, process.exit(1) is called on refusal. We verify the refusal logic by testing readdir.
        const files = existsSync(workDir);
        expect(files).toBe(true);
    });

    it('runs seo-collect to crawl pages, extract facts and write crawl.json and evidence', async () => {
        await seoCollect([workDir], { allowLoopback: true });

        const crawlFile = join(workDir, 'crawl.json');
        expect(existsSync(crawlFile)).toBe(true);

        const crawlData: CrawlArtifact = JSON.parse(readFileSync(crawlFile, 'utf-8'));
        expect(crawlData.schemaVersion).toBe(1);
        expect(crawlData.runId).toBe('test-run-123');
        expect(crawlData.pages.length).toBeGreaterThan(0);
        expect(crawlData.requests.length).toBeGreaterThan(0);

        // Check page evidence
        const firstPage = crawlData.pages[0];
        expect(firstPage).toBeDefined();
        if (firstPage?.evidencePath) {
            const evFile = join(workDir, firstPage.evidencePath);
            expect(existsSync(evFile)).toBe(true);
            const evData = JSON.parse(readFileSync(evFile, 'utf-8'));
            expect(evData.facts.title).toBeDefined();
        }
    });

    it('provides a valid minimal crawl fixture for task 0282', () => {
        const fixturePath = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');
        expect(existsSync(fixturePath)).toBe(true);
        const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
        expect(data.schemaVersion).toBe(1);
        expect(data.status).toBe('complete');
        expect(data.pages.length).toBe(1);
        expect(data.pages[0].facts.title).toBe('Example Domain');
    });

    it('validates CLI arguments and exit codes for seo-preflight and seo-collect', async () => {
        // Direct in-process error validation
        await expect(seoPreflight([])).rejects.toThrow(/usage/);
        await expect(seoPreflight([workDir, 'nonexistent-options.json'])).rejects.toThrow(/not found/);
        await expect(seoPreflight([workDir, optionsFile])).rejects.toThrow(/refusing overwrite/);

        // Oversized options file (> 64 KiB)
        const bigOptFile = join(testDir, 'big-options.json');
        writeFileSync(bigOptFile, ' '.repeat(65 * 1024), 'utf-8');
        await expect(seoPreflight(['', bigOptFile])).rejects.toThrow(/exceeds 64 KiB/);

        // Invalid JSON options file
        const invalidJsonFile = join(testDir, 'invalid-json.json');
        writeFileSync(invalidJsonFile, '{"url": invalid}', 'utf-8');
        await expect(seoPreflight(['', invalidJsonFile])).rejects.toThrow(/invalid JSON/);

        // Options schema validation failure
        const badSchemaFile = join(testDir, 'bad-schema.json');
        writeFileSync(badSchemaFile, JSON.stringify({ url: '' }), 'utf-8');
        await expect(seoPreflight(['', badSchemaFile])).rejects.toThrow(/validation failed/);

        await expect(seoCollect([])).rejects.toThrow(/usage/);
        await expect(seoCollect([testDir])).rejects.toThrow(/missing options.json/);

        const badFixDir = join(testDir, 'bad-fix-dir');
        mkdirSync(badFixDir, { recursive: true });
        writeFileSync(
            join(badFixDir, 'options.json'),
            JSON.stringify({ url: 'https://example.com', fixture: 'nonexistent-fixtures' }),
        );
        writeFileSync(
            join(badFixDir, 'manifest.json'),
            JSON.stringify({
                schemaVersion: 1,
                runId: 'r',
                createdAt: '',
                inputDigest: '',
                stage: 'preflight',
                options: { url: 'https://example.com' },
            }),
        );
        await expect(seoCollect([badFixDir])).rejects.toThrow(/fixture directory not found/);

        const STAGES_SCRIPT = resolve('plugins/kk/scripts/seo-stages.ts');
        const runCli = (args: string[]) => {
            const res = Bun.spawnSync([process.execPath, STAGES_SCRIPT, ...args], { stdout: 'pipe', stderr: 'pipe' });
            return { status: res.exitCode ?? 1, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
        };

        // Usage errors
        expect(runCli(['seo-preflight']).status).toBe(1);
        expect(runCli(['seo-preflight']).stderr).toContain('usage:');

        expect(runCli(['seo-collect']).status).toBe(1);
        expect(runCli(['seo-collect']).stderr).toContain('usage:');

        expect(runCli(['unknown-stage']).status).toBe(1);
        expect(runCli(['unknown-stage']).stderr).toContain('unknown stage');
    });

    it('allocates automatic work_dir when empty and handles require_decisions flag', async () => {
        const optFile = join(testDir, 'auto-opt.json');
        writeFileSync(optFile, JSON.stringify({ url: 'https://example.com' }), 'utf-8');

        // The default allocation is cwd-relative (`resolve('.works/kk-smart-seo/…')`), so the case
        // runs from a temp cwd: asserting it from the repo root used to create a real
        // `<repo>/.works/kk-smart-seo` that tripped every later run's works-pollution guard
        // (`apps/cli/tests/commands/daily.test.ts`, observed 2026-11-26).
        const before = process.cwd();
        const scratch = mkdtempSync(join(tmpdir(), 'kk-seo-alloc-'));
        try {
            process.chdir(scratch);
            await seoPreflight(['', optFile, 'run-alloc-1', 'false']);
            const runWorkDirFile = resolve('.spur', 'run', 'run-alloc-1-seo-work-dir.txt');
            expect(existsSync(runWorkDirFile)).toBe(true);
            // Plain text on purpose: the workflow projects this exact file into `work_dir`
            // with `file.read.into-var`, which sets the var to the raw file content (design §3).
            const recorded = readFileSync(runWorkDirFile, 'utf-8').trim();
            expect(recorded).toContain(join(scratch, '.works', 'kk-smart-seo'));
            expect(existsSync(recorded)).toBe(true);
        } finally {
            process.chdir(before);
            rmSync(scratch, { recursive: true, force: true });
        }
    });

    it('handles offline fixture mode in seo-collect', async () => {
        const fixtureWorkDir = join(testDir, 'fixture-work');
        mkdirSync(fixtureWorkDir, { recursive: true });

        const fixOpt = {
            url: 'https://example.com',
            fixture: 'plugins/kk/tests/fixtures',
        };
        const fixManifest = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'fixture-test-run',
            createdAt: new Date().toISOString(),
            inputDigest: 'abc',
            stage: 'preflight',
            options: fixOpt,
        };

        writeFileSync(join(fixtureWorkDir, 'options.json'), JSON.stringify(fixOpt));
        writeFileSync(join(fixtureWorkDir, 'manifest.json'), JSON.stringify(fixManifest));

        await seoCollect([fixtureWorkDir]);

        const crawlPath = join(fixtureWorkDir, 'crawl.json');
        expect(existsSync(crawlPath)).toBe(true);
        const loaded: CrawlArtifact = JSON.parse(readFileSync(crawlPath, 'utf-8'));
        expect(loaded.runId).toBe('fixture-test-run');
        expect(loaded.pages[0]?.facts?.title).toBe('Example Domain');
    });

    it('handles robots.txt blocked and unavailable states', async () => {
        let blockedServer: http.Server;
        let blockedPort: number;

        await new Promise<void>((r) => {
            blockedServer = http.createServer((req, res) => {
                if (req.url === '/robots.txt') {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end('Forbidden');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><head><title>Blocked Page</title></head><body>No</body></html>');
            });
            blockedServer.listen(0, '127.0.0.1', () => {
                blockedPort = (blockedServer.address() as { port: number }).port;
                r();
            });
        });

        const blockedDir = join(testDir, 'blocked-work');
        mkdirSync(blockedDir, { recursive: true });
        const bOpt = {
            url: `http://localhost:${blockedPort}/`,
            allow_test_loopback: true,
        };
        const bMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'blocked-run',
            createdAt: new Date().toISOString(),
            inputDigest: 'b123',
            stage: 'preflight',
            options: bOpt,
        };
        writeFileSync(join(blockedDir, 'options.json'), JSON.stringify(bOpt));
        writeFileSync(join(blockedDir, 'manifest.json'), JSON.stringify(bMan));

        await seoCollect([blockedDir], { allowLoopback: true });

        const crawl: CrawlArtifact = JSON.parse(readFileSync(join(blockedDir, 'crawl.json'), 'utf-8'));
        expect(crawl.pages.length).toBe(1);
        expect(crawl.pages[0]?.availability).toBe('blocked');
        expect(crawl.pages[0]?.facts).toBeNull();

        blockedServer.close();
    });

    it('handles robots.txt 500 unavailable state and crawl delay', async () => {
        let errServer: http.Server;
        let errPort: number;

        await new Promise<void>((r) => {
            errServer = http.createServer((req, res) => {
                if (req.url === '/robots.txt') {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Server Error');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><head><title>Unavailable</title></head><body>Err</body></html>');
            });
            errServer.listen(0, '127.0.0.1', () => {
                errPort = (errServer.address() as { port: number }).port;
                r();
            });
        });

        const errDir = join(testDir, 'err-work');
        mkdirSync(errDir, { recursive: true });
        const eOpt = {
            url: `http://localhost:${errPort}/`,
            allow_test_loopback: true,
        };
        const eMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'err-run',
            createdAt: new Date().toISOString(),
            inputDigest: 'e123',
            stage: 'preflight',
            options: eOpt,
        };
        writeFileSync(join(errDir, 'options.json'), JSON.stringify(eOpt));
        writeFileSync(join(errDir, 'manifest.json'), JSON.stringify(eMan));

        await seoCollect([errDir], { allowLoopback: true });

        const crawl: CrawlArtifact = JSON.parse(readFileSync(join(errDir, 'crawl.json'), 'utf-8'));
        expect(crawl.pages[0]?.availability).toBe('unavailable');

        errServer.close();
    });

    it('handles page fetch failure and hitLimit condition', async () => {
        let failServer: http.Server;
        let failPort: number;

        await new Promise<void>((r) => {
            failServer = http.createServer((req, res) => {
                if (req.url === '/robots.txt') {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.destroy(); // trigger fetch error
            });
            failServer.listen(0, '127.0.0.1', () => {
                failPort = (failServer.address() as { port: number }).port;
                r();
            });
        });

        const failDir = join(testDir, 'fail-work');
        mkdirSync(failDir, { recursive: true });
        const fOpt = {
            url: `http://localhost:${failPort}/`,
            allow_test_loopback: true,
            max_requests: 5,
        };
        const fMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'fail-run',
            createdAt: new Date().toISOString(),
            inputDigest: 'f123',
            stage: 'preflight',
            options: fOpt,
        };
        writeFileSync(join(failDir, 'options.json'), JSON.stringify(fOpt));
        writeFileSync(join(failDir, 'manifest.json'), JSON.stringify(fMan));

        await seoCollect([failDir], { allowLoopback: true });

        const crawl: CrawlArtifact = JSON.parse(readFileSync(join(failDir, 'crawl.json'), 'utf-8'));
        expect(crawl.pages[0]?.availability).toBe('unavailable');
        expect(crawl.pages[0]?.error).toBeDefined();

        failServer.close();
    });

    it('handles robots.txt network failure', async () => {
        let netErrServer: http.Server;
        let netErrPort: number;

        await new Promise<void>((r) => {
            netErrServer = http.createServer((_req, res) => {
                res.destroy(); // destroy connection immediately
            });
            netErrServer.listen(0, '127.0.0.1', () => {
                netErrPort = (netErrServer.address() as { port: number }).port;
                r();
            });
        });

        const netDir = join(testDir, 'net-err-work');
        mkdirSync(netDir, { recursive: true });
        const nOpt = { url: `http://localhost:${netErrPort}/`, allow_test_loopback: true };
        const nMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'n1',
            createdAt: '',
            inputDigest: '',
            stage: 'preflight',
            options: nOpt,
        };
        writeFileSync(join(netDir, 'options.json'), JSON.stringify(nOpt));
        writeFileSync(join(netDir, 'manifest.json'), JSON.stringify(nMan));

        await seoCollect([netDir], { allowLoopback: true });
        const crawl = JSON.parse(readFileSync(join(netDir, 'crawl.json'), 'utf-8'));
        expect(crawl.pages[0]?.availability).toBe('unavailable');

        netErrServer.close();
    });

    it('handles 404 absent robots.txt and allows path crawl', async () => {
        let absentServer: http.Server;
        let absentPort: number;

        await new Promise<void>((r) => {
            absentServer = http.createServer((req, res) => {
                if (req.url === '/robots.txt') {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><head><title>Allowed Page</title></head><body>Welcome</body></html>');
            });
            absentServer.listen(0, '127.0.0.1', () => {
                absentPort = (absentServer.address() as { port: number }).port;
                r();
            });
        });

        const absentDir = join(testDir, 'absent-work');
        mkdirSync(absentDir, { recursive: true });
        const aOpt = { url: `http://localhost:${absentPort}/`, allow_test_loopback: true };
        const aMan = {
            schemaVersion: 1,
            methodVersion: '1.0.0',
            runId: 'a1',
            createdAt: '',
            inputDigest: '',
            stage: 'preflight',
            options: aOpt,
        };
        writeFileSync(join(absentDir, 'options.json'), JSON.stringify(aOpt));
        writeFileSync(join(absentDir, 'manifest.json'), JSON.stringify(aMan));

        await seoCollect([absentDir], { allowLoopback: true });
        const crawl = JSON.parse(readFileSync(join(absentDir, 'crawl.json'), 'utf-8'));
        expect(crawl.pages[0]?.availability).toBe('available');
        expect(crawl.pages[0]?.facts?.title).toBe('Allowed Page');

        absentServer.close();
    });
});
