import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
    type BrowserLauncher,
    BrowserProfileBusyError,
    BrowserProfileMissingError,
    InvalidProfileDirError,
    type IsAuthenticatedPredicate,
    loginWithProfile,
    PlaywrightUnavailableError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import {
    assertSafeBotName,
    BOT_METADATA_FILE,
    BOT_SCHEMA_VERSION,
    BotError,
    type BotMetadata,
    normalizeBotDefaultUrl,
    normalizeSessionExpiry,
    normalizeSessionIdentity,
    readBotMetadata,
    resolveBotProfileDir,
} from './bot';
import { chmod, lstat, rename } from './bot-fs';

export { chmod, createExclusiveFile, mkdirExclusive, rmdir } from './bot-fs';

import { type BotTransaction, beginBotTransaction } from './bot-transaction';
import { resolveBrowserProfileDir, trySelectors } from './index';
import { ensureProfileDir } from './profile-dir';
import {
    acquireProfileLease,
    canonicalize,
    enterDelegatedLease,
    KK_BOT_LEASE_PATH,
    type ProfileLease,
    verifyLeaseHeld,
} from './profile-lease';

// Named-bot foundation (task 0276): metadata/validation and the shared per-profile lease are
// re-exported through the browser sub-path so the CLI gets one entry point.
export * from './bot';
export * from './bot-transaction';
export {
    type AntiDetectionOptions,
    type BrowserPendingFile,
    injectBrowserAntiDetection,
    queueBrowserFiles,
} from './browser-anti-detection';
export * from './profile-lease';
/** Upstream seam types re-exported so a channel plugin needs one import for its config and deps. */
export type { BrowserLauncher, IsAuthenticatedPredicate };

/**
 * Shared browser command library for the script-driven publish channels (E91, ADR-027).
 *
 * Exported as the `@gobing-ai/publish-harness/browser` sub-path so API-only plugins never load
 * this module (R5). Site selectors and flows stay in each channel plugin (E91-D3): these helpers
 * receive selectors, they never embed URLs.
 *
 * No `console.*` here — callers get thrown errors, and the CLI takes an injected `stdout`.
 * The module never reads cookie names/values or `storageState`; the profile directory is the login
 * artifact. The one exception is {@link captureSessionFacts}, which reads cookie *expiry* at login
 * to record an estimated session lifetime — names and values never leave it.
 */

/** Site-owned config for one channel's browser session. */
export interface ChannelBrowserConfig {
    /** Channel slug; `'infoq'` resolves `<INFOQ>_PROFILE_DIR`. */
    channel: string;
    /** Page opened for `login` / `check`. */
    homeUrl: string;
    /** Site-owned readiness predicate, re-exported upstream type. */
    isAuthenticated: IsAuthenticatedPredicate;
    /** Deadline for the interactive login wait (default 180_000). */
    loginTimeoutMs?: number;
    /** Check headed only — for channels whose WAF 451s every headless load (measured infoq 0201/0191). {@link runProfileCli} plumbs it to {@link checkChannelSession}. */
    checkHeadedOnly?: boolean;
    /**
     * Optional account label for `kk bot list`'s identity column (0305). Only bot-mode login calls
     * it, on the page the readiness predicate just accepted; `null` or a throw simply omits the
     * fact. No channel implements it yet.
     */
    readIdentity?: (page: Page) => Promise<string | null>;
}

/** Outcome of a channel session check: what was observed, or the refusal reason. */
export interface ChannelSessionResult {
    /** `verified` only when the site readiness predicate passed; otherwise `refused`. */
    status: 'verified' | 'refused';
    /** Profile directory the check read; the only profile detail that ever leaves this module. */
    profileDir: string;
    /** One-line verdict: what was observed (headless or headed) or why it was refused. */
    detail: string;
}

/**
 * Options for {@link checkChannelSession}: which profile to open, the launcher seam, and the
 * fallback/deadline knobs. A check never creates the profile.
 */
export interface ChannelSessionOptions {
    /** Existing profile directory to reopen read-only. */
    profileDir: string;
    /** Launcher override (tests / custom browser provisioning); default {@link kkBrowserLauncher}. */
    launcher?: BrowserLauncher;
    /** `false` keeps a refusal to the single headless pass (publish preflight). Default true. */
    headedFallback?: boolean;
    /** Skip the headless pass entirely and check headed only (WAF-451 channels); beats `headedFallback: false`. */
    headedOnly?: boolean;
    /** Deadline per pass (default 30_000). */
    timeoutMs?: number;
}

/**
 * Injectable seams for {@link runProfileCli}: the browser launcher and the line writer used
 * instead of the default ts-utils `echo` stdout target.
 */
