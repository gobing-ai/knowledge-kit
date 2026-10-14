import { trySelectors } from '@gobing-ai/publish-harness';
import { clickSelector, fillSelector, tryFindSelector, type WechatPage, waitForVisible } from './page';

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
/**
 * Every settings row follows one shape (operator walk 2026-10-10): a row control that opens a dialog,
 * an action inside it, then 确定. The row's own label is listed alongside its `>` expander because both
 * dispatch the same handler; the first selector that resolves wins.
 */
const ROW_ORIGINAL = [
    '.setting-group__switch.js_original_apply.js_edit_ori',
    '.setting-group__switch.js_edit_ori',
    '.js_edit_ori',
    'text=原创',
];
// Measured 2026-10-13: the 赞-tipped rows are `.js_reward_open` / `.js_reward_allow_click` — the
// old `.setting-group__switch.js_can_reward` no longer resolves. The 原创 dialog's own 赞赏
// switch (`js_reward_switch`) must never be clicked by this row list (R3, drift task 0272).
const ROW_REWARD = [
    '.setting-group__switch.js_reward_open',
    '.js_reward_open',
    '.js_reward_allow_click',
    '.setting-group__switch.js_can_reward',
    'text=赞赏',
];
const ROW_COLLECTION = ['.allow_click_opr.js_article_tags_label', 'text=合集'];
const ROW_URL = ['.allow_click_opr.js_url_checkbox', 'text=原文链接'];
const ROW_CLAIM = ['#js_claim_source_area .frm_checkbox_label', 'text=创作来源'];
const DIALOG_CONFIRM = CONFIRM;
const TAG_INPUT = 'input[placeholder*="合集"]';
/** The 赞赏 dialog's account field, filled only when the platform leaves it empty. */
const REWARD_ACCOUNT = [
    `${DIALOG} input[placeholder*="赞赏"]`,
    `${DIALOG} input[placeholder*="账户"]`,
    `${DIALOG} input.frm_input`,
];
/** The 原文链接 dialog's URL field. */
const URL_INPUT = [`${DIALOG} input[type="url"]`, `${DIALOG} input[placeholder*="链接"]`, `${DIALOG} input.frm_input`];
/** The 原创 dialog's declaration radio (measured 2026-10-13): the platform requires an explicit
 *  declaration type + the agreement check before 确定. `无需声明` is the undo choice, never a target. */
const ORIGINAL_DECLARATION = `${DIALOG} label:has(.js_original_type_radio):has-text("文字原创")`;
/** The 原创 agreement checkbox (measured 2026-10-13); absent on some account states — then 确定 speaks. */
const ORIGINAL_AGREEMENT = `${DIALOG} .original_agreement`;
/** The 合集 picker's options load after the dialog opens (the pre-ADR-029 settle, kept). */
const COLLECTION_SETTLE_MS = 1_200;
/** The settings panel re-renders after a dialog confirm and can briefly detach rows. */
const STEP_RETRY_SETTLE_MS = 1_000;
const SWEEP_SETTLE_MS = 400;

/**
 * Set the operator's draft metadata (原创/赞赏/合集/原文链接/创作来源) in the v2 editor.
 *
 * Runs on a FRESH draft only — the toggles are not state-aware (no idempotency for re-runs).
 * Per-field failures are collected into warnings and surfaced in the `Result`; the draft still saves.
 *
 * Every step follows the operator's measured shape (2026-10-10): open the row, act in the dialog,
 * click 确定. The previous rail modelled 原创 as "choose the declaration, then the author must resolve
 * to the 赏 account" and skipped 赞赏 / 原文链接 entirely — which is why 作者, 原创 and 赞赏 all came
 * back unset on the daily run.
 */
