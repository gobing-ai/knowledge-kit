/** Probe-only: dump both drafts' media state without mutating anything. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const OUT = '/tmp/xhs-repair';
const log = (...a: unknown[]) => console.log('[probe]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (p: import('playwright').Page, n: string) => {
    await p.screenshot({ path: `${OUT}/${n}.png` });
    log(`shot ${n}`);
};

async function clickLabel(page: import('playwright').Page, label: string) {
    const loc = page.locator(`text=${label}`).first();
    if ((await loc.count()) === 0) return false;
    await loc.click({ timeout: 5000 }).catch(() => {});
    return true;
}

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);

    // --- image draft ---
    await clickLabel(page, '草稿箱');
    await sleep(1500);
    await clickLabel(page, '图文笔记');
    await sleep(1200);
    await clickLabel(page, '编辑');
    await sleep(2500);
    await shot(page, 'probe-img-editor');
    const imgDump = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).map((i) => ({
            src: i.src.slice(0, 90),
            cls: String(i.className).slice(0, 50),
            w: i.naturalWidth,
            broken: i.complete && i.naturalWidth === 0,
        }));
        const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
            t: (b.textContent || '').trim().slice(0, 24),
            cls: String(b.className).slice(0, 40),
            disabled: (b as HTMLButtonElement).disabled,
        }));
        const bodyText = (document.body.textContent || '').replace(/\s+/g, ' ');
        const saveIdx = bodyText.search(/保存离开|暂存离开|存草稿|保存草稿/);
        return {
            imgs: imgs.slice(0, 24),
            buttons,
            saveHit: saveIdx >= 0 ? bodyText.slice(saveIdx - 30, saveIdx + 40) : null,
        };
    });
    log('IMG EDITOR imgs:', JSON.stringify(imgDump.imgs, null, 1));
    log('IMG EDITOR buttons:', JSON.stringify(imgDump.buttons));
    log('IMG EDITOR save-hit:', imgDump.saveHit);

    // --- podcast draft ---
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await clickLabel(page, '草稿箱');
    await sleep(1500);
    await clickLabel(page, '播客笔记');
    await sleep(1200);
    await clickLabel(page, '编辑');
    await sleep(3000);
    await shot(page, 'probe-pod-modal');
    const podDump = await page.evaluate(() => {
        const scope = document.querySelector('.d-modal') || document.body;
        const imgs = Array.from(scope.querySelectorAll('img')).map((i) => ({
            src: i.src.slice(0, 90),
            w: i.naturalWidth,
            broken: i.complete && i.naturalWidth === 0,
        }));
        const buttons = Array.from(scope.querySelectorAll('button')).map((b) => ({
            t: (b.textContent || '').trim().slice(0, 24),
            disabled: (b as HTMLButtonElement).disabled,
        }));
        const text = (scope.textContent || '').replace(/\s+/g, ' ');
        const audio = Array.from(scope.querySelectorAll('audio, [class*="audio"]')).map((a) =>
            String(a.className).slice(0, 40),
        );
        const collIdx = text.indexOf('播客合集');
        return {
            imgs: imgs.slice(0, 12),
            buttons,
            audio,
            collText: collIdx >= 0 ? text.slice(collIdx - 20, collIdx + 300) : null,
            text: text.slice(0, 400),
        };
    });
    log('POD imgs:', JSON.stringify(podDump.imgs, null, 1));
    log('POD buttons:', JSON.stringify(podDump.buttons));
    log('POD audio els:', JSON.stringify(podDump.audio));
    log('POD collection text:', podDump.collText);
    log('POD modal text:', podDump.text);
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
