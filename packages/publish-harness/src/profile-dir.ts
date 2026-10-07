import { mkdir, stat } from 'node:fs/promises';
import { BrowserProfileMissingError, InvalidProfileDirError } from '@gobing-ai/ts-browser-automation';

/**
 * Profile-dir guard for `kkBrowserLauncher` (0214), mirroring upstream `ensureProfileDir` (not exported).
 * Direct `node:fs` because the ts-runtime `ensureDir` seam takes no mode, and a profile holds session
 * cookies, so it must be created owner-only (0o700). Allowlisted in `.spur/rules/strict/runtime-boundaries.yaml`.
 *
 * An existing directory is adopted as-is. A headless launch never creates one: an absent profile means
 * no session, and a fresh one would fake a login.
 */
export async function ensureProfileDir(profileDir: string, headless: boolean): Promise<void> {
    const existing = await stat(profileDir).catch(() => null);
    if (existing) {
        if (!existing.isDirectory())
            throw new InvalidProfileDirError(`profileDir is not a directory: "${profileDir}".`);
        return;
    }
    if (headless) throw new BrowserProfileMissingError(profileDir);
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
}
