import { dirname, join, resolve } from 'node:path';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import {
    CHINA_POLITICS_DECISION_ID,
    compileProfile,
    type ExtractProfile,
    type ItemsDao,
    itemId,
    type LabelConfidence,
    type LabelPolicy,
    type LabelSource,
    labelConfidence,
    openStore,
    ProfileInvalidError,
    parseProfile,
    readStoreConfig,
    resolveStorePath,
    type SelectionInput,
    type Store,
    type StoredDoc,
    verdictConfidence,
} from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { createItemDecisionAsker, type DecisionAnswer, type DecisionAsker } from '../decision-hub';
import { resolveKkConfigPath, runInvoke } from '../invoke';
import { consoleOutput } from '../output';
import { readPluginJson } from '../plugin-output';
import { registerLockCommand } from './lock';

/** `labels.maker` for a row the plugin's keyword heuristic produced (no model was consulted). */
const HEURISTIC_MAKER = 'heuristic';

/** The heuristic's generator plugin, spawned through the executor seam — apps/cli owns no plugin source (R3). */
const LABEL_PLUGIN = 'episode-plan-gen';

/** Scratch dir under the `--new-ids` directory: the heuristic's in/out files and one evidence body per item. */
const LABEL_SCRATCH_DIR = 'label';

/**
 * Checkout-relative location of the topic profiles (R1). `kk store extract --topic t` reads
 * `<profile dir>/<t>.yaml` from the working checkout first, then from this module's own checkout
 * — the same two-candidate resolution `kk schedule render` uses for its templates, so a topic
 * works from any cwd that carries the profiles and from a package install that does not.
 */
const PROFILE_DIR_REL = 'plugins/kk/decisions/extract';

/** Package/checkout root: this module sits at `<root>/apps/cli/src/commands/`. */
const CHECKOUT_ROOT = resolve(import.meta.dir, '../../../..');

/**
 * Checkout-relative location of the item-label decision catalog (R1). The label pass stamps its
 * `version` on every observation as `catalog_version`, so the raw evidence says which rubric set
 * produced it; the same working-checkout-then-module-checkout resolution the profiles use.
 */
const CATALOG_PATH_REL = 'plugins/kk/decisions/kk-items.yaml';

/** A topic is a file-name slug, never a path — `..` or a separator must not escape the profile dir. */
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** `--window` duration units, in milliseconds. */
const WINDOW_UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Default `kk store extract --window`: the daily workflow's 24h pool (design §4). */
const DEFAULT_EXTRACT_WINDOW = '24h';

/** The category decision id and the choice labels the catalog declares for it (R1). */
const CATEGORY_DECISION_ID = 'kk-item-category';
const CATEGORY_LABELS: readonly string[] = ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'];

/** The four 0–5 QC dimensions, in catalog order: `kk-item-<dimension>`, rubric level 0–5. */
const SCORE_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;

/** The `kk-item-audience` choice vocabulary (task 0229 R2). */
const AUDIENCE_LABELS: readonly string[] = ['general', 'practitioner', 'researcher'];

/**
 * How one decision's value is validated and stored: a closed choice vocabulary, or a score whose
 * levels are `0 .. levels-1`.
 */
type LabelDecision =
    | { id: string; kind: 'choice'; labels: readonly string[] }
    | { id: string; kind: 'score'; levels: number };

/**
 * Every decision `kk store label` writes (task 0229 R3) — the ONE table the label pass, the
 * value validator and `--decisions` are derived from. The first five are the plugin keyword
 * heuristic's own surfaces ({@link HEURISTIC_DECISION_IDS}) and keep today's heuristic-first
 * routing; the last three have no heuristic signal, so they are consulted for every labelled item.
 */
const LABEL_DECISIONS: readonly LabelDecision[] = [
    { id: CATEGORY_DECISION_ID, kind: 'choice', labels: CATEGORY_LABELS },
    { id: 'kk-item-quality', kind: 'score', levels: 6 },
    { id: 'kk-item-importance', kind: 'score', levels: 6 },
    { id: 'kk-item-urgency', kind: 'score', levels: 6 },
    { id: 'kk-item-impact', kind: 'score', levels: 6 },
    { id: CHINA_POLITICS_DECISION_ID, kind: 'score', levels: 4 },
    { id: 'kk-item-sensitivity', kind: 'score', levels: 4 },
    { id: 'kk-item-audience', kind: 'choice', labels: AUDIENCE_LABELS },
];

/** The decisions the plugin's keyword heuristic annotates — the heuristic-first routing surface. */
const HEURISTIC_DECISION_IDS: readonly string[] = [
    CATEGORY_DECISION_ID,
    ...SCORE_DIMENSIONS.map((dimension) => `kk-item-${dimension}`),
];

/**
 * The four graded QC dimensions — the decisions 0317 R2 removed from the default consult set: they
 * feed no selection ranking, so only `--mode decision` (the explicit A/B surface) pays for them.
 */
const GRADED_DECISION_IDS: readonly string[] = SCORE_DIMENSIONS.map((dimension) => `kk-item-${dimension}`);

/** `labels.maker` for the china-politics prefilter's observation (R4): never the `heuristic` maker. */
const KEYWORD_MAKER = 'keyword';

/** How much of `items.body` the china-politics prefilter scans, after the title (R4). */
const CHINA_POLITICS_BODY_HEAD = 200;

/** Options accepted by `kk store migrate`. */
interface MigrateOptions {
    db?: string;
}

/** Options accepted by `kk store ingest`. */
interface IngestOptions {
    run: string;
    in: string;
    newIds: string;
    db?: string;
}

