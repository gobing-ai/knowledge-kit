import type { Doc } from '@gobing-ai/kk-core';
import type { EffectConfig } from './voicebox-client';

export const VOICEBOX_TEXT_MAX = 50_000;
export const VOICEBOX_INSTRUCT_MAX = 500;
export const VOICEBOX_CHUNK_CHARS_MIN = 100;
export const VOICEBOX_CHUNK_CHARS_MAX = 5_000;
export const VOICEBOX_CHUNK_CHARS_DEFAULT = 800;
export const VOICEBOX_CROSSFADE_MS_MIN = 0;
export const VOICEBOX_CROSSFADE_MS_MAX = 500;
export const VOICEBOX_CROSSFADE_MS_DEFAULT = 50;

export const VOICEBOX_ENGINES = [
    'qwen',
    'qwen_custom_voice',
    'luxtts',
    'chatterbox',
    'chatterbox_turbo',
    'tada',
    'kokoro',
] as const;

export const VOICEBOX_LANGUAGES = [
    'zh',
    'en',
    'ja',
    'ko',
    'de',
    'fr',
    'ru',
    'pt',
    'es',
    'it',
    'he',
    'ar',
    'da',
    'el',
    'fi',
    'hi',
    'ms',
    'nl',
    'no',
    'pl',
    'sv',
    'sw',
    'tr',
] as const;

export const BUILTIN_EFFECT_PRESETS: Record<string, EffectConfig[]> = {
    robotic: [
        {
            type: 'chorus',
            enabled: true,
            params: { rate_hz: 0.2, depth: 1.0, feedback: 0.35, centre_delay_ms: 7.0, mix: 0.5 },
        },
    ],
    radio: [
        { type: 'highpass', enabled: true, params: { cutoff_frequency_hz: 300.0 } },
        { type: 'lowpass', enabled: true, params: { cutoff_frequency_hz: 3500.0 } },
        {
            type: 'compressor',
            enabled: true,
            params: { threshold_db: -15.0, ratio: 6.0, attack_ms: 5.0, release_ms: 50.0 },
        },
        { type: 'gain', enabled: true, params: { gain_db: 6.0 } },
    ],
    'echo chamber': [
        {
            type: 'reverb',
            enabled: true,
            params: { room_size: 0.85, damping: 0.3, wet_level: 0.45, dry_level: 0.55, width: 1.0 },
        },
        { type: 'delay', enabled: true, params: { delay_seconds: 0.25, feedback: 0.3, mix: 0.2 } },
    ],
    'deep voice': [
        { type: 'pitch_shift', enabled: true, params: { semitones: -3.0 } },
        { type: 'lowpass', enabled: true, params: { cutoff_frequency_hz: 6000.0 } },
        {
            type: 'compressor',
            enabled: true,
            params: { threshold_db: -18.0, ratio: 3.0, attack_ms: 10.0, release_ms: 150.0 },
        },
    ],
};

const ENGINE_SET = new Set<string>(VOICEBOX_ENGINES);
const LANGUAGE_SET = new Set<string>(VOICEBOX_LANGUAGES);

function assertEngine(value: string | undefined, label: string): void {
    if (value !== undefined && !ENGINE_SET.has(value)) {
        throw new Error(`${label} engine must be one of ${VOICEBOX_ENGINES.join('|')} (got "${value}")`);
    }
}

function assertLanguage(value: string | undefined, label: string): void {
    if (value !== undefined && !LANGUAGE_SET.has(value)) {
        throw new Error(`${label} language must be a Voicebox language code (got "${value}")`);
    }
}

export function resolveEffectsChain(customChain?: EffectConfig[], presetName?: string): EffectConfig[] | undefined {
    if (customChain && customChain.length > 0) {
        return customChain;
    }
    if (presetName) {
        const normalized = presetName.trim().toLowerCase();
        const preset = BUILTIN_EFFECT_PRESETS[normalized];
        if (preset) {
            return preset;
        }
    }
    return undefined;
}

export function resolveInstruct(instruct?: string, emotion?: string): string | undefined {
    if (instruct && emotion) {
        const lower = instruct.toLowerCase();
        if (lower.includes(emotion.toLowerCase())) {
            return instruct;
        }
        return `${instruct}. Emotion: ${emotion}`;
    }
    if (instruct) {
        return instruct;
    }
    if (emotion) {
        return `Speak in a ${emotion} tone.`;
    }
    return undefined;
}

