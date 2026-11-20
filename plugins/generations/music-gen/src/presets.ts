import { join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import {
    AUDIO_FORMATS,
    type AudioFormat,
    durationSeconds,
    LANGUAGE_PATTERN,
    MAX_DURATION_SECONDS,
    MIN_DURATION_SECONDS,
    MMSS_PATTERN,
    MUSIC_MODELS,
    type MusicBrief,
    type MusicModel,
    type StructureEntry,
    StructureEntrySchema,
} from './brief';

/**
 * Preset resolution (task 0397 R4) and preset portability (R4 / 0399 R4).
 *
 * Resolution is pure precedence over four layers plus built-in defaults:
 * `brief > workflow preset > theme preset > format preset > built-in default`.
 * A field that survives every layer as `undefined` and has no built-in makes
 * resolution fail loudly — the instance's own defaults (`durationTarget: '3:00'`,
 * `language: 'EN'`) must never silently decide a job.
 *
 * Preset files are portable data: no provider, API base URL, API model id,
 * credential or price may appear anywhere in them (fail closed, exit code 2).
 *
 * 0399 adds the data half on top of that frozen surface: the format/theme preset
 * schemas with their provenance and evidence status, the loader that enforces
 * both uniformly for every file under `presets/`, and the name-based entry point
 * that fails loudly (exit code 1) for an unknown format or theme.
 */

/** Which layer supplied a resolved value. */
export type FieldSource = 'brief' | 'workflow' | 'theme' | 'format' | 'builtin';

/** A resolved value plus the layer that won. */
export interface Sourced<T> {
    value: T;
    source: FieldSource;
    /** Preset name for the `workflow`/`theme`/`format` sources. */
    origin?: string;
}

/** The resolvable half of a brief — what any preset layer may also supply. */
export interface MusicJobOverrides {
    model?: MusicModel;
    duration_target?: string;
    language?: string;
    instrumental?: boolean;
    /** Format presets declare a lyrics policy; `forbidden` resolves to `instrumental: true`. */
    lyrics_policy?: 'allowed' | 'forbidden';
    audio_format?: AudioFormat;
    style?: string;
    avoid?: string[];
    structure?: StructureEntry[];
}

/** One preset layer: its name (for `explainJob`) plus the fields it supplies. */
export interface PresetLayer extends MusicJobOverrides {
    name: string;
}

/** The three preset layers, in precedence order after the brief. */
export interface PresetLayers {
    workflow?: PresetLayer;
    theme?: PresetLayer;
    format?: PresetLayer;
}

/** The fully resolved job every downstream stage consumes. */
export interface ResolvedJob {
    title: string;
    model: Sourced<MusicModel>;
    duration_target: Sourced<string | undefined>;
    language: Sourced<string>;
    instrumental: Sourced<boolean>;
    audio_format: Sourced<AudioFormat>;
    style: Sourced<string>;
    avoid: Sourced<string[]>;
    structure: Sourced<StructureEntry[]>;
    /** Explicit lyrics text; `undefined` lets the model write its own, `''` is the instrumental payload. */
    lyrics: string | undefined;
    takes: number;
    images: string[];
    meta: Record<string, unknown>;
}

/** Last link of every resolution chain. `duration_target` and `style` deliberately have no default. */
export const BUILTIN_DEFAULTS = {
    model: 'pro',
    language: 'EN',
    instrumental: false,
    audio_format: 'mp3',
} as const satisfies MusicJobOverrides;

/** Raised when no layer can satisfy a required job field, or when a resolved value is invalid. */
export class JobResolutionError extends Error {
    /** CLI exit code the caller must surface. */
    readonly exitCode = 1;

    constructor(message: string) {
        super(message);
        this.name = 'JobResolutionError';
    }
}

/** Raised when a preset file carries a non-portable key (provider, base URL, model id, credential, price). */
export class PresetContractViolation extends Error {
    /** CLI exit code the loader wrapper must surface. */
    readonly exitCode = 2;

    /** Dotted paths of every offending key, in document order. */
    readonly violations: readonly string[];

    constructor(path: string, violations: readonly string[]) {
        super(`${path}: preset is not portable — ${violations.join(', ')}`);
        this.name = 'PresetContractViolation';
        this.violations = violations;
    }
}

/**
 * Keys a preset file may never carry. `model` (`pro`|`clip`) is the instance's
 * own selector and stays allowed; an upstream API model id, a provider name, a
 * base URL, a credential or a price is provider-specific user config (0400).
 */
export const FORBIDDEN_PRESET_KEYS: readonly string[] = [
    'provider',
    'providers',
    'model_id',
    'model-id',
    'modelId',
    'api_model_id',
    'api-model-id',
    'apiModelId',
    'base_url',
    'base-url',
    'baseUrl',
    'api_base_url',
    'apiBaseUrl',
    'endpoint',
    'price',
    'prices',
    'unit_price',
    'unitPrice',
    'cost',
    'cost_usd',
    'api_key',
    'apiKey',
    'secret',
    'secrets',
    'token',
    'apiToken',
];

interface LayerSource {
    kind: FieldSource;
    origin?: string;
    values: MusicJobOverrides;
}

/** Human label for a layer, used in every diagnostic. */
function describeSource(sourced: { source: FieldSource; origin?: string }): string {
    return sourced.origin === undefined ? sourced.source : `${sourced.source} preset "${sourced.origin}"`;
}

/** Read the resolvable half of a brief. */
function briefOverrides(brief: MusicBrief): MusicJobOverrides {
    return {
        model: brief.model,
        duration_target: brief.duration_target,
        language: brief.language,
        instrumental: brief.instrumental,
        audio_format: brief.audio_format,
        style: brief.style,
        avoid: brief.avoid,
        structure: brief.structure,
    };
}

/** `instrumental` from a layer, honouring a format preset's `lyrics_policy`. */
function layerInstrumental(values: MusicJobOverrides): boolean | undefined {
    if (values.instrumental !== undefined) {
        return values.instrumental;
    }
    if (values.lyrics_policy === 'forbidden') {
        return true;
    }
    if (values.lyrics_policy === 'allowed') {
        return false;
    }
    return undefined;
}

/** First layer that supplies a value wins, and its identity is carried through. */
function pick<T>(
    layers: readonly LayerSource[],
    read: (values: MusicJobOverrides) => T | undefined,
): Sourced<T | undefined> {
    for (const layer of layers) {
        const value = read(layer.values);
        if (value !== undefined) {
            return { value, source: layer.kind, origin: layer.origin };
        }
    }
    return { value: undefined, source: 'builtin' };
}

/** Apply a built-in default or fail loudly, naming the field. */
function requireValue<T>(field: string, sourced: Sourced<T | undefined>, builtin?: T): Sourced<T> {
    if (sourced.value !== undefined) {
        return { value: sourced.value, source: sourced.source, origin: sourced.origin };
    }
    if (builtin !== undefined) {
        return { value: builtin, source: 'builtin' };
    }
    throw new JobResolutionError(
        `${field} is unresolved: the brief, workflow preset, theme preset and format preset all leave it empty and there is no built-in default`,
    );
}

/** Case-insensitive de-duplication that keeps the first spelling and its position. */
function dedupe(values: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const key = value.trim().toLowerCase();
        if (key === '' || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(value.trim());
    }
    return out;
}

/**
 * Merge the avoid lists: brief entries first, then the workflow, theme and
 * format layers, de-duplicated case-insensitively. `avoid` is the one additive
 * field — an authored exclusion must not switch off the theme's cliché guard.
 */
function mergeAvoid(layers: readonly LayerSource[]): Sourced<string[]> {
    const merged: string[] = [];
    let winner: Sourced<string[]> = { value: [], source: 'builtin' };
    for (const layer of layers) {
        const values = layer.values.avoid ?? [];
        if (values.length === 0) {
            continue;
        }
        if (winner.source === 'builtin') {
            winner = { value: [], source: layer.kind, origin: layer.origin };
        }
        merged.push(...values);
    }
    return { value: dedupe(merged), source: winner.source, origin: winner.origin };
}

/** Validate a resolved duration target — preset data is untrusted too. */
function validateDuration(value: string, source: { source: FieldSource; origin?: string }): void {
    if (!MMSS_PATTERN.test(value)) {
        throw new JobResolutionError(`duration_target "${value}" from ${describeSource(source)} is not m:ss`);
    }
    const seconds = durationSeconds(value);
    if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) {
        throw new JobResolutionError(
            `duration_target "${value}" from ${describeSource(source)} is outside 0:05–3:00 (the Pro ceiling)`,
        );
    }
}

