/**
 * The generate step verbs (task 0367; design `docs/design/content-pipeline-consolidation.md` §1.3,
 * §5.1, §6; ADR-053 §7).
 *
 * Seven verbs — `prepare`, `generate-check`, `generate-render`, `generate-voice`, `generate-cards`,
 * `generate-bundle` and `report` — are compositions of stage bodies that live in
 * `plugins/kk/scripts/daily-stages.ts`. **No stage body is copied or edited here.** Every verb is one
 * table row, `{verb, stages: [{name, args(ctx)}], summary(ctx)}`, and ONE runner executes any row: it
 * walks the row's stages in the retired daily-voice DAG's order through the shared stage runner
 * (`apps/cli/src/stage.ts` → `runStage`) in this process, stops at the first failing stage and names
 * that stage on stderr (design §1.3).
 *
 * Stage execution has three shapes, and only three:
 *
 * | shape | how it runs | who owns the body |
 * | --- | --- | --- |
 * | `daily-*` | `runStage([name, ...args])` — `plugins/kk/scripts/kk-workflow-stages.ts` | the stage body (unchanged) |
 * | `publish-matrix-*` | the exported function of `apps/cli/src/publish-matrix.ts` (the same call `0364`'s publish verbs make) | the matrix module |
 * | `store-select` / `generation-report` | the `kk store select` / `kk daily run-report` route of this same CLI | the store / daily command |
 *
 * `daily-script-style` is deliberately absent from every row: design §2.2 replaces the per-run skill
 * copy with the `skill_dir` workflow var, so a new run has no `20-editorial/` directory and no
 * `_08_script-write_style.md` copy for the stage to write into (R2).
 *
 * Exit codes (design §1): `0` done (including an empty pool — "nothing to do" is a verdict, not a
 * failure), `1` the step ran and failed, `2` usage.
 *
 * The row table is per-type: `generate-check` and `generate-bundle` are the two verbs both nouns
 * share, and 0368 plugs the article column in as two more step executors
 * (`apps/cli/src/commands/content-generate-article.ts`) rather than forking the verbs. `--step`
 * validates against the noun's own enum, so `kk article generate-check --step curate` is a usage
 * error and `kk news generate-check --step outline` is one too.
 */
