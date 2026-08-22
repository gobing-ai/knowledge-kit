import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

const MP3_TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** True when the operator asked for a sibling MP3 (`VOICE_GEN_MP3=true|1|yes|on`). */
export function isMp3Requested(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.VOICE_GEN_MP3;
    if (raw === undefined || raw === '') {
        return false;
    }
    return MP3_TRUTHY.has(raw.trim().toLowerCase());
}

/** WAV → MP3. Injected in tests so CI does not need ffmpeg. */
export type Mp3Transcoder = (wavPath: string, mp3Path: string) => Promise<void>;

/**
 * Convert a workspace WAV to MP3 with ffmpeg + libmp3lame (VBR `-qscale:a 2`).
 * Fail-loud if ffmpeg is missing, exits non-zero, or writes no file.
 */
export async function transcodeWavToMp3(wavPath: string, mp3Path: string, ffmpegBin = 'ffmpeg'): Promise<void> {
    const fs = createNodeFileSystem();
    if (!(await fs.exists(wavPath))) {
        throw new Error(`ffmpeg mp3 transcode failed: WAV input not found: ${wavPath}`);
    }

    let proc: ReturnType<typeof Bun.spawnSync>;
    try {
        proc = Bun.spawnSync(
            [
                ffmpegBin,
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                wavPath,
                '-codec:a',
                'libmp3lame',
                '-qscale:a',
                '2',
                mp3Path,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        );
    } catch (err: unknown) {
        throw new Error(
            `ffmpeg is required for MP3 output (VOICE_GEN_MP3=true) but was not found on PATH (${err instanceof Error ? err.message : String(err)})`,
        );
    }

    if (proc.exitCode !== 0) {
        const detail = (proc.stderr?.toString() ?? '').trim() || (proc.stdout?.toString() ?? '').trim();
        if (proc.exitCode === null || /not found|ENOENT/i.test(detail)) {
            throw new Error(
                `ffmpeg is required for MP3 output (VOICE_GEN_MP3=true) but was not found on PATH${detail ? `: ${detail}` : ''}`,
            );
        }
        throw new Error(`ffmpeg mp3 transcode failed (exit ${proc.exitCode}): ${detail || 'no stderr'}`);
    }

    if (!(await fs.exists(mp3Path))) {
        throw new Error(`ffmpeg mp3 transcode produced no file: ${mp3Path}`);
    }
}
