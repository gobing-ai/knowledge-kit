/** Probe 2: structure of image slots (delete controls) + podcast cover area + title inputs. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const _OUT = '/tmp/xhs-repair';
const log = (...a: unknown[]) => console.log('[probe2]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 5000 });
    await sleep(1500);
    await page.locator('text=图文笔记').first().click({ timeout: 5000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 5000 });
    await sleep(2500);
    // Find the container holding img.preview items; dump one item's HTML + the container's children structure.
    const dump = await page.evaluate(() => {
        const prev = document.querySelector('img.preview');
        if (!prev) return { found: false };
        // Climb to a reasonable item container.
        let item: HTMLElement = prev as HTMLElement;
        for (let i = 0; i < 4 && item.parentElement; i++) {
            const p = item.parentElement;
            if (
                (p.className || '').includes('item') ||
                (p.className || '').includes('img') ||
                p.querySelector('img.preview') !== prev
            ) {
                item = p;
                break;
            }
            item = p;
        }
        const container = item.parentElement;
        return {
            found: true,
            itemHtml: item.outerHTML.slice(0, 900),
            itemCount: container ? container.querySelectorAll('img.preview').length : -1,
            delWords: (document.body.textContent || '').match(/删除|移除|清空/g)?.slice(0, 12),
            titleInputs: Array.from(document.querySelectorAll('input[placeholder], textarea[placeholder]')).map(
                (i) => ({
                    ph: i.getAttribute('placeholder'),
                    tag: i.tagName,
                    val: (i as HTMLInputElement).value.slice(0, 40),
                }),
            ),
        };
    });
    log('IMG SLOT:', JSON.stringify(dump, null, 1));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
