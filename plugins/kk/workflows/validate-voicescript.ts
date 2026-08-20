#!/usr/bin/env bun
/**
 * Runtime VoiceScript checker for kk-solo-podcast.
 *
 * Copied with the workflow YAML into $KK_WORKFLOWS_DIR (default
 * ~/.config/kk/workflows). Node/Bun builtins only — no @gobing-ai/* and no
 * relative imports into generations/voice-gen (those paths do not exist next
 * to the runtime copy).
 *
 * SYNC: plugins/generations/voice-gen/src/voicescript.ts (validateVoiceScript
 * + engine/language enums + text/instruct/chunk/crossfade caps). Keep error
 * substrings stable — apps/cli/tests/validate-voicescript.test.ts matches them.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const VOICEBOX_TEXT_MAX = 50_000;
const VOICEBOX_INSTRUCT_MAX = 500;
const VOICEBOX_CHUNK_CHARS_MIN = 100;
const VOICEBOX_CHUNK_CHARS_MAX = 5_000;
const VOICEBOX_CROSSFADE_MS_MIN = 0;
const VOICEBOX_CROSSFADE_MS_MAX = 500;

const VOICEBOX_ENGINES = [
    'qwen',
    'qwen_custom_voice',
    'luxtts',
    'chatterbox',
    'chatterbox_turbo',
    'tada',
    'kokoro',
] as const;

const VOICEBOX_LANGUAGES = [
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

const ENGINE_SET = new Set<string>(VOICEBOX_ENGINES);
const LANGUAGE_SET = new Set<string>(VOICEBOX_LANGUAGES);

interface VoiceSpeaker {
    profile: string;
    engine?: string;
    language?: string;
    instruct?: string;
}

interface VoiceSegment {
    speaker?: string;
    profile?: string;
    text: string;
    instruct?: string;
    engine?: string;
    language?: string;
    gap_ms?: number;
    max_chunk_chars?: number;
    crossfade_ms?: number;
}

interface VoiceScript {
    default_engine?: string;
    language?: string;
    speakers?: Record<string, VoiceSpeaker>;
    segments: VoiceSegment[];
    max_chunk_chars?: number;
    crossfade_ms?: number;
}

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

function assertChunk(value: number | undefined): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isInteger(value) || value < VOICEBOX_CHUNK_CHARS_MIN || value > VOICEBOX_CHUNK_CHARS_MAX) {
        throw new Error(`max_chunk_chars must be between ${VOICEBOX_CHUNK_CHARS_MIN} and ${VOICEBOX_CHUNK_CHARS_MAX}`);
    }
}

function assertCrossfade(value: number | undefined): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isInteger(value) || value < VOICEBOX_CROSSFADE_MS_MIN || value > VOICEBOX_CROSSFADE_MS_MAX) {
        throw new Error(`crossfade_ms must be between ${VOICEBOX_CROSSFADE_MS_MIN} and ${VOICEBOX_CROSSFADE_MS_MAX}`);
    }
}

function validateVoiceScript(script: VoiceScript): void {
    if (!script || typeof script !== 'object') {
        throw new Error('VoiceScript must be an object');
    }
    if (!Array.isArray(script.segments) || script.segments.length === 0) {
        throw new Error('VoiceScript must have a non-empty segments array');
    }
    assertChunk(script.max_chunk_chars);
    assertCrossfade(script.crossfade_ms);
    assertEngine(script.default_engine, 'VoiceScript default_engine');
    assertLanguage(script.language, 'VoiceScript');

    if (script.speakers) {
        for (const [name, speaker] of Object.entries(script.speakers)) {
            if (!speaker || typeof speaker !== 'object') {
                throw new Error(`Speaker "${name}" definition must be an object`);
            }
            if (!speaker.profile || typeof speaker.profile !== 'string') {
                throw new Error(`Speaker "${name}" must have a profile specified`);
            }
            if (typeof speaker.instruct === 'string' && speaker.instruct.length > VOICEBOX_INSTRUCT_MAX) {
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
        if (typeof segment.instruct === 'string' && segment.instruct.length > VOICEBOX_INSTRUCT_MAX) {
            throw new Error(`Segment instruct exceeds 500 characters (${segment.instruct.length} chars)`);
        }
        if (segment.speaker && (!script.speakers || !(segment.speaker in script.speakers))) {
            throw new Error(`Unknown speaker: "${segment.speaker}"`);
        }
        assertChunk(segment.max_chunk_chars);
        assertCrossfade(segment.crossfade_ms);
        if (segment.gap_ms !== undefined && (typeof segment.gap_ms !== 'number' || segment.gap_ms < 0)) {
            throw new Error('gap_ms must be non-negative');
        }
        assertEngine(segment.engine, `Segment at index ${idx}`);
        assertLanguage(segment.language, `Segment at index ${idx}`);
    }
}

function main(): void {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: { in: { type: 'string' } },
        strict: false,
    });

    const inPath = values.in;
    if (!inPath) {
        console.error('missing required --in <path>');
        process.exit(1);
    }

    let raw: string;
    try {
        raw = readFileSync(inPath, 'utf-8');
    } catch (err) {
        console.error(`unreadable input file: ${inPath} (${err instanceof Error ? err.message : String(err)})`);
        process.exit(1);
    }

    const trimmed = raw.trim();
    if (trimmed === '') {
        console.error(`input file is empty: ${inPath}`);
        process.exit(1);
    }

    let parsed: unknown;
    try {
        parsed = trimmed.startsWith('{') ? JSON.parse(trimmed) : Bun.YAML.parse(trimmed);
    } catch (err) {
        console.error(`failed to parse VoiceScript: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        console.error('VoiceScript root must be an object');
        process.exit(1);
    }

    try {
        validateVoiceScript(parsed as VoiceScript);
    } catch (err) {
        console.error(`VoiceScript validation failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

main();
