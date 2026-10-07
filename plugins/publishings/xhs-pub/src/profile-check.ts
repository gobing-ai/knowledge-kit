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
import { type BrowserLauncher, loginWithProfile } from '@gobing-ai/ts-browser-automation';
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
    try {
        const { positionals, values } = parseArgs({
            args: argv,
            allowPositionals: true,
            options: {
                profile: { type: 'string' },
                timeout: { type: 'string' },
                headed: { type: 'boolean' },
            },
        });
        command = positionals[0] ?? 'check';
        headed = values.headed === true;
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        profileDir = resolveChannelProfileDir(CHANNEL, values.profile);
    } catch (error) {
        echoError(
            `profile-check: ${error instanceof Error ? error.message : String(error)} — usage: profile-check.ts [login|check] [--profile <dir>] [--timeout <ms>] [--headed]`,
        );
        return 2;
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
            `profile-check: unknown command '${command}' — usage: profile-check.ts [login|check] [--profile <dir>] [--timeout <ms>] [--headed]`,
        );
        return 2;
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
