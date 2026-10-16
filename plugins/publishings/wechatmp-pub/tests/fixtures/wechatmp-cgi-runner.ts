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
import { WechatCgiDraftError } from '../../src/cgi-draft';
import type { WechatArticleMedia, WechatArticleMediaInput } from '../../src/cgi-media';
import { prepareArticleMedia, WechatMediaError } from '../../src/cgi-media';
import { type WechatPage, wrapPlaywrightPage } from '../../src/page';

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

/** Draft-create endpoints (task 0290): the operate_appmsg multipart POST and its list-ex readback. */
export const CREATE_ENDPOINT = '/cgi-bin/operate_appmsg';
export const APPMSG_ENDPOINT = '/cgi-bin/appmsg';

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
export type MockResponse = { json: unknown } | { status: number; body?: string } | { bytes: number } | { abort: true };

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
        // latin1 keeps byte fidelity for the split; values re-decode as the UTF-8 the page sent.
        else fields[name] = Buffer.from(part.slice(headerEnd + 4, part.length - 2), 'latin1').toString('utf8');
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
    // Extra endpoints (e.g. the draft create/list pair) get their queues too, defaults first.
    for (const [path, responses] of Object.entries(prepend)) {
        if (!queues.has(path)) queues.set(path, [...responses]);
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
        if ('abort' in spec) {
            await route.abort();
            return;
        }
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

export interface CgiDraftFacts {
    observed: ObservedRequest[];
    /** What `run` returned — the extracted session or the created-draft handle. */
    outcome?: unknown;
    /** WechatCgiDraftError vocabulary, filled only when `run` threw one. */
    code?: string;
    stage?: string;
    metadata?: Record<string, unknown>;
    error?: string;
}

/**
 * One task-0290 CGI run against the route-mocked console: navigates the real origin (optionally
 * replacing the document for extraction fixtures), then hands the wrapped page to `run`. A thrown
 * WechatCgiDraftError comes back as code/stage/metadata facts; anything else as an error string.
 */
export async function runCgiDraftScenario(
    browser: Browser,
    opts: {
        create: MockResponse[];
        list: MockResponse[];
        url?: string;
        document?: string;
        run: (page: WechatPage) => Promise<unknown>;
    },
): Promise<CgiDraftFacts> {
    const fixture = await openConsoleFixture(browser, {
        [CREATE_ENDPOINT]: opts.create,
        [APPMSG_ENDPOINT]: opts.list,
    });
    try {
        const raw = await fixture.context.newPage();
        await raw.goto(opts.url ?? CONSOLE_URL);
        if (opts.document !== undefined) await raw.setContent(opts.document);
        try {
            return { observed: fixture.observed, outcome: await opts.run(wrapPlaywrightPage(raw)) };
        } catch (error) {
            return {
                observed: fixture.observed,
                code: error instanceof WechatCgiDraftError ? error.code : undefined,
                stage: error instanceof WechatCgiDraftError ? error.stage : undefined,
                metadata: error instanceof WechatCgiDraftError ? error.metadata : undefined,
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
