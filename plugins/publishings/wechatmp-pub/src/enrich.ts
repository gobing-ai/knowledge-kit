import { trySelectors } from '@gobing-ai/publish-harness';
import {
    bestEffortPress,
    clickSelector,
    fillSelector,
    modalState,
    tryFindSelector,
    type WechatPage,
    waitForVisible,
} from './page';

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
 * Dialog entries measured 2026-10-21. Confirm labels belong to each dialog: 原创 uses 确定,
 * 创作来源 uses 确认. A generic text match can hit an inert row heading instead of its opener.
 */
const ROW_ORIGINAL = ['#js_original .setting-group__content-info', '#js_original .setting-group__title'];
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
const ROW_URL = ['#js_article_url_area .js_article_url_allow_click'];
const ROW_CLAIM = ['#js_claim_source_area .allow_click_opr'];
const DIALOG_CONFIRM = CONFIRM;
const ORIGINAL_CONFIRM = `${DIALOG} button:text-is("确定")`;
const CLAIM_CONFIRM = `${DIALOG} button:text-is("确认")`;
const TAG_INPUT = 'input[placeholder*="合集"]';
/** The 赞赏 dialog's account field, filled only when the platform leaves it empty. */
const REWARD_ACCOUNT = [
    `${DIALOG} input[placeholder*="赞赏"]`,
    `${DIALOG} input[placeholder*="账户"]`,
    `${DIALOG} input.frm_input`,
];
/**
 * 原文链接 is a popover outside the dialog tree (measured 2026-10-21, task 0318).
 * Its field disappears on commit; committed readback belongs to the settings row.
 */
const URL_POPOVER = '.popover_inner:has(.popover-article-setting__content):visible';
const URL_INPUT = [`${URL_POPOVER} input.js_url[name="source_url"]`];
const URL_CONFIRM = `${URL_POPOVER} a.jsPopoverBt:text-is("确定")`;
const URL_CANCEL = `${URL_POPOVER} a.jsPopoverBt:text-is("取消")`;
const URL_COMMITTED = `(() => {
    const area = document.querySelector('#js_article_url_area');
    const checkbox = area?.querySelector('input.js_url_checkbox');
    return checkbox?.checked === true ? area.querySelector('.article_url_setting')?.textContent ?? null : null;
})()`;
/** The 原创 dialog's declaration radio (measured 2026-10-13): the platform requires an explicit
 *  declaration type + the agreement check before 确定. `无需声明` is the undo choice, never a target. */
