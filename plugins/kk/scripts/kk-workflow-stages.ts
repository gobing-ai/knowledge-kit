#!/usr/bin/env bun
/**
 * Deterministic stage runner shared by the kk product workflows (ADR-115 composition owner).
 *
 * Each YAML action keeps one short package-root resolution block and delegates its multi-command
 * body here, so a shell action stays a single logical call:
 *
 *   prepare-itc   <work_dir> <topic> <input_file> <force>
 *   prepare-solo  <work_dir> <topic> <input_file> <voice_profile> <force>
 *   prepare-storm <work_dir> <topic> <input_file> <max_results> <fixture>
 *   validate      [<override>] --in <voicescript.yaml>
 *   wrap          [<override>] --in <voicescript.yaml> --out <docs.json> [--profile <name>]
 *   duration      <work_dir> <target_duration_min>
 *   render-storm  [<override>] --in <content.json> --out <content.md>
 *   itc-outline-pick <work_dir>          (0149, body in the sibling itc-stages.ts)
 *   itc-report       <work_dir> [max_revisions]  (0149, body in the sibling itc-stages.ts)
 *   itc-materialize  <work_dir> <publish_live>   (0150, sibling)
 *   itc-publish-plan <work_dir> <targets> <source_locale> <publish_live>  (0150, sibling)
 *   itc-publish-fanout <work_dir> [--retry]   (0151, sibling)
 *   itc-publish-next  <work_dir>              (0151, sibling)
 *
 * `validate` / `wrap` / `render-storm` resolve the shipped sibling sidecars and delegate to them;
 * nothing about those sidecars changed. The `prepare-*` verbs and `duration` keep the logic that
 * used to live inline in `plugins/kk/workflows/*.yaml`, message-for-message.
 *
 * Node/Bun builtins only — no @gobing-ai/* and no cross-directory relative imports (the file is
 * resolved from the installed package or from a checkout). The itc-* stages delegate to their
 * same-directory sibling `itc-stages.ts`, imported lazily so a runner copy without the sibling
 * still loads and fails loud with the remediation path.
 *
 * The YAML prelude resolves this file as `$pkg/plugins/kk/scripts/kk-workflow-stages.ts` where `pkg`
 * comes from `realpath "$(command -v kk)"` (the installed package root), and falls back to the
 * cwd-relative `plugins/kk/scripts/kk-workflow-stages.ts` when that copy is absent — the checkout
 * tier kk-storm-research's render has always relied on, preserved on purpose. The daily-voice
 * workflow reaches the same script through `kk stage` (apps/cli/src/stage.ts), which resolves a
 * recognized checkout entry to this checked-in copy (never a stale `apps/cli/plugins/` stage) and an
 * installed entry to its own package-shipped copy.
 *
 * SYNC: plugins/kk/workflows/{kk-solo-podcast,kk-itc,kk-storm-research}.yaml shell this script
 * (kk-daily-ai-voice goes through `kk stage`). Keep message substrings stable —
 * apps/cli/tests/kk-workflow-stages.test.ts and the four workflow static tests match them.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    appendFileSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

const SCRIPTS_DIR = import.meta.dir;
const VALIDATE_SIDECAR = 'validate-voicescript.ts';
const WRAP_SIDECAR = 'wrap-voicescript-doc.ts';
const RENDER_SIDECAR = 'render-md.ts';
// F613: the zh style contract the script-write prompt reads (snapshot stage) and dailynews-gen
// consumes (DAILYNEWS_STYLE_FILE); no workflow var carries an override, so the chain is
// $KK_WORKFLOWS_DIR -> package copy -> $HOME.
const STYLE_SIDECAR = 'daily-voice-style.zh.md';
const REVISE_COUNT = '.revise-count';
// Post-translation title-dedup threshold (task 0138 R3). ponytail: the 2026-09-16 Gemini 3.8 Live
// pair measures 0.417 zh title-only Jaccard, the nearest distinct pair 0.1 (4x margin). Character
// bigrams need same-language input — pre-translate dedup over the mixed-language blend cannot work.
const DEDUP_TITLE_THRESHOLD = 0.4;
// F614: the daily cover renders through the shipped daily-news presets; the brief's subject is
// the only per-run var. The format/style pins and the subject cap are part of the style
// contract — changing the look means editing the preset files, not this stage.
const COVER_FORMAT = 'daily-news-cover';
const COVER_STYLE = 'daily-news';
const COVER_SUBJECT_CAP = 240;
// E8: the XHS card series. Format and style are pinned exactly like the cover's; only the copy is
// model-authored. `XHS_MAX_CARDS` mirrors the format preset's own series guidance.
const XHS_FORMAT = 'xhs-card';
const XHS_MAX_CARDS = 10;
const XHS_TITLE_CAP = 20;
const XHS_BODY_CAP = 1000;
const XHS_ROLES: readonly string[] = ['cover', 'content', 'closing'];

/** One planned card, normalized: `index` zero-padded for the preset's artifact name. */
interface XhsCard {
    index: string;
    role: string;
    copy: string;
    points: string[];
    layout: string;
    subject: string;
    sourcePoint: string;
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

/**
 * Load the itc-* helper sibling lazily: this runner is resolved (and copied alone, e.g. by
 * apps/cli/tests/kk-workflow-stages.test.ts) from installs where the sibling may be absent, so
 * the itc-* stages fail loud with a remediation path instead of breaking every stage at load.
 */
async function loadItcStages(): Promise<typeof import('./itc-stages.ts')> {
    try {
        return await import('./itc-stages.ts');
    } catch {
        return fail(
            'itc-stages.ts not found next to kk-workflow-stages.ts — install or refresh the kk package (bun link in a checkout)',
        );
    }
}

/** coreutils-style reason for the errno codes the staged file operations can hit. */
const ERRNO_REASONS: Record<string, string> = {
    EACCES: 'Permission denied',
    EROFS: 'Read-only file system',
    ENOSPC: 'No space left on device',
    ENOENT: 'No such file or directory',
    ENOTDIR: 'Not a directory',
    EISDIR: 'Is a directory',
    EEXIST: 'File exists',
    EPERM: 'Operation not permitted',
    EFAULT: 'Bad address',
};

/**
 * Run a filesystem operation, turning a failure into the named diagnostic the shell reported
 * (`mkdir: <path>: Permission denied`) instead of an uncaught Bun stack trace.
 */
function sted(op: string, path: string, run: () => void): void {
    try {
        run();
    } catch (error) {
        const failure = error as { code?: string; message?: string };
        fail(`${op}: ${path}: ${(failure.code !== undefined && ERRNO_REASONS[failure.code]) || failure.message}`);
    }
}

/** `[ -f ]` semantics: exists AND is a regular file; an unreadable parent answers false, never throws. */
function isFile(path: string): boolean {
    try {
        return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
    } catch {
        return false;
    }
}

/**
 * Runtime override chain, in the order the workflows resolved it inline: explicit var →
 * `KK_WORKFLOWS_DIR` → the shipped package copy → `~/.config/kk/workflows`. The package copy sits
 * before the config-dir copy on purpose (F8 R1) — the shipped bytes win unless the operator elected
 * that directory as an override.
 */
function resolveSidecar(override: string, sidecar: string): string {
    if (override && isFile(override)) return override;
    const kkWorkflowsDir = process.env.KK_WORKFLOWS_DIR;
    if (kkWorkflowsDir) {
        const fromEnv = join(kkWorkflowsDir, sidecar);
        if (isFile(fromEnv)) return fromEnv;
    }
    const shipped = join(SCRIPTS_DIR, sidecar);
    if (isFile(shipped)) return shipped;
    return join(process.env.HOME ?? '', '.config/kk/workflows', sidecar);
}

/**
 * Fail loud with the remediation path when no copy of a sidecar exists. `label` is the workflow var
 * that carries the override (`validate_script` / `wrap_script` / `render_script`) so the diagnostic
 * names the same thing the operator sees in the YAML.
 */
function requireSidecar(override: string, sidecar: string, label: string): string {
    const resolved = resolveSidecar(override, sidecar);
    if (!isFile(resolved)) {
        fail(
            `${label} not found — no ${sidecar} under: the explicit var, $KK_WORKFLOWS_DIR, the package scripts dir (also ./plugins/kk/scripts when the prelude's pkg degrades to a dot), $HOME/.config/kk/workflows — install or refresh the kk package (bun link in a checkout)`,
        );
    }
    return resolved;
}

/** Run a shipped sibling under the same bun runtime, passing stdout/stderr and the exit code through. */
function delegate(sidecar: string, args: string[]): never {
    const runner = spawnSync(process.execPath, [sidecar, ...args], { stdio: 'inherit' });
    process.exit(runner.status ?? 1);
}

/**
 * The directory a relative `input_file` resolves against. bash used its logical `$PWD`; the runner
 * has only `process.cwd()` (physical) plus the inherited `$PWD`, so trust `$PWD` exactly when it
 * realpaths to the same directory and fall back to the physical cwd otherwise.
 */
function logicalCwd(): string {
    const pwd = process.env.PWD;
    if (!pwd) return process.cwd();
    try {
        return realpathSync(pwd) === realpathSync(process.cwd()) ? pwd : process.cwd();
    } catch {
        return process.cwd();
    }
}

/** jq's `-n '<literal>' > file`: pretty 2-space JSON with a trailing newline, keys in literal order. */
function writeJson(path: string, value: Record<string, unknown>): void {
    sted('write', path, () => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`));
}

/** `.revise-count` lives at the work_dir root in every workflow that uses it. */

function bumpReviseCount(workDir: string): void {
    const path = join(workDir, '.revise-count');
    let previous = Number.NaN;
    if (isFile(path))
        sted('read', path, () => {
            previous = Number.parseInt(readFileSync(path, 'utf-8'), 10);
        });
    sted('write', path, () => writeFileSync(path, `${(Number.isNaN(previous) ? 0 : previous) + 1}\n`));
}

interface PrepareOptions {
    readonly workDirArg: string;
    readonly topic: string;
    readonly inputFile: string;
    readonly force: string;
    /** Stage directories created under work_dir, in the workflow's declared order. */
    readonly dirs: readonly string[];
    /** solo-podcast requires a profile (argv or $VOICEBOX_DEFAULT_PROFILE); itc does not. */
    readonly requireVoiceProfile: boolean;
    readonly voiceProfile: string;
    /** itc zeroes .revise-count before the XOR checks; solo-podcast zeroes it after brief.md. */
    readonly reviseCountEarly: boolean;
}

/** XOR + brief.md workspace staging shared by the itc and solo-podcast prepares. */
function prepareWorkspace(options: PrepareOptions): void {
    const { workDirArg, topic, inputFile, force, dirs, voiceProfile, requireVoiceProfile, reviseCountEarly } = options;
    if (!workDirArg) fail('missing work_dir');
    const workDir = resolve(workDirArg);
    for (const dir of dirs) sted('mkdir', join(workDir, dir), () => mkdirSync(join(workDir, dir), { recursive: true }));
    if (reviseCountEarly)
        sted('write', join(workDir, REVISE_COUNT), () => writeFileSync(join(workDir, REVISE_COUNT), '0\n'));
    if (topic && inputFile) fail('XOR violation: both topic and input_file set');
    if (!topic && !inputFile) fail('XOR violation: neither topic nor input_file set');
    if (requireVoiceProfile && !voiceProfile && !process.env.VOICEBOX_DEFAULT_PROFILE) {
        fail('missing voice_profile (set vars.voice_profile or VOICEBOX_DEFAULT_PROFILE)');
    }
    const briefPath = join(workDir, 'brief.md');
    if (isFile(briefPath) && force !== 'true') {
        fail(`initialization target already exists at ${workDirArg}/brief.md; pass force=true to replace`);
    }
    if (topic) {
        sted('write', briefPath, () => writeFileSync(briefPath, `${topic}\n`));
    } else {
        if (!isFile(inputFile)) fail(`input file not found: ${inputFile}`);
        sted('cp', inputFile, () => copyFileSync(inputFile, briefPath));
    }
    if (!reviseCountEarly)
        sted('write', join(workDir, REVISE_COUNT), () => writeFileSync(join(workDir, REVISE_COUNT), '0\n'));
}

function prepareItc(args: string[]): void {
    const [workDirArg = '', topic = '', inputFile = '', force = 'false'] = args;
    prepareWorkspace({
        workDirArg,
        topic,
        inputFile,
        force,
        dirs: ['2-outline'],
        voiceProfile: '',
        requireVoiceProfile: false,
        reviseCountEarly: true,
    });
}

function prepareSolo(args: string[]): void {
    const [workDirArg = '', topic = '', inputFile = '', voiceProfile = '', force = 'false'] = args;
    prepareWorkspace({
        workDirArg,
        topic,
        inputFile,
        force,
        dirs: ['2-outline', '4-audio'],
        voiceProfile,
        requireVoiceProfile: true,
        reviseCountEarly: false,
    });
}

/**
 * STORM prepare: sentence mode writes topic.json; file mode copies input.md and derives the
 * local-doc entry + topic.json query from the file's H1 (0056 works layout).
 */
function prepareStorm(args: string[]): void {
    const [workDirArg = '', topic = '', inputFile = '', maxResultsRaw = '8', fixture = 'false'] = args;
    if (!workDirArg) fail('missing work_dir');
    const workDir = resolve(workDirArg);
    sted('mkdir', workDir, () => mkdirSync(workDir, { recursive: true }));
    if (topic && inputFile) fail('XOR violation: both topic and input_file set');
    if (!topic && !inputFile) fail('XOR violation: neither topic nor input_file set');
    // `jq`'s `tonumber` grammar (`+8`, `8.`, `.5`, `1e3` yes; `0x10`, surrounding whitespace, empty no),
    // with three deliberate divergences: jq echoed the lexeme it parsed (`8.0`, `1E+3`) where this
    // writes the equivalent JS number; jq accepted the C-float specials `inf`/`Infinity`/`nan` (writing
    // ±1.797e308 and `null`) where this rejects them; and jq accepted `1e400` (writing `1E+400`) where
    // this fails loud rather than emitting a non-finite value.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(maxResultsRaw)) {
        fail(`invalid maxResults: ${maxResultsRaw}`);
    }
    const maxResults = Number(maxResultsRaw);
    if (!Number.isFinite(maxResults)) fail(`invalid maxResults: ${maxResultsRaw}`);
    const topicFile = (query: string): Record<string, unknown> => ({
        topic: query,
        maxResults,
        fixture: fixture === 'true',
    });

    if (topic) {
        writeJson(join(workDir, 'topic.json'), topicFile(topic));
        return;
    }
    if (!isFile(inputFile)) fail(`input_file not readable: ${inputFile}`);
    sted('cp', inputFile, () => copyFileSync(inputFile, join(workDir, 'input.md')));
    const body = readFileSync(inputFile, 'utf-8');
    const heading = body.split('\n').find((line) => line.startsWith('# '));
    let query = heading === undefined ? '' : heading.replace(/^# */, '');
    if (!query) query = basename(inputFile).replace(/\.[^.]*$/, '');
    if (!query) fail('no query derivable (no H1 and empty basename)');
    // A relative input_file must hash the same file:// URI the shell's logical `$PWD` produced.
    const absolute = join(resolve(logicalCwd(), dirname(inputFile)), basename(inputFile));
    const sourceUri = `file://${absolute}`;
    writeJson(join(workDir, 'local-doc.json'), {
        id: createHash('sha256').update(sourceUri).digest('hex').slice(0, 16),
        // `$(cat file)` drops every trailing newline before jq receives the body.
        body: body.replace(/\n+$/, ''),
        title: query,
        sourceUri,
        mediaType: 'text/markdown',
        metadata: { query, rank: -1, position: 0 },
    });
    writeJson(join(workDir, 'topic.json'), topicFile(query));
}

function duration(args: string[]): void {
    const [workDirArg = '', targetDurationMin = ''] = args;
    if (!workDirArg) fail('missing work_dir');
    const targetMinutes = Number(targetDurationMin);
    if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) {
        fail(`invalid target_duration_min: ${targetDurationMin || '(empty)'}`);
    }
    const workDir = resolve(workDirArg);
    const okPath = join(workDir, '4-audio', '.duration-ok');
    const contentPath = join(workDir, '4-audio', 'content.json');
    // `rm -f <path>`: silent when the file is already gone, loud with the errno otherwise.
    try {
        unlinkSync(okPath);
    } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') sted('rm', okPath, () => unlinkSync(okPath));
    }
    if (!isFile(contentPath)) return;

