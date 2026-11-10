/** Probe-only diagnosis: why do draft images not render? DOM + CDN error body + server draft API. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const OUT = '/tmp/xhs-repair';
const log = (...a: unknown[]) => console.log('[probe4]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clickLabel = async (page: import('playwright').Page, label: string) => {
    const loc = page.locator(`text=${label}`).first();
    if ((await loc.count()) === 0) return false;
    await loc.click({ timeout: 5000 }).catch(() => {});
    return true;
};

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
const dumpImgs = () =>
    page.evaluate(() =>
        Array.from(document.querySelectorAll('img'))
            .filter((i) => /xhscdn|xiaohongshu|spectrum|sns-img|sns-webpic/.test(i.src) || i.naturalWidth === 0)
            .map((i) => ({
                src: i.src,
                cls: String(i.className).slice(0, 40),
                w: i.naturalWidth,
                complete: i.complete,
            }))
            .slice(0, 12),
    );

try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);

    // --- draft LIST: cover thumbnails (a different render path than the editor) ---
    await clickLabel(page, '草稿箱');
    await sleep(2000);
    const listImgs = await dumpImgs();
    log('LIST imgs:', JSON.stringify(listImgs, null, 1));
    await page.screenshot({ path: `${OUT}/probe4-list.png` });

    // fetch one list thumbnail from the browser context (status + body tell WHY it fails)
    for (const [i, im] of listImgs.slice(0, 2).entries()) {
        const res = await context.request.get(im.src).catch((e) => ({ error: String(e) }));
        if ('error' in res) log(`LIST thumb[${i}] fetch-error:`, res.error);
        else {
            const body = (await res.text().catch(() => '')).slice(0, 400);
            log(`LIST thumb[${i}] status=${res.status()} body:`, body);
        }
    }

    // --- image draft editor ---
    await clickLabel(page, '图文笔记');
    await sleep(1200);
    await clickLabel(page, '编辑');
    await sleep(2500);
    const editImgs = await dumpImgs();
    log('IMG-EDITOR imgs:', JSON.stringify(editImgs, null, 1));
    // XHRs the edit page made = the server-side draft-detail endpoint
    const apis = await page.evaluate(() =>
        performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .filter((u) => /web_api|api\/sns|note/.test(u))
            .slice(-12),
    );
    log('IMG-EDITOR api calls:', JSON.stringify(apis, null, 1));
    for (const [i, im] of editImgs.slice(0, 3).entries()) {
        const res = await context.request.get(im.src).catch((e) => ({ error: String(e) }));
        if ('error' in res) log(`EDIT img[${i}] fetch-error:`, res.error);
        else {
            const body = (await res.text().catch(() => '')).slice(0, 500);
            log(`EDIT img[${i}] status=${res.status()} body:`, body);
        }
    }

    // --- podcast draft editor ---
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
    const podImgs = await dumpImgs();
    log('POD imgs:', JSON.stringify(podImgs, null, 1));
    for (const [i, im] of podImgs.slice(0, 2).entries()) {
        const res = await context.request.get(im.src).catch((e) => ({ error: String(e) }));
        if ('error' in res) log(`POD img[${i}] fetch-error:`, res.error);
        else {
            const body = (await res.text().catch(() => '')).slice(0, 500);
            log(`POD img[${i}] status=${res.status()} body:`, body);
        }
    }
    const podApis = await page.evaluate(() =>
        performance
            .getEntriesByType('resource')
            .map((r) => r.name)
            .filter((u) => /web_api|api\/sns|note/.test(u))
            .slice(-12),
    );
    log('POD api calls:', JSON.stringify(podApis, null, 1));
    await page.screenshot({ path: `${OUT}/probe4-pod.png` });
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
