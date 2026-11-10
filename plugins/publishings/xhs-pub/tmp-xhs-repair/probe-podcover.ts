/** probe-podcover.ts — what's around the podcast cover slot? Hover + click behavior. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[ppc]', ...a);
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

    // Container chain around the cover img.
    const chain = await page.evaluate(() => {
        const img = document.querySelector('img.preview, img.preivew-image');
        if (!img) return 'no img';
        const out: string[] = [];
        let el: Element | null = img;
        for (let d = 0; d < 5 && el; d++) {
            out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}">`);
            el = el.parentElement;
        }
        // Also dump any text-bearing controls inside the top container
        const top = img.parentElement?.parentElement?.parentElement;
        if (top) {
            const ctrls = Array.from(top.querySelectorAll('*'))
                .filter((c) => {
                    const t = (c.textContent || '').trim();
                    return t.length > 0 && t.length < 20 && c.children.length === 0;
                })
                .map((c) => `${c.tagName}.${String(c.className).slice(0, 30)}:"${(c.textContent || '').trim()}"`);
            out.push(`controls: ${JSON.stringify(ctrls.slice(0, 15))}`);
        }
        return out.join('\n');
    });
    log(`cover chain:\n${chain}`);

    // Hover, then dump overlays that appear.
    const box = await page.evaluate(() => {
        const img = document.querySelector('img.preview, img.preivew-image') as HTMLElement | null;
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (box) {
        await page.mouse.move(box.x, box.y);
        await sleep(1200);
        const overlay = await page.evaluate(() => {
            const img = document.querySelector('img.preview, img.preivew-image');
            const top = img?.parentElement?.parentElement?.parentElement;
            if (!top) return 'no top';
            const visible = Array.from(top.querySelectorAll('*'))
                .filter((c) => {
                    const r = c.getBoundingClientRect();
                    const t = (c.textContent || '').trim();
                    return r.width > 0 && r.height > 0 && t.length > 0 && t.length < 15;
                })
                .map(
                    (c) =>
                        `${c.tagName}.${String(c.className).slice(0, 35)}:"${(c.textContent || '').trim().slice(0, 15)}"`,
                );
            return JSON.stringify(visible.slice(0, 20));
        });
        log('after hover overlay:', overlay);
        // Click 编辑 and dump the editor modal.
        await page
            .locator('button.edit-btn')
            .first()
            .click({ timeout: 5000 })
            .catch(() => {});
        await sleep(3000);
        const modal = await page.evaluate(() => {
            const vis = (el: Element) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            };
            const inputs = Array.from(document.querySelectorAll('input[type="file"]')).map((i) => ({
                accept: i.accept,
                cls: String(i.className).slice(0, 40),
                vis: vis(i),
                display: getComputedStyle(i).display,
            }));
            const btns = Array.from(document.querySelectorAll('button, [class*="btn"], [class*="button"]'))
                .filter(vis)
                .map((b) => (b.textContent || '').trim())
                .filter((t) => t.length > 0 && t.length < 12);
            const texts = Array.from(document.querySelectorAll('*'))
                .filter(vis)
                .filter(
                    (el) =>
                        el.children.length === 0 &&
                        (el.textContent || '').trim().length > 0 &&
                        (el.textContent || '').trim().length < 15,
                )
                .map((el) => `${el.tagName}:"${(el.textContent || '').trim()}"`);
            return {
                fileInputs: inputs,
                buttons: Array.from(new Set(btns)).slice(0, 20),
                texts: Array.from(new Set(texts)).slice(0, 30),
            };
        });
        log('editor modal:', JSON.stringify(modal, null, 1));
    }
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
