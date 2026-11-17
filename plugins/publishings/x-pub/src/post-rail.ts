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
import { extname, isAbsolute } from 'node:path';
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
/** Page-scoped submit (the composer is a page, not a dialog). */
export const X_POST_SUBMIT = '[data-testid="tweetButton"]';

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
        const profileDir = resolveChannelProfileDir(TARGET, override);
        const session = await checkChannelSession(POST_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: true,
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

    /** Types the text and requires the Post control to enable (bounded three attempts). */
    private async typeAndEnable(page: Page, text: string): Promise<string | null> {
        const textBox = page.locator(POST_SELECTORS.text[0]).first();
        const submit = page.locator(X_POST_SUBMIT).first();
        for (let attempt = 1; attempt <= 3; attempt++) {
            // X can leave a `[data-testid="mask"]` layer over the composer (it opens the compose
            // surface as an overlay after an in-app navigation), which swallows pointer events. A
            // forced click, and focus as the fallback, reach the editor without dismissing it.
            await page.keyboard.press('Escape').catch(() => {});
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
                async () => ((await submit.isEnabled().catch(() => false)) ? 'post enabled' : null),
                { timeoutMs: 10_000, label: `x post enabled (attempt ${attempt})` },
            );
            if (enabled.ok) return null;
        }
        return 'x post submit never enabled — the editor did not accept the text in three attempts';
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
                async () =>
                    (await page
                        .locator(X_POST_SUBMIT)
                        .first()
                        .isEnabled()
                        .catch(() => false))
                        ? 'post re-enabled'
                        : null,
                { timeoutMs: 120_000, label: 'x post submit enabled after media' },
            );
            if (!reEnabled.ok) return fail(`x post submit stayed disabled after the media: ${reEnabled.error}`);
        }

        await page.locator(X_POST_SUBMIT).first().click();
        const receipt = await expectOutcome(
            async () => {
                const id = await this.newestStatusId(page, handle);
                if (id === null) return null;
                if (baselineId !== null && id === baselineId) return null;
                return `https://x.com${handle}/status/${id}`;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'x status receipt' },
        );
        if (!receipt.ok) {
            return fail(
                `x post receipt not confirmed — Post was clicked but no new status id appeared on the profile (${receipt.error}); an unobserved submit is never reported as published`,
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
