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
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser } from 'playwright';
import {
    bodyLength,
    insertBody,
    insertHtmlScript,
    insertTextScript,
    type ModeRunDeps,
    nativeLegacyEditorReadyScript,
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
});

describe('wechatmp legacy editor readiness probe', () => {
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
