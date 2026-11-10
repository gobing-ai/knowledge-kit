/**
 * Repair v2 — 图文笔记 draft: purge dead image slots, re-upload 7 cards, verify live previews.
 * Completion signal (observed): img.preview with naturalWidth > 0, no upload progress.
 */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const OUT = '/tmp/xhs-repair';
const W = '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109';
const IMAGES = [
    `${W}/25-xhs/cards/card-01-xhs-card-01.png`,
    `${W}/25-xhs/cards/card-02-xhs-card-01.png`,
    `${W}/25-xhs/cards/card-03-xhs-card-01.png`,
    `${W}/25-xhs/cards/card-04-xhs-card-01.png`,
    `${W}/25-xhs/cards/card-05-xhs-card-01.png`,
    `${W}/25-xhs/cards/card-06-xhs-card-01.png`,
    `${W}/23-cover/20261109_07_cover_cover.png`,
];
const log = (...a: unknown[]) => console.log('[fix-img]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (p: import('playwright').Page, n: string) => {
    await p.screenshot({ path: `${OUT}/${n}.png` });
};

async function openEditor(page: import('playwright').Page) {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 6000 });
    await sleep(1500);
    await page.locator('text=图文笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(3000);
}

const state = () =>
    // biome-ignore lint/suspicious/noExplicitAny: probe script
    (page.evaluate as any)(() => ({
        live: Array.from(document.querySelectorAll('img.preview')).filter((i) => i.naturalWidth > 0).length,
        dead: Array.from(document.querySelectorAll('img.preview')).filter((i) => i.naturalWidth === 0).length,
    }));