export async function enrichArticle(page: WechatPage, meta: Record<string, unknown>): Promise<string[]> {
    const warnings: string[] = [];
    const str = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
    const on = (key: string) => meta[key] === true;
    // Sweep any leaked dialog so the next step (especially 保存为草稿) is never overlay-blocked.
    const sweep = async () => {
        const cancel = await trySelectors(page, ['button:has-text("取消")']);
        if (cancel.found) {
            try {
                await page
                    .locator(cancel.selector ?? '')
                    .first()
                    .click({ timeout: 2_000 });
            } catch {
                // The dialog may already be gone; the sweep is best-effort.
            }
        }
        await page.press?.('Escape');
        await page.waitForTimeout?.(SWEEP_SETTLE_MS);
    };
    /** Open a settings row: its label or `>` expander, whichever the build exposes. */
    const openRow = async (row: readonly string[], what: string) => {
        for (const selector of row) {
            // `trySelectors` already absorbs a throwing probe and returns {found:false}, so a
            // `.catch()` here would be unreachable.
            const found = await trySelectors(page, [selector]);
            if (found.found) {
                await clickSelector(page, selector, 8_000);
                return;
            }
        }
        throw new Error(`no ${what} row control among [${row.join(' | ')}]`);
    };
    /** One retry per step: the panel re-renders after a dialog confirm and can briefly detach rows. */
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
    /** True once every dialog has closed — the platform's own validation gate on a settings dialog. */
    const dialogsClosed = async () =>
        (await page.evaluate(`[...document.querySelectorAll('.weui-desktop-dialog')].every((d) => !d.offsetWidth)`)) !==
        false;

    if (on('original')) {
        await step('原创声明', async () => {
            await openRow(ROW_ORIGINAL, '原创声明');
            // Measured 2026-10-13: pick the 文字原创 radio, check the agreement when it renders, then
            // 确定. The plain-text probe the old rail used could hit the dialog heading instead.
            await clickSelector(page, ORIGINAL_DECLARATION, 5_000);
            const agreement = await trySelectors(page, [ORIGINAL_AGREEMENT]).catch(() => ({ found: false }));
            if (agreement.found) {
                await clickSelector(page, ORIGINAL_AGREEMENT, 3_000);
            }
            await clickSelector(page, DIALOG_CONFIRM, 8_000);
        });
        if (!(await dialogsClosed())) warnings.push('原创声明: dialog did not close — check the draft');
    }

    if (on('reward')) {
        await step('赞赏', async () => {
            await openRow(ROW_REWARD, '赞赏');
            // Measured 2026-10-13: without a 赏账户 the dialog renders the 前往开通 link + a
            // 无法开启-style prerequisite line instead of the account field — an operator action
            // (开通赞赏), never a selector failure. The label 赏账户 alone is NOT the marker: it
            // also renders on functional accounts.
            const blocked = await tryFindSelector(
                page,
                [`${DIALOG} :has-text("前往开通")`, `${DIALOG} :has-text("无法开启")`],
                1_500,
            );
            if (blocked !== undefined) throw new Error('需要赞赏账户（运营者先在平台开通），已跳过自动填写');
            // 赞赏账户 defaults from 作者; fill it only when the platform left it empty.
            const author = str('author');
            if (author !== '') {
                for (const selector of REWARD_ACCOUNT) {
                    const found = await trySelectors(page, [selector]).catch(() => ({ found: false, selector: null }));
                    if (!found.found) continue;
                    const empty = await page.evaluate(
                        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return !el || (el.value ?? '').trim() === ''; })()`,
                    );
                    if (empty === true) await fillSelector(page, selector, author);
                    break;
                }
            }
            await clickSelector(page, DIALOG_CONFIRM, 8_000);
        });
        if (!(await dialogsClosed())) warnings.push('赞赏: dialog did not close — check the draft');
    }

    const collection = str('collection');
    if (collection !== '') {
        await step('合集', async () => {
            await openRow(ROW_COLLECTION, '合集');
            await waitForVisible(page, TAG_INPUT, 8_000);
            await fillSelector(page, TAG_INPUT, collection);
            await page.waitForTimeout?.(COLLECTION_SETTLE_MS);
            await clickSelector(page, `${DIALOG} :text("${collection}")`, 8_000);
            await clickSelector(page, DIALOG_CONFIRM, 8_000);
        });
        if (!(await dialogsClosed())) warnings.push('合集: dialog did not close — check the draft');
    }

    const originalUrl = str('originalUrl');
    if (originalUrl !== '') {
        // Measured 2026-10-13: some accounts no longer render the 原文链接 row at all. That is an
        // unavailable capability — report it once, never fall back to the composer's unrelated
        // `链接` row (`btm-card-link__switch`).
        const urlRow = await tryFindSelector(page, ROW_URL, 2_000);
        if (urlRow === undefined) {
            warnings.push('原文链接: 行不存在（当前公众号不支持），请手动处理或移除 originalUrl');
        } else {
            await step('原文链接', async () => {
                await openRow(ROW_URL, '原文链接');
                const field = await trySelectors(page, URL_INPUT);
                if (!field.found) throw new Error('no URL field in the 原文链接 dialog');
                await fillSelector(page, field.selector ?? URL_INPUT.join(', '), originalUrl);
                await clickSelector(page, DIALOG_CONFIRM, 8_000);
            });
            if (!(await dialogsClosed())) warnings.push('原文链接: dialog did not close — check the draft');
        }
    }

    // 创作来源 is the operator's chosen stance (`个人观点，仅供参考` for this column), not a fixed
    // "AI generated" declaration — the label is the metadata value so the operator owns the wording.
    const claimSource = str('claimSource');
    if (claimSource !== '') {
        await step('创作来源', async () => {
            await openRow(ROW_CLAIM, '创作来源');
            const dialog = await waitForVisible(page, DIALOG, 3_000, { required: false });
            if (dialog !== undefined) {
                await clickSelector(page, `${DIALOG} :text("${claimSource}")`, 8_000);
                await clickSelector(page, DIALOG_CONFIRM, 8_000);
            }
        });
        const checked = await page.evaluate(`!!document.querySelector('#js_claim_source_area input:checked')`);
        if (checked === false) warnings.push('创作来源: 未生效，请手动设置');
    }

    await sweep();
    return warnings;
}
