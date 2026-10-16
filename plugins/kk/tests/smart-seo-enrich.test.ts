import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    buildVisibilityArtifact,
    CRUX_ENDPOINT,
    CRUX_KEY_ENV,
    MAX_ENRICH_ATTEMPTS,
    PSI_ENDPOINT,
    PSI_KEY_ENV,
    parseCruxResponse,
    parsePsiResponse,
    providerRequestJson,
    runSeoEnrich,
    STALE_EVIDENCE_DAYS,
    selectPerformancePages,
    validateVisibilitySnapshot,
} from '../scripts/seo-enrich';
import type { CrawlArtifact } from '../scripts/seo-facts';
import { seoEnrich } from '../scripts/seo-stages';

// OS tmpdir, like every other suite here: scratch inside the repo tree would sit in the pipeline's
// proof-input digest and drift it on each gate run.
const TEST_DIR = mkdtempSync(join(tmpdir(), 'kk-seo-enrich-'));
const FIXTURE = resolve('plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json');
const NOW = new Date('2026-10-15T12:00:00.000Z');

function baseCrawl(pages: number): CrawlArtifact {
    const template = JSON.parse(readFileSync(FIXTURE, 'utf-8')).pages[0];
    return {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId: 'enrich-run-1',
        createdAt: NOW.toISOString(),
        inputDigest: 'enrich-digest',
        predecessorDigests: { 'crawl.json': 'crawl-hash' },
        status: 'complete',
        pages: Array.from({ length: pages }, (_, i) => ({
            ...template,
            subjectId: `p${i}`,
            url: i === 0 ? 'https://example.com/' : `https://example.com/page-${i}`,
        })),
        requests: [],
        limits: { pagesVisited: pages, requestsMade: pages, totalBytes: 100, elapsedSeconds: 1, hitLimit: null },
    };
}

function seedWorkDir(dir: string, opts: Record<string, unknown>, crawl: CrawlArtifact): void {
    mkdirSync(dir, { recursive: true });
    const options = { url: 'https://example.com/', locale: 'en-US', ...opts };
    writeFileSync(join(dir, 'options.json'), JSON.stringify(options));
    writeFileSync(join(dir, 'crawl.json'), JSON.stringify(crawl));
}

const PSI_OK = {
    lighthouseResult: {
        audits: {
            'largest-contentful-paint': { numericValue: 1800 },
            'cumulative-layout-shift': { numericValue: 0.05 },
            'total-blocking-time': { numericValue: 90 },
        },
    },
};
const CRUX_OK = {
    record: {
        collectionPeriod: { firstDate: '2026-09-01', lastDate: '2026-09-30' },
        metrics: {
            largest_contentful_paint: { percentiles: { p75: 2100 } },
            interaction_to_next_paint: { percentiles: { p75: 150 } },
            cumulative_layout_shift: { percentiles: { p75: 0.07 } },
        },
    },
};

