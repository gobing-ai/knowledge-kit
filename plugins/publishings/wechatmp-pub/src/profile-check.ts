/**
 * WeChat MP profile-session capability (0216, ADR-032 probe contract; shared path 0371).
 *
 * `login` and `open` delegate to the shared `runProfileCli` (0371): one login/open path with the
 * other channels, so a bot-mode login verdict carries the cookie-derived `expiresAt` `kk bot list`
 * reads. The channel's own session artifact survives through `wechatSessionConfig`'s hooks — the
 * `storageState` capture at login and its re-injection before `open` navigates (see `./index`).
 * `check` stays channel-owned: it re-injects that state, which the shared profile check cannot.
 *
 * `check` reports `verified` or `refused` as the LAST line on stdout, one JSON object —
 * `kk plugin check` parses it. Exit codes: 0 verified, 1 refused, 2 usage error. No cookie, token
 * or storageState value is ever printed; the profile directory is the only detail that leaves the
 * process.
 */
import { parseArgs } from 'node:util';
import { type BrowserLauncher, resolveChannelProfileDir, runProfileCli } from '@gobing-ai/publish-harness/browser';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { CHANNEL, checkWechatSession, wechatBrowserLauncher, wechatSessionConfig } from './index';

const USAGE =
    'usage: wechatmp profile-check [login|check|open] [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]';
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

export async function main(argv: string[] = process.argv.slice(2), launcher?: BrowserLauncher): Promise<number> {
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

    if (command === 'login' || command === 'open') {
        let openFailure = '';
        const code = await runProfileCli(wechatSessionConfig, argv, {
            launcher: launcher ?? wechatBrowserLauncher,
            stdout: (line) => {
                echo(line);
                // A login refusal is diagnostics the operator reads on stderr; an `open` refusal
                // reaches them once, in its composed verdict detail below.
                if (line.includes('profile login failed:')) echoError(line);
                if (line.includes('profile open failed:')) openFailure = line.replace(/^.*profile open failed: /, '');
            },
        });
        if (command === 'open') {
            // The bot parent reads one verdict shape from every channel: wrap the shared close/
            // refusal lines in it rather than leaking the CLI's own prose as the last line.
            const detail =
                code === 0
                    ? `wechatmp profile session closed by the operator: ${profileDir}`
                    : `wechatmp profile open refused: ${openFailure}`;
            echo(JSON.stringify({ status: code === 0 ? 'verified' : 'refused', profileDir, detail }));
            if (code !== 0) echoError(detail);
        }
        return code;
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
