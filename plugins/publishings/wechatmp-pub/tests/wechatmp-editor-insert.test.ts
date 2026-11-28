/**
 * The editor-insertion primitives behind `insertBody`'s fallback (measured 2026-11-12).
 *
 * `appmsg_edit_v2` ignores the synthetic paste, so the body only lands through the browser's own
 * editing commands. These three helpers are the proof of that path — the placeholder-widget count
 * that caught the false "paste succeeded", and the two `execCommand` scripts — and they were only
 * exercised when a real Chromium run happened to take the fallback branch, which made
 * `wechatmp-pub/src/flow.ts` flake below the 90% per-file coverage gate. Pinning them here is
 * deterministic: no browser, no timing.
 *
 * Task 0423 R1 added the real-Chromium fixtures below: the placeholder widget makes `pasteHtml`
 * resolve with `bodyLength === 0`, which is exactly the state in which `insertBody` used to return
 * early and save an empty draft body.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import {
    assertInlineFigureMarkers,
    bodyImageSrcs,
    bodyLength,
    type InlineFigure,
    inlineFiguresOf,
    insertBody,
    insertHtmlScript,
    insertTextScript,
    type ModeRunDeps,
    nativeLegacyEditorReadyScript,
    verifyInlineFigureDom,
    waitForInlineFigureSrcs,
    withInlineFigureHtml,
} from '../src/flow';
import { wrapPlaywrightPage } from '../src/page';
import { launchChromium } from './fixtures/wechatmp-cgi-runner';

/** The page type stays private to flow.ts; only `evaluate` matters to these helpers. */
type EditorPage = Parameters<typeof bodyLength>[0];
const pageReturning = (value: unknown): EditorPage => ({ evaluate: async () => value }) as unknown as EditorPage;

