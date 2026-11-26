/**
 * Durable shipinhao console session (2026-11-26, operator decision: mirror `wechatmp-pub`'s 0371
 * storageState capture).
 *
 * WHY: the Channels console session does not survive our own launches. Measured 2026-11-26 — a
 * scanned login verified, `Default/Cookies` held two live `channels.weixin.qq.com` cookies, and two
 * to three minutes later the next launch refused readiness with the cookie rows gone. Every publish
 * therefore needed a fresh QR scan, and one scan bought a single row.
 *
 * The session artifact is a `storageState` snapshot beside the profile (`storage-state.json`):
 * captured right after an authenticated login, re-injected into every later context before the
 * first navigation. A missing snapshot is not an error — a profile that already carries a live
 * cookie store (the state before this change, and a fresh `login`) still works — but a corrupt one
 * is reported, never silently ignored.
 */
import { randomUUID } from 'node:crypto';
import { chmod, createExclusiveFile } from '@gobing-ai/publish-harness/browser';
import type { BrowserLauncher } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext, Page } from 'playwright';

/** Where the captured console session lives inside its profile directory. */
export function shipinhaoStorageStatePath(profileDir: string): string {
    return `${profileDir}/storage-state.json`;
}

/** How long the console gets to finish its post-auth `Set-Cookie` burst before the snapshot. */
export const SHP_STATE_SETTLE_MS = 3_000;

interface SavedState {
    cookies?: Parameters<BrowserContext['addCookies']>[0];
    origins?: { origin?: string; localStorage?: { name: string; value: string }[] }[];
}

/** Reads the snapshot; `undefined` when absent, `throw`-free on a corrupt file (reported by caller). */
async function readSavedState(profileDir: string): Promise<{ state?: SavedState; corrupt: boolean }> {
    const fs = createNodeFileSystem();
    const file = shipinhaoStorageStatePath(profileDir);
    try {
        if (!(await fs.exists(file))) return { corrupt: false };
        return { state: JSON.parse(await fs.readFile(file)) as SavedState, corrupt: false };
    } catch {
        return { corrupt: true };
    }
}

/**
 * Capture the authenticated browser state without ever exposing a half-written file: the temporary
 * file sits beside the target so the final rename is atomic on the profile filesystem, and cleanup
 * is best-effort so it can never mask the storageState or rename failure.
 */
export async function persistShipinhaoSessionState(
    context: { storageState(options: { path: string }): Promise<unknown> },
    profileDir: string,
): Promise<void> {
    const target = shipinhaoStorageStatePath(profileDir);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const fs = createNodeFileSystem();
    let reserved = false;
    try {
        createExclusiveFile(temporary);
        reserved = true;
        await context.storageState({ path: temporary });
        chmod(temporary, 0o600);
        await fs.rename(temporary, target);
    } finally {
        if (reserved) {
            await Promise.resolve()
                .then(() => fs.deleteFile(temporary))
                .catch(() => undefined);
        }
    }
}

/**
 * Replays the saved cookies and origin storage into a fresh context. Expired saved cookies are
 * skipped (a stale snapshot must not shadow the profile's own newer cookies), and anything the
 * profile already holds wins, so this can never downgrade a live session.
 *
 * The page argument is used only for the localStorage replay: Playwright restores origin storage on
 * a page, and the console reads its token from there.
 */
export async function restoreShipinhaoSessionState(
    context: BrowserContext,
    page: Page | undefined,
    profileDir: string,
): Promise<{ restored: boolean; skippedExpired: number; shadowed: number }> {
    const { state, corrupt } = await readSavedState(profileDir);
    if (corrupt) {
        throw new Error(`shipinhao saved session state is unreadable (${shipinhaoStorageStatePath(profileDir)})`);
    }
    const saved = state?.cookies ?? [];
    if (saved.length === 0) return { restored: false, skippedExpired: 0, shadowed: 0 };
    const nowSeconds = Date.now() / 1000;
    const current = await context.cookies().catch(() => []);
    const alive = saved.filter(
        (cookie) => cookie.expires === undefined || cookie.expires === -1 || cookie.expires > nowSeconds,
    );
    const skippedExpired = saved.length - alive.length;
    const held = new Set(current.map((cookie) => `${cookie.domain}|${cookie.name}`));
    const shadowed = alive.filter((cookie) => held.has(`${cookie.domain}|${cookie.name}`)).length;
    const inject = alive.filter((cookie) => !held.has(`${cookie.domain}|${cookie.name}`));
    if (inject.length > 0) await context.addCookies(inject);
    if (page !== undefined) {
        for (const entry of state?.origins ?? []) {
            if (entry.origin === undefined || (entry.localStorage ?? []).length === 0) continue;
            await page
                .evaluate(
                    ({ origin, items }: { origin: string; items: { name: string; value: string }[] }) => {
                        // Runs in the page: `window` is the browser's, not Bun's.
                        const page = globalThis as unknown as {
                            location: { origin: string };
                            localStorage: { setItem(name: string, value: string): void };
                        };
                        if (page.location.origin !== origin) return;
                        for (const item of items) page.localStorage.setItem(item.name, item.value);
                    },
                    { origin: entry.origin, items: entry.localStorage ?? [] },
                )
                .catch(() => undefined);
        }
    }
    return { restored: inject.length > 0, skippedExpired, shadowed };
}

/**
 * A launcher that re-injects the saved session into every context it opens, before the caller
 * navigates. Both the publish flow and `runProfileCli` go through this, so the preflight, the
 * publish window and the CLI `check` all see one session; a profile with no snapshot is untouched.
 */
export function stateRestoringLauncher(base: BrowserLauncher): BrowserLauncher {
    return {
        async launch(request) {
            const context = await base.launch(request);
            try {
                // A launcher's context is a real Playwright context; `pages()` is read defensively so
                // a test double without it still exercises the restore path.
                const pages = typeof context.pages === 'function' ? context.pages() : [];
                const page = pages[0];
                const outcome = await restoreShipinhaoSessionState(context, page, request.profileDir);
                if (outcome.skippedExpired > 0 || outcome.shadowed > 0) {
                    // Bounded, name-free: the operator sees WHY the snapshot was not replayed whole.
                    process.stderr.write(
                        `shipinhao-pub: replayed ${outcome.restored ? 'a' : 'no'} saved session (${outcome.skippedExpired} expired, ${outcome.shadowed} shadowed by the profile)\n`,
                    );
                }
            } catch (error: unknown) {
                await Promise.resolve()
                    .then(() => context.close())
                    .catch(() => undefined);
                throw error;
            }
            return context;
        },
    };
}
