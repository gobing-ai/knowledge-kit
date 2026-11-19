import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    BUILTIN_DELIVERY_PROFILES,
    DEFAULT_DELIVERY_PROFILE,
    DeliveryProfileError,
    definedDeliveryProfiles,
    resolveDeliveryProfile,
    validateDeliveryProfile,
} from '../src/audio/profile';
import { MusicConfigError, parseMusicConfigDocument, resolveMusicConfig } from '../src/config';

/**
 * AC5 — delivery targets are profiles, not constants (R5).
 *
 * `music.delivery.<name>` in the kk user config overrides the one built-in
 * (`streaming`) or defines a new profile; an unknown name fails listing the
 * defined ones.
 */

/** Write a config file into a throwaway dir; the caller removes the dir. */
function withConfigFile(yaml: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'kk-music-delivery-'));
    const path = join(dir, 'config.yaml');
    writeFileSync(path, yaml);
    return { dir, path };
}

describe('AC5 — one built-in profile, resolved from config', () => {
    test('streaming is -14 LUFS / -1 dBTP / wav / 44100 with no config at all', () => {
        expect(resolveDeliveryProfile('streaming')).toEqual({
            lufs: -14,
            truePeak: -1,
            container: 'wav',
            sampleRate: 44_100,
        });
        expect(BUILTIN_DELIVERY_PROFILES.streaming.lufs).toBe(-14);
        expect(DEFAULT_DELIVERY_PROFILE).toBe('streaming');
        expect(definedDeliveryProfiles()).toEqual(['streaming']);
    });

    test('a configured "channels" profile uses the configured values', () => {
        const config = { channels: { lufs: -16, truePeak: -1.5, container: 'mp3' as const, sampleRate: 48_000 } };
        expect(resolveDeliveryProfile('channels', config)).toEqual({
            lufs: -16,
            truePeak: -1.5,
            container: 'mp3',
            sampleRate: 48_000,
        });
    });

    test('a configured override of streaming wins field by field', () => {
        const profile = resolveDeliveryProfile('streaming', { streaming: { lufs: -16 } });
        expect(profile).toEqual({ lufs: -16, truePeak: -1, container: 'wav', sampleRate: 44_100 });
    });

    test('an unknown profile name fails listing every defined profile', () => {
        const config = { channels: { lufs: -16, truePeak: -1, container: 'wav' as const, sampleRate: 44_100 } };
        let caught: unknown;
        try {
            resolveDeliveryProfile('unknown', config);
        } catch (error: unknown) {
            caught = error;
        }
        const error = caught as DeliveryProfileError;
        expect(error).toBeInstanceOf(DeliveryProfileError);
        expect(error.exitCode).toBe(1);
        expect(error.profile).toBe('unknown');
        expect(error.defined).toEqual(['channels', 'streaming']);
        expect(error.message).toContain('streaming');
        expect(error.message).toContain('channels');
        expect(error.message).toContain('music.delivery.unknown');
    });

    test('an incomplete new profile fails instead of defaulting a channel target', () => {
        expect(() => resolveDeliveryProfile('channels', { channels: { lufs: -16 } })).toThrow(/truePeak/);
        expect(() => resolveDeliveryProfile('channels', { channels: { truePeak: -1 } })).toThrow(/lufs/);
        expect(() => resolveDeliveryProfile('channels', { channels: { lufs: -16, truePeak: -1 } })).toThrow(
            /container/,
        );
        expect(() =>
            resolveDeliveryProfile('channels', { channels: { lufs: -16, truePeak: -1, container: 'wav' } }),
        ).toThrow(/sampleRate/);
    });

    test('out-of-domain values are refused', () => {
        const base = { lufs: -16, truePeak: -1, container: 'wav', sampleRate: 44_100 };
        expect(() => validateDeliveryProfile('x', { ...base, truePeak: 3 })).toThrow(/above full scale/);
        expect(() => validateDeliveryProfile('x', { ...base, container: 'flac' })).toThrow(/not one of mp3, wav/);
        expect(() => validateDeliveryProfile('x', { ...base, sampleRate: 44_100.5 })).toThrow(/positive integer/);
        expect(() => validateDeliveryProfile('x', { ...base, lra: -1 })).toThrow(/non-negative/);
        expect(validateDeliveryProfile('x', { ...base, lra: 7 })).toEqual({ ...base, lra: 7 });
    });
});

describe('AC5 — music.delivery.<name> is read from the same music.* config tree', () => {
    test('a config document carries the delivery block through resolution', async () => {
        const { dir, path } = withConfigFile(`music:
  takesCap: 2
  delivery:
    streaming:
      lufs: -15
    channels:
      lufs: -16
      truePeak: -1.5
      container: wav
      sampleRate: 48000
      lra: 7
`);
        try {
            const config = await resolveMusicConfig({ env: {}, configPath: path });
            expect(config.sources.delivery).toBe('config');
            expect(config.delivery.streaming).toEqual({ lufs: -15 });
            expect(config.delivery.channels).toEqual({
                lufs: -16,
                truePeak: -1.5,
                container: 'wav',
                sampleRate: 48_000,
                lra: 7,
            });
            expect(resolveDeliveryProfile('streaming', config.delivery).lufs).toBe(-15);
            expect(resolveDeliveryProfile('channels', config.delivery).container).toBe('wav');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('no delivery block means only the built-in profile', async () => {
        const config = await resolveMusicConfig({ env: {}, configPath: join(tmpdir(), 'kk-music-absent.yaml') });
        expect(config.delivery).toEqual({});
        expect(config.sources.delivery).toBe('default');
        expect(() => resolveDeliveryProfile('channels', config.delivery)).toThrow(DeliveryProfileError);
    });

    test('a wrong-typed delivery key fails loudly, naming the exact key', () => {
        expect(() => parseMusicConfigDocument({ music: { delivery: 'streaming' } })).toThrow(MusicConfigError);
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: 14 } } })).toThrow(
            /music\.delivery\.streaming/,
        );
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: { lufs: 'loud' } } } })).toThrow(
            /music\.delivery\.streaming\.lufs/,
        );
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: { truePeak: 2 } } } })).toThrow(
            /at or below 0/,
        );
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: { container: 'flac' } } } })).toThrow(
            /music\.delivery\.streaming\.container/,
        );
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: { sampleRate: 44100.5 } } } })).toThrow(
            /positive integer sample rate/,
        );
        expect(() => parseMusicConfigDocument({ music: { delivery: { streaming: { lra: -2 } } } })).toThrow(
            /non-negative loudness range/,
        );
        expect(parseMusicConfigDocument({ music: { delivery: { streaming: { lufs: -14 } } } })).toEqual({
            delivery: { streaming: { lufs: -14 } },
        });
    });
});