import { join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { type Command, CommanderError } from 'commander';
import { ContentTypeSkillMissingError, resolveContentType, resolveRun } from '../content-types';
import { consoleOutput } from '../output';
import { resolvePackageRoot } from '../package-root';
import { BundleSchema, checkPublishMatrix, resolveBundlePath, runPublishMatrixBundle } from '../publish-matrix';
import { runStage } from '../stage';
import { type ContentConfigDocument, configPath, expandHome, readConfig, resolveWorksDir } from './content';
import {
    ARTICLE_CHECK_STEPS,
    ArticleStepFailure,
    type ArticleStepOutcome,
    resolveArticleMaxRevisions,
    runArticleBundle,
    runArticleCheck,
} from './content-generate-article';
import { generateRunReport, noContentReason } from './daily';
import { syncLedger } from './ledger';

interface JsonObject {
    [key: string]: unknown;
}

const PARSE_JSON: (raw: string) => unknown = JSON.parse.bind(JSON);

/** The topic profile of the news pipeline (`daily-extract` and `kk store select` both key on it). */
const NEWS_TOPIC = 'ai-news';

/**
 * The engines `generate-voice --engine` accepts (design §1.3).
 *
 * `voicebox` is the local REST renderer (`voice-gen`, the shared pipeline every other engine
 * reuses): `daily-generate` has always mapped it (`VOICE_DRIVERS.voicebox = 'voice-gen'`,
 * `plugins/kk/scripts/daily-stages.ts:1376`), but this list omitted it, so the one engine that needs
 * no cloud credits could not be selected by the verb (2026-11-20: voxcpm measured ~19x realtime and
 * its worker died mid-section, gemini's primary project answered HTTP 402 on every call).
 */
const VOICE_ENGINES = ['voxcpm', 'gemini', 'omnivoice', 'voicebox', 'vibe-voice'] as const;
type VoiceEngine = (typeof VOICE_ENGINES)[number];

/**
 * Engine → the driver token the stage bodies use. `daily-generate` spells its third driver
 * `ominivoice` (its own key, kept as it is — a stage body is never edited here) while design §1.3
 * spells the flag value `omnivoice`.
 */
const ENGINE_DRIVERS: Record<VoiceEngine, string> = {
    voxcpm: 'voxcpm',
    gemini: 'gemini',
    omnivoice: 'ominivoice',
    voicebox: 'voicebox',
    'vibe-voice': 'vibe-voice',
};

/** The steps `generate-check --step` accepts for the news noun (design §1.3; the article column lives in `content-generate-article.ts`). */
const NEWS_CHECK_STEPS = ['curate', 'script'] as const;

/** Bundle stages (design §1.3, §5.1 nodes 18 and 20). */
const BUNDLE_STAGES = ['variants', 'freeze'] as const;
type BundleStage = (typeof BUNDLE_STAGES)[number];

const STORE_SELECT_TIMEOUT_MS = 120_000;

/**
 * The stage settings the stage bodies take as positional arguments, with the values today's
 * the retired daily-voice DAG carried as vars (design §2: everything past `content_types` lives under
 * `workflows.<name>`). A user entry in `workflows.kk-news-generate` merges over these field by field.
 */
export interface NewsStageSettings {
    /** `kk store extract --window`, the pool's freshness bound. */
    window: string;
    /** Script language; `zh` is the editorial contract's language. */
    language: string;
    /** Title override; empty means "the article/content title". */
    title: string;
    voice_profile: string;
    /** Voice driver the ESTIMATE gates use (`daily-extract`, `daily-qc-content`, duration). */
    vdriver: string;
    transcode_mp3: boolean;
    episode_min_minutes: number;
    episode_max_minutes: number;
    cover_enabled: boolean;
    cover_provider: string;
    cover_model: string;
    cover_fallback: string;
    cards_enabled: boolean;
    cards: number;
    xhs_style: string;
    xhs_provider: string;
    xhs_model: string;
    xhs_fallback: string;
    intro_music: string;
    podcast_artist: string;
    podcast_album: string;
    plugins_path: string;
    plan_max_items: number;
    qc_categories: string;
    qc_min_quality: string;
    qc_min_importance: string;
    qc_min_urgency: string;
    qc_min_impact: string;
    qc_min_episode_items: string;
}

/** The compiled defaults: the retired daily-voice DAG's vars, verbatim. */
export const NEWS_STAGE_DEFAULTS: NewsStageSettings = {
    window: '24h',
    language: 'zh',
    title: '',
    voice_profile: 'robin-news',
    vdriver: 'voxcpm',
    transcode_mp3: true,
    episode_min_minutes: 15,
    episode_max_minutes: 25,
    cover_enabled: true,
    cover_provider: 'minimax',
    cover_model: 'image-01',
    cover_fallback: '',
    cards_enabled: true,
    cards: 6,
    xhs_style: 'xhs-knowledge',
    xhs_provider: 'minimax',
    xhs_model: 'image-01',
    xhs_fallback: 'true',
    intro_music: '~/.config/kk/voices/AI每日资讯_8秒播客片头.mp3',
    podcast_artist: 'Robin Min',
    podcast_album: '咸话咸说',
    plugins_path: '',
    plan_max_items: 20,
    qc_categories: 'ai-news,ai-technical,ai-research,ai-industry',
    qc_min_quality: '2',
    qc_min_importance: '3',
    qc_min_urgency: '2',
    qc_min_impact: '1',
    qc_min_episode_items: '8',
};

/** One verb invocation: the run it belongs to plus the flags it was given. */
export interface GenerateContext {
    fs: FileSystem;
    /** The CLI noun the verb was registered on (`news` | `article`). */
    noun: string;
    type: string;
    /** The run's workflow name (`content_types.<type>.workflow`), which is also its directory parent. */
    workflow: string;
    workDir: string;
    /** Digits-only run date the artifact names carry. */
    runDate: string;
    /** The run identity the store selection and the bundle namings record. */
    runId: string;
    settings: NewsStageSettings;
    /** `--engine`, for the one row that takes it. */
    engine: VoiceEngine;
    /** `--step`, for `generate-check`. */
    step: string;
    /** `--final`, for `generate-check`. */
    final: boolean;
    /** `--stage`, for `generate-bundle`. */
    bundleStage: BundleStage;
    preset: string;
    worksDir: string;
    /** Advisory-stage and probe warnings, printed in the row's summary (never a failure). */
    warnings: string[];
    /** `generate-check`: did the step's fix-verdict file exist before this run (`--final` decides). */
    priorErrors: boolean;
    /** `workflows.kk-article-generate.max_revisions` — the article rewrite bound (0368 R5). */
    maxRevisions: number;
    /** What the article step that just ran produced, so the row's summary prints it (0368). */
    article?: ArticleStepOutcome;
}

/** One stage of a row: what to run, with which argv, and how strictly. */
export interface RowStage {
    /** Stage name for the stage runner, or one of the executors' own step ids. */
    name: string;
    /** argv for that stage, derived from the work dir and the verb's flags. */
    args: (ctx: GenerateContext) => string[] | Promise<string[]>;
    /** A failing stage does not fail the verb and lands in `warnings` (voice3's `onError: continue`). */
    advisory?: boolean;
    /** Run the stage only when this holds (voice3's node conditions). */
    when?: (ctx: GenerateContext) => boolean | Promise<boolean>;
}

/** One verb: the row of the design's table. */
export interface GenerateVerbRow {
    verb: string;
    stages: RowStage[];
    summary: (ctx: GenerateContext) => Promise<JsonObject>;
}

// ---------------------------------------------------------------------------
// Reads: settings, run identity, artefacts
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Object-shaped payload reader: a bare JSON array comes back `null`, deliberately, so a caller that
 * expects a `{…}` envelope cannot silently receive a list. Any payload that may legitimately be an
 * array (a `Doc[]` pool or candidate file) must go through {@link readJsonValue} + {@link itemCount}
 * instead — 0374 was exactly that mistake, and it closed every real generation as `no-content`.
 */
async function readJsonFile(fs: FileSystem, path: string): Promise<JsonObject | null> {
    if (!(await fs.exists(path))) return null;
    try {
        const parsed: unknown = PARSE_JSON(await fs.readFile(path));
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Any JSON value (an array is a legitimate plan/candidates shape), or undefined when unreadable. */
async function readJsonValue(fs: FileSystem, path: string): Promise<unknown> {
    if (!(await fs.exists(path))) return undefined;
    try {
        return PARSE_JSON(await fs.readFile(path));
    } catch {
        return undefined;
    }
}

/** A pool/candidates payload's item count: a `Doc[]`, or an object carrying `metadata.docs`. */
export function itemCount(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    const docs = isObject(value) && isObject(value.metadata) ? value.metadata.docs : undefined;
    return Array.isArray(docs) ? docs.length : 0;
}

/**
 * Merge `workflows.kk-news-generate` over {@link NEWS_STAGE_DEFAULTS}.
 *
 * The block is the same "everything else a workflow needs" home design §2 names (`<cfg>`, next to
 * `workflows.kk-itc`). An unknown key or a wrong-typed value fails with exit 2 naming the key — a
 * silently ignored setting would change what a stage renders.
 */
export function resolveNewsSettings(config: ContentConfigDocument): NewsStageSettings {
    const workflows = isObject(config.workflows) ? config.workflows : {};
    const block = isObject(workflows['kk-news-generate']) ? workflows['kk-news-generate'] : {};
    const settings: NewsStageSettings = { ...NEWS_STAGE_DEFAULTS };
    const numeric = new Set(['cards', 'plan_max_items', 'episode_min_minutes', 'episode_max_minutes']);
    for (const [key, value] of Object.entries(block)) {
        if (!(key in NEWS_STAGE_DEFAULTS)) {
            fail(2, 'kk.content.generate', `config key 'workflows.kk-news-generate.${key}' is not a declared setting`);
        }
        const current = NEWS_STAGE_DEFAULTS[key as keyof NewsStageSettings];
        if (numeric.has(key)) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                fail(
                    2,
                    'kk.content.generate',
                    `config key 'workflows.kk-news-generate.${key}' must be a positive number`,
                );
            }
            Object.assign(settings, { [key]: value });
            continue;
        }
        if (typeof current === 'boolean') {
            if (typeof value !== 'boolean') {
                fail(2, 'kk.content.generate', `config key 'workflows.kk-news-generate.${key}' must be a boolean`);
            }
            Object.assign(settings, { [key]: value });
            continue;
        }
        if (typeof value !== 'string') {
            fail(2, 'kk.content.generate', `config key 'workflows.kk-news-generate.${key}' must be a string`);
        }
        Object.assign(settings, { [key]: value });
    }
    return settings;
}

/** The digits-only run date: `--run-date`, then `<workDir>/run-date.txt`, then the directory's name. */
export async function resolveRunDate(fs: FileSystem, workDir: string, explicit?: string): Promise<string | undefined> {
    const fromFlag = explicit?.replaceAll('-', '');
    if (fromFlag !== undefined && /^\d{8}$/.test(fromFlag)) return fromFlag;
    const marker = join(workDir, 'run-date.txt');
    if (await fs.exists(marker)) {
        const text = (await fs.readFile(marker)).trim().replaceAll('-', '');
        if (/^\d{8}$/.test(text)) return text;
    }
    const name = workDir.replace(/\/+$/, '').split('/').at(-1) ?? '';
    return /^\d{8}$/.test(name) ? name : undefined;
}

/**
 * The run identity the store selection records and `publish-matrix-bundle` names the bundle after:
 * `--run-id`, then the launching verb's `schedule-receipt.json` (design §3 step 4 writes it), then a
 * deterministic `kk-news-generate-<runDate>` the workflow's own run id replaces in production.
 */
export async function resolveRunId(
    fs: FileSystem,
    workDir: string,
    runDate: string,
    explicit?: string,
): Promise<string> {
    if (explicit !== undefined && explicit.trim() !== '') return explicit.trim();
    const receipt = await readJsonFile(fs, join(workDir, 'schedule-receipt.json'));
    const recorded = receipt?.runId;
    if (typeof recorded === 'string' && recorded.trim() !== '') return recorded.trim();
    // No receipt (a workflow-step invocation): the run directory names itself. A news run is its day;
    // an article run is its slug (design §4.3), so an empty run date falls back to the leaf.
    if (runDate === '') return workDir.replace(/\/+$/, '').split('/').at(-1) ?? 'kk-content-run';
    return `news-generate-${runDate}`;
}

/** `<workDir>/21-plan/<date>_04_quality-control-content_candidates.json` — the pool gate's input. */
function candidatesPath(ctx: GenerateContext): string {
    return join(ctx.workDir, '21-plan', `${ctx.runDate}_04_quality-control-content_candidates.json`);
}

/** `<workDir>/21-plan/<date>_03_plan_plan.json` — curate's output, the script validator's input. */
function curatedPlanPath(ctx: GenerateContext): string {
    return join(ctx.workDir, '21-plan', `${ctx.runDate}_03_plan_plan.json`);
}

/** `<workDir>/21-plan/<date>_03_curate_errors.json` — written by a fix verdict, removed by a pass. */
function curateErrorsPath(ctx: GenerateContext): string {
    return join(ctx.workDir, '21-plan', `${ctx.runDate}_03_curate_errors.json`);
}

/** `<workDir>/24-script/<date>_08_script-write_errors.json` — the script validator's fix verdict. */
function scriptErrorsPath(ctx: GenerateContext): string {
    return join(ctx.workDir, '24-script', `${ctx.runDate}_08_script-write_errors.json`);
}

/** `<workDir>/pool-gate.json` — the token that replaces `.spur/run/<runId>-pool-gate.status` (R3). */
export function poolGatePath(workDir: string): string {
    return join(workDir, 'pool-gate.json');
}

const AUDIO_CONTENT_REL = ['30-audio', '_11_generate_content.json'] as const;
const SCRIPT_CONTENT_REL = ['24-script', '_08_script_content.json'] as const;
const ARTICLE_CONTENT_REL = ['22-article', '_06_article_content.json'] as const;
const COVER_REL = ['23-cover', '_07_cover_cover.png'] as const;

function dated(ctx: GenerateContext, [dir, suffix]: readonly [string, string]): string {
    return join(ctx.workDir, dir, `${ctx.runDate}${suffix}`);
}

async function audioMetadata(ctx: GenerateContext): Promise<JsonObject> {
    const content = await readJsonFile(ctx.fs, dated(ctx, AUDIO_CONTENT_REL));
    return isObject(content?.metadata) ? content.metadata : {};
}

// ---------------------------------------------------------------------------
// Executors: exactly three shapes of stage execution (no fourth)
// ---------------------------------------------------------------------------

function fail(code: number, id: string, message: string): never {
    consoleOutput.error(message);
    throw new CommanderError(code, id, message);
}

/** The `kk` binary the operator's shell resolves — the same one the workflow nodes called before. */
const CLI_COMMAND = 'kk';

/** Step ids that are not a stage body: a CLI route of this binary, or the pool gate's own file. */
/** `kk store select` — a CLI route of this binary, not a stage body. */
const STORE_PICK = 'store-select';
const GENERATION_REPORT = 'generation-report';
const POOL_GATE = 'pool-gate';
const BUNDLE_CONTENT_TYPE = 'bundle-content-type';
/** The article column's two step ids (0368): one executor per shared verb. */
const ARTICLE_CHECK = 'article-check';
const ARTICLE_BUNDLE = 'article-bundle';

/**
 * Stamp the frozen bundle with its content type (design §4.1: `contentType` is an additive,
 * `news`-defaulted field; `publish` refuses a `--type` that disagrees with it). The stage body
 * freezes the raw object, so the verb — which is what knows the noun — writes the field.
 */
async function stampContentType(ctx: GenerateContext): Promise<number> {
    const path = await resolveBundlePath(ctx.fs, ctx.workDir);
    const parsed = BundleSchema.safeParse(await readJsonValue(ctx.fs, path));
    if (!parsed.success) return fail(1, 'kk.content.generate-bundle', `kk generate-bundle: cannot read ${path}`);
    await ctx.fs.writeFile(path, `${JSON.stringify({ ...parsed.data, contentType: ctx.type }, null, 2)}\n`);
    return 0;
}

/**
 * The pool gate (design §5.1 node 2, R3): `pool-gate.json` `{status}` replaces the
 * `.spur/run/<runId>-pool-gate.status` token, so every later node conditions on a file inside the
 * run directory. It NEVER exits non-zero — an empty pool is a no-content day, not a failed run —
 * and it drops a stale same-day bundle so a refused pool cannot republish yesterday's freeze.
 */
async function writePoolGate(ctx: GenerateContext): Promise<number> {
    const pooled = itemCount(await readJsonValue(ctx.fs, join(ctx.workDir, '10-collect', 'pool.json')));
    const items = itemCount(await readJsonValue(ctx.fs, candidatesPath(ctx)));
    const status = items > 0 ? 'PASS' : 'EMPTY';
    await ctx.fs.writeFile(poolGatePath(ctx.workDir), `${JSON.stringify({ status }, null, 2)}\n`);
    const summary = join(ctx.workDir, 'run-report.summary.txt');
    if (status === 'EMPTY') {
        // The no-content verdict travels with the gate, because every node after `prepare` is gated
        // on PASS (R7) — the report node never runs on a thin day. The launching verb's receipt
        // status reads this file (`launchWorkflow`), and the wording is `kk daily run-report`'s own
        // (`noContentReason`), so the ledger's Result cell says the same thing either way. Calling
        // it (not re-deriving the two fallback lines) is what keeps the two paths in agreement: a
        // floor refusal is `EMPTY` with a non-empty pool, and the fallback line called it an empty
        // QC admission (2026-11-17, a 8-item pool refused for 13.1 < 15 min).
        await ctx.fs.writeFile(summary, `${noContentReason(ctx.workDir, ctx.runDate, pooled)}\n`);
        for (const stale of [join(ctx.workDir, 'bundle.json'), join(ctx.workDir, '4-publish', 'bundle.json')]) {
            if (await ctx.fs.exists(stale)) await ctx.fs.deleteFile(stale);
        }
        return 0;
    }
    // A content day supersedes any earlier same-day no-content verdict for this directory.
    if (await ctx.fs.exists(summary)) await ctx.fs.deleteFile(summary);
    return 0;
}

/** Step ids that are a function of the publish matrix (the shape 0364's publish verbs use). */
type MatrixStep = (args: string[]) => Promise<number>;
const MATRIX_STEPS: Record<string, MatrixStep> = {
    'publish-matrix-check': (args: string[]) => checkPublishMatrix(args),
    'publish-matrix-bundle': (args: string[]) => runPublishMatrixBundle(args),
};

/**
 * The three out-of-process seams a row can reach: a `daily-*` stage body, a `kk` CLI route, and the
 * two publish-matrix steps. Tests replace them so a whole verb runs in-process (the per-file coverage
 * instrument cannot see work done in a spawned child). Production never overrides them.
 */
export interface GenerateDeps {
    runStage: (argv: string[]) => Promise<number>;
    runCli: (argv: string[]) => Promise<number>;
    matrix: Record<string, MatrixStep>;
    /**
     * Rows the store's `select` route recorded for this run (`kk store select` prints
     * `{"selected": N}`). Kept behind the seam because that number is the store's answer, not the
     * candidate count `prepare` also reports.
     */
    selectedCount: () => number;
}

/** The last `kk store select` row count; 0 until the route answers. */
let lastSelectedCount = 0;

const DEFAULT_DEPS: GenerateDeps = {
    runStage: (argv) => spawnStage(argv),
    runCli: (argv) => runRawCli(argv),
    matrix: MATRIX_STEPS,
    selectedCount: () => lastSelectedCount,
};

let deps: GenerateDeps = DEFAULT_DEPS;

/** Replace one or more seams; returns the restore function (tests only — production never calls it). */
export function setGenerateDeps(overrides: Partial<GenerateDeps>): () => void {
    const previous = deps;
    deps = { ...previous, ...overrides };
    return () => {
        deps = previous;
    };
}

/** The stage runner, with the stage name first in argv (its own call shape). */
async function spawnStage(argv: string[]): Promise<number> {
    return runStage(argv as [string, ...string[]]);
}

async function runRawCli(argv: string[]): Promise<number> {
    const result = await new NodeProcessExecutor().run({
        command: CLI_COMMAND,
        args: argv,
        timeout: STORE_SELECT_TIMEOUT_MS,
        label: `kk ${argv.slice(0, 2).join(' ')}`,
    });
    if (result.outcome === 'error') return 1;
    if (argv[0] === 'store' && argv[1] === 'select') lastSelectedCount = selectedCountOf(result.stdout);
    return result.exitCode ?? 1;
}

/**
 * `{selected: N}` from the store route's one JSON object; 0 when the route printed none.
 *
 * Exported because it is the only *pure* member of the process seams (`spawnStage`/`runRawCli` need a
 * real child), so it is the one that can be pinned directly: the store route's stdout is the only
 * evidence `--stage select` records, and a parse that silently returned NaN would let an empty
 * selection look like a filled one.
 */
export function selectedCountOf(stdout: string | undefined): number {
    const line = (stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
    try {
        const parsed: unknown = PARSE_JSON(line);
        if (isObject(parsed) && typeof parsed.selected === 'number') return parsed.selected;
    } catch {
        return 0;
    }
    return 0;
}

/**
 * `report`'s one step: `kk daily run-report`'s body (the same function, design §1.4 — no private
 * implementation) plus the two things the verb owns: the design's `5-report/generation.md` name and
 * the ledger sync (bookkeeping, so a ledger failure warns instead of failing the verb).
 */
async function runGenerationReport(ctx: GenerateContext): Promise<number> {
    let result: Awaited<ReturnType<typeof generateRunReport>>;
    try {
        result = await generateRunReport(reportOptions(ctx));
    } catch (error) {
        return fail(1, 'kk.content.report', `kk report: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.report === '') return 1;
    const target = join(ctx.workDir, '5-report', 'generation.md');
    await ctx.fs.ensureDir(join(ctx.workDir, '5-report'));
    await ctx.fs.writeFile(target, await ctx.fs.readFile(result.report));
    try {
        await quietStdout(() => syncLedger({ workflow: ctx.workflow, worksDir: ctx.worksDir, workDir: ctx.workDir }));
    } catch (error) {
        consoleOutput.error(
            `kk report: ledger sync warning: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    return 0;
}

/**
 * Run a stage with its stdout redirected to stderr: design §1 requires every verb to print exactly
 * one JSON object on stdout, and a stage body narrates its progress there. Diagnostics are not
 * dropped — they move to stderr, where the workflow's own log already reads them.
 */
async function quietStdout<T>(action: () => T | Promise<T>): Promise<T> {
    const restore = setDefaultOutputTargets({
        stdout: { write: (text: string) => consoleOutput.error(text.replace(/\n$/, '')) },
    });
    try {
        return await action();
    } finally {
        restore();
    }
}

/** Execute one row stage and return its exit code. */
async function executeStep(ctx: GenerateContext, step: RowStage, argv: string[]): Promise<number> {
    if (step.name === STORE_PICK) return quietStdout(() => deps.runCli(['store', 'select', ...argv]));
    if (step.name === GENERATION_REPORT) return runGenerationReport(ctx);
    if (step.name === POOL_GATE) return writePoolGate(ctx);
    if (step.name === BUNDLE_CONTENT_TYPE) return stampContentType(ctx);
    if (step.name === ARTICLE_CHECK || step.name === ARTICLE_BUNDLE)
        return quietStdout(() => runArticleStep(ctx, step.name));
    const matrix = deps.matrix[step.name];
    if (matrix !== undefined) return quietStdout(() => matrix(argv));
    return quietStdout(() => deps.runStage([step.name, ...argv]));
}

/**
 * Run one article step and keep its outcome for the row's summary: the article column owns WHAT the
 * step does, this runner owns WHEN and how its failure is reported (design §1.3).
 */
async function runArticleStep(ctx: GenerateContext, name: string): Promise<number> {
    const input = {
        workDir: ctx.workDir,
        type: ctx.type,
        runId: ctx.runId,
        preset: ctx.preset,
        maxRevisions: ctx.maxRevisions,
        step: ctx.step,
        bundleStage: ctx.bundleStage,
    };
    let outcome: Awaited<ReturnType<typeof runArticleBundle>>;
    try {
        outcome = name === ARTICLE_CHECK ? await runArticleCheck(input, ctx.fs) : await runArticleBundle(input, ctx.fs);
    } catch (error) {
        // A missing variant file is a refusal, not a crash: the verb still prints its one JSON object
        // (design §1.3) and exits with the refusal's code.
        if (!(error instanceof ArticleStepFailure)) throw error;
        consoleOutput.error((error as ArticleStepFailure).message);
        return (error as ArticleStepFailure).code;
    }
    const { code, ...step } = outcome;
    ctx.article = step;
    return code;
}

/** `kk daily run-report`'s inputs, resolved from the run directory (design §1.3 `report`). */
function reportOptions(ctx: GenerateContext) {
    return {
        workDir: ctx.workDir,
        runDate: ctx.runDate,
        pool: join(ctx.workDir, '10-collect', 'pool.json'),
        candidates: candidatesPath(ctx),
        ...(ctx.settings.plugins_path === '' ? {} : { pluginsPath: ctx.settings.plugins_path }),
        qcMinQuality: ctx.settings.qc_min_quality,
        qcMinImportance: ctx.settings.qc_min_importance,
        qcMinUrgency: ctx.settings.qc_min_urgency,
        qcMinImpact: ctx.settings.qc_min_impact,
    };
}

// ---------------------------------------------------------------------------
// The seven rows (design §6: which stage each verb calls)
// ---------------------------------------------------------------------------

/** argv builders kept as plain functions so a row reads as the design's table row. */
const ARGS = {
    preflight: async (ctx: GenerateContext): Promise<string[]> => {
        const root = await resolvePackageRoot(ctx.fs);
        return ['kk-news-generate', 'kk-publish', 'kk-daily-safety'].map((name) =>
            join(root, 'plugins', 'kk', 'workflows', `${name}.yaml`),
        );
    },
    extract: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        NEWS_TOPIC,
        ctx.settings.window,
        String(ctx.settings.episode_min_minutes),
        ctx.settings.vdriver,
        // 2026-11-20: the extract bound has to reach the store. Without it `kk store extract` caps the
        // pool at its own default (~20) while `plan_max_items` (40) only caps the plan afterwards, so
        // a 168h window with 56 eligible items produced a 24-item pool, a 3-item plan and a 5.3-min
        // script that the TTS gate refused.
        String(ctx.settings.plan_max_items),
    ],
    plan: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        String(ctx.settings.plan_max_items),
        // `deferPlanDocs`: curate owns `_03_plan_plan.json`; the stage writes `_03_plan_content.json`.
        'true',
    ],
    qcContent: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        ctx.settings.qc_categories,
        ctx.settings.qc_min_quality,
        ctx.settings.qc_min_importance,
        ctx.settings.qc_min_urgency,
        ctx.settings.qc_min_impact,
        ctx.settings.qc_min_episode_items,
        String(ctx.settings.episode_min_minutes),
        ctx.settings.vdriver,
    ],
    storeSelect: (ctx: GenerateContext): string[] => [
        '--topic',
        NEWS_TOPIC,
        '--workflow',
        ctx.workflow,
        '--run',
        ctx.runId,
        '--in',
        candidatesPath(ctx),
    ],
    sessionCheck: (ctx: GenerateContext): string[] => [ctx.workDir, '--all-windows'],
    curateCheck: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, ...(ctx.final ? ['--final'] : [])],
    scriptCheck: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, ctx.settings.plugins_path],
    script: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        ctx.settings.language,
        ctx.settings.title,
        ctx.settings.voice_profile,
        String(ctx.settings.episode_max_minutes),
        ctx.settings.vdriver,
    ],
    editorialRender: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        String(ctx.settings.cards_enabled),
        String(ctx.settings.cards),
    ],
    article: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, ctx.settings.plugins_path],
    cover: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        ctx.settings.cover_provider,
        ctx.settings.cover_model,
        ctx.settings.cover_fallback,
    ],
    coverNormalize: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate],
    wrapDocs: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, ctx.settings.voice_profile],
    generate: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        String(ctx.settings.transcode_mp3),
        ENGINE_DRIVERS[ctx.engine],
        '1',
        String(ctx.settings.episode_max_minutes),
        String(ctx.settings.episode_min_minutes),
    ],
    intro: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, expandHome(ctx.settings.intro_music)],
    voiceAudit: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate, ctx.settings.plugins_path],
    duration: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        String(ctx.settings.episode_min_minutes),
        String(ctx.settings.episode_max_minutes),
        ctx.settings.vdriver,
        ctx.runId,
    ],
    qualityReport: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate],
    qualityVerdict: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate],
    showNotes: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        ctx.settings.title,
    ],
    xhsRender: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        String(ctx.settings.cards),
        ctx.settings.xhs_style,
        ctx.settings.xhs_provider,
        ctx.settings.xhs_model,
        ctx.settings.xhs_fallback,
        'episode',
    ],
    publishPrep: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.podcast_artist,
        ctx.settings.podcast_album,
    ],
    bundleVariants: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        ctx.runDate,
        ctx.settings.plugins_path,
        String(ctx.settings.cards_enabled),
        String(ctx.settings.cover_enabled),
    ],
    safetyManifest: (ctx: GenerateContext): string[] => [ctx.workDir, ctx.runDate],
    bundleFreeze: (ctx: GenerateContext): string[] => [
        ctx.workDir,
        '--run-date',
        ctx.runDate,
        '--run-id',
        ctx.runId,
        ...(ctx.preset === '' ? [] : ['--preset', ctx.preset]),
    ],
    report: (): string[] => [],
};

