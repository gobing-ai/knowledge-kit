/**
 * Threads browser post rail — the `post` operation through a signed-in web session.
 *
 * WHY this exists (2026-11-16, operator decision): threads-pub shipped as the official two-step
 * Graph API only ("no browser path" in its own manifest), so publishing required
 * THREADS_ACCESS_TOKEN / THREADS_USER_ID. The operator wants the `kk bot` route for every social
 * channel, so this rail drives the web composer from the `threads` profile. The API transport stays
 * available behind `THREADS_POST_TRANSPORT=api`.
 *
 * Selector policy: Threads is a React app with no stable data-testids documented, so every control
 * is an ordered ladder that FAILS CLOSED — a composer or submit control that cannot be resolved is
 * a typed refusal, never a silent skip and never a retried click on an unknown node. The ladders
 * were measured once against the live composer; keep them ordered by how they were observed.
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

const TARGET = 'threads';
export const THREADS_HOME_URL = 'https://www.threads.com';
export const THREADS_LOGIN_INSTRUCTION = 'bun plugins/publishings/threads-pub/src/profile-check.ts login';

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_URL_RE = /(?:^|\.)threads\.(?:net|com)\/(?:login|accounts)|instagram\.com\/accounts\/login/;
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Threads composer controls, measured from an operator-driven session (2026-11-16, threads.com):
 * the nav `div[role="button"]` reading "New thread" opens a modal composer (it renders a Cancel
 * control), whose controls are also `div[role="button"]`s — "Attach media" then "Post" — with the
 * editor inside the dialog and the file input rendered only after "Attach media" is clicked.
 */
export const THREADS_POST_SELECTORS = {
    // Measured 2026-11-16: the nav "New thread" control is NOT visible on the web home; the real
    // entry is the INLINE composer, a contenteditable whose aria-label starts "Empty text field.
    // Type to compose a new thread". Typing there expands it and renders the Post control.
    /** The nav "New thread" control — visible only: the DOM also carries a hidden duplicate. */
    createEntry: ['div[role="button"]:text-is("New thread"):visible', 'a[href="/compose"]:visible'],
    text: [
        'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
        'div[aria-label^="Empty text field"]',
        'div[role="textbox"][contenteditable="true"]',
    ],
    // Threads renders the label as a CHILD div inside the role=button element, so `text-is` on the
    // button misses whenever the button carries more than the bare label (measured 2026-11-20: the
    // element with text "Post" was `DIV < DIV[role=button]`, and every selector below found nothing).
    // The `:has` shapes match either nesting; the direct forms stay for the plain surface.
    submit: [
        'div[role="button"]:has(> div:text-is("Post")):visible',
        'div[role="button"]:has(div:text-is("Post")):visible',
        'div[role="button"]:text-is("Post"):visible',
        'button:text-is("Post"):visible',
        'div[role="button"][aria-label="Post"]:visible',
    ],
    mediaButton: ['div[role="button"]:text-is("Attach media")', 'div[aria-label*="Attach media" i]'],
    fileInput: ['input[type="file"]'],
    mediaPreview: ['div[role="dialog"] img[src*="cdninstagram"], div[role="dialog"] img[src*="fbcdn"]'],
    profileLink: ['a[href^="/@"]'],
    /** The inline composer's placeholder — the pre-type readiness signal. */
    placeholder: 'div[aria-label^="Empty text field"]',
} as const;

/** Readiness: no login redirect and a create/compose control rendered. */
export const isThreadsAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (LOGIN_URL_RE.test(page.url())) return false;
    // Session readiness = the inline composer is rendered (the measured entry point).
    return (await trySelectors(page, THREADS_POST_SELECTORS.text, { visible: false })).found;
};

/** Session config shared by the publish preflight and the operator profile CLI. */
export const THREADS_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: THREADS_HOME_URL,
    isAuthenticated: isThreadsAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    checkHeadedOnly: true,
};

