import { describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveStorePath } from '../src/index';
import { makeTempDir } from './helpers';

describe('resolveStorePath', () => {
    it('defaults to .works/kk.db under the cwd and creates the parent dir', async () => {
        const dir = makeTempDir();
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            expect(await resolveStorePath()).toBe(join(dir, '.works/kk.db'));
            expect(existsSync(join(dir, '.works'))).toBe(true);
        } finally {
            process.chdir(cwd);
        }
    });

    it('reads store.db_path and resolves a relative path against the cwd', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, 'works_dir: /tmp/works\nstore:\n  db_path: data/kk.db\n');
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            expect(await resolveStorePath(configFile)).toBe(join(dir, 'data/kk.db'));
            expect(existsSync(join(dir, 'data'))).toBe(true);
        } finally {
            process.chdir(cwd);
        }
    });

    it('lets an explicit path win over the config (kk store migrate --db)', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');
        writeFileSync(configFile, 'store:\n  db_path: from-config.db\n');
        const explicit = join(dir, 'nested/explicit.db');

        expect(await resolveStorePath(configFile, explicit)).toBe(explicit);
        expect(existsSync(join(dir, 'nested'))).toBe(true);
    });

    it('expands a leading ~ against the home dir', async () => {
        const dir = makeTempDir();
        const configFile = join(dir, 'config.yaml');

        // Neither form creates anything under the real home: `~` is an existing dir, and
        // `~/kk.db`'s parent is the home dir itself, so the ensureDir is a no-op.
        writeFileSync(configFile, 'store:\n  db_path: "~"\n');
        expect(await resolveStorePath(configFile)).toBe(homedir());

        writeFileSync(configFile, 'store:\n  db_path: ~/kk.db\n');
        expect(await resolveStorePath(configFile)).toBe(join(homedir(), 'kk.db'));
    });

    it('falls back to the default for every unusable config shape', async () => {
        const dir = makeTempDir();
        const cwd = process.cwd();
        try {
            process.chdir(dir);
            const expected = join(dir, '.works/kk.db');

            expect(await resolveStorePath(join(dir, 'absent.yaml'))).toBe(expected);

            const blank = join(dir, 'blank.yaml');
            writeFileSync(blank, 'store:\n  db_path: "   "\n');
            expect(await resolveStorePath(blank)).toBe(expected);

            const wrongType = join(dir, 'wrong-type.yaml');
            writeFileSync(wrongType, 'store:\n  db_path: 42\n');
            expect(await resolveStorePath(wrongType)).toBe(expected);

            const notAMap = join(dir, 'not-a-map.yaml');
            writeFileSync(notAMap, 'store: 7\n');
            expect(await resolveStorePath(notAMap)).toBe(expected);

            const brokenYaml = join(dir, 'broken.yaml');
            writeFileSync(brokenYaml, 'store: [unclosed\n');
            expect(await resolveStorePath(brokenYaml)).toBe(expected);

            // A directory is `exists` but not readable as a file.
            expect(await resolveStorePath(dir)).toBe(expected);
        } finally {
            process.chdir(cwd);
        }
    });
});