/** `10-collect/pool.json` holds at least one item — voice3's `plan`/`qc-content` node condition. */
async function poolNonEmpty(ctx: GenerateContext): Promise<boolean> {
    return itemCount(await readJsonValue(ctx.fs, join(ctx.workDir, '10-collect', 'pool.json'))) > 0;
}

/**
 * The warn-only session probe's refusals, as the probe file records them (`publish-check`'s own
 * shape: `plugins[]` with `ok`/`detail`). Reported in `prepare`'s stdout and never a failure (R3).
 */
async function sessionWarnings(ctx: GenerateContext): Promise<string[]> {
    const check = await readJsonFile(ctx.fs, join(ctx.workDir, '4-publish', 'check.preflight.json'));
    const plugins = Array.isArray(check?.plugins) ? check.plugins : [];
    return plugins
        .filter(isObject)
        .filter((plugin) => plugin.ok !== true)
        .map((plugin) => `${String(plugin.plugin ?? 'unknown')}: ${String(plugin.detail ?? 'not ready')}`);
}

async function candidatesNonEmpty(ctx: GenerateContext): Promise<boolean> {
    return itemCount(await readJsonValue(ctx.fs, candidatesPath(ctx))) > 0;
}

const STEP = {
    preflight: (): RowStage => ({ name: 'daily-preflight', args: ARGS.preflight }),
    sessionCheck: (): RowStage => ({ name: 'publish-matrix-check', args: ARGS.sessionCheck, advisory: true }),
    extract: (): RowStage => ({ name: 'daily-extract', args: ARGS.extract }),
    plan: (): RowStage => ({ name: 'daily-plan', args: ARGS.plan, when: poolNonEmpty }),
    qcContent: (): RowStage => ({ name: 'daily-qc-content', args: ARGS.qcContent, when: poolNonEmpty }),
    storeSelect: (): RowStage => ({ name: STORE_PICK, args: ARGS.storeSelect, when: candidatesNonEmpty }),
    poolGate: (): RowStage => ({ name: POOL_GATE, args: () => [] }),
    curateCheck: (): RowStage => ({ name: 'daily-curate-check', args: ARGS.curateCheck }),
    scriptCheck: (): RowStage => ({ name: 'daily-script-check', args: ARGS.scriptCheck, advisory: true }),
    script: (): RowStage => ({ name: 'daily-script', args: ARGS.script }),
    editorialRender: (): RowStage => ({ name: 'daily-editorial-render', args: ARGS.editorialRender }),
    article: (): RowStage => ({ name: 'daily-article', args: ARGS.article }),
    cover: (): RowStage => ({ name: 'daily-cover', args: ARGS.cover, when: (ctx) => ctx.settings.cover_enabled }),
    coverNormalize: (): RowStage => ({
        name: 'daily-cover-normalize',
        args: ARGS.coverNormalize,
        when: (ctx) => ctx.settings.cover_enabled,
    }),
    wrapDocs: (): RowStage => ({ name: 'daily-wrap-docs', args: ARGS.wrapDocs }),
    generate: (): RowStage => ({ name: 'daily-generate', args: ARGS.generate }),
    intro: (): RowStage => ({ name: 'daily-intro', args: ARGS.intro }),
    voiceAudit: (): RowStage => ({ name: 'daily-voice-audit', args: ARGS.voiceAudit, advisory: true }),
    duration: (): RowStage => ({ name: 'daily-episode-duration', args: ARGS.duration }),
    qualityReport: (): RowStage => ({ name: 'daily-quality-report', args: ARGS.qualityReport }),
    qualityVerdict: (): RowStage => ({ name: 'daily-quality-verdict', args: ARGS.qualityVerdict }),
    showNotes: (): RowStage => ({ name: 'daily-show-notes', args: ARGS.showNotes }),
    cards: (): RowStage => ({
        name: 'daily-xhs-render',
        args: ARGS.xhsRender,
        advisory: true,
        // voice3 gates the render on `cards_enabled` (46 min + a stale-series repack otherwise).
        when: (ctx) => ctx.settings.cards_enabled,
    }),
    publishPrep: (): RowStage => ({ name: 'daily-publish-prep', args: ARGS.publishPrep }),
    bundleVariants: (): RowStage => ({ name: 'daily-bundle-variants', args: ARGS.bundleVariants }),
    safetyManifest: (): RowStage => ({ name: 'daily-safety-manifest', args: ARGS.safetyManifest }),
    bundleFreeze: (): RowStage => ({
        name: 'publish-matrix-bundle',
        args: ARGS.bundleFreeze,
        // The matrix freeze is news-only and belongs to `--stage freeze` alone; the article bundle
        // has its own row below. Leaving the noun in the guard keeps `--stage variants` from
        // freezing before the variants safety review has run (2026-11-18).
        when: (ctx) => ctx.noun === 'news' && ctx.bundleStage === 'freeze',
    }),
    report: (): RowStage => ({ name: GENERATION_REPORT, args: ARGS.report }),
};

