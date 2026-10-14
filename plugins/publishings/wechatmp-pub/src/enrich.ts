import { trySelectors } from '@gobing-ai/publish-harness';
import { clickSelector, fillSelector, modalState, tryFindSelector, type WechatPage, waitForVisible } from './page';

/**
 * The 文章 operation's `metadata.wechatmp` enrichment rail (2026-09-29, ADR-026; committed-value
 * contract reworked in task 0260).
 *
 * The daily MP stage wires operator preferences into `metadata.wechatmp` (原创声明 + 作者, 合集,
 * AI 创作来源, audio embed) and this module drives the v2 editor's settings panel for them. Every
 * step reads the REQUESTED committed editor state BEFORE acting (an already-satisfied setting is
 * never toggled) and again AFTER its dialog closes; only the exact requested committed value
 * establishes success. Missing, throwing or unverifiable probes are named warnings — never truthy
 * defaults, and account/capability refusals (赞赏账户, 原文链接 row) warn ONCE without retry.
 *
 * What is deliberately NOT here: the cover. The panel has NO file input (discovery §5.2) — the
 * pre-ADR-029 cover step uploaded the file into the editor's *image* input, i.e. into the body. The
 * cover is now the `从正文选择`/图片库 step over identified assets (`./flow`), and
 * `metadata.wechatmp.coverPath` is attached as the first body image there.
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
/**
 * The 原文链接 dialog's URL field.
 * `URL_INPUT[0]` doubles as the committed-readback locator, so it must be concrete (not `:visible`).
 */
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
 * A capability/account refusal the next run cannot fix by retrying (no 赏账户, no 原文链接 row).
 * `step` never retries one of these — the warning goes out once.
 */
class CapabilityError extends Error {}