let page: import('playwright').Page;
const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
page = await context.newPage();
const result: Record<string, unknown> = {};
try {
    await openEditor(page);
    result.before = await state();
    log('before:', JSON.stringify(result.before));

    // Purge dead slots. The delete affordance appears on hover; dump it on the first pass.
    let overlayDumped = false;
    let guard = 0;
    while (((await state()) as { dead: number }).dead > 0 && guard++ < 80) {
        const slot = page.locator('.format-img').first();
        const box = await slot.boundingBox();
        if (!box) throw new Error('slot not visible');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(600);
        if (!overlayDumped) {
            const overlay = await page.evaluate(() => {
                const mask = document.querySelector('.hover-mask');
                return {
                    maskHtml: mask ? mask.outerHTML.slice(0, 1500) : null,
                };
            });
            log('hover mask:', JSON.stringify(overlay));
            overlayDumped = true;
        }
        // Click the delete affordance inside the hovered slot's mask.
        const clicked = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.format-img'));
            const item = items.find((i) => {
                const r = i.getBoundingClientRect();
                return r.width > 0;
            });
            if (!item) return { done: false, how: 'no-slot' };
            const mask = (item.querySelector('.hover-mask') ||
                item.parentElement?.querySelector('.hover-mask')) as HTMLElement | null;
            const scope: ParentNode = mask || item;
            const cands = Array.from(scope.querySelectorAll<HTMLElement>('div,span,svg,button,i')).filter((e) => {
                const c = String(e.className);
                const r = e.getBoundingClientRect();
                return r.width > 0 && /del|trash|remove|close|shanchu/i.test(c);
            });
            if (cands.length > 0) {
                const r = cands[0].getBoundingClientRect();
                return {
                    done: true,
                    how: String(cands[0].className).slice(0, 60),
                    xy: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
                };
            }
            // Mask children dump for diagnosis.
            return {
                done: false,
                how: 'no-affordance',
                kids: mask
                    ? Array.from(mask.querySelectorAll('*'))
                          .map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}`)
                          .slice(0, 12)
                    : [],
            };
        });
        log('delete click:', JSON.stringify(clicked));
        if (!clicked.done) {
            if (!('kids' in clicked) || (clicked.kids as unknown[]).length === 0)
                throw new Error('no affordance and empty mask dump');
            break;
        }
        if (Array.isArray(clicked.xy)) {
            await page.mouse.click(clicked.xy[0], clicked.xy[1]);
        }
        // Confirm dialog if any.
        for (const label of ['确定', '删除', '确认']) {
            const btn = page.locator(`button:has-text("${label}")`).first();
            if ((await btn.count()) > 0) {
                await btn.click({ timeout: 2000 }).catch(() => {});
                break;
            }
        }
        await sleep(1800);
        result.afterPurge = await state();
        result.before = result.afterPurge;
    }
    result.afterPurge = await state();
    log('after purge pass:', JSON.stringify(result.afterPurge));
    await shot(page, 'fix-img-purged');
    // XHS refuses to delete the LAST remaining image slot, so if only one dead slot is left,
    // upload the fresh set first and remove the dead slot afterwards.
    const afterPurge = result.afterPurge as { live: number; dead: number };
    if (afterPurge.dead > 1) throw new Error(`could not purge dead slots: ${afterPurge.dead} left`);

    // Upload fresh only if the previous session's uploads did not autosave-persist.
    if (afterPurge.live < IMAGES.length) {
        const input = page.locator('input[type="file"][accept*=".jpg"]').first();
        await input.setInputFiles(IMAGES);
        log('setInputFiles 7');
        // Wait for 7 LIVE previews (real completion: CDN-backed, naturalWidth > 0).
        const started = Date.now();
        while (Date.now() - started < 120_000) {
            const s = await state();
            log(`@${Math.round((Date.now() - started) / 1000)}s live=${s.live} dead=${s.dead}`);
            if (s.live >= IMAGES.length) break;
            await sleep(2500);
        }
    }
    result.afterUpload = await state();
    log('after upload:', JSON.stringify(result.afterUpload));
    await shot(page, 'fix-img-uploaded');
    if ((result.afterUpload as { live: number }).live < IMAGES.length) throw new Error('not all previews went live');

    // Now that live slots exist, remove any leftover dead slot.
    let dguard = 0;
    while (((await state()) as { dead: number }).dead > 0 && dguard++ < 20) {
        const _deadSlot = page
            .locator('.format-img')
            .filter({ has: page.locator('img.preview[naturalwidth="0"], img.preview') })
            .first();
        // Find the dead slot's close-btn by evaluating rects.
        const target = await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            if (!dead) return null;
            const container = dead.closest('.img-container');
            const btn = container ? (container.querySelector('.close-btn') as HTMLElement | null) : null;
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
        });
        if (!target) break;
        // The close-btn straddles the slot's top-right corner; its center lands on the neighboring
        // slot. Move in two steps (activate :hover) then click the inner sliver of the button.
        await page.mouse.move(target[0] - 30, target[1] + 20);
        await sleep(300);
        await page.mouse.move(target[0] - 4, target[1] + 4);
        await sleep(400);
        await page.mouse.click(target[0] - 4, target[1] + 4);
        // Fallback: synthetic full pointer sequence on the button itself.
        await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            const container = dead ? dead.closest('.img-container') : null;
            const btn = container ? (container.querySelector('.close-btn') as HTMLElement | null) : null;
            if (!btn) return;
            const seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
            for (const type of seq) {
                btn.dispatchEvent(
                    new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        clientX: btn.getBoundingClientRect().x + 2,
                        clientY: btn.getBoundingClientRect().y + 8,
                    }),
                );
            }
        });
        log(`dead-slot click near ${target}`);
        await sleep(1800);
    }
    result.afterDeadPurge = await state();
    log('after dead purge:', JSON.stringify(result.afterDeadPurge));

    // Save: the publish/save control lives in shadow DOM (plugin uses clickShadowControl).
    // Walk shadow roots for matching buttons, click by coordinates; fall back to autosave.
    const saveHit = await page.evaluate(() => {
        const labels = ['保存离开', '暂存离开', '存草稿', '保存草稿', '保存', '发布'];
        const out: { label: string; tag: string; cls: string; xy: number[] }[] = [];
        const visit = (root: Document | ShadowRoot) => {
            for (const el of Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], div, span'))) {
                const text = (el.textContent || '').trim();
                for (const label of labels) {
                    if (text === label && el.getBoundingClientRect().width > 0) {
                        const r = el.getBoundingClientRect();
                        out.push({
                            label,
                            tag: el.tagName,
                            cls: String(el.className).slice(0, 40),
                            xy: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
                        });
                    }
                }
                if (el.shadowRoot) visit(el.shadowRoot);
            }
        };
        visit(document);
        return out;
    });
    log('save candidates (shadow walk):', JSON.stringify(saveHit.slice(0, 12)));
    const pick =
        saveHit.find((s) => s.label === '保存离开') ||
        saveHit.find((s) => s.label === '暂存离开') ||
        saveHit.find((s) => s.label === '存草稿') ||
        saveHit.find((s) => s.label === '保存草稿') ||
        saveHit.find((s) => s.label === '保存');
    if (pick) {
        await page.mouse.click(pick.xy[0], pick.xy[1]);
        log(`clicked save control: ${pick.label} at ${pick.xy}`);
    } else {
        log('no explicit save control — relying on autosave');
    }
    await sleep(6000);
    await shot(page, 'fix-img-saved');

    // Acceptance: reopen the editor and verify live previews persisted.
    await openEditor(page);
    result.reopened = await state();
    log('reopened:', JSON.stringify(result.reopened));
    await shot(page, 'fix-img-verify');
    const re = result.reopened as { live: number; dead: number };
    result.ok = re.live >= 7 && re.dead === 0;
    log('VERIFY', result.ok ? 'PASS' : 'FAIL');
} catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    log('ERROR', result.error);
} finally {
    log('RESULT', JSON.stringify(result));
    await context.close().catch(() => {});
}