export interface VoiceSpeaker {
    profile?: string;
    profile_id?: string;
    name?: string;
    role?: string;
    engine?: string;
    language?: string;
    emotion?: string;
    instruct?: string;
    effects_chain?: EffectConfig[];
    effect_preset?: string;
    personality?: boolean;
}

export interface VoiceSegment {
    speaker?: string;
    profile?: string;
    profile_id?: string;
    text: string;
    emotion?: string;
    instruct?: string;
    engine?: string;
    language?: string;
    gap_ms?: number;
    max_chunk_chars?: number;
    crossfade_ms?: number;
    personality?: boolean;
    seed?: number;
    effects_chain?: EffectConfig[];
    effect_preset?: string;
}

export interface VoiceScript {
    title?: string;
    language?: string;
    default_engine?: string;
    default_profile?: string;
    default_profile_id?: string;
    default_emotion?: string;
    default_effects_chain?: EffectConfig[];
    default_effect_preset?: string;
    max_chunk_chars?: number;
    crossfade_ms?: number;
    speakers?: Record<string, VoiceSpeaker>;
    segments: VoiceSegment[];
}

const VOICESCRIPT_KEYS = new Set([
    'segments',
    'speakers',
    'default_profile',
    'default_profile_id',
    'default_engine',
    'default_emotion',
    'default_effects_chain',
    'default_effect_preset',
]);

/**
 * Parse a Doc into a VoiceScript structure.
 * - JSON object starting with '{' -> VoiceScript path (even without segments -> validation fails loud).
 * - Body starting with '[' -> Plain text path (e.g. Chatterbox [laugh] tag).
 * - YAML mapping with any of segments/speakers/default_profile/default_engine -> VoiceScript path.
 * - Otherwise -> Plain text single-segment script.
 */
export function parseDocToVoiceScript(doc: Doc, envDefaultProfile?: string): VoiceScript {
    const trimmed = (doc.body || '').trim();

    if (trimmed.startsWith('{')) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            try {
                parsed = Bun.YAML.parse(trimmed);
            } catch {
                throw new Error('Invalid VoiceScript JSON structure: failed to parse JSON object');
            }
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Invalid VoiceScript JSON structure: root must be a JSON object');
        }
        return parsed as VoiceScript;
    }

    if (trimmed.startsWith('[') && !trimmed.startsWith('[-')) {
        // Plain text starting with paralinguistic tag e.g. [laugh] or [sigh]
        const hasYamlStructure = trimmed.includes('segments:') || trimmed.includes('speakers:');
        if (!hasYamlStructure) {
            return {
                segments: [{ text: trimmed }],
                default_profile:
                    envDefaultProfile ??
                    (typeof doc.metadata?.voiceProfile === 'string' ? doc.metadata.voiceProfile : undefined),
            };
        }
    }

    try {
        const parsed = Bun.YAML.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const hasKey = Object.keys(parsed).some((k) => VOICESCRIPT_KEYS.has(k));
            if (hasKey) {
                return parsed as VoiceScript;
            }
        }
    } catch {
        // Fall through to plain text
    }

    return {
        segments: [{ text: trimmed }],
        default_profile:
            envDefaultProfile ??
            (typeof doc.metadata?.voiceProfile === 'string' ? doc.metadata.voiceProfile : undefined),
    };
}

/**
 * Merge multiple Doc-level VoiceScripts into a single combined VoiceScript.
 */
