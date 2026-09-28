/**
 * Read-only XHS profile-session capability (task 0177).
 *
 * The publish flow stays headed and unchanged. This module adds the two dogfood
 * operations around the shared profile (same precedence as the publish flow):
 *  - `login` recovers an absent/expired session headed via the upstream
 *    `loginWithProfile`, polled with the same XHS-owned readiness gate the publish
 *    flow uses;
 *  - `check` reopens the existing profile headless and reports the session as
 *    `verified` or `refused` — a site refusal, expired session, or missing profile
 *    is an explicit failed readiness, never a success. The upstream launcher never
 *    creates a profile headless, so a check cannot fabricate a session from a
 *    fresh directory.
 *
 * Manual dogfood: `bun plugins/publishings/xhs-pub/src/profile-check.ts login` then
 * `bun plugins/publishings/xhs-pub/src/profile-check.ts check` on the same profile;
 * the full recipe lives in docs/design/xhs-image-cards.md.
 */
import { parseArgs } from 'node:util';
import { resolveBrowserProfileDir } from '@gobing-ai/publish-harness';
import { type BrowserLauncher, loginWithProfile, withProfilePage } from '@gobing-ai/ts-browser-automation';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { CHANNEL, isXhsConsoleReady, LOGIN_TIMEOUT_MS, PUBLISH_URL, wrapPlaywrightPage } from './index';

/** Readiness deadline for the headless check: the publish step scale, not the 120s login wait. */
const CHECK_TIMEOUT_MS = 30_000;

/** Explicit check verdict: only an observed authenticated console is `verified`. */
export interface ProfileSessionCheck {
    status: 'verified' | 'refused';
    profileDir: string;
    /** Verdict evidence: what was observed, or the explicit refusal reason. */
    detail: string;
}

export interface ProfileCheckOptions {
    profileDir: string;
    timeoutMs?: number;
    launcher?: BrowserLauncher;
}

export interface ProfileLoginOptions {
    profileDir: string;
    timeoutMs?: number;
    launcher?: BrowserLauncher;
}

/**
 * Reopen the existing profile headless and apply the XHS login gate read-only: one
 * goto of the creator console and selector reads — no upload, no click, no note.
 * `withProfilePage` closes the context on every exit path; its poll turns "the
 * console never showed an authenticated UI" into a login timeout, reported here as
 * an explicit refusal.
 */
export async function checkProfileSession(opts: ProfileCheckOptions): Promise<ProfileSessionCheck> {
    try {
        await withProfilePage(
            {
                profileDir: opts.profileDir,
                headless: true,
                url: PUBLISH_URL,
                isAuthenticated: (page) => isXhsConsoleReady(wrapPlaywrightPage(page)),
                timeoutMs: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
                launcher: opts.launcher,
            },
            async () => undefined,
        );
        return {
            status: 'verified',
            profileDir: opts.profileDir,
            detail: `authenticated XHS creator console observed headlessly via profile ${opts.profileDir} (read-only)`,
        };
    } catch (error) {
        return {
            status: 'refused',
            profileDir: opts.profileDir,
            detail: `headless readiness refused: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
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
        launcher: opts.launcher,
    });
}

/** `login|check [--profile <dir>] [--timeout <ms>]`; profile precedence matches the publish flow. */
export async function main(argv: string[] = process.argv.slice(2), launcher?: BrowserLauncher): Promise<number> {
    let command: string;
    let profileDir: string;
    let timeoutMs: number | undefined;
    try {
        const { positionals, values } = parseArgs({
            args: argv,
            allowPositionals: true,
            options: { profile: { type: 'string' }, timeout: { type: 'string' } },
        });
        command = positionals[0] ?? 'check';
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        const override = values.profile ?? process.env.XHS_PROFILE_DIR ?? process.env.KK_BROWSER_PROFILE_DIR;
        profileDir = resolveBrowserProfileDir(CHANNEL, override);
    } catch (error) {
        echoError(
            `profile-check: ${error instanceof Error ? error.message : String(error)} — usage: profile-check.ts [login|check] [--profile <dir>] [--timeout <ms>]`,
        );
        return 1;
    }
    if (command === 'login') {
        try {
            await loginProfile({ profileDir, timeoutMs, launcher });
            echo(`xhs profile login verified: ${profileDir}`);
            return 0;
        } catch (error) {
            echoError(`xhs profile login failed: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }
    if (command !== 'check') {
        echoError(
            `profile-check: unknown command '${command}' — usage: profile-check.ts [login|check] [--profile <dir>] [--timeout <ms>]`,
        );
        return 1;
    }
    const outcome = await checkProfileSession({ profileDir, timeoutMs, launcher });
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
