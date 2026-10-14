/**
 * Read-only XHS profile-session capability (task 0177).
 *
 * The publish flow stays headed and unchanged. This module adds the two dogfood
 * operations around the shared profile (same precedence as the publish flow):
 *  - `login` recovers an absent/expired session headed via the upstream
 *    `loginWithProfile`, polled with the same XHS-owned readiness gate the publish
 *    flow uses;
 *  - `check` reopens the existing profile (headless by default; `--headed` skips the headless
 *    pass and probes headed only, 0216) and reports the session as
 *    `verified` or `refused` — a site refusal, expired session, or missing profile
 *    is an explicit failed readiness, never a success. The upstream launcher never
 *    creates a profile headless, so a check cannot fabricate a session from a
 *    fresh directory.
 *
 * ADR-025 (2026-09-28): the publish flow now runs this same check as a preflight before any headed
 * visit, and `check` draws on the shared 2h automation budget — the cap bounds total console
 * visits, not just publishes. The implementation lives in `./index` so both paths share it.
 *
 * Manual dogfood: `bun plugins/publishings/xhs-pub/src/profile-check.ts login` then
 * `bun plugins/publishings/xhs-pub/src/profile-check.ts check` on the same profile;
 * the full recipe lives in docs/design/xhs-image-cards.md.
 */

import { parseArgs } from 'node:util';
import { kkBrowserLauncher, resolveChannelProfileDir } from '@gobing-ai/publish-harness/browser';
import { type BrowserLauncher, loginWithProfile, openPersistentBrowser } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { type AutomationGuard, createAutomationGuard } from './automation-guard';
import {
    CHANNEL,
    checkXhsProfileSession,
    isXhsConsoleReady,
    LOGIN_TIMEOUT_MS,
    PUBLISH_URL,
    wrapPlaywrightPage,
} from './index';

export type { ProfileSessionCheck, SessionCheckOptions as ProfileCheckOptions } from './index';
/**
 * The session check lives in `./index` with the rest of the console contract (readiness gate,
 * publish URL, preflight deadline) so the publish preflight and this CLI share one implementation.
 * Re-exported under the 0177 names, so the operator surface is unchanged.
 */
export { checkXhsProfileSession as checkProfileSession };

export interface ProfileLoginOptions {
    profileDir: string;
    timeoutMs?: number;
    launcher?: BrowserLauncher;
}

/**
 * Headed one-time login on the channel profile via the upstream helper: the operator
 * signs in inside the opened window and the promise resolves only once the XHS-owned
 * readiness gate passes. No credential is read or stored — the profile directory
 * itself is the login artifact.
 */
export async function loginProfile(opts: ProfileLoginOptions): Promise<void> {
    await loginWithProfile({
        profileDir: opts.profileDir,
        url: PUBLISH_URL,
        isAuthenticated: (page) => isXhsConsoleReady(wrapPlaywrightPage(page)),
        timeoutMs: opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
        launcher: opts.launcher ?? kkBrowserLauncher,
    });
}

/** Exit 2 with the human usage on stderr and the ADR-032 `error` verdict as the last stdout line. */
function usageError(message: string): number {
    echoError(
        `profile-check: ${message} — usage: profile-check.ts [login|check|open] [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]`,
    );
    echo(JSON.stringify({ status: 'error', detail: message }));
    return 2;
}

/**
 * Bot-mode open (0277): headed, operator-interactive reopen of an existing profile — no readiness
 * assertion and no automation-guard record (an open is neither a publish nor a check visit, so it
 * draws no 2h budget, ADR-025). A missing profile is refused: nothing is fabricated.
 */
