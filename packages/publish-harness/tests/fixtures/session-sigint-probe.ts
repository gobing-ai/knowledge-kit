// SIGINT/SIGTERM lease-release probe for `kk bot open|login|replay` (0423 R5). Run by
// bot-session.test.ts in a separate `bun` process: the session holds its profile lease with a fake
// browser that never finishes, so the parent can deliver a real signal and observe the lease.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { replayBot } from '../../src/bot-replay';
import { loginBot, openBot } from '../../src/browser';

const [mode, root, leaseRoot, profileDir] = process.argv.slice(2) as [string, string, string, string];
const startUrl = 'https://alice.example.com/home';

mkdirSync(profileDir, { recursive: true });
writeFileSync(
    join(profileDir, 'bot.json'),
    JSON.stringify({ schemaVersion: 1, defaultUrl: startUrl, authenticationEvidence: 'operator-confirmed' }),
);

/** Nothing this session awaits ever settles: only a signal can end it. */
const never = <T>(): Promise<T> => new Promise<T>(() => {});
const page = {
    url: () => startUrl,
    goto: () => never<void>(),
    bringToFront: async () => undefined,
    screenshot: async () => undefined,
};
const listeners: (() => void)[] = [];
const context = {
    cookies: async () => [],
    pages: () => [page],
    newPage: async () => page,
    once: (_event: string, listener: () => void) => {
        listeners.push(listener);
        return context;
    },
    close: async () => {
        for (const listener of listeners.splice(0)) listener();
    },
};
const launcher = {
    async launch() {
        return context as unknown as BrowserContext;
    },
};
const deps = { root, leaseRoot, transactionRoot: join(root, 'transactions'), launcher: launcher as never };

process.stdout.write('session\n');
if (mode === 'open') {
    await openBot('alice', deps);
} else if (mode === 'login') {
    await loginBot('alice', startUrl, { ...deps, confirm: () => never<boolean>() });
} else {
    await replayBot(
        'alice',
        {
            schemaVersion: 1,
            bot: 'alice',
            startUrl,
            recordedAt: new Date(0).toISOString(),
            redacted: true,
            steps: [{ i: 0, t: 0, kind: 'navigate', url: startUrl }],
        },
        { root, leaseRoot, launcher: launcher as never, outDir: join(root, 'replay') },
    );
}
process.stdout.write('closed\n');
