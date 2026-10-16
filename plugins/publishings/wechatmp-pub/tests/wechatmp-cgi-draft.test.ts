/**
 * Task 0290 chunk C — behavior tests for the same-origin CGI draft path (`src/cgi-draft.ts`) and
 * its `runMode` wiring (`src/flow.ts`), layered like 0289's media tests:
 *
 * 1. pure units — the eligibility gate and the frozen create payload (no browser at all);
 * 2. real-Chromium fixtures through `fixtures/wechatmp-cgi-runner.ts` — session extraction with
 *    inline-script documents, and the create POST + list readback against route-mocked receipts
 *    on the real https://mp.weixin.qq.com origin (a missing Chromium fails loud, never skips);
 * 3. `runMode` integration on the offline fake-page seam — which branch wins (CGI vs DOM editor),
 *    the ambiguous-submission guarantees, and the media-preparation stage.
 *
 * Every assertion is behavior, never implementation: receipts, requests the page actually sent,
 * error vocabulary and secret-freedom of user-visible strings.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import type { Browser } from 'playwright';
import {
    assertEligibleCgiDraft,
    buildCreateArticlePayload,
    createWechatArticleDraft,
    extractWechatCgiSession,
    WechatCgiDraftError,
} from '../src/cgi-draft';
import type { WechatArticleMedia } from '../src/cgi-media';
import { type ModeRunDeps, runMode } from '../src/flow';
import { validateModeInput } from '../src/modes';
import type { WechatPage } from '../src/page';
import {
    APPMSG_ENDPOINT,
    CONSOLE_PATH,
    CREATE_ENDPOINT,
    CROPIMAGE_RECEIPT,
    FILETRANSFER_RECEIPT,
    launchChromium,
    type MockResponse,
    MP_ORIGIN,
    runCgiDraftScenario,
    SESSION,
} from './fixtures/wechatmp-cgi-runner';

const tmpRoot = join(process.cwd(), '.tmp-test-wechat-cgi-draft');
/** The cover artifact the integration tests read off disk (validated like a real run). */
const tmpCover = join(tmpRoot, 'cover.png');

/** The cover pair a 0289 uploadAndCropCover run returns, with ACTUAL crop coordinates. */
const CREATE_MEDIA: WechatArticleMedia = {
    html: '<p>kk 草稿正文</p>',
    cover: {
        wide: {
            fileId: 'wide-1',
            url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/wide.png',
            width: 1000,
            height: 426,
        },
        square: {
            fileId: 'sq-1',
            url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/square.png',
            width: 800,
            height: 800,
        },
        crops: [
            { x1: 10, y1: 20, x2: 1188, y2: 735 },
            { x1: 10, y1: 20, x2: 610, y2: 610 },
        ],
    },
    images: [],
};

beforeAll(async () => {
    await mkdir(tmpRoot, { recursive: true });
    await writeFile(tmpCover, 'png');
});

afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

const CREATE_TITLE = 'kk CGI 草稿标题';

function cgiContent(metadata: Record<string, unknown> = {}): Content {
    return { title: CREATE_TITLE, body: '正文', format: 'markdown', metadata };
}

/** Captures a WechatCgiDraftError instead of throwing, so refusals are asserted per field. */
function captureDraft(run: () => unknown): WechatCgiDraftError | undefined {
    try {
        run();
        return undefined;
    } catch (error) {
        return error instanceof WechatCgiDraftError ? error : undefined;
    }
}

// ---------------------------------------------------------------------------
// Pure: the eligibility gate
// ---------------------------------------------------------------------------

describe('CGI draft eligibility gate (pure)', () => {
    test('a plain 文章 draft with absent publishStatus is eligible', () => {
        expect(() => assertEligibleCgiDraft(cgiContent({ digest: '摘要', author: 'kk' }))).not.toThrow();
    });

    test('an explicit publishStatus draft is eligible too', () => {
        expect(() => assertEligibleCgiDraft(cgiContent({ publishStatus: 'draft' }))).not.toThrow();
    });

    test('publishStatus public refuses with code ineligible', () => {
        const caught = captureDraft(() => assertEligibleCgiDraft(cgiContent({ publishStatus: 'public' })));
        expect(caught?.code).toBe('ineligible');
        expect(caught?.stage).toBe('eligibility');
    });

    test('advanced or unknown metadata keys refuse so the DOM flow keeps the article', () => {
        for (const key of ['wechatmp', 'layout', 'settings', 'original', 'reward', 'source-collection-style']) {
            const caught = captureDraft(() => assertEligibleCgiDraft(cgiContent({ [key]: {} })));
            expect(caught?.code, `metadata key ${key}`).toBe('ineligible');
        }
    });

    test('a non-string digest or author refuses as ineligible', () => {
        for (const [key, value] of [
            ['digest', 12],
            ['author', true],
        ] as const) {
            const caught = captureDraft(() => assertEligibleCgiDraft(cgiContent({ [key]: value })));
            expect(caught?.code, `metadata key ${key}`).toBe('ineligible');
        }
    });

    test('an empty title or body refuses as ineligible', () => {
        expect(captureDraft(() => assertEligibleCgiDraft({ ...cgiContent(), title: '' }))?.code).toBe('ineligible');
        expect(captureDraft(() => assertEligibleCgiDraft({ ...cgiContent(), body: '' }))?.code).toBe('ineligible');
    });
});

