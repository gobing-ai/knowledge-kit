import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ALIGN_TIMEOUT_MS,
    DEFAULT_ALIGN_MODEL,
    parseWordsPayload,
    resolveAlignCommand,
    transcribeWords,
} from '../src/captions';
import type { RunProcess } from '../src/process';

/**
 * AC3 (R4) — the word-timestamp step against a fake worker: locked uv argv, env model selection,
 * payload validation, and the unreadable-output path.
 */

const WORDS = {
    words: [
        { word: 'OpenAI', startSec: 0, endSec: 0.4 },
        { word: '发布', startSec: 0.4, endSec: 0.9 },
    ],
};

describe('align worker command', () => {
    it('runs the locked uv project worker', () => {
        const argv = resolveAlignCommand('/plugins/video-gen');
        expect(argv.slice(0, 7)).toEqual([
            'uv',
            'run',
            '--project',
            '/plugins/video-gen',
            '--locked',
            '--offline',
            '--no-dev',
        ]);
        expect(argv[argv.length - 1]).toBe('/plugins/video-gen/python/align_captions.py');
    });
});

describe('parseWordsPayload', () => {
    it('accepts a well-formed track', () => {
        expect(parseWordsPayload(WORDS)).toHaveLength(2);
    });

    it('rejects an empty or malformed track', () => {
        expect(() => parseWordsPayload({ words: [] })).toThrow(/no words/);
        expect(() => parseWordsPayload({})).toThrow(/no words/);
        expect(() => parseWordsPayload({ words: [{ word: 'x', startSec: 1 }] })).toThrow(/missing word\/startSec/);
        expect(() => parseWordsPayload({ words: [{ word: 'x', startSec: 1, endSec: 0.5 }] })).toThrow(
            /invalid time span/,
        );
    });
});

describe('transcribeWords', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kk-video-words-'));
    const audioPath = join(scratch, 'hook.wav');
    writeFileSync(audioPath, 'WAV');

    it('passes the model through the environment and reads the track back', async () => {
        const outputPath = join(scratch, 'words.json');
        const seen: { argv: string[]; env?: Record<string, string | undefined>; timeoutMs?: number }[] = [];
        const runProcess: RunProcess = async (argv, options) => {
            seen.push({ argv, env: options?.env, timeoutMs: options?.timeoutMs });
            writeFileSync(outputPath, JSON.stringify({ ...WORDS, waveform: [0.2, 0.7, 0.1] }));
            return { code: 0, stdout: '', stderr: '' };
        };
        const track = await transcribeWords({
            pluginRoot: '/plugins/video-gen',
            audioPath,
            outputPath,
            runProcess,
            model: 'tiny',
            language: 'zh',
        });
        expect(track.words.map((word) => word.word)).toEqual(['OpenAI', '发布']);
        expect(track.waveform).toEqual([0.2, 0.7, 0.1]);
        expect(seen[0]?.env?.KK_CAPTION_MODEL).toBe('tiny');
        expect(seen[0]?.env?.KK_CAPTION_LANGUAGE).toBe('zh');
        expect(seen[0]?.timeoutMs).toBe(ALIGN_TIMEOUT_MS);
        expect(seen[0]?.argv.slice(-4)).toEqual(['--audio', audioPath, '--out', outputPath]);
        expect(DEFAULT_ALIGN_MODEL).toBe('small');
    });

    it('defaults the model when the caller does not name one', async () => {
        const outputPath = join(scratch, 'words-default.json');
        let env: Record<string, string | undefined> | undefined;
        const runProcess: RunProcess = async (_argv, options) => {
            env = options?.env;
            writeFileSync(outputPath, JSON.stringify(WORDS));
            return { code: 0, stdout: '', stderr: '' };
        };
        await transcribeWords({ pluginRoot: '/p', audioPath, outputPath, runProcess });
        expect(env?.KK_CAPTION_MODEL).toBe(DEFAULT_ALIGN_MODEL);
        expect(env?.KK_CAPTION_LANGUAGE).toBeUndefined();
    });

    it('fails on a nonzero worker exit and on an unreadable output file', async () => {
        const failing: RunProcess = async () => ({ code: 1, stdout: '', stderr: 'no model cache' });
        await expect(
            transcribeWords({ pluginRoot: '/p', audioPath, outputPath: join(scratch, 'x.json'), runProcess: failing }),
        ).rejects.toThrow(/caption worker failed .* no model cache/);

        const silent: RunProcess = async () => ({ code: 0, stdout: '', stderr: '' });
        await expect(
            transcribeWords({
                pluginRoot: '/p',
                audioPath,
                outputPath: join(scratch, 'absent.json'),
                runProcess: silent,
            }),
        ).rejects.toThrow(/no readable JSON/);
    });
});
