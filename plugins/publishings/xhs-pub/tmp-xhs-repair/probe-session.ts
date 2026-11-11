import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = await ctx.newPage();
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));
const tab = await page.locator('text=上传图文').count();
const login = await page.locator('text=登录').count();
console.log('上传图文 tab:', tab, '| 登录 prompt:', login);
await page.screenshot({ path: '/tmp/xhs-session-check.png' });
await ctx.close();