    let raw: unknown;
    try {
        const parsed = JSON.parse(readFileSync(contentPath, 'utf-8')) as { metadata?: { duration?: unknown } };
        raw = parsed.metadata?.duration;
    } catch (error) {
        // A parse failure is "not a number"; an unreadable file is a real error — re-read inside the
        // wrapper so the errno (EACCES/EIO) is reported instead of being swallowed as missing data.
        if ((error as { code?: string }).code !== undefined) {
            sted('read', contentPath, () => readFileSync(contentPath, 'utf-8'));
        }
        raw = undefined;
    }
    // A numeric string is a number for this gate (`jq` + `awk` read it that way); anything else that
    // is not a finite number takes the "missing or not a number" branch its own message promises.
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(numeric)) {
        sted('write', join(workDir, '.duration-feedback'), () =>
            writeFileSync(
                join(workDir, '.duration-feedback'),
                'Regenerate: audio metadata.duration missing or not a number.\n',
            ),
        );
        bumpReviseCount(workDir);
        return;
    }
    const targetSeconds = targetMinutes * 60;
    if (numeric >= targetSeconds * 0.5 && numeric <= targetSeconds * 2) {
        sted('touch', okPath, () => writeFileSync(okPath, ''));
        return;
    }
    // `printf '%s' "$dur"` echoed the raw token; keep it (a numeric string like "1200.0" stays so).
    const shown = typeof raw === 'string' ? raw : String(numeric);
    sted('write', join(workDir, '.duration-feedback'), () =>
        writeFileSync(
            join(workDir, '.duration-feedback'),
            `Regenerate: last audio duration ${shown}s outside 0.5x–2x of ${targetSeconds}s; adjust segment lengths toward the target.\n`,
        ),
    );
    bumpReviseCount(workDir);
}

/**
 * Positional override (arg 0) + `--flag value` options, for the delegating stages. Scanned by hand
 * rather than with `node:util`'s `parseArgs`: a workflow var may legitimately hold a path that starts
 * with `-` (e.g. `-x`), which `parseArgs` would treat as an option and throw on — the pre-0132 shell
 * chain treated it as a path, fell through the `[ -f ]` test, and kept working.
 */
function parseStage(
    rest: string[],
    options: Record<string, { type: 'string' }>,
): { override: string; values: Record<string, string | undefined> } {
    const values: Record<string, string | undefined> = {};
    let override = '';
    for (let i = 0; i < rest.length; i++) {
        const token = rest[i] ?? '';
        const flag = token.startsWith('--') ? token.slice(2) : '';
        if (flag !== '') {
            // Split on the FIRST `=`: a value may contain one (`--in=/tmp/a=b.yaml`).
            const eq = flag.indexOf('=');
            const name = eq < 0 ? flag : flag.slice(0, eq);
            if (!Object.hasOwn(options, name)) fail(`unknown option: ${token}`);
            values[name] = eq < 0 ? (rest[++i] ?? '') : flag.slice(eq + 1);
            continue;
        }
        if (override === '') override = token;
    }
    return { override, values };
}

// ─── kk-daily-ai-voice stages (0133) ─────────────────────────────────────────────────────────────
// Ported one-for-one from plugins/kk/workflows/kk-daily-ai-voice.yaml. Every ported stage keeps its
// step-timing append (success AND failure), its cache predicate and message, the plugins-path argv,
// and the plugin argv/env it used. `kk` is resolved from PATH, exactly as the shell did. Stages whose
// inline body already fits the ADR-115 budget (`collect:onEnter:0`'s fan-in at 7 commands, the HITL/prompt states)
// deliberately stay in the YAML.

const DAILY_DIRS = [
    '1-ingest',
    '2-facts',
    '2-plan',
    '2-article',
    '2-cover',
    '2-xhs',
    '2-script',
    '3-audio',
    '3-publish',
] as const;

/** `date -u +%FT%TZ` — the timestamp grammar the step-timing lines have always used. */
function utcStamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The pre-0133 shell wrapped every daily step in `trap … EXIT`, so the timing line lands on failure
 * too. The body signals failure by throwing `failWith`, never by calling `process.exit` directly.
 */
class StageFailure extends Error {
    constructor(
        readonly status: number,
        readonly named: boolean,
        message: string,
    ) {
        super(message);
    }
}

function failWith(status: number, message?: string): never {
    throw new StageFailure(status, message !== undefined, message ?? `stage failed (status ${status})`);
}

function appendTiming(workDir: string, step: string, startedAt: string): void {
    if (!workDir) return;
    try {
        appendFileSync(
            join(workDir, 'step-timing.json'),
            `${JSON.stringify({ step, startedAt, endedAt: utcStamp() })}\n`,
        );
    } catch {
        // The shell trap was best-effort too: a missing/unwritable work_dir never failed the step.
    }
}

function timed(workDir: string, step: string, body: () => void): void {
    const startedAt = utcStamp();
    let status = 0;
    try {
        body();
    } catch (error) {
        if (error instanceof StageFailure) {
            if (error.named) console.error(error.message);
            status = error.status;
        } else {
            console.error((error as Error).message);
            status = 1;
        }
    } finally {
        appendTiming(workDir, step, startedAt);
    }
    if (status !== 0) process.exit(status);
}

function pluginsArgs(pluginsPath: string): string[] {
    return pluginsPath === '' ? [] : ['--plugins-path', pluginsPath];
}

/** `kk <args>` with the caller's env overrides; `soft` mirrors the shell's `|| true`. */
// spur --async exports SPUR_EXPECTED_DEFINITION_DIGEST (its own worker's identity binding) into
// every descendant env; a nested `spur workflow run` — postsurfing's publishing workflow under
// surfdash-pub — resolves a DIFFERENT digest and refuses to start. Strip both launcher vars at
// the nested-spur boundary (SPUR_WORKFLOW_RUN_ACTIVE is the older sibling guard, task 0133-era).
const NESTED_SPUR_UNSET = ['SPUR_WORKFLOW_RUN_ACTIVE', 'SPUR_EXPECTED_DEFINITION_DIGEST'] as const;

function kk(
    args: string[],
    options: { env?: Record<string, string>; unset?: readonly string[]; soft?: boolean } = {},
): number {
    const env = { ...process.env, ...(options.env ?? {}) };
    for (const name of options.unset ?? []) delete env[name];
    const runner = spawnSync('kk', args, { stdio: 'inherit', env });
    if (runner.error !== undefined) {
        // A missing/un-launchable `kk` is not a plugin failure: the pre-0133 shell reported
        // `kk: command not found` and exited 127. `soft` callers tolerate a *plugin* failure, not
        // an unusable environment — the operator must still see why nothing ran.
        console.error(`kk: ${runner.error.message}`);
        failWith(127);
    }
    const status = runner.status ?? 1;
    if (status !== 0 && options.soft !== true) failWith(status);
    return status;
}

