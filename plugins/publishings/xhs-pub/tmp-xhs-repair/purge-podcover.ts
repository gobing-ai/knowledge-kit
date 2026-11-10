/** purge-podcover.ts — delete the old dead cover slot (src contains aZCq), keep the new one. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const DEAD = 'aZCq5KUBJC3n';
const log = (...a: unknown[]) => console.log('[purgepod]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = ((await context.pages()[0]) ?? (await context.newPage())) as import('playwright').Page;
const slots = () =>
    page.evaluate(() =>
        Array.from(document.querySelectorAll('img.preview, img.preivew-image')).map((i) => ({
            src: (i.getAttribute('src') || '').slice(0, 50),
            nw: i.naturalWidth,
        })),
    );

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
    log('slots on open:', JSON.stringify(await slots()));

    // Hover the dead slot and dump its overlay controls.
    const deadBox = await page.evaluate((dead) => {
        const imgs = Array.from(document.querySelectorAll('img.preview')) as HTMLImageElement[];
        const target = imgs.find((i) => (i.getAttribute('src') || '').includes(dead));
        if (!target) return null;
        const r = target.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, DEAD);
    if (!deadBox) {
        log('no dead slot found — nothing to purge');
    } else {
        await page.mouse.move(deadBox.x, deadBox.y);
        await sleep(1200);
        const overlay = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img.preview')) as HTMLImageElement[];
            return JSON.stringify(
                imgs.map((i) => {
                    const cont = i.closest('.img-container') || i.parentElement;
                    const ctrls = cont
                        ? Array.from(cont.querySelectorAll('*'))
                              .filter((c) => {
                                  const t = (c.textContent || '').trim();
                                  const r = c.getBoundingClientRect();
                                  return t.length > 0 && t.length < 12 && r.width > 0;
                              })
                              .map(
                                  (c) =>
                                      `${c.tagName}.${String(c.className).slice(0, 40)}:"${(c.textContent || '').trim()}"`,
                              )
                        : [];
                    return { src: (i.getAttribute('src') || '').slice(24, 40), ctrls: ctrls.slice(0, 8) };
                }),
            );
        });
        log('overlay per slot:', overlay);

        // Click a delete-like control inside the dead slot's container.
        const clicked = await page.evaluate((dead) => {
            const imgs = Array.from(document.querySelectorAll('img.preview')) as HTMLImageElement[];
            const target = imgs.find((i) => (i.getAttribute('src') || '').includes(dead));
            const cont = target?.closest('.img-container') || target?.parentElement;
            if (!cont) return 'no container';
            const del = Array.from(cont.querySelectorAll('*')).find((c) => {
                const cls = String(c.className);
                const t = (c.textContent || '').trim();
                return /close-btn|del|delete|remove|shanchu/i.test(cls) || /^(删除|×|✕)$/.test(t);
            });
            if (!del) return 'no delete control';
            const r = del.getBoundingClientRect();
            return JSON.stringify({
                ctrl: `${del.tagName}.${String(del.className).slice(0, 30)}`,
                x: Math.round(r.x + r.width / 2),
                y: Math.round(r.y + r.height / 2),
            });
        }, DEAD);
        log('delete control probe:', clicked);
        if (clicked.startsWith('{')) {
            const { x, y } = JSON.parse(clicked) as { x: number; y: number };
            await page.mouse.move(x - 6, y + 6);
            await sleep(300);
            await page.mouse.move(x, y);
            await sleep(200);
            await page.mouse.click(x, y);
            log('clicked delete at', x, y);
            await sleep(2000);
            log('slots after delete:', JSON.stringify(await slots()));
        }
    }

    // Save via closed-shadow method.
    const saveMsg = await page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        for (const el of hosts) {
            for (const name of ['_onSave', '_onSaveDraft', '_onDraft']) {
                const fn = (el as unknown as Record<string, unknown>)[name];
                if (typeof fn === 'function') {
                    (fn as () => void).call(el);
                    return `called ${name}`;
                }
            }
        }
        return 'no save method';
    });
    log('save:', saveMsg);
    await sleep(3000);

    // Reopen + verify.
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
    const final = await slots();
    log('slots on reopen:', JSON.stringify(final));
    const old = final.filter((s) => s.src.includes(DEAD.slice(0, 24)));
    log('RESULT', JSON.stringify({ slotCount: final.length, oldGone: old.length === 0 }));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