/**
 * The bundle's variant keys and safety status (design §1.3 stdout). After `--stage freeze` the
 * frozen file is the record (design §4.1); on `--stage variants` the bundle does not exist yet, so
 * the answer is the payload set the freeze will package plus the safety review's own status.
 */
async function bundleSummary(ctx: GenerateContext): Promise<{ path: string; variants: string[]; safety: string }> {
    const path = await resolveBundlePath(ctx.fs, ctx.workDir);
    const parsed = BundleSchema.safeParse(await readJsonFile(ctx.fs, path));
    if (parsed.success) {
        const safety = parsed.data.safety;
        return {
            path,
            variants: Object.keys(parsed.data.variants).sort(),
            safety: safety === undefined ? 'none' : safety.status,
        };
    }
    const variantsDir = join(ctx.workDir, '30-variants');
    const written = (await ctx.fs.exists(variantsDir))
        ? (await ctx.fs.readDir(variantsDir))
              .filter((entry: string) => entry.endsWith('.content.json'))
              .map((entry: string) => entry.replace(/\.content\.json$/, '').replaceAll('_', ':'))
        : [];
    const safety = await readJsonFile(ctx.fs, join(ctx.workDir, '4-safety-variants', 'safety.json'));
    const status = safety?.status;
    return { path, variants: written.sort(), safety: typeof status === 'string' ? status : 'none' };
}

