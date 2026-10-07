import { dirname, join } from 'node:path';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { type ItemsDao, itemId, openStore, resolveStorePath } from '@gobing-ai/kk-store';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeSyncProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { resolveKkConfigPath, runInvoke } from '../invoke';
import { consoleOutput } from '../output';
import { readPluginJson } from '../plugin-output';

/** Default lock TTL for `kk store lock acquire`: 2 h (20261006 collection took ~32 min). */
const DEFAULT_LOCK_TTL_MS = 7_200_000;

/** Default maker for `kk store label`: the local model, because labelling is high volume and low stakes. */
const DEFAULT_MAKER = 'fm-local';

/** `labels.maker` for a row the plugin's keyword heuristic produced (no model was consulted). */
const HEURISTIC_MAKER = 'heuristic';

/** The heuristic's generator plugin, spawned through the executor seam — apps/cli owns no plugin source (R3). */
const LABEL_PLUGIN = 'episode-plan-gen';

/** Scratch dir under the `--new-ids` directory: the heuristic's in/out files and one evidence body per item. */
const LABEL_SCRATCH_DIR = 'label';

/** The category decision id and the choice labels the catalog declares for it (R1). */
const CATEGORY_DECISION_ID = 'kk-item-category';
const CATEGORY_LABELS: readonly string[] = ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'];

/** The four 0–5 QC dimensions, in catalog order: `kk-item-<dimension>`, rubric level 0–5. */
const SCORE_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;

/** Options accepted by `kk store migrate`. */
interface MigrateOptions {
    db?: string;
}

/** Options accepted by `kk store lock acquire`. */
interface LockAcquireOptions {
    name: string;
    run: string;
    ttl: string;
    db?: string;
}

/** Options accepted by `kk store lock release`. */
interface LockReleaseOptions {
    name: string;
    run: string;
    db?: string;
}

/** Options accepted by `kk store ingest`. */
interface IngestOptions {
    run: string;
    in: string;
    newIds: string;
    db?: string;
}

/**
 * Fail loud: print the `kk.store.<verb>.failed: <cause>` contract line and throw a
 * `CommanderError` that `main()` maps to exit code 1 (command modules never
 * terminate the process directly).
 */
function failLoud(code: string, error: unknown): never {
    const cause = error instanceof Error ? error.message : String(error);
    const message = `${code}: ${cause}`;
    consoleOutput.error(message);
    throw new CommanderError(1, code, message);
}

/** Parse `--ttl <ms>`: a non-negative millisecond count, rejected loudly when it is not. */
function parseTtl(raw: string): number {
    const ttlMs = Number(raw);
    if (!Number.isInteger(ttlMs) || ttlMs < 0) {
        throw new Error(`--ttl must be a non-negative integer (milliseconds), got '${raw}'`);
    }
    return ttlMs;
}

/**
 * `kk store migrate [--db <path>]` — apply pending store migrations, print
 * `{ db, applied }`.
 *
 * Idempotent: a second run against the same database reports `applied: 0` (the
 * migrator answers from the journal without taking a write lock). Any failure
 * throws a `CommanderError` whose exit code is 1 and whose message carries the
 * `kk.store.migrate.failed: <cause>` contract.
 */
async function migrateAction(options: MigrateOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        const applied = store.appliedMigrations;
        await store.close();
        consoleOutput.write(JSON.stringify({ db: dbPath, applied }));
    } catch (error) {
        // main() maps the CommanderError to the exit code but does not print it
        // (unlike commander's own errors), so the operator-facing line is written here.
        failLoud('kk.store.migrate.failed', error);
    }
}

/**
 * `kk store lock acquire --name <lock> --run <id> [--ttl <ms>] [--db <path>]` — take
 * the named single-flight lock, print `{"acquired":true}`, or `{"skipped":"locked",
 * "holder":<run>}` (exit 0) when another run holds a claim inside its TTL.
 *
 * Skipping is a normal outcome, not a failure: the scheduler's next tick retries. The
 * claim is re-entrant for the same `--run` and is stolen once `acquired_at + ttl`
 * passes, which is what covers a crashed holder (see `LocksDao.acquire`).
 */
