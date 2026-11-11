import { makeDefaultOpenPage } from '../src/index';

const openPage = makeDefaultOpenPage();
const { page, close } = await openPage('/Users/robin/.config/kk/browser-profiles/xhs');
await page.goto('https://creator.xiaohongshu.com/publish/publish', { timeout: 45000 });
await new Promise((r) => setTimeout(r, 9000));
const result = await page.evaluate(`(() => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    return 'cleared';
})()`);
console.log('editor state:', result);
await close();