/**
 * Files ending in `suffix` under `dir`, one directory level down included: the card render writes the
 * series into `25-xhs/cards/` while a fixture (and the older single-dir writer) puts them directly in
 * `25-xhs/`, so counting one level reports `cards: 0` on a successful render.
 */
async function countFiles(ctx: GenerateContext, dir: string, suffix: string): Promise<number> {
    const path = join(ctx.workDir, dir);
    if (!(await ctx.fs.exists(path))) return 0;
    let count = 0;
    for (const entry of await ctx.fs.readDir(path)) {
        if (entry.endsWith(suffix)) {
            count += 1;
            continue;
        }
        const nested = join(path, entry);
        if (!(await ctx.fs.exists(nested))) continue;
        try {
            count += (await ctx.fs.readDir(nested)).filter((child) => child.endsWith(suffix)).length;
        } catch {
            // A plain file, or a directory the filesystem will not list: nothing to count.
        }
    }
    return count;
}

/**
 * `--stage variants` for news: the payload/staging stages that produce what the variants safety
 * review reads. A `--stage freeze` must never re-run them (see the row below).
 */
const newsVariantsStage = (ctx: GenerateContext): boolean => ctx.noun === 'news' && ctx.bundleStage === 'variants';

/**
 * The seven verbs of design §1.3, in the design's own order. Every row runs the stages design §6
 * assigns it, in the retired daily-voice DAG's node order.
 */
