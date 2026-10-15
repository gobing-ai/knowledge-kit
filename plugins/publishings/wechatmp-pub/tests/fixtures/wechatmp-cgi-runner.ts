/**
 * Real-Chromium fixture runner for the private CGI media pipeline (task 0289 chunk 3), modeled on
 * publish-harness `browser-anti-detection-runner.ts` (task 0288): the PRODUCTION `prepareArticleMedia`
 * / `uploadCoverImage` / `uploadAndCropCover` run through `wrapPlaywrightPage` against a synthetic
 * authenticated console served by route interception ON the real https://mp.weixin.qq.com origin
 * (never a substitute origin), with the three CGI endpoints mocked by queued receipts. Every
 * endpoint request's query and multipart fields are observed (multipart parsed from the raw
 * post data — Playwright 1.55 has no request.formData()), and a catch-all route aborts all other
 * traffic, so the browser stays loopback-only with zero live provider calls.
 *
 * `chromium.launch` rejects when the browser is missing — an actionable environment failure,
 * never a silent skip.
 */
import type { Browser, BrowserContext, Route } from 'playwright';
import { chromium } from 'playwright';
import type { WechatCgiSession } from '../../src/cgi';
import { uploadAndCropCover, uploadCoverImage, WechatCgiError } from '../../src/cgi';
import type { WechatArticleMedia, WechatArticleMediaInput } from '../../src/cgi-media';
import { prepareArticleMedia, WechatMediaError } from '../../src/cgi-media';
import { wrapPlaywrightPage } from '../../src/page';

export const MP_ORIGIN = 'https://mp.weixin.qq.com';
export const CONSOLE_PATH = '/kk-fixture/console';
export const CONSOLE_URL = `${MP_ORIGIN}${CONSOLE_PATH}?token=302104224&lang=zh_CN`;
export const CONSOLE_HTML = '<!doctype html><html><body><div id="app">synthetic console</div></body></html>';
export const SESSION: WechatCgiSession = {
    token: '302104224',
    ticket: 'kk-fixture-ticket',
    userName: 'wxid_kk_fixture',
};

export const ENDPOINTS = {
    filetransfer: '/cgi-bin/filetransfer',
    cropimage: '/cgi-bin/cropimage',
    uploadimg2cdn: '/cgi-bin/uploadimg2cdn',
} as const;

/** Valid receipts whose FROZEN shapes the tests assert against; dims 1000x800 drive the crop math. */
export const FILETRANSFER_RECEIPT = {
    base_resp: { ret: 0, err_msg: 'ok' },
    content: '2233445566',
    cdn_url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/cover.png',
    width: 1000,
    height: 800,
};
export const BODY_RECEIPT = {
    base_resp: { ret: 0 },
    content: '7788',
    cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/body.png',
    width: 500,
    height: 400,
};
export const CROPIMAGE_RECEIPT = {
    base_resp: { ret: 0 },
    result: [
        { file_id: 'wide-1', cdnurl: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/wide.png' },
        { file_id: 'sq-1', cdnurl: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/square.png' },
    ],
};
export const UPLOADIMG2CDN_RECEIPT = {
    errcode: 0,
    file_id: 'cdn-9',
    url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png',
};

/** One observed CGI request: exact query and multipart keys/values as the page actually sent them. */
export interface ObservedRequest {
    path: string;
    query: Record<string, string>;
    fields: Record<string, string>;
    fileFields: string[];
    bodyBytes: number;
}

/** Queued endpoint answers; consumed FIFO, defaults refill behind any test-supplied overrides. */
export type MockResponse = { json: unknown } | { status: number; body?: string } | { bytes: number };

export interface PrepareFacts {
    requests: ObservedRequest[];
    result?: WechatArticleMedia;
    reason?: string;
    error?: string;
}

function reasonOf(error: unknown): string | undefined {
    return error instanceof WechatMediaError || error instanceof WechatCgiError ? error.reason : undefined;
}

export async function launchChromium(): Promise<Browser> {
    return chromium.launch({ headless: true, timeout: 20_000 });
}

/** Minimal multipart/form-data reader over the raw post body (byte-safe latin1 view). */
function parseMultipart(buffer: Buffer, contentType: string): { fields: Record<string, string>; fileFields: string[] } {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
    if (boundary === null) return { fields: {}, fileFields: [] };
    const fields: Record<string, string> = {};
    const fileFields: string[] = [];
    for (const part of buffer.toString('latin1').split(`--${boundary[1] ?? boundary[2]}`)) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headers = part.slice(0, headerEnd);
        const name = /name="([^"]*)"/i.exec(headers)?.[1];
        if (name === undefined) continue;
        if (/filename="/i.test(headers)) fileFields.push(name);
        else fields[name] = part.slice(headerEnd + 4, part.length - 2);
    }
    return { fields, fileFields };
}

async function observeRequest(route: Route): Promise<ObservedRequest> {
    const request = route.request();
    const url = new URL(request.url());
    const contentType = request.headers()['content-type'] ?? '';
    const { fields, fileFields } = parseMultipart(request.postDataBuffer() ?? Buffer.alloc(0), contentType);
    return {
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        fields,
        fileFields,
        bodyBytes: request.postDataBuffer()?.byteLength ?? 0,
    };
}

