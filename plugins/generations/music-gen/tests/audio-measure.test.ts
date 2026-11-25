import { describe, expect, test } from 'bun:test';
import type { ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import {
    AudioToolError,
    createSpawnRunner,
    ffprobeArgs,
    loudnormArgs,
    measureAudio,
    measureLoudness,
    measureSilence,
    parseLoudnormOutput,
    parseProbeOutput,
    parseSilencedetectOutput,
    parseToolVersion,
    probeAudio,
    silencedetectArgs,
    spawnRunner,
    toolVersions,
    versionArgs,
} from '../src/audio/measure';
import { capturedRunner, fixtureText } from './audio-captures';

/**
 * AC1 — measurements come from tools, not guesses (R1).
 *
 * Every fixture is real ffmpeg 8.1.2 output captured once from a 34 s WAV (2 s
 * leading silence, 28 s of tone, 4 s trailing silence); the parsers see only that
 * text and the injected runner replays it, so no test needs ffmpeg.
 */

describe('AC1 — ffprobe parsing yields duration, codec, rate and channels', () => {
    test('the captured probe output parses with units', () => {
        const probe = parseProbeOutput(fixtureText('ffprobe-take.json'));
        expect(probe.durationSeconds).toBe(34);
        expect(probe.codec).toBe('pcm_s16le');
        expect(probe.sampleRate).toBe(48_000);
        expect(probe.channels).toBe(2);
        expect(probe.container).toBe('wav');
    });

    test('the mastered output probe reports the profile rate, not 192 kHz', () => {
        const probe = parseProbeOutput(fixtureText('ffprobe-mastered.json'));
        expect(probe.sampleRate).toBe(44_100);
        expect(probe.durationSeconds).toBe(34);
    });

    test('a non-JSON probe output fails naming the tool and the fragment', () => {
        const broken = 'not json at all';
        let caught: unknown;
        try {
            parseProbeOutput(broken);
        } catch (error: unknown) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AudioToolError);
        const error = caught as AudioToolError;
        expect(error.tool).toBe('ffprobe');
        expect(error.kind).toBe('malformed');
        expect(error.fragment).toBe(broken);
        expect(error.message).toContain('ffprobe');
        expect(error.message).toContain(broken);
    });

    test('a probe output with no audio stream is malformed, never a zero measurement', () => {
        const noAudio = JSON.stringify({ streams: [{ codec_type: 'video' }], format: { duration: '10.0' } });
        expect(() => parseProbeOutput(noAudio)).toThrow(/no audio stream/);
    });

    test('a probe output whose duration is missing fails rather than reporting zero', () => {
        const noDuration = JSON.stringify({
            streams: [{ codec_type: 'audio', codec_name: 'mp3', sample_rate: '44100', channels: 2 }],
            format: {},
        });
        expect(() => parseProbeOutput(noDuration)).toThrow(/no positive duration/);
    });

    test('a probe output whose sample rate, channels or codec is missing fails', () => {
        const base = { codec_type: 'audio', duration: '30.0', codec_name: 'mp3', sample_rate: '44100', channels: 2 };
        expect(() => parseProbeOutput(JSON.stringify({ streams: [{ ...base, sample_rate: undefined }] }))).toThrow(
            /no sample rate/,
        );
        expect(() => parseProbeOutput(JSON.stringify({ streams: [{ ...base, channels: undefined }] }))).toThrow(
            /no channel count/,
        );
        expect(() => parseProbeOutput(JSON.stringify({ streams: [{ ...base, codec_name: undefined }] }))).toThrow(
            /no codec name/,
        );
        expect(() => parseProbeOutput('[]')).toThrow(/no audio stream/);
        expect(() => parseProbeOutput('null')).toThrow(/not a JSON object/);
    });
});

