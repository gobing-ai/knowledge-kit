import { trySelectors } from '@gobing-ai/publish-harness';
import { waitUntil } from '@gobing-ai/publish-harness/browser';
import { clickSelector, fillSelector, POLL_MS, type WechatPage } from './page';

/**
 * The 文章 operation's `metadata.wechatmp` enrichment rail (2026-09-29, ADR-026).
 *
 * The daily MP stage wires operator preferences into `metadata.wechatmp` (原创声明 + 作者, 合集,
 * AI 创作来源, audio embed) and this module drives the v2 editor's settings panel for them. Every
 * step is commit-verified (a DOM re-read), so a step that reports success but does not stick becomes
 * a loud `warnings` entry — the draft still saves, and the operator sees exactly which setting needs
 * a manual pass in the draft box.
 *
 * What is deliberately NOT here: the cover. The panel has NO file input (discovery §5.2) — the
 * pre-ADR-029 cover step uploaded the file into the editor's *image* input, i.e. into the body. The
 * cover is now the `从正文选择` step over the body images (`./flow`), and `metadata.wechatmp.coverPath`
 * is attached as the first body image there.
 */

const DIALOG = '.weui-desktop-dialog:visible';
const CONFIRM = `${DIALOG} button:has-text("确认"), ${DIALOG} button:has-text("确定")`;
const ORIGINAL_SWITCH = '.setting-group__switch.js_edit_ori';
const TAG_ROW = '.allow_click_opr.js_article_tags_label';
const TAG_INPUT = 'input[placeholder*="合集"]';
const CLAIM_SOURCE = '#js_claim_source_area .frm_checkbox_label';
const AUDIO_MENU = 'li.js_insertaudio';
const AUDIO_DIALOG = '.audio_dialog';
/** The 素材库 rows stream in after the dialog opens, so the dedupe probe retries while they load. */
const AUDIO_DIALOG_TIMEOUT_MS = 15_000;
const AUDIO_ROW_RETRIES = 2;
const AUDIO_ROW_SETTLE_MS = 1_200;
/** The 合集 picker's options load after the dialog opens (the pre-ADR-029 settle, kept). */
const COLLECTION_SETTLE_MS = 1_200;
/** The settings panel re-renders after a dialog confirm and can briefly detach rows. */
const STEP_RETRY_SETTLE_MS = 1_000;
const SWEEP_SETTLE_MS = 400;

/**
 * Set the operator's draft metadata (原创/作者/合集/创作来源) in the v2 editor.
 *
 * Runs on a FRESH draft only — the toggles are not state-aware (no idempotency for re-runs).
 * Per-field failures are collected into warnings and surfaced in the `Result`; the draft still
 * saves. Dialog mapping evidence (probes 2026-09-29, drafts 100000805/808): 原创 + 赞赏 share ONE
 * dialog (声明类型 radios, 作者 input, 确定) and the 赞赏 switch stays hidden for this account, so
 * 赞赏 is a manual step; the 合集 dialog is a 请选择合集 input + 确认; 创作来源 is an inline checkbox
 * (no dialog). The 原创 dialog only closes when WeChat's own validation passes — the author must be
 * the reward (赏) account picked from its search, which does not resolve headless for this account,
 * so a non-closing dialog is swept and surfaced as a warning.
 */
