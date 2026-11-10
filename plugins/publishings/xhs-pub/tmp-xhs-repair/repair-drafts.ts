/**
 * One-off console repair for the two 20261109 XHS drafts (operator-authorized):
 *  - 图文笔记「高盛收紧编码代理，大模型与老卡工程实录」: attach the 7 images that never landed.
 *  - 播客笔记「每日AI乱炖 · 2026-11-09」: attach the cover, set 加入播客合集.
 * Observes and dumps the upload-completion DOM so the plugin wait can be codified afterwards.
 */
import { mkdirSync } from 'node:fs';
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
const COVER = `${W}/23-cover/20261109_07_cover_cover.png`;
const COLLECTION = '咸话咸说之每日AI乱炖';
const IMG_TITLE = '高盛收紧编码代理';
const POD_TITLE = '每日AI乱炖';

mkdirSync(OUT, { recursive: true });
const log = (...args: unknown[]) => console.log('[repair]', ...args);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(page: import('playwright').Page, name: string) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    log(`screenshot ${name}.png`);
}

/** Recursive shadow-piercing text search; returns {tag, cls, text, x, y} of deepest matches. */
async function shadowFind(page: import('playwright').Page, labels: string[]) {
    return page.evaluate((labels) => {
        const out: { label: string; tag: string; cls: string; rect: number[] }[] = [];
        const visit = (root: Document | ShadowRoot) => {
            for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
                const text = (el.textContent || '').trim();
                for (const label of labels) {
                    if (el.childElementCount === 0 && text.includes(label)) {
                        const r = el.getBoundingClientRect();
                        out.push({
                            label,
                            tag: el.tagName,
                            cls: String(el.className),
                            rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
                        });
                    }
                }
                if (el.shadowRoot) visit(el.shadowRoot);
            }
        };
        visit(document);
        return out;
    }, labels);
}

async function clickInShadow(page: import('playwright').Page, labels: string[], what: string) {
    const found = await shadowFind(page, labels);
    log(`${what} shadow candidates:`, JSON.stringify(found));
    const hit = found[0];
    if (!hit) return false;
    await page.mouse.click(hit.rect[0] + hit.rect[2] / 2, hit.rect[1] + hit.rect[3] / 2);
    return true;
}

async function clickLightByLabel(page: import('playwright').Page, labels: string[], what: string) {
    for (const label of labels) {
        for (const sel of [`button:has-text("${label}")`, `[class*="btn"]:has-text("${label}")`, `text=${label}`]) {
            const loc = page.locator(sel).first();
            try {
                if ((await loc.count()) === 0) continue;
                await loc.click({ timeout: 3000 });
                log(`${what}: clicked light '${sel}'`);
                return true;
            } catch {
                /* try next */
            }
        }
    }
    log(`${what}: no light control for [${labels.join(', ')}]`);
    return false;
}

/** Dump image-area DOM evolution until upload completes (progress markers gone) or timeout. */
async function observeUpload(page: import('playwright').Page, name: string, expectCount: number, timeoutMs = 90_000) {
    const started = Date.now();
    let lastSig = '';
    while (Date.now() - started < timeoutMs) {
        const sig = await page.evaluate(() => {
            const html = document.body.innerHTML;
            const thumbs = document.querySelectorAll(
                'img[src^="blob:"], img[src*="sns-img"], img[class*="preview"]',
            ).length;
            const progress = (html.match(/uploading|上传中|progress[a-z-]*\b/gi) || []).length;
            const pct = /(\d{1,3})%/.test(html) ? (/(\d{1,3})%/.exec(html) as RegExpMatchArray)[1] : '';
            const disabledPublish = Array.from(document.querySelectorAll('button')).some(
                (b) => /发布|保存|下一步|去发布/.test(b.textContent || '') && (b as HTMLButtonElement).disabled,
            );
            const uploadSuccess = (html.match(/上传成功/g) || []).length;
            return { thumbs, progress, pct, disabledPublish, uploadSuccess };
        });
        const key = JSON.stringify(sig);
        if (key !== lastSig) {
            log(`${name} @${Math.round((Date.now() - started) / 1000)}s:`, key);
            lastSig = key;
        }
        if (sig.thumbs >= expectCount && sig.progress === 0 && sig.pct === '' && !sig.disabledPublish) {
            log(`${name}: upload COMPLETE signal (thumbs>=${expectCount}, no progress, no pct, no disabled btn)`);
            return sig;
        }
        await sleep(1500);
    }
    log(`${name}: upload observation TIMED OUT after ${timeoutMs}ms`);
    return null;
}

