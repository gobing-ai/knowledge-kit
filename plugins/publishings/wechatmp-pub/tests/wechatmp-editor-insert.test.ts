/**
 * The editor-insertion primitives behind `insertBody`'s fallback (measured 2026-11-12).
 *
 * `appmsg_edit_v2` ignores the synthetic paste, so the body only lands through the browser's own
 * editing commands. These three helpers are the proof of that path — the placeholder-widget count
 * that caught the false "paste succeeded", and the two `execCommand` scripts — and they were only
 * exercised when a real Chromium run happened to take the fallback branch, which made
 * `wechatmp-pub/src/flow.ts` flake below the 90% per-file coverage gate. Pinning them here is
 * deterministic: no browser, no timing.
 */
import { describe, expect, test } from 'bun:test';
import { bodyLength, insertHtmlScript, insertTextScript } from '../src/flow';

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
