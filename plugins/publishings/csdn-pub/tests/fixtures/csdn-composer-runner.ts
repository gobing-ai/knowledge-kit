/**
 * Named real-Chromium fixture runner for the csdn article flow (task 0292 chunk C), modeled on
 * jike's composer runner (0291): the PRODUCTION `CsdnBrowserTransport` publishes against a real
 * headless Chromium whose only reachable page is a synthetic Markdown editor fulfilled by route
 * interception ON the real https://editor.csdn.net origin (never a substitute origin). A catch-all
 * route aborts every other request, so the browser stays loopback-only with zero live provider
 * calls (AC: zero live network). The transport's injected launcher opens a fresh routed context
 * per launch — the read-only headless session preflight first, then the headed flow pass.
 *
 * `chromium.launch` rejects when the browser is missing; the runner surfaces it as an actionable
 * environment failure naming the recovery hint, never a silent skip.
 *
 * Usage: bun tests/fixtures/csdn-composer-runner.ts <scenario>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { CsdnBrowserTransport } from '../../src/index';

/** Operator recovery for a missing browser — every fixture failure names it. */
export const RECOVERY_HINT = 'bunx playwright install chromium';

export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch({ headless: true, timeout: 20_000 });
    } catch (error) {
        throw new Error(`csdn real-browser fixture could not launch Chromium — run: ${RECOVERY_HINT}`, {
            cause: error,
        });
    }
}

/** Persisted-receipt shape the fresh-signal rule confirms on (`mp_blog/creation/editor/<id>`, csdn.js:340). */
export const REAL_ARTICLE_URL = 'https://mp.csdn.net/mp_blog/creation/editor/20261015001';
/** Draft receipt: the editor URL gaining an articleId param (the frozen draft save's id gain). */
export const REAL_DRAFT_URL = 'https://editor.csdn.net/md/?articleId=20261015002';

/**
 * Synthetic logged-in Markdown editor carrying the production selectors of
 * `CSDN_ARTICLE_SELECTORS` (src/index.ts): the `.article-bar` scope with the title-display
 * activator (title input stays readonly until clicked, per task 0292 Design), the grounded
 * cledit `pre` body editor, the 发布文章 chrome entry, the top-level 保存草稿 draft button
 * (`DRAFT_SAVE_SELECTORS`, task 0292 chunk D) and the `.modal__publish-article` publish
 * modal with tag input → committed chip, category control → exact option in a body-level popper
 * layer, cover file input → 上传中 settle text → preview node, and the 发布 submit. The submit
 * appends a fresh receipt anchor plus a 发布成功 status toast; the draft button gains an articleId
 * URL param via history.pushState — the fresh-signal confirmations.
 */