describe('AC1 — loudnorm analysis parsing yields LUFS, true peak and LRA', () => {
    test('the captured analysis block parses out of ffmpeg log noise', () => {
        const loudness = parseLoudnormOutput(fixtureText('loudnorm-take.txt'));
        expect(loudness.integratedLufs).toBe(-21.8);
        expect(loudness.truePeakDbtp).toBe(-21.07);
        expect(loudness.loudnessRangeLu).toBe(1.8);
        expect(loudness.thresholdLufs).toBe(-31.81);
        expect(loudness.targetOffsetDb).toBe(-0.05);
    });

    test('the mastered delivery measurement parses to the profile target', () => {
        const loudness = parseLoudnormOutput(fixtureText('loudnorm-delivery.txt'));
        expect(loudness.integratedLufs).toBe(-14);
        expect(loudness.truePeakDbtp).toBe(-13.27);
    });

    test('a digitised-silence true peak of -inf is a measured value, not malformed', () => {
        const text = fixtureText('loudnorm-take.txt').replace('"input_tp" : "-21.07"', '"input_tp" : "-inf"');
        expect(parseLoudnormOutput(text).truePeakDbtp).toBe(Number.NEGATIVE_INFINITY);
    });

    test('a truncated JSON block fails naming the tool and the fragment', () => {
        const truncated = fixtureText('loudnorm-truncated.txt');
        let caught: unknown;
        try {
            parseLoudnormOutput(truncated);
        } catch (error: unknown) {
            caught = error;
        }
        const error = caught as AudioToolError;
        expect(error).toBeInstanceOf(AudioToolError);
        expect(error.tool).toBe('ffmpeg loudnorm');
        expect(error.message).toContain('ffmpeg loudnorm');
        expect(error.message).toContain('input_lra');
        expect(error.fragment).toContain('"input_lra"');
    });

    test('output with no JSON block at all fails', () => {
        expect(() => parseLoudnormOutput('size=N/A time=00:00:34.00 bitrate=N/A speed=41.1x\n')).toThrow(
            /no loudnorm JSON block/,
        );
    });

    test('a JSON block missing a field fails naming that field', () => {
        const text = fixtureText('loudnorm-take.txt').replace('"input_thresh" : "-31.81"', '"input_thresh" : "n/a"');
        expect(() => parseLoudnormOutput(text)).toThrow(/no numeric "input_thresh"/);
    });

    test('a block that parses but carries none of the analysis fields fails', () => {
        expect(() => parseLoudnormOutput('loudnorm { "input_i": "-14" }')).toThrow(/no numeric "input_tp"/);
    });
});

describe('AC1 — silencedetect parsing yields leading and trailing dead air', () => {
    test('the captured scan reports 2.0 s leading and 4.0 s trailing', () => {
        const silence = parseSilencedetectOutput(fixtureText('silencedetect-take.txt'), 34);
        expect(silence.leadingSeconds).toBeCloseTo(2.000021, 5);
        expect(silence.trailingSeconds).toBe(4);
        expect(silence.spans).toHaveLength(2);
        expect(silence.spans[0]).toEqual({ startSeconds: 0, endSeconds: 2.000021, durationSeconds: 2.000021 });
    });

    test('a file that opens and closes on audio has no dead air', () => {
        const text =
            '[Parsed_silencedetect_0 @ 0x1] silence_start: 12\n[Parsed_silencedetect_0 @ 0x1] silence_end: 12.6 | silence_duration: 0.6\n';
        const silence = parseSilencedetectOutput(text, 30);
        expect(silence.leadingSeconds).toBe(0);
        expect(silence.trailingSeconds).toBe(0);
        expect(silence.spans).toHaveLength(1);
    });

    test('an unterminated span runs to EOF and counts as trailing silence', () => {
        const text = '[Parsed_silencedetect_0 @ 0x1] silence_start: 27.5\n';
        const silence = parseSilencedetectOutput(text, 30);
        expect(silence.trailingSeconds).toBe(2.5);
        expect(silence.spans[0]).toEqual({ startSeconds: 27.5, endSeconds: null, durationSeconds: 2.5 });
    });

    test('no silence lines means no spans, and malformed silence lines fail', () => {
        expect(parseSilencedetectOutput('size=N/A\n', 30)).toEqual({
            leadingSeconds: 0,
            trailingSeconds: 0,
            spans: [],
        });
        expect(() => parseSilencedetectOutput('[Parsed_silencedetect_0 @ 0x1] silence_start: nope\n', 30)).toThrow(
            /no readable timestamp/,
        );
    });
});