export interface ProfileCliDeps {
    /** Launcher override (tests / custom browser provisioning); default {@link kkBrowserLauncher}. */
    launcher?: BrowserLauncher;
    /** Line-writer override; defaults to the ts-utils `echo` stdout seam. */
    stdout?: (line: string) => void;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
/** Bounded `open` navigation: a failed/slow goto must not wedge the operator's window forever. */
const DEFAULT_OPEN_NAV_TIMEOUT_MS = 30_000;
/**
 * A session check is a bounded read-only probe, not an interactive login: it uses the
 * `xhs-pub` preflight scale (30s per pass), never the login wait.
 */
const DEFAULT_CHECK_TIMEOUT_MS = 30_000;
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 500;
const ATTACH_POLL_MS = 100;

/**
 * kk's default {@link BrowserLauncher} (0214). Everywhere a channel opens a profile without an
 * injected launcher, it goes through this one rather than the ts-browser-automation default, for two reasons:
 *
 * - `channel` (`KK_BROWSER_CHANNEL`, default `chromium`): Playwright's default headless run uses a separate
 *   `chromium_headless_shell` binary whose cookie store cannot read what the headed full-Chromium
 *   login wrote, and reopening a profile across the two wipes it (repro 2026-10-07,
 *   `.spur/run/discovery/cookie-persist-repro2.ts`/`3.ts`). Full Chromium in new-headless mode
 *   shares one store. `chrome` drives installed Google Chrome.
 * - Stealth: Google OAuth refuses a browser flagged as automated ("This browser or app may not be
 *   secure"), so drop `--enable-automation` and the AutomationControlled blink feature, and hide
 *   `navigator.webdriver`.
 *
 * Profile semantics match upstream `createPersistentLauncher` (not exported): an existing dir is
 * adopted as-is, a headed launch creates a missing one owner-only (0o700), and a headless launch
 * never creates one.
 */
/**
 * Chromium's "the browser died during startup" shape: Playwright reports a closed target, never a
 * reason. Distinct from a busy profile, which names the singleton lock instead.
 */
function isInstantBrowserDeath(message: string): boolean {
    return /target page, context or browser has been closed|browser has been closed|target closed/i.test(message);
}

/**
 * Map a launch failure to the operator-facing error. Busy and not-installed get their own types so a
 * caller can act on them; anything else — including a profile Chromium keeps trapping on — is a
 * poisoned-profile error naming the directory, because the only remaining repair is to move it aside.
 */
function classifyLaunchError(error: unknown, profileDir: string, channel: string): Error {
    const message = errorMessage(error);
    if (/singleton|already in use|in use by another/i.test(message))
        return new BrowserProfileBusyError(profileDir, error);
    if (/playwright install|executable doesn't exist/i.test(message)) {
        return new PlaywrightUnavailableError(
            `Browser channel '${channel}' is not installed. Run \`bunx playwright install chromium\` (or install Google Chrome for KK_BROWSER_CHANNEL=chrome).`,
            { cause: error },
        );
    }
    if (isInstantBrowserDeath(message)) {
        return new PlaywrightUnavailableError(
            `browser profile ${profileDir} makes Chromium exit during startup (no diagnostic reported). Move it aside (\`mv ${profileDir} ${profileDir}.broken-<date>\`) and log in again; \`storage-state.json\` is the only state worth keeping.`,
            { cause: error },
        );
    }
    return error instanceof Error ? error : new Error(message);
}

/** Move `<profile>/Default/Sync Data` aside; `false` when it is absent so the caller stops retrying. */
function quarantineProfileSyncData(profileDir: string): boolean {
    const syncData = join(profileDir, 'Default', 'Sync Data');
    if (lstat(syncData) === null) return false;
    return rename(syncData, `${syncData}.broken-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`);
}

/** Ownership a caller already holds for the context it is about to open (design §Shared ownership). */
export interface KkLauncherOwnership {
    /** Logical-profile lease the parent already holds; the launcher borrows it instead of reacquiring. */
    lease: ProfileLease;
    /** Exact physical profile path this context opens (a bot's staging or final directory). */
    physicalProfileDir: string;
}

/** Lease seams for the launcher's own acquisition; production uses the defaults. */
export interface KkLauncherLeaseOptions {
    /** Lease root; default `~/.config/kk/browser-leases`. */
    leaseRoot?: string;
    /** Injected FileSystem for the lease records. */
    fileSystem?: FileSystem;
}

/** Who owns the profile for one launch: borrowed, delegated or self-acquired. */
interface LaunchOwnership {
    /** Release on a failed launch; a borrowed parent lease is never released here. */
    release(): Promise<void>;
    /** Wire the release to context closure. */
    attach(context: BrowserContext): void;
}

/**
 * Build the harness browser launcher. `loadPlaywright` defaults to a dynamic `import('playwright')`
 * so non-browser paths stay binary-free; `ownership` borrows/delegates an existing logical lease
 * (bot open/login reuse), otherwise the launcher self-acquires one per launch.
 */
export function createKkBrowserLauncher(
    loadPlaywright: () => Promise<typeof import('playwright')> = () => import('playwright'),
    ownership?: KkLauncherOwnership,
    leaseOptions: KkLauncherLeaseOptions = {},
): BrowserLauncher {
    return {
        async launch(request): Promise<BrowserContext> {
            if (request.profileDir.trim() === '') throw new InvalidProfileDirError();
            const profileDir = resolve(request.profileDir);
            const claim = await claimLaunchOwnership(profileDir, ownership, leaseOptions);
            let context: BrowserContext;
            try {
                context = await launchKkContext(loadPlaywright, profileDir, request.headless);
            } catch (error) {
                await claim.release();
                throw error;
            }
            claim.attach(context);
            return context;
        },
    };
}

/**
 * The one private launch implementation every ownership path shares (design §Shared ownership):
 * adopt or create the profile dir owner-only, load Playwright lazily, launch the full Chromium
 * channel with the stealth options, install the webdriver init script — and close the context
 * again if that last step fails, so a failed launch never leaves a browser holding the profile.
 */
async function launchKkContext(
    loadPlaywright: () => Promise<typeof import('playwright')>,
    profileDir: string,
    headless: boolean,
): Promise<BrowserContext> {
    await ensureProfileDir(profileDir, headless);
    let playwright: typeof import('playwright');
    try {
        playwright = await loadPlaywright();
    } catch (error) {
        throw new PlaywrightUnavailableError(
            'The "playwright" dependency is not installed. Run `bunx playwright install chromium`.',
            { cause: error },
        );
    }
    const channel = process.env.KK_BROWSER_CHANNEL?.trim() || 'chromium';
    const launch = () =>
        playwright.chromium.launchPersistentContext(profileDir, {
            headless,
            channel,
            args: ['--disable-blink-features=AutomationControlled'],
            ignoreDefaultArgs: ['--enable-automation'],
        });
    let context: BrowserContext;
    try {
        context = await launch();
    } catch (error) {
        if (!isInstantBrowserDeath(errorMessage(error))) throw classifyLaunchError(error, profileDir, channel);
        // Chromium can die inside startup on a profile it wrote itself and report nothing but a closed
        // browser (measured 2026-11-12: a corrupt `Default/Sync Data` LevelDB trapped it, and every
        // later login refused). Sync state is disposable here — auth lives in the cookies and the
        // channel's `storage-state.json` — so quarantine it and launch once more before giving up.
        if (!quarantineProfileSyncData(profileDir)) throw classifyLaunchError(error, profileDir, channel);
        try {
            context = await launch();
        } catch (retryError) {
            throw classifyLaunchError(retryError, profileDir, channel);
        }
    }
    try {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
    } catch (error) {
        await context.close().catch(() => {});
        throw error;
    }
    return context;
}

/**
 * Resolve the lease claim for one launch (design §Lease module). Borrowed ownership validates the
 * exact physical path and the still-live owner token and never releases the parent's lease; a
 * scoped delegation in the environment records a child holder; otherwise the launcher acquires and
 * owns the profile's lease. Every failure is a `busy` error rather than a second acquisition, and
 * inherited environment is honored only when it carries a matching owner record — never as a
 * blanket bypass.
 */
async function claimLaunchOwnership(
    profileDir: string,
    ownership: KkLauncherOwnership | undefined,
    leaseOptions: KkLauncherLeaseOptions,
): Promise<LaunchOwnership> {
    const fileSystem = leaseOptions.fileSystem ?? createNodeFileSystem();
    if (ownership !== undefined) {
        if (canonicalize(profileDir) !== canonicalize(ownership.physicalProfileDir)) {
            throw new BotError(
                'busy',
                `launcher ownership is bound to ${ownership.physicalProfileDir}, not ${profileDir} — refusing to launch`,
            );
        }
        await verifyLeaseHeld(ownership.lease, { fileSystem });
        // The parent releases after this context closes (design §Shared ownership).
        return { release: async () => {}, attach: () => {} };
    }
    const delegatedPath = process.env[KK_BOT_LEASE_PATH];
    if (delegatedPath !== undefined && delegatedPath !== '') {
        const child = await enterDelegatedLease(process.env, profileDir, { fileSystem });
        // The child drops only its own holder record; the parent keeps the lease either way.
        return {
            release: () => child.release(),
            attach: (context) => attachOwnershipClose(context, () => child.release()),
        };
    }
    const lease = await acquireProfileLease(profileDir, { leaseRoot: leaseOptions.leaseRoot, fileSystem });
    return {
        release: () => lease.release(),
        attach: (context) => attachOwnershipClose(context, () => lease.release()),
    };
}

/**
 * Release ownership when the context closes. A failed release is reported on stderr, never thrown:
 * this runs inside an event handler where a rejection would be unhandled, and a stale marker must
 * be visible because it refuses the next launch.
 */
function attachOwnershipClose(context: BrowserContext, release: () => Promise<void>): void {
    context.once('close', () => {
        void release().catch((error: unknown) => {
            echoError(`browser lease release failed: ${errorMessage(error)}`);
        });
    });
}

/** The production launcher. `launch` never reads `this`, so it may be passed detached (xhs `defaultLauncher`). */
export const kkBrowserLauncher: BrowserLauncher = createKkBrowserLauncher();

/**
 * Resolves the persistent profile directory for a channel.
 *
 * Precedence: `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `resolveBrowserProfileDir(channel)`. Blank strings count as unset, so an empty flag/env value
 * falls through instead of resolving to the cwd.
 */
export function resolveChannelProfileDir(channel: string, override?: string): string {
    const tiers = [override, process.env[`${channel.toUpperCase()}_PROFILE_DIR`], process.env.KK_BROWSER_PROFILE_DIR];
    const chosen = tiers.find((tier) => tier !== undefined && tier.trim().length > 0);
    return resolveBrowserProfileDir(channel, chosen);
}

/**
 * Read-only readiness check on the channel profile: one `homeUrl` visit plus selector reads, no
 * click and no content. The headless pass runs first; a refusal is retried once headed unless
 * `headedFallback` is `false` (ADR-025 shape — an unattended publish preflight must not pop a
 * window before the flow itself opens).
 *
 * A missing profile is refused immediately: upstream never creates a headless profile, so a
 * headed retry would fabricate a session out of a fresh directory.
 */
export async function checkChannelSession(
    config: ChannelBrowserConfig,
    opts: ChannelSessionOptions,
): Promise<ChannelSessionResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
    const passes: readonly boolean[] = opts.headedOnly
        ? [false]
        : opts.headedFallback === false
          ? [true]
          : [true, false];
    let lastDetail = `${config.channel} readiness was never probed`;