async function openDraft(page: import('playwright').Page, titlePart: string, tabLabel: string) {
    // The landing publish page shows a 草稿箱(N) entry that opens a per-type draft list:
    // tabs 视频笔记/图文笔记/长文笔记/播客笔记. Select the tab, then the item's 编辑.
    const count = await page.evaluate(() => {
        const m = /草稿箱\s*[（(]\s*(\d+)/.exec(document.body.textContent || '');
        return m ? Number(m[1]) : null;
    });
    log(`draft counter: ${count}`);
    const opened =
        (await clickLightByLabel(page, ['草稿箱'], 'draft-box-entry')) ||
        (await clickInShadow(page, ['草稿箱'], 'draft-box-entry'));
    if (opened) await sleep(2000);
    const tab =
        (await clickLightByLabel(page, [tabLabel], 'draft-tab')) ||
        (await clickInShadow(page, [tabLabel], 'draft-tab'));
    if (tab) await sleep(1500);
    await shot(page, `draft-list-${tabLabel}`);
    // Dump what the tab actually shows so a title mismatch is diagnosable.
    const listDump = await page.evaluate(() => {
        const text = (document.body.textContent || '').replace(/\s+/g, ' ');
        const idx = text.indexOf('草稿箱视频笔记');
        const at = idx >= 0 ? idx : Math.max(0, text.indexOf('草稿') - 20);
        return text.slice(at, at + 700);
    });
    log('list dump:', listDump);
    const item = page.locator(`text=${titlePart}`).first();
    const itemCount = await item.count();
    log(`draft title match '${titlePart}': ${itemCount}`);
    if (itemCount === 0) {
        const cands = await shadowFind(page, [titlePart, '编辑']);
        log('shadow candidates:', JSON.stringify(cands.slice(0, 20)));
        throw new Error(`draft '${titlePart}' not found in list`);
    }
    // The row exposes 编辑/删除 controls; click 编辑 within the row (the only one on this view).
    const edit = page.locator('text=编辑').first();
    if ((await edit.count()) === 0) throw new Error('no 编辑 control on draft row');
    await edit.click({ timeout: 8000 });
    await sleep(2500);
    await shot(page, `opened-${titlePart.slice(0, 6)}`);
    const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input[type="file"]')).map((i) => ({
            accept: i.getAttribute('accept'),
            cls: String(i.className),
            multiple: (i as HTMLInputElement).multiple,
        })),
    );
    log(`editor file inputs: ${JSON.stringify(inputs)}`);
    const editorText = await page.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 300));
    log(`editor text: ${editorText}`);
    if (inputs.length === 0) throw new Error('editor opened but no file inputs present');
}

async function repairImageText(page: import('playwright').Page) {
    log('=== repair 图文笔记 ===');
    await openDraft(page, IMG_TITLE, '图文笔记');
    await sleep(1000);
    // Pick the IMAGE file input (the page also has a video upload input in the rail).
    const imageSel = [
        'input[type="file"][accept*=".jpg"]',
        'input[type="file"][accept*=".png"]',
        'input[type="file"][accept*="image"]',
        'input[type="file"][multiple]',
        'input[type="file"].upload-input:not([accept*=".mp4"])',
    ];
    let used = '';
    for (const sel of imageSel) {
        const loc = page.locator(sel).first();
        if ((await loc.count()) > 0) {
            await loc.setInputFiles(IMAGES);
            used = sel;
            break;
        }
    }
    if (!used) throw new Error('no image file input found');
    log(`setInputFiles done (7 images) via ${used}`);
    await sleep(2000);
    await shot(page, 'img-attached');
    const sig = await observeUpload(page, 'img', IMAGES.length);
    await shot(page, 'img-uploaded');
    // Save the draft: try common save-leave labels in light DOM then shadow.
    const labels = ['保存离开', '暂存离开', '存草稿', '保存草稿'];
    let clicked = await clickLightByLabel(page, labels, 'img-save');
    if (!clicked) clicked = await clickInShadow(page, labels, 'img-save');
    if (!clicked) throw new Error('no draft save control found');
    await sleep(2500);
    await shot(page, 'img-saved');
    const toast = await page.evaluate(() => /保存成功/.test(document.body.textContent || ''));
    log(`img save toast 保存成功: ${toast}`);
    return { uploadSignal: sig, toast };
}

