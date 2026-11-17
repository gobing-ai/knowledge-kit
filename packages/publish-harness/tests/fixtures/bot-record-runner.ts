// 0382 AC2 child runner: records one session against a loopback page in real headless Chromium so the
// parent test can SIGINT this process and inspect the transcript and lease root it leaves behind.
// argv: <root> <leaseRoot> <out> <url>
import { chromium } from 'playwright';
import { recordBotSession } from '../../src/bot-record';

const [root, leaseRoot, out, url] = process.argv.slice(2);
if (root === undefined || leaseRoot === undefined || out === undefined || url === undefined) {
    console.error('usage: bot-record-runner <root> <leaseRoot> <out> <url>');
    process.exit(2);
}

await recordBotSession('fixture', {
    root,
    leaseRoot,
    out,
    defaultUrl: url,
    // Same launch shape as the kk launcher (Playwright's default SIGINT handling included), headless.
    launcher: {
        launch: ({ profileDir }: { profileDir: string }) =>
            chromium.launchPersistentContext(profileDir, {
                headless: true,
                args: ['--disable-blink-features=AutomationControlled'],
                ignoreDefaultArgs: ['--enable-automation'],
            }),
    } as never,
});