/**
 * Resolve a brief plus preset layers into the effective job (R4).
 *
 * Throws {@link JobResolutionError} when a Pro job has no duration target, when
 * no layer supplies the technical direction, or when a resolved value is
 * invalid — never by falling back to an instance default.
 */
export function resolveJob(brief: MusicBrief, layers: PresetLayers = {}): ResolvedJob {
    const sources: LayerSource[] = [{ kind: 'brief', values: briefOverrides(brief) }];
    if (layers.workflow !== undefined) {
        sources.push({ kind: 'workflow', origin: layers.workflow.name, values: layers.workflow });
    }
    if (layers.theme !== undefined) {
        sources.push({ kind: 'theme', origin: layers.theme.name, values: layers.theme });
    }
    if (layers.format !== undefined) {
        sources.push({ kind: 'format', origin: layers.format.name, values: layers.format });
    }

    const model = requireValue(
        'model',
        pick(sources, (values) => values.model),
        BUILTIN_DEFAULTS.model,
    );
    if (!MUSIC_MODELS.includes(model.value)) {
        throw new JobResolutionError(`model "${String(model.value)}" is not pro|clip`);
    }

    const duration = pick(sources, (values) => values.duration_target);
    const durationTarget = duration.value;
    if (model.value === 'pro' && durationTarget === undefined) {
        throw new JobResolutionError(
            'duration_target is unresolved for a Pro job: the brief, workflow preset, theme preset and format preset all leave it empty. The instance substitutes "3:00" — set duration_target or a format default',
        );
    }
    if (durationTarget !== undefined) {
        validateDuration(durationTarget, duration);
        if (model.value === 'clip') {
            const seconds = durationSeconds(durationTarget);
            if (seconds < 25 || seconds > 35) {
                throw new JobResolutionError(
                    `duration_target "${durationTarget}" cannot apply to a clip job: clip is fixed at about 0:30 and ignores duration. Drop duration_target or use model: pro`,
                );
            }
        }
    }

    const language = requireValue(
        'language',
        pick(sources, (values) => values.language),
        BUILTIN_DEFAULTS.language,
    );
    if (!LANGUAGE_PATTERN.test(language.value)) {
        throw new JobResolutionError(
            `language "${language.value}" from ${describeSource(language)} is not a short tag such as EN`,
        );
    }

    const audioFormat = requireValue(
        'audio_format',
        pick(sources, (values) => values.audio_format),
        BUILTIN_DEFAULTS.audio_format,
    );
    if (!AUDIO_FORMATS.includes(audioFormat.value)) {
        throw new JobResolutionError(`audio_format "${String(audioFormat.value)}" is not mp3|wav`);
    }

    const style = requireValue(
        'style',
        pick(sources, (values) => values.style),
    );
    if (style.value.trim() === '') {
        throw new JobResolutionError(
            `style from ${describeSource(style)} is empty; the prompt would carry no technical direction`,
        );
    }

    const instrumental = requireValue(
        'instrumental',
        pick(sources, (values) => layerInstrumental(values)),
        BUILTIN_DEFAULTS.instrumental,
    );
    const structure = pick(sources, (values) => values.structure);

    // A preset may force instrumental (a format's lyrics_policy); dropping authored
    // lyrics on the floor is exactly the silent loss the total mapping forbids.
    if (instrumental.value && (brief.lyrics ?? '').trim() !== '') {
        throw new JobResolutionError(
            `instrumental resolves to true from ${describeSource(instrumental)} but the brief carries lyrics; drop the lyrics or override instrumental: false`,
        );
    }

    return {
        title: brief.title,
        model,
        duration_target: { value: durationTarget, source: duration.source, origin: duration.origin },
        language,
        instrumental,
        audio_format: audioFormat,
        style: { value: style.value.trim(), source: style.source, origin: style.origin },
        avoid: mergeAvoid(sources),
        structure: { value: structure.value ?? [], source: structure.source, origin: structure.origin },
        lyrics: instrumental.value ? '' : brief.lyrics,
        takes: brief.takes ?? 1,
        images: brief.images ?? [],
        meta: brief.meta ?? {},
    };
}

