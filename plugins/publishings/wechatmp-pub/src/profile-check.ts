/**
 * WeChat MP profile-session capability (0216, ADR-032 probe contract).
 *
 * `login` opens the console headed and resolves once the QR scan lands on `/cgi-bin/home`, then
 * captures the durable `storageState` file — mp.weixin.qq.com grant cookies do not survive a
 * Chromium restart, so the saved state (not the profile cookie store) is the session artifact.
 * `check` reopens the profile with that state re-injected and reports `verified` or `refused`
 * as the LAST line on stdout, one JSON object — `kk plugin check` parses it. In bot mode (the
 * `kk bot login` parent supplies `--url`) `login` emits the same shape plus the plugin-owned
 * canonical `defaultUrl`, which is the only thing the parent persists. Exit codes:
 * 0 verified, 1 refused, 2 usage error. No cookie, token or storageState value is ever printed;
 * the profile directory is the only detail that leaves the process.
 */
import { parseArgs } from 'node:util';
import { resolveChannelProfileDir } from '@gobing-ai/publish-harness/browser';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { CHANNEL, CONSOLE_URL, checkWechatSession, openWechatLogin, openWechatSession } from './index';

const USAGE =
    'usage: wechatmp profile-check [login|check|open] [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]';
const LOGIN_TIMEOUT_MS = 180_000;
/**
 * The one browser open, console navigation and context close a `check` performs around its readiness
 * poll (headless ~3-4s, headed ~5-8s). `--timeout` is the WHOLE probe budget — kk SIGKILLs the process
 * at that instant — so the poll must not spend all of it: a dead session then dies mid-report and
 * surfaces as `probe exit 1 (malformed probe output)` instead of `refused` (observed 2026-10-16, where
 * the 30s poll plus overhead overran `kk plugin check`'s 30s default).
 *
 * 25s, not 8s (2026-10-21): a dead session spends the WHOLE poll before it can report, so the reserve
 * has to cover a cold `KK_BROWSER_CHANNEL=chrome` start, not a warm one — at 8s the first
 * `kk plugin check wechatmp-pub xhs-pub --timeout 60000` of the day SIGKILLed the probe at 60s and
 * reported `malformed probe output` while the immediately following run answered the real
 * `refused — Authentication was not confirmed` in the same 60s budget.
 */
const PROFILE_OVERHEAD_MS = 25_000;
/** Floor for the readiness poll, so a tiny `--timeout` still probes the console instead of refusing blind. */
const MIN_READINESS_MS = 1_000;

interface WechatVerdict {
    status: 'verified' | 'refused';
    profileDir: string;
    detail: string;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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
        if (command !== 'login' && command !== 'check' && command !== 'open') {
            throw new Error(`unknown command '${command}'`);
        }
        if (command === 'open' && (values.profile === undefined || values.url === undefined)) {
            throw new Error('open requires an explicit --profile <dir> and --url <url>');
        }
        sessionUrl = values.url;
        headed = values.headed === true;
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        profileDir = resolveChannelProfileDir(CHANNEL, values.profile);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        echoError(`wechatmp profile-check: ${message} — ${USAGE}`);
        echo(JSON.stringify({ status: 'error', detail: message }));
        return 2;
    }

    if (command === 'login') {
        try {
            await openWechatLogin({ profileDir, timeoutMs: timeoutMs ?? LOGIN_TIMEOUT_MS });
            echo(`wechatmp profile login verified: ${profileDir}`);
            // Bot mode (`kk bot login` supplies --url): the parent persists a default URL only from
            // this LAST-line verdict, and only the plugin-owned console home is canonical — never the
            // operator's URL. Without --url the operator-mode output stands unchanged.
            if (sessionUrl !== undefined) {
                echo(JSON.stringify({ status: 'verified', profileDir, defaultUrl: CONSOLE_URL }));
            }
            return 0;
        } catch (error) {
            echoError(`wechatmp profile login failed: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }

    if (command === 'open') {
        // Bot-mode open (0277): restore the durable state and wait for the operator to close the
        // browser — no readiness assertion. A missing state file refuses (nothing is fabricated).
        try {
            await openWechatSession(profileDir, { url: sessionUrl });
            echo(
                JSON.stringify({
                    status: 'verified',
                    profileDir,
                    detail: `wechatmp profile session closed by the operator: ${profileDir}`,
                }),
            );
            return 0;
        } catch (error) {
            const detail = `wechatmp profile open refused: ${error instanceof Error ? error.message : String(error)}`;
            echoError(detail);
            echo(JSON.stringify({ status: 'refused', profileDir, detail }));
            return 1;
        }
    }

    let verdict: WechatVerdict;
    try {
        await checkWechatSession(profileDir, {
            headless: !headed,
            timeoutMs:
                timeoutMs === undefined ? undefined : Math.max(MIN_READINESS_MS, timeoutMs - PROFILE_OVERHEAD_MS),
        });
        verdict = {
            status: 'verified',
            profileDir,
            detail: `authenticated wechatmp console session observed ${headed ? 'via a headed pass' : 'headlessly'} via profile ${profileDir} (read-only)`,
        };
    } catch (error) {
        verdict = {
            status: 'refused',
            profileDir,
            detail: `wechatmp readiness refused: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    echo(JSON.stringify(verdict));
    return verdict.status === 'verified' ? 0 : 1;
}

if (import.meta.main) {
    process.exit(await main());
}
