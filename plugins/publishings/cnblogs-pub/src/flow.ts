/**
 * cnblogs-pub transport + flow (task 0293).
 *
 * The live editor flow in `runArticleFlow`, stage-typed on every `Result.metadata.stage`:
 * editor-readiness → title-readback → body-readback → (summary-commit) → (category-commit) → the
 * publishStatus branch. Absent or 'draft' (the frozen default) activates only the exact-visible
 * 保存草稿|存为草稿 control; 'public' activates only 发布|发布博文. Both legs confirm success only
 * by a FRESH persisted receipt (an id-bearing draft/post URL that was not on screen before the
 * click) plus re-read persisted title/body/category state — never a stale assignment or toast.
 *
 * The vendor's `upload.cnblogs.com/v2/images/cors-upload` XSRF endpoint (cnblogs.js:5-18) is never
 * ported: cover/tags/images are unsupported-field refusals, and local (non-HTTPS) Markdown image
 * references are rejected before any browser opens, without echoing the path. Existing HTTPS image
 * URLs stay literal Markdown.
 */
import { type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    type PublishTransport,
    type PublishTransportPayload,
    trySelectors,
} from '@gobing-ai/publish-harness';
import {
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    resolveChannelProfileDir,
    resolveSelector,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import type { Page } from 'playwright';
import {
    CNBLOGS_ARTICLE_SELECTORS,
    CNBLOGS_CONFIG,
    CNBLOGS_EDIT_URL,
    CNBLOGS_RECEIPT_URL_RES,
    CNBLOGS_TARGET,
    isCnblogsAuthenticated,
} from './selectors';

const STEP_TIMEOUT_MS = 30_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const CNBLOGS_LOGIN_INSTRUCTION = 'bun plugins/publishings/cnblogs-pub/src/profile-check.ts login';

/** `ok: false` refusal Result with a bounded, single-line error. */
export function fail(target: string, error: string): Result {
    return ResultSchema.parse({ ok: false, target, error: boundedDetail(error) });
}

/** A browser-stage failure: `ok: false` with `stage` (and optional evidence) in the Result metadata. */
export function stageFail(
    target: string,
    error: string,
    stage: string,
    metadata: Record<string, unknown>,
    evidence?: string,
): Result {
    return ResultSchema.parse({
        ok: false,
        target,
        error: boundedDetail(error),
        metadata: { ...metadata, stage, ...(evidence === undefined ? {} : { evidence: boundedDetail(evidence) }) },
    });
}

/** One short line, bounded: no DOM dump, cookie, token, stack or leaked image path ever reaches the Result. */
export function boundedDetail(detail: string): string {
    return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** A bounded, single-line rendering of an operator-supplied value for a refusal message. */
export function bounded(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
    return String(value).replace(/\s+/g, ' ').slice(0, 100);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Session failures whose one-liner must name the recovery command. */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

/**
 * Counts Markdown image references whose target is not an HTTPS URL (`![…](src)` inline syntax,
 * the only images a plain-Markdown textarea renders). Local/relative and plain-http refs are
 * unsupported by this flow: the vendor's upload endpoint (cnblogs.js:5-18) is never ported, so
 * they are refused before submit — the count only, never the path.
 */
export function countNonHttpsImageRefs(markdown: string): number {
    const refs = markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g);
    let count = 0;
    for (const ref of refs) {
        const src = ref[1] ?? '';
        if (!src.startsWith('https://')) count += 1;
    }
    return count;
}

/** Whitespace-insensitive comparison: site normalizations must not fail a strict readback. */
function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
}

/** Input/textarea `value` property readback (title input, body editor, summary). */
function inputValueScript(selector: string): string {
    return `(() => { // kk-cnblogs-input-value
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.value ?? '');
})()`;
}

/**
 * One category commit probe over the panel: finds the checkbox whose associated label text equals
 * `wanted` exactly (wrapping label or `label[for]`), clicks it when unchecked, and reports the
 * observed checked state. No create, no first-match/fuzzy fallback — `offered:false` refuses.
 */
function commitCategoryScript(panelSelector: string, wanted: string): string {
    return `(() => { // kk-cnblogs-category-commit
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    if (panel === null) return JSON.stringify({ offered: false, checked: false });
    const wanted = ${JSON.stringify(wanted)};
    for (const box of panel.querySelectorAll('input[type="checkbox"]')) {
        const label = box.closest('label') ?? (box.id ? panel.querySelector('label[for="' + CSS.escape(box.id) + '"]') : null);
        if ((label?.textContent ?? '').trim() !== wanted) continue;
        if (!box.checked) box.click();
        return JSON.stringify({ offered: true, checked: box.checked === true });
    }
    return JSON.stringify({ offered: false, checked: false });
})()`;
}

/**
 * Persisted-state readback for save confirmation: the title/body textareas still hold the
 * requested text and every requested category checkbox is still checked (frozen success rule —
 * a fresh id alone never confirms).
 */
function persistedStateScript(title: string, body: string, categories: readonly string[]): string {
    return `(() => { // kk-cnblogs-persisted
    const title = document.querySelector('input#post-title');
    const editor = document.querySelector('textarea#md-editor');
    const squish = (v) => String(v ?? '').replace(/\\s+/g, '');
    const titleOk = title !== null && squish(title.value) === squish(${JSON.stringify(title)});
    const bodyOk = editor !== null && squish(editor.value) === squish(${JSON.stringify(body)});
    const missing = [];
    for (const wanted of ${JSON.stringify(categories)}) {
        let found = false;
        for (const panel of document.querySelectorAll(${JSON.stringify([...CNBLOGS_ARTICLE_SELECTORS.categoryPanel])})) {
            for (const box of panel.querySelectorAll('input[type="checkbox"]')) {
                const label = box.closest('label') ?? (box.id ? panel.querySelector('label[for="' + CSS.escape(box.id) + '"]') : null);
                if ((label?.textContent ?? '').trim() === wanted && box.checked === true) found = true;
            }
        }
        if (!found) missing.push(wanted);
    }
    return JSON.stringify({ titleOk, bodyOk, missing });
})()`;
}

/** Receipt-shaped URLs on screen (location + anchors) — the save-time baseline and fresh read. */
async function readReceiptUrls(page: Page): Promise<readonly string[]> {
    const raw = await page.evaluate(`(() => { // kk-cnblogs-receipt-urls
    const patterns = [${CNBLOGS_RECEIPT_URL_RES.map((re) => re.toString()).join(', ')}];
    const matches = (url) => patterns.some((re) => re.test(url));
    const urls = [];
    if (matches(location.href)) urls.push(location.href);
    for (const a of document.querySelectorAll('a[href]')) {
        if (matches(a.href) && !urls.includes(a.href)) urls.push(a.href);
    }
    return JSON.stringify(urls);
})()`);
    try {
        const parsed: unknown = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
}

/** Draft/post id from an observed receipt URL (shapes: `CNBLOGS_RECEIPT_URL_RES`, provisional). */
function articleIdFrom(url: string): string | undefined {
    return /(?:postId=|\/p\/)(\d+)/.exec(url)?.[1];
}

interface CommitOutcome {
    readonly ok: true;
    readonly evidence: string;
}
interface Refusal {
    readonly ok: false;
    readonly error: string;
}

/**
 * Cnblogs browser transport on the shared rails (ADR-027): a headless session preflight, one
 * headed flow, and success only from a fresh persisted receipt plus persisted field state.
 * publishStatus absent or 'draft' takes the draft leg (exact-visible 保存草稿|存为草稿); 'public'
 * activates 发布|发布博文; any other value refuses before the browser (ladder in
 * `src/index.ts` → `publish()`).
 */
export class CnblogsBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: 'article';
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: 'article' = 'article',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a live cnblogs Markdown article.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed persisted receipt.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // The operation was resolved (and unknown names refused) before this transport existed;
        // the remaining ladder is all pre-browser: driver → publishStatus → title → body → digest
        // → unsupported fields → categories → local Markdown images → session preflight.
        if (this.driver !== 'script') {
            return fail(
                CNBLOGS_TARGET,
                `unsupported driver '${bounded(this.driver)}' for ${CNBLOGS_TARGET}: expected one of script (the cnblogs-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(
                CNBLOGS_TARGET,
                `unknown publishStatus '${bounded(requested)}' for ${CNBLOGS_TARGET}: expected 'public', 'draft' or absent (absent defaults to draft)`,
            );
        }
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                CNBLOGS_TARGET,
                `cnblogs article requires a non-empty Content.title (the Markdown editor has an independent title field, cnblogs.js:22)`,
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                CNBLOGS_TARGET,
                'cnblogs article requires non-empty Content.body Markdown (the body is its own saved field, cnblogs.js:23)',
            );
        }
        const digest = payload.content.metadata?.digest;
        if (digest !== undefined && (typeof digest !== 'string' || digest.trim().length === 0)) {
            return fail(
                CNBLOGS_TARGET,
                `metadata.digest must be a non-empty string when present, got '${bounded(digest)}'`,
            );
        }
        const unsupported = unsupportedFields(payload);
        if (unsupported.length > 0) {
            return fail(
                CNBLOGS_TARGET,
                `unsupported field(s) ${unsupported.join(', ')} for cnblogs: this flow implements title/body/digest/categories only, and the vendor's upload.cnblogs.com XSRF image endpoint (cnblogs.js:5-18) is never ported`,
            );
        }
        const categories = resolveCategoryList(payload.options?.categories ?? payload.content.metadata?.categories);
        if ('error' in categories) return fail(CNBLOGS_TARGET, categories.error);
        const localImages = countNonHttpsImageRefs(body);
        if (localImages > 0) {
            return fail(
                CNBLOGS_TARGET,
                `${localImages} non-HTTPS Markdown image reference(s) in Content.body: cnblogs-pub does not upload images (the upload.cnblogs.com XSRF endpoint is never ported); keep existing https:// image URLs literal and remove/local-check local references before publishing`,
            );
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CNBLOGS_TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(CNBLOGS_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                CNBLOGS_TARGET,
                `${CNBLOGS_TARGET} session preflight refused — run: ${CNBLOGS_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: CNBLOGS_EDIT_URL,
                    isAuthenticated: isCnblogsAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runArticleFlow(
                        page,
                        title,
                        body,
                        digest as string | undefined,
                        categories.names,
                        profileDir,
                        publishStatus,
                    ),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                CNBLOGS_TARGET,
                needsLogin(error)
                    ? `${CNBLOGS_TARGET} session failed — run: ${CNBLOGS_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The live article flow on the already-navigated post-edit page (`CNBLOGS_EDIT_URL`):
     * read-only capability probe → title/body fill with strict value readback (native value +
     * input events via Playwright fill, never innerHTML) → optional digest → optional exact
     * category checkbox commits → the publishStatus branch. Success on either leg is a fresh
     * id-bearing receipt URL plus persisted title/body/category state.
     */
    private async runArticleFlow(
        page: Page,
        title: string,
        body: string,
        digest: string | undefined,
        categories: readonly string[],
        profileDir: string,
        publishStatus: 'draft' | 'public',
    ): Promise<Result> {
        const metadata = { operation: this.operation, driver: this.driver, publishStatus, profileDir };

        // Read-only capability probe: visibility only — nothing is typed or submitted, so a
        // refusal here can never leave a half-filled form behind. The grounded pair must be
        // visible (else the page is wrong or logged out).
        const grounded: Record<string, boolean> = {};
        for (const key of ['titleInput', 'bodyEditor'] as const) {
            let selector: string;
            try {
                selector = await resolveSelector(page, CNBLOGS_ARTICLE_SELECTORS[key], {
                    timeoutMs: this.stepTimeoutMs,
                    label: `cnblogs ${key}`,
                });
            } catch (error) {
                return stageFail(
                    CNBLOGS_TARGET,
                    `cnblogs grounded editor control ${key} never attached on ${CNBLOGS_EDIT_URL}: ${errorMessage(error)} — run: ${CNBLOGS_LOGIN_INSTRUCTION}`,
                    'editor-readiness',
                    metadata,
                );
            }
            grounded[key] = (
                await trySelectors(page, [selector], { visible: true, timeout: this.stepTimeoutMs })
            ).found;
        }
        if (!grounded.titleInput || !grounded.bodyEditor) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs grounded editor controls found but not visible on ${CNBLOGS_EDIT_URL} — run: ${CNBLOGS_LOGIN_INSTRUCTION}`,
                'editor-readiness',
                metadata,
                `grounded visible: ${JSON.stringify(grounded)}`,
            );
        }

        // Title: native value fill with real input events, then strict readback (cnblogs.js:28).
        try {
            const titleSelector = await resolveSelector(page, CNBLOGS_ARTICLE_SELECTORS.titleInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'cnblogs title input',
            });
            await page.locator(titleSelector).first().fill(title);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(inputValueScript(titleSelector)))) === normalizeText(title)
                        ? 'title read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'cnblogs title readback' },
            );
            if (!readback.ok)
                return stageFail(
                    CNBLOGS_TARGET,
                    `cnblogs title readback failed — the editor did not retain the requested title — ${readback.error}`,
                    'title-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs title fill failed — ${errorMessage(error)}`,
                'title-readback',
                metadata,
            );
        }

        // Body: native value fill with real input events on the Markdown textarea, then strict
        // readback (cnblogs.js:23, 29) — a dropped body must refuse before anything is saved.
        try {
            const bodySelector = await resolveSelector(page, CNBLOGS_ARTICLE_SELECTORS.bodyEditor, {
                timeoutMs: this.stepTimeoutMs,
                label: 'cnblogs Markdown body editor',
            });
            await page.locator(bodySelector).first().fill(body);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(inputValueScript(bodySelector)))) === normalizeText(body)
                        ? 'body read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'cnblogs body readback' },
            );
            if (!readback.ok)
                return stageFail(
                    CNBLOGS_TARGET,
                    `cnblogs body readback failed — the editor did not retain the requested Markdown — ${readback.error}`,
                    'body-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs body fill failed — ${errorMessage(error)}`,
                'body-readback',
                metadata,
            );
        }

        // Summary/digest: only when a digest was requested (cnblogs.js:30-31 fills only then);
        // the control is grounded, so absence refuses instead of dropping the digest silently.
        if (digest !== undefined) {
            try {
                const summarySelector = await resolveSelector(page, CNBLOGS_ARTICLE_SELECTORS.summaryInput, {
                    timeoutMs: this.stepTimeoutMs,
                    label: 'cnblogs summary textarea',
                });
                await page.locator(summarySelector).first().fill(digest);
                const readback = await expectOutcome(
                    async () =>
                        normalizeText(String(await page.evaluate(inputValueScript(summarySelector)))) ===
                        normalizeText(digest)
                            ? 'summary read back'
                            : null,
                    { timeoutMs: this.stepTimeoutMs, label: 'cnblogs summary readback' },
                );
                if (!readback.ok)
                    return stageFail(
                        CNBLOGS_TARGET,
                        `cnblogs summary readback failed — the editor did not retain the requested digest — ${readback.error}`,
                        'summary-commit',
                        metadata,
                    );
            } catch (error) {
                return stageFail(
                    CNBLOGS_TARGET,
                    `cnblogs summary fill failed — ${errorMessage(error)}`,
                    'summary-commit',
                    metadata,
                );
            }
        }

        // Categories: exact existing account names only, matched through label-associated
        // checkboxes and verified checked — never created, never first-matched.
        if (categories.length > 0) {
            const committed = await this.commitCategories(page, categories);
            if (!committed.ok) return stageFail(CNBLOGS_TARGET, committed.error, 'category-commit', metadata);
        }

        // The status branch. Draft leg: only the exact-visible draft-labeled control. Public leg:
        // only the exact-visible publish control. Both fail closed when absent — no broad
        // primary-button fallback — and confirm only a fresh persisted receipt plus persisted state.
        if (publishStatus === 'draft')
            return this.save(
                page,
                CNBLOGS_ARTICLE_SELECTORS.draftSave,
                'draft-save',
                metadata,
                title,
                body,
                categories,
                profileDir,
            );
        return this.save(
            page,
            CNBLOGS_ARTICLE_SELECTORS.publishButton,
            'publish-open',
            { ...metadata },
            title,
            body,
            categories,
            profileDir,
            'publish-confirmation',
        );
    }

    /**
     * Commits each requested category by exact label text in the category panel and verifies the
     * checkbox is checked. A name the panel does not offer (or that will not stay checked)
     * refuses the save — no create, no first-match fallback.
     */
    private async commitCategories(page: Page, categories: readonly string[]): Promise<CommitOutcome | Refusal> {
        try {
            const panelSelector = await resolveSelector(page, CNBLOGS_ARTICLE_SELECTORS.categoryPanel, {
                timeoutMs: this.stepTimeoutMs,
                label: 'cnblogs category panel',
            });
            for (const category of categories) {
                const outcome = await expectOutcome(
                    async () => {
                        const raw = String(await page.evaluate(commitCategoryScript(panelSelector, category)));
                        const state = JSON.parse(raw) as { offered: boolean; checked: boolean };
                        return state.offered && state.checked ? `category 「${bounded(category)}」 checked` : null;
                    },
                    {
                        timeoutMs: this.stepTimeoutMs,
                        label: `cnblogs category 「${bounded(category)}」 exact checkbox commit`,
                    },
                );
                if (!outcome.ok) {
                    return {
                        ok: false,
                        error: `cnblogs category panel has no checked checkbox labelled 「${bounded(category)}」; refusing to save with a substituted, created or first-matched category`,
                    };
                }
            }
            return { ok: true, evidence: `${categories.length} category checkbox(es) verified checked` };
        } catch (error) {
            return { ok: false, error: `cnblogs category commit failed — ${errorMessage(error)}` };
        }
    }

    /**
     * One status leg: resolve the exact-visible control (`stage` names the leg — draft-save or
     * publish-open), require it visible and enabled, snapshot receipt URLs, click, then confirm
     * only a FRESH id-bearing receipt URL (not on screen beforehand) plus persisted
     * title/body/category state (`confirmStage`). Stale or absent never passes.
     */
    private async save(
        page: Page,
        controls: readonly string[],
        stage: 'draft-save' | 'publish-open',
        metadata: Record<string, unknown>,
        title: string,
        body: string,
        categories: readonly string[],
        profileDir: string,
        confirmStage: 'draft-save' | 'publish-open' | 'publish-confirmation' = stage,
    ): Promise<Result> {
        let selector: string;
        try {
            selector = await resolveSelector(page, controls, {
                timeoutMs: this.stepTimeoutMs,
                label: `cnblogs ${stage} control`,
            });
        } catch (error) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs ${stage} control never attached: ${errorMessage(error)}`,
                stage,
                metadata,
            );
        }
        const button = page.locator(selector).first();
        const visible = (await trySelectors(page, [selector], { visible: true, timeout: this.stepTimeoutMs })).found;
        if (!visible)
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs ${stage} control attached but not visible; refusing to save through a hidden control`,
                stage,
                metadata,
            );
        const enabled = await expectOutcome(async () => ((await button.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: `cnblogs ${stage} control enabled`,
        });
        if (!enabled.ok)
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs ${stage} control never became clickable — ${enabled.error}`,
                stage,
                metadata,
            );
        // Baseline before the click: only a receipt absent beforehand can confirm (fresh-signal rule).
        const beforeReceipts = new Set(await readReceiptUrls(page));
        await button.click();
        const confirmed = await expectOutcome(
            async () => {
                const url = (await readReceiptUrls(page)).find((candidate) => !beforeReceipts.has(candidate));
                if (url === undefined) return null;
                const raw = String(await page.evaluate(persistedStateScript(title, body, categories)));
                const state = JSON.parse(raw) as { titleOk: boolean; bodyOk: boolean; missing: string[] };
                if (!state.titleOk || !state.bodyOk || state.missing.length > 0) {
                    return `stale-state: ${url}`; // a receipt whose fields no longer match is not success
                }
                return url;
            },
            { timeoutMs: this.stepTimeoutMs, label: `cnblogs ${confirmStage} confirmation` },
        );
        if (!confirmed.ok) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs ${confirmStage} not confirmed — no fresh id-bearing receipt with persisted title/body/category state appeared`,
                confirmStage,
                metadata,
                `still on ${page.url()}; ${beforeReceipts.size} pre-existing receipt-shaped url(s)`,
            );
        }
        if (confirmed.evidence.startsWith('stale-state: ')) {
            return stageFail(
                CNBLOGS_TARGET,
                `cnblogs ${confirmStage} receipt appeared but the persisted title/body/category state no longer matches the requested content; refusing to claim success`,
                confirmStage,
                metadata,
                confirmed.evidence,
            );
        }
        const url = confirmed.evidence;
        return ResultSchema.parse({
            ok: true,
            target: CNBLOGS_TARGET,
            id: articleIdFrom(url),
            url,
            message: `cnblogs article ${stage === 'draft-save' ? 'draft saved' : 'published'} in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: confirmStage },
        });
    }
}

/**
 * Unsupported requested fields for this flow: cover/tags/images are not implemented (the vendor's
 * upload.cnblogs.com XSRF image endpoint, cnblogs.js:5-18, is never ported), so any of them — in
 * options or metadata — is a typed unsupported-field refusal, never a silent claim of applied.
 */
function unsupportedFields(payload: PublishTransportPayload): readonly string[] {
    const refused: string[] = [];
    for (const [container, keys] of [
        ['options', ['coverPath', 'tags', 'images'] as const],
        ['metadata', ['coverPath', 'tags', 'images'] as const],
    ] as const) {
        const source: unknown = container === 'options' ? payload.options : payload.content.metadata;
        for (const key of keys) {
            if (source !== undefined && source !== null && typeof source === 'object' && key in source) {
                refused.push(`${container}.${key}`);
            }
        }
    }
    return refused;
}

/**
 * Shape-check for the exact-name category list: an array of non-empty names, refused — never
 * sliced or guessed — when wrong-typed or empty-entry-ed. Exact checkbox matching against the
 * category panel happens in the flow; this gate only keeps wrong shapes from reaching a browser.
 */
function resolveCategoryList(raw: unknown): { names: string[] } | { error: string } {
    if (raw === undefined) return { names: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.categories must be an array of non-empty exact names, got '${bounded(raw)}'` };
    }
    const names: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.categories entries must be non-empty exact names, got '${bounded(entry)}'` };
        }
        names.push(entry.trim());
    }
    return { names };
}
