/**
 * The article (ITC) steps of the generate step verbs (task 0368; design
 * `docs/design/content-pipeline-consolidation.md` §1.3, §4.1, §4.2, §5.2; ADR-053).
 *
 * `generate-check --step outline|judge|adapt` and `generate-bundle --stage variants|freeze` are the
 * SAME two verbs 0367 registered — this module is the article column of their per-type step table,
 * not a second verb. Every step calls the function that already owns the work:
 *
 * | step | function behind it | where |
 * | --- | --- | --- |
 * | `generate-check --step outline` | `itc-outline-pick` + `itc-decision --outline` | `plugins/kk/scripts/itc-stages.ts`, `apps/cli/src/itc-stage.ts` |
 * | `generate-check --step judge` | `itc-author-verdict` (`apps/cli/src/itc-publish.ts`) | via `runItcStage` |
 * | `generate-check --step adapt` | `itc-adapt-verify` (`plugins/kk/scripts/itc-stages.ts`) | the stage runner |
 * | `generate-bundle --stage variants` | `itc-materialize-plan` (`apps/cli/src/itc-publish.ts`) | via `runItcStage` |
 * | `generate-bundle --stage freeze` | `itc-author-complete` (`apps/cli/src/itc-stage.ts`) | via `runItcStage` |
 *
 * No stage body is copied. What this module owns is the article-shaped part: the pick is committed to
 * `2-outline/outline-approved.md`, the judge's revision budget is bound to
 * `workflows.kk-article-generate.max_revisions` (R5), and the freeze writes the design's §4.1 article
 * bundle — `contentType`, `title`, no `episode`, one `{path, sha256}` per adapted file.
 *
 * File contract (design §4.1, §4.3; R2):
 *
 * | path | written by | content |
 * | --- | --- | --- |
 * | `4-publish/content.json` | `--stage variants` | the materialized source Content, plus the generation-side record (`sourceLocale`, `variants[key] = {file, adapt, limits, switches}`) |
 * | `4-publish/publish-plan.json` | `itc-materialize-plan` (inside `--stage variants`) | the ITC plan the `adapt` agent and `--step adapt` read; **removed by `--stage freeze`** — the frozen bundle is the only plan-shaped record the publish side reads |
 * | `4-publish/bundle.json` | `--stage freeze` | the frozen bundle `kk-publish` plans from |
 *
 * Exit codes (design §1): `0` the step ran (a `fix` verdict is a verdict, not a failure), `1` the step
 * ran and failed or its input is missing/unreadable, `2` usage (handled by the verb).
 */
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { Command } from 'commander';
import { readItcConfigBlock } from '../itc-config';
import { runItcStage } from '../itc-stage';
import { loadPublishPreset, type PublishPresetTarget } from '../publish-core';
import { BundleSchema } from '../publish-matrix';
import { runStage } from '../stage';
// The seam below re-exports the shared verb registration, so the two modules reference each other;
// every reference is inside a function body, which ESM resolves after both are initialized.
import { registerContentGenerateVerbs } from './content-generate';

const PARSE_JSON: (raw: string) => unknown = JSON.parse.bind(JSON);

/** The `generate-check --step` values the article noun accepts (design §1.3, §6). */
export const ARTICLE_CHECK_STEPS = ['outline', 'judge', 'adapt'] as const;
/** One accepted article `generate-check --step` value. */
export type ArticleCheckStep = (typeof ARTICLE_CHECK_STEPS)[number];

/** The `generate-bundle --stage` values (design §1.3; both stages exist for articles too). */
export const ARTICLE_BUNDLE_STAGES = ['variants', 'freeze'] as const;
/** One accepted article `generate-bundle --stage` value. */
export type ArticleBundleStage = (typeof ARTICLE_BUNDLE_STAGES)[number];