export function mergeVoiceScripts(scripts: VoiceScript[], docs: Doc[], envDefaultProfile?: string): VoiceScript {
    if (scripts.length === 0) {
        return { segments: [] };
    }
    const firstScript = scripts[0];
    if (scripts.length === 1 && firstScript) {
        return firstScript;
    }

    const combinedSpeakers: Record<string, VoiceSpeaker> = {};
    const combinedSegments: VoiceSegment[] = [];

    let title: string | undefined;
    let defaultProfile: string | undefined = envDefaultProfile;
    let defaultProfileId: string | undefined;
    let defaultEngine: string | undefined;
    let defaultEmotion: string | undefined;
    let defaultEffectsChain: EffectConfig[] | undefined;
    let defaultEffectPreset: string | undefined;
    let language: string | undefined;
    let maxChunkChars: number | undefined;
    let crossfadeMs: number | undefined;

    for (let i = 0; i < scripts.length; i++) {
        const script = scripts[i];
        if (!script) {
            continue;
        }
        const doc = docs[i];

        if (!title) {
            title = script.title || doc?.title;
        }
        if (script.default_profile && defaultProfile === envDefaultProfile) {
            defaultProfile = script.default_profile;
        }
        if (script.default_profile_id && !defaultProfileId) {
            defaultProfileId = script.default_profile_id;
        }
        if (!defaultProfile && typeof doc?.metadata?.voiceProfile === 'string') {
            defaultProfile = doc.metadata.voiceProfile;
        }
        if (!defaultEngine && script.default_engine) {
            defaultEngine = script.default_engine;
        }
        if (!defaultEmotion && script.default_emotion) {
            defaultEmotion = script.default_emotion;
        }
        if (!defaultEffectsChain && script.default_effects_chain) {
            defaultEffectsChain = script.default_effects_chain;
        }
        if (!defaultEffectPreset && script.default_effect_preset) {
            defaultEffectPreset = script.default_effect_preset;
        }
        if (!language && script.language) {
            language = script.language;
        }
        if (maxChunkChars === undefined && script.max_chunk_chars !== undefined) {
            maxChunkChars = script.max_chunk_chars;
        }
        if (crossfadeMs === undefined && script.crossfade_ms !== undefined) {
            crossfadeMs = script.crossfade_ms;
        }

        if (script.speakers) {
            for (const [key, speaker] of Object.entries(script.speakers)) {
                if (key in combinedSpeakers) {
                    throw new Error(`Duplicate speaker key across documents: "${key}"`);
                }
                combinedSpeakers[key] = speaker;
            }
        }

        if (Array.isArray(script.segments)) {
            combinedSegments.push(...script.segments);
        }
    }

    const result: VoiceScript = {
        title: title || docs[0]?.title || 'Generated voice',
        segments: combinedSegments,
    };

    if (Object.keys(combinedSpeakers).length > 0) {
        result.speakers = combinedSpeakers;
    }
    if (defaultProfile) {
        result.default_profile = defaultProfile;
    }
    if (defaultProfileId) {
        result.default_profile_id = defaultProfileId;
    }
    if (defaultEngine) {
        result.default_engine = defaultEngine;
    }
    if (defaultEmotion) {
        result.default_emotion = defaultEmotion;
    }
    if (defaultEffectsChain) {
        result.default_effects_chain = defaultEffectsChain;
    }
    if (defaultEffectPreset) {
        result.default_effect_preset = defaultEffectPreset;
    }
    if (language) {
        result.language = language;
    }
    if (maxChunkChars !== undefined) {
        result.max_chunk_chars = maxChunkChars;
    }
    if (crossfadeMs !== undefined) {
        result.crossfade_ms = crossfadeMs;
    }

    return result;
}

/**
 * Validate that a VoiceScript satisfies all Voicebox and plugin constraints.
 */
