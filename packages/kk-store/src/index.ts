/**
 * @gobing-ai/kk-store — the kk SQLite store: schema, migrations, DAOs, and the
 * store path resolver.
 *
 * The public surface is deliberately ts-db-free: consumers see `openStore`, the
 * DAO classes, row types, and the two pure identity helpers. ts-db types stay
 * inside the package (`src/db.ts`, `src/migrations.ts`).
 */

export { canonicalUrl, itemId } from './canonical-url';
export { DEFAULT_STORE_DB_PATH, resolveStorePath } from './config';
export {
    type CollectRunFinish,
    type CollectRunRecord,
    type CollectRunStart,
    CollectRunsDao,
} from './dao/collect-runs';
export {
    EpisodeUsageDao,
    type EpisodeUsageInput,
    type EpisodeUsageRecord,
} from './dao/episode-usage';
export { type ItemRecord, ItemsDao, type UpsertDocsResult } from './dao/items';
export { type LabelInput, type LabelRecord, type LabelSource, LabelsDao } from './dao/labels';
export { type LockRecord, LocksDao } from './dao/locks';
export { type OpenStoreOptions, openStore, SQLITE_BUSY_TIMEOUT_MS, type Store } from './db';
