/**
 * Chunk-3 R5 regressions (task 0289): the private CGI media pipeline — `src/cgi.ts` upload/crop and
 * `src/cgi-media.ts` body migration + anchor normalization — verified on three levels:
 *
 * 1. Pure host-level units (crop math, validators) — allowed to be browser-free.
 * 2. Seam tests with a fake `WechatPage` whose `evaluate` replays canned page verdicts. The
 *    production helpers run host-side in full; only the ADR-029 page boundary is scripted (the seam
 *    fake blessed by `src/page.ts`). These never substitute a transport in the browser tests below.
 * 3. Production-path browser fixtures through `tests/fixtures/wechatmp-cgi-runner.ts`: real
 *    headless Chromium on the REAL https://mp.weixin.qq.com origin, CGI endpoints mocked via
 *    `page.route` with every query/multipart field observed, loopback-only traffic, zero live
 *    provider calls. A missing Chromium fails loudly (never skips) — proven by the spawn test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import {
    centerCropRect,
    isAllowedCdnUrl,
    readLocalImageBytes,
    uploadAndCropCover,
    uploadCoverImage,
    validateImageBytes,
    WechatCgiError,
} from '../src/cgi';
import { prepareArticleMedia, WechatMediaError } from '../src/cgi-media';
import type { WechatPage } from '../src/page';
import {
    BODY_RECEIPT,
    CROPIMAGE_RECEIPT,
    ENDPOINTS,
    FILETRANSFER_RECEIPT,
    launchChromium,
    runDeadlineScenario,
    runForeignOriginScenario,
    runPrepareScenario,
    SESSION,
    UPLOADIMG2CDN_RECEIPT,
} from './fixtures/wechatmp-cgi-runner';

const RUNNER = join(import.meta.dir, 'fixtures', 'wechatmp-cgi-runner.ts');

/** Writes real image files (size in bytes; negative sizes stay unwritten) into a cleaned temp dir. */
async function withImages(specs: Record<string, number>, run: (path: (name: string) => string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'kk-cgi-media-'));
    try {
        for (const [name, size] of Object.entries(specs)) {
            if (size >= 0) await writeFile(join(dir, name), Buffer.alloc(size, 0x61));
        }
        await run((name) => join(dir, name));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/** `noUncheckedIndexedAccess` guard: fails loudly on a missing fixture item, never asserts non-null. */
function nth<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) throw new Error(`expected an item at index ${index}, got ${items.length}`);
    return item;
}

