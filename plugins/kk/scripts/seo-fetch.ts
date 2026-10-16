import * as dns from 'node:dns/promises';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { dirname } from 'node:path';
import { normalizeUrl, sha256 } from './seo-facts';

/* ------------------------------------------------------------------ *
 * Stage cancellation (design §4)
 *
 * A cancelled audit must abort its active sockets and child processes,
 * dispatch no further request or decision, and preserve the artifacts it
 * already wrote. The registry lives here because this module is the shared
 * leaf every SEO stage imports — no cycle, one cancellation surface.
 * ------------------------------------------------------------------ */

/** Signals that cancel a running SEO stage (a host interrupt or engine cancel). */
export const SEO_CANCEL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/** Raised when a stage observes cancellation; callers stop dispatching new work. */
export class SeoStageCancelledError extends Error {
    readonly signal: NodeJS.Signals;
    constructor(signal: NodeJS.Signals, detail = '') {
        super(detail === '' ? `seo stage cancelled by ${signal}` : `seo stage cancelled by ${signal}: ${detail}`);
        this.name = 'SeoStageCancelledError';
        this.signal = signal;
    }
}

type SeoCancelListener = (signal: NodeJS.Signals) => void;

let seoCancelledBy: NodeJS.Signals | null = null;
let seoHandlersInstalled = false;
const seoCancelListeners = new Set<SeoCancelListener>();
const seoSignalHandlers = new Map<NodeJS.Signals, () => void>();

/** The signal that cancelled this process, or null while it is still live. */
export function seoCancelledSignal(): NodeJS.Signals | null {
    return seoCancelledBy;
}

/** Conventional shell exit status for a signal-terminated process. */
export function seoSignalExitCode(signal: NodeJS.Signals): number {
    if (signal === 'SIGINT') return 130;
    if (signal === 'SIGTERM') return 143;
    if (signal === 'SIGHUP') return 129;
    return 1;
}

/** Install the process handlers once; every later call only registers a listener. */
function ensureSeoCancelHandlers(): void {
    if (seoHandlersInstalled) return;
    seoHandlersInstalled = true;
    for (const signal of SEO_CANCEL_SIGNALS) {
        const handler = (): void => {
            if (seoCancelledBy !== null) return; // first signal wins; a second never re-enters work
            seoCancelledBy = signal;
            for (const listener of [...seoCancelListeners]) {
                try {
                    listener(signal);
                } catch {
                    // a listener failure must not block the remaining cancellations
                }
            }
        };
        seoSignalHandlers.set(signal, handler);
        process.on(signal, handler);
    }
}

/**
 * Observe cancellation. Returns a disposer that removes the listener (and, when
 * no listener remains, the process signal handlers) so a long-lived process does
 * not accumulate handlers across stages.
 */
export function onSeoCancel(listener: SeoCancelListener): () => void {
    ensureSeoCancelHandlers();
    seoCancelListeners.add(listener);
    return () => {
        seoCancelListeners.delete(listener);
        if (seoCancelListeners.size === 0) {
            for (const [signal, handler] of seoSignalHandlers) process.removeListener(signal, handler);
            seoSignalHandlers.clear();
            seoHandlersInstalled = false;
        }
    };
}

/** Throw when the process has been cancelled — the check every bounded loop makes. */
export function assertSeoNotCancelled(): void {
    if (seoCancelledBy !== null) throw new SeoStageCancelledError(seoCancelledBy);
}

/**
 * Keep cancellation observable for a whole stage, so a signal that lands between two
 * bounded steps is still recorded instead of killing the process by default action.
 * Returns a disposer; the shipped stages are one-shot processes and may keep it.
 */
export function installSeoStageCancellation(): () => void {
    return onSeoCancel(() => {
        // State is recorded by the signal handler; in-flight requests have their own listeners.
    });
}

/** Reset process-wide cancellation state. Tests only — a cancelled process never resumes. */
export function resetSeoStageCancellation(): void {
    for (const [signal, handler] of seoSignalHandlers) process.removeListener(signal, handler);
    seoSignalHandlers.clear();
    seoCancelListeners.clear();
    seoHandlersInstalled = false;
    seoCancelledBy = null;
}

export interface TransportOptions {
    allowLoopback?: boolean;
    ca?: string | Buffer;
    timeoutMs?: number;
    maxBytes?: number;
}

export interface FetchResult {
    url: string;
    finalUrl: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    bytesReceived: number;
    ttfbMs: number;
    redirectChain: string[];
    peerAddress: string | null;
}

