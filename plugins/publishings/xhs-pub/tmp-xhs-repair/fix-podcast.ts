/**
 * fix-podcast.ts — repair the 播客笔记 draft:
 * cover re-upload (filechooser) → title → body (tiptap insertText) → 合集 selection → _onSave.
 * Then reopen and verify text fields + cover row existence.
 */

import { readFileSync } from 'node:fs';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const COVER =
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109/23-cover/20261109_07_cover_cover.png';
const TITLE = '每日AI乱炖 · 2026-11-09';
const COLLECTION = '咸话咸说之每日AI乱炖';
const BODY = readFileSync('/tmp/xhs-repair/podcast-body.txt', 'utf8');

const log = (...a: unknown[]) => console.log('[fixpod]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asPage = (p: unknown) => p as import('playwright').Page;

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = asPage((await context.pages()[0]) ?? (await context.newPage()));
const imgState = () =>
    page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img.preview, img.preivew-image'));
        let live = 0;
        let dead = 0;
        for (const i of imgs) i.naturalWidth > 0 ? live++ : dead++;
        return { live, dead };
    });
const invokeSave = () =>
    page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        for (const el of hosts) {
            for (const name of ['_onSave', '_onSaveDraft', '_onDraft']) {
                const fn = (el as unknown as Record<string, unknown>)[name];
                if (typeof fn === 'function') {
                    (fn as () => void).call(el);
                    return `called ${name}`;
                }
            }
        }
        return 'no save method found';
    });

const verify = async (label: string) => {
    const v = await page.evaluate(() => {
        const title = (document.querySelector('input.d-text') as HTMLInputElement | null)?.value ?? null;
        const body = (document.querySelector('div.tiptap.ProseMirror') as HTMLElement | null)?.textContent ?? '';
        const cover = Array.from(document.querySelectorAll('img.preview, img.preivew-image')).map((i) => ({
            nw: i.naturalWidth,
            src: (i.getAttribute('src') || '').slice(0, 60),
        }));
        const coll = /咸话咸说之每日AI乱炖/.test(document.body.textContent || '');
        return { title, bodyLen: body.length, bodyHead: body.slice(0, 40), cover, collVisible: coll };
    });
    log(`VERIFY ${label}:`, JSON.stringify(v));
    return v;
};

try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 6000 });
    await sleep(1500);
    await page.locator('text=播客笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(4000);
    log('opened. cover state:', JSON.stringify(await imgState()));

    // 1. Cover re-upload: hover slot → 编辑 → the modal mounts hidden image inputs → setInputFiles.
    const cbox = await page.evaluate(() => {
        const img = document.querySelector('img.preview, img.preivew-image') as HTMLElement | null;
        if (!img) return null;
        const r = img.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!cbox) throw new Error('cover slot not found');
    await page.mouse.move(cbox.x, cbox.y);
    await sleep(1000);
    await page.locator('button.edit-btn').first().click({ timeout: 5000 });
    log('编辑 clicked; waiting for modal inputs…');
    await sleep(2500);
    const imgInputCount = await page.locator('input[type="file"][accept*=".jpg"]').count();
    log('hidden image inputs:', imgInputCount);
    if (imgInputCount === 0) throw new Error('no hidden image input in 编辑 modal');
    let coverOk = false;
    for (let k = 0; k < imgInputCount && !coverOk; k++) {
        const inp = page.locator('input[type="file"][accept*=".jpg"]').nth(k);
        await inp
            .setInputFiles(COVER)
            .catch((e) => log(`input[${k}] setFiles failed:`, e instanceof Error ? e.message : String(e)));
        for (let t = 0; t < 15; t++) {
            await sleep(1000);
            const st = await imgState();
            if (st.live > 0) {
                coverOk = true;
                log(`cover live via input[${k}] at t=${t}s:`, JSON.stringify(st));
                break;
            }
        }
    }
    if (!coverOk) log('WARN: no hidden input produced a live cover — will check row at save');
    // Confirm the 编辑 modal.
    const okBtn = page.locator('button:has-text("确定")').last();
    if ((await okBtn.count()) > 0) {
        await okBtn.click({ timeout: 3000 }).catch(() => {});
        log('编辑 modal 确定 clicked');
    }
    await sleep(2000);

    // 2. Title.
    const titleCur = await page.evaluate(
        () => (document.querySelector('input.d-text') as HTMLInputElement | null)?.value ?? '',
    );
    if (titleCur.trim() !== TITLE) {
        const t = page.locator('input.d-text').first();
        await t.click({ timeout: 5000 });
        await page.keyboard.press('Meta+A');
        await page.keyboard.press('Backspace');
        await t.fill(TITLE);
        log('title set:', TITLE);
    } else {
        log('title already correct');
    }

    // 3. Body into tiptap.
    const ed = page.locator('div.tiptap.ProseMirror').first();
    await ed.click({ timeout: 5000 });
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Backspace');
    await page.evaluate((text) => {
        const el = document.querySelector('div.tiptap.ProseMirror') as HTMLElement | null;
        if (!el) throw new Error('no tiptap');
        el.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand('insertText', false, text);
    }, BODY);
    const bodyNow = await page.evaluate(
        () => (document.querySelector('div.tiptap.ProseMirror') as HTMLElement | null)?.textContent?.length ?? 0,
    );
    log('body typed, len:', bodyNow);

    // 4. 合集: open picker, search, select, confirm.
    await page.locator('text=选择合集').first().click({ timeout: 5000 });
    log('选择合集 clicked');
    await sleep(2500);
    const search = page.locator('input[placeholder*="搜索"], input[placeholder*="合集"]').first();
    if ((await search.count()) > 0) {
        await search.fill(COLLECTION).catch(() => {});
        await sleep(2000);
        log('picker search filled');
    }
    const row = page.locator(`text=${COLLECTION}`).first();
    if ((await row.count()) > 0) {
        await row.click({ timeout: 5000 });
        log('collection row clicked');
        await sleep(1200);
        const confirm = page.locator('button:has-text("确定"), button:has-text("完成")').last();
        if ((await confirm.count()) > 0) {
            await confirm.click({ timeout: 3000 }).catch(() => {});
            log('picker confirm clicked');
        }
        await sleep(2000);
    } else {
        log('WARN: collection row not found in picker');
    }

    // 5. Save via the closed-shadow host method.
    const saveMsg = await invokeSave();
    log('save:', saveMsg);
    await sleep(3000);
    const savedAt = await page.evaluate(
        () => (document.body.textContent || '').match(/保存于[^,。]{0,30}/)?.[0] ?? null,
    );
    log('save timestamp:', savedAt);
    await verify('pre-leave');

    // 6. Leave + reopen + verify.
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 6000 });
    await sleep(1500);
    await page.locator('text=播客笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(4000);
    const v = await verify('reopened');
    log('RESULT', JSON.stringify({ coverOk, bodyLen: v.bodyLen, title: v.title, collection: v.collVisible }));
} catch (e) {
    log('ERROR', e instanceof Error ? e.message : String(e));
} finally {
    await context.close().catch(() => {});
}
