import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    briefMusicalTargets,
    buildDeliveryCheckRows,
    buildTakeCheckRows,
    CHECKS_SUFFIX,
    type CheckRow,
    canonicalKey,
    checksExitCode,
    checksPassed,
    checksPathFor,
    LEADING_SILENCE_MAX_SECONDS,
    mergeChecks,
    readChecks,
    runTakeChecks,
    serializeChecks,
    TRAILING_SILENCE_MAX_SECONDS,
    writeChecks,
} from '../src/audio/checks';
import { type AudioMeasurement, measureAudio } from '../src/audio/measure';
import { BUILTIN_DELIVERY_PROFILES, resolveDeliveryProfile } from '../src/audio/profile';
import { capturedRunner, fixtureText } from './audio-captures';

/**
 * AC2 — take checks fail on measured violations and never on loudness (R2).
 * Plus the delivery rows R4 appends to the same file.
 */

/** The measurement the captured 34 s take yields (2 s leading silence, 4 s trailing). */
async function takeMeasurement(loudnorm = fixtureText('loudnorm-take.txt')): Promise<AudioMeasurement> {
    const { runner } = capturedRunner({ loudnorm, silence: fixtureText('silencedetect-take.txt') });
    return await measureAudio('take.wav', { runner });
}

/** The instance analysis a healthy Pro take carries. */
const ANALYSIS = {
    summary: 'Lo-fi hip hop, 78 BPM, D minor, three sections',
    bpm: 78,
    key: 'D minor',
    sections: ['intro', 'loop', 'outro'],
};

/** Row lookup by id. */
function row(rows: readonly CheckRow[], id: string): CheckRow {
    const found = rows.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(`no check row ${id}; got ${rows.map((candidate) => candidate.id).join(', ')}`);
    }
    return found;
}

/** Every row's shape is the R2 contract. */
function expectRowShape(row_: CheckRow): void {
    expect(typeof row_.id).toBe('string');
    expect(row_.measured === null || ['number', 'string'].includes(typeof row_.measured)).toBe(true);
    expect(row_.threshold === null || ['number', 'string'].includes(typeof row_.threshold)).toBe(true);
    expect(typeof row_.unit).toBe('string');
    expect(typeof row_.source).toBe('string');
    expect(['pass', 'warn', 'fail']).toContain(row_.result);
}

describe('AC2 — duration checks compare the measured file to the brief', () => {
    test('a Pro take inside ±20%/±10 s passes and records measured, threshold and source', async () => {
        const measurement = await takeMeasurement();
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '0:30',
            measurement,
            analysis: ANALYSIS,
        });
        const duration = row(rows, 'duration.target');
        expectRowShape(duration);
        expect(duration.measured).toBe(34);
        expect(duration.threshold).toBe('20–40');
        expect(duration.unit).toBe('s');
        expect(duration.source).toBe('ffprobe 8.1.2');
        expect(duration.result).toBe('pass');
    });

    test('a Pro take beyond tolerance fails with its measured value', () => {
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '1:00',
            measurement: {
                probe: { durationSeconds: 30, codec: 'wav', sampleRate: 44_100, channels: 2, container: 'wav' },
                loudness: {
                    integratedLufs: -22,
                    truePeakDbtp: -5,
                    loudnessRangeLu: 3,
                    thresholdLufs: -32,
                    targetOffsetDb: 0,
                },
                silence: { leadingSeconds: 0, trailingSeconds: 0, spans: [] },
                tools: { ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' },
            },
            analysis: ANALYSIS,
        });
        expect(row(rows, 'duration.target').measured).toBe(30);
        expect(row(rows, 'duration.target').result).toBe('fail');
    });

    test('a Pro take with no recorded target fails rather than checking nothing', () => {
        const rows = buildTakeCheckRows({ model: 'pro', analysis: ANALYSIS });
        const duration = row(rows, 'duration.target');
        expect(duration.result).toBe('fail');
        expect(duration.measured).toBeNull();
        expect(duration.note).toContain('no durationTarget');
    });

    test('a Clip take is judged against the fixed 25–35 s window', async () => {
        const measurement = await takeMeasurement();
        const rows = buildTakeCheckRows({ model: 'clip', measurement, analysis: ANALYSIS });
        expect(row(rows, 'duration.clip').threshold).toBe('25–35');
        expect(row(rows, 'duration.clip').result).toBe('pass');
        expect(rows.some((candidate) => candidate.id === 'duration.target')).toBe(false);

        const longRows = buildTakeCheckRows({
            model: 'clip',
            measurement: { ...measurement, probe: { ...measurement.probe, durationSeconds: 42 } },
            analysis: ANALYSIS,
        });
        expect(row(longRows, 'duration.clip').measured).toBe(42);
        expect(row(longRows, 'duration.clip').result).toBe('fail');
    });
});

