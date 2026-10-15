import { createHash } from 'node:crypto';

export interface SeoOptions {
    url: string;
    locale: string;
    business_context: string;
    max_pages: number;
    max_depth: number;
    max_requests: number;
    deadline_seconds: number;
    semantic_pages: number;
    max_pairs: number;
    max_keywords: number;
    max_decision_calls: number;
    performance: boolean;
    visibility_file: string;
    fixture: string;
    allow_test_loopback?: boolean;
}

export interface RunEnvelope<T> {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: 'complete' | 'partial';
    payload: T;
}

export interface HeadingItem {
    level: number;
    text: string;
}

export interface ImageItem {
    src: string;
    alt: string | null;
    width: number | null;
    height: number | null;
}

export interface LinkItem {
    href: string;
    text: string;
    rel: string | null;
    isInternal: boolean;
}

export interface HreflangItem {
    lang: string;
    href: string;
}

export interface JsonLdItem {
    raw: string;
    parsed: unknown | null;
    types: string[];
    error: string | null;
}

export interface PageFacts {
    url: string;
    title: string | null;
    titleCount: number;
    metaDescription: string | null;
    metaDescriptionCount: number;
    canonical: string | null;
    robotsDirectives: string[];
    viewport: string | null;
    lang: string | null;
    headings: HeadingItem[];
    h1Count: number;
    images: ImageItem[];
    links: LinkItem[];
    openGraph: Record<string, string>;
    hreflang: HreflangItem[];
    jsonLd: JsonLdItem[];
    wordCount: number;
    textSample: string;
    ttfbMs: number | null;
    htmlByteLength: number;
    isRawHtmlShell: boolean;
}

export interface PageRecord {
    subjectId: string;
    url: string;
    status: number | null;
    availability: 'available' | 'blocked' | 'unavailable';
    redirectChain: string[];
    evidencePath: string | null;
    evidenceHash: string | null;
    facts: PageFacts | null;
    error: string | null;
}

export interface RequestRecord {
    url: string;
    method: string;
    status: number | null;
    durationMs: number;
    bytesReceived: number;
    error: string | null;
    timestamp: string;
}

export interface LimitsRecord {
    pagesVisited: number;
    requestsMade: number;
    totalBytes: number;
    elapsedSeconds: number;
    hitLimit: string | null;
}

export interface CrawlArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    predecessorDigests: Record<string, string>;
    status: 'complete' | 'partial';
    pages: PageRecord[];
    requests: RequestRecord[];
    limits: LimitsRecord;
}

export interface ManifestArtifact {
    schemaVersion: 1;
    methodVersion: string;
    runId: string;
    createdAt: string;
    inputDigest: string;
    stage: string;
    options: SeoOptions;
}

/** Compute sha256 hex digest of string or buffer. */
export function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Return normalized URL while strictly preserving:
 * - pathname (e.g. `/a` and `/a/` remain distinct)
 * - query parameters (sorted or preserved)
 * - fragments are removed
 */
export function normalizeUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const withScheme = hasScheme ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    parsed.hash = '';
    return parsed.toString();
}

/**
 * Derives the permitted site scope:
 * Exactly the normalized submitted hostname plus its exact www toggle.
 * Example:
 *   example.com -> { "example.com", "www.example.com" }
 *   www.example.com -> { "www.example.com", "example.com" }
 *   shop.example.com -> { "shop.example.com", "www.shop.example.com" }
 */
export function getScopeHostnames(submittedHostname: string): Set<string> {
    const host = submittedHostname.toLowerCase();
    const scope = new Set<string>();
    scope.add(host);
    if (host.startsWith('www.')) {
        scope.add(host.slice(4));
    } else {
        scope.add(`www.${host}`);
    }
    return scope;
}

/**
 * Check if target URL belongs to site scope.
 */
