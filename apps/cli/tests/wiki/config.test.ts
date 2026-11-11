import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWikiConfig, WikiConfigError } from '../../src/wiki/config';

/** Feature I1 R20 (task 0355): precedence, defaults and fail-loud validation for `kk.config.json`. */

const dirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-cfg-')));
    dirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function withConfig(body: unknown): string {
    const dir = tempDir();
    writeFileSync(join(dir, 'kk.config.json'), JSON.stringify(body));
    return dir;
}

describe('resolveWikiConfig', () => {
    it('returns the built-in defaults when no file exists', async () => {
        const dir = tempDir();
        const config = await resolveWikiConfig({ cwd: dir, env: {} });
        expect(config).toEqual({
            root: dir,
            raw: join(dir, 'raw'),
            content: join(dir, 'content'),
            defaultType: 'html',
            mirrors: [],
            remotes: {},
        });
    });

    it('reads the wiki block from kk.config.json', async () => {
        const dir = withConfig({
            wiki: {
                raw: 'inputs',
                content: 'vault',
                defaultType: 'rss',
                mirrors: ['raw/karakeep'],
                remotes: { r2: { command: 'rclone sync {content} {remote}', remote: 'r2:bucket' } },
            },
        });
        const config = await resolveWikiConfig({ cwd: dir, env: {} });
        expect(config.raw).toBe(join(dir, 'inputs'));
        expect(config.content).toBe(join(dir, 'vault'));
        expect(config.defaultType).toBe('rss');
        expect(config.mirrors).toEqual(['raw/karakeep']);
        expect(config.remotes.r2?.remote).toBe('r2:bucket');
    });

    it('keeps an absolute declared path absolute', async () => {
        const dir = withConfig({ wiki: { raw: '/tmp/absolute-raw' } });
        expect((await resolveWikiConfig({ cwd: dir, env: {} })).raw).toBe('/tmp/absolute-raw');
    });

    it('prefers KK_WIKI_* over the file and flags over both', async () => {
        const dir = withConfig({ wiki: { raw: 'file-raw' } });
        const fromEnv = await resolveWikiConfig({ cwd: dir, env: { KK_WIKI_RAW: 'env-raw', KK_WIKI_ROOT: '/tmp' } });
        expect(fromEnv.raw).toBe(join('/tmp', 'env-raw'));
        const fromFlag = await resolveWikiConfig({
            cwd: dir,
            env: { KK_WIKI_RAW: 'env-raw' },
            overrides: { raw: 'flag-raw' },
        });
        expect(fromFlag.raw).toContain('flag-raw');
    });

    it('takes each KK_WIKI_* path override independently', async () => {
        const dir = tempDir();
        const config = await resolveWikiConfig({ cwd: dir, env: { KK_WIKI_CONTENT: 'vault-env' } });
        expect(config.content).toBe(join(dir, 'vault-env'));
        expect(config.raw).toBe(join(dir, 'raw'));
    });

    it('rejects an unsupported declared key, naming it', async () => {
        const dir = withConfig({ wiki: { owt: 'x' } });
        await expect(resolveWikiConfig({ cwd: dir, env: {} })).rejects.toThrow(/unsupported key wiki.owt/);
    });

    it('rejects an invalid defaultType from either source', async () => {
        const dir = withConfig({ wiki: { defaultType: 'docx' } });
        await expect(resolveWikiConfig({ cwd: dir, env: {} })).rejects.toBeInstanceOf(WikiConfigError);
        const clean = tempDir();
        await expect(resolveWikiConfig({ cwd: clean, env: { KK_WIKI_DEFAULT_TYPE: 'docx' } })).rejects.toThrow(
            /is not one of url\|pdf\|html\|rss/,
        );
    });

    it('rejects malformed shapes with a specific message', async () => {
        await expect(resolveWikiConfig({ cwd: withConfig({ wiki: 'nope' }), env: {} })).rejects.toThrow(
            /"wiki" must be an object/,
        );
        await expect(resolveWikiConfig({ cwd: withConfig({ wiki: { root: 5 } }), env: {} })).rejects.toThrow(
            /wiki.root must be a non-empty string/,
        );
        await expect(resolveWikiConfig({ cwd: withConfig({ wiki: { mirrors: [1] } }), env: {} })).rejects.toThrow(
            /wiki.mirrors must be an array of strings/,
        );
        await expect(
            resolveWikiConfig({ cwd: withConfig({ wiki: { remotes: { r2: { command: 'x' } } } }), env: {} }),
        ).rejects.toThrow(/wiki.remotes.r2 must be/);
        await expect(resolveWikiConfig({ cwd: withConfig({ wiki: [] }), env: {} })).rejects.toThrow(
            /"wiki" must be an object/,
        );
        await expect(resolveWikiConfig({ cwd: withConfig({ remotes: {} }), env: {} })).resolves.toBeDefined();
    });

    it('rejects unreadable or non-JSON content', async () => {
        const dir = tempDir();
        writeFileSync(join(dir, 'kk.config.json'), '{ not json');
        await expect(resolveWikiConfig({ cwd: dir, env: {} })).rejects.toThrow(/invalid JSON/);
        const scalar = tempDir();
        writeFileSync(join(scalar, 'kk.config.json'), '"text"');
        await expect(resolveWikiConfig({ cwd: scalar, env: {} })).rejects.toThrow(/top level must be an object/);
    });

    it('rejects a config path it cannot read for a reason other than absence', async () => {
        const dir = tempDir();
        // kk.config.json as a directory: read fails with EISDIR, not ENOENT.
        rmSync(join(dir, 'kk.config.json'), { force: true });
        const fs = await import('node:fs');
        fs.mkdirSync(join(dir, 'kk.config.json'));
        await expect(resolveWikiConfig({ cwd: dir, env: {} })).rejects.toThrow(/cannot read/);
    });
});
