import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CheckRow, checksPathFor, readChecks } from '../src/audio/checks';
import {
    DeliveryCheckFailure,
    loudnormValue,
    MasterError,
    masterOutputName,
    masterPassArgs,
    masterTake,
} from '../src/audio/master';
import type { LoudnessMeasurement } from '../src/audio/measure';
import { resolveDeliveryProfile } from '../src/audio/profile';
import { capturedRunner, filtersNamed, fixtureText } from './audio-captures';

/**
 * AC3 — normalization is two-pass, rate-explicit and non-destructive.
 * AC4 — the delivered file is what gets checked, and a failure does not loop.
 *
 * The pass-1 numbers are the captured analysis of the fixture take; the pass-2
 * numbers are its captured mastered measurement (44.1 kHz, −14.00 LUFS).
 */

const STREAMING = resolveDeliveryProfile('streaming');

/** A probe of the encoded output: 44.1 kHz, 34 s. */
const MASTERED_PROBE = fixtureText('ffprobe-mastered.json');

/** A throwaway take on disk; every tool call is replayed, so the bytes are arbitrary but stable. */
function withTake(run: (paths: { dir: string; takePath: string }) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-music-master-'));
    const takePath = join(dir, 'lofi-pro-take1.wav');
    writeFileSync(takePath, 'provider-take-bytes');
    return run({ dir, takePath }).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** The take's pass-1 measurement, for the pure argv assertions. */
const FIRST_PASS: LoudnessMeasurement = {
    integratedLufs: -21.8,
    truePeakDbtp: -21.07,
    loudnessRangeLu: 1.8,
    thresholdLufs: -31.81,
    targetOffsetDb: -0.05,
};

describe('AC3 — pass 2 carries pass 1 measurements and an explicit output rate', () => {
    test('the filter feeds measured_I/TP/LRA/thresh/offset back to loudnorm', () => {
        const argv = masterPassArgs({
            takePath: 'take.wav',
            outputPath: 'take.streaming.wav',
            profile: STREAMING,
            firstPass: FIRST_PASS,
        });
        const filter = argv[argv.indexOf('-af') + 1] ?? '';
        expect(filter).toBe(
            'loudnorm=I=-14:TP=-1:measured_I=-21.8:measured_TP=-21.07:measured_LRA=1.8:measured_thresh=-31.81:offset=-0.05:print_format=json',
        );
        expect(argv[argv.indexOf('-ar') + 1]).toBe('44100');
        expect(argv[argv.length - 1]).toBe('take.streaming.wav');
        expect(argv.slice(argv.indexOf('-c:a'), argv.indexOf('-c:a') + 2)).toEqual(['-c:a', 'pcm_s16le']);
        // The target is a ceiling: no LRA is forced unless the profile sets one.
        expect(filter).not.toMatch(/(?:^|:)LRA=/);
        expect(argv).not.toContain('-y=false');
        expect(argv).toContain('-y');
    });

    test('a profile that sets lra and mp3 gets both, plus a sample rate of its own', () => {
        const argv = masterPassArgs({
            takePath: 'take.mp3',
            outputPath: 'take.channels.mp3',
            profile: { lufs: -16, truePeak: -2, lra: 7, container: 'mp3', sampleRate: 48_000 },
            firstPass: FIRST_PASS,
            ffmpegBin: '/opt/ffmpeg',
        });
        const filter = argv[argv.indexOf('-af') + 1] ?? '';
        expect(filter).toContain('I=-16');
        expect(filter).toContain('TP=-2');
        expect(filter).toContain('LRA=7');
        expect(filter).toContain('measured_I=-21.8');
        expect(argv[argv.indexOf('-ar') + 1]).toBe('48000');
        expect(argv.slice(-3)).toEqual(['-b:a', '192k', 'take.channels.mp3']);
        expect(argv[0]).toBe('/opt/ffmpeg');
    });

    test('a digitised-silence take passes -inf through instead of NaN', () => {
        expect(loudnormValue(Number.NEGATIVE_INFINITY)).toBe('-inf');
        expect(loudnormValue(Number.POSITIVE_INFINITY)).toBe('inf');
        expect(loudnormValue(-21.8)).toBe('-21.8');
        const argv = masterPassArgs({
            takePath: 'silent.wav',
            outputPath: 'silent.streaming.wav',
            profile: STREAMING,
            firstPass: { ...FIRST_PASS, truePeakDbtp: Number.NEGATIVE_INFINITY },
        });
        expect(argv[argv.indexOf('-af') + 1]).toContain('measured_TP=-inf');
    });

    test('the output name is <artifact>.<profile>.<ext>, and a bad profile name is refused', () => {
        expect(masterOutputName('/run/lofi-pro-take1.mp3', 'streaming', 'wav')).toBe(
            '/run/lofi-pro-take1.streaming.wav',
        );
        expect(masterOutputName('/run/no-extension', 'streaming', 'wav')).toBe('/run/no-extension.streaming.wav');
        expect(() => masterOutputName('/run/take.wav', '../evil', 'wav')).toThrow(MasterError);
    });

    test('masterTake runs exactly one writing pass and leaves the provider take untouched', async () => {
        await withTake(async ({ takePath }) => {
            const { runner, calls } = capturedRunner({
                probe: MASTERED_PROBE,
                loudnorm: [fixtureText('loudnorm-take.txt'), fixtureText('loudnorm-delivery.txt')],
                masterBytes: 'mastered-bytes',
            });
            const before = readFileSync(takePath);
            const result = await masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner });

            expect(result.outputPath).toBe(takePath.replace(/\.wav$/, '.streaming.wav'));
            expect(readFileSync(takePath).equals(before)).toBe(true);
            expect(readFileSync(result.outputPath, 'utf8')).toBe('mastered-bytes');

            // One analysis of the take, one writing pass, one analysis of the output.
            const masterFilters = filtersNamed(calls, 'loudnorm=I=');
            expect(masterFilters).toHaveLength(1);
            expect(masterFilters[0]).toContain('measured_I=-21.8');
            expect(calls.filter((argv) => argv.includes('-ar'))).toHaveLength(1);
            expect(result.firstPass.integratedLufs).toBe(-21.8);
            expect(result.delivery.every((row) => row.result === 'pass')).toBe(true);
            expect(result.deliveryMeasurement.probe.sampleRate).toBe(44_100);
        });
    });

    test('the delivery rows land in the take checks file beside the take rows', async () => {
        await withTake(async ({ takePath }) => {
            const checksPath = checksPathFor(takePath);
            writeFileSync(
                checksPath,
                JSON.stringify([
                    {
                        id: 'duration.target',
                        measured: 34,
                        threshold: '20–40',
                        unit: 's',
                        source: 'ffprobe 8.1.2',
                        result: 'pass',
                    },
                ] satisfies CheckRow[]),
            );
            const { runner } = capturedRunner({
                probe: MASTERED_PROBE,
                loudnorm: [fixtureText('loudnorm-take.txt'), fixtureText('loudnorm-delivery.txt')],
                masterBytes: 'mastered-bytes',
            });
            const result = await masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner });
            const written = await readChecks(result.checksPath);
            expect(written.map((row) => row.id)).toEqual([
                'duration.target',
                'delivery.integrated_loudness',
                'delivery.true_peak',
                'delivery.sample_rate',
            ]);
        });
    });

    test('a missing take fails before any tool runs', async () => {
        const { runner, calls } = capturedRunner();
        await expect(
            masterTake({
                takePath: join(tmpdir(), 'kk-music-master-absent.wav'),
                profileName: 'streaming',
                profile: STREAMING,
                runner,
            }),
        ).rejects.toBeInstanceOf(MasterError);
        expect(calls).toHaveLength(0);
    });

    test('an output path equal to the take is refused', async () => {
        await withTake(async ({ takePath }) => {
            const { runner } = capturedRunner();
            await expect(
                masterTake({
                    takePath,
                    profileName: 'streaming',
                    profile: STREAMING,
                    runner,
                    outputPath: takePath,
                }),
            ).rejects.toThrow(/refusing to overwrite the provider take/);
        });
    });

    test('a failing pass 2 fails loudly and writes no delivery rows', async () => {
        await withTake(async ({ takePath }) => {
            const { runner } = capturedRunner({ exitCode: 1 });
            await expect(
                masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner }),
            ).rejects.toThrow(/exited 1/);
        });
    });

    test('a pass 2 that reports success but writes no file fails', async () => {
        await withTake(async ({ takePath }) => {
            const { runner } = capturedRunner();
            await expect(
                masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner }),
            ).rejects.toThrow(/produced no file/);
        });
    });
});

