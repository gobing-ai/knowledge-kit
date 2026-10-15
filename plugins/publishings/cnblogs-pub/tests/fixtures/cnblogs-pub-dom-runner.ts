/**
 * Named real-Chromium fixture runner for the cnblogs article flow (task 0293 chunk C1), modeled on
 * csdn's composer runner (0292): the PRODUCTION `CnblogsBrowserTransport` publishes against a real
 * headless Chromium whose only reachable page is a synthetic cnblogs Markdown editor post page
 * fulfilled by route interception ON the real https://i.cnblogs.com origin (never a substitute
 * origin). A catch-all route aborts every other request, so the browser stays loopback-only with
 * zero live provider calls (AC: zero live network). The transport's injected launcher opens a
 * fresh routed context per launch — the read-only headless session preflight first, then the flow
 * pass.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip.
 *
 * Usage: bun tests/fixtures/cnblogs-pub-dom-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { CnblogsBrowserTransport } from '../../src/flow';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`cnblogs real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/**
 * Persisted-receipt shapes (`CNBLOGS_RECEIPT_URL_RES`, selectors.ts): the draft save keeps the
 * editor URL and gains `postId` (pushState, same origin); the publish leg surfaces the public
 * `/p/<id>.html` post URL as a fresh anchor.
 */
export const REAL_DRAFT_URL = 'https://i.cnblogs.com/posts/edit?postId=20261015001';
export const REAL_POST_URL = 'https://www.cnblogs.com/fixture/p/20261015002.html';
/** Receipt-shaped URL on screen from the start — the ambiguous scenario's baseline (stale, never fresh). */
export const STALE_RECEIPT_URL = 'https://i.cnblogs.com/posts/edit?postId=20261015009';

export type CnblogsScenario = 'draft-happy' | 'public-happy' | 'missing-draft' | 'draft-ambiguous';

/**
 * Synthetic logged-in cnblogs Markdown editor post page carrying the production selectors of
 * `CNBLOGS_ARTICLE_SELECTORS` (src/selectors.ts): the grounded `input#post-title`,
 * `textarea#md-editor` and `textarea#summary` in the article form, the provisional category panel
 * `#cateOwner` with label-wrapped checkboxes for the existing categories (前端, 后端), the
 * exact-visible 保存草稿 draft control and the 发布博文 publish control. The draft click
 * `history.pushState`s to the postId-bearing edit URL (the receipt regex's first shape); the
 * publish click appends the id-bearing post-URL anchor — both are the fresh-signal confirmations
 * `readReceiptUrls` observes. Each save also reports the editor's observable state (filled
 * title/body/summary plus checked category labels) to the runner through a context binding.
 * `missing-draft` omits the draft control (typed fail-closed); `draft-ambiguous` starts on an
 * already-receipt-shaped URL and the draft click changes no id, so no fresh receipt can appear.
 */
export function composerHtml(scenario: CnblogsScenario): string {
    const draftButton = scenario === 'missing-draft' ? '' : '<button type="button" id="draft-save">保存草稿</button>';
    const draftClick =
        scenario === 'draft-ambiguous'
            ? // No id change: the receipt URL is already on screen, so nothing fresh can confirm.
              "history.pushState({}, '', location.href);"
            : `history.pushState({}, '', ${JSON.stringify(REAL_DRAFT_URL)});`;
    const report =
        'window.__kkFixtureReport && window.__kkFixtureReport(JSON.stringify({' +
        "title: document.querySelector('input#post-title').value," +
        "body: document.querySelector('textarea#md-editor').value," +
        "summary: document.querySelector('textarea#summary').value," +
        'checked: [...document.querySelectorAll(\'#cateOwner input[type="checkbox"]:checked\')]' +
        ".map((b) => b.closest('label').textContent.trim()) }));";
    return `<!doctype html>
<html><body>
<form id="post" action="#">
  <input id="post-title" type="text" value="" />
  <textarea id="md-editor" style="min-height:4em"></textarea>
  <textarea id="summary"></textarea>
  <div id="cateOwner">
    <label><input type="checkbox" value="前端" /> 前端</label>
    <label><input type="checkbox" value="后端" /> 后端</label>
  </div>
  ${draftButton}
  <button type="button" id="publish">发布博文</button>
</form>
<script>
  const report = ${JSON.stringify(report)};
  const draft = document.getElementById('draft-save');
  if (draft !== null) draft.addEventListener('click', () => { eval(report); ${draftClick} });
  document.getElementById('publish').addEventListener('click', () => {
    eval(report);
    const link = document.createElement('a');
    link.href = ${JSON.stringify(REAL_POST_URL)};
    link.textContent = '查看博文';
    document.body.appendChild(link);
  });
</script>
</body></html>`;
}