// ---------------------------------------------------------------------------
// Pure: the frozen create payload
// ---------------------------------------------------------------------------

describe('create payload builder (pure)', () => {
    /** The frozen baseline from the recovered createArticleDraft — sorted for set equality. */
    const FROZEN_FIELD_KEYS = [
        'AppMsgId',
        'ajax',
        'author0',
        'auto_gen_digest0',
        'cdn_1_1_url0',
        'cdn_235_1_url0',
        'cdn_url0',
        'cdn_url_back0',
        'compose_info0',
        'content0',
        'count',
        'crop_list0',
        'categories_list0',
        'data_seq',
        'digest0',
        'f',
        'isnew',
        'lang',
        'operate_from',
        'random',
        'share_imageinfo0',
        'share_page_type0',
        'sourceurl0',
        'title0',
        'token',
        'type',
    ];

    const payload = () =>
        buildCreateArticlePayload(SESSION, cgiContent({ digest: '摘要', author: 'kk' }), CREATE_MEDIA, {
            random: '0123456789abcdef',
        });

    test('the field set is exactly the frozen baseline — no more, no fewer', () => {
        expect(Object.keys(payload().fields).sort()).toEqual([...FROZEN_FIELD_KEYS].sort());
    });

    test('baseline scalars, plain content fields and cover urls are frozen', () => {
        const fields = payload().fields; // scalars only — crops round-trip in their own test
        expect(fields.token).toBe(SESSION.token);
        expect(fields.lang).toBe('zh_CN');
        expect(fields.f).toBe('json');
        expect(fields.ajax).toBe('1');
        expect(fields.random).toBe('0123456789abcdef');
        expect(fields.AppMsgId).toBe('');
        expect(fields.count).toBe('1');
        expect(fields.data_seq).toBe('0');
        expect(fields.operate_from).toBe('Chrome');
        expect(fields.isnew).toBe('0');
        expect(fields.type).toBe('77');
        expect(fields.title0).toBe(CREATE_TITLE);
        expect(fields.author0).toBe('kk');
        expect(fields.digest0).toBe('摘要');
        expect(fields.auto_gen_digest0).toBe('0');
        expect(fields.content0).toBe(CREATE_MEDIA.html);
        expect(fields.sourceurl0).toBe('');
        expect(fields.cdn_url0).toBe(CREATE_MEDIA.cover.wide.url);
        expect(fields.cdn_235_1_url0).toBe(CREATE_MEDIA.cover.wide.url);
        expect(fields.cdn_url_back0).toBe(CREATE_MEDIA.cover.wide.url);
        expect(fields.cdn_1_1_url0).toBe(CREATE_MEDIA.cover.square.url);
        expect(fields.share_page_type0).toBe('0');
        expect(fields.share_imageinfo0).toBe('{"list":[]}');
        expect(fields.categories_list0).toBe('[]');
        expect(fields.compose_info0).toBe('{"list":""}');
    });

    test('crop_list0 round-trips to the actual CoverPair.crops coordinates', () => {
        expect(JSON.parse(payload().fields.crop_list0 ?? '[]')).toEqual([
            { x1: 10, y1: 20, x2: 1188, y2: 735 },
            { x1: 10, y1: 20, x2: 610, y2: 610 },
        ]);
    });
    test('an omitted digest or author lands as an empty string', () => {
        const bare = buildCreateArticlePayload(SESSION, cgiContent(), CREATE_MEDIA, { random: 'f'.repeat(16) });
        expect(bare.fields.digest0).toBe('');
        expect(bare.fields.author0).toBe('');
    });
    test('the create url carries the token, lang=zh_CN and type=77 under the operate_appmsg subpath', () => {
        const url = new URL(payload().url);
        expect(url.origin).toBe(MP_ORIGIN);
        expect(url.pathname).toBe(CREATE_ENDPOINT);
        expect(url.searchParams.get('t')).toBe('ajax-response');
        expect(url.searchParams.get('sub')).toBe('create');
        expect(url.searchParams.get('type')).toBe('77');
        expect(url.searchParams.get('token')).toBe(SESSION.token);
        expect(url.searchParams.get('lang')).toBe('zh_CN');
    });

    test('an omitted random is generated as 16 hex chars', () => {
        const generated = buildCreateArticlePayload(SESSION, cgiContent(), CREATE_MEDIA);
        expect(generated.fields.random).toMatch(/^[0-9a-f]{16}$/);
    });
});

