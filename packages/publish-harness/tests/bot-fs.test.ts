import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmod, copyProfileEntry, lstat, mkdirExclusive, realpath, rmdir } from '../src/bot-fs';

describe('bot-fs containment primitives (0276)', () => {
    const makeRoot = (): string => mkdtempSync(join(tmpdir(), 'kk-bot-fs-'));

    test('lstat reports containment facts without following symlinks and null for missing paths', () => {
        const root = makeRoot();
        try {
            const file = join(root, 'bot.json');
            writeFileSync(file, '{}');
            const dir = join(root, 'profile');
            mkdirSync(dir);
            const link = join(root, 'linked');
            symlinkSync(join(root, 'nowhere'), link);

            expect(lstat(join(root, 'missing'))).toBeNull();
            expect(lstat(file)?.isFile()).toBe(true);
            expect(lstat(dir)?.isDirectory()).toBe(true);
            const linked = lstat(link);
            expect(linked?.isSymbolicLink()).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('realpath resolves a symlink and is the identity for a canonical path', () => {
        const root = makeRoot();
        try {
            const dir = join(root, 'real');
            mkdirSync(dir);
            const link = join(root, 'alias');
            symlinkSync(dir, link);
            expect(realpath(link)).toBe(realpath(dir));
            expect(realpath(dir)).toBe(join(realpath(root), 'real'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('mkdirExclusive creates one owner-only directory and reports false when it exists', () => {
        const root = makeRoot();
        try {
            const dir = join(root, 'profiles', 'bot');
            mkdirSync(join(root, 'profiles'));
            expect(mkdirExclusive(dir)).toBe(true);
            expect((statSync(dir).mode & 0o777) === 0o700).toBe(true);
            expect(mkdirExclusive(dir)).toBe(false);
            expect(() => mkdirExclusive(join(root, 'absent-parent', 'bot'))).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('rmdir removes an empty directory, declines absent and non-empty dirs, throws on a file', () => {
        const root = makeRoot();
        try {
            const empty = join(root, 'empty');
            mkdirSync(empty);
            expect(rmdir(empty)).toBe(true);
            expect(rmdir(empty)).toBe(false);

            const full = join(root, 'full');
            mkdirSync(full);
            writeFileSync(join(full, 'Cookies'), 'x');
            expect(rmdir(full)).toBe(false);

            const file = join(root, 'bot.json');
            writeFileSync(file, '{}');
            expect(() => rmdir(file)).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('chmod sets owner-only permissions on a metadata file', () => {
        const root = makeRoot();
        try {
            const file = join(root, 'bot.json');
            writeFileSync(file, '{}');
            chmod(file, 0o600);
            expect((statSync(file).mode & 0o777) === 0o600).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('copyProfileEntry copies files and trees with modes, honors skip, refuses missing and symlinks', () => {
        const root = makeRoot();
        try {
            expect(() => copyProfileEntry(join(root, 'missing'), join(root, 'out'))).toThrow(/source missing/);

            const link = join(root, 'linked');
            symlinkSync(join(root, 'nowhere'), link);
            expect(() => copyProfileEntry(link, join(root, 'out'))).toThrow(/refusing to copy symlink/);

            const src = join(root, 'profile');
            mkdirSync(src, { mode: 0o700 });
            writeFileSync(join(src, 'bot.json'), '{"schemaVersion":1}');
            writeFileSync(join(src, 'Cookies'), 'binary\u0000data');
            mkdirSync(join(src, 'Singleton'), { mode: 0o700 });

            const dest = join(root, 'stage');
            copyProfileEntry(src, dest, { skip: (name) => name === 'Singleton' });
            expect(readFileSync(join(dest, 'bot.json'), 'utf8')).toBe('{"schemaVersion":1}');
            expect(readFileSync(join(dest, 'Cookies'), 'utf8')).toBe('binary\u0000data');
            expect((statSync(dest).mode & 0o777) === 0o700).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
