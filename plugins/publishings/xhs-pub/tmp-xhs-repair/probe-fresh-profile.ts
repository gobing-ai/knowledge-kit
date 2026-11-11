import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = await ctx.newPage();
await page
    .goto('https://www.baidu.com', { timeout: 20000 })
    .catch((e) => console.log('goto err:', e.message.slice(0, 60)));
console.log('title:', await page.title());
await ctx.close();
console.log('closed ok');