/** One line per resolved field, naming the layer that won (0399 R3 prints these). */
export function explainJob(job: ResolvedJob): string[] {
    const show = (value: string | undefined): string => {
        if (value === undefined) {
            return '(none)';
        }
        const firstLine = value.split('\n')[0] ?? '';
        return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
    };
    const count = job.avoid.value.length;
    return [
        `title: ${job.title} (brief)`,
        `model: ${job.model.value} (${describeSource(job.model)})`,
        `duration_target: ${job.duration_target.value ?? '(none)'} (${describeSource(job.duration_target)})`,
        `language: ${job.language.value} (${describeSource(job.language)})`,
        `instrumental: ${String(job.instrumental.value)} (${describeSource(job.instrumental)})`,
        `audio_format: ${job.audio_format.value} (${describeSource(job.audio_format)})`,
        `style: ${show(job.style.value)} (${describeSource(job.style)})`,
        `avoid: ${String(count)} entr${count === 1 ? 'y' : 'ies'} (${describeSource(job.avoid)})`,
        `structure: ${String(job.structure.value.length)} section(s) (${describeSource(job.structure)})`,
        `takes: ${String(job.takes)} (brief)`,
    ];
}

/**
 * Reject a preset document that carries a non-portable key at any depth.
 * Aggregates every offending dotted path so one run reports them all.
 */
