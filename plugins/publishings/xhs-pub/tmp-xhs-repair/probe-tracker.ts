import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import { wrapPlaywrightPage } from '../src/page';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const raw = ctx.pages()[0] ?? (await ctx.newPage());
const page = wrapPlaywrightPage(raw, undefined);
let count = 0;
page.on?.('response', (payload) => {
    const r = payload as { status(): number; url(): string };
    if (/ros-upload\.xiaohongshu\.com\/spectrum\//.test(r.url())) {
        count += 1;
        console.log(`[tracker] spectrum 200 #${count}:`, r.url().slice(0, 80));
    } else {
        console.log('[tracker] other:', r.url().slice(0, 60));
    }
});
await page.goto('https://creator.xiaohongshu.com/publish/publish', { timeout: 30000 });
await page.waitForTimeout(9000);
const images = [
    '25-xhs/cards/card-01-xhs-card-01.png',
    '25-xhs/cards/card-02-xhs-card-01.png',
    '25-xhs/cards/card-03-xhs-card-01.png',
    '25-xhs/cards/card-04-xhs-card-01.png',
    '25-xhs/cards/card-05-xhs-card-01.png',
    '25-xhs/cards/card-06-xhs-card-01.png',
    '23-cover/20261110_07_cover_cover.png',
].map((p) => `/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261110/${p}`);
const _sel = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
console.log('[tracker] input attached');
await page.setInputFiles('input[type="file"]', images);
for (const s of [5, 15, 30, 45]) {
    await page.waitForTimeout(10000);
    console.log(`[tracker] t+${s}s spectrum count = ${count}`);
}
await ctx.close();
