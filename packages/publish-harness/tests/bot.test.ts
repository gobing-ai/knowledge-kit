import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    assertSafeBotName,
    BotError,
    isSafeBotName,
    listBots,
    logoutBot,
    normalizeBotDefaultUrl,
    parseBotMetadata,
    readBotMetadata,
    resolveBotProfileDir,
} from '../src/bot';
import { copyProfileEntry, lstat } from '../src/bot-fs';
import { acquireProfileLease } from '../src/profile-lease';

describe('bot name validation (0276)', () => {
    test('accepts the documented alphabet', () => {
        for (const name of ['a', 'Z9', 'my-bot_1', 'A'.repeat(64)]) {
            expect(isSafeBotName(name)).toBe(true);
            expect(assertSafeBotName(name)).toBe(name);
        }
    });

    test('rejects unsafe names as usage errors', () => {
        for (const name of ['', '-lead', '_lead', 'has space', 'with/slash', '..', 'dots.name', 'A'.repeat(65)]) {
            expect(isSafeBotName(name)).toBe(false);
            expect(() => assertSafeBotName(name)).toThrow(BotError);
        }
    });
});

describe('bot default URL validation (0276)', () => {
    test('keeps origin+pathname and strips query/fragment', () => {
        expect(normalizeBotDefaultUrl('https://example.com/login?token=secret#frag')).toBe('https://example.com/login');
        expect(normalizeBotDefaultUrl('http://example.com:8080/a/b')).toBe('http://example.com:8080/a/b');
        expect(normalizeBotDefaultUrl('https://example.com')).toBe('https://example.com/');
    });

    test('refuses non-http(s), userinfo and relative URLs without echoing input', () => {
        const cases = ['ftp://example.com/x', 'file:///etc/passwd', 'https://u:p@example.com/', '/relative'];
        for (const input of cases) {
            let caught: unknown;
            try {
                normalizeBotDefaultUrl(input);
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(BotError);
            expect((caught as BotError).code).toBe('usage');
            expect((caught as BotError).message).not.toContain('u:p');
        }
    });
});

describe('bot metadata validation (0276)', () => {
    test('parses a well-formed record', () => {
        expect(
            parseBotMetadata({
                schemaVersion: 1,
                defaultUrl: 'https://example.com/home',
                authenticationEvidence: 'operator-confirmed',
                pluginName: 'xhs-pub',
            }),
        ).toEqual({
            schemaVersion: 1,
            defaultUrl: 'https://example.com/home',
            authenticationEvidence: 'operator-confirmed',
            pluginName: 'xhs-pub',
        });
    });

    test('rejects corrupt/unknown records as persistence errors', () => {
        const bad = [
            null,
            [],
            { schemaVersion: 2, defaultUrl: 'https://example.com/', authenticationEvidence: 'operator-confirmed' },
            { schemaVersion: 1, defaultUrl: 'https://example.com/?a=1', authenticationEvidence: 'operator-confirmed' },
            { schemaVersion: 1, defaultUrl: 'https://example.com/', authenticationEvidence: 'guessed' },
            {
                schemaVersion: 1,
                defaultUrl: 'https://example.com/',
                authenticationEvidence: 'site-verified',
                pluginName: 7,
            },
        ];
        for (const raw of bad) {
            expect(() => parseBotMetadata(raw)).toThrow(BotError);
            try {
                parseBotMetadata(raw);
            } catch (error) {
                expect((error as BotError).code).toBe('persistence');
            }
        }
    });
});

describe('bot metadata IO (0276)', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-metadata-'));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('absent metadata is null (legacy profile)', async () => {
        expect(await readBotMetadata(createNodeFileSystem(), join(root, 'bot.json'))).toBeNull();
    });

    test('corrupt metadata fails actionable without touching the file', async () => {
        const path = join(root, 'bot.json');
        writeFileSync(path, '{ not json');
        await expect(readBotMetadata(createNodeFileSystem(), path)).rejects.toBeInstanceOf(BotError);
        expect(readFileSync(path, 'utf8')).toBe('{ not json');
    });
});

