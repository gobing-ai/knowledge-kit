/** Probe-only: where does the durable image URL live after the console uploads? No save, no publish. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const IMAGES = [
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-01-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-02-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-03-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-04-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-05-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/25-xhs/cards/card-06-xhs-card-01.png',
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/23-cover/20261110_07_cover_cover.png',
];
const log = (...a: unknown[]) => console.log('[probe]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
const uploads: { url: string; status: number; body: string }[] = [];
page.on('response', (res) => {
    const url = res.url();
    if (/upload|image|media|sns-img|xhscdn/.test(url) && !/\.(png|jpg|webp)$/.test(url.split('?')[0])) {
        res.text().then(
            (t) => uploads.push({ url: url.slice(0, 120), status: res.status(), body: t.slice(0, 300) }),
            () => uploads.push({ url: url.slice(0, 120), status: res.status(), body: '<binary>' }),
        );
    }
});

try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await page.waitForTimeout(9000);
    const candidates = page.locator('text=上传图文');
    const total = await candidates.count();
    let clicked = false;
    for (let i = 0; i < total; i += 1) {
        const box = await candidates
            .nth(i)
            .boundingBox()
            .catch(() => null);
        if (box && box.x >= 0 && box.y >= 0 && box.x < 1440 && box.y < 900 && box.width > 0) {
            // Locator clicks hang on this console (overlaid clones) — aim a raw mouse click at the box center.
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            clicked = true;
            break;
        }
    }
    if (!clicked) {
        const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300));
        throw new Error(`no in-viewport 上传图文 tab of ${total}; body: ${text}`);
    }
    await sleep(1500);

    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(IMAGES);
    log('images attached; polling thumbnails for 75s');

    for (const tick of [5, 15, 30, 45, 60, 75]) {
        await sleep(tick === 5 ? 5000 : 10000);
        const dump = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img.preivew-image, .img-preview img'));
            return imgs.map((i) => ({
                src: (i.getAttribute('src') || '').slice(0, 80),
                attrs: Object.fromEntries(Array.from(i.attributes).map((a) => [a.name, a.value.slice(0, 80)])),
            }));
        });
        log(`t+${tick}s thumbnails:`, JSON.stringify(dump));
        if (dump.length > 0 && dump.every((d) => /^https?:/.test(d.src))) {
            log('ALL DURABLE — srcs swapped as the flow expects');
            break;
        }
    }

    log('--- network responses matching upload/image/media ---');
    for (const u of uploads.slice(-12)) log(u.status, u.url, '→', u.body.replace(/\s+/g, ' ').slice(0, 200));
} finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
}
