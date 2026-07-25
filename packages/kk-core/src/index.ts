/**
 * @gobing-ai/kk-core — pure data contracts & registry discovery for the knowledge-kit plugin platform.
 */

export {
    isPluginKind,
    type KindContract,
    kindContract,
    PLUGIN_KINDS,
    type PluginKind,
    PluginKindSchema,
} from './kinds';
export {
    type PluginManifest,
    PluginManifestSchema,
    parsePluginManifest,
} from './manifest';
export {
    type DiscoveryDiagnostic,
    type DiscoveryResult,
    discoverPlugins,
    getByName,
    listByKind,
    type PluginRecord,
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
