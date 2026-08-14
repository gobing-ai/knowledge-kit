/**
 * @gobing-ai/kk-core — pure data contracts & registry discovery for the knowledge-kit plugin platform.
 */

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
    type PluginManifest,
    PluginManifestSchema,
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
export {
    type Content,
    ContentSchema,
    type Doc,
    DocListSchema,
    DocSchema,
    type Result,
    ResultSchema,
} from './schemas';