describe('AC2 — silence, analysis presence and the warn-only agreement rows', () => {
    test('2 s of leading silence fails; the 4 s trailing tail fails too', async () => {
        const measurement = await takeMeasurement();
        const rows = buildTakeCheckRows({ model: 'pro', durationTarget: '0:30', measurement, analysis: ANALYSIS });
        const leading = row(rows, 'silence.leading');
        expect(leading.measured).toBe(2);
        expect(leading.threshold).toBe(LEADING_SILENCE_MAX_SECONDS);
        expect(leading.result).toBe('fail');
        expect(leading.source).toBe('ffmpeg 8.1.2 silencedetect');
        const trailing = row(rows, 'silence.trailing');
        expect(trailing.threshold).toBe(TRAILING_SILENCE_MAX_SECONDS);
        expect(trailing.result).toBe('fail');
    });

    test('a take whose edges are audio passes both silence rows', async () => {
        const measurement = await takeMeasurement();
        const quiet = { ...measurement, silence: { leadingSeconds: 0, trailingSeconds: 0, spans: [] } };
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '0:30',
            measurement: quiet,
            analysis: ANALYSIS,
        });
        expect(row(rows, 'silence.leading').result).toBe('pass');
        expect(row(rows, 'silence.trailing').result).toBe('pass');
    });

    test('a missing instance analysis fails the presence row', async () => {
        const measurement = await takeMeasurement();
        const rows = buildTakeCheckRows({ model: 'pro', durationTarget: '0:30', measurement, analysis: null });
        expect(row(rows, 'analysis.present').measured).toBe('absent');
        expect(row(rows, 'analysis.present').result).toBe('fail');
        // No analysis → no agreement rows to compare against.
        expect(rows.some((candidate) => candidate.id === 'analysis.bpm')).toBe(false);
    });

    test('an analysis BPM outside the brief band is warn, never fail', async () => {
        const measurement = await takeMeasurement();
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '0:30',
            measurement,
            analysis: { ...ANALYSIS, bpm: 140 },
            briefStyle: 'Dusty lofi hip-hop at 78 BPM in D minor',
        });
        const bpm = row(rows, 'analysis.bpm');
        expect(bpm.result).toBe('warn');
        expect(bpm.measured).toBe(140);
        expect(bpm.threshold).toBe('70.2–85.8');
        expect(bpm.note).toContain('warn, never a fail');
        expect(checksPassed([bpm])).toBe(true);
    });

    test('BPM, key and section agreement are recorded against the brief', () => {
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '0:30',
            analysis: { bpm: 78, key: 'Dm', sections: 4 },
            briefStyle: 'glassy ambient techno; 100-115 BPM, steady; C# minor',
            briefSectionCount: 3,
        });
        expect(row(rows, 'analysis.bpm').threshold).toBe('100–115');
        expect(row(rows, 'analysis.bpm').result).toBe('warn');
        expect(row(rows, 'analysis.key').measured).toBe('D minor');
        expect(row(rows, 'analysis.key').threshold).toBe('C# minor');
        expect(row(rows, 'analysis.key').result).toBe('warn');
        expect(row(rows, 'analysis.sections').measured).toBe(4);
        expect(row(rows, 'analysis.sections').result).toBe('warn');
    });

    test('agreement rows are warn when the analysis carries no value to compare', () => {
        const rows = buildTakeCheckRows({
            model: 'pro',
            analysis: { summary: 'no structured fields' },
            briefStyle: 'at 78 BPM in D minor',
            briefSectionCount: 3,
        });
        expect(row(rows, 'analysis.bpm').result).toBe('warn');
        expect(row(rows, 'analysis.key').result).toBe('warn');
        expect(row(rows, 'analysis.sections').result).toBe('warn');
        expect(row(rows, 'analysis.bpm').note).toContain('no BPM');
    });

    test('briefMusicalTargets reads only what the text states', () => {
        expect(briefMusicalTargets(undefined)).toEqual({});
        expect(briefMusicalTargets('no tempo here')).toEqual({});
        const point = briefMusicalTargets('at 78 BPM in D minor');
        expect(point.key).toBe('D minor');
        expect(point.bpm?.low).toBeCloseTo(70.2, 5);
        expect(point.bpm?.high).toBeCloseTo(85.8, 5);
        expect(briefMusicalTargets('100-115 BPM, C# minor')).toEqual({ bpm: { low: 100, high: 115 }, key: 'C# minor' });
        expect(canonicalKey('d MINOR')).toBe('D minor');
        expect(canonicalKey('C#maj')).toBe('C# major');
        expect(canonicalKey('Ebm')).toBe('Eb minor');
        expect(canonicalKey('nothing')).toBeUndefined();
    });
});