    for (const headless of passes) {
        try {
            await withProfilePage(
                {
                    profileDir: opts.profileDir,
                    headless,
                    url: config.homeUrl,
                    isAuthenticated: config.isAuthenticated,
                    timeoutMs,
                    launcher: opts.launcher ?? kkBrowserLauncher,
                },
                async () => true,
            );
            return {
                status: 'verified',
                profileDir: opts.profileDir,
                detail: `authenticated ${config.channel} session observed ${
                    headless ? 'headlessly' : 'via a headed pass'
                } via profile ${opts.profileDir} (read-only)`,
            };
        } catch (error) {
            if (error instanceof BrowserProfileMissingError) {
                return {
                    status: 'refused',
                    profileDir: opts.profileDir,
                    detail: `no ${config.channel} browser profile at ${opts.profileDir} — run the login command first`,
                };
            }
            lastDetail = `${headless ? 'headless' : 'headed'} ${config.channel} readiness refused: ${errorMessage(error)}`;
        }
    }

    return { status: 'refused', profileDir: opts.profileDir, detail: lastDetail };
}

/** Options for the `open` bot-session verb. */
export interface ChannelOpenRequest {
    /** Explicit existing profile directory (the bot's final or staged profile). */
    profileDir: string;
    /** URL to navigate; the session stays open until the operator closes the window. */
    url: string;
}

/**
 * Restore the profile headed, navigate `url`, and resolve once the operator closes the context.
 * No readiness predicate runs — open is operator-interactive by contract — and a missing profile
 * is refused instead of silently created (an unauthenticated fresh profile would fake a session).
 * A failed navigation is reported and the window stays up: the operator sees the error page.
 */
export async function openChannelSession(
    config: ChannelBrowserConfig,
    request: ChannelOpenRequest,
    deps: ProfileCliDeps = {},
    stdout: (line: string) => void = echo,
): Promise<number> {
    if (lstat(request.profileDir) === null) {
        stdout(
            `${config.channel} profile open failed: no profile at ${request.profileDir} — run the login command first`,
        );
        return 1;
    }
    let context: BrowserContext;
    try {
        context = await (deps.launcher ?? kkBrowserLauncher).launch({
            profileDir: request.profileDir,
            headless: false,
        });
    } catch (error) {
        stdout(`${config.channel} profile open failed: ${errorMessage(error)}`);
        return 1;
    }
    const page = context.pages()[0] ?? (await context.newPage());
    try {
        await page.goto(request.url, { waitUntil: 'commit', timeout: DEFAULT_OPEN_NAV_TIMEOUT_MS });
    } catch (error) {
        stdout(`${config.channel} profile open navigation failed: ${errorMessage(error)}`);
    }
    await new Promise<void>((resolveClose) => {
        context.once('close', () => resolveClose());
    });
    stdout(`${config.channel} profile open closed: ${request.profileDir}`);
    return 0;
}

/**
 * `login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]` for one channel.
 * `--headed` (0216) checks headed only, skipping the headless pass.
 *
 * `login` opens the headed browser and returns only once the site readiness predicate passes;
 * `check` runs {@link checkChannelSession}. `open` (0277) is the bot session verb: it restores the
 * profile headed, navigates `--url`, and stays until the operator closes the window — it never
 * asserts authentication and it never creates a fresh profile. `--url` on `login` (0277) replaces
 * the configured home page as the navigation target while the config predicate stays the evidence;
 * a login invoked WITH `--url` (bot mode) runs through `withProfilePage` and appends a
 * `{status, profileDir, defaultUrl, expiresAt?, identity?}` JSON verdict as the LAST stdout line so
 * the bot parent can persist the plugin-owned canonical URL and the session facts (0305): the
 * estimated cookie expiry and, when the channel implements `readIdentity`, the account label. A
 * `readIdentity` throw or `null` simply omits `identity`. Exit codes:
 * 0 verified/closed, 1 refused, 2 usage error. Output goes through the injected `stdout` (one line
 * per message), so the CLI is testable and this module holds no `console.*`; the default writer is
 * the ts-utils `echo` seam.
 */
export async function runProfileCli(
    config: ChannelBrowserConfig,
    argv: string[] = process.argv.slice(2),
    deps: ProfileCliDeps = {},
): Promise<number> {
    const stdout =
        deps.stdout ??
        ((line: string) => {
            echo(line);
        });
    const usage =
        `usage: ${config.channel} profile-check [login|check|open] ` +
        '[--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]';

    let command: string;
    let profileDir: string;
    let timeoutMs: number | undefined;
    let headed = false;
    let url: string | undefined;
    try {
        const { positionals, values } = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                profile: { type: 'string' },
                timeout: { type: 'string' },
                headed: { type: 'boolean' },
                url: { type: 'string' },
            },
        });
        command = positionals[0] ?? 'check';
        headed = values.headed === true;
        url = values.url;
        if (command !== 'login' && command !== 'check' && command !== 'open') {
            throw new Error(`unknown command '${command}'`);
        }
        if (command === 'open' && (values.profile === undefined || url === undefined)) {
            throw new Error('open requires an explicit --profile <dir> and --url <url>');
        }
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        profileDir = resolveChannelProfileDir(config.channel, values.profile);
    } catch (error) {
        stdout(`${config.channel} profile-check: ${errorMessage(error)} — ${usage}`);
        stdout(JSON.stringify({ status: 'error', detail: errorMessage(error) }));
        return 2;
    }

    if (command === 'open') {
        return openChannelSession(config, { profileDir, url: url ?? '' }, deps, stdout);
    }

    if (command === 'login') {
        const loginTimeoutMs = timeoutMs ?? config.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
        const launcher = deps.launcher ?? kkBrowserLauncher;
        // Say what is happening before blocking: a silent 3-minute wait reads as a hang and gets
        // Ctrl-C'd (measured 2026-11-12), and an interrupted login leaves a lock behind.
        stdout(
            `${config.channel} profile login: a browser window is opening — sign in there; waiting up to ${Math.round(
                loginTimeoutMs / 1000,
            )}s for the signed-in state`,
        );
        try {
            // Bot mode (--url given by the `kk bot` parent) needs the context after the readiness
            // predicate passes: `withProfilePage` is the same package's scoped opener, one headed
            // launch, callback before the guaranteed close — `loginWithProfile` returns void and
            // closes internally, so the parent would never see the cookie jar.
            if (url === undefined) {
                await loginWithProfile({
                    profileDir,
                    url: config.homeUrl,
                    isAuthenticated: config.isAuthenticated,
                    timeoutMs: loginTimeoutMs,
                    launcher,
                });
                stdout(`${config.channel} profile login verified: ${profileDir}`);
                return 0;
            }
            const facts = await withProfilePage(
                {
                    profileDir,
                    headless: false,
                    url,
                    isAuthenticated: config.isAuthenticated,
                    timeoutMs: loginTimeoutMs,
                    launcher,
                },
                async ({ context, page }) => ({
                    ...(await captureSessionFacts(context, config.homeUrl)),
                    ...(config.readIdentity === undefined
                        ? {}
                        : { identity: await readIdentityOrUndefined(config.readIdentity, page) }),
                }),
            );
            stdout(`${config.channel} profile login verified: ${profileDir}`);
            // The canonical, plugin-owned default URL is the configured home page — never the
            // supplied URL, whose query must not persist. The optional facts are the parent's only
            // source for a bot's expiry and identity; invalid values are dropped by its parser.
            stdout(
                JSON.stringify({
                    status: 'verified',
                    profileDir,
                    defaultUrl: config.homeUrl,
                    ...(facts.expiresAt === undefined ? {} : { expiresAt: facts.expiresAt }),
                    ...(facts.identity === undefined ? {} : { identity: facts.identity }),
                }),
            );
            return 0;
        } catch (error) {
            stdout(`${config.channel} profile login failed: ${errorMessage(error)}`);
            return 1;
        }
    }

    // `--headed` (0216) skips the headless pass entirely — the same shape as a `checkHeadedOnly`
    // config — so WAF-451 operators can force the headed probe per invocation. The JSON verdict is
    // deliberately the LAST line on stdout: `kk plugin check` parses it, so no human hint may follow.
    const result = await checkChannelSession(config, {
        profileDir,
        launcher: deps.launcher,
        headedOnly: headed || config.checkHeadedOnly === true,
        timeoutMs,
    });
    stdout(JSON.stringify(result));
    return result.status === 'verified' ? 0 : 1;
}

