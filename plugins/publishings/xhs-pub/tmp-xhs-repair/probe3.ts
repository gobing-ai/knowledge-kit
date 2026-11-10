/** Probe 3: what is the stubborn last dead slot? Dump its container + grid position. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[probe3]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
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
    await sleep(3000);
    const dump = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img.preview'));
        const dead = imgs.filter((i) => i.naturalWidth === 0);
        const target = dead[0];
        if (!target) return { deadCount: 0 };
        let node: HTMLElement = target as HTMLElement;
        const chain: string[] = [];
        for (let i = 0; i < 6 && node; i++) {
            chain.push(`${node.tagName}.${String(node.className).slice(0, 50)} kids=${node.children.length}`);
            node = node.parentElement as HTMLElement;
        }
        const slot = target.closest('.format-img');
        const parent = slot?.parentElement;
        const siblings = parent
            ? Array.from(parent.children).map((c) => `${c.tagName}.${String(c.className).slice(0, 30)}`)
            : [];
        const r = (slot as HTMLElement).getBoundingClientRect();
        return {
            deadCount: dead.length,
            totalCount: imgs.length,
            chain,
            siblings: siblings.slice(0, 10),
            slotRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
            gridText: parent ? (parent.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : null,
        };
    });
    log(JSON.stringify(dump, null, 1));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
