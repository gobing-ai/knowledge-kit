/**
 * @gobing-ai/kk-store — the kk SQLite store: schema, migrations, DAOs, and the
 * store path resolver.
 *
 * The public surface is deliberately ts-db-free: consumers see `openStore`, the
 * DAO classes, row types, and the two pure identity helpers. ts-db types stay
 * inside the package (`src/db.ts`, `src/migrations.ts`).
 */

export { canonicalUrl, itemId, outboundUrls } from './canonical-url';
export {
    CHINA_POLITICS_DECISION_ID,
    DEFAULT_CHINA_POLITICS_DECISION_PRIORITY,
    DEFAULT_CHINA_POLITICS_TERMS,
    DEFAULT_LABEL_PRIORITY,
    DEFAULT_MIN_CONFIDENCE,
    DEFAULT_STORE_DB_PATH,
    readStoreConfig,
    resolveStorePath,
    type StoreConfig,
    StoreConfigInvalidError,
    type StoreLabelConfig,
} from './config';
export {
    type CollectRunFinish,
    type CollectRunRecord,
    type CollectRunStart,
    CollectRunsDao,
} from './dao/collect-runs';
export {
    COLLECT_VIEW_PAGE_SIZE,
    CollectViewDao,
    type CollectViewItem,
    type CollectViewItemsFilter,
    type CollectViewItemsPage,
    type CollectViewLabelQuality,
    type CollectViewRunRow,
} from './dao/collect-view';
export { type ItemRecord, ItemsDao, type StoredDoc, type UpsertDocsResult } from './dao/items';
export {
    type CurrentLabelRecord,
    HIGH_CONFIDENCE_MIN,
    LABEL_CONFIDENCE_LEVELS,
    LABELS_CURRENT,
    type LabelConfidence,
    type LabelInput,
    type LabelPolicy,
    type LabelRecord,
    type LabelSource,
    type LabelsCurrentSql,
    LabelsDao,
    labelConfidence,
    labelsCurrentSql,
    MEDIUM_CONFIDENCE_MIN,
    verdictConfidence,
} from './dao/labels';
export { type LockRecord, LocksDao } from './dao/locks';
export {
    SELECTION_STATUSES,
    type SelectionInput,
    type SelectionRecord,
    type SelectionStatus,
    SelectionsDao,
} from './dao/selections';
export { type OpenStoreOptions, openStore, SQLITE_BUSY_TIMEOUT_MS, type Store } from './db';
export { type ItemFacts, itemFacts, type SourceTier } from './facts';
export { unknownKkMigrationIds } from './migrations';
export {
    type CompileProfileOptions,
    compileProfile,
    DEFAULT_EXTRACT_LIMIT,
    type ExtractProfile,
    ITEM_DECISION_IDS,
    ProfileInvalidError,
    type ProfileOrder,
    type ProfilePredicate,
    type ProfileQuery,
    parseProfile,
} from './profile';
export {
    DEFAULT_STORY_POLICY,
    DEFAULT_STORY_THRESHOLD,
    DEFAULT_STORY_WINDOW_HOURS,
    type StoryCandidate,
    type StoryPolicy,
    type StoryUrlIdentity,
    storyIdFor,
    storyIdForUrls,
    storyTokens,
} from './story';