// ---------------------------------------------------------------------------
// Real Chromium: session extraction and the create (route-mocked mp origin)
// ---------------------------------------------------------------------------

describe('CGI draft browser fixtures (real Chromium, route-mocked mp origin)', () => {
    let browser: Browser;
    beforeAll(async () => {
        // A missing Chromium rejects here — an actionable environment failure, never a silent skip.
        browser = await launchChromium();
    });
    afterAll(async () => {
        await browser.close();
    });

    describe('R1 session extraction', () => {
        const PLANTED_TOKEN = '777000111';
        const PLANTED_TICKET = 'kkfixtureticket01';
        const PLANTED_USER = 'gh_kkfixture';
        /** Inline fields WITHOUT a token — the fallback vocabulary the page script reads. */
        const SIDE_FIELDS = `var ticket='${PLANTED_TICKET}';var user_name='${PLANTED_USER}';`;

        test('a valid URL token wins over the inline-script token; the other fields come from the page', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                document: `<script>var token='88888888';${SIDE_FIELDS}var uin='424242';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.outcome).toEqual({
                token: '302104224',
                ticket: PLANTED_TICKET,
                userName: PLANTED_USER,
                uin: '424242',
            });
        });

        test('an inline-only page (no token in the URL) falls back to the inline token; uin stays optional', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var token='${PLANTED_TOKEN}';${SIDE_FIELDS}</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.outcome).toEqual({ token: PLANTED_TOKEN, ticket: PLANTED_TICKET, userName: PLANTED_USER });
        });

        test('ticket_id substitutes as user_name when user_name is absent (the vendor filetransfer contract)', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var token='${PLANTED_TOKEN}';var ticket='${PLANTED_TICKET}';var ticket_id='wxidticket01';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.outcome).toEqual({ token: PLANTED_TOKEN, ticket: PLANTED_TICKET, userName: 'wxidticket01' });
        });

        test('ticket_id does not substitute for the ticket itself — a ticket-less page refuses by field name', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var token='${PLANTED_TOKEN}';var ticket_id='wxidticket01';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.code).toBe('session-missing');
            expect(facts.error).toContain('ticket');
        });

        test('a 3 MiB document still extracts its head fields — the 2 MiB snapshot bound never hangs', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>${SIDE_FIELDS}var token='${PLANTED_TOKEN}';</script><body>${'x'.repeat(3 * 1024 * 1024)}</body>`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.outcome).toEqual({ token: PLANTED_TOKEN, ticket: PLANTED_TICKET, userName: PLANTED_USER });
        });

        test('fields planted beyond the 2 MiB snapshot are never seen, and the refusal names fields only', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<body>${'x'.repeat(2 * 1024 * 1024 + 64 * 1024)}</body><script>var token='${PLANTED_TOKEN}';${SIDE_FIELDS}</script>`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.code).toBe('session-missing');
            expect(facts.stage).toBe('extract-session');
            expect(facts.error).toContain('token, ticket, user_name');
            expect(facts.error).not.toContain(PLANTED_TOKEN);
            expect(facts.error).not.toContain(PLANTED_TICKET);
            expect(facts.error).not.toContain(PLANTED_USER);
        });

        test('extraction never reaches for Function/eval — an overridden Function survives, a computed token is invisible', async () => {
            const overridden = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document:
                    `<script>window.Function = function () { throw new Error('extraction used Function/eval'); };</script>` +
                    `<script>var token='${PLANTED_TOKEN}';${SIDE_FIELDS}</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(overridden.outcome).toEqual({
                token: PLANTED_TOKEN,
                ticket: PLANTED_TICKET,
                userName: PLANTED_USER,
            });

            const computed = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var t='777';var token=t+'000111';${SIDE_FIELDS}</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(computed.code).toBe('session-missing');
            expect(computed.error).toContain('token');
            expect(computed.error).not.toContain('777000111');
        });

        test('a page without any token refuses by field name and never echoes the planted secrets', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>${SIDE_FIELDS}var uin='42424242';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(facts.code).toBe('session-missing');
            expect(facts.error).toContain('token');
            expect(facts.error).not.toContain(PLANTED_TICKET);
            expect(facts.error).not.toContain(PLANTED_USER);
            expect(facts.error).not.toContain('42424242');
        });

        test('a missing ticket or user_name is refused by field name', async () => {
            const noTicket = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var token='${PLANTED_TOKEN}';var user_name='${PLANTED_USER}';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(noTicket.code).toBe('session-missing');
            expect(noTicket.error).toContain('ticket');

            const noUser = await runCgiDraftScenario(browser, {
                create: [],
                list: [],
                url: `${MP_ORIGIN}${CONSOLE_PATH}?lang=zh_CN`,
                document: `<script>var token='${PLANTED_TOKEN}';var ticket='${PLANTED_TICKET}';</script>ok`,
                run: (page) => extractWechatCgiSession(page),
            });
            expect(noUser.code).toBe('session-missing');
            expect(noUser.error).toContain('user_name');
        });
    });

    describe('createWechatArticleDraft (create POST + list readback)', () => {
        const APP_MSG_ID = '123456';
        const LIST_OK = { app_msg_list: [{ app_id: APP_MSG_ID, title: CREATE_TITLE }] };
        const CREATE_OK: MockResponse = { json: { ret: 0, appMsgId: APP_MSG_ID } };

        test('a verified receipt plus a matching readback returns the id and a token-free editPath', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [CREATE_OK],
                list: [{ json: LIST_OK }],
                run: (page) =>
                    createWechatArticleDraft(page, SESSION, cgiContent({ digest: '摘要', author: 'kk' }), CREATE_MEDIA),
            });
            const draft = facts.outcome as { appMsgId: string; editPath: string };
            expect(draft.appMsgId).toBe(APP_MSG_ID);
            expect(draft.editPath).toContain('appmsgid=123456');
            expect(draft.editPath).not.toContain('token');
            // Exactly two dispatched requests: the create POST, then the list readback.
            expect(facts.observed.map((request) => request.path)).toEqual([CREATE_ENDPOINT, APPMSG_ENDPOINT]);
            const create = facts.observed[0];
            expect(create?.query.sub).toBe('create');
            expect(create?.query.type).toBe('77');
            expect(create?.query.token).toBe(SESSION.token);
            expect(create?.query.lang).toBe('zh_CN');
            expect(create?.fields.title0).toBe(CREATE_TITLE);
            expect(create?.fields.token).toBe(SESSION.token);
            expect(create?.fields.content0).toBe(CREATE_MEDIA.html);
            expect(JSON.parse(create?.fields.crop_list0 ?? '[]')).toEqual([
                { x1: 10, y1: 20, x2: 1188, y2: 735 },
                { x1: 10, y1: 20, x2: 610, y2: 610 },
            ]);
            const list = facts.observed[1];
            expect(list?.query.action).toBe('list_ex');
            expect(list?.query.token).toBe(SESSION.token);
        });

        test('an explicit ret refusal is receipt-invalid and definitive — no readback is dispatched', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [{ json: { ret: 1, err_msg: 'not allowed' } }],
                list: [],
                run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
            });
            expect(facts.code).toBe('receipt-invalid');
            expect(facts.stage).toBe('create-receipt');
            expect(facts.error).toContain('ret=1');
            expect(facts.metadata?.ambiguousSubmission).toBeUndefined();
            expect(facts.observed.map((request) => request.path)).toEqual([CREATE_ENDPOINT]);
        });

        test('a garbage appMsgId is an ambiguous submission: exactly ONE create request, no retry, no readback', async () => {
            for (const appMsgId of ['abc', '']) {
                const facts = await runCgiDraftScenario(browser, {
                    create: [{ json: { ret: 0, appMsgId } }],
                    list: [{ json: LIST_OK }],
                    run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
                });
                expect(facts.code, `appMsgId '${appMsgId}'`).toBe('ambiguous-submission');
                expect(facts.stage, `appMsgId '${appMsgId}'`).toBe('create-receipt');
                expect(facts.metadata?.ambiguousSubmission, `appMsgId '${appMsgId}'`).toBe(true);
                expect(
                    facts.observed.map((request) => request.path),
                    `appMsgId '${appMsgId}'`,
                ).toEqual([CREATE_ENDPOINT]);
            }
        });

        test('a readback title mismatch refuses as readback-failed', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [CREATE_OK],
                list: [{ json: { app_msg_list: [{ app_id: APP_MSG_ID, title: '别的标题' }] } }],
                run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
            });
            expect(facts.code).toBe('readback-failed');
            expect(facts.stage).toBe('readback');
        });

        test('a readback that never shows the created id refuses as readback-failed', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [CREATE_OK],
                list: [{ json: { app_msg_list: [{ app_id: '999', title: CREATE_TITLE }] } }],
                run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
            });
            expect(facts.code).toBe('readback-failed');
            expect(facts.stage).toBe('readback');
        });

        test('an HTTP 500 create is ambiguous: one request, no retry', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [{ status: 500, body: 'boom' }],
                list: [],
                run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
            });
            expect(facts.code).toBe('ambiguous-submission');
            expect(facts.metadata?.ambiguousSubmission).toBe(true);
            expect(facts.error).toContain('HTTP 500');
            expect(facts.observed.map((request) => request.path)).toEqual([CREATE_ENDPOINT]);
        });

        test('an aborted create transport is ambiguous: one request, no retry', async () => {
            const facts = await runCgiDraftScenario(browser, {
                create: [{ abort: true }],
                list: [],
                run: (page) => createWechatArticleDraft(page, SESSION, cgiContent(), CREATE_MEDIA),
            });
            expect(facts.code).toBe('ambiguous-submission');
            expect(facts.stage).toBe('create-dispatch');
            expect(facts.metadata?.ambiguousSubmission).toBe(true);
            expect(facts.observed.map((request) => request.path)).toEqual([CREATE_ENDPOINT]);
        });
        // The 30 s request-timeout variant is not exercised: it costs a 30 s wall clock per run and
        // follows the same already-covered `kind: 'error'` verdict path as the aborted transport.
    });
});