export function isUrlInScope(targetUrl: string, scopeHostnames: Set<string>): boolean {
    try {
        const parsed = new URL(targetUrl);
        return scopeHostnames.has(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/** BCP-47 tag validator: simple standard pattern. */
const BCP47_REGEX = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/**
 * Strict validator for options JSON.
 * Enforces design §3 caps and types.
 */
export function validateOptions(raw: unknown): SeoOptions {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('options must be a JSON object');
    }
    const obj = raw as Record<string, unknown>;

    if (typeof obj.url !== 'string' || obj.url.trim() === '') {
        throw new Error('options.url must be a non-empty string');
    }
    const rawUrl = obj.url.trim();
    if (rawUrl.includes('\0')) {
        throw new Error('options.url must not contain NUL bytes');
    }

    // Reject userinfo
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl);
    const candidate = hasScheme ? rawUrl : `https://${rawUrl}`;
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(candidate);
    } catch {
        throw new Error(`options.url is malformed: ${rawUrl}`);
    }

    if (parsedUrl.username || parsedUrl.password) {
        throw new Error('options.url must not contain user credentials');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`options.url protocol must be http or https, got ${parsedUrl.protocol}`);
    }
    const allowTestLoopback = Boolean(obj.allow_test_loopback);

    const rawHost = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocalAddress =
        rawHost === 'localhost' ||
        rawHost.endsWith('.local') ||
        rawHost.endsWith('.internal') ||
        rawHost === '0.0.0.0' ||
        rawHost === '127.0.0.1' ||
        rawHost === '::1';

    if (isLocalAddress && !allowTestLoopback) {
        throw new Error(`options.url specifies local/reserved address: ${rawHost}`);
    }

    if (parsedUrl.port && parsedUrl.port !== '80' && parsedUrl.port !== '443') {
        if (!allowTestLoopback || !isLocalAddress) {
            throw new Error(`options.url has nonstandard port: ${parsedUrl.port}`);
        }
    }

    const locale = typeof obj.locale === 'string' && obj.locale.trim() !== '' ? obj.locale.trim() : 'en-US';
    if (!BCP47_REGEX.test(locale)) {
        throw new Error(`options.locale must be a valid BCP-47 tag, got "${locale}"`);
    }

    const businessContext = typeof obj.business_context === 'string' ? obj.business_context : '';
    if (businessContext.length > 2000) {
        throw new Error(`options.business_context exceeds 2000 UTF-16 units (got ${businessContext.length})`);
    }

    const parseNum = (val: unknown, def: number, min: number, max: number, name: string): number => {
        if (val === undefined || val === null) return def;
        if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > max) {
            throw new Error(`options.${name} must be integer between ${min} and ${max}, got ${String(val)}`);
        }
        return val;
    };

    const maxPages = parseNum(obj.max_pages, 60, 1, 200, 'max_pages');
    const maxDepth = parseNum(obj.max_depth, 5, 1, 10, 'max_depth');
    const maxRequests = parseNum(obj.max_requests, 200, 1, 500, 'max_requests');
    const deadlineSeconds = parseNum(obj.deadline_seconds, 600, 10, 1800, 'deadline_seconds');
    const semanticPages = parseNum(obj.semantic_pages, 20, 1, 60, 'semantic_pages');
    const maxPairs = parseNum(obj.max_pairs, 10, 1, 40, 'max_pairs');
    const maxKeywords = parseNum(obj.max_keywords, 10, 1, 30, 'max_keywords');
    const maxDecisionCalls = parseNum(obj.max_decision_calls, 320, 1, 1000, 'max_decision_calls');

    const performance = typeof obj.performance === 'boolean' ? obj.performance : false;
    const visibilityFile = typeof obj.visibility_file === 'string' ? obj.visibility_file.trim() : '';
    const fixture = typeof obj.fixture === 'string' ? obj.fixture.trim() : '';

    return {
        url: normalizeUrl(candidate),
        locale,
        business_context: businessContext,
        max_pages: maxPages,
        max_depth: maxDepth,
        max_requests: maxRequests,
        deadline_seconds: deadlineSeconds,
        semantic_pages: semanticPages,
        max_pairs: maxPairs,
        max_keywords: maxKeywords,
        max_decision_calls: maxDecisionCalls,
        performance,
        visibility_file: visibilityFile,
        fixture,
        ...(allowTestLoopback ? { allow_test_loopback: true } : {}),
    };
}

/**
 * Extract HTML facts from HTML string using Bun HTMLRewriter.
 * Buffers text chunks per element.
 */
