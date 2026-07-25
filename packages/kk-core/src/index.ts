/**
 * @gobing-ai/kk-core — pure data contracts for the knowledge-kit plugin platform.
 * Schemas + inferred types + kind resolution only; no I/O or discovery.
 */

export {
    isPluginKind,
    type KindContract,
    kindContract,
    PLUGIN_KINDS,
    type PluginKind,
} from './kinds';
export {
    type Content,
    ContentSchema,
    type Doc,
    DocListSchema,
    DocSchema,
    type Result,
    ResultSchema,
} from './schemas';