/** One production run's observable outcome; assertions live in `tests/cnblogs-pub-dom.test.ts`. */
export interface CnblogsDomFacts {
    scenario: string;
    ok?: boolean;
    url?: string;
    id?: string;
    stage?: string;
    confirmedBy?: string;
    error?: string;
    observed?: { title?: string; body?: string; summary?: string; checked?: readonly string[] };
    launches: number;
}

export async function runCnblogsScenario(browser: Browser, scenario: CnblogsScenario): Promise<CnblogsDomFacts> {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-cnblogs-fixture-'));
    try {
        // The preflight refuses a missing profile dir; the fixture owns one scratch dir.
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        let launches = 0;
        // The `__kkFixtureReport` binding hands the page's own save-time state back to this runner.
        const reports: string[] = [];
        const transport = new CnblogsBrowserTransport('article', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    const context = await browser.newContext();
                    // Registered first so the origin handler below (later registrations win) shadows it.
                    await context.route('**/*', (route) => route.abort());
                    await context.route('https://i.cnblogs.com/**', async (route) => {
                        if (route.request().method() === 'GET') {
                            await route.fulfill({
                                contentType: 'text/html; charset=utf-8',
                                body: composerHtml(scenario),
                            });
                            return;
                        }
                        await route.abort();
                    });
                    await context.exposeFunction('__kkFixtureReport', (payload: string) => {
                        reports.push(payload);
                    });
                    return context;
                },
            },
            stepTimeoutMs: 8_000,
        });
        const draft = scenario === 'draft-happy' || scenario === 'missing-draft' || scenario === 'draft-ambiguous';
        const result = await transport.publish(
            draft
                ? {
                      // Absent publishStatus defaults to draft: only the exact-visible 保存草稿
                      // control activates; the digest exercises the grounded summary textarea.
                      content: {
                          title: 'Fixture 草稿',
                          body: 'Hello from the cnblogs real-DOM fixture\n\n第二段',
                          format: 'markdown',
                          metadata: { digest: 'Fixture 摘要' },
                      },
                      options: { profileDir, categories: ['前端'] },
                  }
                : {
                      content: {
                          title: 'Fixture 草稿',
                          body: 'Hello from the cnblogs real-DOM fixture\n\n第二段',
                          format: 'markdown',
                          metadata: { publishStatus: 'public' },
                      },
                      // No cover/tags/images: this flow refuses them, so the fixture never sends one.
                      options: { profileDir, categories: ['后端'] },
                  },
        );
        const stage = typeof result.metadata?.stage === 'string' ? result.metadata.stage : undefined;
        const confirmedBy = typeof result.metadata?.confirmedBy === 'string' ? result.metadata.confirmedBy : undefined;
        let observed: CnblogsDomFacts['observed'];
        try {
            const raw = reports[reports.length - 1];
            observed = raw === undefined ? undefined : (JSON.parse(raw) as CnblogsDomFacts['observed']);
        } catch {
            observed = undefined;
        }
        return {
            scenario,
            ok: result.ok,
            ...(result.url === undefined ? {} : { url: result.url }),
            ...(result.id === undefined ? {} : { id: result.id }),
            ...(stage === undefined ? {} : { stage }),
            ...(confirmedBy === undefined ? {} : { confirmedBy }),
            error: result.ok ? undefined : result.error,
            ...(observed === undefined ? {} : { observed }),
            launches,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/cnblogs-pub-dom-runner.ts <scenario>): the launch
    // must not fire when the test file imports this module's helpers.
    const scenarios: readonly string[] = ['draft-happy', 'public-happy', 'missing-draft', 'draft-ambiguous'];
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/cnblogs-pub-dom-runner.ts [${scenarios.join('|')}]\nMissing browser? ${RECOVERY_HINT}`,
        );
        process.exit(0);
    }
    const scenario = process.argv[2] ?? '';
    if (!scenarios.includes(scenario)) {
        console.error(`unknown scenario '${scenario}' — expected one of: ${scenarios.join(', ')}`);
        process.exit(1);
    }
    launchChromium()
        .then(async (browser) => {
            try {
                const facts = await runCnblogsScenario(browser, scenario as CnblogsScenario);
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
