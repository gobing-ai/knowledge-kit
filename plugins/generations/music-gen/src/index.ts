/**
 * `@gobing-ai/music-gen` contract surface (task 0397): the MusicBrief schema,
 * the deterministic prompt renderer, the instance request mapping, preset
 * resolution and the canonical digest input. Pure — no HTTP, no adapter, no
 * CLI. The plugin entry, adapter and job wiring land in 0398; presets in 0399;
 * spend guard in 0400; the CLI noun in 0401.
 *
 * Contract authority: `docs/design/music-gen.md`.
 */

export {
    AUDIO_FORMATS,
    type AudioFormat,
    BRIEF_FIELD_TARGETS,
    type BriefFieldTarget,
    DEFAULT_TAKES,
    durationSeconds,
    formatDuration,
    LANGUAGE_PATTERN,
    MAX_DURATION_SECONDS,
    MAX_IMAGES,
    MAX_TAKES,
    MIN_DURATION_SECONDS,
    MMSS_PATTERN,
    MUSIC_MODELS,
    type MusicBrief,
    MusicBriefSchema,
    type MusicModel,
    parseMusicBrief,
    parseMusicBriefYaml,
    type StructureEntry,
    StructureEntrySchema,
} from './brief';
export {
    canonicalDigestJson,
    canonicalDigestSha256,
    type DigestOptions,
    digestInput,
    type MusicDigestInput,
    type TakeDigest,
    takeDigest,
} from './digest';
export {
    assertPresetPortable,
    BUILTIN_DEFAULTS,
    explainJob,
    type FieldSource,
    FORBIDDEN_PRESET_KEYS,
    JobResolutionError,
    loadPresetFile,
    type MusicJobOverrides,
    PresetContractViolation,
    type PresetLayer,
    type PresetLayers,
    parsePresetDocument,
    type ResolvedJob,
    resolveJob,
    type Sourced,
} from './presets';
export {
    AVOID_PREFIX,
    INSTANCE_OWNED_PROMPT_MARKERS,
    INSTRUMENTAL_DIRECTIVE,
    type PromptSegments,
    renderBriefPrompt,
    renderPromptText,
    renderStructureLine,
} from './render';
export {
    type MusicGenerateRequest,
    REQUEST_FIELD_ORIGINS,
    REQUEST_KEY_ORDER,
    renderGenerateRequest,
    renderTakeRequests,
    serializeRequest,
} from './request';
