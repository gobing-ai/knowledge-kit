// 0288 R4 fixture runner: real headless Chromium (installed Playwright 1.55) against local
// synthetic-page HTTP servers. Named by docs/tasks/0288 §WHERE. Launch throws on a missing
// Chromium instead of skipping; all traffic stays on the local loopback servers.
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';

/** A local synthetic origin: per-path request counters plus canned responses. */
export interface FixtureServer {
    /** Bare origin (`http://127.0.0.1:<port>`) to pass as an allowed origin. */
    readonly origin: string;
    url(path: string): string;
    /** How many requests the browser actually sent to `path` on this origin. */
    count(path: string): number;
    reset(): void;
    stop(): Promise<void>;
}

type CannedResponse = { status?: number; body: string; contentType?: string; headers?: Record<string, string> };

/** Start a loopback server that counts every request and answers from the canned map (else 404). */
export function startFixtureServer(responses: Record<string, CannedResponse>): FixtureServer {
    const counts = new Map<string, number>();
    const server = Bun.serve({
        port: 0,
        fetch(request) {
            const path = new URL(request.url).pathname;
            counts.set(path, (counts.get(path) ?? 0) + 1);
            const hit = responses[path];
            if (!hit) return new Response('fixture: not found', { status: 404 });
            return new Response(hit.body, {
                status: hit.status ?? 200,
                headers: { 'content-type': hit.contentType ?? 'text/plain', ...hit.headers },
            });
        },
    });
    return {
        origin: server.url.origin,
        url: (path) => `${server.url.origin}${path}`,
        count: (path) => counts.get(path) ?? 0,
        reset: () => counts.clear(),
        stop: () => server.stop(true),
    };
}

/** The allowed origin's synthetic page: one existing `multiple` file input. */
export const FIXTURE_PAGE_HTML = '<!doctype html><html><body><input id="existing" type="file" multiple></body></html>';

/** Canned routes for the allow-listed origin; the root serves the synthetic page. */
export function mainServerRoutes(): Record<string, CannedResponse> {
    return {
        '/': { contentType: 'text/html', body: FIXTURE_PAGE_HTML },
        '/shield/webprofile': { contentType: 'application/json', body: '{"server":"saw-this-request"}' },
        '/api/other': { body: 'passthrough-ok' },
        '/boom': { status: 500, body: 'server-error' },
        '/beacon': { body: 'beacon-received' },
    };
}

/** Disallowed origin: serves its own `/shield/webprofile` so pass-through is observable. */
export function otherServerRoutes(): Record<string, CannedResponse> {
    return {
        '/': { contentType: 'text/html', body: FIXTURE_PAGE_HTML },
        '/shield/webprofile': { body: 'other-origin-shield', headers: { 'access-control-allow-origin': '*' } },
    };
}

/** Real Chromium handle; `chromium.launch` rejects (never skips) when the browser is missing. */
export interface ChromiumFixture {
    browser: Browser;
    close(): Promise<void>;
}

export async function launchChromium(): Promise<ChromiumFixture> {
    const browser = await chromium.launch({ headless: true });
    return { browser, close: () => browser.close() };
}

/** Fresh page (clean init scripts per test); polls bun:test cannot express with waitFor. */
export async function newPage(browser: Browser): Promise<Page> {
    return browser.newPage();
}

/** Poll until `check` is true or `ms` elapses (returns the final check result). */
export async function until(check: () => boolean, ms = 2000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (check()) return true;
        await Bun.sleep(25);
    }
    return check();
}
