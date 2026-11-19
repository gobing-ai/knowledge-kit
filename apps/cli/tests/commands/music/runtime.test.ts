import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    DEFAULT_CONNECT_TIMEOUT_MS,
    DEFAULT_GENERATE_TIMEOUT_MS,
    DEFAULT_MUSIC_PRICES,
    DEFAULT_TAKES_CAP,
    InstanceError,
    MusicConfigError,
    type ResolvedMusicConfig,
    resolveMusicConfig,
} from '@gobing-ai/music-gen';
import { Command, CommanderError } from 'commander';
import { isVerbose, musicFailure, musicSeams, writeConfigReport } from '../../../src/commands/music/runtime';
import { captureOutput } from '../../capture';

/**
 * The `kk music` process boundary (task 0401 R2/R3, AC2).
 *
 * `music.test.ts` proves these paths through `main()`; this file holds the seams
 * themselves, because their contract is *shape* and a single end-to-end assertion
 * cannot pin it: the exit code, the error `code`, the one-line rule, and which
 * config key a remediation names. Anything that reaches the operator from a failed
 * music verb goes through `musicFailure`, so its mapping is asserted key by key.
 */

const ORIGINAL = { ...musicSeams };
let dir: string;
let configPath: string;
let config: ResolvedMusicConfig;

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kk-music-runtime-'));
    configPath = join(dir, 'config.yaml');
    // Every value below comes from the environment: the config file is absent, so a
    // developer's real `~/.config/kk/config.yaml` can never leak into an assertion.
    config = await resolveMusicConfig({
        env: {
            KK_MUSIC_INSTANCE_URL: 'http://env-host:9999',
            KK_MUSIC_DEFAULT_MODEL: 'clip',
            KK_MUSIC_DRY_RUN: '1',
        },
        configPath: join(dir, 'absent-config.yaml'),
    });
});

afterEach(() => {
    musicSeams.configPath = ORIGINAL.configPath;
    delete process.env.KK_CONFIG;
    rmSync(dir, { recursive: true, force: true });
});