export async function extractHtmlFacts(
    html: string,
    options: {
        url: string;
        scopeHostnames: Set<string>;
        ttfbMs?: number | null;
    },
): Promise<PageFacts> {
    const pageUrl = options.url;
    const scopeHostnames = options.scopeHostnames;
    let title: string | null = null;
    let titleCount = 0;
    let currentTitleBuffer = '';

    let metaDescription: string | null = null;
    let metaDescriptionCount = 0;
    let canonical: string | null = null;
    const robotsDirectives: string[] = [];
    let viewport: string | null = null;
    let lang: string | null = null;

    const headings: HeadingItem[] = [];
    let currentHeadingBuffer = '';

    const images: ImageItem[] = [];
    const links: LinkItem[] = [];
    const openGraph: Record<string, string> = {};
    const hreflang: HreflangItem[] = [];

    const jsonLdRaw: string[] = [];
    let currentJsonLdBuffer = '';
    let insideJsonLd = false;

    // Body text extraction
    let bodyText = '';
    let skipTextDepth = 0;

    const rewriter = new HTMLRewriter();

    // html tag lang
    rewriter.on('html', {
        element(el) {
            const l = el.getAttribute('lang');
            if (l && !lang) lang = l.trim();
        },
    });

    // title tags
    rewriter.on('title', {
        element() {
            titleCount += 1;
            currentTitleBuffer = '';
        },
        text(chunk) {
            currentTitleBuffer += chunk.text;
            if (chunk.lastInTextNode) {
                if (title === null) {
                    title = currentTitleBuffer.trim();
                }
            }
        },
    });

    // meta tags
    rewriter.on('meta', {
        element(el) {
            const name = el.getAttribute('name')?.toLowerCase();
            const property = el.getAttribute('property')?.toLowerCase();
            const httpEquiv = el.getAttribute('http-equiv')?.toLowerCase();
            const content = el.getAttribute('content') ?? '';

            if (name === 'description') {
                metaDescriptionCount += 1;
                if (metaDescription === null) {
                    metaDescription = content.trim();
                }
            } else if (name === 'robots' || httpEquiv === 'robots') {
                for (const part of content.split(',')) {
                    const directive = part.trim().toLowerCase();
                    if (directive && !robotsDirectives.includes(directive)) {
                        robotsDirectives.push(directive);
                    }
                }
            } else if (name === 'viewport') {
                if (!viewport) viewport = content.trim();
            }

            if (property?.startsWith('og:')) {
                openGraph[property] = content;
            }
        },
    });

    // link tags
    rewriter.on('link', {
        element(el) {
            const rel = el.getAttribute('rel')?.toLowerCase();
            const href = el.getAttribute('href');
            if (!href) return;

            if (rel === 'canonical') {
                if (!canonical) canonical = href.trim();
            } else if (rel === 'alternate') {
                const hl = el.getAttribute('hreflang');
                if (hl) {
                    hreflang.push({ lang: hl.trim(), href: href.trim() });
                }
            }
        },
    });

    // headings h1, h2, h3
    for (let level = 1; level <= 3; level += 1) {
        const tag = `h${level}`;
        rewriter.on(tag, {
            element() {
                currentHeadingBuffer = '';
            },
            text(chunk) {
                currentHeadingBuffer += chunk.text;
                if (chunk.lastInTextNode) {
                    const text = currentHeadingBuffer.trim();
                    if (text) {
                        headings.push({ level, text });
                    }
                }
            },
        });
    }

    // images
    rewriter.on('img', {
        element(el) {
            const src = el.getAttribute('src');
            if (src) {
                const alt = el.getAttribute('alt');
                const widthAttr = el.getAttribute('width');
                const heightAttr = el.getAttribute('height');
                const width = widthAttr && !Number.isNaN(Number(widthAttr)) ? Number(widthAttr) : null;
                const height = heightAttr && !Number.isNaN(Number(heightAttr)) ? Number(heightAttr) : null;
                images.push({
                    src: src.trim(),
                    alt: alt !== null ? alt.trim() : null,
                    width,
                    height,
                });
            }
        },
    });

    // links <a>
    let currentAnchorHref: string | null = null;
    let currentAnchorRel: string | null = null;
    let currentAnchorText = '';

    rewriter.on('a', {
        element(el) {
            currentAnchorHref = el.getAttribute('href');
            currentAnchorRel = el.getAttribute('rel');
            currentAnchorText = '';
        },
        text(chunk) {
            currentAnchorText += chunk.text;
            if (chunk.lastInTextNode && currentAnchorHref) {
                const href = currentAnchorHref.trim();
                let isInternal = false;
                try {
                    const resolved = new URL(href, pageUrl);
                    isInternal = scopeHostnames.has(resolved.hostname.toLowerCase());
                } catch {
                    isInternal = false;
                }
                links.push({
                    href,
                    text: currentAnchorText.trim(),
                    rel: currentAnchorRel ? currentAnchorRel.trim() : null,
                    isInternal,
                });
            }
        },
    });

    // json-ld
    rewriter.on('script[type="application/ld+json"]', {
        element() {
            insideJsonLd = true;
            currentJsonLdBuffer = '';
        },
        text(chunk) {
            if (insideJsonLd) {
                currentJsonLdBuffer += chunk.text;
                if (chunk.lastInTextNode) {
                    jsonLdRaw.push(currentJsonLdBuffer.trim());
                    insideJsonLd = false;
                }
            }
        },
    });

    // script/style/nav/header/footer exclusion for visible text
    const skipTags = ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'svg'];
    for (const tag of skipTags) {
        rewriter.on(tag, {
            element(el) {
                skipTextDepth += 1;
                el.onEndTag(() => {
                    skipTextDepth = Math.max(0, skipTextDepth - 1);
                });
            },
        });
    }

    rewriter.on('body', {
        text(chunk) {
            if (skipTextDepth === 0) {
                const t = chunk.text.trim();
                if (t) {
                    bodyText += ` ${t}`;
                }
            }
        },
    });

    // Transform HTML
    const response = rewriter.transform(new Response(html));
    await response.text();

    // Process JSON-LD items
    const jsonLdItems: JsonLdItem[] = [];
    for (const raw of jsonLdRaw) {
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            const types: string[] = [];
            const collectTypes = (val: unknown): void => {
                if (typeof val === 'object' && val !== null) {
                    if (Array.isArray(val)) {
                        for (const item of val) collectTypes(item);
                    } else {
                        const rec = val as Record<string, unknown>;
                        if (typeof rec['@type'] === 'string') {
                            types.push(rec['@type']);
                        } else if (Array.isArray(rec['@type'])) {
                            for (const t of rec['@type']) {
                                if (typeof t === 'string') types.push(t);
                            }
                        }
                        for (const child of Object.values(rec)) {
                            collectTypes(child);
                        }
                    }
                }
            };
            collectTypes(parsed);
            jsonLdItems.push({
                raw: raw.length > 4096 ? `${raw.slice(0, 4096)}...` : raw,
                parsed,
                types,
                error: null,
            });
        } catch (err: unknown) {
            jsonLdItems.push({
                raw: raw.length > 1024 ? `${raw.slice(0, 1024)}...` : raw,
                parsed: null,
                types: [],
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const cleanBodyText = bodyText.replace(/\s+/g, ' ').trim();
    const words = cleanBodyText ? cleanBodyText.split(' ').filter(Boolean) : [];
    const wordCount = words.length;
    const textSample = cleanBodyText.slice(0, 500);

    const h1Count = headings.filter((h) => h.level === 1).length;

    // Raw HTML shell heuristic:
    // small visible text (<50 words) while html contains root container or multiple scripts
    const hasAppRoot = /id=["'](root|app|__next|__nuxt)["']/.test(html);
    const hasScriptTags = /<script\b[^>]*src=/i.test(html);
    const isRawHtmlShell = wordCount < 50 && (hasAppRoot || hasScriptTags);

    return {
        url: pageUrl,
        title,
        titleCount,
        metaDescription,
        metaDescriptionCount,
        canonical,
        robotsDirectives,
        viewport,
        lang,
        headings,
        h1Count,
        images,
        links,
        openGraph,
        hreflang,
        jsonLd: jsonLdItems,
        wordCount,
        textSample,
        ttfbMs: options.ttfbMs ?? null,
        htmlByteLength: Buffer.byteLength(html, 'utf-8'),
        isRawHtmlShell,
    };
}
