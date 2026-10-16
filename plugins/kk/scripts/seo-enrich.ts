import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { resolve } from 'node:path';
import type { CrawlArtifact, SeoOptions } from './seo-facts';
import {
    assertSeoNotCancelled,
    isPublicAddress,
    onSeoCancel,
    resolveAndPinDns,
    SeoStageCancelledError,
    seoCancelledSignal,
    writeJsonAtomic,
} from './seo-fetch';

/** Fixed PSI lab endpoint (design §8/§13). No other origin may receive the PSI key. */
export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
/** Fixed CrUX field endpoint. No other origin may receive the CrUX key. */
export const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

export const PSI_KEY_ENV = 'PAGESPEED_API_KEY';
export const CRUX_KEY_ENV = 'CRUX_API_KEY';

/** Provider response ceiling per response (design §13). */
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
/** Stage budget shared by every provider attempt (§8: 300 s enrichment deadline). */
export const ENRICH_DEADLINE_MS = 300 * 1000;
/** §13 attempt cap: 3 pages × (2 PSI strategies + CrUX URL + ≤1 origin fallback). */
export const MAX_ENRICH_ATTEMPTS = 12;
/** §8: at most 3 deterministically selected pages request measured evidence. */
export const MAX_PERFORMANCE_PAGES = 3;
/** §8: field evidence older than 90 days is excluded from recommendations. */
export const STALE_EVIDENCE_DAYS = 90;
/** Visibility snapshots: §8 caps. */
const MAX_VISIBILITY_BYTES = 1024 * 1024;
const MAX_VISIBILITY_ROWS = 500;
const MAX_VISIBILITY_STRING = 2048;

export type Availability = 'disabled' | 'not-assessed' | 'available' | 'unavailable';

export interface LabMetricSet {
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    inpMs: number | null;
    fetchTimeMs: number | null;
}

export interface LabEntry {
    url: string;
    strategy: 'mobile' | 'desktop';
    metrics: LabMetricSet;
}

export interface FieldMetricSet {
    lcpMs: number | null;
    inpMs: number | null;
    cls: number | null;
}

export interface FieldEntry {
    url: string;
    /** `url` when the record matched the exact page, `origin` when only the origin record existed. */
    scope: 'url' | 'origin';
    formFactor: 'PHONE';
    collectionWindow: { start: string | null; end: string | null } | null;
    metrics: FieldMetricSet;
    /** All three p75 CWV thresholds met; null when any metric is missing. */
    passedCoreWebVitals: boolean | null;
    reason: string;
}

export interface PerformanceArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: Availability;
    lab: LabEntry[];
    field: FieldEntry[];
    attempts: number;
    /**
     * §13 lab/field separation: lab TBT can never satisfy an INP field requirement, so the two
     * metric sets are reported in distinct collections and never merged.
     */
    labIsFieldAuthority: false;
    unavailable: { url: string; scope: 'lab' | 'field'; reason: string }[];
}

export interface VisibilityRow {
    query: string;
    url: string | null;
    clicks: number | null;
    impressions: number | null;
    position: number | null;
    citations: number | null;
    sampleCount: number | null;
    platform: string | null;
}

export interface VisibilityArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: Availability;
    source: string;
    siteOrigin: string;
    locale: string;
    collectedAt: string;
    measurementKind: 'measured' | 'estimated';
    /** Retained as evidence but never used to drive recommendations. */
    stale: boolean;
    rows: VisibilityRow[];
    /** Rows excluded from recommendations, with the reason. */
    excluded: { query: string; reason: string }[];
}

/** Injection seams so tests never touch the network or the operator's real keys. */
export interface EnrichDeps {
    env?: Record<string, string | undefined>;
    now?: Date;
    requestJson?: (url: string, init: { method: 'GET' | 'POST'; body?: string }) => Promise<unknown>;
    /** Test-only endpoint override; the shipped defaults are the two fixed https origins. */
    endpoints?: { psi?: string; crux?: string };
    /**
     * Test-only transport seam. Production always resolves real DNS and rejects non-public
     * addresses; a test injects a loopback resolver to exercise the client against a fixture
     * server (same test-only loopback policy 0281 established for the crawler).
     */
    transport?: ProviderTransportSeam;
}