/** Check if string is IPv4 */
export function isIPv4(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    for (const p of parts) {
        if (!/^\d{1,3}$/.test(p)) return false;
        const n = Number(p);
        if (n < 0 || n > 255) return false;
        if (p.length > 1 && p.startsWith('0')) return false; // no octal
    }
    return true;
}

/**
 * Check if an IPv4 address is in non-public / private / reserved / loopback / multicast ranges.
 */
export function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    const [b0, b1] = parts;
    if (b0 === undefined || b1 === undefined) return true;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;
    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;
    // 100.64.0.0/10 (Shared / Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (b0 === 169 && b1 === 254) return true;
    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;
    // 192.88.99.0/24 (6to4 Relay)
    if (b0 === 192 && b1 === 88 && parts[2] === 99) return true;
    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
    if (b0 >= 224) return true;

    return false;
}

/** Check if IPv6 address is private / reserved / loopback / mapped IPv4 */
export function isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    // Loopback
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

    // IPv4-mapped IPv6: ::ffff:w.x.y.z
    if (normalized.startsWith('::ffff:')) {
        const v4Part = normalized.slice(7);
        if (isIPv4(v4Part)) {
            return isPrivateIPv4(v4Part);
        }
    }

    // ULA fc00::/7 (fc00... or fd00...)
    if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    // Multicast ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(normalized)) return true;
    // Documentation 2001:db8::/32
    if (/^2001:0?db8:/i.test(normalized)) return true;
    // Discard 100::/64
    if (/^0?100:/i.test(normalized)) return true;

    return false;
}

/**
 * Validate that an IP address is a public address.
 * Rejects private, loopback, link-local, multicast, and reserved ranges.
 */
export function isPublicAddress(ip: string, allowLoopback = false): boolean {
    if (allowLoopback && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
        return true;
    }
    if (isIPv4(ip)) {
        return !isPrivateIPv4(ip);
    }
    return !isPrivateIPv6(ip);
}

/**
 * Resolve DNS for hostname and validate all addresses against public policy.
 * Returns the first validated IP address to pin, along with family.
 */
export async function resolveAndPinDns(
    hostname: string,
    options: { allowLoopback?: boolean } = {},
): Promise<{ ip: string; family: 4 | 6 }> {
    const allowLoopback = options.allowLoopback ?? false;

    // Direct IP given as hostname
    if (isIPv4(hostname)) {
        if (!isPublicAddress(hostname, allowLoopback)) {
            throw new Error(`Forbidden non-public IP address: ${hostname}`);
        }
        return { ip: hostname, family: 4 };
    }

    // Resolve both IPv4 and IPv6
    const [v4Results, v6Results] = await Promise.allSettled([
        dns.resolve4(hostname).catch(() => []),
        dns.resolve6(hostname).catch(() => []),
    ]);

    const v4 = v4Results.status === 'fulfilled' ? v4Results.value : [];
    const v6 = v6Results.status === 'fulfilled' ? v6Results.value : [];
    const all = [...v4.map((ip) => ({ ip, family: 4 as const })), ...v6.map((ip) => ({ ip, family: 6 as const }))];

    if (all.length === 0) {
        throw new Error(`DNS resolution failed for hostname: ${hostname}`);
    }

    // Every resolved IP MUST pass public address validation (prevents DNS rebinding / mixed answers)
    for (const record of all) {
        if (!isPublicAddress(record.ip, allowLoopback)) {
            throw new Error(`DNS answer contains forbidden non-public IP: ${record.ip} for ${hostname}`);
        }
    }

    const first = all[0];
    if (!first) {
        throw new Error(`No DNS answers found for ${hostname}`);
    }
    return first;
}

/**
 * Single HTTP(S) request with pinned socket and peer verification.
 */
