/** XHS checks are offline unless --headed; login/open share the profile CLI and never draw a budget. */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
    BOT_METADATA_FILE,
    readBotMetadata,
    resolveChannelProfileDir,
    runProfileCli,
} from '@gobing-ai/publish-harness/browser';
import type { BrowserLauncher } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { type AutomationGuard, createAutomationGuard } from './automation-guard';
import {
    CHANNEL,
    checkXhsProfileSession,
    isXhsConsoleReady,
    LOGIN_TIMEOUT_MS,
    type ProfileSessionCheck,
    PUBLISH_URL,
    wrapPlaywrightPage,
} from './index';

export type { ProfileSessionCheck, SessionCheckOptions as ProfileCheckOptions } from './index';
export { checkXhsProfileSession as checkProfileSession };

/** Exit 2 with usage and the ADR-032 error verdict as the last stdout line. */
function usageError(message: string): number {
    echoError(
        `profile-check: ${message} — usage: profile-check.ts [login|check|open] [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]`,
    );
    echo(JSON.stringify({ status: 'error', detail: message }));
    return 2;
}

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
        if (!['login', 'check', 'open'].includes(command) || positionals.length > 1)
            throw new Error(`unknown command '${positionals.join(' ')}'`);
        if (command === 'open' && values.profile === undefined)
            throw new Error('open requires an explicit --profile <dir>');
        headed = values.headed === true;
        sessionUrl = values.url;
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
        }
        profileDir = resolveChannelProfileDir(CHANNEL, values.profile);
    } catch (error) {
        return usageError(error instanceof Error ? error.message : String(error));
    }
    if (command === 'login' || command === 'open') {
        let openDetail = '';
        const code = await runProfileCli(
            {
                channel: CHANNEL,
                homeUrl: PUBLISH_URL,
                loginTimeoutMs: LOGIN_TIMEOUT_MS,
                checkHeadedOnly: true,
                isAuthenticated: (page) => isXhsConsoleReady(wrapPlaywrightPage(page)),
            },
            command === 'open' && sessionUrl === undefined ? [...argv, '--url', PUBLISH_URL] : argv,
            {
                launcher,
                stdout: (line) => {
                    echo(line);
                    if (line.includes('login failed:')) echoError(line);
                    if (command === 'open') openDetail = line.replace(/^xhs profile open failed: /, '');
                },
            },
        );
        if (command === 'open') {
            const detail =
                code === 0
                    ? `xhs profile session closed by the operator: ${profileDir}`
                    : `xhs profile open refused: ${openDetail}`;
            echo(JSON.stringify({ status: code === 0 ? 'verified' : 'refused', profileDir, detail }));
            if (code !== 0) echoError(detail);
        }
        return code;
    }
    let outcome: ProfileSessionCheck;
    if (headed) {
        const cap = guard.allow('check');
        if (!cap.allowed)
            outcome = { status: 'refused' as const, profileDir, detail: `xhs readiness refused: ${cap.reason}` };
        else {
            guard.record('check');
            outcome = await checkXhsProfileSession({ profileDir, timeoutMs, launcher });
        }
    } else {
        const fileSystem = createNodeFileSystem();
        try {
            const profile = await fileSystem.stat(profileDir);
            if (profile === null) {
                outcome = {
                    status: 'refused' as const,
                    profileDir,
                    detail: `offline: no profile at ${profileDir} — run kk bot login xhs`,
                };
            } else if (!profile.isDirectory()) {
                outcome = {
                    status: 'refused' as const,
                    profileDir,
                    detail: `offline: profile ${profileDir} is not a directory — run kk bot login xhs`,
                };
            } else {
                const metadata = await readBotMetadata(fileSystem, join(profileDir, BOT_METADATA_FILE));
                const expiresAt = metadata?.expiresAt;
                const expired = expiresAt !== undefined && Date.parse(expiresAt) <= Date.now();
                outcome = {
                    status: expired ? ('refused' as const) : ('verified' as const),
                    profileDir,
                    detail: `offline: ${expiresAt === undefined ? 'expiry unknown' : `${expired ? 'expired' : 'expires'} ${expiresAt}`}${expired ? ' — run kk bot login xhs' : ''}`,
                };
            }
        } catch (error) {
            outcome = {
                status: 'refused' as const,
                profileDir,
                detail: `offline: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    }
    echo(JSON.stringify(outcome));
    if (outcome.status !== 'verified') echoError(outcome.detail);
    return outcome.status === 'verified' ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