export interface ProviderTransportSeam {
    allowLoopback?: boolean;
    resolvePinned?: (hostname: string) => Promise<{ ip: string; family: 4 | 6 }>;
    timeoutMs?: number;
}

/**
 * Normalize a provider URL to its origin, or '' when it is malformed.
 */
function originOf(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return '';
    }
}

/**
 * Deterministic page selection: homepage first, then observed order (§8).
 */
export function selectPerformancePages(crawl: CrawlArtifact, limit = MAX_PERFORMANCE_PAGES): string[] {
    const available = crawl.pages.filter((p) => p.availability === 'available');
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const page of available) {
        const url = page.url;
        if (!seen.has(url)) {
            seen.add(url);
            ordered.push(url);
        }
    }
    return ordered.slice(0, limit);
}

/** A single pinned GET/POST JSON request used for the two fixed provider endpoints. */
export async function providerRequestJson(
    url: string,
    init: { method: 'GET' | 'POST'; body?: string },
    timeoutMs: number,
    seam: ProviderTransportSeam = {},
): Promise<unknown> {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const pinned = seam.resolvePinned
        ? await seam.resolvePinned(parsed.hostname)
        : await resolveAndPinDns(parsed.hostname);

    return new Promise<unknown>((resolvePromise, rejectPromise) => {
        let settled = false;
        const chunks: Buffer[] = [];
        let bytes = 0;
        let req: http.ClientRequest | null = null;

        const abort = (err: Error): void => {
            if (settled) return;
            settled = true;
            disposeCancel();
            try {
                req?.destroy();
            } catch {
                // ignore
            }
            rejectPromise(err);
        };

        // Cancellation aborts the in-flight provider socket (design §4).
        const disposeCancel = onSeoCancel((signal) => {
            abort(new SeoStageCancelledError(signal, url));
        });
        const alreadyCancelled = seoCancelledSignal();
        if (alreadyCancelled !== null) {
            abort(new SeoStageCancelledError(alreadyCancelled, url));
            return;
        }

        const timer = setTimeout(() => abort(new Error(`provider request timed out after ${timeoutMs}ms`)), timeoutMs);

        const lookup = (
            _h: string,
            opts: unknown,
            cb: (err: Error | null, res: unknown, family?: number) => void,
        ): void => {
            const wantsAll = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all;
            if (wantsAll) cb(null, [{ address: pinned.ip, family: pinned.family }]);
            else cb(null, pinned.ip, pinned.family);
        };

        const requestOptions: http.RequestOptions = {
            hostname: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
            path: `${parsed.pathname}${parsed.search}`,
            method: init.method,
            headers: {
                Host: parsed.host,
                'User-Agent': 'KnowledgeKit-SmartSEO/1.0 (+https://gobing.ai)',
                Accept: 'application/json',
                'Accept-Encoding': 'identity',
                Connection: 'close',
                ...(init.body
                    ? { 'Content-Type': 'application/json', 'Content-Length': `${Buffer.byteLength(init.body)}` }
                    : {}),
            },
            agent: false,
            lookup,
            timeout: timeoutMs,
        };
        if (isHttps) (requestOptions as https.RequestOptions).servername = parsed.hostname;

        req = client.request(requestOptions, (res) => {
            clearTimeout(timer);
            // §13: provider redirects are refused rather than followed to another origin.
            if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
                abort(new Error(`provider redirect refused (status ${res.statusCode})`));
                return;
            }
            const remote = req?.socket?.remoteAddress ?? null;
            if (!remote || remote !== pinned.ip || !isPublicAddress(remote, seam.allowLoopback)) {
                abort(new Error(`provider peer check failed: ${remote}`));
                return;
            }
            res.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > MAX_PROVIDER_BYTES) {
                    abort(new Error(`provider response exceeded ${MAX_PROVIDER_BYTES} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (settled) return;
                settled = true;
                disposeCancel();
                clearTimeout(timer);
                const body = Buffer.concat(chunks).toString('utf-8');
                if (res.statusCode !== undefined && res.statusCode !== 200) {
                    rejectPromise(new Error(`provider status ${res.statusCode}`));
                    return;
                }
                try {
                    resolvePromise(JSON.parse(body));
                } catch (err: unknown) {
                    rejectPromise(
                        new Error(
                            `provider response was not JSON: ${err instanceof Error ? err.message : String(err)}`,
                        ),
                    );
                }
            });
            res.on('error', abort);
        });

        req.on('error', (err) => {
            clearTimeout(timer);
            abort(err);
        });
        if (init.body) req.write(init.body);
        req.end();
    });
}

function numeric(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse one PSI response into lab metrics. Field data is deliberately ignored here (§13).
 */
export function parsePsiResponse(payload: unknown, url: string, strategy: 'mobile' | 'desktop'): LabEntry {
    const root = (payload ?? {}) as Record<string, unknown>;
    const lighthouse = (root.lighthouseResult ?? {}) as Record<string, unknown>;
    const audits = (lighthouse.audits ?? {}) as Record<string, Record<string, unknown>>;
    const metric = (id: string): number | null => {
        const audit = audits[id];
        if (!audit || typeof audit !== 'object') return null;
        return numeric(audit.numericValue);
    };
    return {
        url,
        strategy,
        metrics: {
            lcpMs: metric('largest-contentful-paint'),
            cls: metric('cumulative-layout-shift'),
            // TBT is lab-only evidence and is never treated as INP (§13).
            tbtMs: metric('total-blocking-time'),
            inpMs: metric('interaction-to-next-paint'),
            fetchTimeMs: metric('speed-index'),
        },
    };
}

/**
 * Parse one CrUX response into field metrics plus URL/origin scope (§13).
 */
export function parseCruxResponse(payload: unknown, url: string, requestedScope: 'url' | 'origin'): FieldEntry {
    const root = (payload ?? {}) as Record<string, unknown>;
    const record = (root.record ?? {}) as Record<string, unknown>;
    const metrics = (record.metrics ?? {}) as Record<string, Record<string, unknown>>;
    const p75 = (name: string): number | null => {
        const entry = metrics[name];
        if (!entry || typeof entry !== 'object') return null;
        const percentiles = entry.percentiles as Record<string, unknown> | undefined;
        if (!percentiles || typeof percentiles !== 'object') return null;
        return numeric(percentiles.p75);
    };

    const lcpMs = p75('largest_contentful_paint');
    const inpMs = p75('interaction_to_next_paint');
    const cls = p75('cumulative_layout_shift');
    // The three thresholds must ALL be present and satisfied; a missing metric is unknown,
    // never a pass and never a zero (§8).
    const passed =
        lcpMs === null || inpMs === null || cls === null ? null : lcpMs <= 2500 && inpMs <= 200 && cls <= 0.1;

    const window = (record.collectionPeriod ?? null) as Record<string, unknown> | null;
    return {
        url,
        scope: requestedScope,
        formFactor: 'PHONE',
        collectionWindow:
            window && typeof window === 'object'
                ? {
                      start: typeof window.firstDate === 'string' ? window.firstDate : null,
                      end: typeof window.lastDate === 'string' ? window.lastDate : null,
                  }
                : null,
        metrics: { lcpMs, inpMs, cls },
        passedCoreWebVitals: passed,
        reason:
            passed === null
                ? 'field evidence incomplete — one or more p75 metrics missing'
                : passed
                  ? 'field p75 LCP/INP/CLS within thresholds'
                  : 'field p75 thresholds not met',
    };
}

/**
 * Validate a normalized visibility snapshot (§8). Throws on any contract violation —
 * an invalid supplied snapshot is a required input error, never a silent `unavailable`.
 */
export function validateVisibilitySnapshot(raw: unknown): {
    siteOrigin: string;
    locale: string;
    source: string;
    collectedAt: string;
    measurementKind: 'measured' | 'estimated';
    rows: VisibilityRow[];
} {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('visibility snapshot must be a JSON object');
    }
    const obj = raw as Record<string, unknown>;
    if (obj.schemaVersion !== 1) throw new Error('visibility snapshot schemaVersion must be 1');

    const required = (key: string): string => {
        const value = obj[key];
        if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`visibility snapshot is missing a non-empty "${key}"`);
        }
        if (value.length > MAX_VISIBILITY_STRING) {
            throw new Error(`visibility snapshot "${key}" exceeds ${MAX_VISIBILITY_STRING} characters`);
        }
        return value.trim();
    };

    const siteOrigin = required('siteOrigin');
    try {
        const parsedOrigin = new URL(siteOrigin);
        if (parsedOrigin.origin !== siteOrigin) {
            throw new Error('not a bare origin');
        }
    } catch {
        throw new Error(`visibility snapshot siteOrigin is not an origin: ${siteOrigin}`);
    }
    const locale = required('locale');
    const source = required('source');
    const collectedAt = required('collectedAt');
    const collectedMs = Date.parse(collectedAt);
    if (Number.isNaN(collectedMs)) {
        throw new Error(`visibility snapshot collectedAt is not a valid instant: ${collectedAt}`);
    }
    const kind = obj.measurementKind;
    if (kind !== 'measured' && kind !== 'estimated') {
        throw new Error(`visibility snapshot measurementKind must be measured|estimated, got ${String(kind)}`);
    }
    const rawRows = obj.rows;
    if (!Array.isArray(rawRows)) throw new Error('visibility snapshot rows must be an array');
    if (rawRows.length > MAX_VISIBILITY_ROWS) {
        throw new Error(`visibility snapshot has ${rawRows.length} rows (max ${MAX_VISIBILITY_ROWS})`);
    }

    const inScope = (candidate: string): boolean => {
        try {
            return new URL(candidate).origin === siteOrigin;
        } catch {
            return false;
        }
    };
    const count = (value: unknown, key: string): number | null => {
        if (value === undefined || value === null) return null;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            throw new Error(`visibility row "${key}" must be a nonnegative integer, got ${String(value)}`);
        }
        return value;
    };

    const rows: VisibilityRow[] = rawRows.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            throw new Error(`visibility row ${index} must be an object`);
        }
        const row = entry as Record<string, unknown>;
        const query = row.query;
        if (typeof query !== 'string' || query.trim() === '') {
            throw new Error(`visibility row ${index} is missing a non-empty "query"`);
        }
        if (query.length > MAX_VISIBILITY_STRING) {
            throw new Error(`visibility row ${index} query exceeds ${MAX_VISIBILITY_STRING} characters`);
        }
        let url: string | null = null;
        if (row.url !== undefined && row.url !== null) {
            if (typeof row.url !== 'string') throw new Error(`visibility row ${index} "url" must be a string`);
            if (!inScope(row.url)) {
                throw new Error(`visibility row ${index} url is outside the declared site origin: ${row.url}`);
            }
            url = row.url;
        }
        let position: number | null = null;
        if (row.position !== undefined && row.position !== null) {
            if (typeof row.position !== 'number' || !Number.isFinite(row.position) || row.position < 1) {
                throw new Error(`visibility row ${index} "position" must be >= 1, got ${String(row.position)}`);
            }
            position = row.position;
        }
        const sampleCount = count(row.sampleCount, 'sampleCount');
        let citations: number | null = null;
        if (row.citations !== undefined && row.citations !== null) {
            citations = count(row.citations, 'citations');
            const platform = row.platform;
            if (typeof platform !== 'string' || platform.trim() === '') {
                throw new Error(`visibility row ${index} citations require a "platform"`);
            }
            if (sampleCount === null) {
                throw new Error(`visibility row ${index} citations require a "sampleCount" denominator`);
            }
            if (citations !== null && citations > sampleCount) {
                throw new Error(`visibility row ${index} citations (${citations}) exceed sampleCount (${sampleCount})`);
            }
        }
        return {
            query: query.trim(),
            url,
            clicks: count(row.clicks, 'clicks'),
            impressions: count(row.impressions, 'impressions'),
            position,
            citations,
            sampleCount,
            platform: typeof row.platform === 'string' ? row.platform.trim() : null,
        };
    });

    return { siteOrigin, locale, source, collectedAt, measurementKind: kind, rows };
}

/**
 * Build the visibility artifact, applying the future/stale dispositions (§8/§13).
 */
export function buildVisibilityArtifact(
    input: {
        siteOrigin: string;
        locale: string;
        source: string;
        collectedAt: string;
        measurementKind: 'measured' | 'estimated';
        rows: VisibilityRow[];
    },
    runId: string,
    now: Date,
): VisibilityArtifact {
    const collectedMs = Date.parse(input.collectedAt);
    if (collectedMs > now.getTime()) {
        throw new Error(`visibility snapshot collectedAt is in the future: ${input.collectedAt}`);
    }
    const ageDays = (now.getTime() - collectedMs) / 86_400_000;
    const stale = ageDays > STALE_EVIDENCE_DAYS;
    const excluded = stale
        ? input.rows.map((row) => ({
              query: row.query,
              reason: `evidence collected ${Math.floor(ageDays)} days ago (stale > ${STALE_EVIDENCE_DAYS} days)`,
          }))
        : [];
    return {
        schemaVersion: 1,
        methodVersion: '1.0.0',
        runId,
        createdAt: now.toISOString(),
        inputDigest: '',
        predecessorDigests: {},
        status: 'available',
        source: input.source,
        siteOrigin: input.siteOrigin,
        locale: input.locale,
        collectedAt: input.collectedAt,
        measurementKind: input.measurementKind,
        stale,
        rows: input.rows,
        excluded,
    };
}

/**
 * `seo-enrich <work_dir>` — optional measured evidence; disabled mode makes no provider request.
 */
export async function runSeoEnrich(workDir: string, deps: EnrichDeps = {}): Promise<void> {
    const optionsPath = resolve(workDir, 'options.json');
    const crawlPath = resolve(workDir, 'crawl.json');
    const optionsRaw = readFileSync(optionsPath, 'utf-8');
    const crawlRaw = readFileSync(crawlPath, 'utf-8');
    const options: SeoOptions = JSON.parse(optionsRaw);
    const crawl: CrawlArtifact = JSON.parse(crawlRaw);
    const env = deps.env ?? (process.env as Record<string, string | undefined>);
    const now = deps.now ?? new Date();
    const psiEndpoint = deps.endpoints?.psi ?? PSI_ENDPOINT;
    const cruxEndpoint = deps.endpoints?.crux ?? CRUX_ENDPOINT;
    const transport = deps.transport ?? {};
    const requestJson =
        deps.requestJson ??
        ((url: string, init: { method: 'GET' | 'POST'; body?: string }) =>
            providerRequestJson(url, init, transport.timeoutMs ?? ENRICH_DEADLINE_MS, transport));

    const base = {
        schemaVersion: 1 as const,
        methodVersion: '1.0.0',
        runId: crawl.runId,
        createdAt: now.toISOString(),
        inputDigest: crawl.inputDigest,
        predecessorDigests: {
            ...crawl.predecessorDigests,
            'crawl.json': crawl.predecessorDigests['crawl.json'] ?? '',
        },
        unavailable: [] as { url: string; scope: 'lab' | 'field'; reason: string }[],
    };

    // ── performance: disabled by default, so the default path issues no provider request ──
    let performance: PerformanceArtifact;
    if (!options.performance) {
        performance = {
            ...base,
            status: 'disabled',
            lab: [],
            field: [],
            attempts: 0,
            labIsFieldAuthority: false,
            unavailable: [],
        };
    } else {
        const psiKey = env[PSI_KEY_ENV];
        const cruxKey = env[CRUX_KEY_ENV];
        const pages = selectPerformancePages(crawl);
        // Monotonic budget: the 300 s enrichment deadline is measured from stage start, never from
        // the (possibly injected) wall clock, so a supplied `now` cannot pre-exhaust the budget.
        const startedAt = Date.now();
        const lab: LabEntry[] = [];
        const field: FieldEntry[] = [];
        const unavailable: { url: string; scope: 'lab' | 'field'; reason: string }[] = [];
        let attempts = 0;

        const budgetLeft = (): boolean =>
            attempts < MAX_ENRICH_ATTEMPTS &&
            Date.now() - startedAt < ENRICH_DEADLINE_MS &&
            seoCancelledSignal() === null;

        for (const pageUrl of pages) {
            // Cancellation stops new provider dispatch (design §4).
            assertSeoNotCancelled();
            if (psiKey) {
                for (const strategy of ['mobile', 'desktop'] as const) {
                    if (!budgetLeft()) break;
                    attempts += 1;
                    const target = `${psiEndpoint}?url=${encodeURIComponent(pageUrl)}&strategy=${strategy}&key=${psiKey}`;
                    try {
                        lab.push(parsePsiResponse(await requestJson(target, { method: 'GET' }), pageUrl, strategy));
                    } catch (err: unknown) {
                        unavailable.push({
                            url: pageUrl,
                            scope: 'lab',
                            reason: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            } else {
                unavailable.push({ url: pageUrl, scope: 'lab', reason: `${PSI_KEY_ENV} is not configured` });
            }

            if (cruxKey && budgetLeft()) {
                attempts += 1;
                try {
                    const record = await requestJson(cruxEndpoint, {
                        method: 'POST',
                        body: JSON.stringify({ url: pageUrl, formFactor: 'PHONE', key: cruxKey }),
                    });
                    field.push(parseCruxResponse(record, pageUrl, 'url'));
                } catch (err: unknown) {
                    const reason = err instanceof Error ? err.message : String(err);
                    // §13: the origin fallback is attempted only for an unavailable URL record,
                    // and never substitutes a passing origin result for a failed URL result.
                    const origin = originOf(pageUrl);
                    if (origin && budgetLeft()) {
                        attempts += 1;
                        try {
                            const record = await requestJson(cruxEndpoint, {
                                method: 'POST',
                                body: JSON.stringify({ origin, formFactor: 'PHONE', key: cruxKey }),
                            });
                            field.push(parseCruxResponse(record, pageUrl, 'origin'));
                        } catch (originErr: unknown) {
                            unavailable.push({
                                url: pageUrl,
                                scope: 'field',
                                reason: `${reason}; origin fallback failed: ${originErr instanceof Error ? originErr.message : String(originErr)}`,
                            });
                        }
                    } else {
                        unavailable.push({ url: pageUrl, scope: 'field', reason });
                    }
                }
            } else if (!cruxKey) {
                unavailable.push({ url: pageUrl, scope: 'field', reason: `${CRUX_KEY_ENV} is not configured` });
            }
        }

        const anyEvidence = lab.length > 0 || field.length > 0;
        performance = {
            ...base,
            status: anyEvidence ? 'available' : 'unavailable',
            lab,
            field,
            attempts,
            labIsFieldAuthority: false,
            unavailable,
        };
    }
    writeJsonAtomic(resolve(workDir, 'performance.json'), performance);

    // ── visibility: explicit operator input, validated before it can drive keywords ──
    let visibility: VisibilityArtifact;
    if (!options.visibility_file || options.visibility_file.trim() === '') {
        visibility = {
            ...base,
            status: 'not-assessed',
            source: '',
            siteOrigin: new URL(options.url).origin,
            locale: options.locale,
            collectedAt: '',
            measurementKind: 'measured',
            stale: false,
            rows: [],
            excluded: [],
        };
    } else {
        const visibilityPath = resolve(options.visibility_file);
        if (!existsSync(visibilityPath)) {
            throw new Error(`seo-enrich: visibility_file not found at ${visibilityPath}`);
        }
        const raw = readFileSync(visibilityPath, 'utf-8');
        if (Buffer.byteLength(raw, 'utf-8') > MAX_VISIBILITY_BYTES) {
            throw new Error(`seo-enrich: visibility snapshot exceeds ${MAX_VISIBILITY_BYTES} bytes`);
        }
        const validated = validateVisibilitySnapshot(JSON.parse(raw));
        const expectedOrigin = new URL(options.url).origin;
        if (validated.siteOrigin !== expectedOrigin) {
            throw new Error(
                `seo-enrich: visibility snapshot siteOrigin ${validated.siteOrigin} does not match the audit scope ${expectedOrigin}`,
            );
        }
        if (validated.locale !== options.locale) {
            throw new Error(
                `seo-enrich: visibility snapshot locale ${validated.locale} does not match the audit locale ${options.locale}`,
            );
        }
        visibility = {
            ...buildVisibilityArtifact(validated, crawl.runId, now),
            inputDigest: crawl.inputDigest,
            predecessorDigests: base.predecessorDigests,
        };
    }
    writeJsonAtomic(resolve(workDir, 'visibility.json'), visibility);
}
