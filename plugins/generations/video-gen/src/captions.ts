import { join } from 'node:path';
import type { WordTimestamp } from './layout';
import type { RunProcess } from './process';

/**
 * Word-level captions from a locked `faster-whisper` worker. The worker is a private uv project
 * (`pyproject.toml` + `uv.lock`) so the model stack never enters the Bun dependency graph.
 */

/** Default whisper model size: `small` transcribes a 60s ZH clip in seconds on CPU. */
export const DEFAULT_ALIGN_MODEL = 'small';

/** Worker deadline: a cold model load plus a 60s CPU transcription fits well inside 15 minutes. */
export const ALIGN_TIMEOUT_MS = 900_000;

/** Locked uv argv that runs the worker out of this plugin's own project (mirrors the voice worker). */
export function resolveAlignCommand(pluginRoot: string): string[] {
    return [
        'uv',
        'run',
        '--project',
        pluginRoot,
        '--locked',
        '--no-dev',
        'python',
        join(pluginRoot, 'python', 'align_captions.py'),
    ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/**
 * Validate the worker's `{ words: [{ word, startSec, endSec }] }` payload. A malformed or empty
 * payload is unusable as a caption track, so it fails rather than rendering a caption-free video.
 */
export function parseWordsPayload(raw: unknown): WordTimestamp[] {
    const words = asRecord(raw)?.words;
    if (!Array.isArray(words) || words.length === 0) {
        throw new Error('video-gen: caption worker returned no words (unusable caption track)');
    }
    const parsed: WordTimestamp[] = [];
    for (const entry of words) {
        const record = asRecord(entry);
        const word = typeof record?.word === 'string' ? record.word : undefined;
        const startSec = record?.startSec;
        const endSec = record?.endSec;
        if (word === undefined || typeof startSec !== 'number' || typeof endSec !== 'number') {
            throw new Error('video-gen: caption worker word entry is missing word/startSec/endSec');
        }
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) {
            throw new Error(`video-gen: caption worker word "${word}" has an invalid time span`);
        }
        parsed.push({ word, startSec, endSec });
    }
    return parsed;
}

/**
 * Transcribe the teaser WAV into word timestamps. A nonzero worker exit names its stderr, because
 * the usual causes (no model cache, missing ffmpeg in the uv env) are operator-actionable.
 */
export async function transcribeWords(args: {
    pluginRoot: string;
    audioPath: string;
    outputPath: string;
    runProcess: RunProcess;
    model?: string;
    language?: string;
}): Promise<WordTimestamp[]> {
    const argv = [...resolveAlignCommand(args.pluginRoot), '--audio', args.audioPath, '--out', args.outputPath];
    const result = await args.runProcess(argv, {
        timeoutMs: ALIGN_TIMEOUT_MS,
        env: {
            ...process.env,
            KK_CAPTION_MODEL: args.model ?? DEFAULT_ALIGN_MODEL,
            ...(args.language === undefined ? {} : { KK_CAPTION_LANGUAGE: args.language }),
        },
    });
    if (result.code !== 0) {
        throw new Error(
            `video-gen: caption worker failed (${argv.join(' ')}): ${result.stderr.trim() || `exit ${result.code}`}`,
        );
    }
    let payload: unknown;
    try {
        payload = JSON.parse(await Bun.file(args.outputPath).text()) as unknown;
    } catch (error: unknown) {
        throw new Error(
            `video-gen: caption worker wrote no readable JSON at ${args.outputPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return parseWordsPayload(payload);
}