// ---------------------------------------------------------------------------
// runMode integration (offline fake pages — the wechatmp-pub.test.ts pattern)
// ---------------------------------------------------------------------------

/** Page-side JSON verdict for one mocked CGI receipt (the shape evaluateJson reads back). */
const verdictOk = (receipt: unknown): string =>
    JSON.stringify({ kind: 'ok', status: 200, text: JSON.stringify(receipt) });

const SESSION_OK = JSON.stringify({
    kind: 'ok',
    token: SESSION.token,
    ticket: SESSION.ticket,
    userName: SESSION.userName,
});
/** Parse verdict for one local image source + the apply verdict, for the offline fake page. */
const parseOk = (sources: string[]) => JSON.stringify({ kind: 'ok', sources, html: '<p>正文</p>' });
const APPLY_OK = JSON.stringify({ kind: 'ok', html: '<p>正文</p>' });
const APP_MSG_ID = '123456';
const LIST_OK = verdictOk({ app_msg_list: [{ app_id: APP_MSG_ID, title: CREATE_TITLE }] });

/** The media verdict chain of one eligible plain run: parse → cover transfer → crop → apply. */
// Local body images reuse the filetransfer upload (readLocalImageBytes → uploadCoverImage): the
// queue is parse → cover upload+crop → body-image upload → apply.
const mediaQueue = (source: string) => [
    parseOk([source]),
    verdictOk(FILETRANSFER_RECEIPT),
    verdictOk(CROPIMAGE_RECEIPT),
    verdictOk(FILETRANSFER_RECEIPT),
    APPLY_OK,
];

