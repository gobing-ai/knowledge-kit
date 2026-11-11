import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const responses: string[] = [];
ctx.on('response', (r: { status(): number; url(): string }) => {
    if (/ros-upload\.xiaohongshu\.com\/spectrum\//.test(r.url()) && r.status() === 200)
        responses.push(r.url().slice(0, 60));
});
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(9000);
const candidates = page.locator('text=上传图文');
const total = await candidates.count();
for (let i = 0; i < total; i += 1) {
    const box = await candidates
        .nth(i)
        .boundingBox()
        .catch(() => null);
    if (box && box.x >= 0 && box.y >= 0 && box.x < 1440 && box.y < 900 && box.width > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        console.log(`clicked candidate ${i} at ${box.x + box.width / 2},${box.y + box.height / 2}`);
        break;
    }
}
await page.waitForTimeout(3000);
const inputs =
    await page.evaluate(`(() => JSON.stringify(Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => ({
    i,
    accept: el.getAttribute('accept'),
    cls: el.className,
    visible: !!(el.offsetWidth || el.offsetHeight),
    parentHidden: el.closest('[style*="display: none"], [style*="display:none"]') !== null,
}))))()`);
console.log('inputs:', inputs);
const images = [
    '25-xhs/cards/card-01-xhs-card-01.png',
    '25-xhs/cards/card-02-xhs-card-01.png',
    '25-xhs/cards/card-03-xhs-card-01.png',
].map((p) => `/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/${p}`);
await page.locator('input[type="file"]').first().setInputFiles(images);
for (const s of [10, 20]) {
    await page.waitForTimeout(10000);
    console.log(`t+${s}s spectrum: ${responses.length}`, responses.slice(0, 3));
    const thumbs = await page.evaluate(`(() => JSON.stringify({
        previews: document.querySelectorAll('img.preivew-image').length,
        srcs: Array.from(document.querySelectorAll('img.preivew-image')).map((el) => (el.getAttribute('src') || '').slice(0, 24)),
    }))()`);
    console.log(`t+${s}s thumbs: ${thumbs}`);
}
await ctx.close();
