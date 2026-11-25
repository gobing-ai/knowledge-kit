import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import { wrapPlaywrightPage } from '../src/page';
import { launchChromium } from './fixtures/wechatmp-cgi-runner';

// Failure-first: an older POST, unrelated GET/POST, HTTP failure, semantic refusal, malformed
// response, and unfinished response body must never acknowledge the explicit article save.
const finished = new Set<string>();
const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
        const url = new URL(request.url);
        const mode = url.searchParams.get('mode') ?? 'success';
        if (url.pathname === '/editor') {
            return new Response(
                `<button id="save">保存为草稿</button><script>
                const mode = ${JSON.stringify(mode)};
                document.querySelector('#save').onclick = () => {
                    fetch('/cgi-bin/operate_appmsg?sub=create&mode=get-only');
                    fetch('/cgi-bin/operate_appmsg?sub=unrelated&mode=unrelated', {
                        method:'POST', body:new URLSearchParams({count:'1',type:'77',title0:'fixture',content0:'<p>body</p>'})
                    });
                    if (mode !== 'get-only') setTimeout(() => fetch('/cgi-bin/operate_appmsg?sub=create&mode=' + mode, {
                        method:'POST', body:new URLSearchParams({count:'1',type:'77',title0:'fixture',content0:'<p>body</p>'})
                    }), 50);
                };
            </script>`,
                { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            );
        }
        if (mode === 'http-error') return new Response('failed', { status: 500 });
        if (mode === 'refused') return Response.json({ base_resp: { ret: 200013 } });
        if (mode === 'malformed') return new Response('token=SENTINEL-PRIVATE-ACK');
        const delay = ['success', 'receipt', 'string-zero', 'preclick', 'slow-headers'].includes(mode)
            ? 350
            : mode === 'old'
              ? 120
              : 0;
        const body =
            mode === 'receipt'
                ? '{"appMsgInfo":{"appMsgId":"12345"}}'
                : mode === 'string-zero'
                  ? '{"ret":"0","base_resp":{"ret":0},"appMsgId":"12345"}'
                  : '{"base_resp":{"ret":0}}';
        let cancelled = false;
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(body.slice(0, 3)));
                    setTimeout(() => {
                        if (cancelled || controller.desiredSize === null) return;
                        controller.enqueue(new TextEncoder().encode(body.slice(3)));
                        controller.close();
                        finished.add(mode);
                    }, delay);
                },
                cancel() {
                    cancelled = true;
                },
            }),
            { headers: { 'Content-Type': 'application/json' } },
        );
        return mode === 'slow-headers' ? Bun.sleep(200).then(() => response) : response;
    },
});
let browser: Browser;
beforeAll(async () => {
    browser = await launchChromium();
});
afterAll(async () => {
    await browser?.close();
    server.stop(true);
});

for (const mode of ['success', 'receipt', 'string-zero', 'slow-headers']) {
    test(`native save waits for the complete ${mode} response, ignoring old and unrelated requests`, async () => {
        const page = await browser.newPage();
        try {
            await page.goto(`${server.url}editor?mode=${mode}`);
            await page.evaluate(() => {
                void fetch('/cgi-bin/operate_appmsg?sub=create&mode=old', {
                    method: 'POST',
                    body: new URLSearchParams({ count: '1', type: '77', title0: 'fixture', content0: '<p>body</p>' }),
                });
            });
            const wrapped = wrapPlaywrightPage(page);
            if (!wrapped.saveDraftAndWait) throw new Error('Native save acknowledgement seam missing');
            await wrapped.saveDraftAndWait('#save', 3_000);
            expect(finished.has(mode)).toBe(true);
        } finally {
            await page.close();
        }
    });
}

test('an unrelated click and autosave cannot acknowledge the later explicit save', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(`${server.url}editor?mode=preclick`);
        await page.locator('#save').evaluate((button) => {
            (button as unknown as { disabled: boolean }).disabled = true;
        });
        const wrapped = wrapPlaywrightPage(page);
        if (!wrapped.saveDraftAndWait) throw new Error('Native save acknowledgement seam missing');
        const pending = wrapped.saveDraftAndWait('button:has-text("保存为草稿")', 3_000);
        await page.waitForTimeout(100);
        await page.evaluate('document.body.click()');
        await page.evaluate(() => {
            void fetch('/cgi-bin/operate_appmsg?sub=create&mode=old', {
                method: 'POST',
                body: new URLSearchParams({ count: '1', type: '77', title0: 'fixture', content0: '<p>body</p>' }),
            });
        });
        await page.waitForTimeout(200);
        await page.locator('#save').evaluate((button) => {
            (button as unknown as { disabled: boolean }).disabled = false;
        });
        await pending;
        expect(finished.has('preclick')).toBe(true);
    } finally {
        await page.close();
    }
});

for (const mode of ['http-error', 'refused', 'malformed', 'get-only']) {
    test(`native save refuses ${mode} without exposing response credentials`, async () => {
        const page = await browser.newPage();
        try {
            await page.goto(`${server.url}editor?mode=${mode}`);
            const wrapped = wrapPlaywrightPage(page);
            if (!wrapped.saveDraftAndWait) throw new Error('Native save acknowledgement seam missing');
            let error = '';
            try {
                await wrapped.saveDraftAndWait('#save', 700);
            } catch (caught) {
                error = String(caught);
            }
            expect(error).not.toBe('');
            expect(error).not.toContain('SENTINEL-PRIVATE-ACK');
            expect(page.url()).toContain('/editor');
        } finally {
            await page.close();
        }
    });
}
