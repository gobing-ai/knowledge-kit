/**
 * X (Twitter) browser post rail — the `post` operation through the signed-in session.
 *
 * WHY this module exists (2026-11-16, operator decision): `post` shipped as the official tweets API
 * only, so a `kk bot` login could never publish a promotion. The rail here drives the signed-in web
 * composer, so a session is enough; the API transport stays available behind `X_POST_TRANSPORT=api`.
 *
 * The surface below was measured with an operator-driven headed session on 2026-11-16 (every click
 * and keystroke recorded), which corrected two wrong assumptions that made earlier attempts fail:
 *   1. `https://x.com/compose/post` on its own redirects to the timeline; the composer is reached by
 *      clicking `[data-testid="SideNav_NewTweet_Button"]` on `/home`.
 *   2. The composer is the full `/compose/post` PAGE — there is no `[role="dialog"]` around it. A
 *      dialog-scoped lookup finds only a hidden template whose button never enables, which is exactly
 *      the "submit stayed disabled" timeout that hid a working publisher.
 * Measured control set: editor `[data-testid="tweetTextarea_0"]` (Draft.js — needs real key events,
 * `fill()` leaves Post disabled), media `button[aria-label="Add photos or video"]` then
 * `input[data-testid="fileInput"]`, submit `[data-testid="tweetButton"]`.
 */
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join } from 'node:path';
import type { Result } from '@gobing-ai/kk-core';
import { ResultSchema } from '@gobing-ai/kk-core';
import { type PublishTransport, type PublishTransportPayload, trySelectors } from '@gobing-ai/publish-harness';
import {
    type ChannelBrowserConfig,
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    resolveChannelProfileDir,
    resolveSelector,
    uploadFile,
} from '@gobing-ai/publish-harness/browser';
import type { BrowserLauncher, IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';
import { withProfilePage } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { Page } from 'playwright';

const TARGET = 'x';
const LOGIN_INSTRUCTION = 'bun plugins/publishings/x-pub/src/profile-check.ts login';
const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_URL_RE = /\/(?:i\/flow\/login|login|account\/access)/;
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Timeline that hosts the nav Post button. */
export const X_POST_URL = 'https://x.com/home';
/** The nav "Post" link that routes to the composer. */
export const X_NEW_POST_BUTTON = '[data-testid="SideNav_NewTweet_Button"]';
/** Composer page the nav button lands on. */
export const X_COMPOSE_PATH = '/compose/post';
/**
 * Submit controls, measured 2026-11-20 on `/compose/post`: the **page** composer carries
 * `[data-testid="tweetButton"]`, and the inline composer on `/home` carries
 * `[data-testid="tweetButtonInline"]`. Both start `disabled`/`aria-disabled="true"` and enable as soon
 * as the editor holds text, so the rail must accept either rather than assume the page one survives.
 */
export const X_POST_SUBMIT = '[data-testid="tweetButton"]';
export const X_POST_SUBMIT_INLINE = '[data-testid="tweetButtonInline"]';
export const X_POST_SUBMITS: readonly string[] = [X_POST_SUBMIT, X_POST_SUBMIT_INLINE];

/** Composer controls, all page-scoped (measured 2026-11-16). */
export const POST_SELECTORS = {
    text: ['[data-testid="tweetTextarea_0"]'],
    mediaButton: ['button[aria-label="Add photos or video"]', '[aria-label*="Add photos" i]'],
    fileInput: ['input[data-testid="fileInput"]', '[data-testid="fileInput"]'],
    mediaPreview: ['[data-testid="attachments"]', '[aria-label*="Media" i]'],
    profileLink: ['a[data-testid="AppTabBar_Profile_Link"]'],
} as const;

/** Readiness predicate: no login redirect and the nav Post button rendered. */
export const isPostAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (LOGIN_URL_RE.test(page.url())) return false;
    return (await trySelectors(page, [X_NEW_POST_BUTTON], { visible: false })).found;
};

