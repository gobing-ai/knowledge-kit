/** probe-podcast.ts — read-only DOM map of the podcast draft editor. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[pp]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = ((await context.pages()[0]) ?? (await context.newPage())) as import('playwright').Page;
try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 6000 });
    await sleep(1500);
    await page.locator('text=播客笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(4000);

    const dump = await page.evaluate(() => {
        const vis = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const inputs = Array.from(document.querySelectorAll('input'))
            .filter(vis)
            .map((i) => ({
                type: i.type,
                accept: i.accept || null,
                ph: i.placeholder || null,
                cls: String(i.className).slice(0, 40),
            }));
        const textareas = Array.from(document.querySelectorAll('textarea'))
            .filter(vis)
            .map((t) => ({
                ph: t.placeholder || null,
                cls: String(t.className).slice(0, 40),
                val: (t.value || '').slice(0, 60),
            }));
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [contenteditable=""]'))
            .filter(vis)
            .map((e) => ({ cls: String(e.className).slice(0, 50), text: (e.textContent || '').slice(0, 80) }));
        const clickable = Array.from(document.querySelectorAll('button, [role="button"], .btn, span'))
            .filter(vis)
            .filter((e) => {
                const t = (e.textContent || '').trim();
                return t.length > 0 && t.length < 15 && /合集|封面|上传|保存|发布|换封|选集/.test(t);
            })
            .map((e) => ({
                tag: e.tagName,
                t: (e.textContent || '').trim().slice(0, 15),
                cls: String(e.className).slice(0, 40),
            }));
        const coverImgs = Array.from(document.querySelectorAll('img'))
            .filter(vis)
            .map((i) => ({
                src: (i.getAttribute('src') || '').slice(0, 80),
                nw: i.naturalWidth,
                cls: String(i.className).slice(0, 30),
            }))
            .filter((x) => /cover|封面|spectrum|creator-preview/i.test(x.src) || x.nw === 0)
            .slice(0, 10);
        return { inputs, textareas, editables, clickable: clickable.slice(0, 25), coverImgs };
    });
    log(JSON.stringify(dump, null, 1));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