/**
 * Poll `predicate` every `pollMs` until the deadline, then evaluate it one final time.
 * The trailing call matters: the condition often becomes true exactly at the boundary.
 */
export async function waitUntil(
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    pollMs = DEFAULT_POLL_MS,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return predicate();
}

/**
 * Inserts `html` into a rich-text editor the way a human paste does: a synthetic `paste`
 * `ClipboardEvent` carrying both `text/html` and `text/plain`. ProseMirror, TipTap and Draft.js
 * all read the event's `clipboardData`; assigning `innerHTML` bypasses their state.
 *
 * Throws when the selector never attaches or the editor text is still empty at the deadline.
 */
export async function pasteHtml(
    page: Page,
    selector: string,
    html: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'pasteHtml', timeoutMs);
    await page.evaluate(pasteScript(selector, html));
    const filled = await waitUntil(
        async () => String(await page.evaluate(editorTextScript(selector))).length > 0,
        timeoutMs,
        ATTACH_POLL_MS,
    );
    if (!filled) {
        throw new Error(`pasteHtml: ${selector}: editor text is empty ${timeoutMs}ms after the paste`);
    }
}

/**
 * Fills a markdown editor: CodeMirror 6 (`view.dispatch`) → CodeMirror 5 (`CodeMirror.setValue`)
 * → `keyboard.insertText` fallback for editors exposing neither API (bytemd and friends), then
 * asserts the editor text is non-empty.
 */
export async function fillCodeMirror(
    page: Page,
    selector: string,
    markdown: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'fillCodeMirror', timeoutMs);

    const mode = String(await page.evaluate(codeMirrorScript(selector, markdown)));
    if (mode === 'missing') {
        throw new Error(`fillCodeMirror: ${selector} not attached within ${timeoutMs}ms`);
    }
    if (mode === 'keyboard') {
        await page.keyboard.insertText(markdown);
    }
    // Post-condition, as in `pasteHtml`: neither CodeMirror API reports back, and the keyboard
    // fallback is a silent no-op when the focus was stolen — so an empty editor is a failed fill
    // rather than a saved draft with no article in it (0183 residual 8e326537).
    const filled = await waitUntil(
        async () => String(await page.evaluate(editorTextScript(selector))).length > 0,
        timeoutMs,
        ATTACH_POLL_MS,
    );
    if (!filled) {
        throw new Error(`fillCodeMirror: ${selector}: editor text is empty ${timeoutMs}ms after the fill`);
    }
}

/**
 * Sets the file on an attached `<input type="file">`. Visibility is not required — Playwright's
 * `setInputFiles` is CDP-backed, and cover/image inputs are routinely hidden behind a styled label.
 */
export async function uploadFile(
    page: Page,
    selector: string,
    filePath: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'uploadFile', timeoutMs);
    await page.setInputFiles(selector, filePath);
}

/**
 * Success only from an observed browser signal (E91-D6): polls `probe` for evidence — a draft id,
 * URL, or toast text — and never reports success the browser did not show.
 */
export async function expectOutcome(
    probe: () => Promise<string | null>,
    opts: { timeoutMs: number; label: string; pollMs?: number },
): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
    let evidence = '';
    let lastProbeError: string | null = null;
    const observed = await waitUntil(
        async () => {
            let result: string | null;
            try {
                result = await probe();
            } catch (error) {
                // A probe that rejects (a `page.evaluate` whose document is replaced by a
                // navigation) is "no signal *yet*", not a broken rail: keep polling and report the
                // last rejection if the deadline passes. Letting it escape turned the
                // never-report-unseen-success rail into an unhandled rejection (residual 0190).
                lastProbeError = error instanceof Error ? error.message : String(error);
                return false;
            }
            // An empty string is a probe that fired without a signal (no id, URL, or toast text):
            // treating it as success would report an outcome the browser never showed (E91-D6).
            if (result === null || result.length === 0) {
                return false;
            }
            evidence = result;
            return true;
        },
        opts.timeoutMs,
        opts.pollMs ?? DEFAULT_POLL_MS,
    );
    if (observed && evidence.length > 0) {
        return { ok: true, evidence };
    }
    const detail = lastProbeError === null ? '' : ` (last probe error: ${lastProbeError})`;
    return { ok: false, error: `${opts.label}: no outcome observed within ${opts.timeoutMs}ms${detail}` };
}

/**
 * Containers that carry a transient site signal (toast / notice). Article content is never inside
 * them, which is the whole point: see {@link readScopedSignal}.
 */
export const DEFAULT_SIGNAL_CONTAINERS: readonly string[] = [
    '[class*="toast" i]',
    '[class*="notification" i]',
    '[role="alert"]',
    '[class*="message" i]',
];

/**
 * Reads a transient site signal (a toast/notice carrying one of `texts`) scoped to the page's
 * notification containers.
 *
 * Scoping is load-bearing (residuals 0195/0196): an unscoped `:text(...)` match also hits the
 * article body the flow itself pasted a few steps earlier, so a body containing `保存成功`
 * satisfied the draft probe and reported a success the browser never showed — the operator then
 * sees a saved draft that does not exist. Only the containers are searched, and the label must be
 * reachable through one of them.
 */
export async function readScopedSignal(
    page: Page,
    texts: readonly string[],
    containers: readonly string[] = DEFAULT_SIGNAL_CONTAINERS,
): Promise<string | null> {
    for (const text of texts) {
        for (const container of containers) {
            const locator = page.locator(`${container} :text("${text}")`).first();
            if ((await locator.count().catch(() => 0)) === 0) continue;
            if (!(await locator.isVisible().catch(() => false))) continue;
            const observed = (await locator.textContent().catch(() => null))?.trim();
            return observed !== undefined && observed.length > 0 ? observed : text;
        }
    }
    return null;
}

