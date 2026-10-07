/**
 * WeChat MP profile-session capability (0216, ADR-032 probe contract).
 *
 * `login` opens the console headed and resolves once the QR scan lands on `/cgi-bin/home`, then
 * captures the durable `storageState` file — mp.weixin.qq.com grant cookies do not survive a
 * Chromium restart, so the saved state (not the profile cookie store) is the session artifact.
 * `check` reopens the profile with that state re-injected and reports `verified` or `refused`
 * as the LAST line on stdout, one JSON object — `kk plugin check` parses it. Exit codes:
 * 0 verified, 1 refused, 2 usage error. No cookie, token or storageState value is ever printed;
 * the profile directory is the only detail that leaves the process.
 */
import { parseArgs } from 'node:util';
import { resolveChannelProfileDir } from '@gobing-ai/publish-harness/browser';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { CHANNEL, checkWechatSession, openWechatLogin } from './index';

const USAGE = 'usage: wechatmp profile-check [login|check] [--profile <dir>] [--timeout <ms>] [--headed]';
const LOGIN_TIMEOUT_MS = 180_000;

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
        if (command !== 'login' && command !== 'check') {
            throw new Error(`unknown command '${command}'`);
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
        echoError(`wechatmp profile-check: ${error instanceof Error ? error.message : String(error)} — ${USAGE}`);
        return 2;
    }

    if (command === 'login') {
        try {
            await openWechatLogin({ profileDir, timeoutMs: timeoutMs ?? LOGIN_TIMEOUT_MS });
            echo(`wechatmp profile login verified: ${profileDir}`);
            return 0;
        } catch (error) {
            echoError(`wechatmp profile login failed: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }

    let verdict: WechatVerdict;
    try {
        await checkWechatSession(profileDir, { headless: !headed, timeoutMs });
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