/** A fake page whose evaluate calls consume a FIFO queue and log every expression they saw. */
function queuedPage(queue: unknown[]): WechatPage & { seen: string[] } {
    const seen: string[] = [];
    const pending = [...queue];
    const locator = () => ({
        count: async () => 0,
        first: () => ({
            count: async () => 0,
            isVisible: async () => false,
            fill: async () => undefined,
            click: async () => undefined,
            type: async () => undefined,
            textContent: async () => '',
            inputValue: async () => '',
        }),
    });
    return {
        url: () => `${MP_ORIGIN}/cgi-bin/home?t=home/index&lang=zh_CN&token=${SESSION.token}`,
        goto: async () => undefined,
        locator,
        setInputFiles: async () => undefined,
        evaluate: async (expression: string) => {
            seen.push(expression);
            const next = pending.shift();
            if (next === undefined) throw new Error(`fixture: evaluate queue exhausted at ${expression.slice(0, 80)}`);
            return next;
        },
        waitForTimeout: async () => undefined,
        press: async () => undefined,
        seen,
    };
}

function makeDeps(
    entry: WechatPage,
    content: Content,
    opts: {
        pages?: () => WechatPage[];
        newPage?: () => Promise<WechatPage>;
        publishStatus?: 'draft' | 'public';
    } = {},
): ModeRunDeps {
    return {
        entry,
        pages: opts.pages ?? (() => [entry]),
        // Any DOM-editor attempt fails the test loudly — the CGI path must never open one.
        newPage:
            opts.newPage ??
            (async () => {
                throw new Error('fixture: the CGI draft path must never open a DOM editor tab');
            }),
        content,
        publishStatus: opts.publishStatus ?? 'draft',
        profileDir: join(tmpRoot, 'profile'),
        driver: 'script',
        stepTimeoutMs: 300,
        pollMs: 5,
        submitSettleMs: 1,
        draftTimeoutMs: 50,
        submitAttempts: 1,
        draftBaseline: { stamp: null },
    };
}