async function capture(run: () => Promise<unknown>): Promise<{ reason?: string; error?: string }> {
    try {
        await run();
        return {};
    } catch (error) {
        return {
            reason: error instanceof WechatMediaError || error instanceof WechatCgiError ? error.reason : undefined,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/** Named loop-case assertion: bun:test's expect takes no failure message, so cases throw one. */
function expectCase(name: string, got: { reason?: string; error?: string }, reason: string, pattern: RegExp) {
    if (got.reason !== reason || !pattern.test(got.error ?? '')) {
        throw new Error(`case "${name}": expected reason=${reason} matching ${pattern}, got ${JSON.stringify(got)}`);
    }
}

/** Page verdicts as the in-page scripts would return them (host-side replay, no DOM needed). */
const cgiOk = (receipt: unknown) => JSON.stringify({ kind: 'ok', status: 200, text: JSON.stringify(receipt) });
const parseOk = (sources: string[], html = '<p>body</p>') => JSON.stringify({ kind: 'ok', sources, html });
const applyOk = (html = '<p>applied</p>') => JSON.stringify({ kind: 'ok', html });

interface FakePage {
    page: WechatPage;
    seen: string[];
    remaining(): number;
}

/** Fake `WechatPage` on the mp origin: pops one canned verdict per evaluate, records expressions. */
function fakeMpPage(verdicts: unknown[], url?: string): FakePage {
    const queue = [...verdicts];
    const seen: string[] = [];
    const page = {
        url: () => url ?? 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=302104224',
        evaluate: async (expression: string) => {
            seen.push(expression);
            return queue.shift();
        },
    };
    return { page: page as unknown as WechatPage, seen, remaining: () => queue.length };
}

const tooManyHtml = Array.from({ length: 31 }, (_, i) => `<img src="https://pub.example/${i}.png">`).join('');

describe('CGI crop math and validators (host-level, pure)', () => {
    test('centerCropRect derives centered cover-fit rects from actual dimensions', () => {
        expect(centerCropRect(1000, 400, 2.35)).toEqual({ x1: 30, y1: 0, x2: 970, y2: 400 });
        expect(centerCropRect(800, 1600, 1)).toEqual({ x1: 0, y1: 400, x2: 800, y2: 1200 });
        // The exact rect pair the browser fixture asserts on (receipt dims 1000x800).
        expect(centerCropRect(1000, 800, 2.35)).toEqual({ x1: 0, y1: 187, x2: 1000, y2: 613 });
        expect(centerCropRect(1000, 800, 1)).toEqual({ x1: 100, y1: 0, x2: 900, y2: 800 });
    });

    test('centerCropRect refuses non-positive or non-finite dimensions and aspects', async () => {
        for (const [width, height, aspect] of [
            [0, 100, 1],
            [100, NaN, 1],
            [100, 100, 0],
            [100, 100, -2.35],
        ] as const) {
            const { reason } = await capture(async () => centerCropRect(width, height, aspect));
            expect(reason).toBe('invalid-dimensions');
        }
    });

    test('isAllowedCdnUrl allows only exact-host HTTPS mmbiz.qpic.cn', () => {
        expect(isAllowedCdnUrl('https://mmbiz.qpic.cn/mmbiz/a.png')).toBe(true);
        expect(isAllowedCdnUrl('http://mmbiz.qpic.cn/mmbiz/a.png')).toBe(false);
        expect(isAllowedCdnUrl('https://mmbiz.qpic.cn.evil.com/a.png')).toBe(false);
        expect(isAllowedCdnUrl('https://evil.com/mmbiz.qpic.cn')).toBe(false);
        expect(isAllowedCdnUrl('mmbiz.qpic.cn/a.png')).toBe(false);
        expect(isAllowedCdnUrl('')).toBe(false);
    });

    test('validateImageBytes enforces nonempty, ≤10 MiB, PNG/JPEG/WebP', async () => {
        expect((await capture(async () => validateImageBytes(new Uint8Array(0), 'e.png'))).reason).toBe('empty-image');
        expect(
            (await capture(async () => validateImageBytes(new Uint8Array(10 * 1024 * 1024 + 1), 'b.png'))).reason,
        ).toBe('image-too-large');
        expect((await capture(async () => validateImageBytes(new Uint8Array(8), 'a.gif'))).reason).toBe(
            'unsupported-extension',
        );
        expect(validateImageBytes(new Uint8Array(8), 'a.png').mime).toBe('image/png');
        expect(validateImageBytes(new Uint8Array(8), 'B.JPG').mime).toBe('image/jpeg');
    });

    test('readLocalImageBytes reads real files and refuses missing/empty/oversize/bad-extension', async () => {
        await withImages(
            { 'ok.png': 1024, 'empty.png': 0, 'big.png': 10 * 1024 * 1024 + 1, 'bad.gif': 512, 'nope.png': -1 },
            async (path) => {
                const ok = await readLocalImageBytes(path('ok.png'));
                expect(ok.name).toBe('ok.png');
                expect(ok.mime).toBe('image/png');
                expect(ok.bytes.byteLength).toBe(1024);
                expect((await capture(async () => readLocalImageBytes(path('nope.png')))).reason).toBe(
                    'unreadable-file',
                );
                expect((await capture(async () => readLocalImageBytes(path('empty.png')))).reason).toBe(
                    'unreadable-file',
                );
                expect((await capture(async () => readLocalImageBytes(path('big.png')))).reason).toBe(
                    'image-too-large',
                );
                expect((await capture(async () => readLocalImageBytes(path('bad.gif')))).reason).toBe(
                    'unsupported-extension',
                );
            },
        );
    });
});

describe('CGI dispatch and receipts (fake WechatPage seam)', () => {
    test('uploadCoverImage posts the frozen filetransfer query/multipart and returns a validated receipt', async () => {
        const fake = fakeMpPage([cgiOk(FILETRANSFER_RECEIPT)]);
        const image = await uploadCoverImage(fake.page, SESSION, { bytes: new Uint8Array(64).fill(7), name: 'a.png' });
        expect(image).toEqual({
            fileId: '2233445566',
            url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/cover.png',
            width: 1000,
            height: 800,
        });
        expect(fake.seen[0]).toContain('/cgi-bin/filetransfer?');
        expect(fake.seen[0]).toContain('action=upload_material');
        expect(fake.seen[0]).toContain('scene=8');
        expect(fake.seen[0]).toContain('writetype=doublewrite');
    });

    test('filetransfer receipts: stale ret, err_msg, malformed base, non-JSON, bad content/CDN/dims all refuse', async () => {
        const cases: Array<[string, unknown, RegExp]> = [
            ['stale ret', cgiOk({ base_resp: { ret: -2000 } }), /base_resp\.ret=-2000/],
            ['err_msg mismatch', cgiOk({ base_resp: { ret: 0, err_msg: 'session expired' } }), /err_msg/],
            ['malformed base_resp', cgiOk({ base_resp: 'garbage' }), /malformed base_resp/],
            // Raw non-JSON body: the wrapper's text field carries the undecodable bytes as-is.
            ['non-JSON body', JSON.stringify({ kind: 'ok', status: 200, text: 'not-json{{' }), /response is not JSON/],
            ['non-object JSON body', cgiOk(null), /not a JSON object/],
            ['non-numeric content', cgiOk({ base_resp: { ret: 0 }, content: 'abc12' }), /content file ID/],
            ['missing content', cgiOk({ base_resp: { ret: 0 } }), /content file ID/],
            [
                'non-HTTPS cdn_url',
                cgiOk({ base_resp: { ret: 0 }, content: '1', cdn_url: 'http://mmbiz.qpic.cn/a' }),
                /cdn_url/,
            ],
            [
                'foreign cdn_url host',
                cgiOk({ base_resp: { ret: 0 }, content: '1', cdn_url: 'https://mmbiz.qpic.cn.evil.com/a' }),
                /cdn_url/,
            ],
            [
                'missing dimensions',
                cgiOk({ base_resp: { ret: 0 }, content: '1', cdn_url: 'https://mmbiz.qpic.cn/a' }),
                /dimensions/,
            ],
        ];
        for (const [name, verdict, pattern] of cases) {
            const got = await capture(() =>
                uploadCoverImage(fakeMpPage([verdict]).page, SESSION, { bytes: new Uint8Array(8), name: 'a.png' }),
            );
            expectCase(name, got, 'bad-receipt', pattern);
        }
    });

    test('postCgiForm maps page verdict failures to named WechatCgiError reasons without leaking secrets', async () => {
        const cases: Array<[string, unknown, string, RegExp]> = [
            ['HTTP status', JSON.stringify({ kind: 'http-status', status: 502 }), 'http-status', /HTTP 502/],
            ['response too large', JSON.stringify({ kind: 'too-large' }), 'response-too-large', /2097152-byte bound/],
            [
                'in-page error strips query secrets',
                JSON.stringify({
                    kind: 'error',
                    detail: 'TypeError: fetch https://mp.weixin.qq.com/cgi-bin/filetransfer?t=1&ticket=sekret failed',
                }),
                'network-error',
                /failed before a usable response/,
            ],
            ['no verdict at all', undefined, 'network-error', /no usable verdict/],
            ['non-JSON verdict', 'garbage{', 'network-error', /no usable verdict/],
        ];
        for (const [name, verdict, reason, pattern] of cases) {
            const got = await capture(() =>
                uploadCoverImage(fakeMpPage([verdict]).page, SESSION, { bytes: new Uint8Array(8), name: 'a.png' }),
            );
            expectCase(name, got, reason, pattern);
        }
        const secret = await capture(() =>
            uploadCoverImage(
                fakeMpPage([
                    JSON.stringify({
                        kind: 'error',
                        detail: 'fetch https://mp.weixin.qq.com/cgi-bin/filetransfer?ticket=sekret failed',
                    }),
                ]).page,
                SESSION,
                { bytes: new Uint8Array(8), name: 'a.png' },
            ),
        );
        expect(secret.error).toContain('?…');
        expect(secret.error?.includes('sekret')).toBe(false);
    });

    test('uploadAndCropCover sends both crop rects in the frozen crop_multi shape and fills the pair', async () => {
        const fake = fakeMpPage([cgiOk(FILETRANSFER_RECEIPT), cgiOk(CROPIMAGE_RECEIPT)]);
        const cover = await uploadAndCropCover(fake.page, SESSION, { bytes: new Uint8Array(16), name: 'a.png' });
        expect(cover.wide).toEqual({
            fileId: 'wide-1',
            url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/wide.png',
            width: 1000,
            height: 426,
        });
        expect(cover.square).toEqual({
            fileId: 'sq-1',
            url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/square.png',
            width: 800,
            height: 800,
        });
        expect(fake.seen[1]).toContain('/cgi-bin/cropimage?action=crop_multi');
        expect(fake.seen[1]).toContain('"size0_x1":"0"');
        expect(fake.seen[1]).toContain('"size1_x1":"100"');
        expect(fake.seen[1]).toContain('"size_count":"2"');
    });

    test('crop_multi receipts: entry count, non-object entries, foreign CDN and missing file_id refuse', async () => {
        const okEntry = { file_id: 'x', cdnurl: 'https://mmbiz.qpic.cn/a.png' };
        const cases: Array<[string, unknown, RegExp]> = [
            ['one entry only', cgiOk({ base_resp: { ret: 0 }, result: [okEntry] }), /exactly two result entries/],
            ['non-object entry', cgiOk({ base_resp: { ret: 0 }, result: ['x', okEntry] }), /entry 0 is not an object/],
            [
                'foreign cdnurl',
                cgiOk({ base_resp: { ret: 0 }, result: [{ ...okEntry, cdnurl: 'https://evil.example/a' }, okEntry] }),
                /entry 0 cdnurl/,
            ],
            [
                'missing file_id',
                cgiOk({ base_resp: { ret: 0 }, result: [{ ...okEntry, file_id: '' }, okEntry] }),
                /file_id/,
            ],
        ];
        for (const [name, verdict, pattern] of cases) {
            const got = await capture(() =>
                uploadAndCropCover(fakeMpPage([cgiOk(FILETRANSFER_RECEIPT), verdict]).page, SESSION, {
                    bytes: new Uint8Array(8),
                    name: 'a.png',
                }),
            );
            expectCase(name, got, 'bad-receipt', pattern);
        }
    });
});

describe('prepareArticleMedia body pipeline (fake WechatPage seam)', () => {
    test('relative, dangerous-scheme, local-IP and credentialed sources without mappings are refused', async () => {
        const cases: Array<[string, string, RegExp]> = [
            ['relative source', 'rel.png', /not absolute/],
            ['dangerous scheme', 'javascript:alert(1)', /scheme javascript:/],
            ['local-IP literal', 'http://127.0.0.1/a.png', /local-IP literal/],
            ['credentialed URL', `https://user:pw@example.com/${'x'.repeat(140)}.png?q=sekret-tail`, /credentials/],
        ];
        for (const [name, source, pattern] of cases) {
            await withImages({ 'cover.png': 1024 }, async (path) => {
                const fake = fakeMpPage([parseOk([source]), cgiOk(FILETRANSFER_RECEIPT), cgiOk(CROPIMAGE_RECEIPT)]);
                const got = await capture(() =>
                    prepareArticleMedia(fake.page, SESSION, {
                        html: '<p>x</p>',
                        coverPath: path('cover.png'),
                        localImages: {},
                    }),
                );
                expectCase(name, got, 'unmapped-source', pattern);
                // Failure detail stays bounded and query-free even for long sources.
                expect(got.error?.includes('sekret-tail')).toBe(false);
                expect(got.error?.length ?? 0).toBeLessThan(300);
            });
        }
    });

    test('more than 30 distinct sources refuse before any dispatch', () => {
        const fake = fakeMpPage([parseOk(Array.from({ length: 31 }, (_, i) => `src-${i}.png`))]);
        return capture(() =>
            prepareArticleMedia(fake.page, SESSION, { html: '<p>x</p>', coverPath: 'unused.png', localImages: {} }),
        ).then(({ reason, error }) => {
            expect(reason).toBe('too-many-sources');
            expect(error).toMatch(/bound is 30/);
        });
    });

    test('local body images exceeding the 20 MiB aggregate throw before the third upload', async () => {
        await withImages(
            { 'cover.png': 1024, 'a.png': 7_040_000, 'b.png': 7_040_000, 'c.png': 7_040_000 },
            async (path) => {
                const fake = fakeMpPage([
                    parseOk(['a.png', 'b.png', 'c.png']),
                    cgiOk(FILETRANSFER_RECEIPT),
                    cgiOk(CROPIMAGE_RECEIPT),
                    cgiOk(BODY_RECEIPT),
                    cgiOk(BODY_RECEIPT),
                ]);
                const { reason, error } = await capture(() =>
                    prepareArticleMedia(fake.page, SESSION, {
                        html: '<p>x</p>',
                        coverPath: path('cover.png'),
                        localImages: {
                            'a.png': path('a.png'),
                            'b.png': path('b.png'),
                            'c.png': path('c.png'),
                        },
                    }),
                );
                expect(reason).toBe('aggregate-too-large');
                expect(error).toMatch(/20971520-byte aggregate/);
                // Two mapped uploads happened; the third was refused before its dispatch.
                expect(fake.remaining()).toBe(0);
            },
        );
    });

    test('the 180 s total deadline refuses before the cover upload (clock jumped +200 s)', async () => {
        const realNow = Date.now;
        // First read (deadline base) stays real; every later read jumps past the deadline.
        let reads = 0;
        Date.now = () => (reads++ === 0 ? realNow.call(Date) : realNow.call(Date) + 200_000);
        try {
            const fake = fakeMpPage([parseOk([]), cgiOk(FILETRANSFER_RECEIPT), cgiOk(CROPIMAGE_RECEIPT)]);
            const { reason } = await capture(() =>
                prepareArticleMedia(fake.page, SESSION, { html: '<p>x</p>', coverPath: 'c.png', localImages: {} }),
            );
            expect(reason).toBe('deadline-exceeded');
            // The parse verdict was consumed; the deadline gate fired before the cover upload.
            expect(fake.remaining()).toBe(2);
        } finally {
            Date.now = realNow;
        }
        // Restoration matters: later tests (and Bun's own timers) need the real clock back.
        expect(Date.now).toBe(realNow);
    });

    test('CDN-hosted sources stay untouched, duplicates dedup to one dispatch, mapped and public sources migrate', async () => {
        await withImages({ 'cover.png': 1024, 'dup.png': 2048 }, async (path) => {
            const fake = fakeMpPage([
                // In-page parsing already deduplicated (proven on real DOMParser in the browser tests);
                // the seam replays the deduped source list.
                parseOk([
                    'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/kept.png',
                    'dup.png',
                    'https://pub.example/pic.png',
                ]),
                cgiOk(FILETRANSFER_RECEIPT),
                cgiOk(CROPIMAGE_RECEIPT),
                cgiOk(BODY_RECEIPT),
                cgiOk(UPLOADIMG2CDN_RECEIPT),
                applyOk(),
            ]);
            const out = await prepareArticleMedia(fake.page, SESSION, {
                html: '<p>x</p>',
                coverPath: path('cover.png'),
                localImages: { 'dup.png': path('dup.png') },
            });
            expect(out.images).toEqual([
                {
                    fileId: '7788',
                    url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/body.png',
                    width: 500,
                    height: 400,
                },
                { fileId: 'cdn-9', url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png', width: 0, height: 0 },
            ]);
            const apply = fake.seen.at(-1) ?? '';
            expect(apply).toContain('"dup.png":"https://mmbiz.qpic.cn/mmbiz_png/kkfixture/body.png"');
            expect(apply).toContain(
                '"https://pub.example/pic.png":"https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png"',
            );
            expect(apply).not.toContain('kept.png');
            // Six evaluates exactly: parse, cover upload+crop, one body upload, one public transfer, apply.
            expect(fake.seen).toHaveLength(6);
        });
    });

    test('uploadimg2cdn receipts: stale errcode, non-object, non-JSON and foreign CDN url refuse as bad-transfer-receipt', async () => {
        const cases: Array<[string, string, RegExp]> = [
            ['stale errcode', cgiOk({ errcode: -40002 }), /errcode=-40002/],
            ['non-object body', cgiOk(null), /errcode=null/],
            ['non-JSON body', JSON.stringify({ kind: 'ok', text: 'not-json{{' }), /response is not JSON/],
            [
                'foreign CDN url',
                cgiOk({ errcode: 0, file_id: 'x', url: 'https://evil.example/a.png' }),
                /file_id\/url missing or outside the allowed HTTPS CDN host/,
            ],
        ];
        for (const [name, verdict, pattern] of cases) {
            await withImages({ 'cover.png': 1024 }, async (path) => {
                const fake = fakeMpPage([
                    parseOk(['https://pub.example/a.png']),
                    cgiOk(FILETRANSFER_RECEIPT),
                    cgiOk(CROPIMAGE_RECEIPT),
                    verdict,
                ]);
                const got = await capture(() =>
                    prepareArticleMedia(fake.page, SESSION, {
                        html: '<p>x</p>',
                        coverPath: path('cover.png'),
                        localImages: {},
                    }),
                );
                expectCase(name, got, 'bad-transfer-receipt', pattern);
            });
        }
    });

    test('a non-ok parse verdict or non-ok apply verdict is a named transfer failure', async () => {
        await withImages({ 'cover.png': 1024 }, async (path) => {
            const parseFail = fakeMpPage([JSON.stringify({ kind: 'http-status', status: 500 })]);
            const parseGot = await capture(() =>
                prepareArticleMedia(parseFail.page, SESSION, {
                    html: '<p>x</p>',
                    coverPath: path('cover.png'),
                    localImages: {},
                }),
            );
            expect(parseGot.error).toMatch(/article body parse/);
            expect(parseGot.reason).toBe('transfer-failed');

            const applyFail = fakeMpPage([
                parseOk(['https://pub.example/a.png']),
                cgiOk(FILETRANSFER_RECEIPT),
                cgiOk(CROPIMAGE_RECEIPT),
                cgiOk(UPLOADIMG2CDN_RECEIPT),
                'garbage{',
            ]);
            const applyGot = await capture(() =>
                prepareArticleMedia(applyFail.page, SESSION, {
                    html: '<p>x</p>',
                    coverPath: path('cover.png'),
                    localImages: {},
                }),
            );
            expect(applyGot.error).toMatch(/CDN replacement/);
            expect(applyGot.reason).toBe('transfer-failed');
        });
    });

    test('a page URL that is not even parseable is wrong-origin', async () => {
        const fake = fakeMpPage([], '%%not a url%%');
        const { reason, error } = await capture(() =>
            prepareArticleMedia(fake.page, SESSION, { html: '<p>x</p>', coverPath: 'c.png', localImages: {} }),
        );
        expect(reason).toBe('wrong-origin');
        expect(error).toMatch(/not usable/);
    });
});

describe('CGI media browser fixtures (real Chromium, route-mocked mp origin)', () => {
    let browser: Browser | undefined;

    const launchedBrowser = (): Browser => {
        if (browser === undefined) throw new Error('Chromium fixture browser failed to launch');
        return browser;
    };

    beforeAll(async () => {
        browser = await launchChromium();
    }, 30_000);

    afterAll(async () => {
        await browser?.close();
    });

    test('endpoints: exact query/multipart keys, actual-dims crop math, DOM normalization, dedup, replacements', async () => {
        const html =
            '<p onclick="evil()" data-uri="data:text/html,<script>x</script>">intro</p>' +
            '<div onclick="steal()">keep me</div>' +
            '<a href="https://example.com/page"><b>bold</b> link</a>' +
            '<a href="javascript:alert(1)">bad</a>' +
            '<img src="https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/kept.png">' +
            '<img src="asset-1.png">' +
            '<img src="https://pub.example/pic.png">' +
            '<img src="https://pub.example/pic.png">';
        const expectedHtml =
            '<p>intro</p><div>keep me</div><span><b>bold</b> link</span><a>bad</a>' +
            '<img src="https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/kept.png">' +
            '<img src="https://mmbiz.qpic.cn/mmbiz_png/kkfixture/body.png">' +
            '<img src="https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png">' +
            '<img src="https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png">';
        await withImages({ 'cover.png': 4096, 'asset-1.png': 2048 }, async (path) => {
            const facts = await runPrepareScenario(
                launchedBrowser(),
                {},
                {
                    html,
                    coverPath: path('cover.png'),
                    localImages: { 'asset-1.png': path('asset-1.png') },
                },
            );
            expect(facts.error).toBeUndefined();
            expect(facts.requests.map((r) => r.path)).toEqual([
                ENDPOINTS.filetransfer,
                ENDPOINTS.cropimage,
                ENDPOINTS.filetransfer,
                ENDPOINTS.uploadimg2cdn,
            ]);

            const ft1 = nth(facts.requests, 0);
            expect(Object.keys(ft1.query).sort()).toEqual([
                'action',
                'f',
                'groupid',
                'lang',
                'scene',
                'seq',
                'svr_time',
                't',
                'ticket',
                'ticket_id',
                'token',
                'writetype',
            ]);
            expect(ft1.query.action).toBe('upload_material');
            expect(ft1.query.f).toBe('json');
            expect(ft1.query.scene).toBe('8');
            expect(ft1.query.writetype).toBe('doublewrite');
            expect(ft1.query.groupid).toBe('1');
            expect(ft1.query.lang).toBe('zh_CN');
            expect(ft1.query.ticket).toBe(SESSION.ticket);
            expect(ft1.query.ticket_id).toBe(SESSION.userName);
            expect(ft1.query.token).toBe(SESSION.token);
            expect(ft1.query.svr_time).toMatch(/^\d+$/);
            expect(ft1.query.seq).toMatch(/^\d+$/);
            expect(ft1.query.t).toMatch(/^\d+$/);
            expect(Object.keys(ft1.fields).sort()).toEqual(['id', 'lastModifiedDate', 'name', 'size', 'type']);
            expect(ft1.fields.type).toBe('image/png');
            expect(ft1.fields.name).toBe('cover.png');
            expect(ft1.fields.size).toBe('4096');
            expect(ft1.fields.id).toMatch(/^kk_\d+_\d+$/);
            expect(ft1.fileFields).toEqual(['file']);
            expect(ft1.bodyBytes).toBeGreaterThanOrEqual(4096);

            const ci = nth(facts.requests, 1);
            expect(ci.query).toEqual({ action: 'crop_multi' });
            expect(Object.keys(ci.fields).sort()).toEqual([
                'ajax',
                'f',
                'imgurl',
                'lang',
                'size0_x1',
                'size0_x2',
                'size0_y1',
                'size0_y2',
                'size1_x1',
                'size1_x2',
                'size1_y1',
                'size1_y2',
                'size_count',
                'token',
            ]);
            expect(ci.fields.imgurl).toBe(FILETRANSFER_RECEIPT.cdn_url);
            expect(ci.fields.size_count).toBe('2');
            // Centered crops derived from the receipt's ACTUAL 1000x800 dims (never vendor pixels).
            expect(ci.fields.size0_x1).toBe('0'); // wide 2.35:1
            expect(ci.fields.size0_y1).toBe('187');
            expect(ci.fields.size0_x2).toBe('1000');
            expect(ci.fields.size0_y2).toBe('613');
            expect(ci.fields.size1_x1).toBe('100'); // square 1:1
            expect(ci.fields.size1_y1).toBe('0');
            expect(ci.fields.size1_x2).toBe('900');
            expect(ci.fields.size1_y2).toBe('800');
            expect(ci.fileFields).toEqual([]);

            const ui = nth(facts.requests, 3);
            expect(Object.keys(ui.query).sort()).toEqual(['lang', 't', 'token']);
            expect(ui.query.lang).toBe('zh_CN');
            expect(ui.query.token).toBe(SESSION.token);
            expect(ui.query.t).toMatch(/^\d+$/);
            expect(Object.keys(ui.fields).sort()).toEqual(['ajax', 'f', 'imgurl', 'lang', 't', 'token']);
            expect(ui.fields.imgurl).toBe('https://pub.example/pic.png');
            expect(ui.fields.t).toBe('ajax-editor-upload-img');
            expect(ui.fields.f).toBe('json');
            expect(ui.fields.ajax).toBe('1');
            expect(ui.fileFields).toEqual([]);

            expect(facts.result?.cover.wide).toEqual({
                fileId: 'wide-1',
                url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/wide.png',
                width: 1000,
                height: 426,
            });
            expect(facts.result?.cover.square).toEqual({
                fileId: 'sq-1',
                url: 'https://mmbiz.qpic.cn/mmbiz_jpg/kkfixture/square.png',
                width: 800,
                height: 800,
            });
            expect(facts.result?.images).toEqual([
                {
                    fileId: '7788',
                    url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/body.png',
                    width: 500,
                    height: 400,
                },
                { fileId: 'cdn-9', url: 'https://mmbiz.qpic.cn/mmbiz_png/kkfixture/pub.png', width: 0, height: 0 },
            ]);
            // Event-handler/data-URI attributes stripped; a javascript: href is dropped as a dangerous
            // attribute (leaving a href-less anchor), other anchors became spans with markup preserved;
            // CDN image untouched, duplicates replaced, mapped + public migrated.
            expect(facts.result?.html).toBe(expectedHtml);
        });
    }, 90_000);

    test('a failed required body image throws after prior uploads; no mutated HTML is ever returned', async () => {
        await withImages({ 'cover.png': 1024, 'asset-1.png': 2048 }, async (path) => {
            const facts = await runPrepareScenario(
                launchedBrowser(),
                { [ENDPOINTS.uploadimg2cdn]: [{ status: 500, body: 'server exploded' }] },
                {
                    html: '<img src="asset-1.png"><img src="https://pub.example/pic.png">',
                    coverPath: path('cover.png'),
                    localImages: { 'asset-1.png': path('asset-1.png') },
                },
            );
            expect(facts.reason).toBe('transfer-failed');
            expect(facts.error).toContain('HTTP 500');
            expect(facts.result).toBeUndefined();
            // The mapped image uploaded first; the public transfer failed; nothing replaced anything.
            expect(facts.requests.map((r) => r.path)).toEqual([
                ENDPOINTS.filetransfer,
                ENDPOINTS.cropimage,
                ENDPOINTS.filetransfer,
                ENDPOINTS.uploadimg2cdn,
            ]);
        });
    }, 60_000);

    test('a >2 MiB uploadimg2cdn response trips the byte bound in-page', async () => {
        await withImages({ 'cover.png': 1024 }, async (path) => {
            const facts = await runPrepareScenario(
                launchedBrowser(),
                { [ENDPOINTS.uploadimg2cdn]: [{ bytes: 3 * 1024 * 1024 }] },
                {
                    html: '<img src="https://pub.example/pic.png">',
                    coverPath: path('cover.png'),
                    localImages: {},
                },
            );
            expect(facts.reason).toBe('transfer-failed');
            expect(facts.error).toMatch(/2097152-byte bound/);
            expect(facts.requests.map((r) => r.path)).toEqual([
                ENDPOINTS.filetransfer,
                ENDPOINTS.cropimage,
                ENDPOINTS.uploadimg2cdn,
            ]);
        });
    }, 60_000);

    test('a >2 MiB filetransfer response trips the CGI response bound', async () => {
        await withImages({ 'cover.png': 1024 }, async (path) => {
            const facts = await runPrepareScenario(
                launchedBrowser(),
                { [ENDPOINTS.filetransfer]: [{ bytes: 3 * 1024 * 1024 }] },
                { html: '<p>x</p>', coverPath: path('cover.png'), localImages: {} },
            );
            expect(facts.reason).toBe('response-too-large');
            expect(facts.requests.map((r) => r.path)).toEqual([ENDPOINTS.filetransfer]);
        });
    }, 60_000);

    test('the 180 s total deadline refuses before any CGI dispatch', async () => {
        const facts = await runDeadlineScenario(launchedBrowser(), {
            html: '<p>x</p>',
            coverPath: 'unused-cover.png',
            localImages: {},
        });
        expect(facts.reason).toBe('deadline-exceeded');
        expect(facts.requests).toEqual([]);
    }, 60_000);

    test('more than 30 distinct body sources refuse through the real DOMParser count', async () => {
        const facts = await runPrepareScenario(
            launchedBrowser(),
            {},
            {
                html: tooManyHtml,
                coverPath: 'unused-cover.png',
                localImages: {},
            },
        );
        expect(facts.reason).toBe('too-many-sources');
        expect(facts.requests).toEqual([]);
    }, 60_000);

    test('a non-mp origin page refuses every credentialed entry point before any dispatch', async () => {
        const { reasons } = await runForeignOriginScenario(launchedBrowser());
        expect(reasons).toEqual(['wrong-origin', 'wrong-origin', 'wrong-origin']);
    }, 60_000);
});

describe('CGI media fixture runner prerequisites', () => {
    test('a missing Chromium is an actionable failure, never a silent skip', () => {
        const script = `const m = await import(${JSON.stringify(RUNNER)}); await m.launchChromium();`;
        const proc = Bun.spawnSync(['bun', '-e', script], {
            cwd: join(import.meta.dir, '..'),
            env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-kk-browsers' },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).not.toBe(0);
        const stderr = proc.stderr.toString();
        expect(stderr.length).toBeGreaterThan(0);
        expect(stderr.toLowerCase()).toContain('launch');
    }, 30_000);
});