export function assertPresetPortable(document: unknown, path: string): void {
    const violations: string[] = [];
    const walk = (node: unknown, prefix: string): void => {
        if (Array.isArray(node)) {
            for (const [index, item] of node.entries()) {
                walk(item, `${prefix}[${index}]`);
            }
            return;
        }
        if (node === null || typeof node !== 'object') {
            return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            const dotted = prefix === '' ? key : `${prefix}.${key}`;
            if (FORBIDDEN_PRESET_KEYS.includes(key)) {
                violations.push(dotted);
            }
            walk(value, dotted);
        }
    };
    walk(document, '');
    if (violations.length > 0) {
        throw new PresetContractViolation(path, violations);
    }
}

/** Parse preset YAML and enforce portability; throws with the file path in the message. */
export function parsePresetDocument(text: string, path: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(text);
    } catch (error) {
        throw new PresetContractViolation(path, [`unparseable YAML: ${String(error)}`]);
    }
    assertPresetPortable(parsed, path);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new PresetContractViolation(path, ['document must be a mapping']);
    }
    return parsed as Record<string, unknown>;
}

/**
 * Read and check one preset file. Callers (0399's loader, 0401's CLI) catch
 * {@link PresetContractViolation} and exit with its `exitCode`; the portability
 * check is what turns a provider/model-id/price declaration into a non-zero exit.
 */
export async function loadPresetFile(path: string): Promise<Record<string, unknown>> {
    const text = await Bun.file(path).text();
    return parsePresetDocument(text, path);
}

// ── 0399: preset data — formats, themes, provenance and the loader ───────────

/**
 * Evidence status a preset may claim. `verified` is reserved for a preset a real
 * generated take has been reviewed against; a freshly authored file may only say
 * `authored` or `evidence-pending` (0399 R4).
 */
export const PRESET_STATUSES = ['authored', 'evidence-pending', 'verified'] as const;
export type PresetStatus = (typeof PRESET_STATUSES)[number];

/** `YYYY-MM-DD`. A provenance date is an authored fact, not a clock reading. */
export const PROVENANCE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clip is fixed at about 0:30 and ignores duration, so a clip skeleton that
 * reaches past it sends the model text it cannot honour. The loader rejects it
 * instead (0399 Design, "Clip formats skip structure timestamps past 0:30").
 */
export const CLIP_STRUCTURE_CEILING_SECONDS = 30;