/** The entry page's create-dispatch expressions (`operate_appmsg`), for exactly-once assertions. */
const createDispatches = (page: WechatPage & { seen: string[] }): string[] =>
    page.seen.filter((expression) => expression.includes('/cgi-bin/operate_appmsg'));

describe('runMode CGI integration (offline fake pages)', () => {
    test('an eligible plain draft takes the CGI branch: created once, secret-free url, no DOM editor', async () => {
        const content = cgiContent({ images: [tmpCover], coverPath: tmpCover, digest: '摘要', author: 'kk' });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const entry = queuedPage([
            SESSION_OK,
            ...mediaQueue(tmpCover),
            verdictOk({ ret: 0, appMsgId: APP_MSG_ID }),
            LIST_OK,
        ]);
        const result = await runMode(validation.input, makeDeps(entry, content));
        expect(result.ok).toBe(true);
        expect(result.id).toBe(APP_MSG_ID);
        expect(result.url).toBe(
            `${MP_ORIGIN}/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&isNew=0&type=77&appmsgid=${APP_MSG_ID}`,
        );
        expect(result.url).not.toContain('token');
        expect(result.url).not.toContain(SESSION.token);
        expect(result.metadata?.stage).toBe('draft-created');
        expect(result.metadata?.appMsgId).toBe(APP_MSG_ID);
        // The body image was NOT dropped: it transferred through the media pipeline into the payload.
        expect(result.metadata?.cdnMigratedImages).toBe(1);
        expect(result.metadata?.coverFileIds).toBeDefined();
        // The dispatched parse expression must carry the built <img> block (regression guard:
        // the fake parse echoes authorial sources, so only the expression proves html parity).
        const parseExpression = entry.seen.find((expression) => expression.includes('DOMParser')) ?? '';
        expect(parseExpression).toContain(`<img src=\\"${tmpCover}`);
        expect(createDispatches(entry)).toHaveLength(1);
    });

    test('an ambiguous create reports ok:false with ambiguousSubmission, never retries and never opens the DOM editor', async () => {
        const content = cgiContent({ images: [tmpCover], coverPath: tmpCover });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const entry = queuedPage([SESSION_OK, ...mediaQueue(tmpCover), '{"not json']);
        const result = await runMode(validation.input, makeDeps(entry, content));
        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('create-dispatch');
        expect(result.metadata?.ambiguousSubmission).toBe(true);
        expect(createDispatches(entry)).toHaveLength(1);
        expect(entry.seen.some((expression) => expression.includes('list_ex'))).toBe(false);
    });

    test('a media-preparation failure reports stage media-preparation without any create dispatch', async () => {
        const content = cgiContent({ images: [tmpCover], coverPath: tmpCover });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        // The REAL prepareArticleMedia runs against the fake evaluate seam and fails at its first
        // dispatch (the article-body parse verdict is an HTTP 500) — no mock.module needed.
        const entry = queuedPage([SESSION_OK, JSON.stringify({ kind: 'http-status', status: 500 })]);
        const result = await runMode(validation.input, makeDeps(entry, content));
        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('media-preparation');
        expect(result.metadata?.ambiguousSubmission).toBeUndefined();
        expect(createDispatches(entry)).toHaveLength(0);
    });

    test('advanced metadata (metadata.wechatmp) keeps the DOM path', async () => {
        const content = cgiContent({ wechatmp: { coverPath: tmpCover } });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const console = makeMiniConsole();
        const result = await runMode(validation.input, makeDeps(console.entryPage, content, console.deps));
        expect(result.ok).toBe(true);
        expect(result.metadata?.entryPath).toBe('menu');
        expect(console.editorOpened()).toBe(true);
        expect(console.typed()).toContain(CREATE_TITLE);
        expect(console.anySeen('URLSearchParams(location.search)')).toBe(false);
        expect(console.anySeen('/cgi-bin/operate_appmsg')).toBe(false);
        expect(result.metadata?.appMsgId).toBeUndefined();
    });

    test('a plain draft without coverPath takes the CGI branch with the first body image as cover (默认首图为封面)', async () => {
        const content = cgiContent({ images: [tmpCover] });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const entry = queuedPage([
            SESSION_OK,
            ...mediaQueue(tmpCover),
            verdictOk({ ret: 0, appMsgId: APP_MSG_ID }),
            LIST_OK,
        ]);
        const result = await runMode(validation.input, makeDeps(entry, content));
        expect(result.ok).toBe(true);
        expect(result.metadata?.appMsgId).toBe(APP_MSG_ID);
        expect(result.metadata?.cdnMigratedImages).toBe(1);
        expect(createDispatches(entry)).toHaveLength(1);
    });

    test('a coverPath that does not exist on disk keeps the DOM path', async () => {
        const content = cgiContent({ images: [tmpCover], coverPath: join(tmpRoot, 'missing.png') });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const console = makeMiniConsole();
        const result = await runMode(validation.input, makeDeps(console.entryPage, content, console.deps));
        expect(result.ok).toBe(true);
        expect(result.metadata?.entryPath).toBe('menu');
        expect(console.editorOpened()).toBe(true);
        expect(console.anySeen('/cgi-bin/operate_appmsg')).toBe(false);
    });

    test("publishStatus 'public' skips the CGI branch and publishes through the DOM", async () => {
        const content = cgiContent({ images: [tmpCover], coverPath: tmpCover });
        const validation = await validateModeInput('文章', content);
        if (validation.error !== undefined) throw new Error(validation.error);
        const console = makeMiniConsole();
        const result = await runMode(
            validation.input,
            makeDeps(console.entryPage, content, { ...console.deps, publishStatus: 'public' }),
        );
        expect(result.ok).toBe(true);
        expect(result.message).toContain('published');
        expect(result.metadata?.publishControl).toBe('button.mass_send');
        expect(result.metadata?.stage).toBeUndefined();
        expect(console.editorOpened()).toBe(true);
        expect(console.anySeen('URLSearchParams(location.search)')).toBe(false);
        expect(console.anySeen('/cgi-bin/operate_appmsg')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// The offline 文章 console (trimmed from wechatmp-pub.test.ts's makeConsole)
// ---------------------------------------------------------------------------

const FRESH_STAMP = '更新于 13:12';

interface MiniConsole {
    entryPage: WechatPage & { seen: string[] };
    deps: { pages: () => WechatPage[]; newPage: () => Promise<WechatPage> };
    editorOpened: () => boolean;
    typed: () => string[];
    anySeen: (needle: string) => boolean;
}

/** The menu item click opens the editor in a NEW tab whose createType matches 文章. */
const editorUrl = `${MP_ORIGIN}/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${SESSION.token}&lang=zh_CN&timestamp=1&createType=0`;

function makeMiniConsole(): MiniConsole {
    let draftStamp: string | null = null;
    let mirrorValue = '';
    let pastedHtml = '';
    let coverPanelOpen = false;
    let publishConfirmPending = false;
    let coverCommittedSrc = '';
    const typed: string[] = [];
    let editor: (WechatPage & { seen: string[] }) | null = null;

    const entryAttached = (selector: string): boolean => {
        if (selector.includes(':text("更新于")')) return draftStamp !== null;
        const label = /new-creation__menu-item.*:has-text\("([^"]+)"\)/.exec(selector)?.[1];
        return label !== undefined && label === '文章';
    };

    const editorAttached = (selector: string): boolean => {
        if (selector.includes(':text("更新于")')) return false;
        if (/:text\("(发表成功|已发表)"\)/.test(selector)) return true;
        if (selector.includes('type="file"')) return true;
        if (selector.includes('data-placeholder') && selector.includes('标题')) return true;
        if (selector.includes('.ProseMirror') && !selector.includes('data-placeholder')) return true;
        if (selector.includes('textarea#title') || selector.includes('js_title')) return true;
        if (selector.includes('js_description')) return true;
        if (selector.includes('input#author') || selector.includes('js_author')) return true;
        if (selector.includes('保存为草稿')) return true;
        if (
            selector.includes('js_selectCoverFromContent') ||
            selector.includes('从正文选择') ||
            selector.includes('js_cover_btn_area') ||
            selector.includes('换一张') ||
            selector.includes('修改')
        ) {
            return true;
        }
        if (selector.includes('js_imagedialog') || selector.includes('从图片库选择')) return true;
        if (selector.includes('cover') && selector.includes(' li')) return coverPanelOpen;
        if (selector.includes('mass_send') || (selector.includes('发表') && !selector.includes('成功'))) return true;
        if (selector.includes('确定') || selector.includes('确认') || selector.includes('完成')) {
            return coverPanelOpen || publishConfirmPending;
        }
        return false;
    };

    const applyEditorClick = (selector: string): void => {
        if (selector.includes('保存为草稿')) {
            draftStamp = FRESH_STAMP;
            return;
        }
        if (selector.includes('mass_send') || (selector.includes('发表') && !selector.includes('成功'))) {
            publishConfirmPending = true;
            return;
        }
        if (selector.includes('确定') || selector.includes('确认') || selector.includes('完成')) {
            coverPanelOpen = false;
            publishConfirmPending = false;
            return;
        }
        if (
            selector.includes('js_selectCoverFromContent') ||
            selector.includes('js_cover_btn_area') ||
            selector.includes('换一张') ||
            selector.includes('修改') ||
            selector.includes('js_imagedialog') ||
            selector.includes('从图片库选择')
        ) {
            coverPanelOpen = true;
        }
    };

    const makePage = (role: 'entry' | 'editor'): WechatPage & { seen: string[] } => {
        const pageSeen: string[] = [];
        let url =
            role === 'entry' ? `${MP_ORIGIN}/cgi-bin/home?t=home/index&lang=zh_CN&token=${SESSION.token}` : editorUrl;
        const attached = role === 'entry' ? entryAttached : editorAttached;
        return {
            url: () => url,
            goto: async (target) => {
                url = target;
            },
            locator: (selector: string) => ({
                count: async () => (attached(selector) ? 1 : 0),
                first: () => ({
                    count: async () => (attached(selector) ? 1 : 0),
                    // File inputs hide behind styled controls; everything else reads as visible.
                    isVisible: async () => attached(selector) && !selector.includes('type="file"'),
                    fill: async () => undefined,
                    click: async () => {
                        if (role === 'entry') editor = makePage('editor');
                        else applyEditorClick(selector);
                    },
                    type: async (text: string) => {
                        if (role === 'editor' && selector.includes('data-placeholder') && selector.includes('标题')) {
                            mirrorValue = text;
                            typed.push(text);
                        }
                    },
                    textContent: async () => {
                        if (selector.includes(':text("更新于")')) return draftStamp ?? '';
                        if (/:text\("(发表成功|已发表)"\)/.test(selector)) return '发表成功';
                        return '';
                    },
                    inputValue: async () => mirrorValue,
                }),
            }),
            setInputFiles: async () => undefined,
            evaluate: async (expression: string) => {
                pageSeen.push(expression);
                if (role === 'editor') {
                    if (expression.includes('ClipboardEvent')) {
                        pastedHtml = /setData\('text\/html',\s*(".*?")\);/.exec(expression)?.[1] ?? '';
                        return true;
                    }
                    if (expression.includes('weui-desktop-img-picker__item')) {
                        const wanted = JSON.parse(
                            /const wanted = (\[[^\]]*\])/.exec(expression)?.[1] ?? '[]',
                        ) as string[];
                        coverCommittedSrc = `https://mmbiz.qpic.cn/${wanted[0] ?? ''}`;
                        return JSON.stringify({ picked: true, src: coverCommittedSrc });
                    }
                    if (expression.includes('#js_cover_area')) return coverCommittedSrc;
                    if (expression.includes('weui-desktop-dialog__wrp, .weui-desktop-dialog')) return false;
                    if (expression.includes('textContent')) return pastedHtml.length > 0 ? '正文' : '';
                    return '';
                }
                if (expression.includes('a[href*="token="]')) return '';
                return '';
            },
            waitForTimeout: async () => undefined,
            press: async () => undefined,
            seen: pageSeen,
        };
    };

    const entryPage = makePage('entry');
    return {
        entryPage,
        deps: {
            pages: () => (editor === null ? [entryPage] : [entryPage, editor]),
            newPage: async () => {
                if (editor === null) editor = makePage('editor');
                return editor;
            },
        },
        editorOpened: () => editor !== null,
        typed: () => typed,
        anySeen: (needle: string) =>
            entryPage.seen.some((expression) => expression.includes(needle)) ||
            (editor?.seen.some((expression) => expression.includes(needle)) ?? false),
    };
}