/** Work-directory names the ITC stage bodies already own (design §4.3: the verbs rename nothing). */
const OUTLINE_DIR = '2-outline';
const DRAFT_FILE = '3-draft-draft-article.md';
const PUBLISH_DIR = '4-publish';
const CONTENT_FILE = 'content.json';
const PLAN_FILE = 'publish-plan.json';
const OPTIONS_SNAPSHOT = 'itc-options.json';
const REQUEST_FILE = 'request.json';

/** Routing/evidence tokens (the same ones `kk-itc-author.yaml` reads). */
const AUTO_PICK = '.auto-pick';
const OUTLINE_APPROVED = 'outline-approved.md';
const VERDICT_FILE = '.itc-verdict.json';
const DISPOSITION_FILE = '.itc/disposition.txt';
const AUTO_REVISE_COUNT = '.auto-revise-count';
const DRAFT_COUNT = '.draft-count';

/** `itc-config.ts`'s compiled `max_revisions` default, mirrored for a config-less run. */
export const DEFAULT_MAX_REVISIONS = 2;

interface JsonObject {
    [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** What one article step hands back to the verb's summary (design §1.3 stdout). */
export interface ArticleStepOutcome {
    /** `generate-check`: the verdict word the workflow conditions on. */
    verdict?: 'pass' | 'fix';
    /** `generate-check`: the file that carries the fix verdict. */
    errors?: string;
    /** `generate-bundle`: the frozen (or to-be-frozen) bundle path. */
    bundle?: string;
    /** `generate-bundle`: the variant keys the bundle carries. */
    variants?: string[];
    /** `generate-bundle`: articles carry no final-variant safety review yet (design §4.1). */
    safety?: null;
    runId?: string;
}

/** Everything one article step needs from the verb that invoked it. */
export interface ArticleStepInput {
    workDir: string;
    /** The content type this run was generated as (`contentType` of the frozen bundle). */
    type: string;
    runId: string;
    /** `--preset` / the workflow's `preset` var: the preset the freeze validates against. */
    preset: string;
    /** `workflows.kk-article-generate.max_revisions` (R5) — the one bound on the rewrite loop. */
    maxRevisions: number;
    /** `generate-check --step`. */
    step: string;
    /** `generate-bundle --stage`. */
    bundleStage: string;
}

/**
 * The two out-of-process seams an article step reaches — the native `itc-*` stage bodies
 * (`apps/cli/src/itc-stage.ts`) and the script stage bodies the shared stage runner spawns. Tests
 * replace them so a whole verb runs in-process (the per-file coverage instrument cannot see work done
 * in a spawned child). Production never overrides them.
 */
export interface ArticleDeps {
    runItc: (argv: string[]) => Promise<number | undefined>;
    runStage: (argv: string[]) => Promise<number>;
}

const DEFAULT_DEPS: ArticleDeps = {
    // `runItcStage` answers `undefined` for a name it does not own. Every argv this module builds is
    // an `itc-*` name it does own, so an `undefined` is a wiring bug and must never read as success.
    runItc: async (argv) => (await runItcStage(argv)) ?? 1,
    runStage: async (argv) => runStage(argv),
};

let deps: ArticleDeps = DEFAULT_DEPS;

/** Replace one or more seams; returns the restore function (tests only — production never calls it). */
export function setArticleDeps(overrides: Partial<ArticleDeps>): () => void {
    const previous = deps;
    deps = { ...previous, ...overrides };
    return () => {
        deps = previous;
    };
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

async function readJson(fs: FileSystem, path: string): Promise<JsonObject | null> {
    if (!(await fs.exists(path))) return null;
    try {
        const parsed: unknown = PARSE_JSON(await fs.readFile(path));
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

async function readText(fs: FileSystem, path: string): Promise<string> {
    if (!(await fs.exists(path))) return '';
    try {
        return await fs.readFile(path);
    } catch {
        return '';
    }
}

async function countOf(fs: FileSystem, path: string): Promise<number> {
    const value = Number.parseInt((await readText(fs, path)).trim(), 10);
    return Number.isFinite(value) ? value : 0;
}

async function writeJson(fs: FileSystem, path: string, value: unknown): Promise<void> {
    await fs.ensureDir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Resolve the revision bound: `workflows.kk-article-generate.max_revisions` through the ITC block
 * reader, which falls back to `workflows.kk-itc` when the new block is absent (R6). An invalid block
 * is a usage error the caller reports; an absent one takes the compiled default.
 */
export async function resolveArticleMaxRevisions(configFile: string, fs: FileSystem): Promise<number> {
    const block = await readItcConfigBlock(configFile, fs);
    return block.max_revisions ?? DEFAULT_MAX_REVISIONS;
}

// ---------------------------------------------------------------------------
// `generate-check --step outline|judge|adapt`
// ---------------------------------------------------------------------------

/** The run identity the decision is bound to: the snapshot's `parentRunId` (frozen by `new`). */
async function parentRunIdOf(fs: FileSystem, workDir: string): Promise<string> {
    const snapshot = await readJson(fs, join(workDir, OPTIONS_SNAPSHOT));
    const recorded = snapshot?.parentRunId;
    if (typeof recorded === 'string' && recorded.trim() !== '') return recorded.trim();
    const request = await readJson(fs, join(workDir, REQUEST_FILE));
    const run = request?.run;
    return typeof run === 'string' && run.trim() !== '' ? `kk-content-${run.trim()}` : 'kk-content-run';
}

/**
 * `--step outline` (design §5.2: `outline-autopick` + `outline-commit` folded into this one call):
 * validate the writer's recommendation (`itc-outline-pick`), bind the bounded catalog decision
 * (`itc-decision --outline`, empty on defer), then commit the chosen option to
 * `2-outline/outline-approved.md` — the file every later step and `itc-author-complete` read.
 */
async function runOutlineStep(input: ArticleStepInput, fs: FileSystem): Promise<number | ArticleStepOutcome> {
    const recommendation = join(input.workDir, OUTLINE_DIR, 'outline-recommendation.json');
    if (!(await fs.exists(recommendation))) {
        return missingInput(input.step, recommendation);
    }
    const picked = await deps.runStage(['itc-outline-pick', input.workDir]);
    if (picked !== 0) {
        echoError(`kk generate-check: itc-outline-pick failed (exit ${picked}) for ${input.workDir}`);
        return 1;
    }
    const decided = await deps.runItc([
        'itc-decision',
        '--outline',
        input.workDir,
        await parentRunIdOf(fs, input.workDir),
    ]);
    if (decided !== 0) {
        echoError(`kk generate-check: itc-decision --outline failed (exit ${decided}) for ${input.workDir}`);
        return 1;
    }
    // A deferred decision leaves `.auto-pick` empty: there is no approved outline to draft from, so
    // the step reports `fix` and the workflow stops before spending a draft (kk-itc-author's
    // outline-autopick -> outline-select edge, minus the operator pause `auto` switched off).
    const chosen = (await readText(fs, join(input.workDir, OUTLINE_DIR, AUTO_PICK))).trim();
    if (chosen === '') return { verdict: 'fix' };
    const option = join(input.workDir, OUTLINE_DIR, `outline-option-${chosen}.md`);
    if (!(await fs.exists(option))) {
        echoError(`kk generate-check: the picked outline option is missing: ${option}`);
        return 1;
    }
    await fs.copy(option, join(input.workDir, OUTLINE_DIR, OUTLINE_APPROVED));
    return { verdict: 'pass' };
}

/**
 * `--step judge`: hand the agent's verdict to `itc-author-verdict` with ONE budget (R5).
 *
 * The rewrite counter is derived from the workflow's own draft counter: `draft-write` increments
 * `.draft-count` on every entry, so rewrites performed = drafts - 1. `itc-author-verdict` reads that
 * as `.auto-revise-count` and compares it with `max_revisions`, which keeps the ITC disposition words
 * (`finish` | `autorevise` | `fail`) and their single consumer unchanged; both postures share the
 * budget because the failure AC (AC3) counts draft rewrites, not operator pauses.
 */
async function runJudgeStep(input: ArticleStepInput, fs: FileSystem): Promise<number | ArticleStepOutcome> {
    const verdictPath = join(input.workDir, VERDICT_FILE);
    if (!(await fs.exists(verdictPath))) {
        return missingInput(input.step, verdictPath);
    }
    const drafts = await countOf(fs, join(input.workDir, DRAFT_COUNT));
    const rewrites = Math.max(0, drafts - 1);
    await fs.writeFile(join(input.workDir, AUTO_REVISE_COUNT), `${rewrites}\n`);
    const previousAuto = process.env.KK_ITC_AUTO;
    const previousMax = process.env.KK_ITC_MAX_REVISIONS;
    process.env.KK_ITC_AUTO = 'true';
    process.env.KK_ITC_MAX_REVISIONS = String(input.maxRevisions);
    let code: number | undefined;
    try {
        code = await deps.runItc(['itc-author-verdict', input.workDir]);
    } finally {
        restoreEnv('KK_ITC_AUTO', previousAuto);
        restoreEnv('KK_ITC_MAX_REVISIONS', previousMax);
    }
    if (code !== 0) {
        echoError(`kk generate-check: itc-author-verdict failed (exit ${code}) for ${input.workDir}`);
        return 1;
    }
    const disposition = (await readText(fs, join(input.workDir, DISPOSITION_FILE))).trim();
    if (disposition === 'finish' && !(await verdictCarriesConfidence(fs, verdictPath))) {
        // design §1.5 / task 0211: a PASS is only a PASS when the verdict names a valid confidence
        // level. The ITC guards render that as `PASS!`; here it stays a fix verdict, so the FSM
        // never accepts a confident-looking verdict that carries none.
        echoError(`kk generate-check: ${verdictPath} reports PASS without a HIGH|MEDIUM|LOW confidence`);
        return { verdict: 'fix', errors: verdictPath };
    }
    return disposition === 'finish' ? { verdict: 'pass' } : { verdict: 'fix', errors: verdictPath };
}

/** The confidence levels `kk-itc-author.yaml` accepts; anything else is an uncertified PASS. */
const CONFIDENCE_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW']);

/**
 * Does this verdict artifact certify itself? A non-PASS verdict is out of scope here (the FSM routes
 * it through the disposition), but a PASS must carry a valid `confidence` enum value.
 */
async function verdictCarriesConfidence(fs: FileSystem, path: string): Promise<boolean> {
    const value = await readJson(fs, path);
    if (value === null) return false;
    if (value.verdict !== 'PASS') return true;
    const confidence = typeof value.confidence === 'string' ? value.confidence : '';
    return CONFIDENCE_LEVELS.has(confidence);
}

/** Set or clear one env var, so a nested ITC body sees this step's values and nothing afterwards. */
function restoreEnv(name: string, previous: string | undefined): void {
    if (previous === undefined) {
        delete process.env[name];
        return;
    }
    process.env[name] = previous;
}

/**
 * `--step adapt`: `itc-adapt-verify` over the plan `--stage variants` wrote. A variant that is
 * missing, or lacks a non-empty title/body, means the adapt agent's output is unusable — there is no
 * fix state in the article FSM (design §5.2), so the step fails rather than reporting a fix.
 */
async function runAdaptStep(input: ArticleStepInput, fs: FileSystem): Promise<number | ArticleStepOutcome> {
    const planPath = join(input.workDir, PUBLISH_DIR, PLAN_FILE);
    if (!(await fs.exists(planPath))) {
        return missingInput(input.step, planPath);
    }
    const code = await deps.runStage(['itc-adapt-verify', input.workDir]);
    if (code !== 0) {
        echoError(`kk generate-check: itc-adapt-verify failed (exit ${code}) for ${input.workDir}`);
        return 1;
    }
    return { verdict: 'pass' };
}

/** The design §1.3 input guard: exit 1 when the step's input is missing or unreadable. */
function missingInput(step: string, path: string): number {
    echoError(`kk generate-check: --step ${step} input is missing or unreadable: ${path}`);
    return 1;
}

/** Run the `--step` the workflow asked for, or report the value as a usage error. */
export async function runArticleCheck(
    input: ArticleStepInput,
    fs: FileSystem = createNodeFileSystem(),
): Promise<ArticleStepOutcome & { code: number }> {
    const outcome =
        input.step === 'outline'
            ? await runOutlineStep(input, fs)
            : input.step === 'judge'
              ? await runJudgeStep(input, fs)
              : await runAdaptStep(input, fs);
    return typeof outcome === 'number' ? { code: outcome } : { code: 0, ...outcome };
}

// ---------------------------------------------------------------------------
// `generate-bundle --stage variants|freeze`
// ---------------------------------------------------------------------------

/** One generation-side variant record (the `ItcPublishPlan` fields design §4.1 keeps in content.json). */
interface GenerationVariant {
    file: string;
    adapt: boolean;
    limits?: JsonObject;
    switches?: JsonObject;
}

function generationVariants(plan: JsonObject | null): Record<string, GenerationVariant> {
    const raw = isObject(plan?.variants) ? plan.variants : {};
    const out: Record<string, GenerationVariant> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isObject(value)) continue;
        const file = typeof value.file === 'string' ? value.file : '';
        if (file === '') continue;
        out[key] = {
            file,
            adapt: value.adapt === true,
            ...(isObject(value.limits) ? { limits: value.limits } : {}),
            ...(isObject(value.switches) ? { switches: value.switches } : {}),
        };
    }
    return out;
}

/** The frozen launch snapshot's generation fields (design §4.3: `new` wrote them once). */
async function readSnapshot(fs: FileSystem, workDir: string): Promise<JsonObject> {
    return (await readJson(fs, join(workDir, OPTIONS_SNAPSHOT))) ?? {};
}

/**
 * `--stage variants` (design §6: `itc-materialize-plan`): materialize `4-publish/content.json` and
 * the ITC plan from the draft, then fold the plan's generation-side fields into `content.json` so the
 * artefact the adapt agent and the freeze read is one file. A `--preset` that disagrees with the
 * run's frozen snapshot is refused: `itc-options.json` is the single source every downstream node
 * reads, and silently planning against a second preset would freeze a bundle the run never built.
 */
async function runVariantsStage(input: ArticleStepInput, fs: FileSystem): Promise<number | ArticleStepOutcome> {
    const draft = join(input.workDir, DRAFT_FILE);
    if (!(await fs.exists(draft))) {
        echoError(`kk generate-bundle: final draft not found: ${draft}; run the authoring states first`);
        return 1;
    }
    const snapshot = await readSnapshot(fs, input.workDir);
    const snapshotPreset = typeof snapshot.publishPreset === 'string' ? snapshot.publishPreset : '';
    if (input.preset !== '' && snapshotPreset !== '' && input.preset !== snapshotPreset) {
        echoError(
            `kk generate-bundle: this run was prepared with preset '${snapshotPreset}' (${OPTIONS_SNAPSHOT}); '${input.preset}' would freeze a different channel set`,
        );
        return 1;
    }
    const materialized = await deps.runItc(['itc-materialize-plan', input.workDir]);
    if (materialized !== 0) {
        echoError(`kk generate-bundle: itc-materialize-plan failed (exit ${materialized}) for ${input.workDir}`);
        return 1;
    }
    const planPath = join(input.workDir, PUBLISH_DIR, PLAN_FILE);
    const plan = await readJson(fs, planPath);
    const variants = generationVariants(plan);
    const contentPath = join(input.workDir, PUBLISH_DIR, CONTENT_FILE);
    const content = (await readJson(fs, contentPath)) ?? {};
    const warnings = Array.isArray(plan?.warnings) ? plan.warnings : [];
    // The generation-side record stays in content.json (design §4.1): `sourceLocale`, and per variant
    // `adapt`/`limits`/`switches`. The bundle carries only what a publish needs.
    await writeJson(fs, contentPath, {
        ...content,
        sourceLocale: typeof snapshot.sourceLocale === 'string' ? snapshot.sourceLocale : 'en',
        variants,
        ...(warnings.length === 0 ? {} : { warnings }),
    });
    return {
        bundle: join(input.workDir, PUBLISH_DIR, 'bundle.json'),
        variants: Object.keys(variants).sort(),
        safety: null,
        runId: input.runId,
    };
}

/** `<file>` relative to `4-publish/` as `{path, sha256}` — the bundle's own shape (design §4.1). */
async function variantEntry(fs: FileSystem, workDir: string, file: string): Promise<{ path: string; sha256: string }> {
    const path = join(workDir, PUBLISH_DIR, file);
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch {
        // A freeze whose variant file is missing is a refusal with the verb's own JSON, never a raw
        // ENOENT: the launch/FSM path guards this with `--step adapt`, but a direct freeze can miss.
        throw new ArticleStepFailure(1, `kk generate-bundle: variant '${file}' is missing at ${path}`);
    }
    return { path: file, sha256: createHash('sha256').update(raw).digest('hex') };
}

/** A verb refusal that must still print the verb's one JSON object (design §1.3 stdout contract). */
export class ArticleStepFailure extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = 'ArticleStepFailure';
    }
}

/** The calendar day the bundle records: the request's, the snapshot's, the dir name's, else today. */
async function runDateOf(fs: FileSystem, workDir: string): Promise<string> {
    const request = await readJson(fs, join(workDir, REQUEST_FILE));
    const snapshot = await readSnapshot(fs, workDir);
    const candidates = [request?.runDate, snapshot.runDate, workDir.replace(/\/+$/, '').split('/').at(-1)];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const digits = candidate.replaceAll('-', '');
        if (/^\d{8}$/.test(digits)) return digits;
    }
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()).replaceAll('-', '');
}