/** Provenance block every preset file must carry. */
export const PresetProvenanceSchema = z
    .object({
        /** Where the preset was authored from — a task, a design section, a reviewed take. */
        authoring_source: z.string().min(1),
        /** `YYYY-MM-DD` the file was authored. */
        authored_at: z.string().regex(PROVENANCE_DATE_PATTERN, 'authored_at must be YYYY-MM-DD'),
        /** Evidence status; `verified` requires a real generation review. */
        status: z.enum(PRESET_STATUSES),
        /** Free-text evidence note (a generation id, a review date) when one exists. */
        evidence: z.string().min(1).optional(),
    })
    .strict();

export type PresetProvenance = z.infer<typeof PresetProvenanceSchema>;

/**
 * R1 — `presets/formats/<name>.yaml`: the job intent, the model, the duration
 * target and the structural skeleton. The format owns the arc; the theme owns
 * the sound (0399 Design). No provider, API model id or price, ever.
 */
export const MusicFormatPresetSchema = z
    .object({
        /** Must equal the file stem; the loader rejects a mismatch. */
        name: z.string().min(1),
        description: z.string().min(1),
        /** One line the generated README index prints as the use case. */
        intended_use: z.string().min(1),
        /** The instance's own selector. `pro` needs a duration target; `clip` must not declare one. */
        model: z.enum(MUSIC_MODELS),
        /** Default duration target — required for `pro`, forbidden for `clip`. */
        duration_target: z.string().regex(MMSS_PATTERN, 'duration_target must be m:ss').optional(),
        /** `forbidden` resolves `instrumental: true` through 0397's precedence. */
        lyrics_policy: z.enum(['allowed', 'forbidden']),
        /** Timestamped skeleton, non-decreasing, inside the format's own ceiling. */
        structure: z.array(StructureEntrySchema).min(1),
        /** Optional default deny-list, merged additively like every other `avoid`. */
        avoid: z.array(z.string().min(1)).optional(),
        provenance: PresetProvenanceSchema,
    })
    .strict()
    .superRefine((preset, ctx) => {
        let ceiling = CLIP_STRUCTURE_CEILING_SECONDS;
        if (preset.model === 'pro') {
            ceiling = Number.POSITIVE_INFINITY;
            if (preset.duration_target === undefined) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['duration_target'],
                    message:
                        'a pro format must declare a duration_target — the instance would otherwise send "3:00" and the skeleton would describe a track nobody asked for',
                });
            }
        } else if (preset.duration_target !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['duration_target'],
                message:
                    'a clip format must not declare a duration_target — clip is fixed at about 0:30 and the instance ignores duration',
            });
        }
        const duration = preset.duration_target;
        if (duration !== undefined && MMSS_PATTERN.test(duration)) {
            const seconds = durationSeconds(duration);
            if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['duration_target'],
                    message: `duration_target must be between 0:05 and 3:00 (got ${duration})`,
                });
            }
            if (preset.model === 'pro') {
                ceiling = seconds;
            }
        }
        for (const [index, entry] of preset.structure.entries()) {
            if (!MMSS_PATTERN.test(entry.at)) {
                continue; // the field schema already reports a malformed timestamp
            }
            const at = durationSeconds(entry.at);
            if (at > ceiling) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['structure', index, 'at'],
                    message:
                        preset.model === 'clip'
                            ? `structure at ${entry.at} exceeds the ~0:30 clip ceiling — clip cannot honour a longer skeleton`
                            : `structure at ${entry.at} exceeds the format duration_target ${String(duration)}`,
                });
            }
            const previous = preset.structure[index - 1];
            if (previous !== undefined && MMSS_PATTERN.test(previous.at) && at < durationSeconds(previous.at)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['structure', index, 'at'],
                    message: `structure must not move backwards (${entry.at} follows ${previous.at})`,
                });
            }
        }
    });

export type MusicFormatPreset = z.infer<typeof MusicFormatPresetSchema>;

/**
 * R2 — `presets/themes/<name>.yaml`: the technical direction prose the model
 * actually reads, its default `avoid[]`, the vocal-character guidance and the
 * instrumentation palette. A theme never dictates arrangement — that is the
 * format's job — and it never claims a result it has not produced.
 */
