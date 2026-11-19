/**
 * Take checks and the delivery check (task 0405 R2/R4) plus the
 * `<artifact>.checks.json` record they share.
 *
 * **Take checks answer "is this generation usable?"** and run *before* the
 * judge: duration against the brief, dead air at either edge, and the presence of
 * the instance analysis. They deliberately never look at loudness — raw provider
 * output has arbitrary loudness, so a loudness gate here would fail every take
 * (the gate-order bug 0405 exists to fix). BPM/key/section agreement with the
 * brief is `warn` only, because the instance analysis is itself a model estimate.
 *
 * **Delivery checks answer "does the delivered file hit the target?"** and run
 * *after* master, on the encoded output (R4) — lossy encoding can push true peak
 * back over the ceiling, so measuring the intermediate would miss exactly the
 * failure the check exists for. `delivery.*` rows are appended to the same
 * `checks.json`.
 *
 * **Every row carries `id`, `measured`, `threshold`, `unit`, `source` and
 * `result`** (R2). `source` is `<tool> <version>` from the measurement's own
 * `-version` banner, so a report can say which ffmpeg decided. A check that could
 * not be measured is `fail` with a `note` explaining why — never skipped.
 */

import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { MusicModel } from '../brief';
import { durationSeconds } from '../brief';
import { type AudioMeasurement, AudioToolError, type MeasureOptions, measureAudio } from './measure';
import { DELIVERY_LOUDNESS_TOLERANCE_LU, type DeliveryProfile } from './profile';

/** `<artifact>.checks.json` suffix (R2). */
export const CHECKS_SUFFIX = '.checks.json';

/**
 * Leading-silence ceiling in seconds. One second of dead air at the head is
 * already an edit on every social platform; anything longer looks like a broken
 * export rather than a musical intro.
 */
export const LEADING_SILENCE_MAX_SECONDS = 1;

/**
 * Trailing-silence ceiling in seconds. A three-second tail is a normal reverb
 * decay and a usable loop/outro handle; a longer one is dead air a platform will
 * keep counting against the runtime.
 */
export const TRAILING_SILENCE_MAX_SECONDS = 3;

/** Pro duration tolerance as a fraction of the target (R2: ±20%). */
export const PRO_DURATION_TOLERANCE_RATIO = 0.2;

/**
 * Pro duration tolerance floor in seconds (R2: "±20% or ±10 s, whichever is
 * larger"). The floor exists because a provider take of a 0:30 target is never
 * musically 30.0 s: ±10 s accepts a real 0:24–0:36 take instead of failing on
 * generation jitter.
 */
export const PRO_DURATION_TOLERANCE_FLOOR_SECONDS = 10;

/** Clip takes are a fixed short form: 25–35 s (R2). */
export const CLIP_DURATION_MIN_SECONDS = 25;
export const CLIP_DURATION_MAX_SECONDS = 35;

/** BPM agreement tolerance for the warn-only analysis check: ±10% of the brief's figure. */
export const BPM_TOLERANCE_RATIO = 0.1;

/** Decimal places every measured value is rounded to before it is compared or recorded. */
const REPORT_DIGITS = 2;

/** One row's outcome. `fail` is the only result that makes a command exit non-zero (R2). */
export type CheckResult = 'pass' | 'warn' | 'fail';

/** One recorded check (R2's required field set, plus an optional explanation). */
export interface CheckRow {
    /** Dotted id: `duration.target`, `silence.leading`, `delivery.true_peak`, … */
    id: string;
    /** What was measured; `null` when the measurement itself failed. */
    measured: number | string | null;
    /** The limit it was compared against: a ceiling number or a `min–max` band string. */
    threshold: number | string | null;
    unit: string;
    /** `<tool> <version>`, e.g. `ffprobe 8.1.2`. */
    source: string;
    result: CheckResult;
    /** Why a row is `warn`/`fail` when the numbers alone do not say it. */
    note?: string;
}

