import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudioToolRunner, ToolOutput } from '../src/audio/measure';

/**
 * The captured-tool harness for the 0405 audio tests (R6/AC6).
 *
 * Every fixture under `tests/fixtures/audio/` is **real** ffmpeg 8.1.2 output,
 * captured once from a 34 s lavfi WAV (2 s of leading silence, 28 s of tone, 4 s
 * of trailing silence) and its mastered `streaming` output. The runner below
 * replays that text by argv shape, so no test spawns a tool and CI needs no
 * ffmpeg.
 */

const FIXTURES = join(import.meta.dir, 'fixtures', 'audio');

/** Read one captured fixture. */
export function fixtureText(name: string): string {
    return readFileSync(join(FIXTURES, name), 'utf8');
}

/** One captured banner, trimmed the way `ffmpeg -version` prints its first line. */
export const FFMPEG_VERSION_BANNER =
    'ffmpeg version 8.1.2 Copyright (c) 2000-2026 the FFmpeg developers\nbuilt with Apple clang version 21.0.0\n';
export const FFPROBE_VERSION_BANNER = 'ffprobe version 8.1.2 Copyright (c) 2007-2026 the FFmpeg developers\n';

/** What to replay. Every field defaults to the take fixtures. */
export interface CaptureOptions {
    /** `ffprobe` JSON; an array is consumed in order (take, then the mastered output). */
    probe?: string | string[];
    /** `loudnorm` analysis stderr; an array is consumed in order (pass 1, then the delivery measurement). */
    loudnorm?: string | string[];
    /** `silencedetect` stderr. */
    silence?: string;
    /** Override the `-version` banners. */
    ffmpegVersion?: string;
    ffprobeVersion?: string;
    /** Force a non-zero exit for every media call (a missing/broken ffmpeg). */
    exitCode?: number;
    /** Bytes the pass-2 (master) call writes to its output path; omitted = writes nothing. */
    masterBytes?: string;
}

/** A replayed runner plus every argv it was called with. */
export interface CapturedRunner {
    runner: AudioToolRunner;
    calls: string[][];
}

/** Turn a `string | string[]` capture into a queue that repeats its last entry. */
function queueOf(value: string | string[]): string[] {
    return Array.isArray(value) ? [...value] : [value];
}

/** Build the replaying runner (see {@link CaptureOptions}). */
export function capturedRunner(options: CaptureOptions = {}): CapturedRunner {
    const calls: string[][] = [];
    const probes = queueOf(options.probe ?? fixtureText('ffprobe-take.json'));
    const loudness = queueOf(options.loudnorm ?? fixtureText('loudnorm-take.txt'));
    const next = (entries: string[]): string =>
        entries.length > 1 ? (entries.shift() as string) : (entries[0] as string);

    const runner: AudioToolRunner = async (argv) => {
        calls.push([...argv]);
        const bin = argv[0] ?? '';
        if (argv.includes('-version')) {
            const stdout = bin.includes('probe')
                ? (options.ffprobeVersion ?? FFPROBE_VERSION_BANNER)
                : (options.ffmpegVersion ?? FFMPEG_VERSION_BANNER);
            return { exitCode: 0, stdout, stderr: '' };
        }
        const filterIndex = argv.indexOf('-af');
        const filter = filterIndex === -1 ? '' : (argv[filterIndex + 1] ?? '');
        const fail = options.exitCode ?? 0;
        if (filter.includes('silencedetect')) {
            return { exitCode: fail, stdout: '', stderr: options.silence ?? fixtureText('silencedetect-take.txt') };
        }
        if (filter.includes('loudnorm=print_format=json')) {
            return { exitCode: fail, stdout: '', stderr: next(loudness) };
        }
        if (filter.startsWith('loudnorm=')) {
            // Pass 2: the one call that writes audio.
            if (fail === 0 && options.masterBytes !== undefined) {
                const outputPath = argv[argv.length - 1];
                if (outputPath !== undefined) {
                    writeFileSync(outputPath, options.masterBytes);
                }
            }
            return { exitCode: fail, stdout: '', stderr: fixtureText('master-pass2.txt') };
        }
        return { exitCode: fail, stdout: next(probes), stderr: '' } satisfies ToolOutput;
    };

    return { runner, calls };
}

/** The argv of every call whose `-af` filter names `needle`. */
export function filtersNamed(calls: readonly string[][], needle: string): string[] {
    return calls
        .map((argv) => {
            const index = argv.indexOf('-af');
            return index === -1 ? '' : (argv[index + 1] ?? '');
        })
        .filter((filter) => filter.includes(needle));
}
