// transcript: 2026-11-22 headed verification against ~/.config/kk/browser-profiles/medium:
//   headless Chromium gets the Cloudflare interstitial (`Just a moment...`), the saved cookies are
//   fine, so the rail is headed-only and fails closed on a challenge; Medium no longer issues
//   integration tokens, which makes this browser rail the primary path.
//   Editor selectors provisional until `kk bot login medium`.
import { type Content, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    type PublishTransport,
    type PublishTransportPayload,
    trySelectors,
} from '@gobing-ai/publish-harness';
import {
    type ChannelBrowserConfig,
    checkChannelSession,
    ensureProfileDir,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    pasteHtml,
    resolveChannelProfileDir,
    resolveSelector,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type IsAuthenticatedPredicate,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import type { Page } from 'playwright';

export const CHANNEL = 'medium';
const TARGET = 'medium';
export const HOME_URL = 'https://medium.com/new-story';
export const LOGIN_URL_RE = /(\/m\/signin|\/signin|medium\.com\/m\/account)/i;
export const DRAFT_URL_RE = /\/p\/([a-f0-9]+)\/edit/i;
export const LIVE_URL_RE = /medium\.com\/@[^/]+\/[^/?#]+/i;

export const SELECTORS = {
    title: [
        'h3[data-testid="editorTitleParagraph"]',
        'h3.graf--title[contenteditable="true"]',
        '[data-default-value="Title"]',
        'h3.graf--title',
    ],
    body: [
        'p[data-testid="editorParagraphText"]',
        '.section-content p.graf--p',
        '[role="textbox"][contenteditable="true"]',
        '[contenteditable="true"]',
    ],
    publishTrigger: ['button[data-testid="publishButton"]', 'button:has-text("Publish")'],
    publishConfirm: ['button[data-testid="publishConfirmButton"]', 'button:has-text("Publish now")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_INSTRUCTION = 'kk bot login medium (or set MEDIUM_INTEGRATION_TOKEN)';

/** A Cloudflare anti-bot interstitial instead of the site (measured headed + headless, 2026-11-22). */
export const CHALLENGE_RE = /(Just a moment\.\.\.|Performing security verification|Attention Required! \| Cloudflare)/i;

/**
 * True when the page is a Cloudflare challenge rather than Medium. Never solved, waited out or
 * bypassed: the caller fails closed with `effect: 'none'` and hands the decision to the operator.
 */
export async function isChallengePage(page: Page): Promise<boolean> {
    try {
        return CHALLENGE_RE.test(await page.title());
    } catch {
        // A page that cannot report its title is not a detected challenge.
        return false;
    }
}

export const isAuthenticated: IsAuthenticatedPredicate = async (page) =>
    !LOGIN_URL_RE.test(page.url()) &&
    !(await isChallengePage(page)) &&
    (await trySelectors(page, SELECTORS.title, { visible: false })).found;

/**
 * A Cloudflare interstitial instead of the editor. Thrown out of the readiness predicate so the
 * refusal names the challenge and the operator action, rather than a generic auth timeout.
 */
export class ChallengeBlockedError extends Error {
    constructor() {
        super(
            `${CHANNEL} refused: Cloudflare security verification is blocking the ${TARGET} session — open \`kk bot login ${HOME_URL} --save ${CHANNEL}\` in a visible browser and complete the check by hand`,
        );
        this.name = 'ChallengeBlockedError';
    }
}

export function channelConfig(): ChannelBrowserConfig {
    return {
        channel: CHANNEL,
        homeUrl: HOME_URL,
        isAuthenticated,
        loginTimeoutMs: LOGIN_TIMEOUT_MS,
        // Headless load returns the Cloudflare interstitial on this profile (measured 2026-11-22),
        // so a headless preflight pass is a guaranteed burn that shortens the headed budget.
        checkHeadedOnly: true,
    };
}

function fail(error: string, effect: 'none' | 'unknown' = 'unknown'): Result {
    return ResultSchema.parse({
        ok: false,
        target: TARGET,
        error,
        ...(effect === 'none' ? { metadata: { itcDelivery: { schemaVersion: 1, effect: 'none' } } } : {}),
    });
}

function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

function resolveTitle(content: Content): string {
    if (content.title && content.title.trim().length > 0) return content.title.trim();
    const match = content.body.match(/^#\s+(.+)$/m);
    return match?.[1] ? match[1].trim() : 'Untitled Post';
}

async function probeDraft(page: Page): Promise<string | null> {
    const url = page.url();
    return DRAFT_URL_RE.test(url) ? url : null;
}

async function probeLive(page: Page): Promise<string | null> {
    const url = page.url();
    return LIVE_URL_RE.test(url) && !DRAFT_URL_RE.test(url) ? url : null;
}

/**
 * Browser fallback transport for Medium (`ts-browser-automation`, script driver).
 * Used when `MEDIUM_INTEGRATION_TOKEN` is unset. Defaults strictly to `draft` (ADR-022):
 * Medium autosaves `/new-story` to `/p/<id>/edit` without clicking Publish.
 */
export class MediumBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;

    constructor(driver: BrowserDriver = 'script', deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {}) {
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(`unsupported driver '${this.driver}' for ${TARGET}`, 'none');
        }
        const requested = payload.options?.publishStatus ?? payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(`unknown publishStatus '${String(requested)}' (expected absent, 'draft' or 'public')`, 'none');
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CHANNEL, override);

        // 0423 R4: refuse an absent profile BEFORE the headed preflight. A headed launch creates a
        // missing profile dir (`ensureProfileDir`) and holds its lease, so the preflight would
        // fabricate a session, pop a window on an unattended run, and leak the lease on failure.
        try {
            await ensureProfileDir(profileDir, true);
        } catch {
            return fail(
                `${CHANNEL} session preflight refused: no saved profile at ${profileDir} — run: ${LOGIN_INSTRUCTION}`,
                'none',
            );
        }

        const session = await checkChannelSession(channelConfig(), {
            profileDir,
            launcher: this.launcher,
            headedOnly: true,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${CHANNEL} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`, 'none');
        }

        const publishStatus = requested === 'public' ? 'public' : 'draft';
        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: HOME_URL,
                    isAuthenticated: async (page) => {
                        // Fail closed on a Cloudflare interstitial; never solve, wait it out or bypass it.
                        if (await isChallengePage(page)) throw new ChallengeBlockedError();
                        return isAuthenticated(page);
                    },
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runEditorFlow(page, payload.content, publishStatus, profileDir),
            );
        } catch (error) {
            if (error instanceof ChallengeBlockedError) return fail(error.message, 'none');
            const msg = error instanceof Error ? error.message : String(error);
            const hint = needsLogin(error) ? ` — run: ${LOGIN_INSTRUCTION}` : '';
            return fail(`${msg}${hint}`, needsLogin(error) ? 'none' : 'unknown');
        }
    }

    private async runEditorFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        profileDir: string,
    ): Promise<Result> {
        const metadata = { driver: this.driver, publishStatus, profileDir };

        const titleSelector = await resolveSelector(page, SELECTORS.title, {
            timeoutMs: this.stepTimeoutMs,
            label: 'title input',
        });
        const titleLocator = page.locator(titleSelector).first();
        await titleLocator.click();
        await titleLocator.fill(resolveTitle(content));

        const bodySelector = await resolveSelector(page, SELECTORS.body, {
            timeoutMs: this.stepTimeoutMs,
            label: 'body editor',
        });
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });

        const draft = await expectOutcome(() => probeDraft(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `medium draft signal in '${bodySelector}'`,
        });
        if (!draft.ok) return fail(draft.error);

        const id = DRAFT_URL_RE.exec(draft.evidence)?.[1];
        if (publishStatus === 'draft') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(id === undefined ? {} : { id }),
                url: draft.evidence,
                message: `${TARGET} draft saved (unpublished) in profile ${profileDir}`,
                metadata,
            });
        }

        const triggerSelector = await resolveSelector(page, SELECTORS.publishTrigger, {
            timeoutMs: this.stepTimeoutMs,
            label: 'publish button',
        });
        await page.locator(triggerSelector).first().click();

        const confirmSelector = await resolveSelector(page, SELECTORS.publishConfirm, {
            timeoutMs: this.stepTimeoutMs,
            label: 'publish confirm button',
        });
        await page.locator(confirmSelector).first().click();

        const live = await expectOutcome(() => probeLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `medium publish '${confirmSelector}'`,
        });
        if (!live.ok) return fail(live.error);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: live.evidence,
            message: `${TARGET} published live in profile ${profileDir}`,
            metadata,
        });
    }
}