describe('bot profile containment (0276)', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-root-'));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('resolves a contained profile and tolerates an absent root', () => {
        expect(resolveBotProfileDir('alice', { root })).toBe(join(root, 'alice'));
        expect(resolveBotProfileDir('alice', { root: join(root, 'absent') })).toBe(join(root, 'absent', 'alice'));
    });

    test('adopts an existing plain directory', () => {
        mkdirSync(join(root, 'alice'));
        expect(resolveBotProfileDir('alice', { root })).toBe(join(root, 'alice'));
    });

    test('refuses a symlinked entry and a non-directory', () => {
        mkdirSync(join(root, 'real'));
        symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir');
        expect(() => resolveBotProfileDir('linked', { root })).toThrow(BotError);

        writeFileSync(join(root, 'afile'), '');
        expect(() => resolveBotProfileDir('afile', { root })).toThrow(BotError);
    });

    test('refuses a symlinked root and path escapes', () => {
        mkdirSync(join(root, 'actual'));
        symlinkSync(join(root, 'actual'), join(root, 'rootlink'), 'dir');
        expect(() => resolveBotProfileDir('alice', { root: join(root, 'rootlink') })).toThrow(BotError);
        expect(() => resolveBotProfileDir('../evil', { root })).toThrow(BotError);
        expect(() => resolveBotProfileDir('a/b', { root })).toThrow(BotError);
    });
});

describe('bot-fs profile copy (0276)', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-fs-'));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('copies a profile tree preserving modes and skipping named artifacts', () => {
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'src', 'Cookies'), 'binary');
        chmodSync(join(root, 'src', 'Cookies'), 0o600);
        writeFileSync(join(root, 'src', 'SingletonLock'), 'x');

        copyProfileEntry(join(root, 'src'), join(root, 'dest'), { skip: (name) => name.startsWith('Singleton') });

        expect(readFileSync(join(root, 'dest', 'Cookies'), 'utf8')).toBe('binary');
        expect(statSync(join(root, 'dest', 'Cookies')).mode & 0o777).toBe(0o600);
        expect(lstat(join(root, 'dest', 'SingletonLock'))).toBeNull();
    });

    test('refuses to copy a symlink rather than following it', () => {
        mkdirSync(join(root, 'src'));
        writeFileSync(join(root, 'outside'), 'secret');
        symlinkSync(join(root, 'outside'), join(root, 'src', 'link'));
        expect(() => copyProfileEntry(join(root, 'src'), join(root, 'dest'))).toThrow(/symlink/);
    });
});

describe('bot list (0276)', () => {
    let root: string;
    const fileSystem = createNodeFileSystem();
    const writeMeta = (dir: string, defaultUrl: string): void => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'bot.json'),
            JSON.stringify({ schemaVersion: 1, defaultUrl, authenticationEvidence: 'operator-confirmed' }),
        );
    };
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-list-'));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('lists cached directories including legacy profiles and excludes symlinks/plain files', async () => {
        writeMeta(join(root, 'alice'), 'https://alice.example.com/home');
        mkdirSync(join(root, 'legacy'));
        mkdirSync(join(root, 'real'));
        symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir');
        writeFileSync(join(root, 'notes.txt'), 'not a bot');

        const entries = await listBots({ root, fileSystem });
        const names = entries.map((entry) => entry.name);
        expect(names).toEqual(['alice', 'legacy', 'real']);
        const alice = entries.find((entry) => entry.name === 'alice');
        expect(alice?.defaultUrl).toBe('https://alice.example.com/home');
        expect(alice?.metadata?.authenticationEvidence).toBe('operator-confirmed');
        const legacy = entries.find((entry) => entry.name === 'legacy');
        expect(legacy?.defaultUrl).toBeNull();
        expect(legacy?.metadata).toBeNull();
        // No row claims a live login.
        expect(entries.every((entry) => entry.state === 'cached')).toBe(true);
    });

    test('an absent root is an empty successful inventory', async () => {
        expect(await listBots({ root: join(root, 'absent'), fileSystem })).toEqual([]);
    });

    test('corrupt metadata lists the profile with an error instead of aborting the listing', async () => {
        mkdirSync(join(root, 'badbot'));
        writeFileSync(join(root, 'badbot', 'bot.json'), '{ not json');
        writeMeta(join(root, 'good'), 'https://good.example.com/');

        const entries = await listBots({ root, fileSystem });
        expect(entries.map((entry) => entry.name)).toEqual(['badbot', 'good']);
        const bad = entries.find((entry) => entry.name === 'badbot');
        expect(bad?.defaultUrl).toBeNull();
        expect(typeof bad?.metadataError).toBe('string');
    });

    test('refuses a symlinked profile root', async () => {
        mkdirSync(join(root, 'actual'));
        symlinkSync(join(root, 'actual'), join(root, 'rootlink'), 'dir');
        await expect(listBots({ root: join(root, 'rootlink'), fileSystem })).rejects.toBeInstanceOf(BotError);
    });
});

