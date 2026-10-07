import { resolveBrowserProfileDir } from '@gobing-ai/publish-harness';
import { kkBrowserLauncher, waitUntil } from '@gobing-ai/publish-harness/browser';
import { openPersistentBrowser } from '@gobing-ai/ts-browser-automation';
import { echo } from '@gobing-ai/ts-utils';
import { checkWechatSession, storageStatePath } from './index';

const CONSOLE_URL = 'https://mp.weixin.qq.com/';
const LOGIN_TIMEOUT_MS = 180_000;
const LOGGED_IN_FRAGMENT = '/cgi-bin/home';

const profileDir = resolveBrowserProfileDir('wechatmp', process.env.WECHATMP_PROFILE_DIR);
const verb = process.argv[2] ?? 'check';

try {
    if (verb === 'login') {
        echo(
            `wechatmp login: opening the console in a headed browser — scan the QR once (timeout ${LOGIN_TIMEOUT_MS / 1000}s)`,
        );
        const context = await openPersistentBrowser({ profileDir, headless: false, launcher: kkBrowserLauncher });
        try {
            const page = context.pages()[0] ?? (await context.newPage());
            await page.goto(CONSOLE_URL);
            const ready = await waitUntil(
                () => Promise.resolve(page.url().includes(LOGGED_IN_FRAGMENT)),
                LOGIN_TIMEOUT_MS,
                1000,
            );
            if (!ready) throw new Error(`QR scan not completed within ${LOGIN_TIMEOUT_MS / 1000}s`);
            await page.waitForTimeout(10_000); // settle: let the console finish its post-auth Set-Cookies
            // The Chromium profile store drops the grant cookies on restart even though they carry
            // multi-day expiries — the durable session artifact is the captured storageState file,
            // which the publish flow re-injects into every launch.
            await context.storageState({ path: storageStatePath(profileDir) });
            echo(`wechatmp login: session saved in ${storageStatePath(profileDir)}`);
        } finally {
            await context.close();
        }
    } else if (verb === 'check') {
        await checkWechatSession(profileDir);
        echo(`wechatmp session: OK (${profileDir})`);
    } else {
        echo('usage: bun src/profile-check.ts login|check');
        process.exit(1);
    }
} catch (error: unknown) {
    echo(`wechatmp ${verb}: failed — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
