import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserProfileMissingError, InvalidProfileDirError } from '@gobing-ai/ts-browser-automation';
import { ensureProfileDir } from '../src/profile-dir';

describe('ensureProfileDir (0214)', () => {
    let root: string;
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'kk-profile-dir-'));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    test('headless refuses a missing profile and creates nothing', async () => {
        const dir = join(root, 'absent');

        await expect(ensureProfileDir(dir, true)).rejects.toBeInstanceOf(BrowserProfileMissingError);
        expect(await stat(dir).catch(() => null)).toBeNull();
    });

    test('headed creates a missing profile owner-only', async () => {
        const dir = join(root, 'fresh', 'nested');

        await ensureProfileDir(dir, false);

        expect((await stat(dir)).mode & 0o777).toBe(0o700);
    });

    test('adopts an existing directory as-is in either mode', async () => {
        await ensureProfileDir(root, true);
        await ensureProfileDir(root, false);

        expect((await stat(root)).isDirectory()).toBe(true);
    });

    test('rejects a path that is a file', async () => {
        const file = join(root, 'file');
        await writeFile(file, '');

        await expect(ensureProfileDir(file, false)).rejects.toBeInstanceOf(InvalidProfileDirError);
    });
});
