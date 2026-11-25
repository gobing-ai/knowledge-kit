/**
 * Audio measurement (task 0405 R1): duration, codec, sample rate and channels
 * from `ffprobe`; integrated loudness, true peak, loudness range and threshold
 * from an `ffmpeg loudnorm=print_format=json` analysis pass; leading/trailing
 * silence from `ffmpeg silencedetect`.
 *
 * **One injectable runner.** Every spawn goes through {@link AudioToolRunner}:
 * the default runner is the ts-runtime `ProcessExecutor` seam (`NodeProcessExecutor`,
 * the only sanctioned process seam — see `.spur/rules/strict/runtime-boundaries.yaml`),
 * and tests inject a runner that replays captured stdout/stderr, so CI needs no
 * ffmpeg at all (R6/AC6).
 *
 * **Parsers are pure.** {@link parseProbeOutput}, {@link parseLoudnormOutput} and
 * {@link parseSilencedetectOutput} take captured text and return typed values —
 * no spawn, no clock, no filesystem — so the fixtures in
 * `tests/fixtures/audio/` drive them directly. A tool output that cannot be
 * parsed raises {@link AudioToolError}, which always names the tool and carries
 * the unparsed fragment (AC1): "measurement missing" can never be mistaken for
 * "measurement clean".
 */

import { NodeProcessExecutor, type ProcessExecutor } from '@gobing-ai/ts-runtime';

/** One tool invocation's captured result. */
export interface ToolOutput {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Injectable spawn seam: `argv[0]` is the binary (`ffmpeg`/`ffprobe`), the rest
 * are its arguments. Resolves with the captured streams; may reject only when
 * the binary could not be spawned at all.
 */
export type AudioToolRunner = (argv: readonly string[]) => Promise<ToolOutput>;

/** Why a measurement could not be produced. */
export type AudioToolErrorKind = 'spawn' | 'exit' | 'malformed';

/**
 * Raised whenever a measurement is unavailable: the binary is missing, it exited
 * non-zero, or its output did not parse. `tool` and `fragment` are always
 * populated so a check record can name both the tool and the text it could not
 * read (AC1).
 */
export class AudioToolError extends Error {
    /** Process exit code the command layer surfaces (`fail`, never a silent skip). */
    readonly exitCode = 1;
    /** Tool that failed, e.g. `ffprobe` or `ffmpeg loudnorm`. */
    readonly tool: string;
    readonly kind: AudioToolErrorKind;
    /** The unparsed text (or the leading slice of it) — AC1's fragment. */
    readonly fragment: string;

