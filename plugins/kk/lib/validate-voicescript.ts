#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type VoiceScript, validateVoiceScript } from '../../generations/voice-gen/src/voicescript';

function main(): void {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            in: { type: 'string' },
        },
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
        if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed);
        } else {
            parsed = Bun.YAML.parse(trimmed);
        }
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
