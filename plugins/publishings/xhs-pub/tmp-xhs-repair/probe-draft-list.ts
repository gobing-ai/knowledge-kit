import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = await ctx.newPage();
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);
const nav = page.locator('text=草稿箱').first();
console.log('草稿箱 nav count:', await nav.count());
await nav.click({ timeout: 5000 }).catch((e) => console.log('click err:', e.message.slice(0, 50)));
await page.waitForTimeout(4000);
console.log('URL:', page.url());
const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 700));
console.log('BODY:', text);
await ctx.close();