/** Opt-in failure evidence (`KK_THREADS_DEBUG_DIR`): a screenshot + state dump per step, off by default. */
async function evidence(page: Page, label: string): Promise<void> {
    const dir = process.env.KK_THREADS_DEBUG_DIR;
    if (dir === undefined || dir.trim() === '') return;
    try {
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(dir, { recursive: true });
        const safe = label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
        writeFileSync(
            `${dir}/${safe}.json`,
            JSON.stringify({
                url: page.url(),
                editables: await page
                    .locator('div[contenteditable="true"]')
                    .count()
                    .catch(() => -1),
                posts: await page
                    .locator('div[role="button"]:text-is("Post")')
                    .count()
                    .catch(() => -1),
            }),
            'utf8',
        );
        await page.screenshot({ path: `${dir}/${safe}.png` }).catch(() => {});
    } catch {
        // evidence is diagnostics only; a failure here must never change the publish outcome
    }
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error, effect: 'none' });
}

/** Validates a requested cover path: absolute, existing, image extension. */
async function resolveCover(
    raw: unknown,
    fs: FileSystem = createNodeFileSystem(),
): Promise<{ path: string } | { error: string } | undefined> {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.trim() === '') {
        return { error: `threads post cover must be a non-empty local path, got '${String(raw)}'` };
    }
    if (!isAbsolute(raw)) return { error: `threads post cover must be an absolute path, got '${raw}'` };
    if (!COVER_EXTS.has(extname(raw).toLowerCase())) {
        return { error: `threads post cover must be .png/.jpg/.jpeg/.webp, got '${extname(raw) || '(none)'}'` };
    }
    // The FileSystem seam is text-agnostic about existence, so a media path needs no read.
    if (!(await fs.exists(raw))) return { error: `threads post cover does not exist: ${raw}` };
    return { path: raw };
}

