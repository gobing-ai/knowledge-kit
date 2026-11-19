/**
 * `@gobing-ai/music-gen` — the music generator plugin over the self-hosted
 * Lyria 3 instance.
 *
 * The frozen 0397 contract (brief schema, prompt renderer, request mapping,
 * preset resolution, canonical digest) plus 0398's plugin surface (adapter,
 * offline adapter, config, artifact + sidecar, Content mapping and the generator
 * entry). The plugin entry is this file (`plugin.json` `entry: ./src/index.ts`),
 * so `main()` runs only when the module is executed, never when it is imported.
 *
 * Contract authority: `docs/design/music-gen.md`.
 */

// ── 0398: plugin surface ────────────────────────────────────────────────────
export * from './adapter';
export * from './artifact';
export * from './audio';
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
export * from './config';
export * from './content';
export {
    canonicalDigestJson,
    canonicalDigestSha256,
    type DigestOptions,
    digestInput,
    type MusicDigestInput,
    type TakeDigest,
    takeDigest,
} from './digest';
export * from './job';
export * from './plugin';
export {
    assertPresetPortable,
    BUILTIN_DEFAULTS,
    CLIP_STRUCTURE_CEILING_SECONDS,
    explainJob,
    type FieldSource,
    FORBIDDEN_PRESET_KEYS,
    JobResolutionError,
    type LoadedMusicPresets,
    type LoadMusicPresetsOptions,
    loadMusicPresets,
    loadPresetFile,
    MUSIC_PRESET_ROOT,
    type MusicFormatPreset,
    MusicFormatPresetSchema,
    type MusicJobOverrides,
    type MusicPresetProblem,
    type MusicThemePreset,
    MusicThemePresetSchema,
    type NamedPresetOptions,
    PRESET_STATUSES,
    PROVENANCE_DATE_PATTERN,
    PresetContractViolation,
    PresetDataError,
    type PresetLayer,
    type PresetLayers,
    type PresetProvenance,
    PresetProvenanceSchema,
    type PresetStatus,
    parsePresetDocument,
    presetLayerForFormat,
    presetLayerForTheme,
    type ResolvedJob,
    resolveJob,
    resolveNamedJob,
    type Sourced,
    themeDirectionGaps,
    UnknownPresetError,
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
export {
    type AnalyzeEstimateInput,
    DEFAULT_TAKES_CAP,
    type DedupeDecision,
    type DedupeScanInput,
    enforceRunScopedDedupe,
    estimateAnalyze,
    estimateGenerate,
    findRunDirDuplicates,
    formatEstimate,
    formatUsd,
    type GenerateEstimateInput,
    type GenerationPlan,
    type GenerationPlanInput,
    HARD_TAKES_CAP,
    planGeneration,
    type RunDirDuplicate,
    requireConfirmation,
    resolveTakeCount,
    resolveTakesCap,
    type SpendEmit,
    type SpendEstimate,
    type SpendKind,
    SpendRefusal,
    type SpendRequest,
    type TakeDigestEntry,
    withConfirmation,
} from './spend';

if (import.meta.main) {
    const { main } = await import('./plugin');
    process.exit(await main());
}
