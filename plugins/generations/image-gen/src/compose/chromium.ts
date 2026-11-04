/**
 * Task 0180 (F616) — Chromium-based card composer (Playwright).
 *
 * Default `CardComposer` implementation. Launches Chromium headless, renders
 * the HTML card, measures every [data-field] box against the safe area (R2),
 * and screenshots the result. The browser is always closed in `finally`.
 *
 * Font loading: an in-process `Bun.serve` on 127.0.0.1 serves the card HTML and
 * the two font files, and the page navigates to it. Fonts used to go through
 * `page.route()` + `route.fulfill()`, but pushing the ~8 MB OTFs over
 * Playwright's pipe under Bun 1.3.14 stalls intermittently (fulfill never
 * returns, `document.fonts.ready` never settles — 0212 dogfood, ~1 in 3 runs).
 *
 * The E2E test runs inside `bun test` on Bun 1.4.3 (the 1.3.14 launch block is
 * gone). `compose` carries a deadline as the backstop for any other stall.
 *
 * Missing Playwright or Chromium surfaces as an actionable error naming the
 * install command.
 */

import { join } from 'node:path';
import type { CardComposer, CardInput } from './card';
import { cardHtml } from './card';

const FONTS_DIR = join(import.meta.dir, '..', '..', 'assets', 'fonts');

/** A healthy compose takes seconds; two minutes only trips on a stalled Chromium cycle. */
const COMPOSE_TIMEOUT_MS = 120_000;

/**
 * Loopback server for one compose: `/` is the card HTML, `/fonts/<name>` serves only the
 * fonts the card declares (no other path reaches the disk). Same origin, so no CORS.
 */
function serveCard(input: CardInput): { url: string; stop: () => void } {
    const fontNames = [input.compose.fonts.headline, input.compose.fonts.body];
    let html = '';
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request) => {
            const path = decodeURIComponent(new URL(request.url).pathname);
            if (path === '/') return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
            const name = path.slice('/fonts/'.length);
            if (path.startsWith('/fonts/') && fontNames.includes(name)) {
                return new Response(Bun.file(join(FONTS_DIR, name)), { headers: { 'content-type': 'font/otf' } });
            }
            return new Response('not found', { status: 404 });
        },
    });
    const url = `http://127.0.0.1:${server.port}/`;
    html = cardHtml(input, new Map(fontNames.map((name) => [name, `${url}fonts/${encodeURIComponent(name)}`])));
    return { url, stop: () => server.stop(true) };
}

/**
 * Playwright-based card composer. Inject in tests; the default export is used
 * in production via `makeChromiumComposer()`.
 */
export class ChromiumComposer implements CardComposer {
    private readonly timeoutMs: number;

    constructor(options: { timeoutMs?: number } = {}) {
        this.timeoutMs = options.timeoutMs ?? COMPOSE_TIMEOUT_MS;
    }

    /**
     * Render under a deadline. A stalled Playwright cycle (see header) otherwise hangs the plugin
     * forever with nothing on disk to resume from (0212 dogfood, run 38e53162: 40 min in compose);
     * rejecting lets `main()` exit nonzero so the caller's stage fails and stays resumable.
     */
    async compose(input: CardInput): Promise<Uint8Array> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new Error(`compose: Chromium did not finish within ${this.timeoutMs}ms (stalled launch)`)),
                this.timeoutMs,
            );
        });
        try {
            return await Promise.race([this.render(input), deadline]);
        } finally {
            clearTimeout(timer);
        }
    }

    protected async render(input: CardInput): Promise<Uint8Array> {
        // Dynamic import so missing Playwright gives a clear error at call time.
        let chromium: import('playwright').BrowserType;
        try {
            const pw = await import('playwright');
            chromium = pw.chromium;
        } catch (err: unknown) {
            throw new Error(
                `compose: Playwright is not installed. Run: bunx playwright install chromium\n(${err instanceof Error ? err.message : String(err)})`,
            );
        }

        const card = serveCard(input);
        let browser: import('playwright').Browser | undefined;
        try {
            try {
                browser = await chromium.launch({ headless: true });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`compose: Chromium browser not found. Run: bunx playwright install chromium\n(${msg})`);
            }

            const page = await browser.newPage({
                viewport: { width: input.width, height: input.height },
                deviceScaleFactor: 1,
            });

            await page.goto(card.url, { waitUntil: 'domcontentloaded' });
            // Wait for fonts to load; passed as a string expression to avoid DOM lib dependency.
            await page.evaluate('document.fonts.ready');

            // R2: measure every [data-field] box against the safe area.
            const { safeArea, illustrationHeight } = input.compose;
            const safeLeft = safeArea;
            const safeTop = illustrationHeight + safeArea;
            const safeRight = input.width - safeArea;
            const safeBottom = input.height - safeArea;

            // Passed as a string to avoid requiring DOM lib in tsconfig; args injected by value.
            const overflowExpr = `
                (function(safeLeft, safeTop, safeRight, safeBottom) {
                    var results = [];
                    var els = Array.from(document.querySelectorAll('[data-field]'));
                    for (var i = 0; i < els.length; i++) {
                        var el = els[i];
                        var field = el.dataset.field || '';
                        var rect = el.getBoundingClientRect();
                        if (rect.left < safeLeft || rect.top < safeTop || rect.right > safeRight || rect.bottom > safeBottom) {
                            results.push({ field: field, rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right } });
                        }
                    }
                    return results;
                })(${safeLeft}, ${safeTop}, ${safeRight}, ${safeBottom})
            `;
            const overflows = (await page.evaluate(overflowExpr)) as Array<{
                field: string;
                rect: { top: number; left: number; bottom: number; right: number };
            }>;

            if (overflows.length > 0) {
                const fields = overflows.map((o) => o.field).join(', ');
                throw new Error(
                    `compose: text overflows the safe area for field(s): ${fields} (safe area: ${safeArea}px inset)`,
                );
            }

            const screenshot = await page.screenshot({ type: 'png', animations: 'disabled' });
            return new Uint8Array(screenshot);
        } finally {
            await browser?.close();
            card.stop();
        }
    }
}

/** Factory function that returns the default Chromium composer singleton. */
export function makeChromiumComposer(): CardComposer {
    return new ChromiumComposer();
}
