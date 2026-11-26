/**
 * cover-crop + session-state unit suite (2026-11-26).
 *
 * Two additive shipinhao capabilities, each with its own failure mode:
 *  1. `centerSquareCover` — the 音频 封面 is a centre crop of the bundle's landscape cover. Tested
 *     with an injected `sips` seam, so the crop MATHS is asserted without the binary: the side is
 *     `min(width, height)`, an already-square cover is returned untouched, and a host without
 *     `sips` (or an unreadable file) yields an error the caller downgrades to the old dialog path.
 *  2. `session-state` — capture at login, replay into every later context. The profile's cookie
 *     store does not survive a restart, so this is what makes one QR scan worth more than one
 *     publish. Expired saved cookies are skipped and profile-held cookies win, so a stale snapshot
 *     can never downgrade a live session.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, BrowserLauncher, ProfileLaunchRequest } from '@gobing-ai/ts-browser-automation';
import { centerSquareCover, parseSipsDims, squareCoverPath } from '../src/cover-crop';
import {
    persistShipinhaoSessionState,
    restoreShipinhaoSessionState,
    shipinhaoStorageStatePath,
    stateRestoringLauncher,
} from '../src/session-state';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-shipinhao-session');

beforeEach(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('shipinhao 音频 cover centre crop (2026-11-26)', () => {
    test('reads pixel dimensions out of `sips -g` output and refuses a partial read', () => {
        expect(parseSipsDims('…/cover.png\n  pixelWidth: 1344\n  pixelHeight: 576')).toEqual({
            width: 1344,
            height: 576,
        });
        expect(parseSipsDims('  pixelWidth: 0\n  pixelHeight: 576')).toBeUndefined();
        expect(parseSipsDims('  pixelWidth: 1344')).toBeUndefined();
    });

    test('the cropped file sits beside the source with a stable name', () => {
        expect(squareCoverPath('/a/b/20261121_07_cover_cover.png')).toBe('/a/b/20261121_07_cover_cover-1x1.png');
    });

    test('a landscape cover is cropped to its shorter side from the centre, never stretched', () => {
        const calls: string[][] = [];
        const result = centerSquareCover('/runs/cover.png', (args) => {
            calls.push(args);
            return args.includes('-g')
                ? { status: 0, stdout: '  pixelWidth: 1344\n  pixelHeight: 576' }
                : { status: 0 };
        });
        expect(result).toEqual({ path: '/runs/cover-1x1.png' });
        // `-c <height> <width>` crops centred; 576 = min(1344, 576), so nothing is upscaled.
        expect(calls[1]).toEqual(['-c', '576', '576', '/runs/cover.png', '--out', '/runs/cover-1x1.png']);
    });

    test('an already-square cover is returned untouched, with no crop call', () => {
        const calls: string[][] = [];
        const result = centerSquareCover('/runs/square.png', (args) => {
            calls.push(args);
            return { status: 0, stdout: '  pixelWidth: 1080\n  pixelHeight: 1080' };
        });
        expect(result).toEqual({ path: '/runs/square.png' });
        expect(calls).toHaveLength(1);
    });

    test('a missing file is an error through the real `sips` seam, never a crash', () => {
        // Exercises the default seam (no injected run): a host without `sips` and a host with it both
        // land on the same downgrade path, so the missing binary is not a separate failure mode.
        const result = centerSquareCover(join(TMP_DIR, 'does-not-exist.png'));
        expect('error' in result).toBe(true);
    });

    test('a host without `sips` reports an error the caller downgrades from', () => {
        const noBinary = centerSquareCover('/runs/cover.png', () => ({ status: null, stderr: 'spawn sips ENOENT' }));
        expect('error' in noBinary).toBe(true);
        expect(noBinary).toMatchObject({ error: expect.stringContaining('ENOENT') });
    });
});

function cookie(name: string, domain: string, expires: number) {
    return { name, value: 'v', domain, path: '/', expires, httpOnly: true, secure: true, sameSite: 'Lax' as const };
}

function fakeContext(existing: ReturnType<typeof cookie>[] = []): {
    context: BrowserContext;
    added: ReturnType<typeof cookie>[];
} {
    const added: ReturnType<typeof cookie>[] = [];
    const context = {
        cookies: async () => existing,
        addCookies: async (cookies: ReturnType<typeof cookie>[]) => {
            added.push(...cookies);
        },
        storageState: async ({ path }: { path: string }) => {
            await writeFile(
                path,
                JSON.stringify({ cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)], origins: [] }),
            );
        },
    } as unknown as BrowserContext;
    return { context, added };
}

describe('shipinhao console session snapshot (2026-11-26)', () => {
    test('a login snapshot is written atomically beside the profile', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        const { context } = fakeContext();
        await persistShipinhaoSessionState(context, profileDir);
        const saved = JSON.parse(await readFile(shipinhaoStorageStatePath(profileDir), 'utf-8')) as {
            cookies: { name: string }[];
        };
        expect(saved.cookies.map((c) => c.name)).toEqual(['SUB']);
        // No `.tmp` sibling survives the rename.
        const { readdir } = await import('node:fs/promises');
        expect((await readdir(profileDir)).filter((f) => f.includes('.tmp'))).toEqual([]);
    });

    test('the saved cookies are replayed, expired ones skipped and profile-held ones left alone', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            shipinhaoStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [
                    cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000),
                    cookie('OLD', '.channels.weixin.qq.com', 1),
                    cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000),
                ],
                origins: [],
            }),
        );
        const { context, added } = fakeContext([cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000)]);
        const outcome = await restoreShipinhaoSessionState(context, undefined, profileDir);
        expect(added.map((c) => c.name)).toEqual(['SUB']);
        expect(outcome).toEqual({ restored: true, skippedExpired: 1, shadowed: 1 });
    });

    test('a profile with no snapshot is untouched (a fresh login still works)', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        const { context, added } = fakeContext();
        const outcome = await restoreShipinhaoSessionState(context, undefined, profileDir);
        expect(added).toEqual([]);
        expect(outcome).toEqual({ restored: false, skippedExpired: 0, shadowed: 0 });
    });

    test('origin storage is replayed into the page the console reads its token from', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            shipinhaoStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)],
                origins: [{ origin: 'https://channels.weixin.qq.com', localStorage: [{ name: 'token', value: 't' }] }],
            }),
        );
        const { context } = fakeContext();
        const replayed: { origin: string; items: { name: string; value: string }[] }[] = [];
        // Execute the REAL in-page callback against a fake window, so the replay logic itself is
        // covered (a fake that ignores the function would leave the body untested).
        const globals = globalThis as unknown as {
            location?: { origin: string };
            localStorage?: { setItem(name: string, value: string): void };
        };
        const previous = { location: globals.location, localStorage: globals.localStorage };
        const stored: [string, string][] = [];
        globals.location = { origin: 'https://channels.weixin.qq.com' };
        globals.localStorage = { setItem: (name: string, value: string) => stored.push([name, value]) };
        const page = {
            evaluate: async (
                fn: (arg: unknown) => void,
                arg: { origin: string; items: { name: string; value: string }[] },
            ) => {
                replayed.push(arg);
                fn(arg);
            },
        } as unknown as Parameters<typeof restoreShipinhaoSessionState>[1];
        await restoreShipinhaoSessionState(context, page, profileDir);
        expect(replayed).toEqual([
            { origin: 'https://channels.weixin.qq.com', items: [{ name: 'token', value: 't' }] },
        ]);
        expect(stored).toEqual([['token', 't']]);
        globals.location = previous.location;
        globals.localStorage = previous.localStorage;
    });

    test('a page that refuses the storage replay never fails the restore', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            shipinhaoStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)],
                origins: [{ origin: 'https://channels.weixin.qq.com', localStorage: [{ name: 't', value: 'v' }] }],
            }),
        );
        const { context, added } = fakeContext();
        const refuse = {
            evaluate: async () => {
                throw new Error('execution context destroyed');
            },
        };
        const outcome = await restoreShipinhaoSessionState(
            context,
            refuse as unknown as Parameters<typeof restoreShipinhaoSessionState>[1],
            profileDir,
        );
        expect(added.map((c) => c.name)).toEqual(['SUB']);
        expect(outcome.restored).toBe(true);
    });

    test('a launcher whose context cannot be read is closed before the error escapes', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(shipinhaoStorageStatePath(profileDir), '{not json');
        let closed = 0;
        const broken = {
            cookies: async () => [],
            close: async () => {
                closed += 1;
            },
        } as unknown as BrowserContext;
        const base: BrowserLauncher = { launch: async () => broken };
        await expect(stateRestoringLauncher(base).launch({ profileDir, headless: true })).rejects.toThrow('unreadable');
        expect(closed).toBe(1);
    });

    test('a partial replay is reported in one bounded line, never a cookie name', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            shipinhaoStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [
                    cookie('OLD', '.channels.weixin.qq.com', 1),
                    cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000),
                ],
                origins: [],
            }),
        );
        const { context } = fakeContext([cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000)]);
        const lines: string[] = [];
        const original = process.stderr.write.bind(process.stderr);
        process.stderr.write = ((chunk: string) => {
            lines.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        try {
            await stateRestoringLauncher({ launch: async () => context }).launch({ profileDir, headless: true });
        } finally {
            process.stderr.write = original;
        }
        expect(lines.join('')).toContain('1 expired, 1 shadowed');
        expect(lines.join('')).not.toContain('MINE');
    });

    test('a corrupt snapshot is reported, never silently ignored', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(shipinhaoStorageStatePath(profileDir), '{not json');
        const { context } = fakeContext();
        await expect(restoreShipinhaoSessionState(context, undefined, profileDir)).rejects.toThrow('unreadable');
    });

    test('the restoring launcher replays the snapshot for every context it opens', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await persistShipinhaoSessionState(fakeContext().context, profileDir);
        const requests: ProfileLaunchRequest[] = [];
        const { context: opened, added } = fakeContext();
        const base: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                return opened;
            },
        };
        const launched = await stateRestoringLauncher(base).launch({ profileDir, headless: true });
        expect(launched).toBe(opened);
        expect(requests.map((r) => r.profileDir)).toEqual([profileDir]);
        expect(added.map((c) => c.name)).toEqual(['SUB']);
    });
});