export const MusicThemePresetSchema = z
    .object({
        name: z.string().min(1),
        description: z.string().min(1),
        /** One line the generated README index prints as the use case. */
        intended_use: z.string().min(1),
        genre: z.string().min(1),
        tempo: z.string().min(1),
        key: z.string().min(1),
        /** Instrumentation palette; every entry must appear in `style`. */
        instrumentation: z.array(z.string().min(1)).min(1),
        vocal_character: z.string().min(1),
        production: z.string().min(1),
        /** The technical-direction prompt segment (0397 `style`), authored prose. */
        style: z.string().min(1),
        /** Default deny-list, rendered as one `Avoid: …` segment by the renderer. */
        avoid: z.array(z.string().min(1)).min(1),
        provenance: PresetProvenanceSchema,
    })
    .strict();

export type MusicThemePreset = z.infer<typeof MusicThemePresetSchema>;

/**
 * Facets the theme declares but its prose never says. `style` is the only
 * control surface the model has — a facet that is not in the prose does not
 * reach the model (Lyria has no tempo/key/instrumentation parameter), so the
 * loader rejects the mismatch instead of shipping a direction it cannot honour.
 */
export function themeDirectionGaps(theme: MusicThemePreset): string[] {
    const prose = theme.style.toLowerCase();
    const gaps: string[] = [];
    const require = (label: string, value: string): void => {
        if (!prose.includes(value.toLowerCase())) {
            gaps.push(`${label} "${value}"`);
        }
    };
    require('genre', theme.genre);
    require('tempo', theme.tempo);
    require('key', theme.key);
    for (const [index, entry] of theme.instrumentation.entries()) {
        require(`instrumentation[${String(index)}]`, entry);
    }
    require('vocal character', theme.vocal_character);
    require('production', theme.production);
    return gaps;
}

/** One rejected preset file, with the field the rule fired on. */
export interface MusicPresetProblem {
    /** Path of the offending file. */
    path: string;
    /** Dotted field path inside the document, or the axis for a structural problem. */
    field: string;
    message: string;
}

/** Message every non-portable preset key reports, so one rule reads the same everywhere. */
const PORTABILITY_MESSAGE =
    'preset is not portable — a provider, API model id, base URL, credential or price is user config (0400), never preset data';

/**
 * Raised when any preset file under the root is invalid. Every problem is
 * reported at once and **nothing is returned**: a partially loaded preset set
 * must never reach the renderer (0399 AC4).
 */
export class PresetDataError extends Error {
    /** CLI exit code the loader wrapper surfaces. */
    readonly exitCode = 2;

    /** Every rejected file, in load order. */
    readonly problems: readonly MusicPresetProblem[];

    constructor(problems: readonly MusicPresetProblem[]) {
        super(problems.map((problem) => `${problem.path}: ${problem.field}: ${problem.message}`).join('\n'));
        this.name = 'PresetDataError';
        this.problems = problems;
    }
}

/**
 * Shipped preset root for the source layout: `plugins/generations/music-gen/presets`.
 *
 * A bundled `kk` puts this module inside `<pkg>/dist/index.js`, where the sibling directory does not
 * exist — the packaged copy lives at `<pkg>/plugins/generations/music-gen/presets` instead (0413).
 * {@link resolveMusicPresetRoot} picks the first candidate that exists; this constant stays the
 * source-layout path and the last-resort value, so a genuinely missing corpus still fails with a
 * recognisable path.
 */
export const MUSIC_PRESET_ROOT = join(import.meta.dir, '..', 'presets');

/**
 * Preset-root candidates for one anchor directory, nearest first: the plugin-local sibling layout
 * (source and any unpacked plugin dir), then the package-root layout a bundle needs, checked at
 * every ancestor because a bundle's `import.meta.dir` is `<pkg>/dist`.
 */
export function musicPresetRootCandidates(from: string = import.meta.dir): string[] {
    const candidates: string[] = [];
    let dir = resolve(from);
    for (;;) {
        candidates.push(join(dir, '..', 'presets'));
        candidates.push(join(dir, 'plugins', 'generations', 'music-gen', 'presets'));
        const parent = resolve(dir, '..');
        if (parent === dir) return candidates;
        dir = parent;
    }
}

