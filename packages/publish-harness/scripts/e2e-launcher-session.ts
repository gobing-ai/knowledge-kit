// 0214 AC3 E2E: a session written by a headed login must survive a headless check of the same profile.
// Runs real browsers (one headed window opens briefly). Each direction runs twice: through
// kkBrowserLauncher (must keep the cookie), and through bare Playwright defaults as the control
// (reproduces the 0193/0194 loss, so the check is shown to fail without the fix).
// Usage: bun packages/publish-harness/scripts/e2e-launcher-session.ts [artifact.json]
// Exit 0 only when every launcher run keeps the cookie.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { kkBrowserLauncher } from '../src/browser';

const artifact = process.argv[2] ?? '.spur/run/e2e/0214-launcher-session.json';
const COOKIE = { name: 'kk_e2e', value: '1', domain: 'example.com', path: '/' };

type Open = (profileDir: string, headless: boolean) => Promise<BrowserContext>;
const viaLauncher: Open = (profileDir, headless) => kkBrowserLauncher.launch({ profileDir, headless });
const viaPlaywrightDefault: Open = (profileDir, headless) => chromium.launchPersistentContext(profileDir, { headless });

async function roundTrip(open: Open, writeHeadless: boolean): Promise<boolean> {
    const profileDir = await mkdtemp(join(tmpdir(), 'kk-e2e-launcher-'));
    try {
        let ctx = await open(profileDir, writeHeadless);
        await ctx.addCookies([{ ...COOKIE, expires: Math.floor(Date.now() / 1000) + 86_400 }]);
        await ctx.close();
        ctx = await open(profileDir, !writeHeadless);
        const kept = (await ctx.cookies()).some((c) => c.name === COOKIE.name);
        await ctx.close();
        return kept;
    } finally {
        await rm(profileDir, { recursive: true, force: true });
    }
}

const runs = [];
for (const [via, open] of [
    ['kkBrowserLauncher', viaLauncher],
    ['playwright-default (control)', viaPlaywrightDefault],
] as const) {
    for (const writeHeadless of [false, true]) {
        const kept = await roundTrip(open, writeHeadless);
        runs.push({
            via,
            write: writeHeadless ? 'headless' : 'headed',
            read: writeHeadless ? 'headed' : 'headless',
            kept,
        });
    }
}
const pass = runs.filter((r) => r.via === 'kkBrowserLauncher').every((r) => r.kept);
const result = {
    task: '0214',
    at: new Date().toISOString(),
    channel: process.env.KK_BROWSER_CHANNEL || 'chromium',
    pass,
    runs,
};
await Bun.write(artifact, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(pass ? 0 : 1);
