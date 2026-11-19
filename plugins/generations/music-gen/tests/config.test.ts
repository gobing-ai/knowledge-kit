import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_CONNECT_TIMEOUT_MS,
    DEFAULT_GENERATE_TIMEOUT_MS,
    DEFAULT_INSTANCE_URL,
    DEFAULT_MUSIC_PRICES,
    MUSIC_ENV_KEYS,
    MusicConfigError,
    resolveMusicConfig,
    resolveMusicConfigPath,
} from '../src/config';

/**
 * AC2/R2 — `music:` config resolution: environment override > config value >
 * documented default, with a wrong-typed key failing loudly instead of silently
 * defaulting a paid endpoint.
 */

/** Write a config file into a throwaway dir; the caller removes the dir. */
function withConfigFile(yaml: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'kk-music-config-'));
    const path = join(dir, 'config.yaml');
    writeFileSync(path, yaml);
    return { dir, path };
}

describe('R2 — base URL and timeouts resolve env > config > default', () => {
    test('no config and no env yields the documented defaults, including dry run off', async () => {
        const config = await resolveMusicConfig({ env: {}, configPath: join(tmpdir(), 'kk-music-absent.yaml') });
        expect(config.baseUrl).toBe(DEFAULT_INSTANCE_URL);
        expect(config.timeoutMs).toBe(DEFAULT_GENERATE_TIMEOUT_MS);
        expect(config.connectTimeoutMs).toBe(DEFAULT_CONNECT_TIMEOUT_MS);
        expect(config.prices).toEqual(DEFAULT_MUSIC_PRICES);
        expect(config.dryRun).toBe(false);
        expect(config.sources.baseUrl).toBe('default');
        expect(config.sources.dryRun).toBe('env');
    });

    test('the nested 0397 spellings are read from the config file', async () => {
        const { dir, path } = withConfigFile(`music:
  instance:
    url: http://instance.lan:8081
    timeoutMs: 240000
    connectTimeoutMs: 2500
  prices:
    pro: 0.1
    clip: 0.05
`);
        try {
            const config = await resolveMusicConfig({ env: {}, configPath: path });
            expect(config.baseUrl).toBe('http://instance.lan:8081');
            expect(config.timeoutMs).toBe(240_000);
            expect(config.connectTimeoutMs).toBe(2_500);
            expect(config.prices).toEqual({ pro: 0.1, clip: 0.05, analyze: null });
            expect(config.sources.baseUrl).toBe('config');
            expect(config.sources.prices).toBe('config');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the flat 0401 spellings are read too, and win when both appear', async () => {
        const { dir, path } = withConfigFile(`music:
  baseUrl: http://flat.lan:9000
  timeoutMs: 200000
  instance:
    url: http://nested.lan:8081
    timeoutMs: 240000
`);
        try {
            const config = await resolveMusicConfig({ env: {}, configPath: path });
            expect(config.baseUrl).toBe('http://flat.lan:9000');
            expect(config.timeoutMs).toBe(200_000);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the environment override wins over the config value', async () => {
        const { dir, path } = withConfigFile('music:\n  instance:\n    url: http://instance.lan:8081\n');
        try {
            const config = await resolveMusicConfig({
                env: { [MUSIC_ENV_KEYS.instanceUrl]: 'http://override.test:1234', [MUSIC_ENV_KEYS.timeoutMs]: '90000' },
                configPath: path,
            });
            expect(config.baseUrl).toBe('http://override.test:1234');
            expect(config.timeoutMs).toBe(90_000);
            expect(config.sources.baseUrl).toBe('env');
            expect(config.sources.timeoutMs).toBe('env');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('KK_MUSIC_DRY_RUN=1 is the offline switch', async () => {
        const config = await resolveMusicConfig({
            env: { [MUSIC_ENV_KEYS.dryRun]: '1' },
            configPath: join(tmpdir(), 'kk-music-absent.yaml'),
        });
        expect(config.dryRun).toBe(true);
        const off = await resolveMusicConfig({
            env: { [MUSIC_ENV_KEYS.dryRun]: '0' },
            configPath: join(tmpdir(), 'kk-music-absent.yaml'),
        });
        expect(off.dryRun).toBe(false);
    });

    test('a present key of the wrong type throws, naming the key', async () => {
        const { dir, path } = withConfigFile('music:\n  instance:\n    timeoutMs: soon\n');
        try {
            const error = await resolveMusicConfig({ env: {}, configPath: path }).catch((err: unknown) => err);
            expect(error).toBeInstanceOf(MusicConfigError);
            expect((error as MusicConfigError).key).toBe('music.instance.timeoutMs');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a malformed environment timeout throws, naming the variable', async () => {
        const error = await resolveMusicConfig({
            env: { [MUSIC_ENV_KEYS.timeoutMs]: 'soon' },
            configPath: join(tmpdir(), 'kk-music-absent.yaml'),
        }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(MusicConfigError);
        expect((error as MusicConfigError).key).toBe(MUSIC_ENV_KEYS.timeoutMs);
    });

    test('KK_CONFIG names the config file; otherwise the kk user config is used', () => {
        expect(resolveMusicConfigPath({ KK_CONFIG: '/tmp/kk/custom.yaml' })).toBe('/tmp/kk/custom.yaml');
        expect(resolveMusicConfigPath({})).toMatch(/\.config\/kk\/config\.yaml$/);
    });
});