export const GENERATE_ROWS: GenerateVerbRow[] = [
    {
        verb: 'prepare',
        stages: [
            STEP.preflight(),
            STEP.sessionCheck(),
            STEP.extract(),
            STEP.plan(),
            STEP.qcContent(),
            STEP.storeSelect(),
            STEP.poolGate(),
        ],
        summary: async (ctx) => {
            const gate = await readJsonFile(ctx.fs, poolGatePath(ctx.workDir));
            const candidates = itemCount(await readJsonValue(ctx.fs, candidatesPath(ctx)));
            const pass = gate?.status === 'PASS';
            return {
                pool: pass ? 'ok' : 'empty',
                candidates,
                // `selected` is the store's answer (the rows its `select` route recorded), never the
                // candidate count: a run whose ids the store no longer holds selects nothing.
                selected: pass ? deps.selectedCount() : 0,
                sessions: { warnings: [...(await sessionWarnings(ctx)), ...ctx.warnings] },
            };
        },
    },
    {
        verb: 'generate-check',
        // One row, one stage per `--step`: design §6's news checks (`daily-curate-check`,
        // `daily-script-check`) and the article column's single executor (0368).
        stages: [
            {
                ...STEP.curateCheck(),
                when: (ctx: GenerateContext) => ctx.noun === 'news' && ctx.step === 'curate',
            },
            {
                // 0384 (L3 R4/R10): `--final` means the selection is settled, so the judgment
                // ledger commits here — the deterministic alignment entry the design already
                // provides between final selection and `script-write`. Drafting reads the frozen
                // snapshot, never the live ledger. A refusal fails the row (exit 1): history is
                // never rebuilt from a proposal.
                name: 'news-editorial-commit',
                args: (ctx: GenerateContext) => [ctx.workDir, ctx.runDate, ctx.runId],
                when: (ctx: GenerateContext) => ctx.noun === 'news' && ctx.step === 'curate' && ctx.final,
            },
            {
                ...STEP.scriptCheck(),
                when: (ctx: GenerateContext) => ctx.noun === 'news' && ctx.step === 'script',
            },
            { name: ARTICLE_CHECK, args: (ctx: GenerateContext) => [ctx.step], when: (ctx) => ctx.noun === 'article' },
        ],
        summary: async (ctx) => {
            if (ctx.noun === 'article') return articleOutcome(ctx, 'generate-check');
            const errors = ctx.step === 'curate' ? curateErrorsPath(ctx) : scriptErrorsPath(ctx);
            const written = await ctx.fs.exists(errors);
            if (ctx.final) {
                // `--final` applies the documented fallback when the fix pass left errors behind:
                // untranslated candidates for curate (`daily-curate-check --final`), the template
                // script for script-write (F613 — `daily-script` renders it in `generate-render`).
                return { step: ctx.step, verdict: ctx.priorErrors ? 'fallback' : 'pass' };
            }
            return {
                step: ctx.step,
                verdict: written ? 'fix' : 'pass',
                ...(written ? { errors } : {}),
            };
        },
    },
    {
        verb: 'generate-render',
        stages: [
            STEP.script(),
            STEP.editorialRender(),
            STEP.article(),
            STEP.cover(),
            STEP.coverNormalize(),
            STEP.wrapDocs(),
        ],
        summary: async (ctx) => ({
            script: dated(ctx, SCRIPT_CONTENT_REL),
            article: dated(ctx, ARTICLE_CONTENT_REL),
            cover: dated(ctx, COVER_REL),
        }),
    },
    {
        verb: 'generate-voice',
        stages: [
            STEP.generate(),
            // 2026-11-20: `daily-generate`'s script gate refuses a sub-floor authored script by
            // writing the duration refusal and EMPTYING the QC candidates, and produces no audio at
            // all. The pool gate was written back when the pool was admitted, so it still said
            // PASS: `daily-intro` then ran on a content file that never existed and failed the verb
            // (exit 1), which failed `voice-fallback2` and turned a designed no-content day into a
            // `failed` run — while `cards`, `variants` and `safety-variants` kept spending on the
            // stale PASS (measured 2026-11-20: 29.7 min of card rendering after the refusal).
            // Re-settling the gate here (idempotent on a content day) makes the refusal end the row
            // and every later node condition on EMPTY, which is the workflow's own no-content
            // contract: `done`, no TTS, no cards, no second safety review.
            STEP.poolGate(),
            // Everything below consumes the audio content the generate stage produced; a skipped
            // `generate` (refusal) must skip them too instead of failing on a missing input.
            { ...STEP.intro(), when: candidatesNonEmpty },
            { ...STEP.voiceAudit(), when: candidatesNonEmpty },
            { ...STEP.duration(), when: candidatesNonEmpty },
            { ...STEP.qualityReport(), when: candidatesNonEmpty },
            { ...STEP.qualityVerdict(), when: candidatesNonEmpty },
            { ...STEP.showNotes(), when: candidatesNonEmpty },
        ],
        summary: async (ctx) => {
            const metadata = await audioMetadata(ctx);
            const audio = metadata.mp3Path ?? metadata.audioPath;
            const qc = isObject(metadata.qc) ? metadata.qc : {};
            return {
                engine: ctx.engine,
                audio: typeof audio === 'string' ? audio : '',
                durationSec: typeof metadata.duration === 'number' ? metadata.duration : 0,
                quality: qc.passed === true ? 'pass' : 'warn',
            };
        },
    },
    {
        verb: 'generate-cards',
        stages: [STEP.cards()],
        summary: async (ctx) => ({
            // The cards land in `25-xhs/cards/` (the profile's output dir), not at the `25-xhs/`
            // root `content.json` also sits in — counting the root reported `cards: 0` on every
            // successful render, which reads as a failed card step in the run log.
            cards: await countFiles(ctx, '25-xhs', '.png'),
            dir: join(ctx.workDir, '25-xhs'),
        }),
    },
    {
        verb: 'generate-bundle',
        // 2026-11-18: the two stages split on their own boundary. `--stage variants` materializes the
        // payloads the variants safety review registers; `--stage freeze` must NOT re-run them — the
        // review's revisions live in exactly those files, so a re-render discarded them and the
        // freeze's own digest guard then refused the bundle (11-18: 2h36m lost, nothing published).
        // `bundleFreeze` carries its own noun + stage guard (news, `--stage freeze`), so nothing
        // here needs to repeat it.
        stages: [
            { ...STEP.publishPrep(), when: newsVariantsStage },
            { ...STEP.bundleVariants(), when: newsVariantsStage },
            { ...STEP.safetyManifest(), when: newsVariantsStage },
            STEP.bundleFreeze(),
            {
                name: BUNDLE_CONTENT_TYPE,
                args: () => [],
                when: (ctx: GenerateContext) => ctx.noun === 'news' && ctx.bundleStage === 'freeze',
            },
            // The article bundle is not the matrix freeze: design §4.1 gives it `contentType`,
            // `title`, no `episode`, and one `{path, sha256}` per adapted file (0368 R2).
            {
                name: ARTICLE_BUNDLE,
                args: (ctx: GenerateContext) => [ctx.bundleStage],
                when: (ctx) => ctx.noun === 'article',
            },
        ],
        summary: async (ctx) => {
            if (ctx.noun === 'article') return articleOutcome(ctx, 'generate-bundle');
            const bundle = await bundleSummary(ctx);
            return {
                bundle: bundle.path,
                runId: ctx.runId,
                variants: bundle.variants,
                safety: bundle.safety,
            };
        },
    },
    {
        verb: 'report',
        stages: [STEP.report()],
        summary: async (ctx) => ({ report: join(ctx.workDir, '5-report', 'generation.md') }),
    },
];

/**
 * The article column's stdout (design §1.3): `generate-check` prints `{step, verdict, errors?}`, the
 * bundle prints `{bundle, runId, variants, safety}`. What the step produced is what it returns — the
 * runner never re-derives a verdict from files the step already read.
 */
function articleOutcome(ctx: GenerateContext, verb: string): JsonObject {
    const outcome = ctx.article ?? {};
    if (verb === 'generate-check') {
        return {
            step: ctx.step,
            verdict: outcome.verdict ?? 'pass',
            ...(outcome.errors === undefined ? {} : { errors: outcome.errors }),
        };
    }
    return {
        bundle: outcome.bundle ?? join(ctx.workDir, '4-publish', 'bundle.json'),
        runId: outcome.runId ?? ctx.runId,
        variants: outcome.variants ?? [],
        safety: outcome.safety ?? null,
    };
}

// ---------------------------------------------------------------------------
// The one runner
// ---------------------------------------------------------------------------

