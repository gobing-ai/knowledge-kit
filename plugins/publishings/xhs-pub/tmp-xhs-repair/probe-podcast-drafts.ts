import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = await ctx.newPage();
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);
await page
    .locator('text=发播客')
    .first()
    .click()
    .catch(() => {});
await page.waitForTimeout(4000);
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500));
console.log('BODY:', text);
await ctx.close();
