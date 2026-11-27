import type { HookWindow } from './layout';
import type { RunProcess } from './process';

/**
 * Teaser extraction: `ffprobe` for the real episode length, then one `ffmpeg` cut with fades.
 * Both argv builders are pure so the fast tier can assert them without spawning (AC3).
 */

/** Fade lengths keep the cut from starting/ending on a hard transient. */
export const FADE_IN_SEC = 0.4;
export const FADE_OUT_SEC = 0.5;

/** `ffprobe` reads one header: a minute is generous, and a hang must not stall the episode. */
export const PROBE_TIMEOUT_MS = 60_000;
/** One audio slice is a local encode measured in seconds; the bound only catches a hang. */
export const SLICE_TIMEOUT_MS = 900_000;

/** `ffprobe` argv that prints only the container duration in seconds. */
export function buildProbeArgv(audioPath: string): string[] {
    return [
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath,
    ];
}

/** Parse `ffprobe` duration output; a non-numeric or non-positive value is a hard input defect. */
export function parseProbeDuration(stdout: string): number {
    const value = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
            `video-gen: ffprobe reported no usable duration for the episode audio (got "${stdout.trim()}")`,
        );
    }
    return value;
}

/** Measure the episode audio length in seconds. */
export async function probeAudioDuration(audioPath: string, runProcess: RunProcess): Promise<number> {
    const result = await runProcess(buildProbeArgv(audioPath), { timeoutMs: PROBE_TIMEOUT_MS });
    if (result.code !== 0) {
        throw new Error(`video-gen: ffprobe failed on ${audioPath}: ${result.stderr.trim() || `exit ${result.code}`}`);
    }
    return parseProbeDuration(result.stdout);
}

/** `ffmpeg` argv that writes the teaser window as 44.1kHz stereo PCM WAV with fades. */
export function buildSliceArgv(audioPath: string, outputPath: string, window: HookWindow): string[] {
    const durationSec = window.endSec - window.startSec;
    const fadeOutStart = Math.max(durationSec - FADE_OUT_SEC, 0);
    const filters = [
        `afade=t=in:st=0:d=${FADE_IN_SEC}`,
        `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_OUT_SEC}`,
    ].join(',');
    return [
        'ffmpeg',
        '-y',
        '-nostdin',
        '-loglevel',
        'error',
        '-ss',
        String(window.startSec),
        '-t',
        String(durationSec),
        '-i',
        audioPath,
        '-af',
        filters,
        '-ar',
        '44100',
        '-ac',
        '2',
        '-c:a',
        'pcm_s16le',
        outputPath,
    ];
}

/**
 * Cut the teaser audio. The caller has already validated the window, so a nonzero `ffmpeg` exit is
 * a real encode failure and is reported with its stderr.
 */
export async function sliceHookAudio(args: {
    audioPath: string;
    outputPath: string;
    window: HookWindow;
    runProcess: RunProcess;
}): Promise<void> {
    const result = await args.runProcess(buildSliceArgv(args.audioPath, args.outputPath, args.window), {
        timeoutMs: SLICE_TIMEOUT_MS,
    });
    if (result.code !== 0) {
        throw new Error(
            `video-gen: ffmpeg failed to slice the teaser from ${args.audioPath}: ${result.stderr.trim() || `exit ${result.code}`}`,
        );
    }
}
