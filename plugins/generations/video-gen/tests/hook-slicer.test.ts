import { describe, expect, it } from 'bun:test';
import {
    buildProbeArgv,
    buildSliceArgv,
    FADE_OUT_SEC,
    PROBE_TIMEOUT_MS,
    parseProbeDuration,
    probeAudioDuration,
    SLICE_TIMEOUT_MS,
    sliceHookAudio,
} from '../src/hook-slicer';
import type { RunProcess } from '../src/process';

/**
 * AC3 (R4) — the teaser cut: recorded `ffprobe`/`ffmpeg` argv and the failure paths, with an
 * injected runner (no real encode in the fast tier).
 */

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const fail = (stderr = 'boom') => ({ code: 1, stdout: '', stderr });

/** Records every argv and answers by program name. */
function recorder(answer: (argv: string[]) => { code: number; stdout: string; stderr: string }) {
    const calls: string[][] = [];
    const timeouts: (number | undefined)[] = [];
    const run: RunProcess = async (argv, options) => {
        calls.push(argv);
        timeouts.push(options?.timeoutMs);
        return answer(argv);
    };
    return { calls, timeouts, run };
}

describe('ffprobe duration', () => {
    it('parses a container duration', () => {
        expect(parseProbeDuration('52.512000\n')).toBeCloseTo(52.512);
        expect(buildProbeArgv('/tmp/a.wav')[0]).toBe('ffprobe');
        expect(buildProbeArgv('/tmp/a.wav')).toContain('/tmp/a.wav');
        expect(buildProbeArgv('/tmp/a.wav')).toContain('file,pipe');
    });

    it('rejects an unusable duration instead of defaulting', () => {
        expect(() => parseProbeDuration('N/A')).toThrow(/no usable duration/);
        expect(() => parseProbeDuration('-3')).toThrow(/no usable duration/);
    });

    it('fails when ffprobe exits nonzero', async () => {
        const { run } = recorder(() => fail('bad container'));
        await expect(probeAudioDuration('/tmp/a.wav', run)).rejects.toThrow(/ffprobe failed .* bad container/);
    });

    it('returns the measured length within a bounded deadline', async () => {
        const { run, timeouts } = recorder(() => ok('61.25\n'));
        expect(await probeAudioDuration('/tmp/a.wav', run)).toBeCloseTo(61.25);
        expect(timeouts).toEqual([PROBE_TIMEOUT_MS]);
    });
});

describe('teaser slice', () => {
    it('cuts the window with fades and 44.1kHz stereo PCM', () => {
        const argv = buildSliceArgv('/tmp/a.wav', '/tmp/hook.wav', { startSec: 5, endSec: 55 });
        expect(argv[0]).toBe('ffmpeg');
        expect(argv[argv.indexOf('-protocol_whitelist') + 1]).toBe('file,pipe');
        expect(argv[argv.indexOf('-ss') + 1]).toBe('5');
        expect(argv[argv.indexOf('-t') + 1]).toBe('50');
        expect(argv[argv.indexOf('-ar') + 1]).toBe('44100');
        expect(argv[argv.indexOf('-ac') + 1]).toBe('2');
        const filter = argv[argv.indexOf('-af') + 1] as string;
        expect(filter).toContain('afade=t=in');
        expect(filter).toContain(`afade=t=out:st=${(50 - FADE_OUT_SEC).toFixed(3)}`);
        expect(argv[argv.length - 1]).toBe('/tmp/hook.wav');
    });

    it('spawns exactly one ffmpeg and reports an encode failure with stderr', async () => {
        const good = recorder(() => ok());
        await sliceHookAudio({
            audioPath: '/a.wav',
            outputPath: '/h.wav',
            window: { startSec: 0, endSec: 50 },
            runProcess: good.run,
        });
        expect(good.calls).toHaveLength(1);
        // A hung encode must surface as a failed run, not an unbounded cron.
        expect(good.timeouts).toEqual([SLICE_TIMEOUT_MS]);
        expect(good.calls[0]?.[0]).toBe('ffmpeg');

        const bad = recorder(() => fail('Invalid data found'));
        await expect(
            sliceHookAudio({
                audioPath: '/a.wav',
                outputPath: '/h.wav',
                window: { startSec: 0, endSec: 50 },
                runProcess: bad.run,
            }),
        ).rejects.toThrow(/ffmpeg failed .* Invalid data found/);
    });
});