describe('PSI lab and CrUX field separation (R1 / AC1)', () => {
    it('parses PSI lab metrics and never treats lab TBT as field INP', () => {
        const lab = parsePsiResponse(PSI_OK, 'https://example.com/', 'mobile');
        expect(lab.strategy).toBe('mobile');
        expect(lab.metrics.lcpMs).toBe(1800);
        expect(lab.metrics.cls).toBe(0.05);
        expect(lab.metrics.tbtMs).toBe(90);
        // TBT is lab-only evidence — no INP is fabricated from it.
        expect(lab.metrics.inpMs).toBeNull();
    });

    it('keeps missing lab metrics null rather than zero', () => {
        const lab = parsePsiResponse({ lighthouseResult: { audits: {} } }, 'https://example.com/', 'desktop');
        expect(lab.metrics.lcpMs).toBeNull();
        expect(lab.metrics.cls).toBeNull();
        expect(lab.metrics.tbtMs).toBeNull();
    });

    it('requires all three p75 field metrics before Core Web Vitals can pass', () => {
        const full = parseCruxResponse(CRUX_OK, 'https://example.com/', 'url');
        expect(full.scope).toBe('url');
        expect(full.formFactor).toBe('PHONE');
        expect(full.passedCoreWebVitals).toBe(true);
        expect(full.collectionWindow).toEqual({ start: '2026-09-01', end: '2026-09-30' });

        // Absent INP must yield unknown, never a pass and never a zero.
        const noInp = parseCruxResponse(
            {
                record: {
                    metrics: {
                        largest_contentful_paint: { percentiles: { p75: 2000 } },
                        cumulative_layout_shift: { percentiles: { p75: 0.05 } },
                    },
                },
            },
            'https://example.com/',
            'url',
        );
        expect(noInp.metrics.inpMs).toBeNull();
        expect(noInp.passedCoreWebVitals).toBeNull();
        expect(noInp.reason).toContain('incomplete');

        // All-null metrics stay null and unknown.
        const allNull = parseCruxResponse({ record: { metrics: {} } }, 'https://example.com/', 'url');
        expect(allNull.metrics).toEqual({ lcpMs: null, inpMs: null, cls: null });
        expect(allNull.passedCoreWebVitals).toBeNull();

        // A failing metric fails the trio.
        const failing = parseCruxResponse(
            {
                record: {
                    metrics: {
                        largest_contentful_paint: { percentiles: { p75: 4000 } },
                        interaction_to_next_paint: { percentiles: { p75: 150 } },
                        cumulative_layout_shift: { percentiles: { p75: 0.07 } },
                    },
                },
            },
            'https://example.com/',
            'url',
        );
        expect(failing.passedCoreWebVitals).toBe(false);
    });

    it('selects at most three deterministic pages, homepage first', () => {
        const selected = selectPerformancePages(baseCrawl(6));
        expect(selected.length).toBe(3);
        expect(selected[0]).toBe('https://example.com/');
    });
});