/** Browser transport for `post`. */
export class ThreadsPostBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';

    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;

    constructor(deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {}) {
        // The harness launcher honours KK_BROWSER_CHANNEL; Playwright's bundled chromium-1187 cannot
        // launch on this machine, so never fall back to withProfilePage's plain-chromium default.
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        const requested = payload.content.metadata?.publishStatus;
        if (requested === 'draft') {
            return fail(
                'threads post has no draft: the composer publishes immediately — plan this target dummy/off or launch it live',
            );
        }
        if (requested !== undefined && requested !== 'public') {
            return fail(`unknown publishStatus '${requested}' for threads post: expected 'public' or absent`);
        }
        const text = (payload.content.body ?? payload.content.title ?? '').trim();
        if (text === '') return fail('threads post requires non-empty Content.body or Content.title');
        const cover = await resolveCover(
            payload.content.metadata?.coverPath ?? payload.options?.coverPath ?? payload.content.metadata?.coverImage,
        );
        if (cover !== undefined && 'error' in cover) return fail(cover.error);
        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(THREADS_CONFIG.channel, override);
        const session = await checkChannelSession(THREADS_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: true,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${TARGET} session preflight refused: ${session.detail} — run: ${THREADS_LOGIN_INSTRUCTION}`);
        }
        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: THREADS_HOME_URL,
                    isAuthenticated: isThreadsAuthenticated,
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
            const message = error instanceof Error ? error.message : String(error);
            const hint = /login|sign in/i.test(message) ? ` — run: ${THREADS_LOGIN_INSTRUCTION}` : '';
            return fail(`${message}${hint}`);
        }
    }

    private async runPostFlow(
        page: Page,
        text: string,
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: 'post', driver: 'script', publishStatus: 'public', profileDir };
        await evidence(page, '01-landing');
        const handle = await page
            .locator(THREADS_POST_SELECTORS.profileLink[0])
            .first()
            .getAttribute('href')
            .catch(() => null);
        const baselineId = handle === null ? null : await this.newestPostId(page, handle).catch(() => null);
        if (handle === null) {
            return fail('threads post could not read the profile link, so the post id cannot be confirmed');
        }

        // The baseline above left us on the profile; the inline composer lives on the HOME timeline.
        // Compare the PATH, not a URL prefix: `/@handle` also starts with the home origin, so a
        // startsWith check left the rail composing on the profile page (measured 2026-11-16).
        if (new URL(page.url()).pathname !== '/') {
            await page.goto(THREADS_HOME_URL, { waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs });
        }
        // The operator's own path opens the composer from the nav control ("New thread"); the inline
        // box stays as a fallback because some builds render only that.
        const entry = await expectOutcome(
            async () => {
                const found = await trySelectors(page, THREADS_POST_SELECTORS.createEntry);
                return found.found ? (found.selector ?? THREADS_POST_SELECTORS.createEntry[0]) : null;
            },
            // One step, capped at 12s: the nav entry is opportunistic, so it must not outlast a step.
            { timeoutMs: Math.min(12_000, this.stepTimeoutMs), label: 'threads new-thread entry' },
        );
        if (entry.ok)
            await page
                .locator(entry.evidence)
                .first()
                .click({ force: true })
                .catch(() => {});
        // Inline composer on the home timeline (the measured entry — the nav "New thread" control is
        // not visible on the web build). It expands into the thread composer once it has text.
        await evidence(page, '02-home');
        const box = await expectOutcome(
            async () => {
                const found = await trySelectors(page, THREADS_POST_SELECTORS.text);
                return found.found ? (found.selector ?? THREADS_POST_SELECTORS.text[0]) : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'threads inline composer' },
        );
        if (!box.ok) return fail(`threads inline composer never attached: ${box.error}`);
        const editor = page.locator(box.evidence).first();
        // The composer is server-rendered before it is interactive: wait until it is visibly the
        // inline composer (placeholder "What's new?") and only then focus it.
        await expectOutcome(
            async () => {
                const visible = await editor.isVisible().catch(() => false);
                const label = await editor.getAttribute('aria-label').catch(() => null);
                return visible && label !== null ? 'composer visible' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'threads composer visible' },
        );
        await editor.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1_200);
        await evidence(page, '03-focused');
        await page.keyboard.type(text, { delay: 12 });
        await evidence(page, '04-typed');
        const readback = await expectOutcome(
            async () => {
                const value = String(
                    await editor
                        .evaluate(
                            // Playwright hands the element to this expression as its first
                            // parameter. The arrow IIFE that read `arguments[0]` had no `arguments`
                            // binding at all, so it threw into the `.catch('')` below and every
                            // typed post read as "not retained" (measured 2026-11-20: the composer
                            // screenshot showed the full text and Post enabled).
                            `(el) => (el.innerText || el.textContent || el.value || '')`,
                        )
                        .catch(() => ''),
                );
                return value.trim().length > 0 ? 'text retained' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'threads post readback' },
        );
        if (!readback.ok) {
            await evidence(page, '05-readback-failed');
            return fail(`threads post text was not retained: ${readback.error}`);
        }

        if (coverPath !== undefined) {
            const media = await trySelectors(page, THREADS_POST_SELECTORS.mediaButton);
            if (media.found) {
                await page
                    .locator(media.selector ?? THREADS_POST_SELECTORS.mediaButton[0])
                    .first()
                    .click({ force: true })
                    .catch(() => {});
                const input = await resolveSelector(page, THREADS_POST_SELECTORS.fileInput, {
                    timeoutMs: this.stepTimeoutMs,
                    label: 'threads post media input',
                });
                await uploadFile(page, input, coverPath, { timeoutMs: this.stepTimeoutMs });
                await expectOutcome(
                    async () =>
                        (await page.locator(THREADS_POST_SELECTORS.mediaPreview[0]).count()) > 0
                            ? 'media attached'
                            : null,
                    { timeoutMs: this.stepTimeoutMs, label: 'threads post media' },
                );
            }
        }

        const submit = await expectOutcome(
            async () => {
                const found = await trySelectors(page, THREADS_POST_SELECTORS.submit);
                return found.found ? (found.selector ?? THREADS_POST_SELECTORS.submit[0]) : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'threads post submit' },
        );
        if (!submit.ok) {
            // The composer's Post control is a styled div whose text Playwright's `:text-is` must
            // match exactly; a label tweak ("Post" → "Post\u00a0" / an icon-only button) leaves the
            // selector list matching nothing while the button is plainly on screen. Report the
            // dialog's actual clickable inventory instead of the timeout.
            await evidence(page, '06-submit-missing');
            const observable = page as unknown as { evaluate?: (script: string) => Promise<unknown> };
            const inventory = await (observable.evaluate === undefined
                ? Promise.resolve(null)
                : observable
                      .evaluate(`(() => {
                    // Search the WHOLE document, not one dialog: the composer may not be the first
                    // [role=dialog] in DOM order (which is why an earlier inventory listed the
                    // composer's chips but not its Post control), and Post may carry no role at all.
                    const hits = [...document.querySelectorAll('*')]
                        .filter((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Post')
                        .map((n) => {
                            const p = n.parentElement;
                            return n.tagName + (n.getAttribute('role') ? '[role=' + n.getAttribute('role') + ']' : '')
                                + (n.getAttribute('aria-label') ? '[aria=' + n.getAttribute('aria-label') + ']' : '')
                                + ' < ' + (p?.tagName ?? '') + (p?.getAttribute('role') ? '[role=' + p.getAttribute('role') + ']' : '')
                                + (p?.className ? '.' + String(p.className).split(/\\s+/).slice(0, 2).join('.') : '');
                        });
                    return hits.slice(0, 4).join(' | ') || 'no element whose text is exactly Post';
                })()`)
                      .catch(() => null));
            return fail(
                `threads post control never attached: ${submit.error}${inventory ? ` (dialog buttons: ${String(inventory)})` : ''}`,
            );
        }
        // The composer rides under a suggestions layer that intercepts pointer events
        // (`<div class="__fb-light-mode …"> intercepts pointer events`, measured 2026-11-20). A
        // forced click dispatches onto that layer and posts NOTHING — the profile stayed unchanged —
        // so dismiss the layer first and click for real. The force click remains as a fallback for a
        // surface that reports a transient overlay.
        const dismiss = await page
            .locator(
                'div[role="button"]:text-is("Dismiss suggestions"), div[role="button"]:has(> div:text-is("Dismiss suggestions"))',
            )
            .first()
            .click({ timeout: 3_000 })
            .then(() => true)
            .catch(() => false);
        if (dismiss) await page.waitForTimeout(500);
        await page
            .locator(submit.evidence)
            .first()
            .click({ timeout: this.stepTimeoutMs })
            .catch(async () => {
                await page.locator(submit.evidence).first().click({ force: true });
            });

        await page.waitForTimeout(2_500);
        await evidence(page, '07-post-clicked');
        const receipt = await expectOutcome(
            async () => {
                const id = await this.newestPostId(page, handle);
                if (id === null) return null;
                if (baselineId !== null && id === baselineId) return null;
                return `https://www.threads.com${handle}/post/${id}`;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'threads post receipt' },
        );
        if (!receipt.ok) {
            return fail(
                `threads post receipt not confirmed — Post was clicked but no new post id appeared on the profile (${receipt.error}); an unobserved submit is never reported as published`,
            );
        }
        const id = /\/post\/([0-9A-Za-z_-]+)/.exec(receipt.evidence)?.[1];
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: receipt.evidence,
            message: `threads post published and confirmed in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: 'profile-timeline' },
        });
    }

    /** Newest `/post/<id>` on the account's profile page (null when it carries none). */
    private async newestPostId(page: Page, handle: string): Promise<string | null> {
        const target = `https://www.threads.com${handle}`;
        if (!page.url().startsWith(target)) {
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs });
        } else {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs }).catch(() => {});
        }
        const link = page.locator('a[href*="/post/"]').first();
        if ((await link.count()) === 0) return null;
        const href = await link.getAttribute('href').catch(() => null);
        return href === null ? null : (/\/post\/([0-9A-Za-z_-]+)/.exec(href)?.[1] ?? null);
    }
}