/** trim + collapse internal whitespace — the matching normalization for every text/value readback. */
function norm(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Native-CSS committed-state probes. Runtime DOM properties only (a checked state read from the
 * HTML attribute would see the template, not the editor) — and `null` when the shape is absent, so
 * an unobservable state can never read as "satisfied".
 * Playwright-only syntax (`:visible`, `:has-text`) never enters `querySelector` — it throws there.
 */
const COMMITTED = {
    /** 原创 enabled = the settings row's checkbox checked (`#js_original` / `.js_ori_setting_checkbox`). */
    original: `(() => {
        const el = document.querySelector('#js_original, .js_ori_setting_checkbox');
        return el ? el.checked === true : null;
    })()`,
    /** 赞赏 enabled = the reward settings checkbox checked (area-scoped, else the visible cell's). */
    reward: `(() => {
        const el = document.querySelector('#js_reward_setting_area .js_reward_setting_checkbox') ||
                  document.querySelector('.js_reward_allow_click_cell .js_reward_setting');
        return el ? el.checked === true : null;
    })()`,
} as const;

/** The claim probe's JSON answer: `{ enabled, matched }` or bare `null` (unobservable). */
const CLAIM_COMMITTED = `(() => {
    const area = document.querySelector('#js_claim_source_area');
    if (!area) return null;
    const label = area.querySelector('.js_claim_source_selected');
    const text = (label ? (label.textContent ?? '') : '').replace(/\\s+/g, ' ').trim();
    const checkbox = area.querySelector('.js_claim_source, input[type=checkbox]');
    const enabled = checkbox ? checkbox.checked === true : null;
    return { enabled, text };
})()`;

/** Read a settings checkbox's committed enabled state; `null` = unobservable (never "satisfied"). */
async function readChecked(page: WechatPage, expression: string): Promise<boolean | null> {
    try {
        const raw = await page.evaluate(expression);
        return typeof raw === 'boolean' ? raw : null;
    } catch {
        return null;
    }
}

/**
 * Set the operator's draft metadata (原创/赞赏/合集/原文链接/创作来源) in the v2 editor.
 *
 * Runs on a FRESH draft only — unrequested toggles are never turned off, but the toggles are not
 * otherwise state-aware for re-runs beyond the committed pre-read. Per-field failures are collected
 * into warnings and surfaced in the `Result`; the draft still saves.
 */
export async function enrichArticle(page: WechatPage, meta: Record<string, unknown>): Promise<string[]> {
    const warnings: string[] = [];
    const str = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
    const on = (key: string) => meta[key] === true;
    // Sweep any leaked dialog so the next step (especially 保存为草稿) is never overlay-blocked.
    const sweep = async (): Promise<'closed' | 'unknown'> => {
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
        const state = await modalState(page);
        if (state === 'open') {
            // One explicit close-button pass before giving up: some dialogs ignore Escape.
            for (const close of ['.weui-desktop-dialog__close-btn', '.weui-desktop-dialog__close']) {
                const control = await tryFindSelector(page, [close], 1_500);
                if (control === undefined) continue;
                try {
                    await clickSelector(page, control, 2_000);
                } catch {
                    // Gone between the probe and the click.
                }
                break;
            }
            return (await modalState(page)) === 'closed' ? 'closed' : 'unknown';
        }
        return state === 'closed' ? 'closed' : 'unknown';
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
    /**
     * One bounded retry per step: act, and on a non-capability failure sweep, RE-READ the committed
     * state, and retry once — a step that closed its dialog successfully on the sweep never clicks
     * again. A capability refusal (`CapabilityError`) is reported ONCE here and the caller skips its
     * post-read warning (the refusal is the outcome, not a missed commit).
     */
    const step = async (name: string, fn: () => Promise<void>): Promise<'ok' | 'failed' | 'capability'> => {
        try {
            await fn();
            return 'ok';
        } catch (error) {
            if (error instanceof CapabilityError) {
                warnings.push(`${name}: ${error.message}`);
                return 'capability';
            }
            // retry once below
        }
        await sweep();
        await page.waitForTimeout?.(STEP_RETRY_SETTLE_MS);
        try {
            await fn();
            return 'ok';
        } catch (error) {
            warnings.push(`${name}: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
            await sweep();
            return 'failed';
        }
    };
    /** The named warning for a dialog that is open or unreadable after a step — never "fine". */
    const residual = async (name: string): Promise<boolean> => {
        const state = await modalState(page);
        if (state === 'closed') return false;
        warnings.push(
            state === 'open'
                ? `${name}: dialog did not close — check the draft`
                : `${name}: dialog state unknown after cleanup — a residual overlay may block later steps`,
        );
        return true;
    };

    if (on('original')) {
        const name = '原创声明';
        // Already committed: never open rows (and never toggle a satisfied setting off).
        if ((await readChecked(page, COMMITTED.original)) !== true) {
            const outcome = await step(name, async () => {
                await openRow(ROW_ORIGINAL, '原创声明');
                // Measured 2026-10-13: pick the 文字原创 radio, check the agreement when it renders,
                // then 确定. The plain-text probe the old rail used could hit the dialog heading.
                await clickSelector(page, ORIGINAL_DECLARATION, 5_000);
                // trySelectors absorbs its own probe failures (returns found:false) — no .catch here.
                const agreement = await trySelectors(page, [ORIGINAL_AGREEMENT]);
                if (agreement.found) {
                    await clickSelector(page, ORIGINAL_AGREEMENT, 3_000);
                }
                await clickSelector(page, DIALOG_CONFIRM, 8_000);
            });
            if (
                outcome !== 'capability' &&
                (await readChecked(page, COMMITTED.original)) !== true &&
                !(await residual(name))
            ) {
                warnings.push(`${name}: 原创声明未生效，请手动设置`);
            }
        }
    }

    if (on('reward')) {
        const name = '赞赏';
        if ((await readChecked(page, COMMITTED.reward)) !== true) {
            const outcome = await step(name, async () => {
                await openRow(ROW_REWARD, '赞赏');
                // Measured 2026-10-13: without a 赏账户 the dialog renders the 前往开通 link + a
                // 无法开启-style prerequisite line instead of the account field — an operator action
                // (开通赞赏), never a selector failure, and no retry of this run can change it.
                const blocked = await tryFindSelector(
                    page,
                    [`${DIALOG} :has-text("前往开通")`, `${DIALOG} :has-text("无法开启")`],
                    1_500,
                );
                if (blocked !== undefined)
                    throw new CapabilityError('需要赞赏账户（运营者先在平台开通），已跳过自动填写');
                // 赞赏账户 defaults from 作者; fill it only when the platform left it empty.
                const author = str('author');
                if (author !== '') {
                    for (const selector of REWARD_ACCOUNT) {
                        // trySelectors absorbs its own probe failures (returns found:false), so no
                        // extra .catch is needed here.
                        const found = await trySelectors(page, [selector]);
                        if (!found.found) continue;
                        // Locator read, not native querySelector: the expression must stay native CSS
                        // (Playwright's `:visible` throws inside `evaluate`, task 0260 AC4).
                        const locator = page.locator(selector).first();
                        if (typeof locator.inputValue !== 'function') break;
                        const empty = norm(await locator.inputValue().catch(() => null)) === '';
                        if (empty) await fillSelector(page, selector, author);
                        break;
                    }
                }
                await clickSelector(page, DIALOG_CONFIRM, 8_000);
            });
            if (
                outcome !== 'capability' &&
                (await readChecked(page, COMMITTED.reward)) !== true &&
                !(await residual(name))
            ) {
                warnings.push(`${name}: 赞赏未生效，请手动设置`);
            }
        }
    }

    const collection = str('collection');
    if (collection !== '') {
        const name = '合集';
        await step(name, async () => {
            await openRow(ROW_COLLECTION, '合集');
            await waitForVisible(page, TAG_INPUT, 8_000);
            await fillSelector(page, TAG_INPUT, collection);
            await page.waitForTimeout?.(COLLECTION_SETTLE_MS);
            await clickSelector(page, `${DIALOG} :text("${collection}")`, 8_000);
            await clickSelector(page, DIALOG_CONFIRM, 8_000);
        });
        // 合集 keeps its existing behavior (no committed-value probe is shipped for the picker);
        // only its cleanup is isolated here.
        await residual(name);
    }

    const originalUrl = str('originalUrl');
    if (originalUrl !== '') {
        const name = '原文链接';
        // Measured 2026-10-13: some accounts no longer render the 原文链接 row at all. That is an
        // unavailable capability — report it once, never fall back to the composer's unrelated
        // `链接` row (`btm-card-link__switch`).
        const urlRow = await tryFindSelector(page, ROW_URL, 2_000);
        if (urlRow === undefined) {
            warnings.push(`${name}: 行不存在（当前公众号不支持），请手动处理或移除 originalUrl`);
        } else {
            await step(name, async () => {
                await openRow(ROW_URL, '原文链接');
                const field = await trySelectors(page, URL_INPUT);
                if (!field.found) throw new Error('no URL field in the 原文链接 dialog');
                await fillSelector(page, field.selector ?? URL_INPUT.join(', '), originalUrl);
                await clickSelector(page, DIALOG_CONFIRM, 8_000);
            });
            await residual(name);
            // Only a readable committed URL equal to the requested trimmed value counts; the
            // composer `链接` row is never consulted.
            const locator = page.locator(URL_INPUT[0] ?? '').first();
            const committed =
                typeof locator.inputValue === 'function' ? await locator.inputValue().catch(() => null) : null;
            if (norm(committed) !== norm(originalUrl)) warnings.push(`${name}: 已提交但未读取到已保存的链接，请核对`);
        }
    }

    // 创作来源 is the operator's chosen stance (`个人观点，仅供参考` for this column), not a fixed
    // "AI generated" declaration — the label is the metadata value so the operator owns the wording.
    const claimSource = str('claimSource');
    if (claimSource !== '') {
        const name = '创作来源';
        const claimMatched = async (): Promise<boolean | null> => {
            try {
                const raw = (await page.evaluate(CLAIM_COMMITTED)) as { enabled: boolean | null; text: string } | null;
                if (raw === null || typeof raw !== 'object') return null;
                return raw.enabled === true && norm(raw.text) === norm(claimSource);
            } catch {
                return null;
            }
        };
        if ((await claimMatched()) !== true) {
            await step(name, async () => {
                await openRow(ROW_CLAIM, '创作来源');
                const dialog = await waitForVisible(page, DIALOG, 3_000, { required: false });
                if (dialog !== undefined) {
                    await clickSelector(page, `${DIALOG} :text("${claimSource}")`, 8_000);
                    await clickSelector(page, DIALOG_CONFIRM, 8_000);
                }
            });
        }
        if ((await claimMatched()) !== true && !(await residual(name))) {
            warnings.push(`${name}: 未生效，请手动设置`);
        }
    }

    await sweep();
    return warnings;
}