export function validateVoiceScript(script: VoiceScript): void {
    if (!script || typeof script !== 'object') {
        throw new Error('VoiceScript must be an object');
    }

    if (!Array.isArray(script.segments) || script.segments.length === 0) {
        throw new Error('VoiceScript must have a non-empty segments array');
    }

    if (script.max_chunk_chars !== undefined) {
        if (
            typeof script.max_chunk_chars !== 'number' ||
            !Number.isInteger(script.max_chunk_chars) ||
            script.max_chunk_chars < VOICEBOX_CHUNK_CHARS_MIN ||
            script.max_chunk_chars > VOICEBOX_CHUNK_CHARS_MAX
        ) {
            throw new Error(
                `max_chunk_chars must be between ${VOICEBOX_CHUNK_CHARS_MIN} and ${VOICEBOX_CHUNK_CHARS_MAX}`,
            );
        }
    }

    if (script.crossfade_ms !== undefined) {
        if (
            typeof script.crossfade_ms !== 'number' ||
            !Number.isInteger(script.crossfade_ms) ||
            script.crossfade_ms < VOICEBOX_CROSSFADE_MS_MIN ||
            script.crossfade_ms > VOICEBOX_CROSSFADE_MS_MAX
        ) {
            throw new Error(
                `crossfade_ms must be between ${VOICEBOX_CROSSFADE_MS_MIN} and ${VOICEBOX_CROSSFADE_MS_MAX}`,
            );
        }
    }

    assertEngine(script.default_engine, 'VoiceScript default_engine');
    assertLanguage(script.language, 'VoiceScript');

    if (script.speakers) {
        for (const [name, speaker] of Object.entries(script.speakers)) {
            if (!speaker || typeof speaker !== 'object') {
                throw new Error(`Speaker "${name}" definition must be an object`);
            }
            if (!speaker.profile && !speaker.profile_id) {
                throw new Error(`Speaker "${name}" must have a profile or profile_id specified`);
            }
            if (
                speaker.instruct &&
                typeof speaker.instruct === 'string' &&
                speaker.instruct.length > VOICEBOX_INSTRUCT_MAX
            ) {
                throw new Error(`Speaker "${name}" instruct exceeds 500 characters (${speaker.instruct.length} chars)`);
            }
            assertEngine(speaker.engine, `Speaker "${name}"`);
            assertLanguage(speaker.language, `Speaker "${name}"`);
        }
    }

    for (let idx = 0; idx < script.segments.length; idx++) {
        const segment = script.segments[idx];
        if (!segment || typeof segment !== 'object') {
            throw new Error(`Segment at index ${idx} must be an object`);
        }

        if (typeof segment.text !== 'string' || segment.text.length === 0) {
            throw new Error(`Segment at index ${idx} text must not be empty`);
        }

        if (segment.text.length > VOICEBOX_TEXT_MAX) {
            throw new Error(
                `Segment text exceeds the 50,000-character Voicebox /generate cap (${segment.text.length} chars)`,
            );
        }

        if (
            segment.instruct &&
            typeof segment.instruct === 'string' &&
            segment.instruct.length > VOICEBOX_INSTRUCT_MAX
        ) {
            throw new Error(`Segment instruct exceeds 500 characters (${segment.instruct.length} chars)`);
        }

        if (segment.speaker) {
            if (!script.speakers || !(segment.speaker in script.speakers)) {
                throw new Error(`Unknown speaker: "${segment.speaker}"`);
            }
        }

        if (segment.max_chunk_chars !== undefined) {
            if (
                typeof segment.max_chunk_chars !== 'number' ||
                !Number.isInteger(segment.max_chunk_chars) ||
                segment.max_chunk_chars < VOICEBOX_CHUNK_CHARS_MIN ||
                segment.max_chunk_chars > VOICEBOX_CHUNK_CHARS_MAX
            ) {
                throw new Error(
                    `max_chunk_chars must be between ${VOICEBOX_CHUNK_CHARS_MIN} and ${VOICEBOX_CHUNK_CHARS_MAX}`,
                );
            }
        }

        if (segment.crossfade_ms !== undefined) {
            if (
                typeof segment.crossfade_ms !== 'number' ||
                !Number.isInteger(segment.crossfade_ms) ||
                segment.crossfade_ms < VOICEBOX_CROSSFADE_MS_MIN ||
                segment.crossfade_ms > VOICEBOX_CROSSFADE_MS_MAX
            ) {
                throw new Error(
                    `crossfade_ms must be between ${VOICEBOX_CROSSFADE_MS_MIN} and ${VOICEBOX_CROSSFADE_MS_MAX}`,
                );
            }
        }

        if (segment.gap_ms !== undefined) {
            if (typeof segment.gap_ms !== 'number' || segment.gap_ms < 0) {
                throw new Error('gap_ms must be non-negative');
            }
        }

        if (segment.seed !== undefined) {
            if (typeof segment.seed !== 'number' || !Number.isInteger(segment.seed) || segment.seed < 0) {
                throw new Error('seed must be a non-negative integer');
            }
        }

        assertEngine(segment.engine, `Segment at index ${idx}`);
        assertLanguage(segment.language, `Segment at index ${idx}`);
    }
}
