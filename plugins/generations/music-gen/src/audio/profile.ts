/**
 * Delivery profiles (task 0405 R5): the loudness/true-peak/container/sample-rate
 * target a mastered file is normalized to.
 *
 * **Profiles are config, not constants.** `music.delivery.<name>` in the kk user
 * config overrides a built-in or defines a new one, so a channel target can be
 * added without a code change. Exactly one built-in ships — `streaming`
 * (−14 LUFS, −1 dBTP, wav, 44100) — because no 小红书 / B站 / 视频号 number is
 * defended by a measured reference upload yet (see task 0404): inventing them
 * here would bake an unverified guess into every delivered file.
 */

import { AUDIO_FORMATS, type AudioFormat } from '../brief';

/** A resolved delivery target. */
export interface DeliveryProfile {
    /** Integrated loudness target in LUFS (`loudnorm=I=`). */
    lufs: number;
    /** True-peak ceiling in dBTP (`loudnorm=TP=`); measured on the encoded output (R4). */
    truePeak: number;
    /** Loudness range in LU (`loudnorm=LRA=`); omitted unless set, because forcing it invites dynamic mode. */
    lra?: number;
    /** Delivered container; also selects the codec and the artifact extension. */
    container: AudioFormat;
    /** Output sample rate (`-ar`), which is what guards against loudnorm's internal 192 kHz upsample (R3). */
    sampleRate: number;
}

/** What `music.delivery.<name>` may set: any subset of a profile. */
export type DeliveryProfileOverride = Partial<DeliveryProfile>;

/** Profile name → what the user config declares for it. */
export type DeliveryProfileConfig = Record<string, DeliveryProfileOverride>;

/** The one built-in profile (R5): the default for a streaming/digital delivery. */
export const BUILTIN_DELIVERY_PROFILES: Readonly<Record<string, DeliveryProfile>> = {
    streaming: { lufs: -14, truePeak: -1, container: 'wav', sampleRate: 44_100 },
};

/** Profile used when a caller does not name one. */
export const DEFAULT_DELIVERY_PROFILE = 'streaming';

/** Integrated-loudness tolerance the delivery check allows around the profile target (R4). */
export const DELIVERY_LOUDNESS_TOLERANCE_LU = 1;

/** Raised for an unknown profile name, an incomplete definition or an out-of-domain value. */
export class DeliveryProfileError extends Error {
    /** Process exit code the command layer surfaces. */
    readonly exitCode = 1;
    /** The profile name the caller asked for (or the definition key at fault). */
    readonly profile: string;
    /** Every profile that *is* defined, so the message can list them (R5). */
    readonly defined: string[];

    constructor(profile: string, message: string, defined: readonly string[]) {
        const list = [...defined].sort();
        super(`music delivery profile "${profile}": ${message} — defined profiles: ${list.join(', ')}`);
        this.name = 'DeliveryProfileError';
        this.profile = profile;
        this.defined = list;
    }
}

/** Every profile name that resolves: built-ins plus the configured ones. */
export function definedDeliveryProfiles(config: DeliveryProfileConfig = {}): string[] {
    return [...new Set([...Object.keys(BUILTIN_DELIVERY_PROFILES), ...Object.keys(config)])].sort();
}

/**
 * Validate one profile against its domain. Applies to the merged result, so an
 * override cannot smuggle in an impossible target, and a partial definition of a
 * new profile is reported as missing rather than defaulted (a defaulted channel
 * target would be a guess, which R5 forbids).
 */
export function validateDeliveryProfile(name: string, value: Record<string, unknown>): DeliveryProfile {
    const defined = Object.keys(BUILTIN_DELIVERY_PROFILES);
    const fail = (message: string): never => {
        throw new DeliveryProfileError(name, message, defined);
    };
    const lufs = value.lufs;
    if (typeof lufs !== 'number' || !Number.isFinite(lufs)) {
        fail('lufs must be a finite number of LUFS (set `lufs`)');
    }
    const truePeak = value.truePeak;
    if (typeof truePeak !== 'number' || !Number.isFinite(truePeak)) {
        fail('truePeak must be a finite number of dBTP (set `truePeak`)');
    }
    if ((truePeak as number) > 0) {
        fail(`truePeak ${String(truePeak)} dBTP is above full scale; a ceiling is 0 dBTP or lower`);
    }
    const container = value.container;
    if (typeof container !== 'string' || !(AUDIO_FORMATS as readonly string[]).includes(container)) {
        fail(`container ${JSON.stringify(container)} is not one of ${AUDIO_FORMATS.join(', ')}`);
    }
    const sampleRate = value.sampleRate;
    if (typeof sampleRate !== 'number' || !Number.isInteger(sampleRate) || sampleRate <= 0) {
        fail(`sampleRate ${JSON.stringify(sampleRate)} must be a positive integer number of Hz`);
    }
    const lra = value.lra;
    if (lra !== undefined && (typeof lra !== 'number' || !Number.isFinite(lra) || lra < 0)) {
        fail('lra must be a non-negative finite number of LU when set');
    }
    return {
        lufs: lufs as number,
        truePeak: truePeak as number,
        container: container as AudioFormat,
        sampleRate: sampleRate as number,
        ...(typeof lra === 'number' ? { lra } : {}),
    };
}

/**
 * Resolve a profile name against the built-ins and the user config (R5).
 *
 * `music.delivery.streaming` overrides field by field; any other name must be
 * defined completely in config. An unknown name throws
 * {@link DeliveryProfileError} listing every defined profile.
 */
export function resolveDeliveryProfile(name: string, config: DeliveryProfileConfig = {}): DeliveryProfile {
    const defined = definedDeliveryProfiles(config);
    const builtin = BUILTIN_DELIVERY_PROFILES[name];
    const override = config[name];
    if (builtin === undefined && override === undefined) {
        throw new DeliveryProfileError(
            name,
            `no such profile (pass one of the defined profiles, or define music.delivery.${name})`,
            defined,
        );
    }
    return validateDeliveryProfile(name, { ...(builtin ?? {}), ...(override ?? {}) });
}