/** How a row reports a stage failure: the stage's own name on stderr (design §1.3). */
function stageFailure(verb: string, stage: string, code: number): never {
    return fail(1, `kk.content.${verb}`, `kk ${verb}: stage '${stage}' failed (exit ${code})`);
}

/** Run one row end to end; returns the row's summary (the single JSON object on stdout). */
export async function runGenerateRow(row: GenerateVerbRow, ctx: GenerateContext): Promise<JsonObject> {
    for (const step of row.stages) {
        if (step.when !== undefined && !(await step.when(ctx))) continue;
        const argv = await step.args(ctx);
        // `daily-generate` reads its driver's speed from the environment (voice3 wrote the prefix
        // inline); `runStage` forwards `process.env`, so the one env the stage takes is set here.
        if (step.name === 'daily-generate' && ctx.engine === 'omnivoice') process.env.OMNIVOICE_SPEED ??= '1.06';
        const code = await executeStep(ctx, step, argv);
        if (code === 0) continue;
        if (step.advisory === true) {
            ctx.warnings.push(`${step.name}: exited ${code}`);
            continue;
        }
        return stageFailure(row.verb, step.name, code);
    }
    return row.summary(ctx);
}

// ---------------------------------------------------------------------------
// Verb actions
// ---------------------------------------------------------------------------

interface VerbOptions {
    workDir?: string;
    runDate?: string;
    runId?: string;
    preset?: string;
    step?: string;
    final?: boolean;
    stage?: string;
    engine?: string;
    ledgerSync?: boolean;
    refresh?: boolean;
}

/** The phase directories a news run owns (design §4.3; the names the stage bodies write). */
const NEWS_PHASE_DIRS = [
    '10-collect',
    '10-ingest',
    '21-plan',
    '22-article',
    '23-cover',
    '24-script',
    '25-xhs',
    '26-social',
    '30-audio',
    '30-variants',
    '31-publish',
    '4-publish',
    '5-report',
] as const;

/**
 * Every directory a news run derives from the store — `--refresh` drops all of them. `10-collect`
 * included: the ladder and the frozen pool are extract output, not input.
 */
const REFRESH_PHASE_DIRS = [...NEWS_PHASE_DIRS, '4-publish', '5-report'] as const;

function requireWorkDir(options: VerbOptions, verb: string): string {
    if (options.workDir === undefined || options.workDir.trim() === '') {
        return fail(2, `kk.content.${verb}`, `kk ${verb}: --work-dir is required`);
    }
    return resolve(expandHome(options.workDir));
}

