/**
 * Named real-Chromium fixture runner for the jike composer flow (task 0291 chunk C), modeled on
 * wechatmp's cgi/dom runners: the PRODUCTION `JikeBrowserTransport` publishes against a real
 * headless Chromium whose only reachable page is a synthetic composer fulfilled by route
 * interception ON the real https://web.okjike.com origin (never a substitute origin). A catch-all
 * route aborts every other request, so the browser stays loopback-only with zero live provider
 * calls (AC: zero live network). The transport's injected launcher opens a fresh routed context
 * per launch — the read-only headless session preflight first, then the headed flow pass.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip.
 *
 * Usage: bun tests/fixtures/jike-composer-runner.ts <scenario>
 */
import type { Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { JikeBrowserTransport } from '../../src/index';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`jike real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

export const REAL_POST_URL = 'https://web.okjike.com/originalPost/KkRealFixture1';

/**
 * Synthetic logged-in home with the grounded composer shape: `form div[contenteditable="true"]`
 * (jike.js:307) inside the media-scope form, the topic input (jike.js:207) and a composer-scoped
 * file input. The 发送 button appends a fresh `/originalPost/` card whose text reads back the
 * composer content — the strong confirmation signal the flow requires.
 */
export const COMPOSER_HTML = `<!doctype html>
<html><body>
<form>
  <div name="topic"><input placeholder="未选择圈子" /></div>
  <div contenteditable="true"></div>
  <input type="file" style="display:none" />
  <button type="button">发送</button>
</form>
<script>
  document.querySelector('button').addEventListener('click', () => {
    const text = document.querySelector('div[contenteditable="true"]').textContent || '';
    const article = document.createElement('article');
    const link = document.createElement('a');
    link.href = ${JSON.stringify(REAL_POST_URL)};
    link.textContent = '刚刚';
    const body = document.createElement('div');
    body.textContent = text;
    article.appendChild(link);
    article.appendChild(body);
    document.body.appendChild(article);
  });
</script>
</body></html>`;

/** One production run's observable outcome; assertions live in `tests/jike-pub.test.ts`. */
export interface JikeComposerFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    id?: string;
    stage?: string;
    error?: string;
    launches: number;
}

/** A fresh routed context per launch: the preflight and the flow each get their own page. */
async function openRoutedContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext();
    // Registered first so the origin handler below (later registrations win) shadows it.
    await context.route('**/*', (route) => route.abort());
    await context.route('https://web.okjike.com/**', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: COMPOSER_HTML });
            return;
        }
        await route.abort();
    });
    return context;
}

export async function runComposerScenario(browser: Browser, scenario = 'post-happy'): Promise<JikeComposerFacts> {
    if (scenario !== 'post-happy') throw new Error(`unknown scenario: ${scenario}`);
    let launches = 0;
    const transport = new JikeBrowserTransport('post', 'script', {
        launcher: {
            launch: async () => {
                launches += 1;
                return openRoutedContext(browser);
            },
        },
        stepTimeoutMs: 8_000,
    });
    const result = await transport.publish({
        content: {
            title: 'Fixture',
            body: 'Hello from the jike real-browser fixture flow',
            format: 'markdown',
            metadata: { publishStatus: 'public' },
        },
    });
    const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
    return {
        scenario,
        ok: result.ok,
        ...(result.url === undefined ? {} : { url: result.url }),
        ...(result.id === undefined ? {} : { id: result.id }),
        ...(stage === undefined ? {} : { stage }),
        error: result.ok ? undefined : result.error,
        launches,
    };
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/jike-composer-runner.ts <scenario>): the launch must
    // not fire when the test file imports this module's helpers.
    const scenario = process.argv[2] ?? 'post-happy';
    launchChromium()
        .then(async (browser) => {
            try {
                const facts = await runComposerScenario(browser, scenario);
                // Last line of stdout is the machine contract for the bun:test guard.
                console.log(JSON.stringify(facts));
            } finally {
                await browser.close();
            }
        })
        .catch((error: unknown) => {
            console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
            process.exit(1);
        });
}
