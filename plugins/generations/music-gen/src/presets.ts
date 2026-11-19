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