describe('bot logout (0276)', () => {
    let root: string;
    let leaseRoot: string;
    const fileSystem = createNodeFileSystem();
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-logout-'));
        leaseRoot = join(root, 'leases');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('removes only the selected profile and preserves siblings', async () => {
        mkdirSync(join(root, 'alice'));
        writeFileSync(join(root, 'alice', 'Cookies'), 'binary');
        mkdirSync(join(root, 'bob'));
        writeFileSync(join(root, 'bob', 'Cookies'), 'binary');

        const result = await logoutBot('alice', { root, leaseRoot, fileSystem });
        expect(result.removed).toBe(true);
        expect(result.message).toContain('local credentials');
        expect(result.message).not.toMatch(/revoked the session/i);
        expect(existsSync(join(root, 'alice'))).toBe(false);
        expect(existsSync(join(root, 'bob', 'Cookies'))).toBe(true);
    });

    test('an absent bot is an idempotent success that creates nothing', async () => {
        const result = await logoutBot('ghost', { root, leaseRoot, fileSystem });
        expect(result.removed).toBe(false);
        expect(existsSync(join(root, 'ghost'))).toBe(false);
    });

    test('refuses traversal, unsafe names and symlink escapes', async () => {
        mkdirSync(join(root, 'real'));
        symlinkSync(join(root, 'real'), join(root, 'linked'), 'dir');
        await expect(logoutBot('../evil', { root, leaseRoot, fileSystem })).rejects.toBeInstanceOf(BotError);
        await expect(logoutBot('a/b', { root, leaseRoot, fileSystem })).rejects.toBeInstanceOf(BotError);
        await expect(logoutBot('linked', { root, leaseRoot, fileSystem })).rejects.toBeInstanceOf(BotError);
        expect(existsSync(join(root, 'real'))).toBe(true);
    });

    test('refuses an active profile lease with busy', async () => {
        mkdirSync(join(root, 'alice'));
        const lease = await acquireProfileLease(join(root, 'alice'), { leaseRoot, fileSystem });
        let caught: unknown;
        try {
            await logoutBot('alice', { root, leaseRoot, fileSystem });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('busy');
        expect(existsSync(join(root, 'alice'))).toBe(true);
        await lease.release();
    });

    test('never lets an ambient profile-dir override redirect deletion', async () => {
        mkdirSync(join(root, 'alice'));
        const elsewhere = join(root, 'elsewhere', 'alice');
        mkdirSync(elsewhere, { recursive: true });
        writeFileSync(join(elsewhere, 'Cookies'), 'binary');

        const saved = process.env.KK_BROWSER_PROFILE_DIR;
        process.env.KK_BROWSER_PROFILE_DIR = join(root, 'elsewhere');
        try {
            await logoutBot('alice', { root, leaseRoot, fileSystem });
        } finally {
            if (saved === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
            else process.env.KK_BROWSER_PROFILE_DIR = saved;
        }
        expect(existsSync(join(root, 'alice'))).toBe(false);
        expect(existsSync(join(elsewhere, 'Cookies'))).toBe(true);
    });
});