async function lockAcquireAction(options: LockAcquireOptions): Promise<void> {
    try {
        const ttlMs = parseTtl(options.ttl);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            if (await store.locks.acquire(options.name, options.run, ttlMs)) {
                consoleOutput.write(JSON.stringify({ acquired: true }));
                return;
            }
            const holder = await store.locks.current(options.name);
            consoleOutput.write(JSON.stringify({ skipped: 'locked', holder: holder?.ownerRun ?? null }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.lock.failed', error);
    }
}

/**
 * `kk store lock release --name <lock> --run <id> [--db <path>]` — free the lock iff this
 * run still owns it, print `{released}`.
 *
 * A run that lost the claim (stolen past its TTL) releases nothing — `released: false` is
 * the honest answer, and still exit 0: the workflow's release step must never fail a run
 * whose work is already stored.
 */
async function lockReleaseAction(options: LockReleaseOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            const released = await store.locks.release(options.name, options.run);
            consoleOutput.write(JSON.stringify({ released }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.lock.failed', error);
    }
}

/**
 * Read and validate one `Doc[]` input file through the shared plugin-output reader (the
 * ts-runtime file seam plus the executor's DocListSchema wording), so `kk store ingest`
 * rejects the same shapes `kk executor fan-in` rejects.
 */
async function readDocList(fs: FileSystem, path: string): Promise<Doc[]> {
    if (!(await fs.exists(path))) {
        throw new Error(`input file not found: ${path}`);
    }
    return readPluginJson(fs, path, DocListSchema, `Store ingest input '${path}'`, 'is not a Doc[]');
}

/**
 * Ids of already-stored items the incoming Docs change — the half of `--new-ids` that
 * `ItemsDao.upsertDocs` invalidates labels for.
 *
 * `UpsertDocsResult` reports the inserted ids only, so this derives the other half: an
 * existing item whose stored `title`/`body` differ from the incoming Doc — the two fields
 * `content_hash` is computed over, compared directly instead of re-hashing. It must run
 * BEFORE the upsert, which overwrites those columns.
 */
async function invalidatedIds(items: ItemsDao, docs: readonly Doc[]): Promise<string[]> {
    const byId = new Map<string, Doc>();
    for (const doc of docs) {
        byId.set(itemId(doc), doc);
    }
    const invalidated: string[] = [];
    for (const [id, doc] of byId) {
        const stored = await items.findById(id);
        if (stored === undefined) {
            continue;
        }
        if (stored.title !== (doc.title ?? '') || stored.body !== doc.body) {
            invalidated.push(id);
        }
    }
    return invalidated;
}

/** Write the labelling input (`--new-ids`), creating its parent directory. */
async function writeNewIds(fs: FileSystem, path: string, ids: readonly string[]): Promise<void> {
    await fs.ensureDir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify([...new Set(ids)], null, 2)}\n`);
}

/**
 * `kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db <path>]` — upsert one
 * run's Docs, record its `collect_runs` provenance row, and print
 * `{inserted, updated, unchanged}`.
 *
 * `--new-ids` receives the ids the next label pass must decide: the inserted items plus the
 * known items whose content changed (their labels were invalidated with the update). One
 * `ItemsDao.upsertDocs` batch, so a rejected write stores nothing — the run's own workflow
 * state routes to its lock-releasing failure path and the next tick retries.
 */
async function ingestAction(options: IngestOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const docs = await readDocList(fs, options.in);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            const invalidated = await invalidatedIds(store.items, docs);
            await store.collectRuns.start({ runId: options.run });
            const result = await store.items.upsertDocs(options.run, docs);
            await store.collectRuns.finish(options.run, {
                status: 'done',
                inserted: result.inserted,
                updated: result.updated,
            });
            await writeNewIds(fs, options.newIds, [...result.newIds, ...invalidated]);
            consoleOutput.write(
                JSON.stringify({
                    inserted: result.inserted,
                    updated: result.updated,
                    unchanged: result.unchanged,
                }),
            );
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.ingest.failed', error);
    }
}

/** Options accepted by `kk store label`. */
interface LabelOptions {
    run: string;
    newIds: string;
    maker: string;
    mode: string;
    db?: string;
}

/** Labelling mode: `heuristic` asks the model only where the keyword pass is unsure; `decision` asks it for every item. */
type LabelMode = 'heuristic' | 'decision';

/** One stored item reduced to what the heuristic and the decisions see. */
interface LabelItem {
    id: string;
    title: string;
    body: string;
    source: string;
    /** Parsed `items.metadata_json` — the Doc metadata the heuristic reads (tags, engagement, relevance). */
    metadata: Record<string, unknown>;
}

/** One item's heuristic annotation as `EPISODE_PLAN_MODE=label` emits it (R3). */
interface Annotation {
    /** `metadata.category`, `null` when the plugin did not annotate the item. */
    category: string | null;
    /** `metadata.scores` — the four dimension levels, level absent when it is not a number. */
    scores: Record<string, number>;
    /** `metadata.needs_model` — the plugin's own verdict that a model second opinion is warranted. */
    needsModel: boolean;
}

/** One decision's payload as `spur decision run --json` prints it. */
interface DecisionResult {
    value: string | number;
    confidence: number | null;
    source: string;
    reason: string;
    maker: string;
}

/** One `labels` row to write, plus the source its report counter belongs to. */
interface LabelRow {
    itemId: string;
    decisionId: string;
    value: string;
    score: number | null;
    /** The routed decision's confidence, or `null` for a heuristic-only row (R4). */
    confidence: number | null;
    /** The collect run this pass belongs to (`--run`), stamped on every row (R4). */
    runId: string;
    source: 'heuristic' | 'model' | 'default';
    maker: string;
}

/**
 * The JSON parse entry point, bound locally: `cli-no-parse-at-module-scope` bans a bare
 * dot-parse call in `commands/*.ts` (it cannot tell a JSON parse from commander's program
 * parse — the same false positive that keeps `src/ledger.ts`'s parsing helpers out of its
 * command module). The label pass parses three payloads with no kk-core schema: `--new-ids`,
 * `items.metadata_json` and the `spur decision run` payload.
 */
const parseJson: (raw: string) => unknown = JSON.parse;

/** `--mode` as a `LabelMode`; anything else is a caller mistake, never a silent heuristic. */
function parseLabelMode(raw: string): LabelMode {
    if (raw !== 'heuristic' && raw !== 'decision') {
        throw new Error(`--mode must be 'heuristic' or 'decision', got '${raw}'`);
    }
    return raw;
}

/** The ids `--new-ids` lists, in file order, de-duplicated. */
async function readNewIds(fs: FileSystem, path: string): Promise<string[]> {
    if (!(await fs.exists(path))) {
        throw new Error(`new-ids file not found: ${path}`);
    }
    let parsed: unknown;
    try {
        parsed = parseJson(await fs.readFile(path));
    } catch {
        throw new Error(`new-ids file is not valid JSON: ${path}`);
    }
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
        throw new Error(`new-ids file must be a JSON array of item ids: ${path}`);
    }
    return [...new Set(parsed as string[])];
}

/** `items.metadata_json` as an object; a corrupt cell degrades to `{}` (the heuristic then default-denies). */
function parseMetadata(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = parseJson(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/** The stored items for `ids`, in `ids` order; an id the store does not hold is skipped (nothing to label). */
async function readLabelItems(items: ItemsDao, ids: readonly string[]): Promise<LabelItem[]> {
    const found: LabelItem[] = [];
    for (const id of ids) {
        const row = await items.findById(id);
        if (row === undefined) continue;
        found.push({
            id: row.id,
            title: row.title,
            body: row.body,
            source: row.source,
            metadata: parseMetadata(row.metadataJson),
        });
    }
    return found;
}

/** `metadata.scores` as dimension → level; a non-integer level is no annotation, never a coerced one. */
function parseScores(raw: unknown): Record<string, number> {
    const scores: Record<string, number> = {};
    if (typeof raw !== 'object' || raw === null) return scores;
    for (const [dimension, level] of Object.entries(raw)) {
        if (typeof level === 'number' && Number.isInteger(level)) scores[dimension] = level;
    }
    return scores;
}

/**
 * Id → annotation from the plugin's label-mode Content. An absent or malformed output yields no
 * annotations: the caller then routes every item to the decision catalog instead of failing.
 */
async function readAnnotations(fs: FileSystem, outputPath: string): Promise<Map<string, Annotation>> {
    const annotations = new Map<string, Annotation>();
    if (!(await fs.exists(outputPath))) return annotations;
    let content: Content;
    try {
        content = await readPluginJson(
            fs,
            outputPath,
            ContentSchema,
            `Plugin '${LABEL_PLUGIN}'`,
            'wrote an invalid Content',
        );
    } catch (error) {
        consoleOutput.error(
            `kk.store.label.heuristic-unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
        return annotations;
    }
    const docs = Array.isArray(content.metadata?.docs) ? content.metadata.docs : [];
    for (const doc of docs) {
        if (typeof doc !== 'object' || doc === null) continue;
        const record = doc as Record<string, unknown>;
        if (typeof record.id !== 'string') continue;
        const meta =
            typeof record.metadata === 'object' && record.metadata !== null
                ? (record.metadata as Record<string, unknown>)
                : {};
        annotations.set(record.id, {
            category: typeof meta.category === 'string' ? meta.category : null,
            scores: parseScores(meta.scores),
            needsModel: meta.needs_model === true,
        });
    }
    return annotations;
}

/**
 * Annotate every item through the plugin's keyword heuristic — `kk executor run episode-plan-gen`
 * with `EPISODE_PLAN_MODE=label` (R3) — so the heuristic stays the plugin's and apps/cli imports no
 * plugin source.
 *
 * A non-zero exit or an unreadable output is degradation, not failure (a collect run must never die
 * on labels): the empty map routes every item to the decision catalog, whose declared fallback
 * covers a dead backend and still names its source.
 */
async function heuristicAnnotations(
    fs: FileSystem,
    scratch: string,
    runId: string,
    items: readonly LabelItem[],
): Promise<Map<string, Annotation>> {
    if (items.length === 0) return new Map();
    const inputPath = join(scratch, 'label-input.json');
    const outputPath = join(scratch, 'label-out.json');
    await fs.ensureDir(scratch);
    const docs: Doc[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        metadata: item.metadata,
    }));
    await fs.writeFile(inputPath, JSON.stringify(docs));

    const previousMode = process.env.EPISODE_PLAN_MODE;
    process.env.EPISODE_PLAN_MODE = 'label';
    let code: number;
    try {
        code = await runInvoke({ plugin: LABEL_PLUGIN, inPath: inputPath, outPath: outputPath });
    } finally {
        if (previousMode === undefined) delete process.env.EPISODE_PLAN_MODE;
        else process.env.EPISODE_PLAN_MODE = previousMode;
    }
    if (code !== 0) {
        consoleOutput.error(
            `kk.store.label.heuristic-unavailable: ${LABEL_PLUGIN} exited ${code} for run ${runId}; routing every item to the decision catalog`,
        );
        return new Map();
    }
    return readAnnotations(fs, outputPath);
}

/** Drop the label scratch dir; absent, already gone or unremovable is never a label failure. */
async function removeScratch(fs: FileSystem, scratch: string): Promise<void> {
    try {
        if (await fs.exists(scratch)) await fs.deleteFile(scratch);
    } catch {
        // The run keeps its rows; a leftover scratch dir is not worth failing a collect run over.
    }
}

/**
 * Serve one decision for one item through the sanctioned external-command seam (`KK_SPUR_BIN`
 * override mirrors `kk ledger`): `spur decision run <id> --param title=… --param source=…
 * --evidence <body file> --maker <maker> --json`.
 *
 * `undefined` means "no usable answer" — a spawn failure, a non-zero exit (unknown id, catalog
 * load error) or unparseable stdout — which R6 treats exactly like `source: default`.
 */
function runDecision(
    decisionId: string,
    item: LabelItem,
    evidencePath: string,
    maker: string,
): DecisionResult | undefined {
    const command = process.env.KK_SPUR_BIN ?? 'spur';
    const result: ProcessResult = new NodeSyncProcessExecutor().runSync({
        command,
        args: [
            'decision',
            'run',
            decisionId,
            '--param',
            `title=${item.title}`,
            '--param',
            `source=${item.source}`,
            '--evidence',
            evidencePath,
            '--maker',
            maker,
            '--json',
        ],
    });
    if (result.exitCode !== 0) return undefined;
    try {
        return parseJson(result.stdout) as DecisionResult;
    } catch {
        return undefined;
    }
}

/** A decision payload's value as a storable `value`: an in-vocabulary choice label, or an integer level 0–5. */
function decisionValue(decisionId: string, raw: string | number): string | null {
    if (decisionId === CATEGORY_DECISION_ID) {
        return typeof raw === 'string' && CATEGORY_LABELS.includes(raw) ? raw : null;
    }
    const level = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(level) && level >= 0 && level <= 5 ? String(level) : null;
}

/** `labels.score`: the level for a score decision, `null` for the category choice. */
function scoreOf(decisionId: string, value: string): number | null {
    return decisionId === CATEGORY_DECISION_ID ? null : Number(value);
}

/**
 * Resolve one decision for one item into its `labels` row (R4/R6).
 *
 * `heuristic` is the plugin's answer — the value a degraded result must preserve. `routed` is true
 * when the item went to `spur decision run`, `result` is that call's payload (`undefined` on a
 * spawn failure). A `source: default` payload, a failure, and an out-of-vocabulary value all land
 * on the heuristic value with `source: default`; only an accepted, in-vocabulary `source: model`
 * answer replaces it.
 */
function labelRow(
    decisionId: string,
    item: LabelItem,
    heuristic: string | null,
    result: DecisionResult | undefined,
    routed: boolean,
    maker: string,
    runId: string,
): LabelRow | null {
    const confidence = routed ? (result?.confidence ?? null) : null;
    const rowOf = (value: string, source: LabelRow['source'], by: string): LabelRow => ({
        itemId: item.id,
        decisionId,
        value,
        score: scoreOf(decisionId, value),
        confidence,
        runId,
        source,
        maker: by,
    });
    if (routed && result?.source === 'model') {
        const value = decisionValue(decisionId, result.value);
        if (value !== null) return rowOf(value, 'model', result.maker ?? maker);
    }
    if (heuristic !== null) {
        return routed
            ? rowOf(heuristic, 'default', result?.maker ?? maker)
            : rowOf(heuristic, 'heuristic', HEURISTIC_MAKER);
    }
    if (routed && result !== undefined) {
        // No heuristic annotation at all (the plugin could not run): the catalog's own fallback is
        // the value to record, so the row is still written and still names its source.
        const value = decisionValue(decisionId, result.value);
        if (value !== null) return rowOf(value, 'default', result.maker ?? maker);
    }
    return null;
}

/**
 * Every `labels` row for one item: the category decision plus the four dimension decisions. In
 * heuristic mode only items the plugin flagged (`metadata.needs_model`) reach `spur decision run`
 * — the R5 cost contract and the report's `model`/`fallback` split both live here.
 */
async function labelItem(
    fs: FileSystem,
    scratch: string,
    item: LabelItem,
    annotation: Annotation | undefined,
    mode: LabelMode,
    maker: string,
    runId: string,
): Promise<LabelRow[]> {
    const routed = mode === 'decision' || annotation?.needsModel === true;
    let decide: ((decisionId: string) => DecisionResult | undefined) | null = null;
    if (routed) {
        const evidencePath = join(scratch, `evidence-${item.id}.md`);
        await fs.writeFile(evidencePath, item.body);
        decide = (decisionId) => runDecision(decisionId, item, evidencePath, maker);
    }
    const rows: LabelRow[] = [];
    const category = labelRow(
        CATEGORY_DECISION_ID,
        item,
        annotation?.category ?? null,
        decide?.(CATEGORY_DECISION_ID),
        routed,
        maker,
        runId,
    );
    if (category !== null) rows.push(category);
    for (const dimension of SCORE_DIMENSIONS) {
        const decisionId = `kk-item-${dimension}`;
        const level = annotation?.scores[dimension];
        const row = labelRow(
            decisionId,
            item,
            typeof level === 'number' ? String(level) : null,
            decide?.(decisionId),
            routed,
            maker,
            runId,
        );
        if (row !== null) rows.push(row);
    }
    return rows;
}

/**
 * `kk store label --run <id> --new-ids <path> [--maker fm-local] [--mode heuristic|decision] [--db <path>]`
 * — write one `labels` row per decision for the ids the last `kk store ingest` filed (R4), and print
 * `{labeled, model, fallback}` (R6).
 *
 * Heuristic-first (R5): every listed item is annotated by the plugin's own keyword heuristic through
 * `kk executor run episode-plan-gen` in `EPISODE_PLAN_MODE=label`, so apps/cli imports no plugin
 * source. Only items the heuristic files `non-ai` while seeing an AI signal (`metadata.needs_model`)
 * go to `spur decision run`; `--mode decision` sends every item. A degraded backend stores the
 * heuristic value with `source: default` and the command still exits 0 — a collect run must never
 * fail on labels.
 */
async function labelAction(options: LabelOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const mode = parseLabelMode(options.mode);
        const ids = await readNewIds(fs, options.newIds);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const scratch = join(dirname(options.newIds), LABEL_SCRATCH_DIR);
        const store = await openStore({ path: dbPath });
        try {
            const items = await readLabelItems(store.items, ids);
            const annotations = await heuristicAnnotations(fs, scratch, options.run, items);
            const rows: LabelRow[] = [];
            for (const item of items) {
                rows.push(
                    ...(await labelItem(fs, scratch, item, annotations.get(item.id), mode, options.maker, options.run)),
                );
            }
            for (const row of rows) {
                await store.labels.upsertLabel({
                    itemId: row.itemId,
                    decisionId: row.decisionId,
                    value: row.value,
                    maker: row.maker,
                    source: row.source,
                    score: row.score,
                    confidence: row.confidence,
                    runId: row.runId,
                });
            }
            consoleOutput.write(
                JSON.stringify({
                    labeled: rows.length,
                    model: rows.filter((row) => row.source === 'model').length,
                    fallback: rows.filter((row) => row.source === 'default').length,
                }),
            );
        } finally {
            await store.close();
            await removeScratch(fs, scratch);
        }
    } catch (error) {
        failLoud('kk.store.label.failed', error);
    }
}

/**
 * Register the `store` command group — the kk SQLite store surface.
 *
 * `migrate` brings the schema up; `lock` is the single-flight guard the scheduled
 * `kk-collect` tick takes before collecting; `ingest` is the write path that turns one run's
 * collected `Doc[]` into `items` rows plus its `collect_runs` provenance; `label` is the
 * heuristic-first decision pass over the ids `ingest` filed. The extract/mark-used verbs land on
 * the same noun as their store DAOs ship.
 */
export function registerStoreCommand(program: Command): void {
    const store = program.command('store').description('Operate the knowledge-kit store (SQLite)');

    store
        .command('migrate')
        .description('Apply pending store migrations (idempotent)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(migrateAction);

    const lock = store.command('lock').description('Single-flight locks over the store');

    lock.command('acquire')
        .description('Take the named lock for this run; prints {acquired} or {skipped, holder} (exit 0 both ways)')
        .requiredOption('--name <lock>', 'Lock name (e.g. collect)')
        .requiredOption('--run <id>', 'Owning run id (re-entrant for the same id)')
        .option('--ttl <ms>', 'Claim lifetime for a dead holder, in milliseconds', String(DEFAULT_LOCK_TTL_MS))
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(lockAcquireAction);

    lock.command('release')
        .description('Release the named lock iff this run still owns it; prints {released}')
        .requiredOption('--name <lock>', 'Lock name (e.g. collect)')
        .requiredOption('--run <id>', 'Owning run id')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(lockReleaseAction);

    store
        .command('ingest')
        .description('Upsert one run of collected Docs and record its collect_runs row; prints the counts')
        .requiredOption('--run <id>', 'Collect run id (also the items provenance stamp)')
        .requiredOption('--in <path>', 'Input Doc[] JSON file')
        .requiredOption('--new-ids <path>', 'Output path for the ids the next label pass must decide')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(ingestAction);

    store
        .command('label')
        .description(
            'Label the listed items: one labels row per decision, heuristic-first; prints {labeled, model, fallback}',
        )
        .requiredOption('--run <id>', 'Collect run id the labels belong to')
        .requiredOption('--new-ids <path>', 'Input path listing the item ids this pass must decide')
        .option('--maker <name>', 'Decision maker for the catalog calls', DEFAULT_MAKER)
        .option(
            '--mode <mode>',
            "Labeling mode: 'heuristic' (default) asks the model only where the keyword pass is unsure; 'decision' asks it for every item",
            'heuristic',
        )
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(labelAction);
}