/** Minimal CDP session surface the closed-shadow probe needs (Playwright's `CDPSession` satisfies it). */
export interface ShadowCdpSession {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** A control resolved inside a closed shadow root, in viewport coordinates. */
export interface ShadowControl {
    label: string;
    x: number;
    y: number;
}

interface CdpNode {
    nodeName?: string;
    nodeValue?: string;
    backendNodeId?: number;
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
}

const cdpNodeText = (node: CdpNode): string =>
    node.nodeName === '#text' ? (node.nodeValue ?? '') : (node.children ?? []).map(cdpNodeText).join('');

/**
 * Resolves a labelled control that lives inside a **closed** shadow root, returning its viewport
 * centre so the caller can click it with a real mouse event.
 *
 * `DOM.getDocument({ pierce: true })` is the only way in: a closed root reports
 * `shadowRoot === null`, so no CSS or `:text(...)` selector can reach the node — measured live on
 * the xhs console, whose `<XHS-PUBLISH-BTN>` save bar states its label in neither (ADR-029 rail).
 * Labels match after whitespace is stripped, because the rendered text carries layout whitespace.
 *
 * **Only shadow trees are matched.** A light-DOM control is a normal locator's job, and matching
 * one here would let a channel resolve a mirrored label (sites duplicate their own chrome) instead
 * of the real control — so the helper returns `null` rather than guessing. Light DOM is still
 * *traversed*, because a closed root hangs off a light-DOM host element.
 */
export async function findShadowControl(
    session: ShadowCdpSession,
    labels: readonly string[],
): Promise<ShadowControl | null> {
    const document = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as {
        root?: CdpNode;
    };
    if (!document.root) return null;
    const wanted = new Set(labels);
    const findNode = (node: CdpNode, insideShadow: boolean): { label: string; backendNodeId: number } | null => {
        if (insideShadow && node.nodeName === 'BUTTON' && typeof node.backendNodeId === 'number') {
            const label = cdpNodeText(node).replace(/\s+/g, '');
            if (wanted.has(label)) return { label, backendNodeId: node.backendNodeId };
        }
        for (const shadowRoot of node.shadowRoots ?? []) {
            const hit = findNode(shadowRoot, true);
            if (hit) return hit;
        }
        for (const child of node.children ?? []) {
            const hit = findNode(child, insideShadow);
            if (hit) return hit;
        }
        return null;
    };
    const hit = findNode(document.root, false);
    if (hit === null) return null;

    const box = (await session.send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId })) as {
        model?: { content?: number[] };
    };
    const quad = box.model?.content;
    if (quad === undefined || quad.length < 8) return null;
    // Quad layout is [x1,y1, x2,y2, x3,y3, x4,y4]; the centre is ((x1+x3)/2, (y1+y4)/2).
    const [x1 = 0, y1 = 0, x3 = 0, , , y4 = 0] = quad;
    return { label: hit.label, x: Math.round((x1 + x3) / 2), y: Math.round((y1 + y4) / 2) };
}

/**
 * Opens a CDP session and returns a finder bound to it, or `undefined` when the platform exposes
 * no CDP (Safari/iOS). Callers fail loud on `undefined` rather than falling back to guessed
 * coordinates: a wrong click on a publish bar is worse than a reported missing capability.
 */
export async function createShadowFinder(
    context: { newCDPSession?(page: unknown): Promise<ShadowCdpSession> },
    page: unknown,
): Promise<((labels: readonly string[]) => Promise<ShadowControl | null>) | undefined> {
    if (typeof context.newCDPSession !== 'function') return undefined;
    try {
        const session = await context.newCDPSession(page);
        await session.send('DOM.enable');
        return (labels) => findShadowControl(session, labels);
    } catch {
        return undefined;
    }
}

/** Markdown → HTML through the Bun built-in (E91-D4); GFM tables, fenced code and task lists. */
export const markdownToHtml: (markdown: string) => string = (markdown) => Bun.markdown.html(markdown);

/** Polls until the selector has at least one attached match, then throws naming it and the deadline. */
async function requireAttached(page: Page, selector: string, action: string, timeoutMs: number): Promise<void> {
    await resolveSelector(page, [selector], { timeoutMs, label: action });
}

/**
 * Resolves the first attached candidate selector, polling to the deadline.
 *
 * Attachment — not visibility — is the readiness signal, the same rule `requireAttached` applies;
 * Playwright's own actionability wait covers visibility at the click or fill that follows. The
 * candidate list stays site-owned in the calling plugin (E91-D3): this helper receives selectors
 * and never embeds a URL.
 *
 * Throws naming `label` (default `selector`), every candidate it tried, and the deadline.
 */
export async function resolveSelector(
    page: Page,
    selectors: readonly string[],
    opts: { timeoutMs?: number; label?: string } = {},
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const found: { selector: string | null } = { selector: null };
    const attached = await waitUntil(
        async () => {
            const result = await trySelectors(page, selectors, { visible: false });
            found.selector = result.selector;
            return result.found && result.selector !== null;
        },
        timeoutMs,
        ATTACH_POLL_MS,
    );
    const selector = found.selector;
    if (!attached || selector === null) {
        throw new Error(`${opts.label ?? 'selector'}: ${selectors.join(' | ')} not attached within ${timeoutMs}ms`);
    }
    return selector;
}

/**
 * `kk bot` session lifecycle (task 0276, design §Bot command contract): the generic
 * operator-confirmed login and the reopen-until-close path. These live beside the launcher
 * because they are the browser-dependent half of the lifecycle — `./bot` stays importable with no
 * browser module at all, so `kk bot list`/`--help` work without installed browser binaries.
 */

/**
 * Estimated session lifetime from the just-authenticated context (0305 R2): the earliest positive
 * `expires` among httpOnly cookies `context.cookies(url)` returns, as an RFC 3339 UTC string.
 * Session cookies (`expires === -1`) and non-httpOnly cookies are ignored — httpOnly is the
 * cheapest discriminator between auth and analytics cookies. Cookie names and values never leave
 * this helper, and an unreadable cookie jar yields no fact rather than failing a finished login.
 */
export async function captureSessionFacts(context: BrowserContext, url: string): Promise<{ expiresAt?: string }> {
    let cookies: Awaited<ReturnType<BrowserContext['cookies']>>;
    try {
        cookies = await context.cookies(url);
    } catch {
        return {};
    }
    let earliest: number | undefined;
    for (const cookie of cookies) {
        if (!cookie.httpOnly || cookie.expires <= 0) continue;
        if (earliest === undefined || cookie.expires < earliest) earliest = cookie.expires;
    }
    return earliest === undefined ? {} : { expiresAt: new Date(earliest * 1000).toISOString() };
}

/** Adapter identity at login: `null`, a throw or a scrubbed-empty label omits the fact, never fails. */
async function readIdentityOrUndefined(
    readIdentity: NonNullable<ChannelBrowserConfig['readIdentity']>,
    page: Page,
): Promise<string | undefined> {
    try {
        return normalizeSessionIdentity(await readIdentity(page));
    } catch {
        return undefined;
    }
}

/** Confirmation deadline for a generic login (design §Bot command contract: 180000 ms). */
export const DEFAULT_BOT_LOGIN_TIMEOUT_MS = 180_000;

/** One known-plugin session run the adapter seam must perform (0277 R3). */
export interface BotAdapterRunRequest {
    /** `login` runs the plugin's site login transaction; `open` restores and navigates only. */
    mode: 'login' | 'open';
    /** Profile directory the plugin child drives (the transaction stage dir on login). */
    profileDir: string;
    /** Session URL: the supplied login URL, or the saved/declared canonical default. */
    url: string;
    /** Scoped lease env (`KK_BOT_LEASE_PATH`/`KK_BOT_LEASE_TOKEN`) the child inherits. */
    env: Record<string, string>;
}