/** Everything the take checks need. */
export interface TakeCheckInput {
    /** `pro` gates the brief's duration target; `clip` uses the fixed 25–35 s window. */
    model: MusicModel;
    /** The brief's recorded `m:ss` target (pro only). */
    durationTarget?: string;
    /** The take's measurement; absent when measuring failed. */
    measurement?: AudioMeasurement;
    /** The measurement failure, when there is one — every measurement row then fails. */
    measurementError?: string;
    /** The instance analysis (`null` when the instance carried none). */
    analysis?: Record<string, unknown> | null;
    /** Resolved style/theme text the brief declares, for the BPM/key agreement checks. */
    briefStyle?: string;
    /** `brief.structure.length`, for the section-count agreement check. */
    briefSectionCount?: number;
}

/** Round a measured value for recording; keeps `-Infinity` honest instead of printing `NaN`. */
function round(value: number): number {
    if (!Number.isFinite(value)) {
        return value;
    }
    const factor = 10 ** REPORT_DIGITS;
    return Math.round(value * factor) / factor;
}

/** `24–36` — a band threshold as one readable string. */
function band(low: number, high: number): string {
    return `${String(round(low))}–${String(round(high))}`;
}

/** Build one measurement-derived row, failing it when the measurement is unavailable. */
function measurementRow(input: {
    id: string;
    measured: number | string | null;
    threshold: number | string;
    unit: string;
    source: string;
    result: CheckResult;
    note?: string;
}): CheckRow {
    return {
        id: input.id,
        measured: input.measured === null ? null : round(Number(input.measured)),
        threshold: input.threshold,
        unit: input.unit,
        source: input.source,
        result: input.result,
        ...(input.note === undefined ? {} : { note: input.note }),
    };
}

/** `null`-measured row for a check whose measurement never landed (R2: fail, never skip). */
function unmeasuredRow(id: string, threshold: number | string, unit: string, source: string, note: string): CheckRow {
    return { id, measured: null, threshold, unit, source, result: 'fail', note };
}

/** What the brief declares musically: the BPM band and key the analysis is compared against. */
export interface BriefMusicalTargets {
    bpm?: { low: number; high: number };
    key?: string;
}