/** The first candidate that exists, else the source-layout path (so the failure names a real shape). */
export async function resolveMusicPresetRoot(fs: FileSystem, from?: string): Promise<string> {
    for (const candidate of musicPresetRootCandidates(from)) {
        if (await fs.exists(candidate)) return candidate;
    }
    return MUSIC_PRESET_ROOT;
}

/** The shipped inventory: one map per axis, keyed by preset name. */
export interface LoadedMusicPresets {
    /** Root the two axes were read from. */
    root: string;
    formats: Map<string, MusicFormatPreset>;
    themes: Map<string, MusicThemePreset>;
}

export interface LoadMusicPresetsOptions {
    /** Preset root override — tests and probes point it at a throwaway tree, never the shipped corpus. */
    root?: string;
    /** File-system seam override (text IO only). */
    fileSystem?: FileSystem;
}

interface PresetFile {
    path: string;
    stem: string;
    document: Record<string, unknown>;
}

/** Read one axis directory, aggregating every unreadable or non-portable file. */
async function readPresetFiles(
    dir: string,
    axis: 'formats' | 'themes',
    fs: FileSystem,
    problems: MusicPresetProblem[],
): Promise<PresetFile[]> {
    if (!(await fs.exists(dir))) {
        problems.push({ path: dir, field: axis, message: 'preset directory is missing' });
        return [];
    }
    const entries = (await fs.readDir(dir)).filter((entry) => entry.endsWith('.yaml')).sort();
    if (entries.length === 0) {
        problems.push({ path: dir, field: axis, message: 'no .yaml preset files found' });
        return [];
    }
    const files: PresetFile[] = [];
    for (const entry of entries) {
        const path = join(dir, entry);
        try {
            files.push({
                path,
                stem: entry.replace(/\.yaml$/, ''),
                document: parsePresetDocument(await fs.readFile(path), path),
            });
        } catch (error) {
            if (error instanceof PresetContractViolation) {
                for (const violation of error.violations) {
                    problems.push({ path, field: violation, message: PORTABILITY_MESSAGE });
                }
            } else {
                problems.push({
                    path,
                    field: 'document',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    return files;
}

/** Parse one axis into a name → preset map, reporting every schema or identity problem. */
function collectPresets<T extends { name: string }>(args: {
    axis: 'formats' | 'themes';
    files: readonly PresetFile[];
    schema: z.ZodType<T>;
    problems: MusicPresetProblem[];
    inspect?: (preset: T, path: string) => void;
}): Map<string, T> {
    const byName = new Map<string, T>();
    const pathsByName = new Map<string, string>();
    for (const file of args.files) {
        const result = args.schema.safeParse(file.document);
        if (!result.success) {
            for (const issue of result.error.issues) {
                const field = issue.path.map((part) => String(part)).join('.');
                args.problems.push({
                    path: file.path,
                    field: field === '' ? args.axis : field,
                    message: issue.message,
                });
            }
            continue;
        }
        const preset = result.data;
        if (preset.name !== file.stem) {
            args.problems.push({
                path: file.path,
                field: 'name',
                message: `declares name "${preset.name}" but the file is ${file.stem}.yaml`,
            });
            continue;
        }
        const existing = pathsByName.get(preset.name);
        if (existing !== undefined) {
            args.problems.push({
                path: file.path,
                field: 'name',
                message: `duplicate preset name "${preset.name}" (already declared by ${existing})`,
            });
            continue;
        }
        args.inspect?.(preset, file.path);
        byName.set(preset.name, preset);
        pathsByName.set(preset.name, file.path);
    }
    return byName;
}

/**
 * Load `presets/formats/*.yaml` and `presets/themes/*.yaml`.
 *
 * Fail closed (0399 R4): portability, the schema, the name/file-stem identity,
 * the per-format duration and structure ceilings and the theme's prose coverage
 * are all enforced here, and one problem anywhere throws
 * {@link PresetDataError} with every problem listed — no partial set escapes.
 */
export async function loadMusicPresets(options: LoadMusicPresetsOptions = {}): Promise<LoadedMusicPresets> {
    const fs = options.fileSystem ?? createNodeFileSystem();
    const root = options.root ?? (await resolveMusicPresetRoot(fs));
    const problems: MusicPresetProblem[] = [];
    const formatFiles = await readPresetFiles(join(root, 'formats'), 'formats', fs, problems);
    const themeFiles = await readPresetFiles(join(root, 'themes'), 'themes', fs, problems);
    const formats = collectPresets({
        axis: 'formats',
        files: formatFiles,
        schema: MusicFormatPresetSchema,
        problems,
    });
    const themes = collectPresets({
        axis: 'themes',
        files: themeFiles,
        schema: MusicThemePresetSchema,
        problems,
        inspect: (preset, path) => {
            for (const gap of themeDirectionGaps(preset)) {
                problems.push({
                    path,
                    field: 'style',
                    message: `technical direction never states ${gap} — the prose is the only control surface the model has`,
                });
            }
        },
    });
    if (problems.length > 0) {
        throw new PresetDataError(problems);
    }
    return { root, formats, themes };
}

/** The resolution layer a format preset contributes (0397 precedence: format is the lowest preset layer). */
export function presetLayerForFormat(preset: MusicFormatPreset): PresetLayer {
    return {
        name: preset.name,
        model: preset.model,
        duration_target: preset.duration_target,
        lyrics_policy: preset.lyrics_policy,
        structure: preset.structure,
        avoid: preset.avoid,
    };
}

/** The resolution layer a theme preset contributes: style prose plus its default deny-list. */
export function presetLayerForTheme(preset: MusicThemePreset): PresetLayer {
    return { name: preset.name, style: preset.style, avoid: [...preset.avoid] };
}

/**
 * Raised when a brief names a format or theme the preset root does not ship.
 * Never a silent fallback: the message lists the valid names and the resolution
 * trace shows which source supplied every other field.
 */
export class UnknownPresetError extends Error {
    /** CLI exit code the caller must surface. */
    readonly exitCode = 1;

    /** Which axis the unknown name belongs to. */
    readonly axis: 'format' | 'theme';

    /** The name the brief asked for. */
    readonly requested: string;

    /** Every name that axis does ship, sorted. */
    readonly validNames: readonly string[];

    /** `explainJob` lines from the resolution with the layers that did exist. */
    readonly trace: readonly string[];

    constructor(axis: 'format' | 'theme', requested: string, validNames: readonly string[], trace: readonly string[]) {
        const listed = validNames.length === 0 ? '(none shipped)' : validNames.join(', ');
        super(`unknown ${axis} preset "${requested}"; valid ${axis} presets: ${listed}`);
        this.name = 'UnknownPresetError';
        this.axis = axis;
        this.requested = requested;
        this.validNames = validNames;
        this.trace = trace;
    }

    /** The message plus the source trace, one line each — what the CLI prints to stderr. */
    get report(): string {
        return [this.message, ...this.trace.map((line) => `  ${line}`)].join('\n');
    }
}

export interface NamedPresetOptions {
    /** Highest preset layer, as 0400/0401 pass it (0397 precedence: brief > workflow > theme > format). */
    workflow?: PresetLayer;
}

/**
 * Resolve a brief through the presets it names (0399 R3), reusing 0397's
 * `resolveJob` — the precedence itself is unchanged; this only turns two names
 * into two layers and fails loudly when a name does not exist.
 */
export function resolveNamedJob(
    brief: MusicBrief,
    presets: LoadedMusicPresets,
    options: NamedPresetOptions = {},
): ResolvedJob {
    const format = presets.formats.get(brief.format);
    const theme = presets.themes.get(brief.theme);
    const layers: PresetLayers = {
        ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
        ...(theme === undefined ? {} : { theme: presetLayerForTheme(theme) }),
        ...(format === undefined ? {} : { format: presetLayerForFormat(format) }),
    };
    if (format !== undefined && theme !== undefined) {
        return resolveJob(brief, layers);
    }
    // Report the trace the known layers already produce, so the operator sees which
    // source decides every other field while the unknown name is fixed.
    let trace: string[];
    try {
        trace = explainJob(resolveJob(brief, layers));
    } catch (error) {
        trace = [`resolution with the known layers failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (format === undefined) {
        throw new UnknownPresetError('format', brief.format, [...presets.formats.keys()].sort(), trace);
    }
    throw new UnknownPresetError('theme', brief.theme, [...presets.themes.keys()].sort(), trace);
}
