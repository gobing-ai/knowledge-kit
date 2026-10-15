/**
 * @gobing-ai/kk-core — pure data contracts & registry discovery for the knowledge-kit plugin platform.
 */

export {
    type ContentCountUnit,
    type ContentValidationError,
    type ContentValidationInput,
    type ContentValidationResult,
    countContentUnits,
    countXiaohongshuTitleWeighted,
    countXWeightedCharacters,
    PLATFORM_CONTENT_LIMITS,
    type PlatformLimitEntry,
    type PlatformLimitsConfig,
    validateContentLimits,
} from './content-limits';
export {
    collectionForKind,
    isPluginKind,
    type KindContract,
    KK_CAPABILITY_COLLECTION,
    kindContract,
    kindForCollection,
    PLUGIN_COLLECTION_KINDS,
    PLUGIN_KIND_COLLECTIONS,
    PLUGIN_KINDS,
    type PluginKind,
    type PluginKindCollection,
    PluginKindSchema,
} from './kinds';
export {
    type OperationIO,
    OperationIOSchema,
    type PluginManifest,
    PluginManifestSchema,
    type PluginOperation,
    parsePluginManifest,
} from './manifest';
export {
    type DiscoverAllOptions,
    type DiscoveryDiagnostic,
    type DiscoveryResult,
    discoverAllPlugins,
    discoverPlugins,
    getByName,
    listByKind,
    type PluginOrigin,
    type PluginRecord,
    resolvePluginRoots,
} from './registry';
export { main, renderContentMarkdown, renderContentMarkdownFile } from './render-md';
export {
    type AggregateResult,
    AggregateResultSchema,
    type Content,
    ContentSchema,
    type Doc,
    DocListSchema,
    DocSchema,
    type OmniVoiceGenContent,
    omniVoiceGenContentSchema,
    type Result,
    ResultSchema,
    type TargetOutcome,
    TargetOutcomeSchema,
} from './schemas';
export {
    splitThreadContent,
    type ThreadSplitOptions,
    type ThreadSplitResult,
} from './thread-segmentation';