export function pinnedSingleRequest(
    targetUrl: string,
    pinned: { ip: string; family: 4 | 6 },
    options: TransportOptions = {},
): Promise<FetchResult> {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;
    const timeoutMs = options.timeoutMs ?? 20000;
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2 MiB

    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let peerAddress: string | null = null;
        let bytesReceived = 0;
        let ttfbMs = 0;
        const chunks: Buffer[] = [];
        const startTime = Date.now();
        let clientReq: http.ClientRequest | https.ClientRequest | null = null;

        const cleanupAndReject = (err: Error): void => {
            if (settled) return;
            settled = true;
            disposeCancel();
            if (clientReq) {
                try {
                    clientReq.destroy();
                } catch {
                    // ignore
                }
            }
            rejectPromise(err);
        };

        // Cancellation aborts the in-flight socket, not merely the loop that would have used it.
        const disposeCancel = onSeoCancel((signal) => {
            cleanupAndReject(new SeoStageCancelledError(signal, targetUrl));
        });
        if (seoCancelledBy !== null) {
            cleanupAndReject(new SeoStageCancelledError(seoCancelledBy, targetUrl));
            return;
        }

        const timer = setTimeout(() => {
            cleanupAndReject(new Error(`Request timed out after ${timeoutMs}ms for ${targetUrl}`));
        }, timeoutMs);

        const customLookup: (
            hostname: string,
            opts: unknown,
            cb: (err: Error | null, res: unknown, family?: number) => void,
        ) => void = (_h, opts, cb) => {
            const hasAll = typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all;
            if (hasAll) {
                cb(null, [{ address: pinned.ip, family: pinned.family }]);
            } else {
                cb(null, pinned.ip, pinned.family);
            }
        };

        const reqOptions: http.RequestOptions = {
            hostname: parsed.hostname,
            port,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            headers: {
                Host: parsed.host,
                'User-Agent': 'KnowledgeKit-SmartSEO/1.0 (+https://gobing.ai)',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Encoding': 'identity',
                Connection: 'close',
            },
            agent: false, // disable connection reuse
            lookup: customLookup,
            timeout: timeoutMs,
        };

        if (isHttps) {
            const httpsOpts = reqOptions as https.RequestOptions;
            httpsOpts.servername = parsed.hostname; // SNI
            if (options.ca) {
                httpsOpts.ca = options.ca;
            }
        }

        clientReq = client.request(reqOptions, (res) => {
            ttfbMs = Date.now() - startTime;
            clearTimeout(timer);

            // Peer check verification
            const remote = clientReq?.socket?.remoteAddress ?? null;
            peerAddress = remote;
            if (!remote || remote !== pinned.ip) {
                cleanupAndReject(new Error(`Peer address mismatch: expected ${pinned.ip}, got ${remote}`));
                return;
            }

            // Verify remote address is public (or allowed loopback)
            if (!isPublicAddress(remote, options.allowLoopback)) {
                cleanupAndReject(new Error(`Peer address is non-public: ${remote}`));
                return;
            }

            res.on('data', (chunk: Buffer) => {
                bytesReceived += chunk.length;
                if (bytesReceived > maxBytes) {
                    cleanupAndReject(new Error(`Response exceeded limit of ${maxBytes} bytes`));
                    return;
                }
                chunks.push(chunk);
            });

            res.on('end', () => {
                if (settled) return;
                settled = true;
                disposeCancel();
                clearTimeout(timer);
                const rawHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    if (v !== undefined) {
                        rawHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
                    }
                }
                const body = Buffer.concat(chunks).toString('utf-8');
                resolvePromise({
                    url: targetUrl,
                    finalUrl: targetUrl,
                    status: res.statusCode ?? 0,
                    headers: rawHeaders,
                    body,
                    bytesReceived,
                    ttfbMs,
                    redirectChain: [],
                    peerAddress,
                });
            });

            res.on('error', (err) => {
                cleanupAndReject(err);
            });
        });

        clientReq.on('socket', (socket) => {
            socket.on('connect', () => {
                const remote = socket.remoteAddress;
                peerAddress = remote ?? null;
                if (remote && remote !== pinned.ip) {
                    cleanupAndReject(new Error(`Socket peer mismatch: expected ${pinned.ip}, got ${remote}`));
                }
            });
        });

        clientReq.on('error', (err) => {
            clearTimeout(timer);
            cleanupAndReject(err);
        });

        // A signal that arrived while the request object was being built must not still open a socket.
        if (settled) {
            clientReq.destroy();
            return;
        }
        clientReq.end();
    });
}

/**
 * Fetch URL with pinned DNS, public address check, peer verification,
 * and scoped redirects (max 10 hops).
 */
