/** Probe-only: capture the encryption-API signed URL + the browser's own image failure code. */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[probe5]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clickLabel = async (page: import('playwright').Page, label: string) => {
    const loc = page.locator(`text=${label}`).first();
    if ((await loc.count()) === 0) return false;
    await loc.click({ timeout: 5000 }).catch(() => {});
    return true;
};

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
const encResponses: Array<{ url: string; status: number; body: string }> = [];
const failed: Array<{ url: string; err: string }> = [];

page.on('response', (r) => {
    if (r.url().includes('file/encryption')) {
        encResponses.push({ url: r.url(), status: r.status(), body: '' });
        r.text()
            .then((t) => {
                encResponses[encResponses.length - 1] = { url: r.url(), status: r.status(), body: t.slice(0, 600) };
            })
            .catch(() => {});
    }
});
page.on('requestfailed', (r) => {
    if (r.url().includes('spectrum')) failed.push({ url: r.url(), err: r.failure()?.errorText ?? '?' });
});

try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await clickLabel(page, '草稿箱');
    await sleep(1500);
    await clickLabel(page, '图文笔记');
    await sleep(1200);
    await clickLabel(page, '编辑');
    await sleep(4000);

    log('encryption API responses:', JSON.stringify(encResponses, null, 1));
    log('spectrum img failures (chrome-side):', JSON.stringify(failed, null, 1));

    // node-side fetch of the freshest signed URL, no redirect follow, headers visible
    const signed = encResponses.find((r) => r.body.includes('url'))?.body ?? '';
    const m = /"url"\s*:\s*"(https:[^"]+)"/.exec(signed) ?? /"(https:\/\/sns-creator-preview[^"]+)"/.exec(signed);
    if (m) {
        const url = m[1].replace(/\\u002F/g, '/');
        log('signed url:', url);
        const res = await fetch(url, { redirect: 'manual' });
        log(
            'node fetch status:',
            res.status,
            'location:',
            res.headers.get('location'),
            'server:',
            res.headers.get('server'),
        );
        const b = await res.text().catch(() => '');
        log('node fetch body head:', b.slice(0, 300));
        const res2 = await fetch(url);
        log('node fetch (follow) status:', res2.status, 'final-url:', res2.url);
        log('node fetch (follow) body head:', (await res2.text().catch(() => '')).slice(0, 300));
    } else {
        log('no signed url found in encryption response body');
    }

    // DNS: what does this host resolve to locally?
    const dns = await Array.fromAsync(await import('node:dns').then((d) => d.promises));
    void dns;
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
