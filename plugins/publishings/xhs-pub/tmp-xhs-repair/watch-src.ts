/**
 * watch-src.ts — after upload, watch img.preview src/naturalWidth for 120s to see if XHS
 * replaces spectrum preview URLs with durable ones before save. Then save via CDP 暂存离开,
 * reopen, compare.
 */
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';

const PROFILE = '/Users/robin/.config/kk/browser-profiles/xhs';
const log = (...a: unknown[]) => console.log('[watch]', ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CARDS = '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109/25-xhs/cards';
const COVER =
    '/Users/robin/xprojects/knowledge-kit/.works/kk-daily-ai-voice2/20261109/23-cover/20261109_07_cover_cover.png';
const IMAGES = [...Array.from({ length: 6 }, (_, i) => `${CARDS}/card-0${i + 1}-xhs-card-01.png`), COVER];

interface CdpNode {
    nodeName: string;
    nodeType?: number;
    backendNodeId?: number;
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
}
interface Session {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = ((await context.pages()[0]) ?? (await context.newPage())) as import('playwright').Page;
const result: Record<string, unknown> = {};
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

    // Purge to ≤1 dead, upload, purge leftover.
    let guard = 0;
    while (((await state()) as { dead: number }).dead > 1 && guard++ < 60) {
        const hit = await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            const btn = dead && (dead.closest('.img-container')?.querySelector('.close-btn') as HTMLElement | null);
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return [Math.round(r.x + r.width / 2 - 4), Math.round(r.y + r.height / 2 + 4)];
        });
        if (!hit) break;
        await page.mouse.move(hit[0] - 30, hit[1] + 20);
        await sleep(250);
        await page.mouse.click(hit[0], hit[1]);
        await sleep(1500);
    }
    const input = page.locator('input[type="file"][accept*=".jpg"]').first();
    await input.setInputFiles(IMAGES);
    log('uploaded 7');
    const started = Date.now();
    while (Date.now() - started < 150_000 && ((await state()) as { live: number }).live < IMAGES.length)
        await sleep(2500);
    result.afterUpload = await state();
    log('after upload:', JSON.stringify(result.afterUpload));
    guard = 0;
    while (((await state()) as { dead: number }).dead > 0 && guard++ < 20) {
        const hit = await page.evaluate(() => {
            const dead = Array.from(document.querySelectorAll('img.preview')).find((i) => i.naturalWidth === 0);
            const btn = dead && (dead.closest('.img-container')?.querySelector('.close-btn') as HTMLElement | null);
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
    log('state now:', JSON.stringify(await state()));

    // WATCH: src evolution for 120s.
    const seen = new Map<string, number[]>();
    for (let t = 0; t <= 120; t += 15) {
        const snapshot = await page.evaluate(() =>
            Array.from(document.querySelectorAll('img.preview')).map((i) => ({
                src: (i.getAttribute('src') || '').slice(-24),
                nw: i.naturalWidth,
                cls: i.className,
            })),
        );
        const key = JSON.stringify(snapshot.map((s) => `${s.src}|${s.nw}`));
        seen.set(key, (seen.get(key) ?? 0) + 1);
        log(`t=${t}s srcs: ${snapshot.map((s) => `${s.src}@${s.nw}`).join(' ')}`);
        await sleep(15_000);
    }
    result.watchStable = seen.size === 1;
    log('src stable over watch window:', seen.size === 1);

    // Save via CDP.
    const cdp = (await (context as unknown as { newCDPSession(p: unknown): Promise<Session> }).newCDPSession(
        page,
    )) as Session;
    await cdp.send('DOM.enable');
    const doc = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root?: CdpNode };
    const text = (n: CdpNode): string => {
        const vals: string[] = [];
        const walk = (x: CdpNode) => {
            if (x.nodeType === 3) vals.push(String((x as unknown as { nodeValue?: string }).nodeValue ?? ''));
            for (const c of x.children ?? []) walk(c);
        };
        walk(n);
        return vals.join('').replace(/\s+/g, '');
    };
    let backendId: number | null = null;
    const capture = (n: CdpNode, insideShadow: boolean) => {
        if (backendId !== null) return;
        if (insideShadow && n.nodeName === 'BUTTON' && typeof n.backendNodeId === 'number' && text(n) === '暂存离开') {
            backendId = n.backendNodeId;
            return;
        }
        for (const sr of n.shadowRoots ?? []) capture(sr, true);
        for (const c of n.children ?? []) capture(c, insideShadow);
    };
    if (doc.root) capture(doc.root, false);
    log('CDP found 暂存离开:', backendId !== null);

    // Per OpenCLI#1606: xhs-publish-btn is a closed-shadow web component; coordinate clicks are
    // no-ops from background windows. The save protocol is the host's exposed _onSave() method.
    const invoke = await page.evaluate(() => {
        const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        const names = ['_onSave', '_onSaveDraft', '_onDraft', '_onPublish', '_onSubmit', 'onPublish', '_handlePublish'];
        const tried: string[] = [];
        for (const el of hosts) {
            for (const name of names) {
                const fn = (el as unknown as Record<string, unknown>)[name];
                tried.push(`${name}:${typeof fn}`);
                if (typeof fn === 'function') {
                    (fn as (this: unknown, ...args: unknown[]) => unknown).call(el);
                    return { ok: true, called: name, hosts: hosts.length };
                }
            }
        }
        return { ok: false, tried, hosts: hosts.length };
    });
    log('invoke save:', JSON.stringify(invoke));
    await sleep(3000);
    // Dump any visible dialog/modal and answer it.
    const dlgDump = await page.evaluate(() => {
        const sels = [
            '.cip-modal',
            '.el-dialog',
            '.modal',
            '.dialog',
            '[class*="modal"]',
            '[class*="dialog"]',
            '[class*="Modal"]',
        ];
        const out: string[] = [];
        for (const s of sels) {
            for (const el of Array.from(document.querySelectorAll(s))) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0)
                    out.push(`${s}: ${(el.textContent || '').replace(/\s+/g, ' ').slice(0, 120)}`);
            }
        }
        return Array.from(new Set(out)).slice(0, 10);
    });
    log('dialogs after save click:', JSON.stringify(dlgDump));
    let clicked = false;
    for (const label of ['保存', '确定', '仍然保存', '确认', '是']) {
        const btn = page.locator(`button:has-text("${label}")`).first();
        if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
            await btn.click({ timeout: 3000 }).catch(() => {});
            log(`dialog click: ${label}`);
            clicked = true;
            break;
        }
    }
    log('dialog clicked:', clicked);
    await sleep(6000);
    const savedAt = await page.evaluate(
        () => (document.body.textContent || '').match(/保存于[^,。]{0,30}/)?.[0] ?? null,
    );
    log('save timestamp text:', savedAt);

    // Reopen + verify.
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
        Array.from(document.querySelectorAll('img.preview')).map((i) => (i.getAttribute('src') || '').slice(-24)),
    );
    log('reopened:', JSON.stringify(result.reopened));
    log('reopened srcs:', JSON.stringify(srcs));
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