describe('AC2 — a raw take never fails on loudness, and the exit code is exact', () => {
    test('a -22 LUFS take passes every take check when nothing else is wrong', () => {
        const rows = buildTakeCheckRows({
            model: 'pro',
            durationTarget: '0:30',
            measurement: {
                probe: { durationSeconds: 30, codec: 'wav', sampleRate: 44_100, channels: 2, container: 'wav' },
                loudness: {
                    integratedLufs: -22,
                    truePeakDbtp: -8,
                    loudnessRangeLu: 4,
                    thresholdLufs: -32,
                    targetOffsetDb: 0,
                },
                silence: { leadingSeconds: 0, trailingSeconds: 1, spans: [] },
                tools: { ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' },
            },
            analysis: { bpm: 78, key: 'D minor' },
            briefStyle: 'at 78 BPM in D minor',
            briefSectionCount: 2,
        });
        expect(rows.some((candidate) => candidate.id.includes('loudness'))).toBe(false);
        expect(checksPassed(rows)).toBe(true);
        expect(checksExitCode(rows)).toBe(0);
    });

    test('the exit code is non-zero exactly when a row is fail', () => {
        const passing: CheckRow[] = [
            { id: 'a', measured: 1, threshold: 2, unit: 's', source: 'x', result: 'pass' },
            { id: 'b', measured: 1, threshold: 2, unit: 's', source: 'x', result: 'warn' },
        ];
        expect(checksExitCode(passing)).toBe(0);
        const failing = passing[0];
        expect(failing).toBeDefined();
        expect(checksExitCode([...passing, { ...(failing as CheckRow), result: 'fail' }])).toBe(1);
    });

    test('a failed measurement fails every measurement row instead of skipping it', () => {
        const rows = buildTakeCheckRows({
            model: 'clip',
            measurementError: 'ffprobe: exited 1 — unparsed fragment: bad file',
            analysis: null,
        });
        expect(row(rows, 'duration.clip').result).toBe('fail');
        expect(row(rows, 'silence.leading').result).toBe('fail');
        expect(row(rows, 'silence.trailing').result).toBe('fail');
        expect(row(rows, 'duration.clip').note).toContain('ffprobe: exited 1');
        expect(checksExitCode(rows)).toBe(1);
    });
});

describe('AC2 — checks.json is written, read back and merged', () => {
    test('runTakeChecks measures, writes <artifact>.checks.json and returns the exit code', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-checks-'));
        try {
            const artifactPath = join(dir, 'lofi-pro-take1.wav');
            writeFileSync(artifactPath, 'not really audio');
            const { runner } = capturedRunner();
            const outcome = await runTakeChecks({
                artifactPath,
                model: 'pro',
                durationTarget: '0:30',
                analysis: ANALYSIS,
                briefStyle: 'at 78 BPM in D minor',
                briefSectionCount: 3,
                runner,
            });
            expect(outcome.checksPath).toBe(`${artifactPath}${CHECKS_SUFFIX}`);
            expect(outcome.checksPath).toBe(`${artifactPath}.checks.json`);
            expect(outcome.exitCode).toBe(1); // 2 s leading + 4 s trailing silence on this fixture
            expect(outcome.ok).toBe(false);
            expect(outcome.measurement?.probe.durationSeconds).toBe(34);
            const written = await readChecks(outcome.checksPath);
            expect(written.map((candidate) => candidate.id)).toContain('duration.target');
            expect(written.length).toBe(outcome.rows.length);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a measurement failure still writes a checks file naming the tool', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-checks-'));
        try {
            const artifactPath = join(dir, 'broken-clip.wav');
            writeFileSync(artifactPath, 'not really audio');
            const { runner } = capturedRunner({ exitCode: 1 });
            const outcome = await runTakeChecks({ artifactPath, model: 'clip', runner });
            expect(outcome.exitCode).toBe(1);
            expect(outcome.measurement).toBeUndefined();
            const written = await readChecks(checksPathFor(artifactPath));
            expect(written.find((candidate) => candidate.id === 'duration.clip')?.note).toContain('measurement failed');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('merge replaces by id and keeps everything else', () => {
        const existing: CheckRow[] = [
            {
                id: 'duration.clip',
                measured: 30,
                threshold: '25–35',
                unit: 's',
                source: 'ffprobe 8.1.2',
                result: 'pass',
            },
            { id: 'silence.leading', measured: 0, threshold: 1, unit: 's', source: 'ffmpeg 8.1.2', result: 'pass' },
        ];
        const merged = mergeChecks(existing, [
            { id: 'silence.leading', measured: 2, threshold: 1, unit: 's', source: 'ffmpeg 8.1.2', result: 'fail' },
            {
                id: 'delivery.true_peak',
                measured: -0.4,
                threshold: -1,
                unit: 'dBTP',
                source: 'ffmpeg 8.1.2',
                result: 'fail',
            },
        ]);
        expect(merged.map((candidate) => candidate.id)).toEqual([
            'duration.clip',
            'silence.leading',
            'delivery.true_peak',
        ]);
        expect(merged[1]?.result).toBe('fail');
    });

    test('a malformed or foreign checks file reads as empty rather than throwing', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-checks-'));
        try {
            const path = join(dir, 'x.checks.json');
            expect(await readChecks(path)).toEqual([]);
            await writeChecks(path, [{ id: 'a', measured: 1, threshold: 1, unit: 's', source: 'x', result: 'pass' }]);
            expect(JSON.parse(serializeChecks([]))).toEqual([]);
            writeFileSync(path, 'not json');
            expect(await readChecks(path)).toEqual([]);
            writeFileSync(path, JSON.stringify({ not: 'an array' }));
            expect(await readChecks(path)).toEqual([]);
            writeFileSync(path, JSON.stringify([{ id: 1 }, { id: 'kept' }]));
            expect((await readChecks(path)).map((candidate) => candidate.id)).toEqual(['kept']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('AC4 — delivery rows are computed from the profile and the encoded output', () => {
    const profile = resolveDeliveryProfile('streaming');

    test('the streaming profile passes on the captured mastered measurement', async () => {
        const { runner } = capturedRunner({
            loudnorm: fixtureText('loudnorm-delivery.txt'),
            probe: fixtureText('ffprobe-mastered.json'),
        });
        const measurement = await measureAudio('mastered.wav', { runner });
        const rows = buildDeliveryCheckRows({ profile, profileName: 'streaming', measurement });
        expect(row(rows, 'delivery.integrated_loudness').measured).toBe(-14);
        expect(row(rows, 'delivery.integrated_loudness').threshold).toBe('-15–-13');
        expect(row(rows, 'delivery.integrated_loudness').result).toBe('pass');
        expect(row(rows, 'delivery.true_peak').measured).toBe(-13.27);
        expect(row(rows, 'delivery.true_peak').threshold).toBe(-1);
        expect(row(rows, 'delivery.true_peak').result).toBe('pass');
        expect(row(rows, 'delivery.sample_rate').measured).toBe(44_100);
        expect(row(rows, 'delivery.sample_rate').result).toBe('pass');
        rows.forEach(expectRowShape);
    });

    test('an encoded true peak of -0.4 dBTP fails against the -1 dBTP ceiling', () => {
        const measurement: AudioMeasurement = {
            probe: { durationSeconds: 34, codec: 'pcm_s16le', sampleRate: 44_100, channels: 2, container: 'wav' },
            loudness: {
                integratedLufs: -14,
                truePeakDbtp: -0.4,
                loudnessRangeLu: 1.8,
                thresholdLufs: -24,
                targetOffsetDb: 0,
            },
            silence: { leadingSeconds: 0, trailingSeconds: 0, spans: [] },
            tools: { ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' },
        };
        const rows = buildDeliveryCheckRows({ profile, profileName: 'streaming', measurement });
        const truePeak = row(rows, 'delivery.true_peak');
        expect(truePeak.measured).toBe(-0.4);
        expect(truePeak.threshold).toBe(-1);
        expect(truePeak.result).toBe('fail');
        expect(row(rows, 'delivery.integrated_loudness').result).toBe('pass');
        expect(rows.every((candidate) => candidate.id.startsWith('delivery.'))).toBe(true);
    });

    test('integrated loudness outside ±1 LU fails, and a 192 kHz output fails the rate row', () => {
        const drift: AudioMeasurement = {
            probe: { durationSeconds: 34, codec: 'pcm_s16le', sampleRate: 192_000, channels: 2, container: 'wav' },
            loudness: {
                integratedLufs: -12.5,
                truePeakDbtp: -1.4,
                loudnessRangeLu: 1.8,
                thresholdLufs: -24,
                targetOffsetDb: 0,
            },
            silence: { leadingSeconds: 0, trailingSeconds: 0, spans: [] },
            tools: { ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' },
        };
        const rows = buildDeliveryCheckRows({ profile, profileName: 'streaming', measurement: drift });
        expect(row(rows, 'delivery.integrated_loudness').result).toBe('fail');
        expect(row(rows, 'delivery.true_peak').result).toBe('pass');
        expect(row(rows, 'delivery.sample_rate').result).toBe('fail');
        expect(row(rows, 'delivery.sample_rate').measured).toBe(192_000);
    });

    test('an unmeasurable delivery fails its rows with the tool error recorded', () => {
        const rows = buildDeliveryCheckRows({
            profile,
            profileName: 'streaming',
            measurementError: 'ffmpeg loudnorm: exited 1',
        });
        expect(rows).toHaveLength(3);
        expect(rows.every((candidate) => candidate.result === 'fail')).toBe(true);
        expect(row(rows, 'delivery.true_peak').note).toContain('ffmpeg loudnorm: exited 1');
        expect(row(rows, 'delivery.true_peak').measured).toBeNull();
    });

    test('the profile drives the numbers, not a constant', () => {
        const channels = { lufs: -16, truePeak: -2, container: 'wav' as const, sampleRate: 48_000 };
        const measurement: AudioMeasurement = {
            probe: { durationSeconds: 34, codec: 'pcm_s16le', sampleRate: 48_000, channels: 2, container: 'wav' },
            loudness: {
                integratedLufs: -16,
                truePeakDbtp: -2.5,
                loudnessRangeLu: 2,
                thresholdLufs: -26,
                targetOffsetDb: 0,
            },
            silence: { leadingSeconds: 0, trailingSeconds: 0, spans: [] },
            tools: { ffprobe: 'ffprobe 8.1.2', ffmpeg: 'ffmpeg 8.1.2' },
        };
        const rows = buildDeliveryCheckRows({ profile: channels, profileName: 'channels', measurement });
        expect(row(rows, 'delivery.integrated_loudness').threshold).toBe('-17–-15');
        expect(row(rows, 'delivery.true_peak').threshold).toBe(-2);
        expect(rows.every((candidate) => candidate.result === 'pass')).toBe(true);
        expect(BUILTIN_DELIVERY_PROFILES.streaming.lufs).toBe(-14);
    });
});
