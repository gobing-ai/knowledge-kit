/**
 * Loudness normalization — the "master" step (task 0405 R3/R4).
 *
 * **Two passes, one target.** Pass 1 is the `loudnorm=print_format=json`
 * analysis (shared with measurement); pass 2 re-encodes the take with the
 * profile's `I`/`TP` plus pass 1's `measured_I`, `measured_TP`, `measured_LRA`,
 * `measured_thresh` and `offset`. Feeding those back is what makes the pass
 * linear: without them ffmpeg re-measures blindly and the result lands anywhere
 * near the target.
 *
 * **`-ar` is explicit, always.** `loudnorm` resamples internally to 192 kHz, so a
 * pass that does not set the output rate emits a 192 kHz file — the exact bug R3
 * names. The rate comes from the profile, and the delivery check re-probes the
 * output to prove it landed.
 *
 * **Non-destructive.** The output is a new file `<artifact>.<profile>.<ext>`
 * beside the provider take; the take is never opened for writing. "Master" here
 * means loudness and true-peak normalization only — no EQ, no compression, no
 * creative decisions (see `docs/design/music-gen.md` §"not doing").
 *
 * **One delivery check, no loop.** After pass 2 the *encoded output* is
 * re-measured (R4) and `delivery.*` rows are merged into the take's
 * `checks.json`. A failure is reported with its measured values and throws — it
 * never re-runs pass 2, because a profile the take cannot reach (a very dynamic
 * underscore pushed to a hot target) is information for the operator, not
 * something to paper over.
 */

import { extname } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { AudioFormat } from '../brief';
import {
    buildDeliveryCheckRows,
    type CheckRow,
    checksPassed,
    checksPathFor,
    mergeChecks,
    readChecks,
    writeChecks,
} from './checks';
import {
    type AudioMeasurement,
    AudioToolError,
    type LoudnessMeasurement,
    type MeasureOptions,
    measureAudio,
    measureLoudness,
    spawnRunner,
    type ToolOutput,
} from './measure';
import type { DeliveryProfile } from './profile';

/** Profile names are file-name fragments, so they carry only these characters. */
const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Encoder per delivered container. WAV stays lossless 16-bit; MP3 is a deliberate CBR re-encode (R5 default is wav). */
const MASTER_ENCODERS: Readonly<Record<AudioFormat, readonly string[]>> = {
    wav: ['-c:a', 'pcm_s16le'],
    mp3: ['-c:a', 'libmp3lame', '-b:a', '192k'],
};

/** Raised when a master run cannot even start (missing take, unusable profile name colliding with the take). */
export class MasterError extends Error {
    readonly exitCode = 1;

    constructor(message: string) {
        super(`music master: ${message}`);
        this.name = 'MasterError';
    }
}

/**
 * Raised when the post-master delivery check fails (R4). Carries the measured
 * rows so the caller can print numbers instead of a verdict, and no second master
 * pass exists to fall back into.
 */
export class DeliveryCheckFailure extends Error {
    readonly exitCode = 1;
    /** The failing `delivery.*` rows, with measured values and thresholds. */
    readonly rows: CheckRow[];
    /** The encoded output that was measured. */
    readonly outputPath: string;

    constructor(outputPath: string, rows: readonly CheckRow[]) {
        const failing = rows.filter((row) => row.result === 'fail');
        const detail = failing
            .map(
                (row) =>
                    `${row.id} measured ${String(row.measured)} ${row.unit} against ${String(row.threshold)} ${row.unit}`,
            )
            .join('; ');
        super(
            `music master: delivery check failed for ${outputPath}: ${detail} — the profile is not reachable for this take; pick another profile (no re-master is attempted)`,
        );
        this.name = 'DeliveryCheckFailure';
        this.rows = [...rows];
        this.outputPath = outputPath;
    }
}

/** Format a measured loudness value for a `loudnorm` filter argument (`-inf` is legal there). */
export function loudnormValue(value: number): string {
    if (value === Number.NEGATIVE_INFINITY) {
        return '-inf';
    }
    if (value === Number.POSITIVE_INFINITY) {
        return 'inf';
    }
    return String(value);
}

/** `<artifact>.<profile>.<ext>` — the mastered file's path (R3: a new file, never the take). */
export function masterOutputName(takePath: string, profileName: string, container: AudioFormat): string {
    if (!PROFILE_NAME_PATTERN.test(profileName)) {
        throw new MasterError(
            `profile name ${JSON.stringify(profileName)} cannot be used in a file name (expected ${PROFILE_NAME_PATTERN.source})`,
        );
    }
    const extension = extname(takePath);
    const stem = extension === '' ? takePath : takePath.slice(0, takePath.length - extension.length);
    return `${stem}.${profileName}.${container}`;
}

/** Everything the pass-2 argv needs. */
export interface MasterPassInput {
    takePath: string;
    outputPath: string;
    profile: DeliveryProfile;
    /** Pass 1's measurement — `measured_*` and `offset` come from here (R3). */
    firstPass: LoudnessMeasurement;
    ffmpegBin?: string;
}

/**
 * Build the pass-2 `ffmpeg` argv: the target, pass 1's measurements, the
 * profile's `LRA` (only when set — forcing one invites dynamic mode), the explicit
 * `-ar`, the container's encoder, and the new output path.
 */