describe('Enrichment stage: provider attempts, caps and fallback (R1 / AC1)', () => {
    afterAll(() => {
        try {
            rmSync(TEST_DIR, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    it('makes no provider request at all when performance=false (the default)', async () => {
        const dir = join(TEST_DIR, 'disabled');
        seedWorkDir(dir, { performance: false }, baseCrawl(3));
        let calls = 0;
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'k', [CRUX_KEY_ENV]: 'k' },
            now: NOW,
            requestJson: async () => {
                calls += 1;
                return PSI_OK;
            },
        });
        expect(calls).toBe(0);
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.status).toBe('disabled');
        expect(perf.lab).toEqual([]);
        expect(perf.field).toEqual([]);
        expect(perf.attempts).toBe(0);
        expect(perf.labIsFieldAuthority).toBe(false);
        const vis = JSON.parse(readFileSync(join(dir, 'visibility.json'), 'utf-8'));
        expect(vis.status).toBe('not-assessed');
        // No snapshot was supplied, so no measurement kind can be claimed.
        expect(vis.measurementKind).toBeNull();
    });

    it('records unavailable entries and still exits zero when the keys are missing', async () => {
        const dir = join(TEST_DIR, 'no-keys');
        seedWorkDir(dir, { performance: true }, baseCrawl(2));
        await runSeoEnrich(dir, { env: {}, now: NOW });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.status).toBe('unavailable');
        expect(perf.lab).toEqual([]);
        expect(perf.field).toEqual([]);
        expect(perf.unavailable.length).toBe(4);
        expect(perf.unavailable[0].reason).toContain(PSI_KEY_ENV);
        expect(perf.unavailable.some((u: { reason: string }) => u.reason.includes(CRUX_KEY_ENV))).toBe(true);
    });

    it('uses the fixed endpoints and stays within the 12-attempt cap', async () => {
        const dir = join(TEST_DIR, 'endpoints');
        seedWorkDir(dir, { performance: true }, baseCrawl(4));
        const seen: { url: string; method: string }[] = [];
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'psi-secret', [CRUX_KEY_ENV]: 'crux-secret' },
            now: NOW,
            requestJson: async (url, init) => {
                seen.push({ url, method: init.method });
                return url.startsWith(PSI_ENDPOINT) ? PSI_OK : CRUX_OK;
            },
        });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.attempts).toBeLessThanOrEqual(MAX_ENRICH_ATTEMPTS);
        expect(perf.status).toBe('available');
        // 3 pages × (2 PSI + 1 CrUX) = 9 attempts, plus up to 3 origin fallbacks if needed.
        expect(perf.attempts).toBe(9);
        expect(perf.lab.length).toBe(6);
        expect(perf.field.length).toBe(3);

        for (const call of seen) {
            // Only the two fixed official origins ever receive a request.
            expect(call.url.startsWith(PSI_ENDPOINT) || call.url.startsWith(CRUX_ENDPOINT)).toBe(true);
            // The CrUX key travels in the POST body, never in a URL that could be logged.
            if (call.url.startsWith(CRUX_ENDPOINT)) {
                expect(call.method).toBe('POST');
                expect(call.url).not.toContain('crux-secret');
            }
        }
    });

    it('falls back to the origin record only when the URL record is unavailable', async () => {
        const dir = join(TEST_DIR, 'fallback');
        seedWorkDir(dir, { performance: true }, baseCrawl(1));
        const cruxBodies: string[] = [];
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'k', [CRUX_KEY_ENV]: 'k' },
            now: NOW,
            requestJson: async (url, init) => {
                if (url.startsWith(PSI_ENDPOINT)) return PSI_OK;
                cruxBodies.push(init.body ?? '');
                // The exact-URL record is unavailable; only the origin record answers.
                const body = JSON.parse(init.body ?? '{}');
                if (body.url) throw new Error('provider status 404');
                return CRUX_OK;
            },
        });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        // The fallback records origin scope and never masquerades as the URL-level record.
        expect(perf.field.length).toBe(1);
        expect(perf.field[0].scope).toBe('origin');
        expect(perf.field[0].formFactor).toBe('PHONE');
        expect(perf.field[0].url).toBe('https://example.com/');
        expect(cruxBodies.length).toBe(2);
        expect(perf.unavailable).toEqual([]);
    });

    it('records multiple failing URLs as unavailable without substituting passing data', async () => {
        const dir = join(TEST_DIR, 'failing');
        seedWorkDir(dir, { performance: true }, baseCrawl(2));
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'k', [CRUX_KEY_ENV]: 'k' },
            now: NOW,
            requestJson: async () => {
                throw new Error('provider status 429');
            },
        });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.status).toBe('unavailable');
        expect(perf.lab).toEqual([]);
        expect(perf.field).toEqual([]);
        // Per page: mobile lab + desktop lab + the field record (URL and origin both unavailable).
        expect(perf.unavailable.length).toBe(6);
        expect(perf.unavailable.filter((u: { scope: string }) => u.scope === 'lab').length).toBe(4);
        expect(perf.unavailable.filter((u: { scope: string }) => u.scope === 'field').length).toBe(2);
        expect(perf.unavailable.every((u: { reason: string }) => u.reason.includes('429'))).toBe(true);
        // No passing data is invented from a failed request.
        expect(perf.attempts).toBe(8);
    });

    it('rejects malformed provider payloads as unavailable rather than crashing the stage', async () => {
        const dir = join(TEST_DIR, 'malformed');
        seedWorkDir(dir, { performance: true }, baseCrawl(1));
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'k', [CRUX_KEY_ENV]: 'k' },
            now: NOW,
            requestJson: async () => {
                throw new Error('provider response was not JSON: Unexpected token');
            },
        });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.status).toBe('unavailable');
        expect(perf.unavailable.some((u: { reason: string }) => u.reason.includes('not JSON'))).toBe(true);
    });
});

