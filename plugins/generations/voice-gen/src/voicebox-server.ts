import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { echoError } from '@gobing-ai/ts-utils';

/** Boot wait / poll cadence for a freshly spawned local server (Voicebox cold start ≈ 2-5s). */
const BOOT_WAIT_MS = 30_000;
const POLL_MS = 500;
const LOG_PATH = '/tmp/voicebox-server.log';

export interface VoiceboxServerOptions {
    url?: string;
    serverBin?: string;
    dataDir?: string;
    logPath?: string;
    bootWaitMs?: number;
    pollMs?: number;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    spawn?: typeof nodeSpawn;
}

async function probeVoiceboxHealth(url: string, customFetch: typeof fetch): Promise<boolean> {
    try {
        return (await customFetch(`${url}/health`)).ok;
    } catch {
        return false;
    }
}

/**
 * Ensure a local Voicebox server is reachable: probe `/health`, and when it is down and the
 * URL points at this machine, spawn the app's server binary detached (stderr appended to the
 * log file, survives plugin exit) and poll until healthy — fail loud otherwise. Remote URLs
 * and a missing binary are configuration errors, not auto-start candidates.
 */
export async function ensureVoiceboxRunning(options: VoiceboxServerOptions = {}): Promise<void> {
    const rawUrl = options.url ?? process.env.VOICEBOX_URL ?? 'http://127.0.0.1:17493';
    const customFetch = options.fetch ?? fetch;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const customSpawn = options.spawn ?? nodeSpawn;

    if (await probeVoiceboxHealth(rawUrl, customFetch)) {
        return;
    }

    const url = new URL(rawUrl);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (!local) {
        throw new Error(
            `voice-gen: Voicebox not reachable at ${rawUrl} — auto-start only applies to local URLs; is the remote server up? (fix VOICEBOX_URL)`,
        );
    }
    const serverBin =
        options.serverBin ??
        process.env.VOICEBOX_SERVER_BIN ??
        '/Applications/Voicebox.app/Contents/MacOS/voicebox-server';
    if (!existsSync(serverBin)) {
        throw new Error(
            `voice-gen: Voicebox not reachable at ${rawUrl} and VOICEBOX_SERVER_BIN is missing (${serverBin}) — start Voicebox.app or set VOICEBOX_SERVER_BIN`,
        );
    }
    const dataDir =
        options.dataDir ??
        process.env.VOICEBOX_DATA_DIR ??
        join(homedir(), 'Library/Application Support/sh.voicebox.app');
    const logPath = options.logPath ?? LOG_PATH;
    const port = url.port === '' ? 17493 : Number(url.port);

    echoError(`voice-gen: Voicebox not reachable at ${rawUrl} — auto-starting ${serverBin} (log: ${logPath})`);
    const child: ChildProcess = customSpawn(serverBin, ['--port', String(port), '--data-dir', dataDir], {
        detached: true,
        stdio: ['ignore', 'ignore', openSync(logPath, 'a')],
    });
    child.unref?.();

    const bootWaitMs = options.bootWaitMs ?? BOOT_WAIT_MS;
    const pollMs = options.pollMs ?? POLL_MS;
    const deadline = Date.now() + bootWaitMs;
    while (Date.now() < deadline) {
        await sleep(pollMs);
        if (await probeVoiceboxHealth(rawUrl, customFetch)) {
            echoError(`voice-gen: Voicebox ready at ${rawUrl}`);
            return;
        }
    }
    throw new Error(
        `voice-gen: Voicebox did not become healthy at ${rawUrl} within ${bootWaitMs}ms of auto-start — check ${logPath}`,
    );
}