describe('AC1 — the argv each measurement builds', () => {
    test('ffprobe, loudnorm and silencedetect invocations are complete and explicit', () => {
        expect(ffprobeArgs('take.wav')).toEqual([
            'ffprobe',
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            'take.wav',
        ]);
        expect(loudnormArgs('take.wav')).toEqual([
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            'take.wav',
            '-af',
            'loudnorm=print_format=json',
            '-f',
            'null',
            '-',
        ]);
        expect(silencedetectArgs('take.wav')).toEqual([
            'ffmpeg',
            '-hide_banner',
            '-nostats',
            '-i',
            'take.wav',
            '-af',
            'silencedetect=noise=-50dB:d=0.5',
            '-f',
            'null',
            '-',
        ]);
        expect(versionArgs('ffmpeg')).toEqual(['ffmpeg', '-version']);
    });

    test('the injected runner is what the per-measurement helpers call', async () => {
        const { runner, calls } = capturedRunner({ silence: '', ffprobeVersion: 'ffprobe version 7.1.1\n' });
        expect(await probeAudio('take.wav', { runner })).toMatchObject({ durationSeconds: 34 });
        expect((await measureLoudness('take.wav', { runner })).integratedLufs).toBe(-21.8);
        expect(await measureSilence('take.wav', 34, { runner })).toEqual({
            leadingSeconds: 0,
            trailingSeconds: 0,
            spans: [],
        });
        expect(calls[0]).toEqual([
            'ffprobe',
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            'take.wav',
        ]);
    });

    test('versions come off each tool banner', async () => {
        const { runner, calls } = capturedRunner();
        expect(await toolVersions({ runner })).toEqual({ ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' });
        expect(calls.map((argv) => argv[1])).toEqual(['-version', '-version']);
        expect(() => parseToolVersion('nonsense\n', 'ffmpeg')).toThrow(/carries no version/);
    });
});

describe('AC1/AC6 — measureAudio runs the whole measurement through one injected runner', () => {
    test('it returns probe, loudness, silence and tool labels', async () => {
        const { runner, calls } = capturedRunner();
        const measurement = await measureAudio('take.wav', { runner });
        expect(measurement.probe.durationSeconds).toBe(34);
        expect(measurement.loudness.integratedLufs).toBe(-21.8);
        expect(measurement.silence.trailingSeconds).toBe(4);
        expect(measurement.tools).toEqual({ ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' });
        // Two `-version` banners, one probe, one analysis, one silence scan — and nothing else.
        expect(calls).toHaveLength(5);
        expect(calls.filter((argv) => argv.includes('-version'))).toHaveLength(2);
    });

    test('custom binary names are honoured and a failing tool aborts the measurement', async () => {
        const { runner, calls } = capturedRunner();
        await measureAudio('take.wav', { runner, ffmpegBin: '/opt/ffmpeg', ffprobeBin: '/opt/ffprobe' });
        expect(calls.every((argv) => argv[0] === '/opt/ffmpeg' || argv[0] === '/opt/ffprobe')).toBe(true);

        const failing = capturedRunner({ exitCode: 1 });
        let caught: unknown;
        try {
            await measureAudio('take.wav', { runner: failing.runner });
        } catch (error: unknown) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AudioToolError);
        expect((caught as AudioToolError).kind).toBe('exit');
        expect((caught as AudioToolError).message).toContain('exited 1');
    });

    test('the default runner wraps ProcessExecutor and surfaces spawn failures', async () => {
        await expect(spawnRunner([])).rejects.toBeInstanceOf(AudioToolError);

        const seen: ProcessOptions[] = [];
        const stubExecutor = (result: Partial<ProcessResult>): ProcessExecutor => ({
            async run(options: ProcessOptions): Promise<ProcessResult> {
                seen.push(options);
                return {
                    command: options.command,
                    args: options.args ?? [],
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                    durationMs: 1,
                    ...result,
                };
            },
            runStreaming() {
                throw new Error('runStreaming is unused by audio measurement');
            },
        });

        const okRunner = createSpawnRunner(stubExecutor({ exitCode: 0, stdout: 'ok', stderr: '' }));
        expect(await okRunner(['ffprobe', '-version'])).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' });
        expect(seen[0]).toEqual({ command: 'ffprobe', args: ['-version'], label: 'audio ffprobe' });

        const missingRunner = createSpawnRunner(stubExecutor({ exitCode: null, stderr: 'ENOENT', signal: 'SIGKILL' }));
        let caught: unknown;
        try {
            await missingRunner(['ffmpeg', '-version']);
        } catch (error: unknown) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(AudioToolError);
        const error = caught as AudioToolError;
        expect(error.tool).toBe('ffmpeg');
        expect(error.kind).toBe('spawn');
        expect(error.message).toContain('ENOENT');
        expect(error.message).toContain('killed by SIGKILL');
        expect(error.message).toContain('install ffmpeg');
    });
});