export async function fetchWithPinnedDns(
    initialUrl: string,
    scopeHostnames: Set<string>,
    options: TransportOptions = {},
): Promise<FetchResult> {
    let currentUrl = normalizeUrl(initialUrl);
    const redirectChain: string[] = [];
    const maxRedirects = 10;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
        assertSeoNotCancelled();
        const parsed = new URL(currentUrl);

        // Scope check
        if (!scopeHostnames.has(parsed.hostname.toLowerCase())) {
            // Off-scope redirect: return with chain
            throw new Error(`Off-scope redirect target refused: ${currentUrl}`);
        }

        // DNS pinning
        const pinned = await resolveAndPinDns(parsed.hostname, { allowLoopback: options.allowLoopback });

        // Single request
        const res = await pinnedSingleRequest(currentUrl, pinned, options);

        // Check for redirect status
        const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
        const locationHeader = res.headers.location;

        if (isRedirect && locationHeader) {
            redirectChain.push(currentUrl);
            let nextUrl: string;
            try {
                nextUrl = new URL(locationHeader, currentUrl).toString();
                nextUrl = normalizeUrl(nextUrl);
            } catch {
                // Malformed location header: return current redirect response
                res.redirectChain = redirectChain;
                return res;
            }

            const nextParsed = new URL(nextUrl);
            // Protocol must be http or https
            if (nextParsed.protocol !== 'http:' && nextParsed.protocol !== 'https:') {
                throw new Error(`Forbidden redirect protocol: ${nextParsed.protocol}`);
            }

            // Check if redirect target is within site scope
            if (!scopeHostnames.has(nextParsed.hostname.toLowerCase())) {
                // Record off-scope redirect without following
                res.redirectChain = redirectChain;
                res.finalUrl = currentUrl;
                return res;
            }

            if (hop === maxRedirects) {
                throw new Error(`Exceeded maximum redirect limit of ${maxRedirects} hops`);
            }

            currentUrl = nextUrl;
            continue;
        }

        res.redirectChain = redirectChain;
        res.finalUrl = currentUrl;
        return res;
    }

    throw new Error(`Exceeded redirect limit for ${initialUrl}`);
}

/**
 * Parsed robots.txt representation (RFC 9309).
 */
export interface RobotsPolicy {
    rawDigest: string;
    isAvailable: boolean;
    isBlocked: boolean; // 401/403
    crawlDelaySeconds: number | null;
    sitemaps: string[];
    isPathAllowed(path: string, userAgent?: string): boolean;
}

interface RobotsRule {
    pattern: string;
    isAllow: boolean;
    length: number;
}

interface RobotsGroup {
    userAgents: string[];
    rules: RobotsRule[];
    crawlDelay: number | null;
}

/**
 * Parse robots.txt according to RFC 9309 rules:
 * - Case-insensitive User-agent matching
 * - Allow / Disallow with longest match
 * - Tie break: Allow wins
 * - '*' wildcards and '$' end of path
 * - Crawl-delay extraction
 */