/** Run a mapping with the stderr/stdout seam captured; return the thrown error. */
function capturedFailure(run: () => void): { error: unknown; out: string; err: string } {
    const capture = captureOutput();
    try {
        run();
        throw new Error('musicFailure returned instead of throwing');
    } catch (error) {
        return { error, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

describe('musicFailure — the exit contract', () => {
    it('an unreachable instance is one line on exit 1 naming baseUrl, the env key and the config file', () => {
        const error = new InstanceError({
            kind: 'connect',
            detail: 'refused every connection',
            endpoint: 'http://x.invalid/api/generations',
            attempts: 3,
            elapsedMs: 12,
            remediation: 'start the instance',
        });

        const {
            error: thrown,
            out,
            err,
        } = capturedFailure(() => {
            musicFailure('library', error, configPath);
        });

        expect(thrown).toBeInstanceOf(CommanderError);
        const commanderError = thrown as CommanderError;
        expect({ exitCode: commanderError.exitCode, code: commanderError.code }).toEqual({
            exitCode: 1,
            code: 'kk.music.unreachable',
        });
        // One line, and only on stderr: the remediation is the whole message.
        expect(err.trimEnd().split('\n')).toHaveLength(1);
        expect(out).toBe('');
        expect(commanderError.message).toContain('music.baseUrl');
        expect(commanderError.message).toContain('KK_MUSIC_INSTANCE_URL');
        expect(commanderError.message).toContain(error.endpoint);
        expect(commanderError.message).toContain(configPath);
        expect(commanderError.message).toContain('nothing was billed');
    });

    it('any other instance failure is one line on exit 1, verb-scoped, never multi-line', () => {
        const error = new InstanceError({
            kind: 'terminal',
            detail: 'answered 400',
            endpoint: 'http://127.0.0.1:3000/api/lyria/generate',
            attempts: 1,
            elapsedMs: 4,
            status: 400,
            instanceMessage: 'bad prompt\nsecond line',
            remediation: 'fix the brief',
        });

        const { error: thrown, err } = capturedFailure(() => {
            musicFailure('gen', error, configPath);
        });

        const commanderError = thrown as CommanderError;
        expect(commanderError.exitCode).toBe(1);
        expect(commanderError.code).toBe('kk.music.gen.instance');
        expect(err.trimEnd().split('\n')).toHaveLength(1);
    });

    it('a config error exits 2, names the dotted key and appends the config file', () => {
        const error = new MusicConfigError('music.takesCap', 'must be 1..4, got 5');

        const { error: thrown, err } = capturedFailure(() => {
            musicFailure('presets', error, configPath);
        });

        const commanderError = thrown as CommanderError;
        expect(commanderError.exitCode).toBe(2);
        expect(commanderError.code).toBe('kk.music.presets.config');
        expect(commanderError.message).toContain('music.takesCap');
        expect(commanderError.message).toContain(`(config: ${configPath})`);
        expect(err.trimEnd().split('\n')).toHaveLength(1);
    });

    it('passes a CommanderError straight through, so a verb never re-wraps its own refusal', () => {
        const original = new CommanderError(3, 'kk.music.gen.refused', 'refusing without --yes');

        const { error: thrown } = capturedFailure(() => {
            musicFailure('gen', original, configPath);
        });

        expect(thrown).toBe(original);
    });

    it('honours an error exitCode and collapses a multi-line message to its first line', () => {
        const error = Object.assign(new Error('first line\nstack-ish detail'), { exitCode: 4 });

        const { error: thrown } = capturedFailure(() => {
            musicFailure('master', error, configPath);
        });

        const commanderError = thrown as CommanderError;
        expect(commanderError.exitCode).toBe(4);
        expect(commanderError.code).toBe('kk.music.master.failed');
        expect(commanderError.message).toBe('first line');
    });
});

describe('writeConfigReport — the --verbose layer report', () => {
    it('prints every key with the layer that won', () => {
        const capture = captureOutput();
        try {
            writeConfigReport(config, configPath);
        } finally {
            capture.restore();
        }
        const lines = capture.read().trimEnd().split('\n');

        expect(lines).toEqual([
            `music.config = ${configPath}`,
            'music.baseUrl = http://env-host:9999 (env)',
            `music.timeoutMs = ${String(DEFAULT_GENERATE_TIMEOUT_MS)} (default)`,
            `music.connectTimeoutMs = ${String(DEFAULT_CONNECT_TIMEOUT_MS)} (default)`,
            'music.defaultModel = clip (env)',
            `music.takesCap = ${String(DEFAULT_TAKES_CAP)} (default)`,
            `music.prices = pro ${String(DEFAULT_MUSIC_PRICES.pro)} / clip ${String(DEFAULT_MUSIC_PRICES.clip)} / analyze unpriced (default)`,
            'music.dryRun = true (env)',
        ]);
    });
});

describe('isVerbose — the program-level flag', () => {
    it('is false when the flag is absent', () => {
        const program = new Command('kk');
        program.option('--verbose');
        const child = program.command('music');
        let seen: boolean | undefined;
        child.action(() => {
            seen = isVerbose(child);
        });

        program.parse(['node', 'test', 'music']);

        expect(seen).toBe(false);
    });

    it('reads the flag through the nesting level a verb sits at', () => {
        const program = new Command('kk');
        program.option('--verbose');
        const child = program.command('music');
        let seen: boolean | undefined;
        child.action(() => {
            seen = isVerbose(child);
        });

        program.parse(['node', 'test', '--verbose', 'music']);

        expect(seen).toBe(true);
    });
});

describe('musicSeams — the production seams', () => {
    it('resolves the config path from KK_CONFIG, so --verbose names the file actually read', () => {
        process.env.KK_CONFIG = configPath;
        expect(musicSeams.configPath()).toBe(configPath);
    });

    it('ships a node-backed FileSystem that round-trips a file', async () => {
        const path = join(dir, 'probe.txt');
        await musicSeams.fileSystem.writeFile(path, 'brief');
        expect(await musicSeams.fileSystem.readFile(path)).toBe('brief');
        expect(await musicSeams.fileSystem.exists(path)).toBe(true);
        await musicSeams.fileSystem.deleteFile(path);
        expect(await musicSeams.fileSystem.exists(path)).toBe(false);
    });
});