describe('AC4 — the encoded output is what gets checked, and there is no second pass', () => {
    test('an encoded true peak of -0.4 dBTP fails the delivery check with both numbers recorded', async () => {
        await withTake(async ({ takePath }) => {
            const { runner, calls } = capturedRunner({
                probe: MASTERED_PROBE,
                loudnorm: [fixtureText('loudnorm-take.txt'), fixtureText('loudnorm-delivery-over-ceiling.txt')],
                masterBytes: 'mastered-bytes',
            });
            let caught: unknown;
            try {
                await masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner });
            } catch (error: unknown) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(DeliveryCheckFailure);
            const failure = caught as DeliveryCheckFailure;
            const truePeak = failure.rows.find((row) => row.id === 'delivery.true_peak');
            expect(truePeak?.measured).toBe(-0.4);
            expect(truePeak?.threshold).toBe(-1);
            expect(truePeak?.result).toBe('fail');
            expect(failure.message).toContain('-0.4');
            expect(failure.message).toContain('-1');
            expect(failure.message).toContain('no re-master is attempted');

            // Exactly one writing pass: the failure did not loop into a second master.
            expect(filtersNamed(calls, 'loudnorm=I=')).toHaveLength(1);
            // The failing rows were still written, so checks.json explains the exit code.
            const written = await readChecks(checksPathFor(takePath));
            expect(written.find((row) => row.id === 'delivery.true_peak')?.result).toBe('fail');
        });
    });

    test('an unmeasurable output fails the delivery rows rather than passing them', async () => {
        await withTake(async ({ takePath }) => {
            // The take measures; the encoded output's analysis does not.
            const { runner } = capturedRunner({
                probe: MASTERED_PROBE,
                loudnorm: [fixtureText('loudnorm-take.txt'), 'ffmpeg failed while writing the analysis'],
                masterBytes: 'mastered-bytes',
            });
            let caught: unknown;
            try {
                await masterTake({ takePath, profileName: 'streaming', profile: STREAMING, runner });
            } catch (error: unknown) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(DeliveryCheckFailure);
            const rows = (caught as DeliveryCheckFailure).rows;
            expect(rows.every((row) => row.result === 'fail')).toBe(true);
            expect(rows[0]?.note).toContain('ffmpeg loudnorm');
        });
    });
});
