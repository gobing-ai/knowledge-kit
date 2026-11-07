/**
 * Throwaway DOM probe (2026-11-07 dogfood, task: root-cause the weibo article publish-control
 * refusal "button:has-text(\"发布\") | button:has-text(\"发表\") not attached within 30000ms").
 *
 * Opens the 头条文章 editor with the real profile, passes the readiness gate, fills title + body
 * the same way runArticleFlow does, then dumps every button/a/textarea-visible candidate control
 * and all footer/toolbar HTML so the publish selector can be measured against the live DOM.
 *
 * Usage: bun plugins/publishings/weibo-pub/src/probe-publish-dom.ts
 */
import { checkChannelSession, kkBrowserLauncher, markdownToHtml, pasteHtml } from '@gobing-ai/publish-harness/browser';
import { withProfilePage } from '@gobing-ai/ts-browser-automation';
import { WEIBO_ARTICLE_URL, WEIBO_CONFIG } from './index';

const dumpControlsScript = `(() => {
    const rows = [];
    const walk = (root) => {
        for (const el of root.querySelectorAll('button, a, [role="button"], .n-button')) {
            const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30);
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                rows.push({ tag: el.tagName.toLowerCase(), text, cls: String(el.className).slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) });
            }
        }
    };
    walk(document);
    const foot = document.querySelector('[class*="editor-foot"], [class*="footer"], [class*="bottom"], [class*="action"]');
    return JSON.stringify({ controls: rows, foot: foot ? foot.outerHTML.slice(0, 4000) : null }, null, 1);
})()`;

const session = await checkChannelSession(WEIBO_CONFIG, { headlessFallback: false });
console.error(`preflight: ${session.status}`);
if (session.status !== 'verified') process.exit(1);

await withProfilePage(
    {
        profileDir: (WEIBO_CONFIG as unknown as { profileDir?: string }).profileDir,
        url: WEIBO_ARTICLE_URL,
        headless: false,
    },
    async ({ page }: { page: import('playwright').Page }) => {
        await page.waitForLoadState('networkidle').catch(() => undefined);
        console.error(`url: ${page.url()}`);
        // Fresh editor: create the draft the same way the flow does, fill title/body, measure controls.
        await page.evaluate(
            `(() => { const btns=[...document.querySelectorAll('button,a')]; const b=btns.find(x=>{const t=(x.textContent||'').trim(); return t==='写文章'||t.includes('创作一篇新文章')}); if(b) b.click(); return !!b; })()`,
        );
        await page.waitForTimeout(2000);
        const titleSel = await page
            .locator('input[placeholder*="标题"], textarea[placeholder*="标题"]')
            .first()
            .waitFor({ timeout: 20000 })
            .then(() => 'input[placeholder*="标题"], textarea[placeholder*="标题"]')
            .catch(() => '');
        if (titleSel) {
            await page.locator(titleSel).fill('每日AI乱炖 · 2026-11-06（DOM probe）');
            await pasteHtml(
                page,
                'body [contenteditable="true"]',
                markdownToHtml('## probe\n\n正文探针：仅用于测量发布控件的 DOM，不会保存或发布。'),
            );
            await page.waitForTimeout(1500);
        }
        const dump = await page.evaluate(dumpControlsScript);
        console.log(typeof dump === 'string' ? dump : JSON.stringify(dump, null, 1));
    },
    { launcher: kkBrowserLauncher() },
);