export async function enrichArticle(page: WechatPage, meta: Record<string, unknown>): Promise<string[]> {
    const warnings: string[] = [];
    const str = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
    const on = (key: string) => meta[key] === true;
    // Sweep any leaked dialog so the next step (especially 保存为草稿) is never overlay-blocked.
    const sweep = async () => {
        const cancel = await trySelectors(page, ['button:has-text("取消")']);
        if (cancel.found)
            await page
                .locator(cancel.selector ?? '')
                .first()
                .click({ timeout: 2_000 })
                .catch(() => undefined);
        await page.press?.('Escape');
        await page.waitForTimeout?.(SWEEP_SETTLE_MS);
    };
    // One retry per step: the settings panel re-renders after dialog confirms and can briefly
    // detach rows (observed on the tags row right after the original-declaration confirm).
    const step = async (name: string, fn: () => Promise<void>) => {
        try {
            await fn();
            return;
        } catch {
            // retry once below
        }
        await sweep();
        await page.waitForTimeout?.(STEP_RETRY_SETTLE_MS);
        try {
            await fn();
        } catch (error) {
            warnings.push(`${name}: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
            await sweep();
        }
    };

    if (on('original')) {
        await step('原创声明', async () => {
            await clickSelector(page, ORIGINAL_SWITCH, 10_000);
            await clickSelector(page, `${DIALOG} :text("文字原创")`, 8_000);
            const author = str('author');
            if (author !== '') await fillSelector(page, `${DIALOG} input[placeholder*="作者"]`, author);
            await clickSelector(page, CONFIRM, 8_000);
        });
        const committed = await page.evaluate(
            `[...document.querySelectorAll('.weui-desktop-dialog')].every((d) => !d.offsetWidth)`,
        );
        if (committed === false) {
            warnings.push('原创声明: 未生效 - 作者须为赞赏账户(搜索选择)，请手动设置');
            await sweep();
        }
    }

    const collection = str('collection');
    if (collection !== '') {
        await step('合集', async () => {
            await clickSelector(page, TAG_ROW, 8_000);
            await waitForVisible(page, TAG_INPUT, 8_000);
            await fillSelector(page, TAG_INPUT, collection);
            await page.waitForTimeout?.(COLLECTION_SETTLE_MS);
            await clickSelector(page, `${DIALOG} :text("${collection}")`, 8_000);
            await clickSelector(page, CONFIRM, 8_000);
        });
    }

    if (on('aiGenerated')) {
        await step('创作来源', async () => {
            await clickSelector(page, CLAIM_SOURCE, 8_000);
            // Probes show no dialog on current builds — the checkbox alone declares AI generation.
            const dialog = await waitForVisible(page, DIALOG, 3_000, { required: false });
            if (dialog !== undefined) {
                await clickSelector(page, `${DIALOG} :text("内容由AI生成")`, 8_000);
                await clickSelector(page, CONFIRM, 8_000);
            }
        });
        const checked = await page.evaluate(`!!document.querySelector('#js_claim_source_area input:checked')`);
        if (checked === false) warnings.push('创作来源: 勾选未生效，请手动设置');
    }

    await sweep();
    return warnings;
}

/**
 * Audio embed at the article top (operator request 2026-09-29): open the editor's audio menu (a
 * hover dropdown — a JS click bypasses the hover gate), reuse an existing same-title 素材库
 * material, and insert it at the caret (placed at the article start first).
 *
 * Uploading a missing material is deliberately manual: docs/04 records the 上传音频 form as
 * iframe-based and unmapped, and the walk did not re-measure it. Fail-soft — every non-committed
 * outcome returns a warning string, `''` means placed at the top.
 */
export async function insertAudio(page: WechatPage, title: string): Promise<string> {
    const CARET = `(() => {
            const pm = [...document.querySelectorAll('.ProseMirror')].find((e) => !(e.getAttribute('data-placeholder') ?? '').includes('标题'));
            if (!pm || !pm.firstChild) return;
            const r = document.createRange();
            r.setStart(pm.firstChild, 0);
            r.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
        })()`;
    const DEDUPE = `(() => {
            const want = ${JSON.stringify(title)}.replace(/\\s+/g, '');
            const hit = [...document.querySelectorAll('label.frm_checkbox_label.audio_item')]
                .find((l) => (l.textContent ?? '').replace(/\\s+/g, '').includes(want));
            if (!hit) return 'missing';
            const cb = (hit.closest('li') ?? hit.parentElement)?.querySelector('input[type=checkbox]');
            if (!cb) return 'nobox';
            cb.click();
            return 'checked';
        })()`;
    const INSERT = `(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '插入' && b.offsetWidth > 0);
            if (!btn) return false;
            btn.click();
            return true;
        })()`;
    const CANCEL = `(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '取消' && b.offsetWidth > 0);
            btn?.click();
        })()`;
    const VERIFY = `(() => {
            const pm = [...document.querySelectorAll('.ProseMirror')].find((e) => !(e.getAttribute('data-placeholder') ?? '').includes('标题'));
            if (!pm) return 'noeditor';
            const node = pm.querySelector('mpvoice, [class*="audio"]');
            if (!node) return 'absent';
            const first = pm.firstElementChild;
            return first && (first === node || first.contains(node)) ? 'top' : 'notop';
        })()`;

    try {
        await page.evaluate(CARET);
        await page.evaluate(`document.querySelector(${JSON.stringify(AUDIO_MENU)})?.click()`);
        await waitForVisible(page, AUDIO_DIALOG, AUDIO_DIALOG_TIMEOUT_MS);
        // The 素材库 list loads async after the dialog opens — retry while rows stream in.
        let dedupe = String(await page.evaluate(DEDUPE));
        for (let i = 0; dedupe === 'missing' && i < AUDIO_ROW_RETRIES; i += 1) {
            await page.waitForTimeout?.(AUDIO_ROW_SETTLE_MS);
            dedupe = String(await page.evaluate(DEDUPE));
        }
        if (dedupe !== 'checked') {
            await page.evaluate(CANCEL);
            return dedupe === 'missing'
                ? '音频: 素材库无同名音频，请手动上传后插入'
                : '音频: 同名素材行未找到勾选框，请手动插入';
        }
        if ((await page.evaluate(INSERT)) !== true) {
            await page.evaluate(CANCEL);
            return '音频: 插入按钮未找到，请手动插入';
        }
        await page.waitForTimeout?.(2_000);
        const state = String(await page.evaluate(VERIFY));
        if (state === 'absent' || state === 'noeditor') return '音频: 插入未生效，请手动检查';
        if (state === 'notop') return '音频: 已插入但未在文首，请手动调整位置';
        return '';
    } catch {
        return '音频: 自动插入失败，请手动插入';
    }
}

/** Polls a selector for visibility; optionally returns `undefined` instead of throwing. */
async function waitForVisible(
    page: WechatPage,
    selector: string,
    timeoutMs: number,
    opts: { required?: boolean } = {},
): Promise<string | undefined> {
    const visible = await waitUntil(
        async () => {
            const found = await trySelectors(page, [selector]).catch(() => ({ found: false, selector: null }));
            return found.found;
        },
        timeoutMs,
        POLL_MS,
    );
    if (visible) return selector;
    if (opts.required === false) return undefined;
    throw new Error(`${selector}: not visible within ${timeoutMs}ms`);
}