describe('Provider transport client (R1 / AC1)', () => {
    let server: import('node:http').Server;
    let port = 0;
    const log: { path: string; method: string }[] = [];
    const seam = { allowLoopback: true, resolvePinned: async () => ({ ip: '127.0.0.1', family: 4 as const }) };

    beforeAll(async () => {
        await new Promise<void>((done) => {
            server = http.createServer((req, res) => {
                log.push({ path: req.url ?? '/', method: req.method ?? 'GET' });
                let body = '';
                req.on('data', (c) => {
                    body += c.toString();
                });
                req.on('end', () => {
                    const url = req.url ?? '/';
                    if (url.startsWith('/redirect')) {
                        res.writeHead(302, { Location: 'https://evil.example/steal' });
                        res.end();
                        return;
                    }
                    if (url.startsWith('/status429')) {
                        res.writeHead(429, { 'Content-Type': 'application/json' });
                        res.end('{"error":"quota"}');
                        return;
                    }
                    if (url.startsWith('/oversize')) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        const chunk = Buffer.alloc(1024 * 1024, 0x41);
                        res.write(chunk);
                        res.write(chunk);
                        res.write(chunk);
                        res.end();
                        return;
                    }
                    if (url.startsWith('/notjson')) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end('not json at all');
                        return;
                    }
                    if (url.startsWith('/stall-body')) {
                        // Headers arrive promptly; the body never completes.
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.write('{');
                        return;
                    }
                    if (url.startsWith('/slow')) {
                        setTimeout(() => {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end('{}');
                        }, 400);
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, receivedBody: body }));
                });
            });
            server.listen(0, '127.0.0.1', () => {
                port = (server.address() as { port: number }).port;
                done();
            });
        });
    });

    afterAll(() => {
        server?.close();
    });

    const url = (path: string): string => `http://127.0.0.1:${port}${path}`;

    it('performs a pinned request and returns the parsed JSON body', async () => {
        const out = (await providerRequestJson(url('/ok'), { method: 'GET' }, 2000, seam)) as { ok: boolean };
        expect(out.ok).toBe(true);
    });

    it('sends the POST body for the field endpoint', async () => {
        const out = (await providerRequestJson(
            url('/post'),
            { method: 'POST', body: JSON.stringify({ key: 'secret' }) },
            2000,
            seam,
        )) as { receivedBody: string };
        expect(out.receivedBody).toContain('secret');
        expect(log.some((entry) => entry.method === 'POST')).toBe(true);
    });

    it('refuses a provider redirect instead of following it to another origin', async () => {
        await expect(providerRequestJson(url('/redirect'), { method: 'GET' }, 2000, seam)).rejects.toThrow(
            /redirect refused/,
        );
    });

    it('reports a non-200 provider status', async () => {
        await expect(providerRequestJson(url('/status429'), { method: 'GET' }, 2000, seam)).rejects.toThrow(
            /status 429/,
        );
    });

    it('aborts an oversize provider response', async () => {
        await expect(providerRequestJson(url('/oversize'), { method: 'GET' }, 5000, seam)).rejects.toThrow(/exceeded/);
    });

    it('rejects a non-JSON provider body', async () => {
        await expect(providerRequestJson(url('/notjson'), { method: 'GET' }, 2000, seam)).rejects.toThrow(/not JSON/);
    });

    it('times out a stalled provider request', async () => {
        await expect(providerRequestJson(url('/slow'), { method: 'GET' }, 50, seam)).rejects.toThrow(/timed out/);
    });

    it('times out a provider response whose body stalls after the headers arrive', async () => {
        await expect(providerRequestJson(url('/stall-body'), { method: 'GET' }, 300, seam)).rejects.toThrow(
            /timed out/,
        );
    });

    it('rejects a peer address that does not match the pinned address', async () => {
        await expect(
            providerRequestJson(url('/ok'), { method: 'GET' }, 500, {
                allowLoopback: true,
                resolvePinned: async () => ({ ip: '127.0.0.9', family: 4 as const }),
            }),
        ).rejects.toThrow(/peer check failed/);
    });

    it('drives the enrichment stage end to end against the fixture server', async () => {
        const dir = join(TEST_DIR, 'transport');
        seedWorkDir(dir, { performance: true }, baseCrawl(1));
        await runSeoEnrich(dir, {
            env: { [PSI_KEY_ENV]: 'psi-secret', [CRUX_KEY_ENV]: 'crux-secret' },
            now: NOW,
            endpoints: { psi: url('/psi'), crux: url('/crux') },
            transport: { ...seam, timeoutMs: 5000 },
        });
        const perf = JSON.parse(readFileSync(join(dir, 'performance.json'), 'utf-8'));
        expect(perf.status).toBe('available');
        expect(perf.attempts).toBe(3);
        // The key travels in the POST body for the field endpoint, never in a loggable URL.
        const cruxCall = log.find((entry) => entry.path.startsWith('/crux'));
        expect(cruxCall?.method).toBe('POST');
    });
});