/**
 * Caller-provided spawn seam for known-plugin bot sessions (0277 R2/R3): the harness owns
 * transactions, leases and metadata; the CLI owns the child process, so this module never
 * imports site code and the CLI never reimplements the transaction contract.
 */
export interface BotAdapterSession {
    /** Plugin (adapter) that owns the site-specific login/open routines. */
    pluginName: string;
    /** Spawn the plugin's profile-check child; resolve its exit code and piped stdout. */
    run(request: BotAdapterRunRequest): Promise<{ exitCode: number; stdout: string }>;
}

/** Options shared by {@link loginBot} and {@link openBot}; every field defaults to production. */
export interface BotSessionOptions {
    /** Profile root; default `~/.config/kk/browser-profiles`. */
    root?: string;
    /** Transaction root; default `~/.config/kk/browser-transactions`. */
    transactionRoot?: string;
    /** Lease root; default `~/.config/kk/browser-leases`. */
    leaseRoot?: string;
    /** Injected FileSystem for metadata and lease IO. */
    fileSystem?: FileSystem;
    /** Launcher override; the default borrows this invocation's profile lease. */
    launcher?: BrowserLauncher;
    /** Confirmation seam; the default reads an affirmative answer from the TTY. */
    confirm?: (timeoutMs: number) => Promise<boolean>;
    /** Confirmation deadline in ms; default {@link DEFAULT_BOT_LOGIN_TIMEOUT_MS}. */
    timeoutMs?: number;
    /** Adapter that saved this bot (0277); omitted for a generic operator-confirmed session. */
    pluginName?: string;
    /** Known-plugin adapter seam (0277); when set, login/open spawn the plugin's session child. */
    adapter?: BotAdapterSession;
}

/** Outcome of a successful {@link loginBot}. */
export interface LoginBotResult {
    name: string;
    /** Persisted origin+pathname; query and fragment are never saved. */
    defaultUrl: string;
    /** Operator line: what was saved locally. */
    message: string;
}

/** Options for {@link openBot}. */
export interface OpenBotOptions extends BotSessionOptions {
    /** Reauthenticate through the same login transaction before reopening the saved page. */
    login?: boolean;
    /** URL to open when the profile carries no metadata (0277 legacy fixed-profile route). */
    defaultUrl?: string;
}

/** Outcome of a {@link openBot} session that ran until the context closed. */
export interface OpenBotResult {
    name: string;
    /** Saved origin+pathname the session reopened. */
    defaultUrl: string;
    /** Operator line: what happened to the reopened page. */
    message: string;
}

/**
 * Generic headed login for bot `name` (task 0276, design §Bot command contract). The profile is
 * staged in an owned transaction while this invocation holds the bot's logical lease, the supplied
 * URL is opened headed, and the session is saved only after an explicit affirmative confirmation.
 * The supplied URL is navigation input only: it is never logged, and the persisted `defaultUrl` is
 * always origin+pathname (query/fragment can carry grants). Cancellation, an unconfirmable
 * terminal, a timeout and a failed promotion all save nothing and leave any previous profile
 * untouched (design §Transactions).
 */
export async function loginBot(name: string, url: string, options: BotSessionOptions = {}): Promise<LoginBotResult> {
    assertSafeBotName(name);
    const defaultUrl = normalizeBotDefaultUrl(url);
    const navigationUrl = url.trim();
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    let transaction: BotTransaction | undefined;
    let context: BrowserContext | undefined;
    let promoting = false;
    try {
        transaction = await beginBotTransaction({
            name,
            profileDir,
            transactionRoot: options.transactionRoot,
            fileSystem,
        });
        await transaction.copyExistingProfile();
        if (options.adapter !== undefined) {
            return await runAdapterLogin(name, navigationUrl, {
                adapter: options.adapter,
                transaction,
                lease,
                fileSystem,
            });
        }
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: transaction.stageDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir: transaction.stageDir, headless: false });
        const page = await openBotPage(context);
        await navigateBot(page, navigationUrl);
        await focusBotPage(page);
        const confirm = options.confirm ?? confirmBotLogin;
        if (!(await confirm(options.timeoutMs ?? DEFAULT_BOT_LOGIN_TIMEOUT_MS))) {
            throw new BotError(
                'unconfirmed',
                `login for bot '${name}' was not confirmed — nothing was saved and the previous profile is unchanged`,
            );
        }
        // Facts come from the confirmed context, never from a refused/cancelled login.
        const { expiresAt } = await captureSessionFacts(context, defaultUrl);
        await writeBotMetadata(fileSystem, join(transaction.stageDir, BOT_METADATA_FILE), {
            schemaVersion: BOT_SCHEMA_VERSION,
            defaultUrl,
            authenticationEvidence: 'operator-confirmed',
            ...(options.pluginName === undefined ? {} : { pluginName: options.pluginName }),
            lastLoginAt: new Date().toISOString(),
            ...(expiresAt === undefined ? {} : { expiresAt }),
        });
        // Ordering (design §Transactions): close/flush the staged profile, then promote atomically.
        promoting = true;
        await transaction.commit(async () => {
            await closeBotContext(context);
        });
        context = undefined;
        return {
            name,
            defaultUrl,
            message: `saved an operator-confirmed local session for bot '${name}' at ${defaultUrl}`,
        };
    } catch (error) {
        await closeBotContext(context);
        if (!promoting && transaction !== undefined) {
            // Abort removes only this invocation's staging; a failed promotion owns its own evidence.
            await transaction.abort().catch(() => {});
        }
        throw error;
    } finally {
        await lease.release();
    }
}

/**
 * Known-plugin login (0277 R3): the plugin child runs the site login inside the transaction's
 * staged profile under the delegated lease. A child exit 0 means its readiness predicate passed,
 * special state was persisted and the child closed its own context — so the parent promotes
 * without a confirmation prompt and records `site-verified` evidence with the plugin-owned
 * canonical `defaultUrl` from the child's verdict line. Child usage failures map to
 * `BotError('usage')` (CLI exit 2); every other nonzero outcome is operational (exit 1).
 */
async function runAdapterLogin(
    name: string,
    url: string,
    ctx: {
        adapter: BotAdapterSession;
        transaction: BotTransaction;
        lease: ProfileLease;
        fileSystem: FileSystem;
    },
): Promise<LoginBotResult> {
    const { adapter, transaction, lease, fileSystem } = ctx;
    const child = await adapter.run({
        mode: 'login',
        profileDir: transaction.stageDir,
        url,
        env: await lease.delegatedEnv(transaction.stageDir),
    });
    if (child.exitCode === 2) {
        throw new BotError(
            'usage',
            `session adapter '${adapter.pluginName}' reported a usage error (exit 2) — nothing was saved`,
        );
    }
    if (child.exitCode !== 0) {
        throw new BotError(
            'browser',
            `session adapter '${adapter.pluginName}' login failed: child exit ${child.exitCode} — nothing was saved`,
        );
    }
    const verdict = parseAdapterVerdict(child.stdout);
    if (verdict === null) {
        throw new BotError(
            'browser',
            `session adapter '${adapter.pluginName}' exited 0 but returned no usable defaultUrl verdict — nothing was saved`,
        );
    }
    const defaultUrl = verdict.defaultUrl;
    await writeBotMetadata(fileSystem, join(transaction.stageDir, BOT_METADATA_FILE), {
        schemaVersion: BOT_SCHEMA_VERSION,
        defaultUrl,
        authenticationEvidence: 'site-verified',
        pluginName: adapter.pluginName,
        lastLoginAt: new Date().toISOString(),
        // An invalid verdict value is dropped at parse time, never stored and never fatal.
        ...(verdict.expiresAt === undefined ? {} : { expiresAt: verdict.expiresAt }),
        ...(verdict.identity === undefined ? {} : { identity: verdict.identity }),
    });
    // The child closed its staged context before exiting 0 (protocol contract); nothing to flush.
    await transaction.commit(async () => {});
    return {
        name,
        defaultUrl,
        message: `saved a site-verified local session for bot '${name}' via ${adapter.pluginName} at ${defaultUrl}`,
    };
}