export const COMPOSER_HTML = `<!doctype html>
<html><body>
<div class="article-bar">
  <div class="article-bar__title-display">请输入文章标题</div>
  <input class="article-bar__title--input" placeholder="请输入文章标题" readonly />
  <button type="button">发布文章</button>
</div>
<pre class="editor__inner markdown-highlighting" contenteditable="true" style="min-height:1em"></pre>
<button type="button" class="button-save" data-title="保存草稿">保存草稿</button>
<div class="modal__publish-article" style="display:none">
  <label>文章标签 <input placeholder="请输入标签" /></label>
  <div class="tag-chips"></div>
  <label>分类专栏 <input placeholder="请选择分类" /></label>
  <label>封面 <input type="file" /></label>
  <div class="cover-box"></div>
  <button type="button">发布</button>
</div>
<script>
  const modal = document.querySelector('.modal__publish-article');
  const titleDisplay = document.querySelector('.article-bar__title-display');
  const titleInput = document.querySelector('input.article-bar__title--input');
  titleDisplay.addEventListener('click', () => { titleInput.readOnly = false; });
  document.querySelector('.article-bar button').addEventListener('click', () => {
    modal.style.display = 'block';
  });
  const tagInput = modal.querySelector('input[placeholder*="标签"]');
  tagInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || tagInput.value.trim().length === 0) return;
    const chip = document.createElement('span');
    chip.textContent = tagInput.value.trim();
    modal.querySelector('.tag-chips').appendChild(chip);
    tagInput.value = '';
  });
  const catInput = modal.querySelector('input[placeholder*="分类"]');
  catInput.addEventListener('click', () => {
    if (document.querySelector('.cat-popper') !== null) return;
    const layer = document.createElement('div');
    layer.className = 'cat-popper';
    for (const name of ['fixture-category']) {
      const option = document.createElement('div');
      option.textContent = name;
      option.addEventListener('click', () => { catInput.value = name; layer.remove(); });
      layer.appendChild(option);
    }
    document.body.appendChild(layer);
  });
  const cover = modal.querySelector('input[type="file"]');
  cover.addEventListener('change', () => {
    const status = document.createElement('span');
    status.textContent = '上传中';
    modal.querySelector('.cover-box').appendChild(status);
    setTimeout(() => {
      status.remove();
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      modal.querySelector('.cover-box').appendChild(img);
    }, 100);
  });
  document.querySelector('button.button-save').addEventListener('click', () => {
    history.pushState({}, '', ${JSON.stringify(REAL_DRAFT_URL)});
  });
  modal.querySelector('button').addEventListener('click', () => {
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.textContent = '发布成功';
    document.body.appendChild(toast);
    const link = document.createElement('a');
    link.href = ${JSON.stringify(REAL_ARTICLE_URL)};
    link.textContent = '查看文章';
    document.body.appendChild(link);
  });
</script>
</body></html>`;

/** One production run's observable outcome; assertions live in `tests/csdn-pub.test.ts`. */
export interface CsdnComposerFacts {
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
    await context.route('https://editor.csdn.net/**', async (route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ contentType: 'text/html; charset=utf-8', body: COMPOSER_HTML });
            return;
        }
        await route.abort();
    });
    return context;
}

export async function runComposerScenario(browser: Browser, scenario = 'article-happy'): Promise<CsdnComposerFacts> {
    if (scenario !== 'article-happy' && scenario !== 'draft-happy') throw new Error(`unknown scenario: ${scenario}`);
    const draft = scenario === 'draft-happy';
    const scratch = mkdtempSync(join(tmpdir(), 'kk-csdn-fixture-'));
    try {
        // The preflight refuses a missing profile dir, and the cover gate wants a real PNG — both
        // live in one owned scratch dir.
        const profileDir = join(scratch, 'profile');
        mkdirSync(profileDir, { recursive: true });
        const coverPath = join(scratch, 'cover.png');
        writeFileSync(
            coverPath,
            Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64',
            ),
        );
        let launches = 0;
        const transport = new CsdnBrowserTransport('article', 'script', {
            launcher: {
                launch: async () => {
                    launches += 1;
                    return openRoutedContext(browser);
                },
            },
            stepTimeoutMs: 8_000,
        });
        const result = await transport.publish(
            draft
                ? {
                      // Absent publishStatus defaults to draft; no fields requested, so the publish
                      // modal (and its public submit) is never opened — only the top-level 保存草稿.
                      content: {
                          title: 'Fixture',
                          body: 'Hello from the csdn real-browser fixture flow',
                          format: 'markdown',
                      },
                      options: { profileDir },
                  }
                : {
                      content: {
                          title: 'Fixture',
                          body: 'Hello from the csdn real-browser fixture flow',
                          format: 'markdown',
                          metadata: { publishStatus: 'public' },
                      },
                      options: { tags: ['fixture-tag'], categories: ['fixture-category'], coverPath, profileDir },
                  },
        );
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
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    // Subprocess entry only (bun tests/fixtures/csdn-composer-runner.ts <scenario>): the launch must
    // not fire when the test file imports this module's helpers.
    if (process.argv[2] === '--help' || process.argv[2] === '-h') {
        console.log(
            `Usage: bun tests/fixtures/csdn-composer-runner.ts [article-happy|draft-happy]\nMissing browser? ${RECOVERY_HINT}`,
        );
        process.exit(0);
    }
    const scenario = process.argv[2] ?? 'article-happy';
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