/** Session preflight config for the post rail. */
export const POST_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: X_POST_URL,
    isAuthenticated: isPostAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    // X login-walls headless loads (same reason as the article rail): one headed pass fits kk's probe
    // budget, the headless-first + headed-fallback ladder spends two deadlines and gets killed.
    checkHeadedOnly: true,
};

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error, effect: 'none' });
}

function needsLogin(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error);
    return /login|sign in|logged out/i.test(text);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Validates a requested cover path: absolute, existing, image extension. */
async function resolveCover(
    raw: unknown,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ path: string } | { error: string } | undefined> {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { error: `x post cover must be a non-empty local path, got '${String(raw)}'` };
    }
    if (!isAbsolute(raw)) return { error: `x post cover must be an absolute path, got '${raw}'` };
    if (!COVER_EXTS.has(extname(raw).toLowerCase())) {
        return { error: `x post cover must be .png/.jpg/.jpeg/.webp, got '${extname(raw) || '(none)'}'` };
    }
    // Existence via the FileSystem seam (no direct fs import); media bytes are handed to the browser.
    if (!(await fs.exists(raw))) return { error: `x post cover does not exist: ${raw}` };
    return { path: raw };
}

/** Browser transport for `post`. */
export class XPostBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';

    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;

    constructor(deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {}) {
        // The harness launcher honours KK_BROWSER_CHANNEL; withProfilePage's own default is a plain
        // chromium launch, and Playwright's bundled chromium-1187 dies on this machine.
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const requested = payload.content.metadata?.publishStatus;
        if (requested === 'draft') {
            return fail(
                'x post has no draft: the compose surface publishes immediately — plan this target dummy/off or launch it live',
            );
        }
        if (requested !== undefined && requested !== 'public') {
            return fail(`unknown publishStatus '${requested}' for x post: expected 'public' or absent`);
        }
        const text = (payload.content.body ?? payload.content.title ?? '').trim();
        if (text === '') return fail('x post requires non-empty Content.body or Content.title');
        const cover = await resolveCover(
            payload.content.metadata?.coverPath ?? payload.options?.coverPath ?? payload.content.metadata?.coverImage,
        );
        if (cover !== undefined && 'error' in cover) return fail(cover.error);
        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(POST_CONFIG.channel, override);
        const session = await checkChannelSession(POST_CONFIG, {
            profileDir,
            launcher: this.launcher,
            // X login-walls headless loads, so a headless-first ladder spends two deadlines here
            // and gets killed by kk's probe budget (same as the article rail).
            headedOnly: true,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${TARGET} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`);
        }
        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: X_POST_URL,
                    isAuthenticated: isPostAuthenticated,
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runPostFlow(
                        page,
                        text,
                        cover !== undefined && 'path' in cover ? cover.path : undefined,
                        profileDir,
                    ),
            );
        } catch (error) {
            const hint = needsLogin(error) ? ` — run: ${LOGIN_INSTRUCTION}` : '';
            return fail(`${errorMessage(error)}${hint}`);
        }
    }

    /** Newest `/status/<id>` on the account's profile page (null when it carries none yet). */
    private async newestStatusId(page: Page, handleHref: string): Promise<string | null> {
        const target = `https://x.com${handleHref}`;
        if (!page.url().startsWith(target)) {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs });
        } else {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs }).catch(() => {});
        }
        const link = page.locator('[data-testid="tweet"] a[href*="/status/"]').first();
        if ((await link.count()) === 0) return null;
        const href = await link.getAttribute('href').catch(() => null);
        return href === null ? null : (/\/status\/(\d+)/.exec(href)?.[1] ?? null);
    }

    /** Opens the composer page from /home (the direct URL redirects to the timeline). */
    private async openComposer(page: Page): Promise<string | null> {
        if (!page.url().includes(X_COMPOSE_PATH)) {
            if (!page.url().startsWith('https://x.com/home')) {
                await page.goto(X_POST_URL, { waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs });
            }
            const opener = await expectOutcome(
                async () => ((await page.locator(X_NEW_POST_BUTTON).count()) > 0 ? 'post button rendered' : null),
                { timeoutMs: this.stepTimeoutMs, label: 'x nav post button' },
            );
            if (!opener.ok) return `x home never rendered the Post button: ${opener.error}`;
            await page.locator(X_NEW_POST_BUTTON).first().click();
        }
        const composer = await expectOutcome(
            async () => {
                if (!page.url().includes(X_COMPOSE_PATH)) return null;
                return (await page.locator(POST_SELECTORS.text[0]).count()) > 0 ? 'composer open' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'x compose/post surface' },
        );
        return composer.ok ? null : `x composer never opened at ${X_COMPOSE_PATH}: ${composer.error}`;
    }

    /**
     * Types the text and requires the Post control to enable (bounded three attempts).
     *
     * Measured 2026-11-20: **Escape on `/compose/post` navigates to `/home`** — the compose surface is a
     * page there, not an overlay — so the old "press Escape to clear the mask" first move threw the
     * run off the page whose submit it then waited on (`[data-testid="tweetButton"]` is page-scoped and
     * disappears), and every attempt ended as "post submit never enabled". A mask, when it exists, is
     * cleared by the forced editor click below, which never navigates.
     */
    private async typeAndEnable(page: Page, text: string): Promise<string | null> {
        const textBox = page.locator(POST_SELECTORS.text[0]).first();
        for (let attempt = 1; attempt <= 3; attempt++) {
            await page.waitForTimeout(250);
            const focused = await textBox.click({ force: true }).then(
                () => true,
                () =>
                    textBox
                        .focus()
                        .then(() => true)
                        .catch(() => false),
            );
            if (!focused) return 'x composer editor could not be focused';
            await page.waitForTimeout(300);
            await textBox.press('ControlOrMeta+a').catch(() => {});
            await textBox.press('Backspace').catch(() => {});
            await textBox.pressSequentially(text, { delay: 8 });
            const enabled = await expectOutcome(
                async () => ((await this.findEnabledSubmit(page)) !== null ? 'post enabled' : null),
                // One step, capped at 10s: a caller may shrink the step (tests), never stretch it.
                { timeoutMs: Math.min(10_000, this.stepTimeoutMs), label: `x post enabled (attempt ${attempt})` },
            );
            if (enabled.ok) return null;
        }
        return 'x post submit never enabled — the editor did not accept the text in three attempts';
    }

    /**
     * Locates an enabled submit control across page (`tweetButton`) and inline (`tweetButtonInline`)
     * surfaces without letting `.first()` stall 30s on an absent node or pick a disabled hidden twin.
     */
    private async findEnabledSubmit(
        page: Page,
        opts: { preferVisible?: boolean } = {},
    ): Promise<ReturnType<Page['locator']> | null> {
        let enabledFallback: ReturnType<Page['locator']> | null = null;
        for (const selector of X_POST_SUBMITS) {
            const loc = page.locator(selector);
            const count = await loc.count().catch(() => 0);
            const limit = Math.max(1, count);
            for (let index = 0; index < limit; index += 1) {
                const candidate = index === 0 ? loc.first() : loc.nth(index);
                const enabled = await candidate.isEnabled({ timeout: 1_000 }).catch(() => false);
                if (!enabled) continue;
                if (opts.preferVisible !== true) return candidate;
                // A visible, enabled control is the real one; the composer page also renders a hidden
                // template whose button is enabled-looking but never posts. Preferring visibility and
                // accepting enabled-only when visibility cannot be established keeps a surface whose
                // button reports no layout (and the test double) working.
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) return candidate;
                enabledFallback ??= candidate;
            }
        }
        return enabledFallback;
    }

    private async runPostFlow(
        page: Page,
        text: string,
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: 'post', driver: 'script', publishStatus: 'public', profileDir };
        // Order matters (measured 2026-11-16): read the profile link and baseline the newest status
        // FIRST, then open the composer once. Re-opening the composer after a profile visit leaves a
        // mask over the editor (`[data-testid="mask"]` intercepts pointer events).
        const handle = await page
            .locator(POST_SELECTORS.profileLink[0])
            .first()
            .getAttribute('href')
            .catch(() => null);
        if (handle === null || handle.trim() === '') {
            return fail('x post could not read the profile link, so the status id cannot be confirmed');
        }
        const baselineId = await this.newestStatusId(page, handle).catch(() => null);

        const opened = await this.openComposer(page);
        if (opened !== null) return fail(opened);

        const typed = await this.typeAndEnable(page, text);
        if (typed !== null) return fail(`${typed}; refusing to claim a publish`);

        if (coverPath !== undefined) {
            const media = await expectOutcome(
                async () => {
                    const found = await trySelectors(page, POST_SELECTORS.mediaButton);
                    return found.found ? (found.selector ?? POST_SELECTORS.mediaButton[0]) : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'x media button' },
            );
            if (!media.ok) return fail(`x media control never attached: ${media.error}`);
            await page.locator(media.evidence).first().click();
            const input = await resolveSelector(page, POST_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'x post media input',
            });
            await uploadFile(page, input, coverPath, { timeoutMs: this.stepTimeoutMs });
            const attached = await expectOutcome(
                async () =>
                    (await page.locator(POST_SELECTORS.mediaPreview[0]).count()) > 0 ? 'media attached' : null,
                { timeoutMs: this.stepTimeoutMs, label: 'x post media' },
            );
            if (!attached.ok) return fail(`x post image was uploaded but never rendered: ${attached.error}`);
            const reEnabled = await expectOutcome(
                async () => ((await this.findEnabledSubmit(page)) !== null ? 'post re-enabled' : null),
                // Four steps: X transcodes the image and only then re-enables Post (30s step → 120s).
                { timeoutMs: this.stepTimeoutMs * 4, label: 'x post submit enabled after media' },
            );
            if (!reEnabled.ok) {
                // The submit state is a projection of what X thinks the composer holds: an empty
                // editor (a re-mount dropped the typed text), a rejected upload, or an account
                // banner all look identical as "disabled". Report the evidence instead of the
                // symptom — the first live failure (2026-11-20) named only the timeout.
                const observable = page as unknown as { evaluate?: (script: string) => Promise<unknown> };
                const evidence = await (observable.evaluate === undefined
                    ? Promise.resolve(null)
                    : observable
                          .evaluate(`(() => {
                        const readDisabled = (el) => el === null ? 'missing' : (el.getAttribute('aria-disabled') ?? (el.disabled === true ? 'true' : 'false'));
                        const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
                        const submit = document.querySelector('${X_POST_SUBMIT}');
                        const inlineSubmit = document.querySelector('${X_POST_SUBMIT_INLINE}');
                        const alerts = [...document.querySelectorAll('[data-testid="toast"], [role="alert"], [data-testid="error-detail"]')]
                            .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
                        const images = [...document.querySelectorAll('[data-testid="attachments"] img, [data-testid="tweetPhoto"] img')].length;
                        return JSON.stringify({
                            url: location.pathname,
                            textLen: (editor?.textContent || '').trim().length,
                            submitDisabled: readDisabled(submit),
                            inlineDisabled: readDisabled(inlineSubmit),
                            images,
                            alerts,
                        });
                    })()`)
                          .catch(() => null));
                return fail(
                    `x post submit stayed disabled after the media: ${reEnabled.error}${evidence ? ` — composer ${String(evidence)}` : ''}`,
                );
            }
        }

        // Click the submit that is actually VISIBLE and ENABLED, across both surfaces (`tweetButton`
        // / `tweetButtonInline` and non-first visible twins).
        const submit = await this.findEnabledSubmit(page, { preferVisible: true });
        if (submit === null) return fail('x post submit was enabled a moment ago but no clickable control remained');
        await submit.click();
        // Capture the composer's immediate reaction. The receipt step navigates to the profile, so
        // any validation toast, "Posting…" state or blocking modal is gone by the time it reports —
        // which is exactly how two silent failures happened on 2026-11-20. A screenshot is the
        // cheapest decisive evidence: X says WHY it refused, in the UI, once.
        await page.waitForTimeout(2_500);
        // The double in `tests/post-rail.test.ts` models only the surface the rail clicks and reads;
        // evaluate/screenshot are evidence-only, so a page without them must still publish.
        const observable = page as unknown as {
            evaluate?: (script: string) => Promise<unknown>;
            screenshot?: (options: { path: string }) => Promise<unknown>;
        };
        const afterClick = await (observable.evaluate === undefined
            ? Promise.resolve(null)
            : observable
                  .evaluate(`(() => {
                const alerts = [...document.querySelectorAll('[data-testid="toast"], [role="alert"], [data-testid="error-detail"]')]
                    .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
                const dialogs = [...document.querySelectorAll('[role="dialog"]')]
                    .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 2);
                const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
                return JSON.stringify({
                    path: location.pathname,
                    textLen: (editor?.textContent || '').trim().length,
                    alerts,
                    dialogs,
                });
            })()`)
                  .catch(() => null));
        const shot = join(tmpdir(), `kk-x-post-${Date.now()}.png`);
        const shotOk = await (observable.screenshot === undefined
            ? Promise.resolve(false)
            : observable
                  .screenshot({ path: shot })
                  .then(() => true)
                  .catch(() => false));
        const receipt = await expectOutcome(
            async () => {
                const id = await this.newestStatusId(page, handle);
                if (id === null) return null;
                if (baselineId !== null && id === baselineId) return null;
                return `https://x.com${handle}/status/${id}`;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'x status receipt' },
        );
        // X's own confirmation toast is a receipt in its own right. The profile-timeline poll above
        // is the *preferred* evidence because it yields the status id, but the timeline can lag or
        // refuse to render for a session that still posts fine (measured 2026-11-20: the toast read
        // "Your post was sent. You have 1 hour to make any edits.", the profile showed nothing within
        // 30 s, and the row failed — so a retry posted the same text AGAIN). Confirming on the toast
        // turns a duplicate-generating "failure" into an honest success with no status id.
        const sentToast = /post was sent|已发布|发送成功|已发送/i.test(String(afterClick ?? ''));
        if (!receipt.ok && sentToast) {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                url: `https://x.com${handle}`,
                message: `x post sent — X confirmed it in the composer toast; the profile timeline had not rendered it yet, so no status id was recorded`,
                metadata: { ...metadata, confirmedBy: 'post-sent-toast' },
            });
        }
        if (!receipt.ok) {
            // Name what the console said, not just that nothing appeared: a validation toast, a
            // duplicate guard, an alt-text prompt and a swallowed click all look identical here.
            const evidence = await (observable.evaluate === undefined
                ? Promise.resolve(null)
                : observable
                      .evaluate(`(() => {
                    const alerts = [...document.querySelectorAll('[data-testid="toast"], [role="alert"], [data-testid="error-detail"]')]
                        .map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
                    const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
                    return JSON.stringify({
                        url: location.pathname,
                        textLen: (editor?.textContent || '').trim().length,
                        alerts,
                    });
                })()`)
                      .catch(() => null));
            return fail(
                `x post receipt not confirmed — Post was clicked but no new status id appeared on the profile (${receipt.error}); an unobserved submit is never reported as published${afterClick ? ` — after click ${afterClick}` : ''}${shotOk ? ` — screenshot ${shot}` : ''}${evidence ? ` — console ${evidence}` : ''}`,
            );
        }
        const id = /\/status\/(\d+)/.exec(receipt.evidence)?.[1];
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: receipt.evidence,
            message: `x post published and confirmed in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: 'profile-timeline' },
        });
    }
}