export function masterPassArgs(input: MasterPassInput): string[] {
    const filter = [
        `loudnorm=I=${loudnormValue(input.profile.lufs)}`,
        `TP=${loudnormValue(input.profile.truePeak)}`,
        ...(input.profile.lra === undefined ? [] : [`LRA=${loudnormValue(input.profile.lra)}`]),
        `measured_I=${loudnormValue(input.firstPass.integratedLufs)}`,
        `measured_TP=${loudnormValue(input.firstPass.truePeakDbtp)}`,
        `measured_LRA=${loudnormValue(input.firstPass.loudnessRangeLu)}`,
        `measured_thresh=${loudnormValue(input.firstPass.thresholdLufs)}`,
        `offset=${loudnormValue(input.firstPass.targetOffsetDb)}`,
        'print_format=json',
    ].join(':');
    return [
        input.ffmpegBin ?? 'ffmpeg',
        '-y',
        '-hide_banner',
        '-nostats',
        '-i',
        input.takePath,
        '-af',
        filter,
        '-ar',
        String(input.profile.sampleRate),
        ...MASTER_ENCODERS[input.profile.container],
        input.outputPath,
    ];
}

/** Everything {@link masterTake} needs. */
export interface MasterInput extends MeasureOptions {
    /** The provider take (read only). */
    takePath: string;
    /** The profile's name, used in the output file name and the row notes. */
    profileName: string;
    /** The resolved profile (see `resolveDeliveryProfile`). */
    profile: DeliveryProfile;
    /** Override the output path; defaults to {@link masterOutputName}. */
    outputPath?: string;
    /** Override the checks file; defaults to `<take>.checks.json`. */
    checksPath?: string;
    fileSystem?: FileSystem;
}

/** What a master run produced. */
export interface MasterResult {
    /** The new file: `<artifact>.<profile>.<ext>`. */
    outputPath: string;
    /** Pass 1's measurement of the take. */
    firstPass: LoudnessMeasurement;
    /** The delivery rows written to `checks.json`. */
    delivery: CheckRow[];
    /** The measurement of the encoded output. */
    deliveryMeasurement: AudioMeasurement;
    checksPath: string;
}

/**
 * Normalize one take to a delivery profile (R3) and check the encoded output
 * against it (R4).
 *
 * Two spawns write nothing (`loudnorm` analysis ×2 for measurement) and exactly
 * one spawn writes the output. On a delivery failure the rows are already merged
 * into `checks.json` before {@link DeliveryCheckFailure} is thrown, so the file
 * explains the failure even when the command exits non-zero.
 */
export async function masterTake(input: MasterInput): Promise<MasterResult> {
    const fileSystem = input.fileSystem ?? createNodeFileSystem();
    const takePath = input.takePath;
    if (!(await fileSystem.exists(takePath))) {
        throw new MasterError(`take not found: ${takePath}`);
    }
    const outputPath = input.outputPath ?? masterOutputName(takePath, input.profileName, input.profile.container);
    if (outputPath === takePath) {
        throw new MasterError(
            `refusing to overwrite the provider take (${takePath}); the output must be a new <artifact>.<profile>.<ext> file`,
        );
    }
    const checksPath = input.checksPath ?? checksPathFor(takePath);
    const runner = input.runner;

    // Pass 1: measure the take (no write).
    const firstPass = await measureLoudness(takePath, input);

    // Pass 2: the single write.
    const argv = masterPassArgs({
        takePath,
        outputPath,
        profile: input.profile,
        firstPass,
        ...(input.ffmpegBin === undefined ? {} : { ffmpegBin: input.ffmpegBin }),
    });
    const output: ToolOutput = await (runner ?? spawnRunner)(argv);
    if (output.exitCode !== 0) {
        throw new AudioToolError(
            `${input.ffmpegBin ?? 'ffmpeg'} loudnorm`,
            'exit',
            `exited ${String(output.exitCode)} while writing ${outputPath}`,
            output.stderr.trim() === '' ? output.stdout : output.stderr,
        );
    }
    if (!(await fileSystem.exists(outputPath))) {
        throw new MasterError(`ffmpeg reported success but produced no file: ${outputPath}`);
    }

    // Delivery check: measure the encoded output, never the intermediate (R4).
    let deliveryMeasurement: AudioMeasurement | undefined;
    let measurementError: string | undefined;
    try {
        deliveryMeasurement = await measureAudio(outputPath, input);
    } catch (error: unknown) {
        measurementError = error instanceof AudioToolError ? error.message : String(error);
    }
    const delivery = buildDeliveryCheckRows({
        profile: input.profile,
        profileName: input.profileName,
        ...(deliveryMeasurement === undefined ? {} : { measurement: deliveryMeasurement }),
        ...(measurementError === undefined ? {} : { measurementError }),
    });
    const merged = mergeChecks(await readChecks(checksPath, fileSystem), delivery);
    await writeChecks(checksPath, merged, fileSystem);
    if (!checksPassed(delivery)) {
        throw new DeliveryCheckFailure(outputPath, delivery);
    }
    if (deliveryMeasurement === undefined) {
        // Unreachable in practice: a missing measurement fails every delivery row above.
        throw new DeliveryCheckFailure(outputPath, delivery);
    }
    return { outputPath, firstPass, delivery, deliveryMeasurement, checksPath };
}
