/**
 * 音频 cover centre crop unit suite (2026-11-26).
 *
 * `centerSquareCover` — the 音频 封面 is a centre crop of the bundle's landscape cover. Tested with
 * an injected `sips` seam, so the crop MATHS is asserted without the binary: the side is
 * `min(width, height)`, an already-square cover is returned untouched, and a host without `sips`
 * (or an unreadable file) yields an error the caller downgrades to the old dialog path.
 *
 * The session rail these files were split from is a shared harness concern now: see
 * `packages/publish-harness/tests/session-state.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { centerSquareCover, parseSipsDims, squareCoverPath } from '../src/cover-crop';

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
        // end in an `error` the caller downgrades, never a throw.
        const result = centerSquareCover('/definitely/not/here.png');
        expect('error' in result).toBe(true);
    });

    test('a host without `sips` reports an error the caller downgrades from', () => {
        const noBinary = centerSquareCover('/runs/cover.png', () => ({ status: null, stderr: 'spawn sips ENOENT' }));
        expect('error' in noBinary).toBe(true);
        expect(noBinary).toMatchObject({ error: expect.stringContaining('ENOENT') });
    });
});

/**
 * The two arrows in `SHP_CONFIG.sessionState` are the only wiring between the shared session rail
 * and this channel's profile CLI: `onAuthenticated` captures the snapshot after a verified login,
 * `onOpen` replays it into the next context.
 */
describe('shipinhao console session hooks (2026-11-26)', () => {
    test('a verified login snapshots the session and the next open replays it', async () => {
        const { mkdir, readFile, rm, writeFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { channelStorageStatePath } = await import('@gobing-ai/publish-harness/browser');
        const { SHP_CONFIG } = await import('../src/selectors');
        const profileDir = join(process.cwd(), '.works/tmp/test-shipinhao-hooks/profile');
        await mkdir(profileDir, { recursive: true });
        try {
            const cookie = {
                name: 'SUB',
                value: 'v',
                domain: '.channels.weixin.qq.com',
                path: '/',
                expires: 2_000_000_000,
            };
            const added: unknown[] = [];
            const context = {
                cookies: async () => [],
                addCookies: async (cookies: unknown[]) => {
                    added.push(...cookies);
                },
                storageState: async ({ path }: { path: string }) => {
                    await writeFile(path, JSON.stringify({ cookies: [cookie], origins: [] }));
                },
            };
            const page = { waitForTimeout: async () => undefined };
            const hooks = SHP_CONFIG.sessionState;
            await hooks?.onAuthenticated?.({
                context: context as never,
                page: page as never,
                profileDir,
            });
            expect(await readFile(channelStorageStatePath(profileDir), 'utf-8')).toContain('SUB');
            await hooks?.onOpen?.({ context: context as never, page: page as never, profileDir });
            expect(added).toHaveLength(1);
            // A snapshot that cannot be written is refused loudly and never relays cookie material.
            const broken = {
                cookies: async () => [],
                addCookies: async () => undefined,
                storageState: async () => {
                    throw new Error('storageState failed for SUB=secret');
                },
            };
            await expect(
                hooks?.onAuthenticated?.({ context: broken as never, page: page as never, profileDir }),
            ).rejects.toThrow('shipinhao authenticated session snapshot failed');
        } finally {
            await rm(profileDir, { recursive: true, force: true });
        }
    });
});