function validRunDate(raw: string | undefined, verb: string): string | undefined {
    if (raw === undefined) return undefined;
    const digits = raw.replaceAll('-', '');
    const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`);
    if (
        !/^\d{8}$/.test(digits) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10).replaceAll('-', '') !== digits
    ) {
        return fail(2, `kk.content.${verb}`, `kk ${verb}: --run-date must be a real calendar date as YYYYMMDD`);
    }
    return digits;
}

function parseEngine(raw: string | undefined, verb: string): VoiceEngine {
    const engine = raw ?? 'voxcpm';
    if (!(VOICE_ENGINES as readonly string[]).includes(engine)) {
        return fail(2, `kk.content.${verb}`, `kk ${verb}: --engine must be one of ${VOICE_ENGINES.join('|')}`);
    }
    return engine as VoiceEngine;
}

function parseBundleStage(raw: string | undefined, verb: string): BundleStage {
    const stage = raw ?? 'variants';
    if (!(BUNDLE_STAGES as readonly string[]).includes(stage)) {
        return fail(2, `kk.content.${verb}`, `kk ${verb}: --stage must be one of ${BUNDLE_STAGES.join('|')}`);
    }
    return stage as BundleStage;
}

/**
 * `generate-check`'s input guard: the step's INPUT must be readable (exit 1 when it is not), while a
 * rejected agent output is a `fix` verdict, never a failure (design §1.3, R4). The input is the
 * candidate pool for `curate` (the agent's output is the plan) and the curated plan for `script`
 * (the validator's `--in`).
 */
async function requireStepInput(ctx: GenerateContext): Promise<boolean> {
    const path = ctx.step === 'curate' ? candidatesPath(ctx) : curatedPlanPath(ctx);
    const value = await readJsonValue(ctx.fs, path);
    if (value === undefined) {
        fail(
            1,
            'kk.content.generate-check',
            `kk generate-check: --step ${ctx.step} input is missing or unreadable: ${path}`,
        );
    }
    return true;
}

/** The row for a verb, or a usage error naming the verbs that exist. */
function rowFor(verb: string): GenerateVerbRow {
    const row = GENERATE_ROWS.find((entry) => entry.verb === verb);
    if (row === undefined) return fail(2, 'kk.content.generate', `kk ${verb}: unknown generate step verb`);
    return row;
}

async function buildContext(noun: string, type: string, verb: string, options: VerbOptions): Promise<GenerateContext> {
    const fs = createNodeFileSystem();
    const configFile = configPath();
    let config: ContentConfigDocument;
    try {
        config = await readConfig(configFile, fs);
    } catch (error) {
        return fail(2, `kk.content.${verb}`, error instanceof Error ? error.message : String(error));
    }
    let resolved: Awaited<ReturnType<typeof resolveContentType>>;
    try {
        resolved = await resolveContentType(type, config, { configPath: configFile });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const skillMissing = error instanceof ContentTypeSkillMissingError;
        return fail(skillMissing ? 5 : 2, `kk.content.${verb}`, message);
    }
    const worksDir = resolveWorksDir(config, configFile);
    const runDateFlag = validRunDate(options.runDate, verb);
    const explicitWorkDir = options.workDir === undefined ? undefined : resolve(expandHome(options.workDir));
    const run = resolveRun({
        type,
        config,
        worksDir,
        workflow: resolved.workflow,
        slug: 'run',
        ...(runDateFlag === undefined ? {} : { runDate: runDateFlag }),
        ...(explicitWorkDir === undefined ? {} : { workDir: explicitWorkDir }),
    });
    // The marker `prepare` wrote wins over the directory name, so a run whose `--run-date` was
    // resolved at prepare time keeps that date for every later verb.
    const runDate = await resolveRunDate(fs, run.workDir, runDateFlag);
    // A news artefact's name carries the day, so news cannot proceed without one. An article run is
    // identified by its slug (design §4.3) and its own artefacts are undated, so the article column
    // never reads this value.
    if (runDate === undefined && noun === 'news') {
        return fail(2, `kk.content.${verb}`, `kk ${verb}: cannot resolve the run date for ${run.workDir}`);
    }
    const priorErrors = await fs.exists(
        options.step === 'script'
            ? join(run.workDir, '24-script', `${runDate}_08_script-write_errors.json`)
            : join(run.workDir, '21-plan', `${runDate}_03_curate_errors.json`),
    );
    // Only the two shared verbs reach the article column. A news run never reads the ITC block, so an
    // invalid `workflows.kk-itc` cannot fail a news verb it has nothing to do with.
    let maxRevisions = 0;
    if (noun === 'article' && (verb === 'generate-check' || verb === 'generate-bundle')) {
        try {
            maxRevisions = await resolveArticleMaxRevisions(configFile, fs);
        } catch (error) {
            return fail(2, `kk.content.${verb}`, error instanceof Error ? error.message : String(error));
        }
    }
    return {
        fs,
        noun,
        type,
        workflow: resolved.workflow,
        workDir: run.workDir,
        runDate: runDate ?? '',
        runId: await resolveRunId(fs, run.workDir, runDate ?? '', options.runId),
        settings: resolveNewsSettings(config),
        engine: parseEngine(options.engine, verb),
        step: options.step ?? '',
        final: options.final === true,
        bundleStage: parseBundleStage(options.stage, verb),
        preset: options.preset ?? '',
        worksDir,
        warnings: [],
        priorErrors,
        maxRevisions,
    };
}

/** `prepare` composes the run workspace before any stage runs (design §4.3: every fact lives inside). */
async function composeWorkspace(ctx: GenerateContext): Promise<void> {
    for (const dir of NEWS_PHASE_DIRS) await ctx.fs.ensureDir(join(ctx.workDir, dir));
    await ctx.fs.writeFile(join(ctx.workDir, 'run-date.txt'), `${ctx.runDate}\n`);
    // The remediation budget belongs to the attempt, not the day (`kk daily prepare`'s rule).
    await ctx.fs.writeFile(join(ctx.workDir, '.safety-revise-count'), '0\n');
}

/**
 * `--refresh`: reset the run to its post-collect state so the episode is re-derived from the store.
 *
 * Two coupled reasons, both observed on 2026-11-17. `dailyExtract` keeps `10-collect/pool.json`
 * byte-for-byte once a plan is authored (0347 F6: a frozen episode resumes the same material), which
 * also makes a same-day retry of a *thin* day a pure replay — the pool cannot grow after later
 * collects, so the day can never recover. And `dailyQcContent` embeds `minMinutes` in its cache
 * fingerprint, so changing `episode_min_minutes` invalidates the candidates cache while the plan's
 * descendants still exist — the stage then fails closed ("QC cache changed after downstream artifacts
 * were authored") and the run cannot be re-entered at all. Deleting the derived phases clears both:
 * nothing downstream of the plan survives to be paired with new candidates.
 */
async function unfreezeRun(ctx: GenerateContext): Promise<void> {
    for (const name of REFRESH_PHASE_DIRS) {
        const path = join(ctx.workDir, name);
        if (await ctx.fs.exists(path)) await ctx.fs.deleteFile(path);
    }
    for (const stale of ['pool-gate.json', 'bundle.json', 'run-report.summary.txt']) {
        const path = join(ctx.workDir, stale);
        if (await ctx.fs.exists(path)) await ctx.fs.deleteFile(path);
    }
}

/** `--ledger-sync`: bookkeeping only, never a prepare failure (the `kk daily prepare` contract). */
async function ledgerSync(ctx: GenerateContext): Promise<void> {
    try {
        await quietStdout(() => syncLedger({ workflow: ctx.workflow, worksDir: ctx.worksDir, workDir: ctx.workDir }));
    } catch (error) {
        consoleOutput.error(
            `kk prepare: ledger sync warning: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

async function runAction(noun: string, defaultType: string, verb: string, options: VerbOptions): Promise<void> {
    const type = defaultType;
    // `--work-dir` names the run for every generate step verb; only `prepare` may derive it from
    // `--run-date` (design §1.3), because that is the verb that creates the directory.
    if (verb !== 'prepare') requireWorkDir(options, verb);
    const ctx = await buildContext(noun, type, verb, options);
    if (verb === 'prepare') {
        if (options.refresh === true) await unfreezeRun(ctx);
        await composeWorkspace(ctx);
        // The ledger backfill runs before the summary is printed, so the row's one JSON object is
        // the last thing on stdout (`syncLedger` narrates on its own stream).
        const summary = await runGenerateRow(rowFor(verb), ctx);
        if (options.ledgerSync === true) await ledgerSync(ctx);
        consoleOutput.write(JSON.stringify(summary));
        return;
    }
    if (verb === 'generate-check') {
        const allowed = noun === 'news' ? NEWS_CHECK_STEPS : ARTICLE_CHECK_STEPS;
        if (!(allowed as readonly string[]).includes(ctx.step)) {
            return fail(
                2,
                'kk.content.generate-check',
                `kk ${noun} generate-check: --step must be one of ${allowed.join('|')}, got '${ctx.step}'`,
            );
        }
        // The news steps read their input here; the article steps own their input guard (exit 1 with
        // the path, design §1.3), because what counts as input differs per step there.
        if (noun === 'news') await requireStepInput(ctx);
    }
    if (verb === 'generate-bundle' && ctx.bundleStage === 'freeze') {
        // "Frozen" is the freeze step's own mark (`contentType`, design §4.1), not the file's
        // existence: the variants step writes the same `4-publish/bundle.json` before the freeze,
        // so an existence check would refuse the very freeze that completes it.
        const frozen = await resolveBundlePath(ctx.fs, ctx.workDir);
        const existing = await readJsonFile(ctx.fs, frozen);
        if (existing !== null && typeof existing.contentType === 'string') {
            return fail(
                1,
                'kk.content.generate-bundle',
                `kk generate-bundle: ${frozen} is already frozen — a frozen bundle is never rewritten`,
            );
        }
    }
    await runRowPrepared(rowFor(verb), ctx);
}

/** Run a row and print its one JSON object (the verb's whole stdout contract). */
async function runRowPrepared(row: GenerateVerbRow, ctx: GenerateContext): Promise<void> {
    const summary = await runGenerateRow(row, ctx);
    consoleOutput.write(JSON.stringify(summary));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const VERB_COMMANDS = 'kk.content.generate';

function rejectPositionals(command: string, positionals: string[]): void {
    if (positionals.length > 0) {
        fail(2, command, `${command}: positional arguments are not accepted; use --work-dir`);
    }
}

/** One generate step verb: named flags only (design §1.1: hyphenated verbs take no positionals). */
function verbCommand(
    group: Command,
    noun: string,
    type: string,
    name: string,
    description: string,
    configure: (command: Command) => void,
): void {
    if (noun !== 'news' && NEWS_ONLY_VERBS.has(name)) return;
    const command = group.command(name).description(description).argument('[positionals...]');
    configure(command);
    command.action(async (positionals: string[], options: VerbOptions) => {
        rejectPositionals(`${VERB_COMMANDS}.${name}`, positionals);
        await runAction(noun, type, name, options);
    });
}

/**
 * The verbs that exist on `kk news` only (design §1.3: R1 names `prepare`, `generate-render`,
 * `generate-voice`, `generate-cards` and `report` news-only; `generate-check` and `generate-bundle`
 * are the two the article noun shares, and its steps arrive in 0368).
 */
const NEWS_ONLY_VERBS = new Set(['prepare', 'generate-render', 'generate-voice', 'generate-cards', 'report']);

/** Register the generate step verbs of design §1.3 for one content noun. */
export function registerContentGenerateVerbs(group: Command, noun: string, defaultType: string): void {
    const workDir = (command: Command): Command => command.option('--work-dir <dir>', 'content run directory');
    verbCommand(group, noun, defaultType, 'prepare', 'compose the run workspace and gate the pool', (command) =>
        workDir(command)
            .option('--run-date <YYYYMMDD>', 'news run date')
            .option('--refresh', 'drop the frozen pool and plan, then re-extract from the store')
            .option('--ledger-sync', 'backfill the run ledger before the run starts'),
    );
    verbCommand(group, noun, defaultType, 'generate-check', 'validate one agent step output', (command) =>
        workDir(command)
            .option('--step <step>', noun === 'news' ? NEWS_CHECK_STEPS.join('|') : ARTICLE_CHECK_STEPS.join('|'))
            .option('--final', 'apply the step fallback when the fix pass left errors'),
    );
    verbCommand(group, noun, defaultType, 'generate-render', 'render script, article, cover and TTS input', (command) =>
        workDir(command),
    );
    verbCommand(
        group,
        noun,
        defaultType,
        'generate-voice',
        'synthesize the episode with exactly one engine',
        (command) => workDir(command).option('--engine <engine>', VOICE_ENGINES.join('|'), 'voxcpm'),
    );
    verbCommand(group, noun, defaultType, 'generate-cards', 'render the card series', (command) => workDir(command));
    verbCommand(
        group,
        noun,
        defaultType,
        'generate-bundle',
        'write the channel variants or freeze the bundle',
        (command) =>
            workDir(command)
                .option('--run-id <id>', 'run id the bundle names')
                .option('--run-date <YYYYMMDD>', 'news run date')
                .option('--preset <name>', 'publish preset the freeze validates against')
                .option('--stage <stage>', BUNDLE_STAGES.join('|'), 'variants'),
    );
    verbCommand(group, noun, defaultType, 'report', 'write the generation report and sync the ledger', (command) =>
        workDir(command),
    );
}

/** Command-module registration seam used by the CLI surface rule and host integrations. */
export function registerContentGenerateCommand(program: Command, noun = 'news', defaultType = 'news'): void {
    const group = program.command(noun).description(`${noun} content operations`);
    registerContentGenerateVerbs(group, noun, defaultType);
}
