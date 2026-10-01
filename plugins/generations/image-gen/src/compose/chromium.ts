/**
 * Task 0180 (F616) — Chromium-based card composer (Playwright).
 *
 * Default `CardComposer` implementation. Launches Chromium headless, renders
 * the HTML card, measures every [data-field] box against the safe area (R2),
 * and screenshots the result. The browser is always closed in `finally`.
 *
 * Font loading: uses `page.route()` to serve fonts from disk by URL, keeping
 * the HTML small. The HTML references fonts by a stable `kk-font://` URL
 * scheme; the route intercept fulfils each request with the disk bytes.
 *
 * The transport is Playwright's default; under Bun 1.3.14 a Chromium launch
 * cycle can occasionally hang (leaving the browser's process tree behind),
 * so the E2E test skips under `bun test` and the evidence script runs each
 * variant pair in its own subprocess with a bounded timeout + retry.
 *
 * Missing Playwright or Chromium surfaces as an actionable error naming the
 * install command.
 */

import { join } from 'node:path';
import { readBytes } from '../bytes';
import type { CardComposer, CardInput } from './card';
import { cardHtml } from './card';

const FONTS_DIR = join(import.meta.dir, '..', '..', 'assets', 'fonts');

/** Stable URL prefix for font routes; never hits the network. */
const FONT_ROUTE_BASE = 'http://kk-fonts.local/';

/**
 * Build a map of fontName → route URL. The HTML references these URLs;
 * `page.route()` intercepts and returns the disk bytes.
 */
function fontRouteUrls(fontNames: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const name of fontNames) {
        map.set(name, `${FONT_ROUTE_BASE}${encodeURIComponent(name)}`);
    }
    return map;
}

/**
 * Playwright-based card composer. Inject in tests; the default export is used
 * in production via `makeChromiumComposer()`.
 */
export class ChromiumComposer implements CardComposer {
    async compose(input: CardInput): Promise<Uint8Array> {
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

        const fontNames = [input.compose.fonts.headline, input.compose.fonts.body];
        const fontUrls = fontRouteUrls(fontNames);

        // Build HTML with font URLs (small — no base64 inline).
        const html = cardHtml(input, fontUrls);

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

            // Serve fonts from disk via route interception; no network, no base64 blob.
            await page.route(`${FONT_ROUTE_BASE}**`, async (route) => {
                const url = new URL(route.request().url());
                const fontName = decodeURIComponent(url.pathname.slice(1));
                const fontPath = join(FONTS_DIR, fontName);
                try {
                    const bytes = await readBytes(fontPath);
                    await route.fulfill({
                        status: 200,
                        contentType: 'font/otf',
                        body: Buffer.from(bytes),
                    });
                } catch {
                    await route.abort();
                }
            });

            await page.setContent(html, { waitUntil: 'domcontentloaded' });
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
        }
    }
}

/** Factory function that returns the default Chromium composer singleton. */
export function makeChromiumComposer(): CardComposer {
    return new ChromiumComposer();
}