/** Canonicalise `D minor` / `Dm` / `d MINOR` to `D minor`. */
export function canonicalKey(text: string): string | undefined {
    const match = /([A-Ga-g])([#b]?)\s*(minor|major|min|maj|m)\b/i.exec(text);
    if (match === null) {
        return undefined;
    }
    const root = `${(match[1] ?? '').toUpperCase()}${match[2] ?? ''}`;
    const qualityRaw = (match[3] ?? '').toLowerCase();
    const quality = qualityRaw.startsWith('m') && qualityRaw !== 'maj' ? 'minor' : 'major';
    return `${root} ${quality}`;
}

/**
 * Read the BPM band and key a brief's style/theme text declares.
 *
 * Only what the text states is returned: a range (`100-115 BPM`) is used as-is;
 * a single figure (`at 78 BPM`) becomes ±{@link BPM_TOLERANCE_RATIO} because a
 * point estimate from a preset is not a metronomic command. Both are warn-only
 * comparisons (R2), so a loose band loses nothing.
 */
export function briefMusicalTargets(text: string | undefined): BriefMusicalTargets {
    if (text === undefined || text.trim() === '') {
        return {};
    }
    const targets: BriefMusicalTargets = {};
    const range = /(\d{2,3})\s*(?:-|–|—|to)\s*(\d{2,3})\s*bpm/i.exec(text);
    const single = /(\d{2,3})\s*bpm/i.exec(text);
    if (range !== null) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        targets.bpm = { low: Math.min(low, high), high: Math.max(low, high) };
    } else if (single !== null) {
        const value = Number(single[1]);
        targets.bpm = { low: value * (1 - BPM_TOLERANCE_RATIO), high: value * (1 + BPM_TOLERANCE_RATIO) };
    }
    const key = /(?:in\s+)?([A-G][#b]?\s*(?:minor|major|min|maj|m)\b)/i.exec(text);
    if (key !== null) {
        const canonical = canonicalKey(key[1] ?? '');
        if (canonical !== undefined) {
            targets.key = canonical;
        }
    }
    return targets;
}

/** Read a positive finite number from an analysis field (`"78"` or `78`), else `undefined`. */
function analysisNumber(analysis: Record<string, unknown>, field: string): number | undefined {
    const raw = analysis[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
        return Number(raw);
    }
    return undefined;
}

/** Read a section count from `analysis.sections` (an array or a number), else `undefined`. */
function analysisSectionCount(analysis: Record<string, unknown>): number | undefined {
    const sections = analysis.sections ?? analysis.section_count;
    if (Array.isArray(sections)) {
        return sections.length;
    }
    if (typeof sections === 'number' && Number.isFinite(sections)) {
        return sections;
    }
    if (typeof sections === 'string' && Number.isFinite(Number(sections))) {
        return Number(sections);
    }
    return undefined;
}

/**
 * Build the pre-master take check rows (R2).
 *
 * Order is stable (`duration`, `silence.*`, `analysis.*`) so a diff of two
 * `checks.json` files is readable. Loudness is absent by design: R2 keeps raw
 * loudness out of the take gate.
 */
export function buildTakeCheckRows(input: TakeCheckInput): CheckRow[] {
    const rows: CheckRow[] = [];
    const measurement = input.measurement;
    const failure = input.measurementError;
    const ffprobeSource = measurement?.tools.ffprobe ?? 'ffprobe';
    const ffmpegSource = measurement?.tools.ffmpeg ?? 'ffmpeg';
    const probeNote = failure === undefined ? 'no measurement' : failure;

    // ── duration (R2) ───────────────────────────────────────────────────────
    if (input.model === 'pro') {
        const target = input.durationTarget;
        const targetSeconds = target === undefined ? undefined : safeDurationSeconds(target);
        const tolerance =
            targetSeconds === undefined
                ? PRO_DURATION_TOLERANCE_FLOOR_SECONDS
                : Math.max(targetSeconds * PRO_DURATION_TOLERANCE_RATIO, PRO_DURATION_TOLERANCE_FLOOR_SECONDS);
        const threshold =
            targetSeconds === undefined
                ? `brief durationTarget (missing)`
                : band(Math.max(0, targetSeconds - tolerance), targetSeconds + tolerance);
        if (targetSeconds === undefined) {
            rows.push(
                unmeasuredRow(
                    'duration.target',
                    threshold,
                    's',
                    ffprobeSource,
                    'the resolved job recorded no durationTarget, so the take cannot be checked against the brief',
                ),
            );
        } else if (measurement === undefined) {
            rows.push(
                unmeasuredRow('duration.target', threshold, 's', ffprobeSource, `measurement failed: ${probeNote}`),
            );
        } else {
            const measured = measurement.probe.durationSeconds;
            rows.push(
                measurementRow({
                    id: 'duration.target',
                    measured,
                    threshold,
                    unit: 's',
                    source: ffprobeSource,
                    result:
                        measured >= targetSeconds - tolerance && measured <= targetSeconds + tolerance
                            ? 'pass'
                            : 'fail',
                    note: `brief target ${target ?? ''} ±${String(round(tolerance))} s`,
                }),
            );
        }
    } else {
        const threshold = band(CLIP_DURATION_MIN_SECONDS, CLIP_DURATION_MAX_SECONDS);
        if (measurement === undefined) {
            rows.push(
                unmeasuredRow('duration.clip', threshold, 's', ffprobeSource, `measurement failed: ${probeNote}`),
            );
        } else {
            const measured = measurement.probe.durationSeconds;
            rows.push(
                measurementRow({
                    id: 'duration.clip',
                    measured,
                    threshold,
                    unit: 's',
                    source: ffprobeSource,
                    result:
                        measured >= CLIP_DURATION_MIN_SECONDS && measured <= CLIP_DURATION_MAX_SECONDS
                            ? 'pass'
                            : 'fail',
                }),
            );
        }
    }

    // ── silence (R2) ────────────────────────────────────────────────────────
    const silenceRows: Array<{ id: string; measuredKey: 'leadingSeconds' | 'trailingSeconds'; ceiling: number }> = [
        { id: 'silence.leading', measuredKey: 'leadingSeconds', ceiling: LEADING_SILENCE_MAX_SECONDS },
        { id: 'silence.trailing', measuredKey: 'trailingSeconds', ceiling: TRAILING_SILENCE_MAX_SECONDS },
    ];
    for (const { id, measuredKey, ceiling } of silenceRows) {
        if (measurement === undefined) {
            rows.push(
                unmeasuredRow(id, ceiling, 's', `${ffmpegSource} silencedetect`, `measurement failed: ${probeNote}`),
            );
            continue;
        }
        const measured = measurement.silence[measuredKey];
        rows.push(
            measurementRow({
                id,
                measured,
                threshold: ceiling,
                unit: 's',
                source: `${ffmpegSource} silencedetect`,
                result: measured <= ceiling ? 'pass' : 'fail',
            }),
        );
    }

    // ── instance analysis present (R2) ──────────────────────────────────────
    const analysis = input.analysis ?? null;
    const analysisPresent = analysis !== null && Object.keys(analysis).length > 0;
    rows.push({
        id: 'analysis.present',
        measured: analysisPresent ? 'present' : 'absent',
        threshold: 'present',
        unit: 'state',
        source: 'lyria instance analysis',
        result: analysisPresent ? 'pass' : 'fail',
        ...(analysisPresent
            ? {}
            : { note: 'the take carries no instance analysis; run the analyze step before judging' }),
    });

    // ── brief vs analysis agreement (warn only, R2) ─────────────────────────
    const targets = briefMusicalTargets(input.briefStyle);
    if (targets.bpm !== undefined) {
        const threshold = band(targets.bpm.low, targets.bpm.high);
        const bpm = analysisPresent && analysis !== null ? analysisNumber(analysis, 'bpm') : undefined;
        if (bpm === undefined) {
            rows.push({
                id: 'analysis.bpm',
                measured: null,
                threshold,
                unit: 'bpm',
                source: 'lyria instance analysis',
                result: 'warn',
                note: 'the analysis carries no BPM, so agreement with the brief could not be compared',
            });
        } else {
            rows.push({
                id: 'analysis.bpm',
                measured: round(bpm),
                threshold,
                unit: 'bpm',
                source: 'lyria instance analysis',
                result: bpm >= targets.bpm.low && bpm <= targets.bpm.high ? 'pass' : 'warn',
                ...(bpm >= targets.bpm.low && bpm <= targets.bpm.high
                    ? {}
                    : { note: 'the analysis estimate is outside the brief band; a warn, never a fail (R2)' }),
            });
        }
    }
    if (targets.key !== undefined) {
        const rawKey = analysisPresent && analysis !== null ? (analysis.key ?? analysis.key_signature) : undefined;
        const measured = typeof rawKey === 'string' && rawKey.trim() !== '' ? (canonicalKey(rawKey) ?? rawKey) : null;
        rows.push({
            id: 'analysis.key',
            measured,
            threshold: targets.key,
            unit: 'key',
            source: 'lyria instance analysis',
            result: measured === null ? 'warn' : measured.toLowerCase() === targets.key.toLowerCase() ? 'pass' : 'warn',
            ...(measured === null
                ? { note: 'the analysis carries no key, so agreement with the brief could not be compared' }
                : {}),
        });
    }
    if (input.briefSectionCount !== undefined && input.briefSectionCount > 0) {
        const sections = analysisPresent && analysis !== null ? analysisSectionCount(analysis) : undefined;
        rows.push({
            id: 'analysis.sections',
            measured: sections ?? null,
            threshold: input.briefSectionCount,
            unit: 'sections',
            source: 'lyria instance analysis',
            result: sections === undefined ? 'warn' : sections === input.briefSectionCount ? 'pass' : 'warn',
            ...(sections === undefined
                ? { note: 'the analysis carries no section list, so agreement with the brief could not be compared' }
                : {}),
        });
    }

    return rows;
}

/** `durationSeconds` for a well-formed `m:ss`, `undefined` for anything else (the schema already rejected it upstream). */
function safeDurationSeconds(value: string): number | undefined {
    try {
        return durationSeconds(value);
    } catch {
        return undefined;
    }
}

/** `true` when no row is `fail` — R2's exit rule. */
export function checksPassed(rows: readonly CheckRow[]): boolean {
    return rows.every((row) => row.result !== 'fail');
}

/** Exit code for a row set: `0` only when nothing failed (R2). */
export function checksExitCode(rows: readonly CheckRow[]): number {
    return checksPassed(rows) ? 0 : 1;
}

/** `<artifact>.checks.json` (R2) — one file per take, shared by take and delivery rows. */
export function checksPathFor(artifactPath: string): string {
    return `${artifactPath}${CHECKS_SUFFIX}`;
}

/** Serialize the row file the way every kk artifact is written: 4-space JSON plus a trailing newline. */
export function serializeChecks(rows: readonly CheckRow[]): string {
    return `${JSON.stringify(rows, null, 4)}\n`;
}

/** Read a checks file back, tolerating a malformed or absent one as "no rows yet". */
export async function readChecks(path: string, fileSystem: FileSystem = createNodeFileSystem()): Promise<CheckRow[]> {
    if (!(await fileSystem.exists(path))) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fileSystem.readFile(path));
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed.filter(
        (row): row is CheckRow => typeof row === 'object' && row !== null && typeof row.id === 'string',
    );
}

/** Write a checks file (`<artifact>.checks.json`). */
export async function writeChecks(
    path: string,
    rows: readonly CheckRow[],
    fileSystem: FileSystem = createNodeFileSystem(),
): Promise<void> {
    await fileSystem.writeFile(path, serializeChecks(rows));
}

/**
 * Merge a fresh row set into an existing checks file: rows with the same `id`
 * are replaced, new ones appended, everything else preserved. The delivery check
 * uses this so `delivery.*` rows join the take rows in one file (R4) without
 * rewriting them.
 */
export function mergeChecks(existing: readonly CheckRow[], incoming: readonly CheckRow[]): CheckRow[] {
    const merged = [...existing];
    for (const row of incoming) {
        const index = merged.findIndex((candidate) => candidate.id === row.id);
        if (index === -1) {
            merged.push(row);
        } else {
            merged[index] = row;
        }
    }
    return merged;
}

/** Outcome of a take check run. */
export interface TakeCheckOutcome {
    /** The rows written to `<artifact>.checks.json`. */
    rows: CheckRow[];
    ok: boolean;
    /** `0` when no row failed, `1` otherwise (R2's "exits non-zero exactly when any check is fail"). */
    exitCode: number;
    checksPath: string;
    /** The measurement, when it landed — 0402's rubric reads these numbers. */
    measurement?: AudioMeasurement;
}

/** Everything {@link runTakeChecks} needs. */
export interface TakeCheckOptions extends TakeCheckInput, MeasureOptions {
    /** The provider take on disk. */
    artifactPath: string;
    /** Override the checks-file path (defaults to {@link checksPathFor}). */
    checksPath?: string;
    fileSystem?: FileSystem;
}

/**
 * Measure a take and write its pre-master checks (R2).
 *
 * A measurement failure is recorded as `fail` rows rather than thrown, so
 * `checks.json` always explains itself and the caller's exit code is the same
 * either way. Any other error (e.g. an unwritable checks path) still throws.
 */
export async function runTakeChecks(options: TakeCheckOptions): Promise<TakeCheckOutcome> {
    const {
        artifactPath,
        model,
        durationTarget,
        analysis,
        briefStyle,
        briefSectionCount,
        checksPath,
        fileSystem,
        ...measure
    } = options;
    let measurement: AudioMeasurement | undefined;
    let measurementError: string | undefined;
    try {
        measurement = await measureAudio(artifactPath, measure);
    } catch (error: unknown) {
        measurementError = error instanceof AudioToolError ? error.message : String(error);
    }
    const rows = buildTakeCheckRows({
        model,
        ...(durationTarget === undefined ? {} : { durationTarget }),
        ...(measurement === undefined ? {} : { measurement }),
        ...(measurementError === undefined ? {} : { measurementError }),
        ...(analysis === undefined ? {} : { analysis }),
        ...(briefStyle === undefined ? {} : { briefStyle }),
        ...(briefSectionCount === undefined ? {} : { briefSectionCount }),
    });
    const path = checksPath ?? checksPathFor(artifactPath);
    await writeChecks(path, rows, fileSystem ?? createNodeFileSystem());
    return {
        rows,
        ok: checksPassed(rows),
        exitCode: checksExitCode(rows),
        checksPath: path,
        ...(measurement === undefined ? {} : { measurement }),
    };
}

/** Everything the delivery check needs. */
export interface DeliveryCheckInput {
    /** The profile the master pass targeted. */
    profile: DeliveryProfile;
    /** The profile's name, recorded in row notes. */
    profileName: string;
    /** The measurement of the **encoded output** (R4), never the intermediate. */
    measurement?: AudioMeasurement;
    /** The measurement failure, when there is one. */
    measurementError?: string;
}

/**
 * Build the post-master delivery rows (R4): integrated loudness inside
 * `lufs ± 1 LU`, true peak at or below the ceiling, and the sample rate the
 * profile asked for (the end-to-end proof of the `-ar` guard).
 *
 * A missing loudness measurement fails the loudness and true-peak rows: a
 * delivery whose target cannot be verified is not a delivery.
 */
export function buildDeliveryCheckRows(input: DeliveryCheckInput): CheckRow[] {
    const { profile, profileName, measurement, measurementError } = input;
    const loudnessSource = `${measurement?.tools.ffmpeg ?? 'ffmpeg'} loudnorm`;
    const probeSource = measurement?.tools.ffprobe ?? 'ffprobe';
    const low = profile.lufs - DELIVERY_LOUDNESS_TOLERANCE_LU;
    const high = profile.lufs + DELIVERY_LOUDNESS_TOLERANCE_LU;
    const loudnessThreshold = band(low, high);
    const rows: CheckRow[] = [];

    if (measurement === undefined) {
        const note = `measurement of the encoded output failed: ${measurementError ?? 'no measurement'}`;
        rows.push(unmeasuredRow('delivery.integrated_loudness', loudnessThreshold, 'LUFS', loudnessSource, note));
        rows.push(unmeasuredRow('delivery.true_peak', profile.truePeak, 'dBTP', loudnessSource, note));
        rows.push(unmeasuredRow('delivery.sample_rate', profile.sampleRate, 'Hz', probeSource, note));
        return rows;
    }

    const integrated = measurement.loudness.integratedLufs;
    rows.push({
        id: 'delivery.integrated_loudness',
        measured: round(integrated),
        threshold: loudnessThreshold,
        unit: 'LUFS',
        source: loudnessSource,
        result: integrated >= low && integrated <= high ? 'pass' : 'fail',
        note: `${profileName} target ${String(profile.lufs)} LUFS ±${String(DELIVERY_LOUDNESS_TOLERANCE_LU)} LU`,
    });
    const truePeak = measurement.loudness.truePeakDbtp;
    rows.push({
        id: 'delivery.true_peak',
        measured: round(truePeak),
        threshold: profile.truePeak,
        unit: 'dBTP',
        source: loudnessSource,
        result: truePeak <= profile.truePeak ? 'pass' : 'fail',
        note: `${profileName} ceiling ${String(profile.truePeak)} dBTP, measured on the encoded output`,
    });
    const sampleRate = measurement.probe.sampleRate;
    rows.push({
        id: 'delivery.sample_rate',
        measured: sampleRate,
        threshold: profile.sampleRate,
        unit: 'Hz',
        source: probeSource,
        result: sampleRate === profile.sampleRate ? 'pass' : 'fail',
        note: 'the `-ar` guard: loudnorm upsamples to 192 kHz unless the output rate is explicit',
    });
    return rows;
}