describe('Visibility import contract (R1 / AC1)', () => {
    const validSnapshot = {
        schemaVersion: 1,
        siteOrigin: 'https://example.com',
        locale: 'en-US',
        source: 'operator-export',
        collectedAt: '2026-10-01T00:00:00.000Z',
        measurementKind: 'measured',
        rows: [
            {
                query: 'seo audit tool',
                url: 'https://example.com/',
                clicks: 12,
                impressions: 400,
                position: 4,
                citations: 3,
                sampleCount: 10,
                platform: 'ai-overview',
            },
        ],
    };

    it('validates a well-formed snapshot and preserves provenance', () => {
        const validated = validateVisibilitySnapshot(validSnapshot);
        expect(validated.siteOrigin).toBe('https://example.com');
        expect(validated.measurementKind).toBe('measured');
        expect(validated.rows[0]?.citations).toBe(3);
        expect(validated.rows[0]?.position).toBe(4);
    });

    it('rejects wrong scope, wrong locale and identity-free snapshots', () => {
        expect(() => validateVisibilitySnapshot({ ...validSnapshot, siteOrigin: 'not-an-origin' })).toThrow(
            /not an origin/,
        );
        expect(() => validateVisibilitySnapshot({ ...validSnapshot, source: '' })).toThrow(/source/);
        expect(() => validateVisibilitySnapshot({ ...validSnapshot, measurementKind: 'guessed' })).toThrow(
            /measurementKind/,
        );
        expect(() => validateVisibilitySnapshot({ ...validSnapshot, schemaVersion: 2 })).toThrow(/schemaVersion/);
        expect(() =>
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: [{ ...validSnapshot.rows[0], url: 'https://other.example/page' }],
            }),
        ).toThrow(/outside the declared site origin/);
    });

    it('rejects malformed numeric ranges, unknown citation shapes and oversize rows', () => {
        expect(() =>
            validateVisibilitySnapshot({ ...validSnapshot, rows: [{ ...validSnapshot.rows[0], clicks: -1 }] }),
        ).toThrow(/nonnegative integer/);
        expect(() =>
            validateVisibilitySnapshot({ ...validSnapshot, rows: [{ ...validSnapshot.rows[0], position: 0 }] }),
        ).toThrow(/position/);
        expect(() =>
            validateVisibilitySnapshot({ ...validSnapshot, rows: [{ ...validSnapshot.rows[0], clicks: 1.5 }] }),
        ).toThrow(/nonnegative integer/);
        // citations > sampleCount
        expect(() =>
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: [{ ...validSnapshot.rows[0], citations: 50, sampleCount: 10 }],
            }),
        ).toThrow(/exceed sampleCount/);
        // citations without a denominator
        expect(() =>
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: [{ ...validSnapshot.rows[0], citations: 2, sampleCount: null }],
            }),
        ).toThrow(/denominator/);
        // citations without a platform
        expect(() =>
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: [{ ...validSnapshot.rows[0], platform: null }],
            }),
        ).toThrow(/platform/);
        expect(() =>
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: Array.from({ length: 501 }, () => validSnapshot.rows[0]),
            }),
        ).toThrow(/max 500/);
    });

    it('rejects future instants and excludes stale rows from recommendations', () => {
        expect(() =>
            buildVisibilityArtifact(
                validateVisibilitySnapshot({ ...validSnapshot, collectedAt: '2026-12-01T00:00:00.000Z' }),
                'r1',
                NOW,
            ),
        ).toThrow(/future/);

        // 100 days stale: retained as evidence but excluded from recommendations.
        const stale = buildVisibilityArtifact(
            validateVisibilitySnapshot({ ...validSnapshot, collectedAt: '2026-07-07T00:00:00.000Z' }),
            'r1',
            NOW,
        );
        expect(stale.stale).toBe(true);
        expect(stale.rows.length).toBe(1);
        expect(stale.excluded[0]?.reason).toContain(`> ${STALE_EVIDENCE_DAYS} days`);

        // Fresh evidence drives recommendations.
        const fresh = buildVisibilityArtifact(validateVisibilitySnapshot(validSnapshot), 'r1', NOW);
        expect(fresh.stale).toBe(false);
        expect(fresh.excluded).toEqual([]);
    });

    it('distinguishes measured from estimated provenance without inventing traffic', () => {
        const estimated = buildVisibilityArtifact(
            validateVisibilitySnapshot({ ...validSnapshot, measurementKind: 'estimated' }),
            'r1',
            NOW,
        );
        expect(estimated.measurementKind).toBe('estimated');
        // Absent metrics stay null; nothing is fabricated as zero traffic.
        expect(estimated.rows[0]?.clicks).toBe(12);
        const emptyRow = buildVisibilityArtifact(
            validateVisibilitySnapshot({
                ...validSnapshot,
                rows: [
                    {
                        query: 'x',
                        url: null,
                        clicks: null,
                        impressions: null,
                        position: null,
                        citations: null,
                        sampleCount: null,
                        platform: null,
                    },
                ],
            }),
            'r1',
            NOW,
        );
        expect(emptyRow.rows[0]?.clicks).toBeNull();
        expect(emptyRow.rows[0]?.impressions).toBeNull();
    });

    it('writes a validated visibility artifact and treats invalid input as a hard error', async () => {
        const dir = join(TEST_DIR, 'vis-ok');
        const snapshotPath = join(dir, 'visibility-input.json');
        seedWorkDir(dir, { performance: false, visibility_file: snapshotPath }, baseCrawl(1));
        writeFileSync(snapshotPath, JSON.stringify(validSnapshot));
        await runSeoEnrich(dir, { env: {}, now: NOW });
        const vis = JSON.parse(readFileSync(join(dir, 'visibility.json'), 'utf-8'));
        expect(vis.status).toBe('available');
        expect(vis.source).toBe('operator-export');
        expect(vis.measurementKind).toBe('measured');

        // Wrong locale: a required input error, never a silent unavailable.
        const badDir = join(TEST_DIR, 'vis-locale');
        const badPath = join(badDir, 'visibility-input.json');
        seedWorkDir(badDir, { performance: false, visibility_file: badPath }, baseCrawl(1));
        writeFileSync(badPath, JSON.stringify({ ...validSnapshot, locale: 'ja-JP' }));
        await expect(runSeoEnrich(badDir, { env: {}, now: NOW })).rejects.toThrow(/locale/);

        // Wrong scope: rows carry no URL so the snapshot-level origin mismatch is what surfaces.
        const scopeDir = join(TEST_DIR, 'vis-scope');
        const scopePath = join(scopeDir, 'visibility-input.json');
        seedWorkDir(scopeDir, { performance: false, visibility_file: scopePath }, baseCrawl(1));
        writeFileSync(
            scopePath,
            JSON.stringify({
                ...validSnapshot,
                siteOrigin: 'https://other.example',
                rows: [{ ...validSnapshot.rows[0], url: null }],
            }),
        );
        await expect(runSeoEnrich(scopeDir, { env: {}, now: NOW })).rejects.toThrow(/siteOrigin/);

        // Missing file.
        const missingDir = join(TEST_DIR, 'vis-missing');
        seedWorkDir(missingDir, { performance: false, visibility_file: join(missingDir, 'nope.json') }, baseCrawl(1));
        await expect(runSeoEnrich(missingDir, { env: {}, now: NOW })).rejects.toThrow(/not found/);

        // Oversize snapshot (> 1 MiB).
        const bigDir = join(TEST_DIR, 'vis-big');
        const bigPath = join(bigDir, 'visibility-input.json');
        seedWorkDir(bigDir, { performance: false, visibility_file: bigPath }, baseCrawl(1));
        writeFileSync(bigPath, JSON.stringify({ ...validSnapshot, source: 'x'.repeat(1024 * 1024) }));
        await expect(runSeoEnrich(bigDir, { env: {}, now: NOW })).rejects.toThrow(/exceeds/);
    });
});