/** Parsed bot-mode login verdict (design §Login-time session facts, frozen names). */
interface AdapterVerdict {
    defaultUrl: string;
    expiresAt?: string;
    identity?: string;
}

/**
 * Parse the bot-mode login verdict: the LAST non-empty stdout line must be JSON naming the
 * plugin-owned canonical default URL, plus optionally the session facts (0305). http(s) and
 * credential-free are enforced here; the query is kept because it is plugin-fixed code, not
 * operator input (fragments are dropped). `expiresAt`/`identity` are sanitized and dropped when
 * unusable — a bad fact never fails a verified login. Existing verdicts without them still parse.
 */
function parseAdapterVerdict(stdout: string): AdapterVerdict | null {
    const last = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .at(-1);
    if (last === undefined) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(last);
    } catch {
        return null;
    }
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
    if (record?.status !== 'verified' || typeof record.defaultUrl !== 'string') return null;
    let url: URL;
    try {
        url = new URL(record.defaultUrl);
    } catch {
        return null;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') {
        return null;
    }
    const expiresAt = normalizeSessionExpiry(record.expiresAt);
    const identity = normalizeSessionIdentity(record.identity);
    return {
        defaultUrl: `${url.origin}${url.pathname}${url.search}`,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        ...(identity === undefined ? {} : { identity }),
    };
}

/**
 * Open bot `name`'s saved page headed and stay until the context closes (task 0276, design §Bot
 * command contract). `--login` runs the same safe login transaction first and then REOPENS the
 * saved page for interaction: the upstream login helper closes its context on verification, so
 * returning straight after it would hand the operator a closed browser. A missing or corrupt
 * profile/metadata returns actionable guidance — this never invents a fresh session.
 */
export async function openBot(name: string, options: OpenBotOptions = {}): Promise<OpenBotResult> {
    assertSafeBotName(name);
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    const metadataPath = join(profileDir, BOT_METADATA_FILE);
    const saved = await readBotMetadata(fileSystem, metadataPath);
    if (saved === null && options.login === true && options.defaultUrl === undefined) {
        throw missingBotProfile(name, lstat(profileDir) !== null);
    }
    if (options.login === true) {
        const reloginUrl = saved !== null ? saved.defaultUrl : options.defaultUrl;
        if (reloginUrl !== undefined) {
            await loginBot(name, reloginUrl, options);
        }
    }
    const metadata = await readBotMetadata(fileSystem, metadataPath);
    // 0277: a metadata-free fixed profile opens through its unique adapter's declared homeUrl,
    // passed by the CLI as `defaultUrl`; a publication-scoped adapter gets login guidance there.
    const openUrl = metadata !== null ? metadata.defaultUrl : options.defaultUrl;
    if (openUrl === undefined) {
        throw missingBotProfile(name, lstat(profileDir) !== null);
    }
    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    if (options.adapter !== undefined) {
        try {
            const child = await options.adapter.run({
                mode: 'open',
                profileDir,
                url: openUrl,
                env: await lease.delegatedEnv(profileDir),
            });
            if (child.exitCode === 2) {
                throw new BotError(
                    'usage',
                    `session adapter '${options.adapter.pluginName}' reported a usage error (exit 2)`,
                );
            }
            if (child.exitCode !== 0) {
                throw new BotError(
                    'browser',
                    `session adapter '${options.adapter.pluginName}' open failed: child exit ${child.exitCode}`,
                );
            }
            return {
                name,
                defaultUrl: openUrl,
                message: `closed the local session for bot '${name}' — the saved profile is unchanged`,
            };
        } finally {
            await lease.release();
        }
    }
    let context: BrowserContext | undefined;
    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: false });
        // Attach the closure listener before navigating: the operator may close the window at once.
        const closed = new Promise<void>((resolveClose) => {
            context?.once('close', () => resolveClose());
        });
        const page = await openBotPage(context);
        await navigateBot(page, openUrl);
        await focusBotPage(page);
        await closed;
        return {
            name,
            defaultUrl: openUrl,
            message: `closed the local session for bot '${name}' — the saved profile is unchanged`,
        };
    } catch (error) {
        await closeBotContext(context);
        throw error;
    } finally {
        await lease.release();
    }
}

/** One request {@link execBot} performs (0306, design §kk bot exec — frozen shape). */
export interface BotExecRequest {
    /** Absolute http(s) URL sent as given: the query is kept, a fragment never leaves the client. */
    url: string;
    /** HTTP method; the CLI defaults it to `GET`, or `POST` when `-d` is given. */
    method: string;
    /** Request headers, split on the first colon by the CLI. */
    headers: Record<string, string>;
    /** Raw request body when `-d` was given (an `@file` is read verbatim). */
    data?: Buffer;
    /** `-L`: follow redirects; otherwise `maxRedirects: 0` returns the 3xx response as-is. */
    followRedirects: boolean;
    /** `-m` in milliseconds; omitted leaves Playwright's 30 s request timeout in place. */
    timeoutMs?: number;
}

/** Buffered response {@link execBot} returns; printing and the exit mapping belong to the CLI. */
export interface BotExecResponse {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    body: Buffer;
}

/**
 * One authenticated request with bot `name`'s cached cookie session (0306, design §kk bot exec).
 * A headless persistent launch under the shared lease lets `BrowserContext.request` attach exactly
 * the cookies the browser itself would for that URL — nothing is exported from the profile, and
 * adapter special state is deliberately not emulated. The profile directory must already exist
 * (exec never creates one); `bot.json` is not required, so legacy profiles can exec too. Failures
 * are rethrown URL-free: Playwright's fetch messages embed the request URL and its query.
 * The whole body is buffered (`shortcut:` a large download is held in memory — stream to `-o` when
 * that becomes a real use case).
 */
export async function execBot(
    name: string,
    request: BotExecRequest,
    options: BotSessionOptions = {},
): Promise<BotExecResponse> {
    assertSafeBotName(name);
    const url = validateExecUrl(request.url);
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    if (lstat(profileDir) === null) throw missingBotProfile(name, false);
    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    let context: BrowserContext | undefined;
    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: true });
        let response: Awaited<ReturnType<BrowserContext['request']['fetch']>>;
        try {
            response = await context.request.fetch(url, {
                method: request.method,
                headers: request.headers,
                ...(request.data === undefined ? {} : { data: request.data }),
                failOnStatusCode: false,
                ...(request.followRedirects ? {} : { maxRedirects: 0 }),
                ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }),
            });
        } catch (error) {
            throw new BotError('browser', `request failed for bot '${name}' (${execFailureDetail(error, url)})`);
        }
        let body: Buffer;
        try {
            body = await response.body();
        } catch (error) {
            throw new BotError('browser', `response unreadable for bot '${name}' (${execFailureDetail(error, url)})`);
        }
        return { status: response.status(), statusText: response.statusText(), headers: response.headersArray(), body };
    } finally {
        await closeBotContext(context);
        await lease.release();
    }
}

