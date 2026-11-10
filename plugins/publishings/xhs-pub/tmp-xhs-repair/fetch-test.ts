/**
 * fetch-test.ts — in the REOPENED editor (draft with dead images):
 * 1. dump FULL srcs (host included) of img.preview
 * 2. fetch() each with credentials → status
 * 3. Also test a live upload's host by uploading one image fresh (optional cheap probe).
 */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[fetchtest]', ...a);
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
    await page.locator('text=图文笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(4000);
    const probe = await page.evaluate(async () => {
        const imgs = Array.from(document.querySelectorAll('img.preview'));
        const out: { src: string; nw: number; fetch: number }[] = [];
        for (const i of imgs.slice(0, 3)) {
            const src = i.getAttribute('src') || '';
            let status = -1;
            try {
                const res = await fetch(src, { credentials: 'include' });
                status = res.status;
            } catch (_e) {
                status = -2;
            }
            out.push({ src: src, nw: i.naturalWidth, fetch: status });
        }
        const nocors = await fetch(imgs[0].getAttribute('src') || '', { credentials: 'include', mode: 'no-cors' })
            .then((r) => r.status)
            .catch(() => -2);
        (out as unknown as { nocors: number }).nocors = nocors;
        return out;
    });
    log('probe:', JSON.stringify(probe, null, 1));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