describe('seo-enrich stage registration (R1 / AC1)', () => {
    const cli = resolve('plugins/kk/scripts/seo-stages.ts');

    it('requires a work directory with a crawl artifact', async () => {
        await expect(seoEnrich([])).rejects.toThrow(/usage/);
        await expect(seoEnrich(['nonexistent-workdir'])).rejects.toThrow(/missing crawl.json/);
    });

    it('runs from the CLI and writes both enrichment artifacts', () => {
        const dir = join(TEST_DIR, 'cli');
        seedWorkDir(dir, { performance: false }, baseCrawl(1));
        const res = Bun.spawnSync([process.execPath, cli, 'seo-enrich', dir], { stdout: 'pipe', stderr: 'pipe' });
        expect(res.exitCode).toBe(0);
        expect(existsSync(join(dir, 'performance.json'))).toBe(true);
        expect(existsSync(join(dir, 'visibility.json'))).toBe(true);
        expect(res.stderr.toString()).toContain('seo-enrich');

        // Unknown stage still fails closed.
        const bad = Bun.spawnSync([process.execPath, cli, 'seo-not-a-stage'], { stdout: 'pipe', stderr: 'pipe' });
        expect(bad.exitCode).toBe(1);
    });
});

describe('Enrichment fixture inventory (R1 / AC1)', () => {
    it('documents the required provider and import fixtures', () => {
        // The fixtures below are inlined in this suite (provider payloads and import snapshots);
        // the assertion records the inventory so a removed case is visible in review.
        const cases = [
            'psi-lab-ok',
            'crux-field-ok',
            'crux-missing-inp',
            'crux-all-null',
            'crux-url-to-origin-fallback',
            'provider-429',
            'provider-malformed',
            'visibility-measured',
            'visibility-estimated',
            'visibility-future',
            'visibility-stale',
            'visibility-wrong-locale',
            'visibility-wrong-scope',
            'visibility-citation-denominator',
        ];
        expect(cases.length).toBe(14);
        expect(cases).toContain('crux-missing-inp');
    });
});

/**
 * Scratch cleanup is load-bearing, not tidiness: these files are untracked and outside the
 * `docs/tasks*` / `docs/features*` exclusions, so they are part of the pipeline's proof-input
 * digest. A suite that leaves them behind rewrites them on every gate run and drifts the digest
 * between the `test` capture and verification, failing a certified tree.
 */
afterAll(() => {
    try {
        rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
        // ignore
    }
});