    constructor(tool: string, kind: AudioToolErrorKind, message: string, fragment: string) {
        const trimmed = fragment.trim();
        super(`${tool}: ${message}${trimmed === '' ? ' (no output)' : ` — unparsed fragment: ${trimmed}`}`);
        this.name = 'AudioToolError';
        this.tool = tool;
        this.kind = kind;
        this.fragment = trimmed;
    }
}

/** Longest tool-output fragment an error or check record carries. */
const MAX_FRAGMENT_LENGTH = 400;

/** Trim a tool output to something an error message or a check note can hold. */
function fragmentOf(text: string): string {
    const trimmed = text.trim();
    return trimmed.length <= MAX_FRAGMENT_LENGTH ? trimmed : `${trimmed.slice(0, MAX_FRAGMENT_LENGTH)}…`;
}

/** Default binary names; the options below override them for a non-PATH install. */
export const DEFAULT_FFMPEG_BIN = 'ffmpeg';
export const DEFAULT_FFPROBE_BIN = 'ffprobe';

/** Seek/decoding tolerance when deciding a silence span touches the file's start or end. */
export const SILENCE_EDGE_TOLERANCE_SECONDS = 0.05;

/** Default `silencedetect` noise floor: −50 dB sits below any musical tail. */
export const DEFAULT_SILENCE_NOISE_DB = -50;

/** Default `silencedetect` minimum span: shorter gaps are phrasing, not dead air. */
export const DEFAULT_SILENCE_MIN_SECONDS = 0.5;

/**
 * The one process executor every default audio spawn uses: buffered capture, no
 * per-call allocation, no registry/event wiring (an audio measurement is not a
 * supervised process).
 */
const processExecutor = new NodeProcessExecutor();

/**
 * Build an {@link AudioToolRunner} over any ts-runtime {@link ProcessExecutor}.
 *
 * `ProcessResult` reports `exitCode: number | null` and does not throw for a tool
 * it could not start, so this adapter keeps the {@link ToolOutput} shape the
 * parsers read: a null code is "the tool never ran to an exit" (missing binary or
 * a signal kill, both surfaced as {@link AudioToolError} kind `spawn` with the
 * install hint) and every real exit code passes through untouched.
 */
export function createSpawnRunner(executor: ProcessExecutor = processExecutor): AudioToolRunner {
    return async (argv) => {
        const [bin, ...args] = argv;
        if (bin === undefined) {
            throw new AudioToolError('ffmpeg', 'spawn', 'no binary was given to the audio runner', '');
        }
        const result = await executor.run({ command: bin, args, label: `audio ${bin}` });
        if (result.exitCode === null) {
            const detail = result.stderr.trim();
            const killed = result.signal === undefined ? '' : ` (killed by ${result.signal})`;
            throw new AudioToolError(
                bin,
                'spawn',
                `could not be executed${detail === '' ? '' : ` (${detail})`}${killed} — install ffmpeg or point ffmpegBin/ffprobeBin at it`,
                '',
            );
        }
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    };
}

/** The default runner: the ts-runtime {@link ProcessExecutor} seam, buffered. */
export const spawnRunner: AudioToolRunner = createSpawnRunner();

/** Where the measurement comes from: binary names plus the injected runner. */
export interface MeasureOptions {
    runner?: AudioToolRunner;
    ffmpegBin?: string;
    ffprobeBin?: string;
    /** `silencedetect` noise floor in dB (default {@link DEFAULT_SILENCE_NOISE_DB}). */
    silenceNoiseDb?: number;
    /** `silencedetect` minimum duration in seconds (default {@link DEFAULT_SILENCE_MIN_SECONDS}). */
    silenceMinSeconds?: number;
}

/** `ffprobe` argv: one audio stream plus the container/format block. */
export function ffprobeArgs(path: string, bin = DEFAULT_FFPROBE_BIN): string[] {
    return [bin, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path];
}

/** `ffmpeg` argv for the loudness analysis pass (`-f null -` decodes without writing audio). */
export function loudnormArgs(path: string, bin = DEFAULT_FFMPEG_BIN): string[] {
    return [bin, '-hide_banner', '-nostats', '-i', path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'];
}

/** `ffmpeg` argv for the silence scan. */
export function silencedetectArgs(
    path: string,
    options: { bin?: string; noiseDb?: number; minSeconds?: number } = {},
): string[] {
    const noise = options.noiseDb ?? DEFAULT_SILENCE_NOISE_DB;
    const minSeconds = options.minSeconds ?? DEFAULT_SILENCE_MIN_SECONDS;
    return [
        options.bin ?? DEFAULT_FFMPEG_BIN,
        '-hide_banner',
        '-nostats',
        '-i',
        path,
        '-af',
        `silencedetect=noise=${String(noise)}dB:d=${String(minSeconds)}`,
        '-f',
        'null',
        '-',
    ];
}

/** `ffprobe -version` / `ffmpeg -version` — the `<tool> <version>` source label. */
export function versionArgs(bin: string): string[] {
    return [bin, '-version'];
}

/** Container/stream facts `ffprobe` reported. */
export interface AudioProbe {
    /** Whole-file duration in seconds (stream duration when present, else the format's). */
    durationSeconds: number;
    /** `codec_name` of the first audio stream (`pcm_s16le`, `mp3`, …). */
    codec: string;
    sampleRate: number;
    channels: number;
    /** `format_name` of the container (`wav`, `mp3`, …). */
    container: string;
}

/** Loudness facts the `loudnorm` analysis pass reported. */
export interface LoudnessMeasurement {
    /** `input_i` — integrated loudness in LUFS. */
    integratedLufs: number;
    /** `input_tp` — measured true peak in dBTP. */
    truePeakDbtp: number;
    /** `input_lra` — loudness range in LU. */
    loudnessRangeLu: number;
    /** `input_thresh` — the gating threshold in LUFS; pass-2 `measured_thresh`. */
    thresholdLufs: number;
    /** `target_offset` — pass-2 `offset`. */
    targetOffsetDb: number;
}

/** One detected silence span. */
export interface SilenceSpan {
    startSeconds: number;
    /** `null` for a span that runs to the end of the file. */
    endSeconds: number | null;
    durationSeconds: number;
}

/** Silence facts the `silencedetect` scan reported. */
export interface SilenceMeasurement {
    /** Dead air before the music starts; `0` when the file opens on audio. */
    leadingSeconds: number;
    /** Dead air after the music stops; `0` when the file ends on audio. */
    trailingSeconds: number;
    spans: SilenceSpan[];
}

/** Everything one take's measurement yields. */
export interface AudioMeasurement {
    probe: AudioProbe;
    loudness: LoudnessMeasurement;
    silence: SilenceMeasurement;
    /** `ffprobe 8.1.2` / `ffmpeg 8.1.2` — what every check record's `source` quotes. */
    tools: { ffprobe: string; ffmpeg: string };
}

/** Read a numeric field `ffprobe` reported (it quotes numbers as strings). */
function probeNumber(stream: Record<string, unknown>, field: string): number | undefined {
    const raw = stream[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }
    if (typeof raw === 'string') {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

/**
 * Parse `ffprobe -print_format json -show_format -show_streams`. Pure over the
 * captured stdout; a missing audio stream or a missing duration is malformed
 * output, not a zero measurement.
 */
export function parseProbeOutput(stdout: string): AudioProbe {
    const tool = 'ffprobe';
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        throw new AudioToolError(
            tool,
            'malformed',
            'output is not the JSON document `-print_format json` produces',
            fragmentOf(stdout),
        );
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new AudioToolError(tool, 'malformed', 'output is not a JSON object', fragmentOf(stdout));
    }
    const document = parsed as { streams?: unknown; format?: unknown };
    const streams = Array.isArray(document.streams) ? document.streams : [];
    const audio = streams.find(
        (stream): stream is Record<string, unknown> =>
            typeof stream === 'object' && stream !== null && (stream as Record<string, unknown>).codec_type === 'audio',
    );
    if (audio === undefined) {
        throw new AudioToolError(tool, 'malformed', 'no audio stream in the probe output', fragmentOf(stdout));
    }
    const format =
        typeof document.format === 'object' && document.format !== null
            ? (document.format as Record<string, unknown>)
            : {};
    const durationSeconds = probeNumber(audio, 'duration') ?? probeNumber(format, 'duration');
    if (durationSeconds === undefined || durationSeconds <= 0) {
        throw new AudioToolError(
            tool,
            'malformed',
            'the audio stream reports no positive duration',
            fragmentOf(JSON.stringify(audio)),
        );
    }
    const sampleRate = probeNumber(audio, 'sample_rate');
    if (sampleRate === undefined || sampleRate <= 0) {
        throw new AudioToolError(
            tool,
            'malformed',
            'the audio stream reports no sample rate',
            fragmentOf(JSON.stringify(audio)),
        );
    }
    const channels = probeNumber(audio, 'channels');
    if (channels === undefined || channels <= 0) {
        throw new AudioToolError(
            tool,
            'malformed',
            'the audio stream reports no channel count',
            fragmentOf(JSON.stringify(audio)),
        );
    }
    const codec = typeof audio.codec_name === 'string' ? audio.codec_name : '';
    if (codec === '') {
        throw new AudioToolError(
            tool,
            'malformed',
            'the audio stream reports no codec name',
            fragmentOf(JSON.stringify(audio)),
        );
    }
    const container = typeof format.format_name === 'string' && format.format_name !== '' ? format.format_name : codec;
    return { durationSeconds, codec, sampleRate, channels, container };
}

/** Parse one loudnorm numeric field; `-inf`/`inf` are real measured values, not malformed text. */
function loudnormNumber(document: Record<string, unknown>, field: string, stderr: string): number {
    const raw = document[field];
    if (typeof raw === 'number' && !Number.isNaN(raw)) {
        return raw;
    }
    if (typeof raw === 'string') {
        const text = raw.trim().toLowerCase();
        if (text === '-inf') {
            return Number.NEGATIVE_INFINITY;
        }
        if (text === 'inf' || text === '+inf') {
            return Number.POSITIVE_INFINITY;
        }
        const parsed = Number(text);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    throw new AudioToolError(
        'ffmpeg loudnorm',
        'malformed',
        `the analysis JSON has no numeric "${field}"`,
        fragmentOf(stderr),
    );
}

/**
 * Parse the `loudnorm=print_format=json` analysis block. ffmpeg writes the JSON
 * to **stderr**, wrapped in its own log lines, so the block is located between
 * the last `{` and the last `}` rather than assumed to be the whole stream.
 */
export function parseLoudnormOutput(stderr: string): LoudnessMeasurement {
    const start = stderr.lastIndexOf('{');
    const end = stderr.lastIndexOf('}');
    if (start === -1 || end <= start) {
        throw new AudioToolError(
            'ffmpeg loudnorm',
            'malformed',
            'no loudnorm JSON block (`print_format=json`) in the output',
            fragmentOf(stderr),
        );
    }
    const block = stderr.slice(start, end + 1);
    let parsed: unknown;
    try {
        parsed = JSON.parse(block);
    } catch {
        throw new AudioToolError(
            'ffmpeg loudnorm',
            'malformed',
            'the loudnorm JSON block does not parse',
            fragmentOf(block),
        );
    }
    // The block always starts with `{`, so a successful parse is always an object.
    const document = parsed as Record<string, unknown>;
    return {
        integratedLufs: loudnormNumber(document, 'input_i', block),
        truePeakDbtp: loudnormNumber(document, 'input_tp', block),
        loudnessRangeLu: loudnormNumber(document, 'input_lra', block),
        thresholdLufs: loudnormNumber(document, 'input_thresh', block),
        targetOffsetDb: loudnormNumber(document, 'target_offset', block),
    };
}

/** `silence_start: 0` — one number after the label. */
const SILENCE_START = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
/** `silence_end: 2.000021 | silence_duration: 2.000021`. */
const SILENCE_END = /silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(-?\d+(?:\.\d+)?)/;

/**
 * Parse `silencedetect` stderr into spans plus the leading/trailing dead air.
 *
 * A span that opens with `silence_start` and never closes is a silence that runs
 * to EOF: `silencedetect` only prints `silence_end` when audio resumes.
 */
export function parseSilencedetectOutput(stderr: string, durationSeconds: number): SilenceMeasurement {
    const tool = 'ffmpeg silencedetect';
    const spans: SilenceSpan[] = [];
    let open: number | null = null;
    for (const rawLine of stderr.split('\n')) {
        const line = rawLine.trim();
        const startMatch = SILENCE_START.exec(line);
        if (startMatch !== null) {
            open = Number(startMatch[1]);
            continue;
        }
        const endMatch = SILENCE_END.exec(line);
        if (endMatch !== null) {
            const endSeconds = Number(endMatch[1]);
            const startSeconds = open ?? Math.max(0, endSeconds - Number(endMatch[2]));
            spans.push({ startSeconds, endSeconds, durationSeconds: Math.max(0, endSeconds - startSeconds) });
            open = null;
            continue;
        }
        if (line.includes('silence_start') || line.includes('silence_end')) {
            throw new AudioToolError(tool, 'malformed', 'a silence line has no readable timestamp', fragmentOf(line));
        }
    }
    if (open !== null) {
        spans.push({ startSeconds: open, endSeconds: null, durationSeconds: Math.max(0, durationSeconds - open) });
    }
    const first = spans[0];
    const leadingSeconds =
        first !== undefined && first.startSeconds <= SILENCE_EDGE_TOLERANCE_SECONDS ? first.durationSeconds : 0;
    const last = spans[spans.length - 1];
    const touchesEnd =
        last !== undefined &&
        (last.endSeconds === null || last.endSeconds >= durationSeconds - SILENCE_EDGE_TOLERANCE_SECONDS);
    const trailingSeconds = touchesEnd && last !== undefined ? last.durationSeconds : 0;
    return { leadingSeconds, trailingSeconds, spans };
}

/** Read `<tool> <version>` from a `-version` banner's first line. */
export function parseToolVersion(stdout: string, tool: string): string {
    const firstLine = stdout.split('\n')[0]?.trim() ?? '';
    const match = /version\s+(\S+)/i.exec(firstLine);
    if (match === null || match[1] === undefined) {
        throw new AudioToolError(tool, 'malformed', '`-version` banner carries no version', fragmentOf(stdout));
    }
    return `${tool} ${match[1]}`;
}

/** Run one argv through the runner and fail loudly on a non-zero exit. */
async function run(runner: AudioToolRunner, argv: readonly string[], tool: string): Promise<ToolOutput> {
    const output = await runner(argv);
    if (output.exitCode !== 0) {
        const detail = output.stderr.trim() === '' ? output.stdout : output.stderr;
        throw new AudioToolError(tool, 'exit', `exited ${String(output.exitCode)}`, fragmentOf(detail));
    }
    return output;
}

/** `ffprobe 8.1.2` — the check-record source label, version included. */
export async function toolVersions(options: MeasureOptions = {}): Promise<{ ffprobe: string; ffmpeg: string }> {
    const runner = options.runner ?? spawnRunner;
    const ffprobeBin = options.ffprobeBin ?? DEFAULT_FFPROBE_BIN;
    const ffmpegBin = options.ffmpegBin ?? DEFAULT_FFMPEG_BIN;
    const [probe, ffmpeg] = await Promise.all([
        run(runner, versionArgs(ffprobeBin), ffprobeBin),
        run(runner, versionArgs(ffmpegBin), ffmpegBin),
    ]);
    return {
        ffprobe: parseToolVersion(probe.stdout, 'ffprobe'),
        ffmpeg: parseToolVersion(ffmpeg.stdout, 'ffmpeg'),
    };
}

/** Probe one file (R1: duration, codec, sample rate, channels). */
export async function probeAudio(path: string, options: MeasureOptions = {}): Promise<AudioProbe> {
    const runner = options.runner ?? spawnRunner;
    const bin = options.ffprobeBin ?? DEFAULT_FFPROBE_BIN;
    const output = await run(runner, ffprobeArgs(path, bin), bin);
    return parseProbeOutput(output.stdout);
}

/** Run the `loudnorm` analysis pass on one file (R1: integrated LUFS, true peak, LRA). */
export async function measureLoudness(path: string, options: MeasureOptions = {}): Promise<LoudnessMeasurement> {
    const runner = options.runner ?? spawnRunner;
    const bin = options.ffmpegBin ?? DEFAULT_FFMPEG_BIN;
    const output = await run(runner, loudnormArgs(path, bin), `${bin} loudnorm`);
    return parseLoudnormOutput(output.stderr);
}

/** Run the `silencedetect` scan on one file (R1: leading/trailing silence). */
export async function measureSilence(
    path: string,
    durationSeconds: number,
    options: MeasureOptions = {},
): Promise<SilenceMeasurement> {
    const runner = options.runner ?? spawnRunner;
    const bin = options.ffmpegBin ?? DEFAULT_FFMPEG_BIN;
    const output = await run(
        runner,
        silencedetectArgs(path, {
            bin,
            ...(options.silenceNoiseDb === undefined ? {} : { noiseDb: options.silenceNoiseDb }),
            ...(options.silenceMinSeconds === undefined ? {} : { minSeconds: options.silenceMinSeconds }),
        }),
        `${bin} silencedetect`,
    );
    return parseSilencedetectOutput(output.stderr, durationSeconds);
}

/**
 * Measure one audio file completely (R1): four spawns — two `-version` banners,
 * one `ffprobe`, one `loudnorm` analysis, one `silencedetect` — through the one
 * injected runner. The first failure aborts the measurement, so a partially
 * measured take can never be reported as clean.
 */
export async function measureAudio(path: string, options: MeasureOptions = {}): Promise<AudioMeasurement> {
    const [tools, probe] = await Promise.all([toolVersions(options), probeAudio(path, options)]);
    const loudness = await measureLoudness(path, options);
    const silence = await measureSilence(path, probe.durationSeconds, options);
    return { probe, loudness, silence, tools };
}