interface CgiFixture {
    readonly observed: ObservedRequest[];
    readonly context: BrowserContext;
    close(): Promise<void>;
}

/**
 * A context whose console navigation is fulfilled on the REAL mp origin and whose CGI endpoints
 * answer from FIFO queues (defaults first-class; `prepend` puts failing/stale receipts up front).
 */
async function openConsoleFixture(browser: Browser, prepend: Record<string, MockResponse[]> = {}): Promise<CgiFixture> {
    const defaults: Record<string, MockResponse[]> = {
        [ENDPOINTS.filetransfer]: [{ json: FILETRANSFER_RECEIPT }, { json: BODY_RECEIPT }],
        [ENDPOINTS.cropimage]: [{ json: CROPIMAGE_RECEIPT }],
        [ENDPOINTS.uploadimg2cdn]: [{ json: UPLOADIMG2CDN_RECEIPT }],
    };
    const queues = new Map<string, MockResponse[]>();
    for (const [path, responses] of Object.entries(defaults)) {
        queues.set(path, [...(prepend[path] ?? []), ...responses]);
    }
    const observed: ObservedRequest[] = [];
    const context = await browser.newContext();
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(20_000);
    // Registered first so the mp-origin handler below (later registrations win) shadows it.
    await context.route('**/*', (route) => route.abort());
    await context.route(`${MP_ORIGIN}/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.pathname === CONSOLE_PATH) {
            await route.fulfill({ contentType: 'text/html', body: CONSOLE_HTML });
            return;
        }
        const spec = queues.get(url.pathname)?.shift() ?? {
            status: 500,
            body: `fixture: no queued response for ${url.pathname}`,
        };
        observed.push(await observeRequest(route));
        if ('json' in spec) {
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(spec.json) });
        } else if ('bytes' in spec) {
            await route.fulfill({ contentType: 'application/json', body: 'x'.repeat(spec.bytes) });
        } else {
            await route.fulfill({ status: spec.status, contentType: 'application/json', body: spec.body ?? '' });
        }
    });
    return { observed, context, close: () => context.close() };
}

/** One full production media run against the route-mocked console, with observed request facts. */
export async function runPrepareScenario(
    browser: Browser,
    prepend: Record<string, MockResponse[]>,
    input: WechatArticleMediaInput,
): Promise<PrepareFacts> {
    const fixture = await openConsoleFixture(browser, prepend);
    try {
        const page = wrapPlaywrightPage(await fixture.context.newPage());
        await page.goto(CONSOLE_URL);
        try {
            return { requests: fixture.observed, result: await prepareArticleMedia(page, SESSION, input) };
        } catch (error) {
            return {
                requests: fixture.observed,
                reason: reasonOf(error),
                error: error instanceof Error ? error.message : String(error),
            };
        }
    } finally {
        await fixture.close();
    }
}

/** Deadline proof without a 180 s wait: only during the production call, the clock jumps +200 s. */
export async function runDeadlineScenario(browser: Browser, input: WechatArticleMediaInput): Promise<PrepareFacts> {
    const fixture = await openConsoleFixture(browser, {});
    try {
        const page = wrapPlaywrightPage(await fixture.context.newPage());
        await page.goto(CONSOLE_URL);
        const real = Date.now;
        let reads = 0;
        Date.now = () => (reads++ === 0 ? real.call(Date) : real.call(Date) + 200_000);
        try {
            return { requests: fixture.observed, result: await prepareArticleMedia(page, SESSION, input) };
        } catch (error) {
            return {
                requests: fixture.observed,
                reason: reasonOf(error),
                error: error instanceof Error ? error.message : String(error),
            };
        } finally {
            Date.now = real;
        }
    } finally {
        await fixture.close();
    }
}

/** Foreign loopback origin: every credentialed entry point must refuse before any dispatch. */
export async function runForeignOriginScenario(browser: Browser): Promise<{ reasons: string[] }> {
    const context = await browser.newContext();
    context.setDefaultTimeout(20_000);
    context.setDefaultNavigationTimeout(20_000);
    try {
        await context.route('**/*', (route) => route.abort());
        await context.route('http://127.0.0.1/**', (route) =>
            route.fulfill({ contentType: 'text/html', body: CONSOLE_HTML }),
        );
        const page = wrapPlaywrightPage(await context.newPage());
        await page.goto('http://127.0.0.1/kk-fixture/console');
        const reasons: string[] = [];
        for (const run of [
            () =>
                prepareArticleMedia(page, SESSION, {
                    html: '<p>x</p>',
                    coverPath: 'cover.png',
                    localImages: {},
                }),
            () => uploadCoverImage(page, SESSION, { bytes: new Uint8Array([1, 2, 3]), name: 'a.png' }),
            () => uploadAndCropCover(page, SESSION, { bytes: new Uint8Array([1, 2, 3]), name: 'a.png' }),
        ]) {
            try {
                await run();
                reasons.push('no-error');
            } catch (error) {
                reasons.push(reasonOf(error) ?? (error instanceof Error ? error.message : String(error)));
            }
        }
        return { reasons };
    } finally {
        await context.close();
    }
}