describe('wechatmp editor insertion primitives', () => {
    test('insertHtmlScript targets the block and calls the native insertHTML command', () => {
        const script = insertHtmlScript('div.ProseMirror', '<p>你好</p>');
        expect(script).toContain('document.querySelector("div.ProseMirror")');
        expect(script).toContain("document.execCommand('insertHTML'");
        expect(script).toContain('"<p>你好</p>"');
        expect(script).toContain("return 'missing'");
    });

    test('insertTextScript is the plain-text last resort, never HTML', () => {
        const script = insertTextScript('div.ProseMirror', '纯文本');
        expect(script).toContain("document.execCommand('insertText'");
        expect(script).not.toContain('insertHTML');
        expect(script).toContain('"纯文本"');
    });

    test('a quoted selector stays inside the generated querySelector argument', () => {
        const script = insertHtmlScript('div[data-x="a b"]', '<p>x</p>');
        expect(script).toContain('document.querySelector("div[data-x=\\"a b\\"]")');
        expect(script.match(/document\.querySelector\(/g)).toHaveLength(1);
    });

    test('bodyLength reports the editor character count the page returns', async () => {
        expect(await bodyLength(pageReturning(42), 'div.ProseMirror')).toBe(42);
    });

    test('a dead page counts as empty instead of throwing (the false-positive guard)', async () => {
        const dead = {
            evaluate: async () => Promise.reject(new Error('Target page closed')),
        } as unknown as EditorPage;
        expect(await bodyLength(dead, 'div.ProseMirror')).toBe(0);
    });

    test('a non-numeric page answer degrades to 0 rather than NaN', async () => {
        expect(await bodyLength(pageReturning(''), 'div.ProseMirror')).toBe(0);
    });
});

/**
 * `insertBody` against a real Chromium page (0423 AC1).
 *
 * `ignore-paste` is the measured `appmsg_edit_v2` build: the synthetic paste is dropped, but the
 * editor's placeholder widget keeps `textContent` non-empty, so `pasteHtml` resolves happily while
 * the article body is still empty. `ignore-all` is the same build with the editing commands also
 * refused — the state that must throw instead of saving an empty draft.
 */
const ARTICLE_BODY = '第一段正文内容，用来证明正文真的落到了编辑器里。';

function editorHtml(mode: string): string {
    const script =
        mode === 'ignore-paste-and-html'
            ? `<script>
                document.execCommand = (command, _ui, value) => {
                    if (command !== 'insertText') return false;
                    document.querySelector('.ProseMirror').textContent = value;
                    return true;
                };
            </script>`
            : mode === 'ignore-all'
              ? `<script>document.execCommand = () => false;</script>`
              : mode === 'plain-paste-then-html'
                ? `<script>
                    document.addEventListener('DOMContentLoaded', () => {
                        const pm = document.querySelector('.ProseMirror');
                        pm.addEventListener('paste', (e) => {
                            const plain = e.clipboardData?.getData('text/plain') || '';
                            pm.appendChild(document.createTextNode(plain));
                        });
                    });
                    const origExec = document.execCommand.bind(document);
                    document.execCommand = (cmd, ui, val) => origExec(cmd, ui, val);
                </script>`
                : '';
    // No paste listener at all: the browser's default paste on a contenteditable is what the real
    // console intercepts, and dropping the event is the closest deterministic model of that.
    return `<!doctype html><meta charset="utf-8"><body>
<div class="ProseMirror ProseMirror-focused" contenteditable="true" style="min-height:200px"><span class="editor_content_placeholder">从这里开始写正文</span></div>
${script}
</body>`;
}

const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
        const mode = new URL(request.url).searchParams.get('mode') ?? 'ignore-paste';
        return new Response(editorHtml(mode), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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

/** Only `content` and `stepTimeoutMs` reach `insertBody`; the rest of the seam is unused here. */
const insertDeps = (body: string): ModeRunDeps =>
    ({ content: { title: '标题', body }, stepTimeoutMs: 5_000 }) as unknown as ModeRunDeps;

async function openEditorPage(mode: string) {
    const page = await browser.newPage();
    await page.goto(`${server.url}?mode=${mode}`);
    return wrapPlaywrightPage(page);
}

describe('wechatmp insertBody fallback after pasteHtml (real Chromium)', () => {
    test('a paste that leaves only the placeholder widget falls through to insertHTML', async () => {
        const page = await openEditorPage('ignore-paste');
        await insertBody(page, insertDeps(ARTICLE_BODY));
        expect(await bodyLength(page, 'div.ProseMirror')).toBeGreaterThan(0);
        expect(await page.evaluate("document.querySelector('.ProseMirror').textContent")).toContain(
            '正文真的落到了编辑器里',
        );
    });

    test('a build that also refuses insertHTML still lands the body through insertText', async () => {
        const page = await openEditorPage('ignore-paste-and-html');
        await insertBody(page, insertDeps(ARTICLE_BODY));
        expect(await bodyLength(page, 'div.ProseMirror')).toBeGreaterThan(0);
    });

    test('a build that refuses every insertion throws instead of returning an empty body', async () => {
        const page = await openEditorPage('ignore-all');
        await expect(insertBody(page, insertDeps(ARTICLE_BODY))).rejects.toThrow(/stayed empty after paste/);
    });

    test('a paste that lands only unformatted plain text is cleared before insertHTML so content never duplicates', async () => {
        const page = await openEditorPage('plain-paste-then-html');
        await insertBody(page, insertDeps(ARTICLE_BODY));
        const text = String(await page.evaluate("document.querySelector('.ProseMirror').textContent"));
        const occurrences = text.split('正文真的落到了编辑器里').length - 1;
        expect(occurrences).toBe(1);
    });
});

describe('wechatmp legacy editor readiness probe', () => {
    // Bun runs every test file in one process, so a `window` left on globalThis breaks any later
    // file importing a browser-shaped library — remotion's CJS entry reads `window.addEventListener`
    // at import time (run 46103961439). Restore the two globals this test fakes.
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window;
        delete (globalThis as { document?: unknown }).document;
    });

    test('accepts a canonical saved editor with hidden autosave markers and one save control', () => {
        // Exercise the generated probe in Bun, so its hidden/text predicates are covered without a
        // browser. This is the measured legacy `media/appmsg_edit` readiness contract.
        const styleFor = (hidden: boolean) => ({
            display: hidden ? 'none' : 'block',
            visibility: hidden ? 'hidden' : 'visible',
        });
        const rectFor = (hidden: boolean) => ({ width: hidden ? 0 : 100, height: hidden ? 0 : 20 });
        const autoSave = { textContent: '' };
        const legacyAutoSave = {};
        const saveSuccess = {};
        const saveControl = {
            textContent: '保存为草稿',
            style: styleFor(false),
            rect: rectFor(false),
        };
        (globalThis as unknown as { document: unknown }).document = {
            querySelector: (selector: string) =>
                selector === '#auto_save_container'
                    ? autoSave
                    : selector === '#js_autosave'
                      ? legacyAutoSave
                      : selector === '#js_save_success, #js_save_success_with_ad, #js_save_success_with_ad_op'
                        ? saveSuccess
                        : null,
            querySelectorAll: (selector: string) =>
                selector === '#js_save_success, #js_save_success_with_ad, #js_save_success_with_ad_op'
                    ? [saveSuccess]
                    : selector === 'button, a'
                      ? [saveControl]
                      : [],
        };
        (globalThis as unknown as { window: unknown }).window = {
            location: {
                href: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&appmsgid=100001161',
            },
            getComputedStyle: (node: { style?: unknown; rect?: unknown }) => ({
                ...(node.style as object),
                getPropertyValue: () => '',
            }),
        };
        for (const node of [legacyAutoSave, saveSuccess]) {
            (node as { style?: unknown }).style = styleFor(true);
            (node as { rect?: unknown }).rect = rectFor(true);
        }
        // `getBoundingClientRect` is read separately from getComputedStyle in the probe.
        for (const node of [legacyAutoSave, saveSuccess]) {
            (node as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => rectFor(true);
        }
        (saveControl as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => rectFor(false);
        // The probe reads style.display/visibility AND the rect; keep both on the same object.
        const result = new Function('probe', 'return eval(probe)')(nativeLegacyEditorReadyScript());
        expect(result).toBe('ready');
    });
});

describe('0426 R2 — inline figures in the WeChat article', () => {
    const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

    /** A figure + its on-disk image, and the pinned metadata the variant would carry. */
    function figureFixture(dir: string, index: number): { meta: Record<string, string>; figure: InlineFigure } {
        const id = `figure-${index}`;
        const path = join(dir, `${id}.png`);
        writeFileSync(path, `png-${index}`);
        const meta = {
            id,
            path,
            sha256: sha(`png-${index}`),
            altText: `alt ${index}`,
            caption: `图注 ${index}`,
        };
        return { meta, figure: { id, path, sha256: meta.sha256, altText: meta.altText, caption: meta.caption } };
    }

    async function withDirAsync(fn: (dir: string) => Promise<void>): Promise<void> {
        const dir = mkdtempSync(join(tmpdir(), 'kk-inline-figures-'));
        try {
            await fn(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    const content = (figures: Record<string, string>[]): Parameters<typeof inlineFiguresOf>[0] => ({
        body: '',
        format: 'markdown',
        metadata: { wechatmp: { inlineFigures: figures } },
    });

    test('reads the pinned metadata and refuses a missing field, a reordered id or a changed binary', async () => {
        await withDirAsync(async (dir) => {
            const first = figureFixture(dir, 1);
            expect(await inlineFiguresOf(content([first.meta]))).toEqual([first.figure]);

            const missing = { ...first.meta, altText: '' };
            await expect(inlineFiguresOf(content([missing]))).rejects.toThrow('metadata has no altText');

            const reordered = { ...first.meta, id: 'figure-2' };
            await expect(inlineFiguresOf(content([reordered]))).rejects.toThrow("expected id 'figure-1' at position 1");

            writeFileSync(first.meta.path as string, 'swapped');
            await expect(inlineFiguresOf(content([first.meta]))).rejects.toThrow(
                'image bytes changed since the review',
            );

            const gone = { ...first.meta, path: join(dir, 'nope.png') };
            await expect(inlineFiguresOf(content([gone]))).rejects.toThrow('image is unreadable');
        });
    });

    test('a content without the key carries no figures (the plain article path stays untouched)', async () => {
        expect(await inlineFiguresOf({ body: '', format: 'markdown', metadata: {} })).toEqual([]);
        expect(await inlineFiguresOf({ body: '', format: 'markdown', metadata: { wechatmp: {} } })).toEqual([]);
    });

    test('every pinned figure must be referenced once, in order, and no stray marker may exist', () => {
        const figures: InlineFigure[] = [
            { id: 'figure-1', path: '/a.png', sha256: 'a', altText: 'a', caption: 'a' },
            { id: 'figure-2', path: '/b.png', sha256: 'b', altText: 'b', caption: 'b' },
        ];
        const ok = 'p1\n\n![alt](kk-inline:figure-1)\n\nc1\n\np2\n\n![alt](kk-inline:figure-2)\n\nc2';
        expect(() => assertInlineFigureMarkers(ok, figures)).not.toThrow();
        expect(() => assertInlineFigureMarkers(ok, figures.slice(0, 1))).toThrow('carries 2 figure marker(s)');
        expect(() =>
            assertInlineFigureMarkers('![alt](kk-inline:figure-2)\n\n![alt](kk-inline:figure-1)', figures),
        ).toThrow("marker 1 in the body is 'figure-2'");
    });

    test('renders the uploaded image and caption at the marker, escaping both texts', () => {
        const figures: InlineFigure[] = [
            { id: 'figure-1', path: '/a.png', sha256: 'a', altText: 'a<b>&"', caption: '图注 <1>' },
        ];
        const html = withInlineFigureHtml('段落\n\n![x](kk-inline:figure-1)\n\n尾巴', figures, [
            'https://mmbiz/qpic?a=1&b=2',
        ]);
        expect(html).toContain(
            '<img src="https://mmbiz/qpic?a=1&amp;b=2" alt="a&lt;b&gt;&amp;&quot;" data-kk-figure="figure-1">',
        );
        expect(html).toContain('<p>图注 &lt;1&gt;</p>');
        expect(html).toContain('段落');
        expect(html).toContain('尾巴');
        expect(() => withInlineFigureHtml('no marker here', figures, ['https://x'])).toThrow('marker is missing');
        expect(() => withInlineFigureHtml('![x](kk-inline:figure-1)', figures, [])).toThrow(
            'need 1 uploaded URL(s), got 0',
        );
    });

    test('reads the uploaded URLs from the editor DOM in order, and degrades a dead page to none', async () => {
        const page = (value: unknown): EditorPage => ({ evaluate: async () => value }) as unknown as EditorPage;
        expect(await bodyImageSrcs(page(['https://a', 'https://b']), ['div.ProseMirror'])).toEqual([
            'https://a',
            'https://b',
        ]);
        const dead = { evaluate: async () => Promise.reject(new Error('closed')) } as unknown as EditorPage;
        expect(await bodyImageSrcs(dead, ['div.ProseMirror'])).toEqual([]);
    });

    test('the DOM check refuses a text-only body, a swapped URL and a changed caption', async () => {
        const figures: InlineFigure[] = [
            { id: 'figure-1', path: '/a.png', sha256: 'a', altText: 'alt 1', caption: '图注 1' },
        ];
        const srcs = ['https://mmbiz/1'];
        const ok = [{ id: 'figure-1', src: 'https://mmbiz/1', alt: 'alt 1', caption: '图注 1' }];
        const page = (value: unknown): EditorPage => ({ evaluate: async () => value }) as unknown as EditorPage;
        await expect(verifyInlineFigureDom(page(ok), ['div.ProseMirror'], figures, srcs)).resolves.toBeUndefined();
        await expect(verifyInlineFigureDom(page([]), ['div.ProseMirror'], figures, srcs)).rejects.toThrow(
            'the editor holds 0 figure node(s)',
        );
        await expect(
            verifyInlineFigureDom(page([{ ...ok[0], src: 'https://evil/1' }]), ['div.ProseMirror'], figures, srcs),
        ).rejects.toThrow("figure-1 shows 'https://evil/1'");
        await expect(
            verifyInlineFigureDom(page([{ ...ok[0], caption: '别的图注' }]), ['div.ProseMirror'], figures, srcs),
        ).rejects.toThrow('caption reads');
        await expect(
            verifyInlineFigureDom(page([{ ...ok[0], id: 'figure-2' }]), ['div.ProseMirror'], figures, srcs),
        ).rejects.toThrow("editor position 1 holds 'figure-2'");
        await expect(
            verifyInlineFigureDom(page([{ ...ok[0], alt: 'wrong alt' }]), ['div.ProseMirror'], figures, srcs),
        ).rejects.toThrow('alt text reads');
    });

    test('waits for the uploads and returns the newest URLs in order; a timeout refuses', async () => {
        const deps = { stepTimeoutMs: 2000 } as unknown as ModeRunDeps;
        const ready = { evaluate: async () => ['https://a', 'https://b'] } as unknown as EditorPage;
        expect(await waitForInlineFigureSrcs(ready, 2, deps)).toEqual(['https://a', 'https://b']);

        const never = { evaluate: async () => [] } as unknown as EditorPage;
        await expect(
            waitForInlineFigureSrcs(never, 1, { stepTimeoutMs: 50 } as unknown as ModeRunDeps),
        ).rejects.toThrow('uploaded 0 of 1 figure image(s)');
    });
});