/**
 * Validate an exec URL and return it as given: http(s) only, no embedded credentials — the same
 * rules as `normalizeBotDefaultUrl`, but the query is KEPT because it is the request, not a saved
 * default. Failures never echo the input (a query can carry a token).
 */
export function validateExecUrl(input: string): string {
    const url = input.trim();
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new BotError('usage', 'invalid URL: expected an absolute http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BotError('usage', `unsupported URL scheme '${parsed.protocol}' — http(s) only`);
    }
    if (parsed.username !== '' || parsed.password !== '') {
        throw new BotError('usage', 'URL must not embed credentials');
    }
    return url;
}

/**
 * URL-free failure detail: Playwright embeds the request URL (query included) in its message and
 * call log, and a query can carry a token. Keep the error class plus the first message line with
 * every spelling of the URL replaced.
 */
export function execFailureDetail(error: unknown, url: string): string {
    const label = error instanceof Error && error.name !== '' ? error.name : 'Error';
    let detail = (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '';
    const parsed = new URL(url);
    for (const leak of [
        url,
        `${parsed.origin}${parsed.pathname}`,
        parsed.origin,
        parsed.pathname,
        parsed.search,
        parsed.hash,
    ]) {
        if (leak.length > 1) detail = detail.split(leak).join('<url>');
    }
    // Under `-L` the failing hop can be a redirect target the caller never supplied.
    detail = detail.replace(/\bhttps?:\/\/\S+/gi, '<url>');
    detail = detail.replace(/\s+/g, ' ').trim().slice(0, 200);
    return detail === '' ? label : `${label}: ${detail}`;
}

/**
 * Saved metadata for one bot, or `null` when the profile is absent or legacy (no `bot.json`).
 * CLI-side adapter resolution needs the persisted `pluginName` and the legacy signal without
 * duplicating the metadata file contract; corrupt metadata still fails `persistence`.
 */
export async function readBotSavedMetadata(
    name: string,
    options: { root?: string; fileSystem?: FileSystem } = {},
): Promise<BotMetadata | null> {
    const profileDir = resolveBotProfileDir(name, { root: options.root });
    if (lstat(profileDir) === null) return null;
    return readBotMetadata(options.fileSystem ?? createNodeFileSystem(), join(profileDir, BOT_METADATA_FILE));
}

/** Actionable guidance for a bot that has no saved generic session to reopen. */
export function missingBotProfile(name: string, profileExists: boolean): BotError {
    const guidance = `run \`kk bot login <url> --save ${name}\` to save one`;
    return profileExists
        ? new BotError(
              'persistence',
              `bot '${name}' has no saved default page — ${guidance}; the existing profile was left untouched`,
          )
        : new BotError('not-found', `no local profile for bot '${name}' — ${guidance}`);
}

/** The page a persistent context opened with (upstream `openPage` shape). */
export async function openBotPage(context: BrowserContext): Promise<Page> {
    return context.pages()[0] ?? (await context.newPage());
}

/** Navigate to the login page, redacting the URL from any failure: a supplied URL can carry a grant. */
async function navigateBot(page: Page, url: string): Promise<void> {
    try {
        await page.goto(url);
    } catch (error) {
        throw new BotError('browser', `could not open the supplied login URL (${redactNavigationError(error, url)})`);
    }
}

/**
 * Activate the window after opening it.
 *
 * Measured 2026-11-12 on the Medium/Google OAuth popup: the page renders and accepts input, but both
 * windows reported `document.hasFocus() === false` — the OS focus stayed with the terminal that ran
 * `kk bot login`, so an operator who starts typing without clicking the window first sees nothing
 * appear ("I cannot input the email address"). Bringing the page to the front makes the window the
 * active one, which is what any interactive login needs. Guarded because test fakes and headless
 * contexts may not implement it.
 */
async function focusBotPage(page: Page): Promise<void> {
    const target = page as unknown as { bringToFront?: () => Promise<void> };
    if (typeof target.bringToFront !== 'function') return;
    await target.bringToFront().catch(() => undefined);
}

/** Playwright embeds the failed URL in its message, so strip the URL and its query/fragment. */
function redactNavigationError(error: unknown, url: string): string {
    let detail = error instanceof Error ? error.message : String(error);
    detail = detail.split(url).join('<login-url>');
    try {
        const parsed = new URL(url);
        for (const secret of [parsed.search, parsed.hash]) {
            if (secret.length > 0) detail = detail.split(secret).join('');
        }
    } catch {
        // The URL was already validated by normalizeBotDefaultUrl; nothing more to strip.
    }
    return detail;
}

/** Close a context this invocation owns, ignoring a failure that would mask the real error. */
export async function closeBotContext(context: BrowserContext | undefined): Promise<void> {
    if (context === undefined) return;
    await context.close().catch(() => {});
}

/** Write `bot.json` owner-only. Metadata records historical evidence, never current readiness. */
async function writeBotMetadata(fileSystem: FileSystem, path: string, metadata: BotMetadata): Promise<void> {
    await fileSystem.writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`);
    chmod(path, 0o600);
}

/**
 * Explicit affirmative TTY confirmation for a generic login: an unknown site has no readiness
 * predicate, so a typed `y`/`yes` is the only evidence this path records. A missing terminal, a
 * closed stdin (Ctrl-D) and the deadline all refuse — an unconfirmed login is never saved. The
 * prompt names no URL, because the supplied login URL can carry a query grant.
 */
async function confirmBotLogin(timeoutMs: number): Promise<boolean> {
    if (process.stdin.isTTY !== true) {
        throw new BotError(
            'unconfirmed',
            'no interactive terminal is available — a generic login needs an affirmative confirmation (site adapters are the non-interactive route)',
        );
    }
    echo(
        `Sign in to the browser window that just came to the front (click into its email field first if the window lost focus), then type y + Enter within ${Math.round(
            timeoutMs / 1000,
        )}s to save this bot session (anything else cancels).`,
    );
    return await new Promise<boolean>((resolve, reject) => {
        const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        let settled = false;
        const finish = (value: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new BotError('unconfirmed', `no confirmation within ${timeoutMs}ms — nothing was saved`));
            }
            reader.close();
        }, timeoutMs);
        reader.once('line', (line) => {
            finish(/^(y|yes)$/i.test(line.trim()));
            reader.close();
        });
        reader.once('close', () => finish(false));
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Browser-side scripts. They are strings because the harness tsconfig has no DOM lib: the
 * expression is evaluated in the page, and the parameters are JSON-encoded into the source.
 */
function pasteScript(selector: string, html: string): string {
    const text = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const data = new DataTransfer();
    data.setData('text/html', ${JSON.stringify(html)});
    data.setData('text/plain', ${JSON.stringify(text)});
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return true;
})()`;
}

function editorTextScript(selector: string): string {
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? (el.textContent ?? '').trim() : '';
})()`;
}

function codeMirrorScript(selector: string, markdown: string): string {
    const value = JSON.stringify(markdown);
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const nodes = [el, el.querySelector('.cm-content'), el.querySelector('.cm-editor')];
    for (const node of nodes) {
        const view = node && node.cmView ? (node.cmView.rootView ?? node.cmView) : null;
        if (view && typeof view.dispatch === 'function' && view.state && view.state.doc) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${value} } });
            return 'cm6';
        }
    }
    const cm5 = el.CodeMirror ?? (el.querySelector('.CodeMirror') && el.querySelector('.CodeMirror').CodeMirror);
    if (cm5 && typeof cm5.setValue === 'function') {
        cm5.setValue(${value});
        return 'cm5';
    }
    el.focus();
    return 'keyboard';
})()`;
}