const ORIGINAL_DECLARATION = `${DIALOG} label:has(.js_original_type_radio):has-text("文字原创")`;
/** Drive the hidden checkbox through its label, preserving a pre-checked agreement (probe 6). */
const ORIGINAL_AGREEMENT = `${DIALOG} label.original_agreement:has(input[type="checkbox"]:not(:checked))`;
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
    /** Both undeclared and declared templates keep hidden inputs. Read the switch in the visible
     * row branch, never the hidden undeclared template or the dialog's matching checkbox. */
    original: `(() => {
        const el = [...document.querySelectorAll('#js_original input.weui-desktop-switch__input')]
            .find(input => input.parentElement?.getClientRects().length > 0);
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

/**
 * The 赞赏 row's own state, measured 2026-11-20 on a fresh 文章 draft (account without an authorized
 * 赞赏 account): the row renders `.setting-group__switch.js_reward_allow_click` carrying the text
 * `不开启 … 无法开启赞赏，因为还没有赞赏账户授权给本公众号`, its box is **0×0**, and the click the rail
 * used to attempt therefore burned its full 8 s timeout (`赞赏: click: Timeout 8000ms exceeded`) on
 * an element no operator action in this run could make clickable. One bounded read answers both
 * questions — is the row blocked by text, and is there a box to click at all — before any click.
 * Native CSS only: Playwright's `:visible` throws inside `evaluate` (task 0260 AC4).
 */
const REWARD_STATE = `(() => {
    const rows = [
        document.querySelector('.js_reward_allow_click'),
        document.querySelector('.js_reward_open'),
        document.querySelector('.setting-group__switch.js_reward_open'),
    ].filter((el) => el !== null);
    if (rows.length === 0) return null;
    const blockedText = /无法开启赞赏|还没有赞赏账户|前往开通|未开通/;
    for (const el of rows) {
        const text = (el.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const box = el.getBoundingClientRect();
        if (blockedText.test(text) || (box.width === 0 && box.height === 0)) {
            return { clickable: false, blocked: true, text: text.slice(0, 200) };
        }
    }
    return { clickable: true, blocked: false, text: '' };
})()`;

/** `{ clickable, blocked, text }` from REWARD_STATE; `null` when the row is absent or unreadable. */
async function readRewardState(
    page: WechatPage,
): Promise<{ clickable: boolean; blocked: boolean; text: string } | null> {
    try {
        const raw: unknown = await page.evaluate(REWARD_STATE);
        if (typeof raw !== 'object' || raw === null) return null;
        const value = raw as { clickable?: unknown; blocked?: unknown; text?: unknown };
        if (typeof value.clickable !== 'boolean' || typeof value.blocked !== 'boolean') return null;
        return {
            clickable: value.clickable,
            blocked: value.blocked,
            text: typeof value.text === 'string' ? value.text : '',
        };
    } catch {
        return null;
    }
}

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
        const cancel = await trySelectors(page, ['button:has-text("取消")', URL_CANCEL]);
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
        await bestEffortPress(page, 'Escape', SWEEP_SETTLE_MS);
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
                // Measured 2026-10-21: keep the 文字原创 radio, click the agreement's label when it renders,
                // then 确定. The plain-text probe the old rail used could hit the dialog heading.
                await clickSelector(page, ORIGINAL_DECLARATION, 5_000);
                // trySelectors absorbs its own probe failures (returns found:false) — no .catch here.
                const agreement = await trySelectors(page, [ORIGINAL_AGREEMENT]);
                if (agreement.found) {
                    await clickSelector(page, ORIGINAL_AGREEMENT, 3_000);
                }
                await clickSelector(page, ORIGINAL_CONFIRM, 8_000);
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
                // Measured 2026-11-20: an account without an authorized 赞赏 account renders the row
                // with the refusal already in it and a 0×0 box, so opening/closing it is impossible and
                // the old path spent its whole 8 s click budget proving that. Read the row first — one
                // bounded evaluation, no click, no dialog wait — and report the capability in one step.
                const state = await readRewardState(page);
                if (state?.blocked === true) {
                    throw new CapabilityError(
                        `需要赞赏账户（本公众号未被授权，平台原文：${state.text === '' ? '无法开启赞赏' : state.text}）— 运营者在平台开通后重跑，本次不请求该字段`,
                    );
                }
                await openRow(ROW_REWARD, '赞赏');
                // Measured 2026-10-13: on other builds the prerequisite line appears only inside the
                // dialog, so the post-open probe stays for that shape. It stays short on purpose — the
                // row-level read above is what answers the measured 2026-11-20 account, and a longer
                // window here only slows every healthy run (a 4 s probe pushed the enrichment suites
                // past their own step budget).
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
        const readUrl = async () => {
            try {
                return norm(await page.evaluate(URL_COMMITTED));
            } catch {
                return '';
            }
        };
        // Measured 2026-10-13: some accounts no longer render the 原文链接 row at all. That is an
        // unavailable capability — report it once, never fall back to the composer's unrelated
        // `链接` row (`btm-card-link__switch`).
        const urlRow =
            (await readUrl()) === norm(originalUrl) ? 'committed' : await tryFindSelector(page, ROW_URL, 2_000);
        if (urlRow === undefined) {
            warnings.push(`${name}: 行不存在（当前公众号不支持），请手动处理或移除 originalUrl`);
        } else if (urlRow !== 'committed') {
            await step(name, async () => {
                if ((await readUrl()) === norm(originalUrl)) return;
                await openRow(ROW_URL, '原文链接');
                const field = await trySelectors(page, URL_INPUT);
                if (!field.found) throw new Error('no URL field in the 原文链接 popover');
                await fillSelector(page, field.selector ?? URL_INPUT.join(', '), originalUrl);
                await clickSelector(page, URL_CONFIRM, 8_000);
                // URL validation closes the popover asynchronously. Sweeping before it closes
                // cancels that pending commit and turns a valid URL into a false mismatch.
                await page.locator(URL_POPOVER).first().waitFor?.({ state: 'hidden', timeout: 8_000 });
            });
            if ((await readUrl()) !== norm(originalUrl)) warnings.push(`${name}: 已提交但未读取到已保存的链接，请核对`);
            // Popovers are outside modalState's dialog inventory; release one even on a moved field
            // or refused confirmation, before later settings and the draft save.
            if ((await trySelectors(page, [URL_POPOVER])).found) await sweep();
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
        let unavailable = false;
        if ((await claimMatched()) !== true) {
            const outcome = await step(name, async () => {
                await openRow(ROW_CLAIM, '创作来源');
                await waitForVisible(page, DIALOG, 3_000);
                const stance = `${DIALOG} label:has(input[type="radio"]):has(:text-is(${JSON.stringify(claimSource)}))`;
                if ((await tryFindSelector(page, [stance], 1_500)) === undefined) {
                    await sweep();
                    throw new CapabilityError(`平台未提供声明类型「${claimSource}」，已跳过`);
                }
                await clickSelector(page, stance, 8_000);
                await clickSelector(page, CLAIM_CONFIRM, 8_000);
            });
            unavailable = outcome === 'capability';
        }
        if (!unavailable && (await claimMatched()) !== true && !(await residual(name))) {
            warnings.push(`${name}: 未生效，请手动设置`);
        }
    }

    await sweep();
    return warnings;
}
