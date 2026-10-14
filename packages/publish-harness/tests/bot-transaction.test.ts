import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { BotError } from '../src/bot';
import { beginBotTransaction } from '../src/bot-transaction';

/** Wrap the node FileSystem so a test can force a rename to fail at a chosen step. */
function withFailingRename(base: FileSystem, fail: (src: string, dest: string) => boolean): FileSystem {
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'rename') {
                return async (src: string, dest: string): Promise<void> => {
                    if (fail(src, dest)) throw new Error('injected rename failure');
                    await target.rename(src, dest);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

describe('bot transaction (0276)', () => {
    let root: string;
    let transactionRoot: string;
    let profileDir: string;
    const fileSystem = createNodeFileSystem();
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-tx-'));
        transactionRoot = join(root, 'transactions');
        profileDir = join(root, 'profiles', 'alice');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('promotes a staged profile over the previous one, excluding singleton artifacts, then cleans up', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'Cookies'), 'old-binary');
        writeFileSync(join(profileDir, 'SingletonLock'), 'lock');
        writeFileSync(join(profileDir, 'SingletonSocket'), 'sock');

        const before = new Set<string>();
        const tx = await beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem });
        await tx.copyExistingProfile();
        writeFileSync(join(tx.stageDir, 'Login Data'), 'new-binary');
        rmSync(join(tx.stageDir, 'Cookies'));
        await tx.commit(async () => {
            before.add('closed');
        });

        expect(before.has('closed')).toBe(true);
        expect(readFileSync(join(profileDir, 'Login Data'), 'utf8')).toBe('new-binary');
        expect(existsSync(join(profileDir, 'Cookies'))).toBe(false);
        expect(existsSync(join(profileDir, 'SingletonLock'))).toBe(false);
        expect(existsSync(join(profileDir, 'SingletonSocket'))).toBe(false);
        expect(existsSync(tx.dir)).toBe(false);
    });

    test('creates a fresh profile for a new bot (no existing final profile)', async () => {
        const tx = await beginBotTransaction({ name: 'newbot', profileDir, transactionRoot, fileSystem });
        await tx.copyExistingProfile();
        writeFileSync(join(tx.stageDir, 'Cookies'), 'fresh');
        await tx.commit(async () => {});
        expect(readFileSync(join(profileDir, 'Cookies'), 'utf8')).toBe('fresh');
        expect(existsSync(tx.dir)).toBe(false);
    });

    test('refuses to stage a non-singleton symlink', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(root, 'secret'), 'outside');
        symlinkSync(join(root, 'secret'), join(profileDir, 'evil'));
        const tx = await beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem });
        await expect(tx.copyExistingProfile()).rejects.toBeInstanceOf(BotError);
        await tx.abort();
        expect(readFileSync(join(profileDir, 'evil'), 'utf8')).toBe('outside');
    });

    test('abort leaves the final profile untouched and removes only this transaction', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'Cookies'), 'old');
        const tx = await beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem });
        await tx.copyExistingProfile();
        writeFileSync(join(tx.stageDir, 'Cookies'), 'staged');
        await tx.abort();
        expect(readFileSync(join(profileDir, 'Cookies'), 'utf8')).toBe('old');
        expect(existsSync(tx.dir)).toBe(false);
    });

    test('closes/flushes staged state before promoting', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'OLD'), 'old');
        const tx = await beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem });
        await tx.copyExistingProfile();
        rmSync(join(tx.stageDir, 'OLD'));
        writeFileSync(join(tx.stageDir, 'NEW'), 'new');

        const events: string[] = [];
        await tx.commit(async () => {
            // At close time the final profile must still be the previous one.
            expect(existsSync(join(profileDir, 'OLD'))).toBe(true);
            expect(existsSync(join(profileDir, 'NEW'))).toBe(false);
            events.push('closed');
        });
        events.push('promoted');
        expect(events).toEqual(['closed', 'promoted']);
        expect(existsSync(join(profileDir, 'OLD'))).toBe(false);
        expect(readFileSync(join(profileDir, 'NEW'), 'utf8')).toBe('new');
    });

    test('a failed promotion rollback preserves the previous final profile', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'OLD'), 'old');
        const failing = withFailingRename(fileSystem, (src) => src.endsWith(join('', 'stage')));
        const tx = await beginBotTransaction({
            name: 'alice',
            profileDir,
            transactionRoot,
            fileSystem: failing,
        });
        await tx.copyExistingProfile();
        writeFileSync(join(tx.stageDir, 'NEW'), 'new');

        let caught: unknown;
        try {
            await tx.commit(async () => {});
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect(readFileSync(join(profileDir, 'OLD'), 'utf8')).toBe('old');
        expect(existsSync(join(profileDir, 'NEW'))).toBe(false);
    });

    test('an old-moved failure leaves the previous profile intact', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'OLD'), 'old');
        const failing = withFailingRename(fileSystem, (_src, dest) => dest.endsWith(join('', 'backup')));
        const tx = await beginBotTransaction({
            name: 'alice',
            profileDir,
            transactionRoot,
            fileSystem: failing,
        });
        await tx.copyExistingProfile();
        await expect(tx.commit(async () => {})).rejects.toBeInstanceOf(BotError);
        expect(readFileSync(join(profileDir, 'OLD'), 'utf8')).toBe('old');
        await tx.abort();
        expect(existsSync(tx.dir)).toBe(false);
    });

    test('an incomplete rollback stays intact and refuses later mutation without deleting evidence', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'OLD'), 'old');
        const failing = withFailingRename(
            fileSystem,
            (src) => src.endsWith(join('', 'stage')) || src.endsWith(join('', 'backup')),
        );
        const tx = await beginBotTransaction({
            name: 'alice',
            profileDir,
            transactionRoot,
            fileSystem: failing,
        });
        await tx.copyExistingProfile();
        await expect(tx.commit(async () => {})).rejects.toBeInstanceOf(BotError);

        expect(existsSync(tx.dir)).toBe(true);
        await expect(tx.abort()).rejects.toBeInstanceOf(BotError);
        expect(existsSync(tx.dir)).toBe(true);
        // The previous profile is preserved in backup, not deleted.
        expect(existsSync(join(tx.dir, 'backup'))).toBe(true);
    });

    test('an orphan/incomplete journal refuses a later transaction and deletes nothing', async () => {
        const stray = join(transactionRoot, 'alice-11111111-2222-3333-4444-555555555555');
        mkdirSync(stray, { recursive: true });
        writeFileSync(
            join(stray, 'journal.json'),
            JSON.stringify({ schemaVersion: 1, name: 'alice', phase: 'old-moved', token: 'x' }),
        );
        await expect(
            beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem }),
        ).rejects.toBeInstanceOf(BotError);
        expect(existsSync(join(stray, 'journal.json'))).toBe(true);
    });

    test('a journal-less leftover is attributed by its directory name and refused', async () => {
        const stray = join(transactionRoot, 'alice-11111111-2222-3333-4444-555555555555');
        mkdirSync(stray, { recursive: true });
        await expect(
            beginBotTransaction({ name: 'alice', profileDir, transactionRoot, fileSystem }),
        ).rejects.toBeInstanceOf(BotError);
        expect(existsSync(stray)).toBe(true);
    });

    test('never reuses a transaction directory by name alone', async () => {
        const tx = await beginBotTransaction({
            name: 'alice',
            profileDir,
            transactionRoot,
            makeToken: () => 'fixed-token',
            fileSystem,
        });
        expect(tx.dir).toBe(join(transactionRoot, 'alice-fixed-token'));
        await tx.abort();
        const second = await beginBotTransaction({
            name: 'alice',
            profileDir,
            transactionRoot,
            makeToken: () => 'fixed-token',
            fileSystem,
        });
        // The first dir was cleaned, so the same name/token can be allocated again.
        expect(second.dir).toBe(tx.dir);
        await second.abort();
    });
});
