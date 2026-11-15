import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserLauncher } from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { storageStatePath } from '../src/index';
import { main as profileCheckMain } from '../src/profile-check';

/**
 * AC1 of task 0371: `login` runs through the shared `runProfileCli` path and still exports the
 * durable `storage-state.json`. The launcher is injected (not a module spy) because the shared CLI
 * owns the launch, so nothing else here depends on how the plugin reaches the browser.
 *
 * Failure modes this pins: the export running before the readiness predicate accepted, the export
 * being skipped on the shared path, a leftover temp file beside the state, and a login verdict that
 * carries no `expiresAt` (the fact `kk bot list` reads).
 */

const tmpRoot = join(process.cwd(), '.works/tmp/test-wechat-shared-session');
const profileDir = join(tmpRoot, 'profile');
const COOKIE_VALUE = 'COOKIE-SENTINEL-DO-NOT-ECHO';
const CONSOLE_HOME = 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index';

afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

interface LaunchRequest {
    profileDir: string;
    headless: boolean;
}

/** A context whose page is already on the console home and whose jar holds one persistent httpOnly cookie. */
function recordingLauncher(requests: LaunchRequest[], events: string[]): BrowserLauncher {
    const expiresIn = Math.floor(Date.now() / 1000) + 86_400;
    const page = {
        goto: async (url: string) => void events.push(`goto:${url}`),
        url: () => CONSOLE_HOME,
        waitForTimeout: async () => undefined,
        evaluate: async () => undefined,
    };
    const context = {
        pages: () => [page],
        newPage: async () => page,
        addCookies: async () => void events.push('addCookies'),
        cookies: async () => [{ name: 'slave_sid', value: COOKIE_VALUE, httpOnly: true, expires: expiresIn }],
        storageState: async ({ path }: { path: string }) => {
            events.push('storageState');
            await Bun.write(path, JSON.stringify({ cookies: [], origins: [] }));
        },
        close: async () => void events.push('close'),
        once: () => undefined,
    };
    return {
        launch: async (request) => {
            requests.push({ profileDir: request.profileDir, headless: request.headless });
            return context as never;
        },
    };
}

async function run(argv: string[], launcher: BrowserLauncher): Promise<{ code: number; out: string; err: string }> {
    const out = createBufferTarget();
    const err = createBufferTarget();
    const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
    try {
        const code = await profileCheckMain(argv, launcher);
        return { code, out: out.text(), err: err.text() };
    } finally {
        restore();
    }
}

describe('wechatmp profile-check login through the shared session path (0371 AC1)', () => {
    test('login records session facts and still exports storage state', async () => {
        await mkdir(profileDir, { recursive: true });
        const requests: LaunchRequest[] = [];
        const events: string[] = [];
        const { code, out } = await run(
            ['login', '--profile', profileDir, '--url', 'https://mp.weixin.qq.com/cgi-bin/app?t=manage/index'],
            recordingLauncher(requests, events),
        );

        expect(code).toBe(0);
        const verdict = JSON.parse(out.trim().split('\n').at(-1) ?? '') as {
            status: string;
            profileDir: string;
            defaultUrl: string;
            expiresAt?: string;
        };
        expect(verdict.status).toBe('verified');
        expect(verdict.profileDir).toBe(profileDir);
        expect(verdict.defaultUrl).toBe('https://mp.weixin.qq.com/');
        expect(verdict.expiresAt).toBeDefined();

        // The export runs on the page the predicate accepted, before the context closes.
        expect(events).toContain('storageState');
        expect(events.indexOf('storageState')).toBeLessThan(events.indexOf('close'));

        const stateFile = storageStatePath(profileDir);
        expect(JSON.parse(await readFile(stateFile, 'utf-8'))).toEqual({ cookies: [], origins: [] });
        // Atomic writer: the temp file beside the target is gone, never left behind.
        expect((await readdir(profileDir)).sort()).toEqual(['storage-state.json']);
        expect(out).not.toContain(COOKIE_VALUE);
    });
});