function writeJsonText(path: string, value: unknown): void {
    // `Bun.write(path, JSON.stringify(value, null, 2))` — no trailing newline.
    writeFileSync(path, JSON.stringify(value, null, 2));
}

function writeJqText(path: string, value: unknown): void {
    // `jq … > path` — pretty output WITH the trailing newline jq always prints.
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeRaw(path: string, value: string): void {
    // `printf '%s' … > path` / `bun -e 'Bun.write'` — no trailing newline.
    writeFileSync(path, value);
}

function readJson(path: string): Record<string, unknown> | null {
    if (!isFile(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function metadataOf(value: Record<string, unknown> | null): Record<string, unknown> {
    const metadata = value?.metadata;
    return metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

/**
 * Required stage input: a missing or unparsable file fails the stage naming the path, so a
 * run-date/path mismatch surfaces as its real cause instead of a downstream "field missing" error.
 */
function requireJson(path: string, label: string): Record<string, unknown> {
    const parsed = readJson(path);
    if (parsed === null) failWith(1, `${label}: required input not found or unparsable: ${path}`);
    return parsed;
}

/** `jq -e '.targets[]? | select(.target == t and .ok == true and .status == "published")'`. */
function targetPublished(path: string, target: string): boolean {
    const parsed = readJson(path);
    const targets = parsed?.targets;
    if (!Array.isArray(targets)) return false;
    return targets.some(
        (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            (entry as Record<string, unknown>).target === target &&
            (entry as Record<string, unknown>).ok === true &&
            (entry as Record<string, unknown>).status === 'published',
    );
}

function dailyPrepare(args: string[]): void {
    const [
        workDirArg = '',
        limit = '',
        cursor = '',
        stateFile = '',
        last30daysEnabled = '',
        topic = '',
        horizonHours = '',
        runDateArg = '',
    ] = args;
    // Empty work_dir composes the real workspace from the operator's works_dir
    // (workflow-run.md §2 precedence: KK_WORKS_DIR > config works_dir > ~/.config/kk/works):
    //   $works_dir/kk-daily-ai-voice/<stamp>
    // The stamp is digits-only (dashes stripped from the caller's run_date, else today) so a
    // resumed/retried run whose persisted run_date var already carries the digits-only
    // run-date.txt value re-derives the same directory.
    const dirDate = runDateArg ? runDateArg.replaceAll('-', '') : formatRunDate();
    const workDir = resolve(workDirArg || join(resolveWorksDir(), 'kk-daily-ai-voice', dirDate));
    timed(workDir, 'prepare', () => {
        for (const dir of DAILY_DIRS)
            sted('mkdir', join(workDir, dir), () => mkdirSync(join(workDir, dir), { recursive: true }));
        sted('write', join(workDir, 'run-date.txt'), () =>
            writeFileSync(join(workDir, 'run-date.txt'), `${dirDate}\n`),
        );
        // Anchor for the workflow: shell actions cannot set vars, so the YAML reads the
        // effective work_dir back into vars.work_dir from this cwd-relative file.
        const anchorDir = join('.spur', 'runs', 'kk-daily-ai-voice');
        sted('write', join(anchorDir, 'work-dir.txt'), () => {
            mkdirSync(anchorDir, { recursive: true });
            writeFileSync(join(anchorDir, 'work-dir.txt'), `${workDir}\n`);
        });
        sted('write', join(workDir, '1-ingest/source.json'), () =>
            writeJsonText(join(workDir, '1-ingest/source.json'), {
                limit: Number(limit),
                cursor: cursor === '' ? undefined : cursor,
                stateFile: stateFile === '' ? undefined : stateFile,
            }),
        );
        if (last30daysEnabled !== 'true') {
            sted('write', join(workDir, '1-ingest/last30days-docs.json'), () =>
                writeFileSync(join(workDir, '1-ingest/last30days-docs.json'), '[]'),
            );
        }
        sted('write', join(workDir, '1-ingest/last30days.json'), () =>
            writeJsonText(join(workDir, '1-ingest/last30days.json'), { topic }),
        );
        sted('write', join(workDir, '1-ingest/horizon.json'), () =>
            writeJsonText(join(workDir, '1-ingest/horizon.json'), { hours: Number(horizonHours) }),
        );
    });
}

/** `date +%Y%m%d` — the run-date stamp the artifact names carry. */
function formatRunDate(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

/** Expand the `~/` and `$HOME/` prefixes the config examples use. */
function expandHome(p: string): string {
    if (p.startsWith('~/')) return join(homedir(), p.slice(2));
    if (p.startsWith('$HOME/')) return join(homedir(), p.slice('$HOME/'.length));
    return p;
}

/**
 * works_dir for composed daily workspaces — workflow-run.md §2 precedence:
 * KK_WORKS_DIR env > config works_dir > compiled default ~/.config/kk/works.
 * Unreadable/unparseable config falls through to the default (pluginEnvFromConfig
 * tolerates the same), never fails the run.
 */
function resolveWorksDir(): string {
    const fromEnv = process.env.KK_WORKS_DIR;
    if (fromEnv) return fromEnv;
    const configPath = process.env.KK_CONFIG || join(homedir(), '.config/kk/config.yaml');
    if (existsSync(configPath)) {
        try {
            const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown> | null;
            const worksDir = parsed !== null && typeof parsed === 'object' ? parsed.works_dir : undefined;
            if (typeof worksDir === 'string' && worksDir !== '') return expandHome(worksDir);
        } catch {
            // fall through to the compiled default
        }
    }
    return join(homedir(), '.config/kk/works');
}

function dailyCollectFacts(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const content = join(workDir, '2-facts', `${runDate}_02_collect_content.json`);
    const facts = join(workDir, '2-facts', `${runDate}_02_collect_core-facts.md`);
    const blended = join(workDir, '1-ingest', `${runDate}_02_collect_blended.json`);
    timed(workDir, 'collect', () => {
        if (isFile(content) && isFile(facts)) {
            console.log(`core facts cached: ${facts}`);
            return;
        }
        kk(['executor', 'run', 'core-facts-gen', '--in', blended, '--out', content, ...pluginsArgs(pluginsPath)]);
        const body = readJson(content)?.body;
        if (typeof body !== 'string') failWith(1, `collect: ${content} has no string body`);
        sted('write', facts, () => writeRaw(facts, body));
    });
}

function dailyPlan(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', planMaxItems = ''] = args;
    const planContent = join(workDir, '2-plan', `${runDate}_03_plan_content.json`);
    const planDocs = join(workDir, '2-plan', `${runDate}_03_plan_plan.json`);
    const blended = join(workDir, '1-ingest', `${runDate}_02_collect_blended.json`);
    timed(workDir, 'plan', () => {
        if (isFile(planDocs)) {
            console.log(`plan cached: ${planDocs}`);
            return;
        }
        kk(
            ['executor', 'run', 'episode-plan-gen', '--in', blended, '--out', planContent, ...pluginsArgs(pluginsPath)],
            {
                env: { EPISODE_PLAN_MAX_ITEMS: planMaxItems, EPISODE_PLAN_DATE: runDate },
            },
        );
        const docs = metadataOf(readJson(planContent)).docs;
        if (!Array.isArray(docs) || docs.length === 0) failWith(1, 'plan: content.metadata.docs missing or empty');
        sted('write', planDocs, () => writeJsonText(planDocs, docs));
        if (!isFile(planDocs)) failWith(1, `plan: ${planDocs} not written after episode-plan-gen`);
    });
}

function dailyQcContent(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        qcCategories = '',
        minQuality = '',
        minImportance = '',
        minUrgency = '',
        minImpact = '',
    ] = args;
    const candidates = join(workDir, '2-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const annotated = join(workDir, '2-plan', `${runDate}_04_quality-control-content_annotated.json`);
    const planContent = join(workDir, '2-plan', `${runDate}_03_plan_content.json`);
    timed(workDir, 'quality-control-content', () => {
        if (isFile(candidates)) {
            console.log(`candidates cached: ${candidates}`);
            return;
        }
        sted('write', annotated, () => writeJqText(annotated, metadataOf(readJson(planContent)).docs ?? null));
        kk(
            [
                'executor',
                'run',
                'episode-plan-gen',
                '--in',
                annotated,
                '--out',
                candidates,
                ...pluginsArgs(pluginsPath),
            ],
            {
                env: {
                    EPISODE_PLAN_MODE: 'filter',
                    QC_CATEGORIES: qcCategories,
                    QC_MIN_QUALITY: minQuality,
                    QC_MIN_IMPORTANCE: minImportance,
                    QC_MIN_URGENCY: minUrgency,
                    QC_MIN_IMPACT: minImpact,
                },
            },
        );
    });
}

/**
 * Character-bigram Jaccard over whitespace-normalized, lowercased titles — the twin of
 * episode-plan-gen's `titleSimilarity`. Duplicated on purpose: this file is node-builtins-only
 * (no workspace imports), so it cannot reach that module.
 */
function titleSimilarity(a: string, b: string): number {
    const bigrams = (text: string): Set<string> => {
        const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
        const out = new Set<string>();
        for (let i = 0; i < normalized.length - 1; i++) out.add(normalized.slice(i, i + 2));
        return out;
    };
    const aGrams = bigrams(a);
    const bGrams = bigrams(b);
    if (aGrams.size === 0 || bGrams.size === 0) return 0;
    let intersection = 0;
    for (const gram of aGrams) if (bGrams.has(gram)) intersection++;
    return intersection / (aGrams.size + bGrams.size - intersection);
}

/**
 * Post-translation near-duplicate dedup (task 0138 R3): drop any plan item whose title is a
 * >=DEDUP_TITLE_THRESHOLD bigram match for an EARLIER item, so curated plan order decides the
 * survivor. It runs on the translated plan because cross-language near-dups are invisible before
 * plan-translate (the 2026-09-16 Gemini pair measures 0.208 mixed-language, 0.417 all-zh).
 */
export function dedupPlanByTitle<T extends { id?: unknown; title?: unknown }>(
    docs: T[],
): { kept: T[]; dropped: string[] } {
    const kept: T[] = [];
    const dropped: string[] = [];
    for (const doc of docs) {
        const title = typeof doc.title === 'string' ? doc.title : '';
        const duplicate =
            title !== '' &&
            kept.some((earlier) => {
                const earlierTitle = typeof earlier.title === 'string' ? earlier.title : '';
                return titleSimilarity(earlierTitle, title) >= DEDUP_TITLE_THRESHOLD;
            });
        if (duplicate) {
            dropped.push(typeof doc.id === 'string' && doc.id !== '' ? doc.id : title);
            continue;
        }
        kept.push(doc);
    }
    return { kept, dropped };
}

/**
 * Run the VoiceScript content validator over a written script and fail the stage when it rejects
 * (task 0139 R3). `spawnSync` rather than `delegate` on purpose: `delegate` exits the process
 * directly, which would skip `timed`'s `finally` and lose the step-timing entry the run report
 * reads. The sidecar's own stderr carries `content check failed: segment <idx> …`; this adds the
 * stage-level naming so the operator sees which artifact was rejected.
 */
function assertScriptContent(scriptPath: string): void {
    // `spawnSync` + `failWith`, deliberately NOT `delegate`: delegate is `never`-returning (it calls
    // process.exit), so using it mid-function would abort the calling stage on SUCCESS — dailyWrapDocs
    // would exit before packaging its docs. A clean exit here falls through to the rest of the stage.
    const sidecar = requireSidecar('', VALIDATE_SIDECAR, 'validate_script');
    const runner = spawnSync(process.execPath, [sidecar, '--in', scriptPath], { stdio: 'inherit' });
    if (runner.status !== 0) {
        failWith(runner.status ?? 1, `script content check failed: ${scriptPath} was rejected (see above)`);
    }
}

function dailyArticle(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const articleMd = join(workDir, '2-article', `${runDate}_06_article_article.md`);
    const articleContent = join(workDir, '2-article', `${runDate}_06_article_content.json`);
    const planIn = join(workDir, '2-plan', `${runDate}_03_plan_plan.json`);
    const candidates = join(workDir, '2-plan', `${runDate}_04_quality-control-content_candidates.json`);
    timed(workDir, 'article', () => {
        let planUsable = true;
        const raw = isFile(planIn) ? readFileSync(planIn, 'utf-8') : '';
        try {
            JSON.parse(raw);
        } catch (error) {
            console.error(
                `article: plan.json invalid JSON — replacing with untranslated plan (downstream states read this file): ${(error as Error).message}`,
            );
            const docs = metadataOf(readJson(candidates)).docs;
            if (!Array.isArray(docs) || docs.length === 0) {
                console.error('article: candidates.json metadata.docs missing');
                planUsable = false;
            } else {
                sted('write', planIn, () => writeJsonText(planIn, docs));
            }
        }
        if (!planUsable) failWith(1, 'article: no usable plan input');
        // R3 (task 0138): dedup runs BEFORE the cache early-return — the script stage reads this same
        // plan.json and must see one survivor even when the article is already cached. Idempotent:
        // a no-op once the plan is deduped.
        const planParsed: unknown = readJson(planIn);
        if (Array.isArray(planParsed)) {
            const { kept, dropped } = dedupPlanByTitle(planParsed as Record<string, unknown>[]);
            if (dropped.length > 0) {
                sted('write', planIn, () => writeJsonText(planIn, kept));
                console.error(`article: dropped ${dropped.length} near-duplicate plan item(s): ${dropped.join(', ')}`);
            }
        }
        if (isFile(articleMd)) {
            console.log(`article cached: ${articleMd}`);
            return;
        }
        // Agent-written prose body (workflow `article-write` state) replaces the mechanical
        // per-item render when present — the 3-format split: surfdash gets an article,
        // not a news list (2026-09-16 feedback).
        const proseBody = join(workDir, '2-article', `${runDate}_06_article-write_body.md`);
        kk(
            [
                'executor',
                'run',
                'daily-article-gen',
                '--in',
                planIn,
                '--out',
                articleContent,
                ...pluginsArgs(pluginsPath),
            ],
            {
                env: {
                    ARTICLE_DATE: runDate,
                    // Plugin entries run with cwd = plugin dir (invoke.ts), so relative
                    // paths in env must be resolved or the plugin sees ENOENT.
                    ...(isFile(proseBody) ? { ARTICLE_BODY_FILE: resolve(proseBody) } : {}),
                },
            },
        );
        const body = readJson(articleContent)?.body;
        if (typeof body !== 'string') failWith(1, `article: ${articleContent} has no string body`);
        sted('write', articleMd, () => writeRaw(articleMd, body));
    });
}

/**
 * F614 R2/R4: validate the agent-written cover brief in the order R4 names — the first failing
 * check is the fallback reason; `reason: null` carries the trimmed subject.
 */
function coverBrief(briefPath: string): { reason: string | null; subject: string } {
    if (!isFile(briefPath)) return { reason: 'missing-brief', subject: '' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(briefPath, 'utf-8'));
    } catch {
        return { reason: 'invalid-json', subject: '' };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { reason: 'invalid-json', subject: '' };
    }
    const subject = (parsed as Record<string, unknown>).subject;
    if (typeof subject !== 'string') return { reason: 'no-subject', subject: '' };
    const trimmed = subject.trim();
    if (trimmed === '' || trimmed.length > COVER_SUBJECT_CAP) return { reason: 'subject-cap', subject: '' };
    return { reason: null, subject: trimmed };
}

/**
 * F614 R3: build the image-gen envelope from the day's cover brief and render it. The subject is
 * the only model-authored input (the workflow's brief agent.run wrote it); format, style,
 * provider and model are pinned by this stage so no caller can drift the look. A missing or
 * invalid brief degrades to the format's default subject (R4) — a plugin failure still fails
 * the stage, matching the pre-F614 cover behavior.
 */
function dailyCover(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', provider = '', model = '', fallback = ''] = args;
    const briefPath = join(workDir, '2-cover', `${runDate}_07_cover-brief.json`);
    const envPath = join(workDir, '2-cover', `${runDate}_07_cover_image-gen-in.json`);
    const contentOut = join(workDir, '2-cover', 'content.json');
    timed(workDir, 'cover', () => {
        const brief = coverBrief(briefPath);
        const vars: Record<string, string> = {};
        if (brief.reason !== null) {
            console.error(`cover brief: fallback (${brief.reason})`);
        } else {
            vars.subject = brief.subject;
        }
        const imageGen: Record<string, unknown> = {
            job: 'cover',
            format: COVER_FORMAT,
            style: COVER_STYLE,
            vars,
            maxImages: 1,
        };
        if (provider !== '') imageGen.provider = provider;
        if (model !== '') imageGen.model = model;
        // D6 0166 R7: runtime-fallback opt-in. '' (the shipped var default) keeps strict fail-fast —
        // F614's pinned look stays the default; 'true' = retry down AUTO_ORDER; anything else is a
        // comma-split, trimmed candidate list. Unknown names are rejected by image-gen, not here.
        if (fallback !== '') {
            imageGen.fallback =
                fallback === 'true'
                    ? true
                    : fallback
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
        }
        sted('write', envPath, () =>
            writeJsonText(envPath, [{ id: 'daily-cover', title: runDate, body: '', metadata: { imageGen } }]),
        );
        kk(['executor', 'run', 'image-gen', '--in', envPath, '--out', contentOut, ...pluginsArgs(pluginsPath)]);
    });
}

function dailyCoverNormalize(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    // The pre-0133 shell had no timing trap, so this stage is not `timed`; it still fails through
    // `failWith`, which needs the named-failure handling `timed` gives the other stages.
    try {
        coverNormalizeBody(workDir, runDate);
    } catch (error) {
        if (error instanceof StageFailure) {
            if (error.named) console.error(error.message);
            process.exit(error.status);
        }
        console.error((error as Error).message);
        process.exit(1);
    }
}

function coverNormalizeBody(workDir: string, runDate: string): void {
    // F614 R5: the artifact name follows the format preset (`<stem>-<format>-NN.<ext>`,
    // paths.ts), so normalize reads the path the plugin itself recorded in the manifest instead
    // of a hard-coded name. The legacy content-cover-01.{png,jpg} paths stay as stale cleanup.
    const legacyPng = join(workDir, '2-cover', 'content-cover-01.png');
    const legacyJpg = join(workDir, '2-cover', 'content-cover-01.jpg');
    // Must match the name dailyPublishPrep and the article->cover workflow guard read:
    // `${runDate}_07_cover_cover.png` (a plain `cover-${runDate}.png` left options.coverPath
    // undefined and silently dropped the cover from both podcast and surfdash — 2026-09-16 run).
    const out = join(workDir, '2-cover', `${runDate}_07_cover_cover.png`);
    const images = metadataOf(readJson(join(workDir, '2-cover', 'content.json'))).images;
    const first = Array.isArray(images) ? images[0] : undefined;
    const recorded =
        first !== null && typeof first === 'object' && typeof (first as Record<string, unknown>).path === 'string'
            ? ((first as Record<string, unknown>).path as string)
            : '';
    if (recorded === '' || !isFile(recorded)) {
        failWith(1, 'cover normalize: no image artifact in 2-cover/content.json');
    }
    const source = recorded;
    if (source.endsWith('.jpg') || source.endsWith('.jpeg')) {
        const sips = spawnSync('sips', ['-s', 'format', 'png', source, '--out', out], { stdio: 'ignore' });
        // Bun reports a missing binary as `status: undefined` (older versions: `null`) plus an
        // `error` object — the pre-0133 shell's `command -v sips` failed the same way.
        if (sips.error !== undefined || typeof sips.status !== 'number') {
            failWith(1, 'cover normalize: sips not found; cannot transcode jpg -> png');
        }
        if (sips.status !== 0) {
            failWith(1, `cover normalize: sips failed (status ${sips.status}); jpg -> png did not run`);
        }
    } else {
        sted('mv', source, () => renameSync(source, out));
    }
    for (const stale of new Set([legacyJpg, legacyPng, source])) {
        try {
            unlinkSync(stale);
        } catch {
            // `rm -f` is silent when the file is already gone (a renamed source lands here too).
        }
    }
    console.log(`cover normalized: ${runDate}_07_cover_cover.png`);
}

/** `metadata.images[0]` — the artifact the image-gen plugin recorded for one render. */
function firstArtifact(content: Record<string, unknown> | null): Record<string, unknown> | null {
    const images = metadataOf(content).images;
    const first = Array.isArray(images) ? images[0] : undefined;
    return first !== null && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}

/**
 * E8: validate the agent-written XHS card plan. The plan is the only model-authored input —
 * format, style, provider and model are pinned by `dailyXhsRender`, matching F614's cover. Every
 * check fails loud naming the field, so an unusable plan skips the XHS target visibly instead of
 * publishing a partial card series (the owning state carries `onError: continue`).
 */
function xhsPlan(planPath: string, count: number): { title: string; body: string; cards: XhsCard[] } {
    const parsed = requireJson(planPath, 'xhs plan');
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    if (title === '' || title.length > XHS_TITLE_CAP) {
        failWith(1, `xhs plan: title must be 1..${XHS_TITLE_CAP} chars, got ${title.length}`);
    }
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
    if (body === '' || body.length > XHS_BODY_CAP) {
        failWith(1, `xhs plan: body must be 1..${XHS_BODY_CAP} chars, got ${body.length}`);
    }
    const raw = parsed.cards;
    if (!Array.isArray(raw) || raw.length !== count) {
        failWith(1, `xhs plan: expected ${count} cards (xhs_cards), got ${Array.isArray(raw) ? raw.length : 0}`);
    }
    const cards = raw.map((entry, position): XhsCard => {
        const card = (entry !== null && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const label = `xhs plan: card ${position + 1}`;
        const text = (key: string): string => {
            const value = card[key];
            if (typeof value !== 'string' || value.trim() === '') failWith(1, `${label} needs a non-empty '${key}'`);
            return value.trim();
        };
        const role = text('role');
        if (!XHS_ROLES.includes(role)) {
            failWith(1, `${label} role must be one of ${XHS_ROLES.join('|')}, got '${role}'`);
        }
        if (position === 0 && role !== 'cover') failWith(1, `${label} must be role 'cover' (the series opens on it)`);
        const points = card.points;
        if (!Array.isArray(points) || points.length < 1 || points.length > 4) {
            failWith(1, `${label} needs 1..4 'points', got ${Array.isArray(points) ? points.length : 0}`);
        }
        const bullets = points.map((point) => {
            if (typeof point !== 'string' || point.trim() === '') failWith(1, `${label} has an empty point`);
            return point.trim();
        });
        return {
            index: `${position + 1}`.padStart(2, '0'),
            role,
            copy: text('copy'),
            points: bullets,
            layout: text('layout'),
            subject: text('subject'),
            sourcePoint: text('sourcePoint'),
        };
    });
    return { title, body, cards };
}

/**
 * E8: build one `image-gen` envelope per planned card, render them sequentially, and package the
 * ordered card manifest + `Content` that `xhs-pub` consumes. Format, style, provider and model
 * are pinned here (never model-authored), so the series cannot drift from its preset. Resume-safe:
 * a card whose recorded artifact is still on disk is not re-rendered — and not re-billed.
 */
function dailyXhsRender(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', countArg = '', style = '', provider = '', model = ''] = args;
    const count = Number.parseInt(countArg, 10);
    const planPath = join(workDir, '2-xhs', `${runDate}_18_xhs_plan.json`);
    const cardsDir = join(workDir, '2-xhs', 'cards');
    const manifestPath = join(workDir, '2-xhs', 'cards.json');
    const contentPath = join(workDir, '2-xhs', 'content.json');
    timed(workDir, 'xhs-render', () => {
        if (!Number.isInteger(count) || count < 1 || count > XHS_MAX_CARDS) {
            failWith(1, `xhs render: xhs_cards must be 1..${XHS_MAX_CARDS}, got '${countArg}'`);
        }
        const plan = xhsPlan(planPath, count);
        sted('mkdir', cardsDir, () => mkdirSync(cardsDir, { recursive: true }));
        const images: Record<string, unknown>[] = [];
        const cards: Record<string, unknown>[] = [];
        for (const card of plan.cards) {
            const out = join(cardsDir, `card-${card.index}.json`);
            const promptPath = join(cardsDir, `card-${card.index}.prompt.txt`);
            let artifact = firstArtifact(readJson(out));
            if (artifact === null || !isFile(typeof artifact.path === 'string' ? artifact.path : '')) {
                const envPath = join(cardsDir, `card-${card.index}.in.json`);
                const imageGen: Record<string, unknown> = {
                    job: 'free',
                    format: XHS_FORMAT,
                    style,
                    vars: {
                        role: card.role,
                        layout: card.layout,
                        headline: card.copy,
                        points: card.points.join('\n'),
                        subject: card.subject,
                        language: '简体中文',
                        index: card.index,
                    },
                    maxImages: 1,
                };
                if (provider !== '') imageGen.provider = provider;
                if (model !== '') imageGen.model = model;
                sted('write', envPath, () =>
                    writeJsonText(envPath, [
                        { id: `xhs-card-${card.index}`, title: runDate, body: '', metadata: { imageGen } },
                    ]),
                );
                // Sequential on purpose: one provider call per card, and the first failure stops
                // the spend — later cards stay unrendered for a resume run to pick up.
                kk(['executor', 'run', 'image-gen', '--in', envPath, '--out', out, ...pluginsArgs(pluginsPath)]);
                artifact = firstArtifact(requireJson(out, 'xhs render'));
            }
            if (artifact === null) failWith(1, `xhs render: card ${card.index} recorded no image artifact (${out})`);
            const recorded = artifact.path;
            if (typeof recorded !== 'string' || !isFile(recorded)) {
                failWith(1, `xhs render: card ${card.index} image artifact is not on disk: '${String(recorded)}'`);
            }
            // `image-gen` writes the artifact beside `--out`; the publisher requires absolute paths.
            const imagePath = resolve(recorded);
            sted('write', promptPath, () =>
                writeRaw(promptPath, typeof artifact.prompt === 'string' ? artifact.prompt : ''),
            );
            images.push({ ...artifact, path: imagePath });
            cards.push({
                index: card.index,
                role: card.role,
                sourcePoint: card.sourcePoint,
                copy: card.copy,
                layout: card.layout,
                promptPath,
                imagePath,
                status: 'rendered',
            });
        }
        sted('write', manifestPath, () => writeJsonText(manifestPath, { source: planPath, cards }));
        sted('write', contentPath, () =>
            writeJsonText(contentPath, {
                title: plan.title,
                body: plan.body,
                format: 'text',
                metadata: { images, publishStatus: 'draft' },
            }),
        );
        console.log(`xhs render: ${cards.length} cards packaged in card order (${contentPath})`);
    });
}

/** A single-target xhs Result, not the fan-out aggregate: `ok` plus `metadata.publishStatus`. */
function xhsStatus(path: string): string {
    const parsed = readJson(path);
    if (parsed?.ok !== true) return '';
    const status = metadataOf(parsed).publishStatus;
    return status === 'public' || status === 'draft' ? status : '';
}

/**
 * E8: publish the packaged card series through `xhs-pub`'s script driver. Draft by default; live
 * only on an explicit launch-time `xhs_live=true` (ADR-022 — an unattended run never posts live on
 * its own). Non-blocking by operator decision: a missing/expired XHS session or a changed console
 * logs a loud failure and leaves the run alive, and the outcome never enters `publish_status`
 * (surfdash + podcast remain the episode's publication contract).
 */
function dailyPublishXhs(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', live = 'false'] = args;
    const content = join(workDir, '2-xhs', 'content.json');
    const input = join(workDir, '3-publish', `${runDate}_19_publish-xhs_content.json`);
    const result = join(workDir, '3-publish', `${runDate}_19_publish-xhs_result.json`);
    const want = live === 'true' ? 'public' : 'draft';
    timed(workDir, 'publish-xhs', () => {
        // Cache on the *requested* status: a cached draft must not silently satisfy a later
        // xhs_live=true re-run (that would report a live post that never happened).
        if (xhsStatus(result) === want) {
            console.log(`publish-xhs cached: ${want} already recorded in ${result}`);
            return;
        }
        if (!isFile(content)) {
            console.log(`publish-xhs: no card series at ${content} (render packaged none) — skip`);
            return;
        }
        const packaged = requireJson(content, 'publish-xhs');
        sted('write', input, () =>
            writeJsonText(input, { ...packaged, metadata: { ...metadataOf(packaged), publishStatus: want } }),
        );
        // `soft` keeps the XHS target non-blocking: the plugin still writes its own failed Result
        // and prints the failing step (login gate, upload, body, submit control), which is what the
        // operator needs to re-run — never a silent skip.
        const status = kk(['executor', 'run', 'xhs-pub', '--in', input, '--out', result, ...pluginsArgs(pluginsPath)], {
            soft: true,
        });
        console.log(
            status === 0
                ? `publish-xhs: ${want} dispatched; outcome recorded in ${result}`
                : `WARNING: publish-xhs — xhs-pub exited ${status}; XHS target skipped (run continues, see ${result})`,
        );
    });
}

/**
 * F613 R1: snapshot the shipped style contract into the run's work dir. Spur workflows have no
 * workflow-dir var, so the script-write prompt reads this copy — and the snapshot freezes the
 * exact contract the run's plan was written against. Idempotent (an existing snapshot is kept);
 * a missing sidecar is a broken install, so `requireSidecar` fails loud.
 */
function dailyScriptStyle(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const snapshot = join(workDir, '2-script', `${runDate}_08_script-write_style.md`);
    if (isFile(snapshot)) {
        console.log(`script style cached: ${snapshot}`);
        return;
    }
    const sidecar = requireSidecar('', STYLE_SIDECAR, 'daily-voice-style');
    const scriptDir = join(workDir, '2-script');
    sted('mkdir', scriptDir, () => mkdirSync(scriptDir, { recursive: true }));
    sted('cp', snapshot, () => copyFileSync(sidecar, snapshot));
    console.log(`script style snapshot: ${snapshot}`);
}

function dailyScript(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', language = '', title = '', voiceProfile = ''] = args;
    const yamlOut = join(workDir, '2-script', `${runDate}_08_script_voicescript.yaml`);
    const contentOut = join(workDir, '2-script', `${runDate}_08_script_content.json`);
    const planIn = join(workDir, '2-plan', `${runDate}_03_plan_plan.json`);
    timed(workDir, 'script', () => {
        if (isFile(yamlOut)) {
            console.log(`voicescript capped by plan: ${yamlOut}`);
            return;
        }
        kk(['executor', 'run', 'dailynews-gen', '--in', planIn, '--out', contentOut, ...pluginsArgs(pluginsPath)], {
            env: {
                DAILYNEWS_LANGUAGE: language,
                DAILYNEWS_TITLE: title,
                VOICEBOX_DEFAULT_PROFILE: voiceProfile,
                // F613 R4: always passed as absolute paths — spawnPluginEntry runs plugins with
                // cwd = the plugin package dir, so a relative workDir would silently miss the
                // plan; a plan file absent at build time reports missing-plan (template fallback).
                DAILYNEWS_SCRIPT_PLAN: resolve(join(workDir, '2-script', `${runDate}_08_script-write_plan.json`)),
                DAILYNEWS_STYLE_FILE: resolve(resolveSidecar('', STYLE_SIDECAR)),
            },
        });
        const body = readJson(contentOut)?.body;
        if (typeof body !== 'string') failWith(1, `script: ${contentOut} has no string body`);
        sted('write', yamlOut, () => writeRaw(yamlOut, body));
        // R3 (task 0139): fresh writes are validated here; the script cache path is covered by
        // wrap-docs, which runs on every path that reaches audio.
        try {
            assertScriptContent(yamlOut);
        } catch (err) {
            // A rejected fresh write would otherwise poison the isFile(yamlOut) cache: every
            // resume skips regeneration and re-fails at wrap-docs. Drop it so retry regenerates.
            unlinkSync(yamlOut);
            throw err;
        }
    });
}

function dailyWrapDocs(args: string[]): void {
    const [workDir = '', runDate = '', voiceProfile = ''] = args;
    const scriptPath = join(workDir, '2-script', `${runDate}_08_script_voicescript.yaml`);
    const docsPath = join(workDir, '3-audio', `${runDate}_10_wrap-docs_docs.json`);
    timed(workDir, 'wrap-docs', () => {
        // R3 (task 0139): the second validator placement — covers a HITL-edited YAML and the
        // script-stage cache path, neither of which re-enters dailyScript's fresh-write branch.
        assertScriptContent(scriptPath);
        const url = new URL(scriptPath, `file://${process.cwd()}/`);
        const body = readFileSync(decodeURIComponent(url.pathname), 'utf-8');
        const profile = voiceProfile || process.env.VOICEBOX_DEFAULT_PROFILE || 'robin-news';
        const doc = {
            id: createHash('sha256').update(url.href).digest('hex').slice(0, 16),
            title: 'Daily AI News VoiceScript',
            sourceUri: url.href,
            body,
            mediaType: 'application/yaml',
            metadata: { voiceProfile: profile },
        };
        sted('write', docsPath, () => writeJsonText(docsPath, [doc]));
    });
}

function dailyGenerate(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', transcodeMp3 = '', vdriver = ''] = args;
    // 20260917 review: the workflow picks a voice driver by short name; both drivers' envs are
    // passed unconditionally so switching `vdriver` needs no shell changes. Unknown -> fail loud.
    const VOICE_DRIVERS: Record<string, string> = {
        ominivoice: 'omni-voice-gen',
        voicebox: 'voice-gen',
        gemini: 'gemini-tts',
    };
    const voiceGenerator = VOICE_DRIVERS[vdriver];
    if (!voiceGenerator) {
        failWith(
            1,
            `generate: unknown vdriver '${vdriver}' (expected one of: ${Object.keys(VOICE_DRIVERS).join(', ')})`,
        );
    }
    const docs = join(workDir, '3-audio', `${runDate}_10_wrap-docs_docs.json`);
    const content = join(workDir, '3-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'generate', () => {
        if (isFile(content) && metadataOf(readJson(content)).qc !== undefined) {
            const qc = metadataOf(readJson(content)).qc as Record<string, unknown> | undefined;
            if (qc?.passed === true) {
                console.log(`audio cached: ${content} (QC passed)`);
                return;
            }
        }
        kk(['executor', 'run', voiceGenerator, '--in', docs, '--out', content, ...pluginsArgs(pluginsPath)], {
            env: { VOICE_GEN_MP3: transcodeMp3 },
        });
    });
}

/**
 * 20260917 review #7: prepend the show's 8s intro sting to the generated audio.
 * `intro_music` empty -> skip. Writes `<stem>.intro.wav` (original render kept), points
 * `audioPath` at the merged file, extends `duration`, marks `introMerged` (idempotent).
 */
function dailyIntro(args: string[]): void {
    const [workDir = '', runDate = '', introSrc = ''] = args;
    if (!introSrc || introSrc.trim() === '') {
        console.log('intro-music: intro_music var empty — skip');
        return;
    }
    const contentPath = join(workDir, '3-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'intro-music', () => {
        const content = requireJson(contentPath, 'intro-music');
        const meta = metadataOf(content);
        if (meta.introMerged === true) {
            console.log(`intro-music cached: ${contentPath}`);
            return;
        }
        // Merge from the raw lossless render; mp3Path is the derived publish artifact.
        // Preferring mp3Path here made `<stem>.mp3` the concat input while the output
        // suffix rewrite (`.wav` -> `.intro.wav`) no longer matched, so ffmpeg saw one
        // path as both input #1 and output and aborted with "same as Input #1".
        const candidates = [meta.audioPath, meta.mp3Path].filter(
            (candidate): candidate is string => typeof candidate === 'string' && candidate !== '',
        );
        const rawFile = candidates.find((candidate) => existsSync(resolve(candidate))) ?? candidates[0];
        if (rawFile === undefined) {
            failWith(1, 'intro-music: voice content carries no mp3Path/audioPath');
        }
        const introPath = resolve(introSrc);
        if (!existsSync(introPath)) failWith(1, `intro-music: intro file not found: ${introPath}`);
        const mainPath = resolve(rawFile);
        if (!existsSync(mainPath)) failWith(1, `intro-music: generated audio not found: ${mainPath}`);
        const mergedPath = `${mainPath.replace(/\.(wav|mp3)$/i, '')}.intro.wav`;
        const probe = (file: string, entries: string): string =>
            spawnSync('ffprobe', [
                '-v',
                'error',
                '-select_streams',
                'a:0',
                '-show_entries',
                entries,
                '-of',
                'csv=p=0',
                file,
            ])
                .stdout?.toString()
                .trim() ?? '';
        const mainDur = Number.parseFloat(probe(mainPath, 'format=duration'));
        const introDur = Number.parseFloat(probe(introPath, 'format=duration'));
        if (!Number.isFinite(mainDur) || !Number.isFinite(introDur)) {
            failWith(1, `intro-music: ffprobe could not read durations (main=${mainDur} intro=${introDur})`);
        }
        const rate = probe(mainPath, 'stream=sample_rate') || '24000'; // match the generated audio's rate; mono s16 both sides
        const norm = (label: string): string =>
            `[${label}:a]aresample=${rate},aformat=sample_fmts=s16:channel_layouts=mono[${label}]`;
        const fc = `${norm('0')};${norm('1')};[0][1]concat=n=2:v=0:a=1[out]`;
        const conv = spawnSync('ffmpeg', [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            introPath,
            '-i',
            mainPath,
            '-filter_complex',
            fc,
            '-map',
            '[out]',
            '-c:a',
            'pcm_s16le',
            mergedPath,
        ]);
        if (conv.status !== 0 || !existsSync(mergedPath)) {
            failWith(1, `intro-music: ffmpeg concat failed: ${conv.stderr?.toString().trim()}`);
        }
        if (meta.mp3Path && typeof meta.mp3Path === 'string') {
            // transcode_mp3=true: keep the mp3 path honest by re-transcoding the merged wav.
            const mp3 = spawnSync('ffmpeg', [
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-i',
                mergedPath,
                '-codec:a',
                'libmp3lame',
                '-qscale:a',
                '2',
                resolve(meta.mp3Path),
            ]);
            if (mp3.status !== 0) failWith(1, `intro-music: mp3 re-transcode failed: ${mp3.stderr?.toString().trim()}`);
        }
        const mergedDur = Number.parseFloat(probe(mergedPath, 'format=duration')) || mainDur + introDur;
        const updated = {
            ...content,
            metadata: {
                ...meta,
                audioPath: mergedPath,
                duration: mergedDur,
                introMerged: true,
            },
        };
        sted('write', contentPath, () => writeJsonText(contentPath, updated));
        console.log(
            `intro-music: merged ${introDur.toFixed(1)}s intro -> ${mergedPath} (${mergedDur.toFixed(1)}s total)`,
        );
    });
}

function dailyQualityReport(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const content = join(workDir, '3-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'quality-control', () => {
        const qc = metadataOf(readJson(content)).qc as Record<string, unknown> | undefined;
        console.log('=== Voice Quality Control Report ===');
        console.log(`Overall Score: ${qc ? qc.overallScore : 100}/100 | Passed: ${qc ? qc.passed : true}`);
        const issues = qc?.criticalIssues;
        if (Array.isArray(issues) && issues.length > 0) {
            console.warn(`QC Issues:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
        } else {
            console.log('All audio segments passed quality control checks cleanly.');
        }
    });
}

/**
 * 0171 R3: Apple Podcasts reads the enclosure's ID3 tags, so the published MP3 carries
 * title/artist/album/date. `-c copy` moves the audio frames without a re-encode, and the temp
 * file + rename keeps a failed ffmpeg from truncating the episode in place. An empty value
 * omits that tag rather than failing. The caller runs this after intro-music, whose mp3
 * re-transcode would otherwise strip tags stamped earlier.
 */
function stampId3Tags(audioFile: string, title: string, runDate: string, artist: string, album: string): void {
    const tmpFile = `${audioFile}.id3.tmp.mp3`;
    const metadata: string[] = [];
    const addTag = (name: string, value: string): void => {
        if (value.trim() !== '') metadata.push('-metadata', `${name}=${value}`);
    };
    addTag('title', title);
    addTag('artist', artist);
    addTag('album', album);
    // run_date is a digits-only stamp (`20260924`); ID3 wants `YYYY-MM-DD`.
    const isoDate = /^\d{8}$/.test(runDate)
        ? `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}`
        : runDate;
    addTag('date', isoDate);
    const stamp = spawnSync('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        audioFile,
        '-c',
        'copy',
        '-id3v2_version',
        '3',
        ...metadata,
        tmpFile,
    ]);
    if (stamp.status !== 0 || !existsSync(tmpFile)) {
        if (existsSync(tmpFile)) unlinkSync(tmpFile); // never leave a partial file beside the episode
        failWith(1, `publish-prep: ffmpeg ID3 stamp failed: ${stamp.stderr?.toString().trim()}`);
    }
    sted('rename', audioFile, () => renameSync(tmpFile, audioFile));
}

function dailyPublishPrep(args: string[]): void {
    const [workDir = '', runDate = '', artist = '', album = ''] = args;
    const articlePath = join(workDir, '2-article', `${runDate}_06_article_content.json`);
    const audioPath = join(workDir, '3-audio', `${runDate}_11_generate_content.json`);
    const prepPath = join(workDir, '3-publish', `${runDate}_13_publish-prep_content.json`);
    const coverPath = join(workDir, '2-cover', `${runDate}_07_cover_cover.png`);
    timed(workDir, 'publish-prep', () => {
        const article = requireJson(articlePath, 'publish-prep');
        const audioMeta = metadataOf(readJson(audioPath));
        const rawFile = audioMeta.mp3Path ?? audioMeta.audioPath;
        if (typeof rawFile !== 'string' || rawFile === '') {
            failWith(1, 'publish-prep: voice content carries no mp3Path/audioPath');
        }
        const audioFile = resolve(rawFile);
        // 0171 R2: publish-prep publishes metadata.mp3Path ?? audioPath, so a WAV here means
        // transcode_mp3 was turned off — the run would ship an enclosure Apple Podcasts rejects.
        if (!audioFile.endsWith('.mp3')) {
            failWith(1, `publish-prep: resolved audio is not an MP3 (transcode_mp3 must be "true"): ${audioFile}`);
        }
        stampId3Tags(audioFile, typeof article.title === 'string' ? article.title : '', runDate, artist, album);
        const resolvedCover = resolve(coverPath);
        const hasCover = existsSync(resolvedCover);
        // podcast-pub's documented contract reads metadata.coverImage (map.ts); options.coverPath
        // alone was silently dropped by the mapper — episodes published without a cover.
        const merged = {
            ...article,
            metadata: {
                ...metadataOf(article),
                audioFile,
                runDate,
                ...(hasCover ? { coverImage: resolvedCover } : {}),
            },
            options: {
                audioFile,
                durationSec: audioMeta.duration,
                coverPath: hasCover ? resolvedCover : undefined,
            },
        };
        sted('write', prepPath, () => writeJsonText(prepPath, merged));
    });
}

function dailyPublishSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const prep = join(workDir, '3-publish', `${runDate}_13_publish-prep_content.json`);
    const result = join(workDir, '3-publish', `${runDate}_14_publish-surfdash_result.json`);
    timed(workDir, 'publish-surfdash', () => {
        if (targetPublished(result, 'surfdash-pub')) {
            console.log(`publish-surfdash cached: surfdash target ok in ${result}`);
            return;
        }
        kk(
            [
                'executor',
                'fan-out',
                '--content',
                prep,
                '--target',
                'surfdash-pub',
                '--out',
                result,
                ...pluginsArgs(pluginsPath),
            ],
            {
                unset: NESTED_SPUR_UNSET,
                soft: true,
            },
        );
        console.log('publish-surfdash: surfdash target dispatched; classification happens after podcast publish');
    });
}

function dailyShowNotes(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', title = ''] = args;
    const article = join(workDir, '2-article', `${runDate}_06_article_content.json`);
    // The preceding `publish-surfdash` state writes this artifact; `_17_publish_result.json` does
    // not exist yet at `show-notes` time (the later `publish` state merges it), so reading it left
    // PODCAST_PUB_ARTICLE_POST_PATH permanently empty (task 0137).
    const result = join(workDir, '3-publish', `${runDate}_14_publish-surfdash_result.json`);
    const out = join(workDir, '3-publish', `${runDate}_15_show-notes_show-notes.md`);
    const plan = join(workDir, '2-plan', `${runDate}_03_plan_plan.json`);
    // Generated-episode content carries `metadata.segments[]` — the source of real
    // audio offsets for the show-notes timeline (jump-to-item timestamps).
    const audioContent = join(workDir, '3-audio', `${runDate}_11_generate_content.json`);
    timed(workDir, 'show-notes', () => {
        const effective = readJson(article)?.title;
        const titleArg = title !== '' ? title : typeof effective === 'string' ? effective : '';
        const postPath = firstPostPath(readJson(result), 'surfdash-pub');
        kk(['executor', 'run', 'podcast-pub', '--in', plan, '--out', out, ...pluginsArgs(pluginsPath)], {
            env: {
                PODCAST_PUB_TITLE: titleArg,
                PODCAST_PUB_RUN_DATE: runDate,
                PODCAST_PUB_BRIEF_MODE: 'true',
                PODCAST_PUB_ARTICLE_POST_PATH: postPath,
                ...(isFile(audioContent) ? { PODCAST_PUB_AUDIO_CONTENT: audioContent } : {}),
            },
        });
    });
}

/** `jq -r '[…select(.target == t and .ok == true) | .metadata.postPath // empty] | first // ""'`. */
function firstPostPath(parsed: Record<string, unknown> | null, target: string): string {
    const targets = parsed?.targets;
    if (!Array.isArray(targets)) return '';
    for (const entry of targets) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        if (record.target !== target || record.ok !== true) continue;
        const postPath = metadataOf(record).postPath;
        if (typeof postPath === 'string' && postPath !== '') return postPath;
    }
    return '';
}

function dailyPublishPodcast(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const prep = join(workDir, '3-publish', `${runDate}_13_publish-prep_content.json`);
    const notes = join(workDir, '3-publish', `${runDate}_15_show-notes_show-notes.md`);
    const result = join(workDir, '3-publish', `${runDate}_16_publish-podcast_result.json`);
    timed(workDir, 'publish-podcast', () => {
        if (targetPublished(result, 'podcast-pub')) {
            console.log(`publish-podcast cached: podcast target ok in ${result}`);
            return;
        }
        try {
            const content = requireJson(prep, 'publish-podcast');
            const showNotes = readFileSync(notes, 'utf-8');
            const merged = { ...content, metadata: { ...metadataOf(content), showNotes } };
            sted('write', prep, () => writeJsonText(prep, merged));
            kk(
                [
                    'executor',
                    'fan-out',
                    '--content',
                    prep,
                    '--target',
                    'podcast-pub',
                    '--out',
                    result,
                    ...pluginsArgs(pluginsPath),
                ],
                {
                    unset: ['SPUR_WORKFLOW_RUN_ACTIVE'],
                    soft: true,
                },
            );
        } catch (error) {
            // The shell's `… && … || true` swallowed both steps' failures — but an unusable `kk`
            // (exit 127) is an environment failure, not a tolerated plugin failure.
            if (error instanceof StageFailure && error.status === 127) throw error;
            console.error((error as Error).message);
        }
        console.log('publish-podcast: podcast target dispatched');
    });
}

function dailyPublishClassify(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const result = join(workDir, '3-publish', `${runDate}_17_publish_result.json`);
    const statusFile = join(workDir, '3-publish', `${runDate}_17_publish_publish-status.txt`);
    const surfdash = join(workDir, '3-publish', `${runDate}_14_publish-surfdash_result.json`);
    const podcast = join(workDir, '3-publish', `${runDate}_16_publish-podcast_result.json`);
    timed(workDir, 'publish', () => {
        // Both per-target files must exist: the pre-0133 `jq -s … || echo '[]'` chain could not read
        // a missing one (jq exits 2 after printing the slurped partial), which drove status to `none`.
        // Classifying over whichever file happens to exist would report `full` for a publish that
        // never dispatched — the failure masking this rule exists to prevent.
        const bothWritten = isFile(surfdash) && isFile(podcast);
        const targets = bothWritten ? [...targetsOf(surfdash), ...targetsOf(podcast)] : [];
        const okCount = targets.filter((entry) => entry.ok === true && entry.status === 'published').length;
        const total = targets.length;
        const status = okCount > 0 && okCount === total ? 'full' : okCount > 0 ? 'partial' : 'none';
        sted('write', result, () => writeJqText(result, { ok: okCount === total && total > 0, targets }));
        sted('write', statusFile, () => writeRaw(statusFile, status));
        console.log(`publish: status=${status} (${okCount}/${total} targets published); routing is transition-owned`);
    });
}

function targetsOf(path: string): Record<string, unknown>[] {
    const targets = readJson(path)?.targets;
    return Array.isArray(targets)
        ? (targets.filter((entry) => entry !== null && typeof entry === 'object') as Record<string, unknown>[])
        : [];
}

function dailyPublishPartial(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const result = join(workDir, '3-publish', `${runDate}_17_publish_result.json`);
    timed(workDir, 'publish-partial', () => {
        const failed = targetsOf(result)
            .filter((entry) => entry.ok !== true || entry.status !== 'published')
            .map((entry) => `${entry.target ?? ''}`)
            .join(',');
        const list = failed === '' ? '(unparsed)' : failed;
        console.error(`WARNING: partial publish — failed targets: ${list}`);
        sted('mkdir', '.spur/run', () => mkdirSync('.spur/run', { recursive: true }));
        sted('write', `.spur/run/publish-partial-${runDate}.txt`, () =>
            writeFileSync(
                `.spur/run/publish-partial-${runDate}.txt`,
                `${runDate} partial publish: failed targets: ${list} (result.json preserved for kk executor fan-out --retry-from)\n`,
            ),
        );
    });
}

/**
 * 20260917 review #4/#6: after both publishes land, patch the surfdash disk posts —
 * reuse the podcast-hosted cover URL in frontmatter (image/og_image; no re-upload; fallback:
 * copy the local cover into assets/) and append a podcast cross-link at the end of zh/en/ja.
 * Idempotent per post; commits + pushes the surfdash checkout (SURFDASH_AUTO_PUSH=0 keeps commit-only).
 */
function dailyPatchSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', surfdashRoot = ''] = args;
    if (!surfdashRoot || !existsSync(surfdashRoot)) {
        console.log(`patch-surfdash: surfdash root '${surfdashRoot}' not found — skip`);
        return;
    }
    timed(workDir, 'patch-surfdash', () => {
        const sdResult = join(workDir, '3-publish', `${runDate}_14_publish-surfdash_result.json`);
        const podcastResult = join(workDir, '3-publish', `${runDate}_16_publish-podcast_result.json`);
        if (!isFile(sdResult) || !isFile(podcastResult)) {
            failWith(1, 'patch-surfdash: missing surfdash/podcast publish results — run the publish states first');
        }
        const targetOf = (path: string): Record<string, unknown> => {
            const parsed = readJson(path) as { targets?: Array<Record<string, unknown>> };
            return parsed.targets?.[0] ?? {};
        };
        const sd = targetOf(sdResult);
        const pod = targetOf(podcastResult);
        const postPath = (sd.metadata as Record<string, unknown> | undefined)?.postPath;
        if (typeof postPath !== 'string' || postPath === '')
            failWith(1, 'patch-surfdash: surfdash result carries no postPath');
        // Refuse before anything is written: surfdash's deploy.yml publishes from main, so a commit
        // on any other branch is invisible to production. Placed here (after the input checks) so a
        // refusal leaves the working tree untouched.
        const head = spawnSync('git', ['-C', surfdashRoot, 'rev-parse', '--abbrev-ref', 'HEAD'])
            .stdout?.toString()
            .trim();
        if (head !== 'main')
            failWith(1, `patch-surfdash: refusing to commit on '${head}' — surfdash deploys from main`);
        // Paths this run actually wrote, relative to surfdashRoot. `git add`/`commit` take these as a
        // pathspec so the operator's unrelated staged work is never swept into the commit.
        const written: string[] = [];
        const slugDir = dirname(postPath);
        const showNotesUrl = typeof pod.url === 'string' ? pod.url : '';
        const coverUrl = ((pod.metadata as Record<string, unknown> | undefined)?.imageUrl as string | undefined) ?? '';
        const localCover = join(workDir, '2-cover', `${runDate}_07_cover_cover.png`);
        const dateIso = `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}`;
        const crossLink: Record<string, string> = {
            zh: `🎧 本期已同步制作为播客节目，[点击收听《每日 AI 资讯 · ${dateIso}》](${showNotesUrl})。`,
            en: `🎧 This episode is also available as a podcast: [listen to the Daily AI Briefing · ${dateIso}](${showNotesUrl}).`,
            ja: `🎧 本エピソードはポッドキャストでも配信中：[Daily AI Briefing · ${dateIso} を聴く](${showNotesUrl})。`,
        };
        let changed = 0;
        for (const [locale, dir] of [
            // zh posts live under articles/zh/<slug>; en/ja under articles/<locale>/<slug> —
            // two dirnames up, not one (20260919: `articles/zh/en/...` never existed, so en/ja
            // were silently skipped by the not-published branch).
            ['zh', slugDir],
            ['en', join(dirname(dirname(slugDir)), 'en', basename(slugDir))],
            ['ja', join(dirname(dirname(slugDir)), 'ja', basename(slugDir))],
        ] as const) {
            const indexMd = join(dir, 'index.md');
            if (!existsSync(indexMd)) {
                console.log(`patch-surfdash: ${locale} post not published (${indexMd}) — skip`);
                continue;
            }
            let md = readFileSync(indexMd, 'utf-8');
            const fmEnd = md.indexOf('---', 3); // frontmatter is `---\n ... \n---\n`
            if (fmEnd < 0) failWith(1, `patch-surfdash: no frontmatter in ${indexMd}`);
            // Upsert a single-line `key: 'value'`; the regex consumes folded-scalar continuation
            // lines (`og_image: >-\n  https://...`) so multi-line publish output is replaced whole.
            const upsertKey = (src: string, key: string, value: string): string => {
                // YAML single-quoted scalars escape `'` as `''`; the replacement is a function so
                // `$&`/`$1`/`$$` in the value are never expanded. Scope the match to the frontmatter
                // (recomputed per call, since each upsert shifts offsets) so a body line starting with
                // `image:` is not rewritten.
                const end = src.indexOf('\n---', 3);
                const fm = src.slice(0, end);
                const body = src.slice(end);
                const line = `${key}: '${value.replaceAll("'", "''")}'`;
                const re = new RegExp(`^${key}:.*(?:\\n[ \\t]+.*)*`, 'm');
                const next = re.test(fm)
                    ? fm.replace(re, () => line)
                    : fm.replace(/^publishDate: .*$/m, (m0) => `${m0}\n${line}`);
                return next + body;
            };
            if (coverUrl !== '') {
                // 20260919 prod feedback: the podcast-hosted cover URL wins even when surfdash-pub
                // already wrote `image:` — its resolved og_image points at /content-posts/<slug>/
                // assets/cover.png, which the deployed worker does not serve (404).
                md = upsertKey(md, 'image', coverUrl);
                md = upsertKey(md, 'og_image', coverUrl);
            } else if (!/^image:/m.test(md.slice(0, fmEnd))) {
                // Fallback for runs without a podcast cover: copy the local cover instead.
                if (existsSync(localCover)) {
                    const assets = join(dir, 'assets');
                    mkdirSync(assets, { recursive: true });
                    copyFileSync(localCover, join(assets, 'cover.png'));
                    written.push(relative(surfdashRoot, join(assets, 'cover.png')));
                    md = upsertKey(md, 'image', './assets/cover.png');
                    md = upsertKey(md, 'og_image', './assets/cover.png');
                }
            }
            if (showNotesUrl !== '' && !md.includes(showNotesUrl)) {
                md = `${md.replace(/\s*$/, '')}\n\n${crossLink[locale]}\n`;
            }
            if (md !== readFileSync(indexMd, 'utf-8')) {
                sted('write', indexMd, () => writeFileSync(indexMd, md));
                written.push(relative(surfdashRoot, indexMd));
                changed++;
            }
        }
        if (changed === 0) {
            console.log('patch-surfdash: nothing to change');
            return;
        }
        const git = (...a: string[]): void => {
            const r = spawnSync('git', ['-C', surfdashRoot, ...a]);
            if (r.status !== 0) failWith(1, `patch-surfdash: git ${a[0]} failed: ${r.stderr?.toString().trim()}`);
        };
        git('add', '--', ...written);
        git(
            'commit',
            '-m',
            `feat: cover + podcast cross-link for ${basename(slugDir)} (kk daily patch)`,
            '--',
            ...written,
        );
        if (process.env.SURFDASH_AUTO_PUSH !== '0') git('push', 'origin', 'main');
        console.log(
            `patch-surfdash: patched ${changed} post(s), committed${process.env.SURFDASH_AUTO_PUSH !== '0' ? ' + pushed' : ' (push skipped: SURFDASH_AUTO_PUSH=0)'}`,
        );
    });
}

function dailyRunReport(args: string[]): void {
    const [
        workDir = '',
        runDate = '',
        pluginsPath = '',
        minQuality = '',
        minImportance = '',
        minUrgency = '',
        minImpact = '',
    ] = args;
    const reportMd = join(workDir, `${runDate}_19_run-report_report.md`);
    const reportJson = join(workDir, `${runDate}_19_run-report_report.json`);
    const cands = join(workDir, '2-plan', `${runDate}_19_run-report_episode-plan.json`);
    const candidates = join(workDir, '2-plan', `${runDate}_04_quality-control-content_candidates.json`);
    timed(workDir, 'run-report', () => {
        if (isFile(reportMd)) {
            console.log(`run report cached: ${reportMd}`);
            return;
        }
        if (!isFile(candidates)) {
            console.log('run-report: no candidates.json (run ended below plan step) — skip');
            return;
        }
        sted('write', cands, () => writeJqText(cands, metadataOf(readJson(candidates)).docs ?? []));
        // Plugin env paths must be absolute: spawnPluginEntry runs plugins with cwd = the
        // plugin package dir, so a relative workDir silently misses every best-effort read.
        const absWorkDir = resolve(workDir);
        kk(['executor', 'run', 'news-report-gen', '--in', cands, '--out', reportJson, ...pluginsArgs(pluginsPath)], {
            env: {
                QC_MIN_QUALITY: minQuality,
                QC_MIN_IMPORTANCE: minImportance,
                QC_MIN_URGENCY: minUrgency,
                QC_MIN_IMPACT: minImpact,
                NEWS_REPORT_REJECTED_FILE: join(
                    absWorkDir,
                    '2-plan',
                    `${runDate}_04_quality-control-content_candidates.rejected.json`,
                ),
                NEWS_REPORT_TIMING_FILE: join(absWorkDir, 'step-timing.json'),
                // 0139 R5b: the generate stage's QC audit, read best-effort (absent -> section omitted).
                NEWS_REPORT_QC_FILE: join(absWorkDir, '3-audio', `${runDate}_11_generate_content.json`),
                // 20260917 funnel: the plan stage's full selection trail (every fetched title +
                // scores + disposition), rendered as the 选稿漏斗 section (absent -> omitted).
                NEWS_REPORT_PLAN_AUDIT_FILE: join(absWorkDir, '2-plan', `${runDate}_03_plan_plan.json.audit.json`),
                // 20260917 funnel: the blended fan-in input, rendered as the 语料构成
                // source/category composition (absent -> omitted).
                NEWS_REPORT_BLENDED_FILE: join(absWorkDir, '1-ingest', `${runDate}_02_collect_blended.json`),
                // F613 R5: the script stage's Content, read best-effort (absent -> 脚本来源 omitted).
                NEWS_REPORT_SCRIPT_FILE: join(absWorkDir, '2-script', `${runDate}_08_script_content.json`),
                NEWS_REPORT_DATE: runDate,
            },
        });
        const body = readJson(reportJson)?.body;
        if (typeof body !== 'string') failWith(1, `run-report: ${reportJson} has no string body`);
        sted('write', reportMd, () => writeRaw(reportMd, body));
        console.log(`run report written: ${reportMd}`);
    });
}

/**
 * Collapsed translate scaffolding (2026-09-16 feedback): surfdash-pub owns the
 * deterministic mechanics — `scaffold-locale` for both target locales — while the
 * workflow `translate` state's agent step owns the LLM translation of the drafts.
 * Writes one marker file per locale (zh post path + en/ja draft paths); empty
 * marker = locale absent (callers skip). Reuses an existing on-disk draft as the
 * cache across run retries — re-scaffolding would erase the agent's translation.
 */
function dailyTranslateLocalize(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const result = join(workDir, '3-publish', `${runDate}_17_publish_result.json`);
    const zhFile = join(workDir, '3-publish', `${runDate}_20_translate-localize_zh-post-path.txt`);
    timed(workDir, 'translate-localize', () => {
        const postPath = firstPostPath(readJson(result), 'surfdash-pub');
        const zh = postPath.endsWith('index.md') ? postPath : '';
        sted('write', zhFile, () => writeRaw(zhFile, zh));
        if (zh === '') {
            for (const target of ['en', 'ja'] as const) {
                sted(
                    'write',
                    join(workDir, '3-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                    () =>
                        writeRaw(
                            join(workDir, '3-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`),
                            '',
                        ),
                );
            }
            console.log('no zh post path — skip localize');
            return;
        }
        for (const target of ['en', 'ja'] as const) {
            const markerFile = join(workDir, '3-publish', `${runDate}_20_translate-localize_${target}-post-path.txt`);
            const existing = zh.replace('/zh/', `/${target}/`);
            if (isFile(existing)) {
                sted('write', markerFile, () => writeRaw(markerFile, existing));
                console.log(`${target} draft cached: ${existing}`);
                continue;
            }
            const scaffold = join(workDir, '3-publish', `${runDate}_20_translate-localize_scaffold-${target}.json`);
            const scaffoldResult = join(
                workDir,
                '3-publish',
                `${runDate}_20_translate-localize_scaffold-${target}-result.json`,
            );
            sted('write', scaffold, () =>
                writeJqText(scaffold, { body: '', options: { operation: 'scaffold-locale', postPath: zh, target } }),
            );
            kk([
                'executor',
                'run',
                'surfdash-pub',
                '--in',
                scaffold,
                '--out',
                scaffoldResult,
                ...pluginsArgs(pluginsPath),
            ]);
            const draftPath = metadataOf(readJson(scaffoldResult)).draftPath;
            sted('write', markerFile, () => writeRaw(markerFile, typeof draftPath === 'string' ? draftPath : ''));
        }
    });
}

function dailyTranslateSync(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = '', zhPathFile = ''] = args;
    const sync = join(workDir, '3-publish', `${runDate}_24_translate-sync_sync.json`);
    const syncResult = join(workDir, '3-publish', `${runDate}_24_translate-sync_sync-result.json`);
    timed(workDir, 'translate-sync', () => {
        // Reads the marker file itself — the collapsed `translate` state has no
        // cross-state var to hand the path through.
        const zhPostPath = isFile(zhPathFile) ? readFileSync(zhPathFile, 'utf-8') : '';
        if (zhPostPath === '') {
            console.log('no zh post path — skip translate-sync');
            return;
        }
        sted('write', sync, () =>
            writeJqText(sync, { body: '', options: { operation: 'sync', postPath: zhPostPath } }),
        );
        kk(['executor', 'run', 'surfdash-pub', '--in', sync, '--out', syncResult, ...pluginsArgs(pluginsPath)], {
            unset: NESTED_SPUR_UNSET,
        });
    });
}

const [stage, ...rest] = process.argv.slice(2);

// Imported as a module (unit tests reach `dedupPlanByTitle`) → exports only, never a stage run;
// executed as the entrypoint → dispatch.
if (import.meta.main)
    switch (stage) {
        case 'prepare-itc':
            prepareItc(rest);
            break;
        case 'prepare-solo':
            prepareSolo(rest);
            break;
        case 'prepare-storm':
            prepareStorm(rest);
            break;
        case 'duration':
            duration(rest);
            break;
        case 'validate': {
            const { override, values } = parseStage(rest, { in: { type: 'string' } });
            if (!values.in) fail('usage: kk-workflow-stages.ts validate [<override>] --in <voicescript.yaml>');
            delegate(requireSidecar(override, VALIDATE_SIDECAR, 'validate_script'), ['--in', values.in]);
            break;
        }
        case 'wrap': {
            const { override, values } = parseStage(rest, {
                in: { type: 'string' },
                out: { type: 'string' },
                profile: { type: 'string' },
            });
            if (!values.in || !values.out) {
                fail(
                    'usage: kk-workflow-stages.ts wrap [<override>] --in <voicescript.yaml> --out <docs.json> [--profile <name>]',
                );
            }
            delegate(requireSidecar(override, WRAP_SIDECAR, 'wrap_script'), [
                values.in,
                values.out,
                values.profile ?? '',
            ]);
            break;
        }
        case 'render-storm': {
            const { override, values } = parseStage(rest, { in: { type: 'string' }, out: { type: 'string' } });
            if (!values.in || !values.out) {
                fail('usage: kk-workflow-stages.ts render-storm [<override>] --in <content.json> --out <content.md>');
            }
            delegate(requireSidecar(override, RENDER_SIDECAR, 'render_script'), [
                '--in',
                values.in,
                '--out',
                values.out,
            ]);
            break;
        }
        case 'daily-prepare':
            dailyPrepare(rest);
            break;
        case 'daily-collect-facts':
            dailyCollectFacts(rest);
            break;
        case 'daily-plan':
            dailyPlan(rest);
            break;
        case 'daily-qc-content':
            dailyQcContent(rest);
            break;
        case 'daily-article':
            dailyArticle(rest);
            break;
        case 'daily-cover':
            dailyCover(rest);
            break;
        case 'daily-cover-normalize':
            dailyCoverNormalize(rest);
            break;
        case 'daily-xhs-render':
            dailyXhsRender(rest);
            break;
        case 'daily-script-style':
            dailyScriptStyle(rest);
            break;
        case 'daily-script':
            dailyScript(rest);
            break;
        case 'daily-wrap-docs':
            dailyWrapDocs(rest);
            break;
        case 'daily-generate':
            dailyGenerate(rest);
            break;
        case 'daily-intro':
            dailyIntro(rest);
            break;
        case 'daily-quality-report':
            dailyQualityReport(rest);
            break;
        case 'daily-publish-prep':
            dailyPublishPrep(rest);
            break;
        case 'daily-publish-surfdash':
            dailyPublishSurfdash(rest);
            break;
        case 'daily-show-notes':
            dailyShowNotes(rest);
            break;
        case 'daily-publish-podcast':
            dailyPublishPodcast(rest);
            break;
        case 'daily-publish-xhs':
            dailyPublishXhs(rest);
            break;
        case 'daily-publish-classify':
            dailyPublishClassify(rest);
            break;
        case 'daily-patch-surfdash':
            dailyPatchSurfdash(rest);
            break;
        case 'daily-publish-partial':
            dailyPublishPartial(rest);
            break;
        case 'daily-run-report':
            dailyRunReport(rest);
            break;
        case 'daily-translate-localize':
            dailyTranslateLocalize(rest);
            break;
        case 'daily-translate-sync':
            dailyTranslateSync(rest);
            break;
        case 'itc-outline-pick': {
            const { itcOutlinePick } = await loadItcStages();
            itcOutlinePick(rest);
            break;
        }
        case 'itc-report': {
            const { itcReport } = await loadItcStages();
            itcReport(rest);
            break;
        }
        case 'itc-materialize': {
            const { itcMaterialize } = await loadItcStages();
            itcMaterialize(rest);
            break;
        }
        case 'itc-publish-plan': {
            const { itcPublishPlan } = await loadItcStages();
            itcPublishPlan(rest);
            break;
        }
        case 'itc-publish-fanout': {
            const { itcPublishFanout } = await loadItcStages();
            itcPublishFanout(rest);
            break;
        }
        case 'itc-publish-next': {
            const { itcPublishNext } = await loadItcStages();
            itcPublishNext(rest);
            break;
        }
        case 'itc-adapt-verify': {
            const { itcAdaptVerify } = await loadItcStages();
            itcAdaptVerify(rest);
            break;
        }
        default:
            fail(
                `unknown stage: ${stage ?? '(none)'} (expected prepare-itc|prepare-solo|prepare-storm|validate|wrap|duration|render-storm|itc-*|daily-*)`,
            );
    }