/**
 * Freeze admission against the preset (design §1.3: `--preset` is what the freeze validates against):
 * every REQUIRED row's variant must exist in the bundle, which is the check the news freeze makes for
 * the same reason — a missing required variant would only fail after the publish window opened.
 */
async function validatePreset(
    fs: FileSystem,
    presetName: string,
    variants: Record<string, { path: string; sha256: string }>,
): Promise<string | null> {
    if (presetName === '') return null;
    let preset: Awaited<ReturnType<typeof loadPublishPreset>>['preset'];
    try {
        preset = (await loadPublishPreset(presetName, {}, fs)).preset;
    } catch (error) {
        return `preset '${presetName}' could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
    const missing = preset.targets
        .filter((target: PublishPresetTarget) => target.required === true && target.variant !== undefined)
        .filter(
            (target: PublishPresetTarget) =>
                variants[`${target.variant}@${target.plugin}`] === undefined &&
                variants[target.variant as string] === undefined,
        )
        .map((target: PublishPresetTarget) => target.variant as string);
    return missing.length === 0
        ? null
        : `preset '${preset.name}' requires variant(s) the run never produced: ${missing.join(', ')}`;
}

/**
 * `--stage freeze` (design §5.2): `itc-author-complete` writes the authoring receipt (draft +
 * approved outline + judge disposition), then the article bundle is frozen over the adapted files.
 * The ITC plan is removed here — design §4.2 sends publishing through `kk-publish`, which plans from
 * the bundle and the preset, so `publish-plan.json` must not survive as a second, older plan.
 */
async function runFreezeStage(input: ArticleStepInput, fs: FileSystem): Promise<number | ArticleStepOutcome> {
    // A frozen bundle is never rewritten; the verb already refuses that case before any step runs
    // (`content-generate.ts` guards `--stage freeze` against `resolveBundlePath`).
    const bundlePath = join(input.workDir, PUBLISH_DIR, 'bundle.json');
    const request = await readJson(fs, join(input.workDir, REQUEST_FILE));
    const seededFromFile = typeof request?.from === 'string' && request.from.trim() !== '';
    if (!seededFromFile) {
        const completed = await deps.runItc(['itc-author-complete', input.workDir, input.runId]);
        if (completed !== 0) {
            echoError(`kk generate-bundle: itc-author-complete failed (exit ${completed}) for ${input.workDir}`);
            return 1;
        }
    }
    const content = await readJson(fs, join(input.workDir, PUBLISH_DIR, CONTENT_FILE));
    if (content === null) {
        echoError(
            `kk generate-bundle: ${join(input.workDir, PUBLISH_DIR, CONTENT_FILE)} is missing; run --stage variants first`,
        );
        return 1;
    }
    const title = typeof content.title === 'string' ? content.title.trim() : '';
    if (title === '') {
        echoError(
            `kk generate-bundle: ${join(input.workDir, PUBLISH_DIR, CONTENT_FILE)} has no title; the draft's H1 is the bundle title`,
        );
        return 1;
    }
    const sourceLocale =
        typeof content.sourceLocale === 'string'
            ? content.sourceLocale
            : typeof request?.locale === 'string'
              ? request.locale
              : 'en';
    const variants: Record<string, { path: string; sha256: string }> = {};
    for (const [key, variant] of Object.entries(generationVariants(content))) {
        if (!variant.adapt) continue;
        variants[key] = await variantEntry(fs, input.workDir, variant.file);
    }
    if (isObject(request?.variants)) {
        for (const name of Object.keys(request.variants)) {
            if (variants[name] !== undefined) continue;
            const file = `content.${name}.json`;
            if (await fs.exists(join(input.workDir, PUBLISH_DIR, file))) {
                variants[name] = await variantEntry(fs, input.workDir, file);
            }
        }
    }
    // The source-locale article is published under its own locale key and under the locale-agnostic
    // one, so a preset row names `article` without knowing the run's source language.
    const source = await variantEntry(fs, input.workDir, CONTENT_FILE);
    variants.article = source;
    variants[`${sourceLocale}-article`] = source;
    const refusal = await validatePreset(fs, input.preset, variants);
    if (refusal !== null) {
        echoError(`kk generate-bundle: ${refusal}`);
        return 1;
    }
    const readDate = await runDateOf(fs, input.workDir);
    const snapshot = await readSnapshot(fs, input.workDir);
    const parentRunId =
        typeof snapshot.parentRunId === 'string' && snapshot.parentRunId !== '' ? snapshot.parentRunId : input.runId;
    const parsed = BundleSchema.safeParse({
        schemaVersion: 1,
        runId: input.runId,
        runDate: readDate,
        contentType: input.type,
        title,
        parentRunId,
        runs: [input.runId],
        variants,
    });
    if (!parsed.success) {
        echoError(`kk generate-bundle: the article bundle is invalid: ${parsed.error.message}`);
        return 1;
    }
    await writeJson(fs, bundlePath, parsed.data);
    // The ITC plan's last consumer was `--step adapt`; from here the bundle and the preset are the
    // publish input (design §4.1, §4.2), and AC1 requires no publish-plan.json beside the bundle.
    const planPath = join(input.workDir, PUBLISH_DIR, PLAN_FILE);
    if (await fs.exists(planPath)) await fs.deleteFile(planPath);
    return { bundle: bundlePath, variants: Object.keys(variants).sort(), safety: null, runId: input.runId };
}

/** Run the `--stage` the workflow asked for. */
export async function runArticleBundle(
    input: ArticleStepInput,
    fs: FileSystem = createNodeFileSystem(),
): Promise<ArticleStepOutcome & { code: number }> {
    const outcome =
        input.bundleStage === 'freeze' ? await runFreezeStage(input, fs) : await runVariantsStage(input, fs);
    return typeof outcome === 'number' ? { code: outcome } : { code: 0, ...outcome };
}

/**
 * Command-module registration seam used by the CLI surface rule and host integrations: the article
 * column adds no verb of its own — it plugs into the two shared generate verbs, which this seam
 * registers for the article noun.
 */
export function registerContentGenerateArticleCommand(program: Command, noun = 'article', defaultType = 'itc'): void {
    registerContentGenerateVerbs(program, noun, defaultType);
}
