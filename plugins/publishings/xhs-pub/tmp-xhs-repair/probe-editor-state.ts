import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const ctx = await kkBrowserLauncher.launch({
    profileDir: '/Users/robin/.config/kk/browser-profiles/xhs',
    headless: false,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(9000);
const cands = page.locator('text=上传图文');
let clicked = false;
for (let i = 0; i < (await cands.count()); i++) {
    const b = await cands
        .nth(i)
        .boundingBox()
        .catch(() => null);
    if (b && b.x >= 0 && b.y >= 0 && b.x < 1440 && b.y < 900 && b.width > 0) {
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        clicked = true;
        break;
    }
}
console.log('clicked:', clicked);
await page.waitForTimeout(6000);
const pre = await page.evaluate(`(() => JSON.stringify({
    previews: document.querySelectorAll('img.preivew-image').length,
    bodyLen: (document.querySelector('.ProseMirror, .ql-editor, div.tiptap')?.textContent || '').trim().length,
}))()`);
console.log('PRE-ATTACH editor state:', pre);
// Clear the console's local editor state for this origin.
await page.evaluate(
    `(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} return 'cleared'; })()`,
);
console.log('storage cleared');
await ctx.close();
