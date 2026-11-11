export { type CompiledVault, compileIndex, needsWrite } from './compile';
export type { FindingCode, FindingRecord } from './findings';
export { applyGc, type GcPlan, planGc } from './gc';
export {
    buildVaultIndex,
    extractLinks,
    type LinkRef,
    resolveLink,
    scanLines,
    type VaultIndex,
    type VaultPageEntry,
} from './graph';
export { findMentions, fixLinks, type LinkFixResult, linkTitlesInText, type Mention } from './link';
export { lintExitCode, lintPages } from './lint';
export {
    createMarkitdownRunner,
    type MarkitdownRunner,
    type MarkitdownRunnerOptions,
    MissingNormalizerError,
    type NormalizerInput,
    type NormalizerKind,
} from './markitdown';
export { type MergeResult, mergePages } from './merge';
export {
    FrontmatterError,
    type PageFrontmatter,
    PageFrontmatterSchema,
    type PageType,
    PageTypeSchema,
    type ParsedFrontmatter,
    parseFrontmatter,
    parsePage,
    renderPage,
    resolveSlug,
    type VaultPage,
} from './page';
export {
    deriveTitle,
    RAW_SOURCE_TYPES,
    type RawSnapshot,
    type RawSourceType,
    rawSnapshotId,
    readRawSnapshot,
    renderRawSnapshot,
    type WriteRawSnapshotInput,
    writeRawSnapshot,
} from './raw';
export { SUMMARY_HEADING, type SummarizeResult, summarizePage } from './summarize';
export { type SynthesizeInput, type SynthesizeResult, synthesizePage } from './synthesize';
export {
    applyWrite,
    applyWriteToPage,
    type GuardDecision,
    guardHeading,
    type WriteMode,
    type WriteResult,
} from './write';
