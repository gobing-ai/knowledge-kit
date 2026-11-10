/**
 * fix-image-draft2.ts — CDP-backed save + diagnostics.
 * Flow: open editor → purge dead slots (keep last) → upload 7 → purge leftover →
 * CDP shadow-button inventory → click save control → reopen → verify + dump dead img srcs.
 */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const SHOT_DIR = '/tmp/xhs-repair';
const log = (...a: unknown[]) => console.log('[fix2]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shot = async (page: import('playwright').Page, name: string) =>
    page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false }).catch(() => {});

const CARDS = '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109/25-xhs/cards';
const COVER =
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109/23-cover/20261109_07_cover_cover.png';
const IMAGES = [
    `${CARDS}/card-01-xhs-card-01.png`,
    `${CARDS}/card-02-xhs-card-01.png`,
    `${CARDS}/card-03-xhs-card-01.png`,
    `${CARDS}/card-04-xhs-card-01.png`,
    `${CARDS}/card-05-xhs-card-01.png`,
    `${CARDS}/card-06-xhs-card-01.png`,
    COVER,
];

interface CdpNode {
    nodeName: string;
    nodeType?: number;
    backendNodeId?: number;
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
    attributes?: string[];
}
interface Session {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const result: Record<string, unknown> = {};

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = ((await context.pages()[0]) ?? (await context.newPage())) as import('playwright').Page;
try {
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

    const state = async () =>
        page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img.preview'));
            return {
                live: imgs.filter((i) => i.naturalWidth > 0).length,
                dead: imgs.filter((i) => i.naturalWidth === 0).length,
            };
        });
    result.before = await state();
    log('before:', JSON.stringify(result.before));

    // Purge dead slots, tolerating the last-one-cannot-be-deleted rule.
    let guard = 0;
    while (((await state()) as { dead: number }).dead > 1 && guard++ < 60) {
        const hit = await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            if (!dead) return null;
            const container = dead.closest('.img-container');
            const btn = container ? (container.querySelector('.close-btn') as HTMLElement | null) : null;
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return [Math.round(r.x + r.width / 2 - 4), Math.round(r.y + r.height / 2 + 4)];
        });
        if (!hit) break;
        await page.mouse.move(hit[0] - 30, hit[1] + 20);
        await sleep(250);
        await page.mouse.click(hit[0], hit[1]);
        await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            const btn = dead?.closest('.img-container')?.querySelector('.close-btn') as HTMLElement | null;
            if (btn)
                for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
                    btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
        });
        await sleep(1500);
    }
    result.afterPurge = await state();
    log('after purge:', JSON.stringify(result.afterPurge));

    if ((result.afterPurge as { live: number }).live < IMAGES.length) {
        const input = page.locator('input[type="file"][accept*=".jpg"]').first();
        await input.setInputFiles(IMAGES);
        log('setInputFiles 7');
        const started = Date.now();
        while (Date.now() - started < 150_000) {
            const s = await state();
            log(`@${Math.round((Date.now() - started) / 1000)}s live=${s.live} dead=${s.dead}`);
            if (s.live >= IMAGES.length) break;
            await sleep(2500);
        }
    }
    result.afterUpload = await state();
    log('after upload:', JSON.stringify(result.afterUpload));

    // Remove the leftover dead slot now that live slots exist.
    guard = 0;
    while (((await state()) as { dead: number }).dead > 0 && guard++ < 20) {
        const hit = await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            if (!dead) return null;
            const container = dead.closest('.img-container');
            const btn = container ? (container.querySelector('.close-btn') as HTMLElement | null) : null;
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return [Math.round(r.x + r.width / 2 - 4), Math.round(r.y + r.height / 2 + 4)];
        });
        if (!hit) break;
        await page.mouse.move(hit[0] - 30, hit[1] + 20);
        await sleep(250);
        await page.mouse.click(hit[0], hit[1]);
        await sleep(1800);
    }
    result.afterDeadPurge = await state();
    log('after dead purge:', JSON.stringify(result.afterDeadPurge));

    // CDP: inventory ALL buttons inside closed shadow roots, then locate the save control.
    const cdp = (await (context as unknown as { newCDPSession(p: unknown): Promise<Session> }).newCDPSession(
        page,
    )) as Session;
    await cdp.send('DOM.enable');
    const doc = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root?: CdpNode };
    const shadowButtons: { label: string; xy: number[] }[] = [];
    const wanted = new Set(['保存离开', '暂存离开', '存草稿', '保存草稿', '发布', '保存']);
    const nodeText = (n: CdpNode): string => {
        const own = (n.children ?? [])
            .filter((c) => c.nodeType === 3)
            .map((_c) => '')
            .join('');
        // Use attribute-free approach: collect child text nodes via nodeValue if present.
        const vals: string[] = [];
        const walk = (x: CdpNode) => {
            if (x.nodeType === 3) vals.push(String((x as unknown as { nodeValue?: string }).nodeValue ?? ''));
            for (const c of x.children ?? []) walk(c);
        };
        walk(n);
        return (own + vals.join('')).replace(/\s+/g, '');
    };
    let saveHit: { label: string; xy: number[] } | null = null;
    const walkShadow = (n: CdpNode, insideShadow: boolean) => {
        if (insideShadow && n.nodeName === 'BUTTON' && typeof n.backendNodeId === 'number') {
            const label = nodeText(n);
            if (label.length > 0 && label.length <= 8) {
                shadowButtons.push({ label, xy: [] });
                if (wanted.has(label)) saveHit ??= { label, xy: [0, 0] };
            }
        }
        for (const sr of n.shadowRoots ?? []) walkShadow(sr, true);
        for (const c of n.children ?? []) walkShadow(c, insideShadow);
    };
    if (doc.root) walkShadow(doc.root, false);
    log('shadow buttons:', JSON.stringify(shadowButtons.slice(0, 30)));
    log('saveHit:', JSON.stringify(saveHit));

    if (saveHit) {
        // Resolve coordinates via getBoxModel.
        const _findBox = (n: CdpNode, insideShadow: boolean, wantLabel: string): number[] | null => {
            if (
                insideShadow &&
                n.nodeName === 'BUTTON' &&
                typeof n.backendNodeId === 'number' &&
                nodeText(n) === wantLabel
            ) {
                return ['x'];
            }
            for (const sr of n.shadowRoots ?? []) {
                const r = _findBox(sr, true, wantLabel);
                if (r) return r;
            }
            for (const c of n.children ?? []) {
                const r = _findBox(c, insideShadow, wantLabel);
                if (r) return r;
            }
            return null;
        };
        // Simpler: rewalk capturing backendNodeId.
        let backendId: number | null = null;
        const capture = (n: CdpNode, insideShadow: boolean) => {
            if (backendId !== null) return;
            if (
                insideShadow &&
                n.nodeName === 'BUTTON' &&
                typeof n.backendNodeId === 'number' &&
                nodeText(n) === saveHit?.label
            ) {
                backendId = n.backendNodeId;
                return;
            }
            for (const sr of n.shadowRoots ?? []) capture(sr, true);
            for (const c of n.children ?? []) capture(c, insideShadow);
        };
        if (doc.root) capture(doc.root, false);
        if (backendId !== null) {
            const box = (await cdp.send('DOM.getBoxModel', { backendNodeId: backendId })) as {
                model?: { content?: number[] };
            };
            const quad = box.model?.content;
            if (quad && quad.length >= 8) {
                const [x1 = 0, y1 = 0, x3 = 0, , , y4 = 0] = quad;
                const x = Math.round((x1 + x3) / 2);
                const y = Math.round((y1 + y4) / 2);
                log(`clicking save "${saveHit.label}" at (${x},${y})`);
                await page.mouse.click(x, y);
                await sleep(4000);
                // The save may pop a confirm dialog (离开提示) in light DOM.
                for (const label of ['确定', '保存', '仍然保存', '确认离开']) {
                    const dlg = page.locator(`button:has-text("${label}")`).first();
                    if ((await dlg.count()) > 0 && (await dlg.isVisible().catch(() => false))) {
                        log(`confirm dialog: clicking ${label}`);
                        await dlg.click({ timeout: 3000 }).catch(() => {});
                        break;
                    }
                }
            }
        }
    } else {
        log('NO shadow save control found — dump light-DOM bottom bar');
        const bottom = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('button, [role="button"]'));
            return els
                .map((b) => ({ t: (b.textContent || '').trim().slice(0, 16), v: b.getBoundingClientRect().width > 0 }))
                .filter((x) => x.t);
        });
        log('light buttons:', JSON.stringify(bottom.slice(0, 30)));
    }
    result.saveDone = saveHit?.label ?? 'none';
    await shot(page, 'fix2-before-close');
    await sleep(4000);

    // Reopen and verify.
    await page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    await page.locator('text=草稿箱').first().click({ timeout: 6000 });
    await sleep(1500);
    await page.locator('text=图文笔记').first().click({ timeout: 6000 });
    await sleep(1200);
    await page.locator('text=编辑').first().click({ timeout: 6000 });
    await sleep(4000);
    result.reopened = await state();
    const srcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img.preview')).map((i) => ({
            src: (i.getAttribute('src') || '').slice(0, 90),
            nw: i.naturalWidth,
        })),
    );
    log('reopened:', JSON.stringify(result.reopened));
    log('srcs:', JSON.stringify(srcs, null, 1));
    const re = result.reopened as { live: number; dead: number };
    result.ok = re.live >= 7 && re.dead === 0;
    log('VERIFY', result.ok ? 'PASS' : 'FAIL');
} catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    log('ERROR', result.error);
} finally {
    await context.close().catch(() => {});
    log('RESULT', JSON.stringify(result));
}