/** Options accepted by `kk store backfill-facts`. */
interface BackfillFactsOptions {
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
 * Read and validate one `Doc[]` input file through the shared plugin-output reader (the
 * ts-runtime file seam plus the executor's DocListSchema wording), so `kk store ingest`
 * rejects the same shapes `kk executor fan-in` rejects.
 */
async function readDocList(fs: FileSystem, path: string, label: string): Promise<Doc[]> {
    if (!(await fs.exists(path))) {
        throw new Error(`input file not found: ${path}`);
    }
    return readPluginJson(fs, path, DocListSchema, label, 'is not a Doc[]');
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

/**
 * Per-plugin attribution counts from the blended docs' `metadata.sources[].file` — the
 * `collect_runs.source_counts_json` payload. A doc fused from several plugins counts once per
 * plugin; a doc without source attribution counts nowhere (the map stays smaller, never wrong).
 */
function sourceCountsOf(docs: readonly Doc[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const doc of docs) {
        const sources = doc.metadata?.sources;
        if (!Array.isArray(sources)) continue;
        for (const source of sources) {
            const file = (source as { file?: unknown } | null)?.file;
            if (typeof file === 'string' && file !== '') counts[file] = (counts[file] ?? 0) + 1;
        }
    }
    return counts;
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
        const docs = await readDocList(fs, options.in, `Store ingest input '${options.in}'`);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const story = (await readStoreConfig(resolveKkConfigPath())).story;
        const store = await openStore({ path: dbPath });
        try {
            const invalidated = await invalidatedIds(store.items, docs);
            await store.collectRuns.start({ runId: options.run, sourceCounts: sourceCountsOf(docs) });
            const result = await store.items.upsertDocs(options.run, docs, Date.now(), story);
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

/** Options accepted by `kk store label`. `--run`/`--new-ids` and `--replay`/`--maker` are the two modes. */
interface LabelOptions {
    run?: string;
    newIds?: string;
    maker?: string;
    mode: string;
    /** `topic:<profile>` | `run:<collect-run-id>` | `since:<n><s|m|h|d>` — the replay selector (R6). */
    replay?: string;
    /** `--decisions <id,id>`: the decisions a replay routes (default: the whole catalog). */
    decisions?: string;
    /** The topic selector's pool window, `<n>s|m|h|d` (R6; ignored by `run:`/`since:`). */
    window: string;
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
    /** `items.content_hash` — stamped on every observation, so an edited item's answers stay attributable. */
    contentHash: string;
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

/**
 * One `labels` row to write — an observation (task 0226): the mapped verdict a consumer reads, plus
 * the raw evidence the mapping used to drop.
 */
interface LabelRow {
    itemId: string;
    decisionId: string;
    /** The storable value: the in-vocabulary label, or the heuristic/catalog fallback level. */
    value: string;
    score: number | null;
    /**
     * The verdict's `HIGH` | `MEDIUM` | `LOW` level (G31 R14), derived here at the emit boundary by
     * `labelConfidence(source, rawConfidence)` and never `null`. `min_confidence` does NOT touch it:
     * R5 keeps this mapping and gates only which stored observation is current.
     */
    confidence: LabelConfidence;
    /** The run this observation belongs to: `--run`, or `replay-<epoch-ms>` (R2/R6). */
    runId: string;
    source: LabelSource;
    maker: string;
    /** The maker's answer verbatim, before vocabulary mapping; `null` for a heuristic row. */
    rawValue: string | null;
    /** The model's raw 0–1 payload; `null` for a heuristic row and for a degraded answer. */
    rawConfidence: number | null;
    reason: string | null;
    durationMs: number | null;
    /** The decision catalog's `version` — `'unknown'` when the catalog could not be read (R1). */
    catalogVersion: string;
    /** The item's `content_hash` when the answer was made, so an edit never orphans it (R2). */
    contentHash: string;
}

/**
 * The JSON parse entry point, bound locally: `cli-no-parse-at-module-scope` bans a bare
 * dot-parse call in `commands/*.ts` (it cannot tell a JSON parse from commander's program
 * parse — the same false positive that keeps `src/ledger.ts`'s parsing helpers out of its
 * command module). The label pass parses three payloads with no kk-core schema: `--new-ids`,
 * `items.metadata_json` and the decision hub's answer.
 */
const parseJson: (raw: string) => unknown = JSON.parse;

/** The YAML parse entry point, bound like {@link parseJson} for the same module-scope rule. */
const parseYaml: (raw: string) => unknown = Bun.YAML.parse;

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
            contentHash: row.contentHash,
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

/** The {@link LABEL_DECISIONS} entry for `decisionId`, or `undefined` for an unknown decision. */
function labelDecision(decisionId: string): LabelDecision | undefined {
    return LABEL_DECISIONS.find((decision) => decision.id === decisionId);
}

/**
 * A decision payload's value as a storable `value`, validated against its own table entry (R3): an
 * in-vocabulary choice label, or an integer level in `[0, levels-1]`. An unknown decision, an
 * out-of-vocabulary label and an out-of-range level are all `null` (the answer is rejected, never
 * coerced into a neighbouring level).
 */
function decisionValue(decisionId: string, raw: string | number): string | null {
    const decision = labelDecision(decisionId);
    if (decision === undefined) return null;
    if (decision.kind === 'choice') {
        return typeof raw === 'string' && decision.labels.includes(raw) ? raw : null;
    }
    const level = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(level) && level >= 0 && level <= decision.levels - 1 ? String(Math.round(level)) : null;
}

/** `labels.score`: the level for a score decision, `null` for a choice decision. */
function scoreOf(decisionId: string, value: string): number | null {
    return labelDecision(decisionId)?.kind === 'score' ? Number(value) : null;
}

/**
 * The heuristic observation for one decision (R2): the plugin's keyword answer recorded as its own
 * maker, so every backtest has the baseline a model answer is compared against. It is written
 * whether or not the item was routed, and carries no raw model evidence.
 */
function heuristicRow(
    decisionId: string,
    item: LabelItem,
    value: string,
    runId: string,
    catalogVersion: string,
): LabelRow {
    return {
        itemId: item.id,
        decisionId,
        value,
        score: scoreOf(decisionId, value),
        confidence: labelConfidence('heuristic', null),
        runId,
        source: 'heuristic',
        maker: HEURISTIC_MAKER,
        rawValue: null,
        rawConfidence: null,
        reason: 'heuristic',
        durationMs: null,
        catalogVersion,
        contentHash: item.contentHash,
    };
}

/**
 * The maker's observation for one routed consult, or `null` when there is nothing to record (R2).
 *
 * The raw columns are the ANSWER VERBATIM: `raw_value` is `String(result.value)` before vocabulary
 * mapping, `raw_confidence` the model's 0–1 payload, `reason`/`duration_ms` its own statement and
 * cost. A below-threshold or out-of-vocabulary answer is therefore still evidence (AC1) even though
 * the mapped `value` a consumer reads stays the heuristic or catalog one. Only an accepted,
 * in-vocabulary `source: model` answer replaces the heuristic value and earns `source 'model'`; any
 * other answer (spur's `source: default`, an out-of-vocabulary value) keeps `source 'default'`. A
 * spawn failure (`result === undefined`) writes no maker row — the heuristic row still stands.
 */
function makerRow(
    decisionId: string,
    item: LabelItem,
    heuristic: string | null,
    result: DecisionAnswer | undefined,
    maker: string | undefined,
    runId: string,
    catalogVersion: string,
    onRefusal?: (key: string) => void,
): LabelRow | null {
    if (result === undefined) return null;
    const effectiveMaker = result.maker ?? maker ?? 'default';
    const rawConfidence = result.confidence ?? null;
    const rowOf = (value: string, source: LabelSource): LabelRow => ({
        itemId: item.id,
        decisionId,
        value,
        score: scoreOf(decisionId, value),
        confidence: labelConfidence(source, rawConfidence),
        runId,
        source,
        maker: effectiveMaker,
        rawValue: String(result.value),
        rawConfidence,
        reason: result.reason ?? null,
        durationMs: result.durationMs ?? null,
        catalogVersion,
        contentHash: item.contentHash,
    });
    if (result.source === 'model') {
        const value = decisionValue(decisionId, result.value);
        if (value !== null) return rowOf(value, 'model');
        onRefusal?.(`${decisionId}@${effectiveMaker}`);
    }
    if (heuristic !== null) return rowOf(heuristic, 'default');
    // No heuristic annotation at all (the plugin could not run): the catalog's own fallback is the
    // value to record, so the row is still written and still names its source.
    const fallback = decisionValue(decisionId, result.value);
    return fallback === null ? null : rowOf(fallback, 'default');
}

/** The heuristic's annotation for one decision, or `null` when the plugin has no signal (R3). */
function heuristicValueFor(decisionId: string, annotation: Annotation | undefined): string | null {
    if (annotation === undefined) return null;
    if (decisionId === CATEGORY_DECISION_ID) return annotation.category;
    for (const dimension of SCORE_DIMENSIONS) {
        if (`kk-item-${dimension}` === decisionId) {
            const level = annotation.scores[dimension];
            return typeof level === 'number' ? String(level) : null;
        }
    }
    return null;
}

/**
 * The first `store.labels.china_politics_terms` substring the item's title or body head contains,
 * case-insensitively — `null` when none does (R4). The default terms are top-leader and
 * central-institution only, so the scan can only ADD exclusions; the body head bounds its cost.
 */
function matchedChinaPoliticsTerm(item: LabelItem, terms: readonly string[]): string | null {
    const haystack = `${item.title}\n${item.body.slice(0, CHINA_POLITICS_BODY_HEAD)}`.toLowerCase();
    for (const term of terms) {
        if (term !== '' && haystack.includes(term.toLowerCase())) return term;
    }
    return null;
}

/**
 * The china-politics prefilter's observation for one keyword hit (R4): maker `keyword` (never
 * `heuristic`), source `heuristic`, value `3`. The decision's default priority ranks `keyword`
 * first, so a hit is a hard floor a model answer cannot talk back under the profile gate.
 */
function keywordRow(item: LabelItem, term: string, runId: string, catalogVersion: string): LabelRow {
    return {
        itemId: item.id,
        decisionId: CHINA_POLITICS_DECISION_ID,
        value: '3',
        score: 3,
        confidence: labelConfidence('heuristic', null),
        runId,
        source: 'heuristic',
        maker: KEYWORD_MAKER,
        rawValue: null,
        rawConfidence: null,
        reason: `keyword:${term}`,
        durationMs: null,
        catalogVersion,
        contentHash: item.contentHash,
    };
}

/** One item's labelling: the observations to write plus the model-consult cost the pass paid. */
interface LabelItemOutcome {
    rows: LabelRow[];
    /** Decision-hub consults attempted — the three judgment decisions cost one each for every item. */
    consults: number;
    /** Summed backend `durationMs` across those consults; absent usage counts as 0. */
    consultMs: number;
    refused: Record<string, number>;
}

/**
 * One item's labelling (R2/R3): the rows for every {@link LABEL_DECISIONS} entry. The heuristic's
 * five decisions are heuristic-first — their heuristic row is always written, and a maker consult
 * follows only when the item is routed (`--mode decision`, or the plugin flagged
 * `metadata.needs_model`). The three judgment decisions have no heuristic signal, so they are
 * consulted for EVERY labelled item in both modes; china-politics additionally writes its `keyword`
 * floor on a prefilter hit while STILL consulting the model, so a backtest keeps both rows.
 */
async function labelItem(
    item: LabelItem,
    annotation: Annotation | undefined,
    mode: LabelMode,
    maker: string | undefined,
    runId: string,
    catalogVersion: string,
    chinaPoliticsTerms: readonly string[],
    asker: DecisionAsker,
): Promise<LabelItemOutcome> {
    const routed = mode === 'decision' || annotation?.needsModel === true;
    let consults = 0;
    let consultMs = 0;
    const refused: Record<string, number> = {};
    const onRefusal = (key: string): void => {
        refused[key] = (refused[key] ?? 0) + 1;
    };
    const decide = async (decisionId: string): Promise<DecisionAnswer | undefined> => {
        consults += 1;
        const result = await asker.ask(decisionId, { title: item.title, source: item.source, body: item.body }, maker);
        consultMs += result?.durationMs ?? 0;
        return result;
    };
    const rows: LabelRow[] = [];
    for (const decision of LABEL_DECISIONS) {
        const heuristicAnnotated = HEURISTIC_DECISION_IDS.includes(decision.id);
        const heuristic = heuristicAnnotated ? heuristicValueFor(decision.id, annotation) : null;
        if (heuristic !== null) rows.push(heuristicRow(decision.id, item, heuristic, runId, catalogVersion));
        // The heuristic-annotated decisions keep the R5 cost contract: consulted only when routed.
        if (heuristicAnnotated && !routed) continue;
        // 0317 R2: the four graded dimensions feed no selection ranking (the run's own evidence —
        // 0/72 selected items carried a model label and the outcome join shows no separation), so
        // the default pass stops paying for them. `--mode decision` is the explicit A/B surface and
        // still routes all eight.
        if (GRADED_DECISION_IDS.includes(decision.id) && mode !== 'decision') continue;
        if (decision.id === CHINA_POLITICS_DECISION_ID) {
            const term = matchedChinaPoliticsTerm(item, chinaPoliticsTerms);
            if (term !== null) rows.push(keywordRow(item, term, runId, catalogVersion));
        }
        const row = makerRow(
            decision.id,
            item,
            heuristic,
            await decide(decision.id),
            maker,
            runId,
            catalogVersion,
            onRefusal,
        );
        if (row !== null) rows.push(row);
    }
    return { rows, consults, consultMs, refused };
}

/**
 * One replay pass over one item (R6): the selected decisions are routed in decision mode and ONLY
 * the maker's observations are written — no heuristic row (the baseline every backtest compares
 * against must survive a replay) and no other maker's row is touched (AC3). With no heuristic this
 * path passes `null`, so a degraded answer falls to the catalog's own fallback value. The
 * china-politics prefilter is NOT run here: a `keyword` row would be a second maker's observation.
 */
async function replayItem(
    item: LabelItem,
    decisionIds: readonly string[],
    maker: string,
    runId: string,
    catalogVersion: string,
    asker: DecisionAsker,
): Promise<LabelItemOutcome> {
    const rows: LabelRow[] = [];
    let consults = 0;
    let consultMs = 0;
    const refused: Record<string, number> = {};
    const onRefusal = (key: string): void => {
        refused[key] = (refused[key] ?? 0) + 1;
    };
    for (const decisionId of decisionIds) {
        consults += 1;
        const result = await asker.ask(decisionId, { title: item.title, source: item.source, body: item.body }, maker);
        consultMs += result?.durationMs ?? 0;
        const row = makerRow(decisionId, item, null, result, maker, runId, catalogVersion, onRefusal);
        if (row !== null) rows.push(row);
    }
    return { rows, consults, consultMs, refused };
}

/** Every catalog decision id, in the order the label pass writes them — the table is the source (R3). */
const CATALOG_DECISION_IDS: readonly string[] = LABEL_DECISIONS.map((decision) => decision.id);

/** The parsed `--replay` selector: exactly one of the three prefixes (R6). */
type ReplaySelector =
    | { kind: 'topic'; value: string }
    | { kind: 'run'; value: string }
    | { kind: 'since'; value: string };

/**
 * Parse `--replay <selector>` (R6). A missing prefix, an unknown prefix, a blank value or a
 * `since:` without a unit is a caller mistake, never a silently empty replay.
 */
function parseReplaySelector(raw: string): ReplaySelector {
    const match = /^(topic|run|since):(.+)$/.exec(raw.trim());
    const kind = match?.[1];
    const value = match?.[2]?.trim();
    if (kind === undefined || value === undefined || value === '') {
        throw new Error(
            `--replay must be 'topic:<profile>', 'run:<collect-run-id>' or 'since:<n><s|m|h|d>', got '${raw}'`,
        );
    }
    if (kind === 'since') parseWindow(value);
    return { kind, value } as ReplaySelector;
}

/** `--decisions <id,id>`: the catalog decisions a replay routes (default: the whole catalog, R6). */
function parseDecisions(raw: string | undefined): string[] {
    if (raw === undefined) return [...CATALOG_DECISION_IDS];
    const ids = [
        ...new Set(
            raw
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id !== ''),
        ),
    ];
    if (ids.length === 0) throw new Error('--decisions must name at least one decision id');
    for (const id of ids) {
        if (!CATALOG_DECISION_IDS.includes(id)) {
            throw new Error(
                `--decisions: unknown decision id '${id}' (expected one of ${CATALOG_DECISION_IDS.join(', ')})`,
            );
        }
    }
    return ids;
}

/**
 * The catalog `version` stamped on every observation (R1). An unreadable or unversioned catalog
 * yields `'unknown'`: the pass records its evidence rather than failing a collect run over a stamp.
 */
async function readCatalogVersion(fs: FileSystem): Promise<string> {
    const candidates = [resolve(process.cwd(), CATALOG_PATH_REL), resolve(CHECKOUT_ROOT, CATALOG_PATH_REL)];
    for (const path of candidates) {
        try {
            if (!(await fs.exists(path))) continue;
            const parsed: unknown = parseYaml(await fs.readFile(path));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
            const version = (parsed as Record<string, unknown>).version;
            if (typeof version === 'string' && version.trim() !== '') return version;
            if (typeof version === 'number' && Number.isFinite(version)) return String(version);
        } catch {
            // Fall through to the next candidate; 'unknown' is the honest stamp when none reads.
        }
    }
    return 'unknown';
}

/** Write one pass's observations through the DAO, so the row identity/upsert rules stay in one place. */
async function writeRows(store: Store, rows: readonly LabelRow[]): Promise<void> {
    for (const row of rows) {
        await store.labels.recordObservation({
            itemId: row.itemId,
            decisionId: row.decisionId,
            value: row.value,
            maker: row.maker,
            source: row.source,
            score: row.score,
            confidence: row.confidence,
            runId: row.runId,
            rawValue: row.rawValue,
            rawConfidence: row.rawConfidence,
            reason: row.reason,
            durationMs: row.durationMs,
            catalogVersion: row.catalogVersion,
            contentHash: row.contentHash,
        });
    }
}

/**
 * The share of a label pass's consults that may fall back to the fail-closed default before the pass
 * reports itself `degraded` (task 0268 R1/R2). A MAJORITY of consults answered `source: default`
 * (spur's `no-backend` degradation) means the decision backend is sick, not the corpus: the
 * 2026-10-12 incident measured `fallback: 22/26` (0.85) and `33/45` (0.73), both far past this rail.
 * Kept at one-half rather than one so a single surviving answer among a mostly-dead backend still
 * escalates, while a healthy pass (fallback 0, or a rare refused answer) stays silent. The pass
 * still prints `verdict: PASS`: a non-`PASS` verdict would send `kk-collect` to `release-failed` and
 * discard the labels it did write, so `degraded` on stdout plus the stderr warning is the signal.
 */
const DEGRADED_FALLBACK_SHARE = 0.5;

/** The `--new-ids` pass: annotate, route, write both observation kinds, print the verdict line. */
async function labelNewIds(
    fs: FileSystem,
    store: Store,
    runId: string,
    newIds: string,
    maker: string | undefined,
    mode: LabelMode,
    catalogVersion: string,
    scratch: string,
    chinaPoliticsTerms: readonly string[],
    asker: DecisionAsker,
): Promise<void> {
    const ids = await readNewIds(fs, newIds);
    const items = await readLabelItems(store.items, ids);
    const annotations = await heuristicAnnotations(fs, scratch, runId, items);
    const rows: LabelRow[] = [];
    let consults = 0;
    let consultMs = 0;
    const totalRefused: Record<string, number> = {};
    for (const item of items) {
        const outcome = await labelItem(
            item,
            annotations.get(item.id),
            mode,
            maker,
            runId,
            catalogVersion,
            chinaPoliticsTerms,
            asker,
        );
        rows.push(...outcome.rows);
        consults += outcome.consults;
        consultMs += outcome.consultMs;
        for (const [key, count] of Object.entries(outcome.refused)) {
            totalRefused[key] = (totalRefused[key] ?? 0) + count;
        }
    }
    await writeRows(store, rows);
    const fallback = rows.filter((row) => row.source === 'default').length;
    // R2 — a degraded backend, not a corpus fact: warn on the boundary kk-collect reads
    // (launchd.log/the ledger) so a sick pass is visible without opening the store.
    const degraded = consults > 0 && fallback / consults > DEGRADED_FALLBACK_SHARE;
    if (degraded) {
        const share = Math.round((fallback / consults) * 100);
        consoleOutput.error(
            `kk.store.label.degraded: fallback: ${fallback}/${consults} consults (${share}%) — the decision ` +
                'backend answered from the fail-closed default for most consults; the moderation rail fired ' +
                "and the labels are not the model's (task 0268 R1/R2)",
        );
    }
    consoleOutput.write(
        JSON.stringify({
            verdict: 'PASS',
            confidence: verdictConfidence(rows.map((row) => row.confidence)),
            labeled: rows.length,
            model: rows.filter((row) => row.source === 'model').length,
            fallback,
            consults,
            consultMs,
            degraded,
            refused: totalRefused,
        }),
    );
}

/** Every stored id a replay selector names, in a stable order (R6). */
async function replayItemIds(
    fs: FileSystem,
    store: Store,
    selector: ReplaySelector,
    window: string,
    policy: LabelPolicy,
): Promise<string[]> {
    if (selector.kind === 'run') return store.items.idsByRun(selector.value);
    if (selector.kind === 'since') return store.items.idsSince(Date.now() - parseWindow(selector.value));
    const profilePath = await resolveProfilePath(fs, selector.value);
    const profile = parseProfile(await fs.readFile(profilePath));
    if (profile.topic !== selector.value) {
        throw new ProfileInvalidError(
            `profile '${profilePath}' declares topic '${profile.topic}', not '${selector.value}'`,
        );
    }
    // No exclusion: a replay re-labels the profile's pool whatever production already selected.
    const query = compileProfile(profile, { windowMs: parseWindow(window), now: Date.now() });
    return (await store.items.selectByProfile(query, policy)).map((doc) => doc.id);
}

/**
 * The `--replay` pass (R6): route the selector's pool to `--maker` under a fresh
 * `replay-<epoch-ms>` run id and print `{replayed, consults, consultMs, run}`. A selector that
 * matches nothing prints `replayed: 0` and exits 0 — an empty pool is an answer, not an error.
 */
async function replaySelected(
    fs: FileSystem,
    store: Store,
    selector: ReplaySelector,
    decisions: string | undefined,
    window: string,
    maker: string,
    catalogVersion: string,
    policy: LabelPolicy,
    asker: DecisionAsker,
): Promise<void> {
    const decisionIds = parseDecisions(decisions);
    const ids = await replayItemIds(fs, store, selector, window, policy);
    const items = await readLabelItems(store.items, ids);
    const runId = `replay-${Date.now()}`;
    const rows: LabelRow[] = [];
    let consults = 0;
    let consultMs = 0;
    for (const item of items) {
        const outcome = await replayItem(item, decisionIds, maker, runId, catalogVersion, asker);
        rows.push(...outcome.rows);
        consults += outcome.consults;
        consultMs += outcome.consultMs;
    }
    await writeRows(store, rows);
    consoleOutput.write(JSON.stringify({ replayed: items.length, consults, consultMs, run: runId }));
}

/**
 * `kk store label --run <id> --new-ids <path> [--maker <name>] [--mode heuristic|decision]
 * [--db <path>]` — write one observation per (item, decision, maker) for the ids the last
 * `kk store ingest` filed, and print `{verdict, confidence, labeled, model, fallback, consults,
 * consultMs}`.
 *
 * `kk store label --replay <selector> --maker <name> [--decisions <ids>] [--window <duration>]
 * [--db <path>]` re-labels a HISTORICAL pool with another maker without disturbing production
 * selection (R6): the selector is exactly one of `topic:<profile>` (the profile's pool, no
 * exclusion), `run:<collect-run-id>` (`first_seen_run`/`last_seen_run`) or `since:<n><s|m|h|d>`
 * (`first_seen_at`); every selected item is routed in decision mode, only maker rows are written
 * under `replay-<epoch-ms>`, and stdout is `{replayed, consults, consultMs, run}`. `--replay` is
 * mutually exclusive with `--new-ids` and requires `--maker`; either violation exits 1.
 *
 * Heuristic-first (R5): every listed item is annotated by the plugin's own keyword heuristic through
 * `kk executor run episode-plan-gen` in `EPISODE_PLAN_MODE=label`, so apps/cli imports no plugin
 * source. Only items the heuristic files `non-ai` while seeing an AI signal (`metadata.needs_model`)
 * go to the decision hub; `--mode decision` sends every item (and is the only mode that consults the
 * four graded QC dimensions, task 0317 R2). Every observation keeps the answer
 * raw (`raw_value`, `raw_confidence`, `reason`, `duration_ms`), the item's `content_hash`, the
 * catalog `version` and its run id (R2). A degraded backend keeps the heuristic value with
 * `source: default` and the command still exits 0 — a collect run must never fail on labels.
 *
 * The printed line is the pass's verdict (G31 R14): `verdict: PASS` plus exactly one
 * `HIGH | MEDIUM | LOW` level, the weakest level among the rows this pass wrote. The
 * `kk-collect` workflow's `label` guard reads that line through the same confidence-aware `jq`
 * filter the judge gates use, so a verdict whose level is missing or outside the enum is refused
 * instead of read as a pass.
 */
/**
 * The two mutually exclusive label modes (R2/R6): the `--new-ids` pass, or a `--replay` selector.
 */
type LabelPlan =
    | { kind: 'new-ids'; runId: string; newIds: string }
    | { kind: 'replay'; selector: ReplaySelector; maker: string };

/**
 * Resolve the flags into one plan. Every violation — both modes, neither mode, `--replay` without
 * `--maker`, `--new-ids` without `--run`, `--decisions` without `--replay` — is a caller mistake
 * that exits 1, never a pass that silently labels nothing.
 */
function parseLabelPlan(options: LabelOptions): LabelPlan {
    const { newIds, run } = options;
    const maker = options.maker?.trim() ?? '';
    if (options.replay === undefined) {
        if (options.decisions !== undefined) throw new Error('--decisions requires --replay');
        if (newIds === undefined || run === undefined) {
            throw new Error('--new-ids and --run are required, or use --replay with --maker');
        }
        return { kind: 'new-ids', runId: run, newIds };
    }
    if (newIds !== undefined) throw new Error('--replay and --new-ids are mutually exclusive');
    if (maker === '') throw new Error('--replay requires --maker');
    return { kind: 'replay', selector: parseReplaySelector(options.replay), maker };
}

async function labelAction(options: LabelOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const plan = parseLabelPlan(options);
        const mode = parseLabelMode(options.mode);
        const configPath = resolveKkConfigPath();
        const dbPath = await resolveStorePath(configPath, options.db);
        const scratch = join(dirname(plan.kind === 'new-ids' ? plan.newIds : dbPath), LABEL_SCRATCH_DIR);
        const store = await openStore({ path: dbPath });
        const catalogVersion = await readCatalogVersion(fs);
        // ONE config read (R4): the maker policy ranks the observations, and the china-politics
        // prefilter's terms come from the same `store.labels` block.
        const labels = (await readStoreConfig(configPath)).labels;
        // 0317 R8: ONE warm decision hub for the whole batch, disposed below (a laya maker holds a
        // Python worker whose open pipes would otherwise keep the process alive).
        const asker = await createItemDecisionAsker();
        try {
            if (plan.kind === 'replay') {
                await replaySelected(
                    fs,
                    store,
                    plan.selector,
                    options.decisions,
                    options.window,
                    plan.maker,
                    catalogVersion,
                    labels,
                    asker,
                );
            } else {
                await labelNewIds(
                    fs,
                    store,
                    plan.runId,
                    plan.newIds,
                    options.maker,
                    mode,
                    catalogVersion,
                    scratch,
                    labels.chinaPoliticsTerms,
                    asker,
                );
            }
        } finally {
            await asker.dispose();
            await store.close();
            await removeScratch(fs, scratch);
        }
    } catch (error) {
        failLoud('kk.store.label.failed', error);
    }
}

/** Options accepted by `kk store extract`. */
interface ExtractOptions {
    topic: string;
    window: string;
    limit?: string;
    /** Opt out of the topic-scoped selection exclusion (R4). */
    includeSelected?: boolean;
    out: string;
    db?: string;
}

/** Options accepted by `kk store pool-count`. */
interface PoolCountOptions {
    file: string;
    min: string;
}

/** Options accepted by `kk store select`. */
interface SelectOptions {
    topic: string;
    workflow: string;
    run: string;
    in: string;
    db?: string;
}

/** Options accepted by `kk store mark-published`. */
interface MarkPublishedOptions {
    topic: string;
    run: string;
    /** Optional `Doc[]` / `metadata.docs` file narrowing the promotion to the listed ids. */
    in?: string;
    db?: string;
}

/** Options accepted by `kk store release`. */
interface ReleaseOptions {
    run: string;
    /** Omitted = every topic the run selected for. */
    topic?: string;
    db?: string;
}

/**
 * `--window <n><s|m|h|d>` as milliseconds. A duration without a unit, a zero window or an
 * unparseable value is a caller mistake — a silently defaulted window would change the pool.
 */
function parseWindow(raw: string): number {
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    const amount = match?.[1];
    const unit = match?.[2];
    if (amount === undefined || unit === undefined) {
        throw new Error(`--window must be '<n>s|m|h|d' (e.g. 24h), got '${raw}'`);
    }
    const milliseconds = Number(amount) * (WINDOW_UNITS[unit] ?? 0);
    if (milliseconds <= 0) {
        throw new Error(`--window must be greater than zero, got '${raw}'`);
    }
    return milliseconds;
}

/** `--limit <n>` as a positive integer; `0` or a fraction is a caller mistake, never an empty pool. */
function parseLimit(raw: string): number {
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error(`--limit must be a positive integer, got '${raw}'`);
    }
    return limit;
}

/**
 * The profile file for `topic`, from the working checkout first and this module's own checkout
 * second (a package install carries the profiles beside the CLI).
 */
async function resolveProfilePath(fs: FileSystem, topic: string): Promise<string> {
    if (!TOPIC_SLUG.test(topic)) {
        throw new Error(`--topic must be a lowercase slug (e.g. ai-news), got '${topic}'`);
    }
    const candidates = [
        resolve(process.cwd(), PROFILE_DIR_REL, `${topic}.yaml`),
        resolve(CHECKOUT_ROOT, PROFILE_DIR_REL, `${topic}.yaml`),
    ];
    for (const path of candidates) {
        if (await fs.exists(path)) return path;
    }
    throw new Error(`no profile for topic '${topic}': expected one of ${candidates.join(' or ')}`);
}

/**
 * One stored item as the pool's `Doc` — the fan-in `blended.json` shape plus `metadata.labels`
 * (decision id → stored value), so episode-plan-gen consumes the pool unchanged (R2).
 */
function toPoolDoc(item: StoredDoc): Doc {
    return {
        id: item.id,
        title: item.title,
        body: item.body,
        ...(item.sourceUri === null ? {} : { sourceUri: item.sourceUri }),
        ...(item.mediaType === null ? {} : { mediaType: item.mediaType }),
        metadata: { ...item.metadata, labels: item.labels },
    };
}

/**
 * `kk store extract --topic <t> [--window 24h] [--limit n] [--include-selected]`
 * `--out <Doc[].json> [--db <path>]` — compile the topic profile into one store query, write the
 * pool as `Doc[]` and print `{count}` (R2/R3/R4).
 *
 * The pool always excludes items whose story is already `selected` or `published` for THIS topic —
 * the `selections` ledger 0228 writes — so a planned item never re-enters the next day's pool.
 * `--include-selected` is the explicit opt-out. The store is only ever read: extract spawns no
 * plugin, so it neither ingests nor labels (R6). An empty pool writes `[]`, prints `{"count":0}` and
 * still exits 0 — the caller conditions on `count`, not on the exit code. A profile the compiler
 * rejects exits 1 with `kk.store.profile.invalid`; every other failure is `kk.store.extract.failed`.
 */
async function extractAction(options: ExtractOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const profilePath = await resolveProfilePath(fs, options.topic);
        const profile: ExtractProfile = parseProfile(await fs.readFile(profilePath));
        if (profile.topic !== options.topic) {
            throw new ProfileInvalidError(
                `profile '${profilePath}' declares topic '${profile.topic}', not '${options.topic}'`,
            );
        }
        const query = compileProfile(profile, {
            windowMs: parseWindow(options.window),
            now: Date.now(),
            ...(options.limit === undefined ? {} : { limit: parseLimit(options.limit) }),
            // Topic-scoped, story-level exclusion is the default (R4): an item already selected or
            // published for THIS topic never re-enters its pool. `--include-selected` opts out.
            ...(options.includeSelected === true ? {} : { excludeTopic: options.topic }),
        });
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            // The label policy decides which observation is current; it lives in the operator config
            // (`store.labels.*`), so re-tuning the threshold re-ranks history with no model calls (R4).
            const policy: LabelPolicy = (await readStoreConfig(resolveKkConfigPath())).labels;
            const docs = (await store.items.selectByProfile(query, policy)).map(toPoolDoc);
            await fs.ensureDir(dirname(options.out));
            await fs.writeFile(options.out, `${JSON.stringify(docs, null, 2)}\n`);
            consoleOutput.write(JSON.stringify({ count: docs.length }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud(error instanceof ProfileInvalidError ? 'kk.store.profile.invalid' : 'kk.store.extract.failed', error);
    }
}

/**
 * The `Doc[]` a pool artifact holds: a bare `Doc[]` (what `extract` writes) or an object carrying
 * `metadata.docs` (the QC candidates file the content branch produces). Anything else — a missing
 * file, invalid JSON, a shape neither consumer writes — is a caller mistake and fails loud.
 */
async function readPoolDocs(fs: FileSystem, path: string): Promise<Doc[]> {
    if (!(await fs.exists(path))) {
        throw new Error(`input file not found: ${path}`);
    }
    let parsed: unknown;
    try {
        parsed = parseJson(await fs.readFile(path));
    } catch {
        throw new Error(`input file is not valid JSON: ${path}`);
    }
    if (Array.isArray(parsed)) return parsed as Doc[];
    const docs = (parsed as { metadata?: { docs?: unknown } } | null)?.metadata?.docs;
    if (Array.isArray(docs)) return docs as Doc[];
    throw new Error(`input file must be a Doc[] or an object whose metadata.docs is a Doc[]: ${path}`);
}

/**
 * Item count of a daily pool artifact, through {@link readPoolDocs}. Anything the reader rejects —
 * a missing file, an empty file, a shape neither consumer writes — counts as 0, which is the answer
 * the guard needs, not an error: the caller's question is "is there anything to do?".
 */
async function countPoolItems(fs: FileSystem, path: string): Promise<number> {
    try {
        return (await readPoolDocs(fs, path)).length;
    } catch {
        return 0;
    }
}

/**
 * `kk store pool-count <file> --min <n>` — the workflow-guard predicate over a pool artifact:
 * exit 0 when the file holds at least `n` items, exit 1 (naming the count) otherwise.
 *
 * A DAG node's `condition` is a shell predicate, and `plugins/kk/workflows/*` may not use inline
 * jq (ADR-115 boundary), so the count has to be a `kk` verb. It prints `{count, min}` either way
 * so the same line is the evidence in a trace whether the guard passed or refused.
 */
async function poolCountAction(options: PoolCountOptions): Promise<void> {
    try {
        const min = Number(options.min);
        if (!Number.isInteger(min) || min < 0) {
            throw new Error(`--min must be a non-negative integer, got '${options.min}'`);
        }
        const fs = createNodeFileSystem();
        const count = await countPoolItems(fs, options.file);
        consoleOutput.write(JSON.stringify({ count, min }));
        if (count < min) {
            throw new Error(`'${options.file}' holds ${count} item(s), below --min ${min}`);
        }
    } catch (error) {
        failLoud('kk.store.pool-count.empty', error);
    }
}

/**
 * `kk store select --topic <t> --workflow <w> --run <id> --in <Doc[].json> [--db <path>]` — record
 * the run's planned set as `selected` rows in the topic-scoped `selections` ledger (R1).
 *
 * Selection happens when the run has COMMITTED to its set, so the cross-day exclusion no longer
 * depends on the DAG reaching its tail: a run that fails, pauses or skips publish still excludes
 * what it planned. `--in` is the same two shapes `pool-count` reads (`Doc[]`, or an object whose
 * `metadata.docs` is a `Doc[]` — the QC candidates file). Guards that make a silent no-op impossible:
 * a third shape, an unreadable file, or a doc id the store does not hold fails loud with nothing
 * written (no partial ledger). Duplicate ids collapse to one row (`rank` is the first 1-based input
 * position), and a repeat of `(topic, item_id, run_id)` writes nothing — never resetting a row a
 * later `mark-published` or `release` moved. `reason` is NULL in voice2 (no per-item rationale).
 */
async function selectAction(options: SelectOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const docs = await readPoolDocs(fs, options.in);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            // First occurrence wins the rank; every distinct id gets exactly one row.
            const ranks = new Map<string, number>();
            for (const [index, doc] of docs.entries()) {
                if (!ranks.has(doc.id)) ranks.set(doc.id, index + 1);
            }
            // Read EVERY item before writing anything: an unknown id must leave zero rows behind.
            const now = Date.now();
            const rows: SelectionInput[] = [];
            for (const [id, rank] of ranks) {
                const item = await store.items.findById(id);
                if (item === undefined) {
                    throw new Error(`item '${id}' is not in the store; nothing was selected`);
                }
                rows.push({
                    topic: options.topic,
                    itemId: id,
                    runId: options.run,
                    storyId: item.storyId ?? id,
                    workflow: options.workflow,
                    rank,
                    status: 'selected',
                    selectedAt: now,
                });
            }
            consoleOutput.write(JSON.stringify({ selected: await store.selections.insertMany(rows, now) }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.select.failed', error);
    }
}

/**
 * `kk store mark-published --topic <t> --run <id> [--in <path>] [--db <path>]` — promote that run's
 * `selected` rows to `published` and stamp `published_at` (R2).
 *
 * With `--in` only the listed doc ids move (same two shapes as `select`); without it, the whole
 * run. A run with nothing to promote — no rows, or all of them already `published`/`dropped` —
 * prints `{published: 0}` and exits 0: publishing is the tail of the publish subtree, and a run
 * that never published is a normal outcome, not an error.
 */
async function markPublishedAction(options: MarkPublishedOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        let itemIds: string[] | undefined;
        if (options.in !== undefined) {
            itemIds = [...new Set((await readPoolDocs(fs, options.in)).map((doc) => doc.id))];
        }
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            const published = await store.selections.updateStatus(options.run, options.topic, 'published', itemIds);
            consoleOutput.write(JSON.stringify({ published }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.mark-published.failed', error);
    }
}

/**
 * `kk store release --run <id> [--topic <t>] [--db <path>]` — move that run's `selected` rows to
 * `dropped`, returning its items to the pool (R3).
 *
 * The operator's tool for a failed run (R7 names it in `kk daily prepare`). `published` rows are
 * never touched: an aired episode must not silently re-admit. Without `--topic` every topic the run
 * selected for is released.
 */
async function releaseAction(options: ReleaseOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            let released = 0;
            if (options.topic !== undefined) {
                released = await store.selections.updateStatus(options.run, options.topic, 'dropped');
            } else {
                // No topic: the run's own rows name the topics to release. `updateStatus` still refuses
                // to move a `published` row, so a partially published run releases only what it planned.
                const topics = new Set(
                    (await store.selections.listByRun(options.run))
                        .filter((row) => row.status === 'selected')
                        .map((row) => row.topic),
                );
                for (const topic of topics) {
                    released += await store.selections.updateStatus(options.run, topic, 'dropped');
                }
            }
            consoleOutput.write(JSON.stringify({ released }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.release.failed', error);
    }
}

/**
 * `kk store backfill-facts [--db <path>]` — recompute the typed item facts and the causal
 * `story_id` clustering for every stored item (0227 R4); prints `{updated}`, the count of rows
 * whose values actually changed.
 *
 * Idempotent: a second run prints `updated: 0`, because the facts are pure functions of the row
 * and the story pass re-derives the same roots in `first_seen_at, id` order. Failure exits 1 with
 * `kk.store.backfill-facts.failed: <cause>`.
 */
async function backfillFactsAction(options: BackfillFactsOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const story = (await readStoreConfig(resolveKkConfigPath())).story;
        const store = await openStore({ path: dbPath });
        try {
            const updated = await store.items.backfillFacts(story);
            consoleOutput.write(JSON.stringify({ updated }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.backfill-facts.failed', error);
    }
}

/**
 * Register the `store` command group — the kk SQLite store surface.
 *
 * `migrate` brings the schema up; the hidden legacy `lock` group is the single-flight guard the
 * scheduled `kk-collect` tick takes before collecting (canonical spelling: `kk lock`); `ingest`
 * is the write path that turns one run's
 * collected `Doc[]` into `items` rows (with the typed facts and the story key) plus its
 * `collect_runs` provenance; `backfill-facts` recomputes those facts and clusters stories causally;
 * `label` is the heuristic-first decision pass over the ids `ingest` filed; `extract` is the read
 * path that turns one topic profile into the episode pool; `select` / `mark-published` / `release`
 * own the topic-scoped `selections` ledger that keeps a planned or aired item out of a later pool.
 */
export function registerStoreCommand(program: Command): void {
    const store = program.command('store').description('Operate the knowledge-kit store (SQLite)');

    store
        .command('migrate')
        .description('Apply pending store migrations (idempotent)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(migrateAction);

    // Hidden legacy route (A22 R3 / ADR-037): the canonical `kk lock acquire|release` and this
    // `kk store lock` spelling share one registrar and the one pair of SQLite engines.
    registerLockCommand(store, true);

    store
        .command('ingest')
        .description('Upsert one run of collected Docs and record its collect_runs row; prints the counts')
        .requiredOption('--run <id>', 'Collect run id (also the items provenance stamp)')
        .requiredOption('--in <path>', 'Input Doc[] JSON file')
        .requiredOption('--new-ids <path>', 'Output path for the ids the next label pass must decide')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(ingestAction);

    store
        .command('backfill-facts')
        .description(
            'Recompute the typed item facts and the causal story_id clustering for every item (idempotent); prints {updated}',
        )
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(backfillFactsAction);

    store
        .command('label')
        .description(
            'Label items as raw observations, heuristic-first; prints the {verdict, confidence, labeled, model, fallback, consults, consultMs} line, or re-label a historical pool with --replay',
        )
        .option('--run <id>', 'Collect run id the labels belong to (required with --new-ids)')
        .option('--new-ids <path>', 'Input path listing the item ids this pass must decide')
        .option(
            '--replay <selector>',
            "Re-label a historical pool (mutually exclusive with --new-ids): 'topic:<profile>', 'run:<collect-run-id>' or 'since:<n><s|m|h|d>'; requires --maker",
        )
        .option(
            '--decisions <ids>',
            `Comma-separated decision ids a --replay routes (default: ${CATALOG_DECISION_IDS.join(',')})`,
        )
        .option(
            '--maker <name>',
            'Decision maker override for the catalog calls (defaults to .spur/config.yaml decisions.maker; required with --replay)',
        )
        .option(
            '--mode <mode>',
            "Labeling mode: 'heuristic' (default) asks the model only where the keyword pass is unsure; 'decision' asks it for every item",
            'heuristic',
        )
        .option(
            '--window <duration>',
            "Only items first seen within this window ('<n>s|m|h|d') for a 'topic:' replay selector",
            DEFAULT_EXTRACT_WINDOW,
        )
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(labelAction);

    store
        .command('extract')
        .description('Select a topic pool from the stored labels via a profile; writes Doc[] and prints {count}')
        .requiredOption('--topic <topic>', `Topic profile name (reads ${PROFILE_DIR_REL}/<topic>.yaml)`)
        .option(
            '--window <duration>',
            "Only items first seen within this window ('<n>s|m|h|d')",
            DEFAULT_EXTRACT_WINDOW,
        )
        .option('--limit <n>', 'Pool cap (default: the profile limit, else 20)')
        .option('--include-selected', 'Include items whose stories are already selected or published for --topic')
        .requiredOption('--out <path>', 'Output Doc[] JSON path (the fan-in blended.json shape)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(extractAction);

    store
        .command('pool-count')
        .description('Guard predicate: exit 0 when the pool file holds at least --min items (prints {count, min})')
        .argument('<file>', 'Pool artifact: a Doc[] JSON file or an object carrying metadata.docs')
        .requiredOption('--min <n>', 'Minimum item count for exit 0')
        .action((file: string, options: { min: string }) => poolCountAction({ file, min: options.min }));

    store
        .command('select')
        .description('Record a run’s planned set as selected stories for --topic (idempotent); prints {selected}')
        .requiredOption('--topic <topic>', 'Topic profile the selection belongs to (e.g. ai-news)')
        .requiredOption('--workflow <name>', 'Workflow that made the selection (provenance)')
        .requiredOption('--run <id>', 'Run id the selection belongs to')
        .requiredOption('--in <path>', 'Input file: a Doc[] or an object carrying metadata.docs')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(selectAction);

    store
        .command('mark-published')
        .description('Promote a run’s selected rows to published; prints {published} (0 is exit 0)')
        .requiredOption('--topic <topic>', 'Topic profile the selection belongs to (e.g. ai-news)')
        .requiredOption('--run <id>', 'Run id whose selected rows are promoted')
        .option('--in <path>', 'Optional file listing the ids to promote (same shapes as select)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(markPublishedAction);

    store
        .command('release')
        .description('Drop a run’s selected rows so its items re-enter the pool; prints {released}')
        .requiredOption('--run <id>', 'Run id whose selected rows are dropped')
        .option('--topic <topic>', 'Narrow the release to one topic (default: every topic the run selected for)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(releaseAction);
}
