import { resolveBrowserProfileDir } from '@gobing-ai/publish-harness';
import { loginWithProfile } from '@gobing-ai/ts-browser-automation';
import { echo } from '@gobing-ai/ts-utils';
import { checkWechatSession } from './index';

const CONSOLE_URL = 'https://mp.weixin.qq.com/';
const LOGIN_TIMEOUT_MS = 180_000;

const profileDir = resolveBrowserProfileDir('wechatmp', process.env.WECHATMP_PROFILE_DIR);
const verb = process.argv[2] ?? 'check';

try {
    if (verb === 'login') {
        echo(
            `wechatmp login: opening the console in a headed browser — scan the QR once (timeout ${LOGIN_TIMEOUT_MS / 1000}s)`,
        );
        await loginWithProfile({
            profileDir,
            url: CONSOLE_URL,
            isAuthenticated: (page) => page.url().includes('/cgi-bin/home'),
            timeoutMs: LOGIN_TIMEOUT_MS,
        });
        echo(`wechatmp login: session saved in ${profileDir}`);
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