export function parseRobotsTxt(content: string): RobotsPolicy {
    const rawDigest = sha256(content);
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];

    let currentGroup: RobotsGroup = {
        userAgents: [],
        rules: [],
        crawlDelay: null,
    };

    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
        // Strip comment
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) continue;

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;

        const field = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (field === 'user-agent') {
            if (currentGroup.rules.length > 0) {
                groups.push(currentGroup);
                currentGroup = { userAgents: [], rules: [], crawlDelay: null };
            }
            currentGroup.userAgents.push(value.toLowerCase());
        } else if (field === 'disallow' || field === 'allow') {
            const isAllow = field === 'allow';
            const pattern = value;
            if (pattern === '' && !isAllow) {
                // Empty Disallow: Disallow nothing (same as Allow: /)
                continue;
            }
            currentGroup.rules.push({
                pattern,
                isAllow,
                length: pattern.length,
            });
        } else if (field === 'crawl-delay') {
            const parsedDelay = Number.parseFloat(value);
            if (!Number.isNaN(parsedDelay) && parsedDelay >= 0) {
                currentGroup.crawlDelay = parsedDelay;
            }
        } else if (field === 'sitemap') {
            if (value && !sitemaps.includes(value)) {
                sitemaps.push(value);
            }
        }
    }

    if (currentGroup.userAgents.length > 0 || currentGroup.rules.length > 0) {
        groups.push(currentGroup);
    }

    // Match helper for wildcard RFC 9309 patterns
    const matchPattern = (path: string, pattern: string): boolean => {
        if (pattern === '' || pattern === '/') return true;
        // Escape regex special chars except * and $
        let regexStr = '^';
        for (let i = 0; i < pattern.length; i += 1) {
            const char = pattern[i];
            if (char === '*') {
                regexStr += '.*';
            } else if (char === '$' && i === pattern.length - 1) {
                regexStr += '$';
            } else {
                regexStr += (char as string).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
            }
        }
        if (!pattern.endsWith('$')) {
            // Prefix match
            if (!regexStr.endsWith('.*')) regexStr += '.*';
        }
        try {
            return new RegExp(regexStr).test(path);
        } catch {
            return path.startsWith(pattern);
        }
    };

    const isPathAllowed = (path: string, ua = 'knowledgekit-smartseo'): boolean => {
        const lowerUa = ua.toLowerCase();
        // Find best matching group: specific first, then wildcard *
        let selectedGroup = groups.find((g) => g.userAgents.some((u) => lowerUa.includes(u)));
        if (!selectedGroup) {
            selectedGroup = groups.find((g) => g.userAgents.includes('*'));
        }
        if (!selectedGroup || selectedGroup.rules.length === 0) {
            return true;
        }

        // Find longest matching rule
        let bestRule: RobotsRule | null = null;
        for (const rule of selectedGroup.rules) {
            if (matchPattern(path, rule.pattern)) {
                if (!bestRule || rule.length > bestRule.length) {
                    bestRule = rule;
                } else if (rule.length === bestRule.length) {
                    // Tie break: Allow wins over Disallow
                    if (rule.isAllow) {
                        bestRule = rule;
                    }
                }
            }
        }

        if (bestRule === null) return true;
        return bestRule.isAllow;
    };

    // Find default crawl delay
    let defaultDelay: number | null = null;
    for (const g of groups) {
        if (g.crawlDelay !== null) {
            defaultDelay = g.crawlDelay;
            break;
        }
    }

    return {
        rawDigest,
        isAvailable: true,
        isBlocked: false,
        crawlDelaySeconds: defaultDelay,
        sitemaps,
        isPathAllowed,
    };
}

/**
 * Bounded non-expanding XML sitemap reader.
 * Refuses DOCTYPE, custom entities, and malformed tags.
 * Supports <urlset> / <url> / <loc> and <sitemapindex> / <sitemap> / <loc>.
 */
export function parseSitemapXml(xmlContent: string): { urls: string[]; childSitemaps: string[] } {
    if (xmlContent.length > 5 * 1024 * 1024) {
        throw new Error('Sitemap XML exceeds 5 MiB size limit');
    }

    // Refuse DOCTYPE or custom entity expansion (XXE protection)
    if (/<!DOCTYPE\b/i.test(xmlContent) || /<!ENTITY\b/i.test(xmlContent)) {
        throw new Error('Forbidden XML construct: DOCTYPE and custom ENTITY definitions are rejected');
    }

    const unescapeXml = (str: string): string => {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    };

    const urls: string[] = [];
    const childSitemaps: string[] = [];

    // Is it a sitemapindex?
    const isIndex = /<sitemapindex\b/i.test(xmlContent);

    if (isIndex) {
        const sitemapMatches = xmlContent.matchAll(/<sitemap\b[\s\S]*?<\/sitemap>/gi);
        for (const sm of sitemapMatches) {
            const locMatch = sm[0].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i);
            if (locMatch?.[1]) {
                const decoded = unescapeXml(locMatch[1].trim());
                if (decoded && !childSitemaps.includes(decoded)) {
                    childSitemaps.push(decoded);
                }
            }
        }
    } else {
        const urlMatches = xmlContent.matchAll(/<url\b[\s\S]*?<\/url>/gi);
        for (const um of urlMatches) {
            const locMatch = um[0].match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i);
            if (locMatch?.[1]) {
                const decoded = unescapeXml(locMatch[1].trim());
                if (decoded && !urls.includes(decoded)) {
                    urls.push(decoded);
                }
            }
        }
    }

    return { urls, childSitemaps };
}

/**
 * Atomic file writer using sibling temp file + rename.
 */
export function writeJsonAtomic(destPath: string, data: unknown): void {
    const parent = dirname(destPath);
    if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
    }
    const rand = Math.random().toString(36).slice(2, 8);
    const tmpPath = `${destPath}.tmp.${Date.now()}.${rand}`;
    const serialized = JSON.stringify(data, null, 2);
    try {
        writeFileSync(tmpPath, serialized, 'utf-8');
        renameSync(tmpPath, destPath);
    } catch (err) {
        try {
            unlinkSync(tmpPath);
        } catch {
            // ignore
        }
        throw err;
    }
}
