import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = await ctx.newPage();
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));
for (const t of ['上传图文', '上传视频', '写长文', '扫码登录', '登录后即可发布', '发布']) {
    console.log(`${t}:`, await page.locator(`text=${t}`).count());
}
const nick = await page.evaluate(() => {
    const el = document.querySelector('.user-name, .avatar, [class*="userName"], [class*="nickname"]');
    return el ? (el.textContent || '').trim().slice(0, 30) : null;
});
console.log('user el:', nick);
await ctx.close();