export async function openXhsSession(opts: {
    profileDir: string;
    url?: string;
    launcher?: BrowserLauncher;
}): Promise<void> {
    if (!(await createNodeFileSystem().exists(opts.profileDir))) {
        throw new Error(`no profile at ${opts.profileDir} — run the login command first`);
    }
    const raw = await openPersistentBrowser({
        profileDir: opts.profileDir,
        headless: false,
        launcher: opts.launcher ?? kkBrowserLauncher,
    });
    // Structural seam (same pattern as makeDefaultOpenPage): this plugin's tsconfig has no DOM lib
    // and its playwright resolution differs from the harness', so only the touched surface is named.
    const context = raw as unknown as {
        pages(): unknown[];
        newPage(): Promise<unknown>;
        once(event: 'close', listener: () => void): unknown;
    };
    const page = (context.pages()[0] ?? (await context.newPage())) as {
        goto(url: string, options?: { waitUntil: 'commit'; timeout: number }): Promise<unknown>;
    };
    try {
        await page.goto(opts.url ?? PUBLISH_URL, { waitUntil: 'commit', timeout: 30_000 });
    } catch {
        // The operator is watching the window; keep it open even if the target is slow.
    }
    await new Promise<void>((resolveClose) => {
        context.once('close', resolveClose);
    });
}

/** `login|check [--profile <dir>] [--timeout <ms>] [--headed]`; profile precedence matches the publish flow. */
export async function main(
    argv: string[] = process.argv.slice(2),
    launcher?: BrowserLauncher,
    guard: AutomationGuard = createAutomationGuard(),
): Promise<number> {
    let command: string;
    let profileDir: string;
    let timeoutMs: number | undefined;
    let headed = false;
    let sessionUrl: string | undefined;
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
        if (command === 'open' && values.profile === undefined) {
            throw new Error('open requires an explicit --profile <dir>');
        }
        sessionUrl = values.url;
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        profileDir = resolveChannelProfileDir(CHANNEL, values.profile);
    } catch (error) {
        return usageError(error instanceof Error ? error.message : String(error));
    }
    if (command === 'login') {
        try {
            await loginProfile({ profileDir, timeoutMs, launcher });
            echo(`xhs profile login verified: ${profileDir}`);
            // Bot mode (`kk bot login` supplies --url): the parent persists a default URL only from
            // this LAST-line verdict, and only the plugin-owned creator console is canonical — never
            // the operator's URL. Without --url the operator-mode output stands unchanged.
            if (sessionUrl !== undefined) {
                echo(JSON.stringify({ status: 'verified', profileDir, defaultUrl: PUBLISH_URL }));
            }
            return 0;
        } catch (error) {
            echoError(`xhs profile login failed: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }
    if (command === 'open') {
        try {
            await openXhsSession({ profileDir, url: sessionUrl, launcher });
        } catch (error) {
            const detail = `xhs profile open refused: ${error instanceof Error ? error.message : String(error)}`;
            echoError(detail);
            echo(JSON.stringify({ status: 'refused', profileDir, detail }));
            return 1;
        }
        echo(
            JSON.stringify({
                status: 'verified',
                profileDir,
                detail: `xhs profile session closed by the operator: ${profileDir}`,
            }),
        );
        return 0;
    }
    if (command !== 'check') {
        return usageError(`unknown command '${command}'`);
    }
    // ADR-025: a manual session check is a real console visit, so it draws on the shared 2h
    // automation budget rather than a separate one. `login` is deliberately uncapped above: it is
    // operator-interactive, so capping it would only block recovery from an expired session.
    const cap = guard.allow('check');
    if (!cap.allowed) {
        // The budget refusal is still a readiness verdict (0216 contract): emit the JSON line so
        // `kk plugin check` reports a refusal with the operator hint instead of a malformed probe.
        echo(JSON.stringify({ status: 'refused', profileDir, detail: `xhs readiness refused: ${cap.reason}` }));
        echoError(cap.reason);
        return 1;
    }
    guard.record('check');
    const outcome = await checkXhsProfileSession({ profileDir, timeoutMs, launcher, headedOnly: headed });
    echo(JSON.stringify(outcome));
    if (outcome.status !== 'verified') {
        echoError(outcome.detail);
        return 1;
    }
    return 0;
}

if (import.meta.main) {
    process.exit(await main());
}