async function repairPodcast(page: import('playwright').Page) {
    log('=== repair 播客笔记 ===');
    await openDraft(page, POD_TITLE, '播客笔记');
    await sleep(1500);
    // Dump modal state: audio ack, cover card, collection control.
    const modal = await page.evaluate(() => {
        const scope = document.querySelector('.d-modal') || document.body;
        const html = scope.innerHTML;
        return {
            hasAudioAck: /上传成功/.test(html),
            hasCoverHint: /设置封面|点击上传|上传封面/.test(html),
            collectionHint: /加入播客合集|播客合集/.test(html),
            inputs: Array.from(scope.querySelectorAll('input[type="file"]')).map((i) => i.getAttribute('accept')),
            collectionText: ((html.match(/加入播客合集[\s\S]{0,400}/) || [''])[0] || '').slice(0, 400),
        };
    });
    log('podcast modal dump:', JSON.stringify(modal, null, 1));
    await shot(page, 'pod-modal');

    // Cover: same chooser flow as the plugin (click card → filechooser → setFiles).
    const chooserP = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    const coverCard = page.locator('text=设置封面').first();
    const cardVisible = (await coverCard.count()) > 0;
    if (cardVisible) {
        await coverCard.click({ timeout: 5000 }).catch(async () => {
            const box = await coverCard.boundingBox();
            if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        });
    } else {
        await clickInShadow(page, ['设置封面', '上传封面', '点击上传'], 'pod-cover-card');
    }
    const chooser = await chooserP;
    if (chooser) {
        await (chooser as { setFiles(p: string): Promise<void> }).setFiles(COVER);
        log('cover setFiles via chooser');
    } else {
        const r = await page.evaluate(() => {
            const scope = document.querySelector('.d-modal') || document.body;
            const inputs = Array.from(scope.querySelectorAll('input[type="file"]'));
            const cover = inputs.find((i) => !(i.getAttribute('accept') || '').includes('.mp3'));
            if (cover) {
                cover.click();
                return { clicked: true, accept: cover.getAttribute('accept') };
            }
            return { clicked: false };
        });
        log('chooser fallback:', JSON.stringify(r));
        if (!r.clicked) throw new Error('cover input not found in modal');
        const chooser2 = await page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
        if (!chooser2) throw new Error('cover chooser never opened on fallback click');
        await (chooser2 as { setFiles(p: string): Promise<void> }).setFiles(COVER);
        log('cover setFiles via fallback chooser');
    }
    const coverSig = await observeUpload(page, 'pod-cover', 1, 60_000);
    await shot(page, 'pod-cover-uploaded');

    // 加入播客合集: dump then set. It may be a native select or a custom dropdown.
    const sel = page.locator('select').first();
    if ((await sel.count()) > 0) {
        const options = await sel.evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.text));
        log('native select options:', JSON.stringify(options));
        if (options.some((o) => o.includes(COLLECTION))) {
            await sel.selectOption({ label: options.find((o) => o.includes(COLLECTION)) as string });
            log('collection set via native select');
        }
    } else {
        // Custom dropdown: click the 合集 control, then pick the option by text.
        const opened =
            (await clickLightByLabel(
                page,
                [COLLECTION, '加入播客合集', '选择合集', '不加入合集'],
                'collection-open',
            )) || (await clickInShadow(page, ['加入播客合集', '选择合集'], 'collection-open'));
        if (opened) {
            await sleep(1200);
            await shot(page, 'collection-open');
            const opt = page.locator(`text=${COLLECTION}`).first();
            const n = await opt.count();
            log(`collection option matches: ${n}`);
            if (n > 0) {
                await opt.click({ timeout: 5000 });
                log('collection option clicked');
            }
        }
    }
    await shot(page, 'pod-collection-set');

    // Save.
    const labels = ['保存离开', '暂存离开', '存草稿', '保存草稿'];
    let clicked = await clickLightByLabel(page, labels, 'pod-save');
    if (!clicked) clicked = await clickInShadow(page, labels, 'pod-save');
    if (!clicked) throw new Error('no podcast draft save control');
    await sleep(2500);
    await shot(page, 'pod-saved');
    const toast = await page.evaluate(() => /保存成功/.test(document.body.textContent || ''));
    log(`pod save toast 保存成功: ${toast}`);
    return { uploadSignal: coverSig, toast };
}

const context = await kkBrowserLauncher.launch({ profileDir: PROFILE, headless: false });
const page = await context.newPage();
const result: Record<string, unknown> = {};
try {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    await shot(page, 'landing');
    result.imageText = await repairImageText(page);
    // Back to landing for the second draft.
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await sleep(3000);
    result.podcast = await repairPodcast(page);
} catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    await shot(page, 'error-state').catch(() => {});
} finally {
    log('RESULT', JSON.stringify(result, null, 1));
    await context.close().catch(() => {});
}
