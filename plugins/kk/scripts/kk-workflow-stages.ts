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
 *   music-*           (0403, body in the sibling music-stages.ts): prepare/explore/select/
 *                     analyze/judge-input/finalize for plugins/kk/workflows/kk-music.yaml
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
import { compositeCover } from './cover-compositor';

export const SCRIPTS_DIR = import.meta.dir;
export const VALIDATE_SIDECAR = 'validate-voicescript.ts';
const WRAP_SIDECAR = 'wrap-voicescript-doc.ts';
const RENDER_SIDECAR = 'render-md.ts';
// ADR-045: daily-news editorial policy lives in the kk:news-editorial skill, shipped beside this
// scripts dir in the same package. Its style contract is what the `write` mode reads (via the run
// snapshot) and dailynews-gen validates against (DAILYNEWS_STYLE_FILE).
export const EDITORIAL_SKILL_DIR = join(SCRIPTS_DIR, '..', 'skills', 'news-editorial');
export const STYLE_CONTRACT = join(EDITORIAL_SKILL_DIR, 'references', 'style-contract.zh.md');
const REVISE_COUNT = '.revise-count';
/** Bounded draft-remediation counter for the daily safety loop (20261005). */
export const SAFETY_REVISE_COUNT = '.safety-revise-count';
/**
 * Verdict criteria that describe *platform admission* (the daily's CN 资质口径 / 播报形态 rules) rather
 * than a defect in the draft itself. Only these can be answered by dropping a publish target; every
 * other `fail` is draft integrity, which would ship to the remaining targets too (20261005).
 */
export const ADMISSION_CRITERIA = new Set(['jurisdictional-rules']);
/** content-safety category 3 (可识别个人信息): a draft property, so no target choice answers it. */
export const PII_FINDING_CATEGORY = 3;
export const SAFETY_PLATFORM_DECISIONS = new Set(['OK', 'RISK', 'BLOCK']);
// Post-translation title-dedup threshold (task 0138 R3). ponytail: the 2026-09-16 Gemini 3.8 Live
// pair measures 0.417 zh title-only Jaccard, the nearest distinct pair 0.1 (4x margin). Character
// bigrams need same-language input — pre-translate dedup over the mixed-language blend cannot work.
export const DEDUP_TITLE_THRESHOLD = 0.4;
// F614: the daily cover renders through the shipped daily-news presets; the brief's subject is
// the only per-run var. The format/style pins and the subject cap are part of the style
// contract — changing the look means editing the preset files, not this stage.
export const COVER_FORMAT = 'daily-news-podcast-cover';
export const COVER_STYLE = 'quasi-news-podcast';
export const COVER_SUBJECT_CAP = 240;
// E8: the XHS card series. Format and style are pinned exactly like the cover's; only the copy is
// model-authored. `XHS_MAX_CARDS` mirrors the format preset's own series guidance.
export const XHS_FORMAT = 'xhs-card';
export const XHS_MAX_CARDS = 10;
export const XHS_TITLE_CAP = 20;
export const XHS_BODY_CAP = 1000;
export const XHS_ROLES: readonly string[] = ['cover', 'content', 'closing'];

/** One planned card, normalized: `index` zero-padded for the preset's artifact name. */
export interface XhsCard {
    index: string;
    role: string;
    copy: string;
    points: string[];
    layout: string;
    subject: string;
    sourcePoint: string;
    /** 0235: the plan item a voice2 content card covers (absent on the hook/closing cards and in voice1). */
    itemId?: string;
}

export function fail(message: string): never {
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

/**
 * Load the seo-* helper sibling lazily (task 0281): this runner is resolved — and copied
 * alone — from installs where the sibling may be absent, so the seo-* stages fail loud with a
 * remediation path instead of breaking every stage at load.
 */
async function loadSeoStages(): Promise<typeof import('./seo-stages.ts')> {
    try {
        return await import('./seo-stages.ts');
    } catch {
        return fail(
            'seo-stages.ts not found next to kk-workflow-stages.ts — install or refresh the kk package (bun link in a checkout)',
        );
    }
}

/** coreutils-style reason for the errno codes the staged file operations can hit. */

/**
 * Load the daily-* helper sibling lazily (task 0211 R7): this runner is resolved — and copied
 * alone — from installs where the sibling may be absent, so the daily-* stages fail loud with a
 * remediation path instead of breaking every stage at load.
 */
async function loadDailyStages(): Promise<typeof import('./daily-stages.ts')> {
    try {
        return await import('./daily-stages.ts');
    } catch {
        return fail(
            'daily-stages.ts not found next to kk-workflow-stages.ts — install or refresh the kk package (bun link in a checkout)',
        );
    }
}
/**
 * Load the audio-quality diagnostic lazily: it shells out to ffprobe/ffmpeg and is only needed when an
 * operator asks for it, so the runner must not pay for it on every stage (and an install without
 * ffmpeg on PATH still runs every other stage).
 */
async function loadAudioQuality(): Promise<typeof import('./audio-quality.ts')> {
    try {
        return await import('./audio-quality.ts');
    } catch {
        return fail(
            'audio-quality.ts not found next to kk-workflow-stages.ts — install or refresh the kk package (bun link in a checkout)',
        );
    }
}
/**
 * Load the music-* helper sibling lazily (task 0403): it owns the kk-music workflow's fan-out and
 * artifact assembly, and an install that still ships only the core runner must not break on load.
 */
async function loadMusicStages(): Promise<typeof import('./music-stages.ts')> {
    try {
        return await import('./music-stages.ts');
    } catch {
        return fail(
            'music-stages.ts not found next to kk-workflow-stages.ts — install or refresh the kk package (bun link in a checkout)',
        );
    }
}
export const ERRNO_REASONS: Record<string, string> = {
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
export function sted(op: string, path: string, run: () => void): void {
    try {
        run();
    } catch (error) {
        const failure = error as { code?: string; message?: string };
        fail(`${op}: ${path}: ${(failure.code !== undefined && ERRNO_REASONS[failure.code]) || failure.message}`);
    }
}

/** `[ -f ]` semantics: exists AND is a regular file; an unreadable parent answers false, never throws. */
export function isFile(path: string): boolean {
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
export function resolveSidecar(override: string, sidecar: string): string {
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
export function requireSidecar(override: string, sidecar: string, label: string): string {
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

export function bumpReviseCount(workDir: string): void {
    const path = join(workDir, '.revise-count');
    let previous = Number.NaN;
    if (isFile(path))
        sted('read', path, () => {
            previous = Number.parseInt(readFileSync(path, 'utf-8'), 10);
        });
    sted('write', path, () => writeFileSync(path, `${(Number.isNaN(previous) ? 0 : previous) + 1}\n`));
}

/** `0` when `.safety-revise-count` is absent or unparsable: a fresh run revises, it never blocks on state. */
export function readSafetyReviseCount(workDir: string): number {
    const path = join(workDir, SAFETY_REVISE_COUNT);
    if (!isFile(path)) return 0;
    const value = Number.parseInt(readFileSync(path, 'utf-8'), 10);
    return Number.isNaN(value) ? 0 : value;
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

export function duration(args: string[]): void {
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
    '10-ingest',
    '20-facts',
    '21-plan',
    '22-article',
    '23-cover',
    '25-xhs',
    '24-script',
    '30-audio',
    '31-publish',
] as const;

/** `date -u +%FT%TZ` — the timestamp grammar the step-timing lines have always used. */
export function utcStamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The pre-0133 shell wrapped every daily step in `trap … EXIT`, so the timing line lands on failure
 * too. The body signals failure by throwing `failWith`, never by calling `process.exit` directly.
 */
export class StageFailure extends Error {
    constructor(
        readonly status: number,
        readonly named: boolean,
        message: string,
    ) {
        super(message);
    }
}

export function failWith(status: number, message?: string): never {
    throw new StageFailure(status, message !== undefined, message ?? `stage failed (status ${status})`);
}

export function appendTiming(workDir: string, step: string, startedAt: string): void {
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

export function timed(workDir: string, step: string, body: () => void): void {
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

export function pluginsArgs(pluginsPath: string): string[] {
    return pluginsPath === '' ? [] : ['--plugins-path', pluginsPath];
}

/** `kk <args>` with the caller's env overrides; `soft` mirrors the shell's `|| true`. */
// spur --async exports SPUR_EXPECTED_DEFINITION_DIGEST (its own worker's identity binding) into
// every descendant env; a nested `spur workflow run` — postsurfing's publishing workflow under
// surfdash-pub — resolves a DIFFERENT digest and refuses to start. Strip both launcher vars at
// the nested-spur boundary (SPUR_WORKFLOW_RUN_ACTIVE is the older sibling guard, task 0133-era).
export const NESTED_SPUR_UNSET = ['SPUR_WORKFLOW_RUN_ACTIVE', 'SPUR_EXPECTED_DEFINITION_DIGEST'] as const;

export function kk(
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

/**
 * `kk()` sibling with `stdio: 'pipe'`: captures the child's stdout/stderr, reprints both to the
 * parent so the operator log is unchanged, and returns the exit status plus the captured stderr.
 * Only stages that branch on the child's stderr use it (0251: the xhs-render overflow retry);
 * every other call keeps `kk()`'s inherit default.
 */
export function kkCaptured(
    args: string[],
    options: { env?: Record<string, string>; unset?: readonly string[]; soft?: boolean } = {},
): { status: number; stderr: string } {
    const env = { ...process.env, ...(options.env ?? {}) };
    for (const name of options.unset ?? []) delete env[name];
    const runner = spawnSync('kk', args, { stdio: 'pipe', encoding: 'utf-8', env });
    if (runner.error !== undefined) {
        console.error(`kk: ${runner.error.message}`);
        failWith(127);
    }
    process.stdout.write(runner.stdout ?? '');
    process.stderr.write(runner.stderr ?? '');
    const status = runner.status ?? 1;
    if (status !== 0 && options.soft !== true) failWith(status);
    return { status, stderr: runner.stderr ?? '' };
}

export function writeJsonText(path: string, value: unknown): void {
    // `Bun.write(path, JSON.stringify(value, null, 2))` — no trailing newline.
    writeFileSync(path, JSON.stringify(value, null, 2));
}

export function writeJqText(path: string, value: unknown): void {
    // `jq … > path` — pretty output WITH the trailing newline jq always prints.
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeRaw(path: string, value: string): void {
    // `printf '%s' … > path` / `bun -e 'Bun.write'` — no trailing newline.
    writeFileSync(path, value);
}

export function readJson(path: string): Record<string, unknown> | null {
    if (!isFile(path)) return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

export function metadataOf(value: Record<string, unknown> | null): Record<string, unknown> {
    const metadata = value?.metadata;
    return metadata !== null && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
}

/**
 * Required stage input: a missing or unparsable file fails the stage naming the path, so a
 * run-date/path mismatch surfaces as its real cause instead of a downstream "field missing" error.
 */
export function requireJson(path: string, label: string): Record<string, unknown> {
    const parsed = readJson(path);
    if (parsed === null) failWith(1, `${label}: required input not found or unparsable: ${path}`);
    return parsed;
}

/** `jq -e '.targets[]? | select(.target == t and .ok == true and .status == "published")'`. */
export function targetPublished(path: string, target: string): boolean {
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
    // (workflow-run.md §2 precedence: KK_WORKS_DIR > config works_dir > <cwd>/.works):
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
        // The safety remediation budget belongs to the attempt, not to the day: a fresh run (or a
        // same-day retry) starts with the full revise allowance instead of inheriting a spent one.
        sted('write', join(workDir, SAFETY_REVISE_COUNT), () =>
            writeFileSync(join(workDir, SAFETY_REVISE_COUNT), '0\n'),
        );
        // Version-stamp the run: every later stage resolves `kk` from PATH, so name the binary
        // this run will actually use (20261006 outage: a stale global kk pre-dated the revise
        // loop and the skew was only visible after the fact).
        const versionProbe = spawnSync('kk', ['--version'], { encoding: 'utf8', timeout: 10_000 });
        const kkVersion = versionProbe.status === 0 ? versionProbe.stdout.trim() : 'unknown';
        sted('write', join(workDir, 'kk-version.txt'), () =>
            writeFileSync(join(workDir, 'kk-version.txt'), `${kkVersion}\n`),
        );
        // Anchor for the workflow: shell actions cannot set vars, so the YAML reads the
        // effective work_dir back into vars.work_dir from this cwd-relative file.
        const anchorDir = join('.spur', 'runs', 'kk-daily-ai-voice');
        sted('write', join(anchorDir, 'work-dir.txt'), () => {
            mkdirSync(anchorDir, { recursive: true });
            writeFileSync(join(anchorDir, 'work-dir.txt'), `${workDir}\n`);
        });
        sted('write', join(workDir, '10-ingest/source.json'), () =>
            writeJsonText(join(workDir, '10-ingest/source.json'), {
                limit: Number(limit),
                cursor: cursor === '' ? undefined : cursor,
                stateFile: stateFile === '' ? undefined : stateFile,
            }),
        );
        if (last30daysEnabled !== 'true') {
            sted('write', join(workDir, '10-ingest/last30days-docs.json'), () =>
                writeFileSync(join(workDir, '10-ingest/last30days-docs.json'), '[]'),
            );
        }
        sted('write', join(workDir, '10-ingest/last30days.json'), () =>
            writeJsonText(join(workDir, '10-ingest/last30days.json'), { topic }),
        );
        sted('write', join(workDir, '10-ingest/horizon.json'), () =>
            writeJsonText(join(workDir, '10-ingest/horizon.json'), { hours: Number(horizonHours) }),
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
export function expandHome(p: string): string {
    if (p.startsWith('~/')) return join(homedir(), p.slice(2));
    if (p.startsWith('$HOME/')) return join(homedir(), p.slice('$HOME/'.length));
    return p;
}

/**
 * works_dir for composed daily workspaces — workflow-run.md §2 precedence:
 * KK_WORKS_DIR env > config works_dir > compiled default <cwd>/.works (ADR: the config root
 * holds no disposable data; matches collect-prepare's cwd-relative `.works`).
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
    return resolve(process.cwd(), '.works');
}

/**
 * `collect-prepare <stamp> <limit> <topic> <horizonHours>` — kk-collect's workspace: the pinned stamp
 * (else the UTC minute, `YYYYMMDDTHHMMZ`), the cwd-relative `.works/kk-collect/<stamp>` work dir, the
 * anchor files the workflow reads back into vars (shell actions cannot set vars), and the three
 * source configs `kk executor fan-in --source <plugin>:<file>` requires. Configs go through
 * `writeJsonText` so a topic carrying quotes or backslashes stays valid JSON.
 */
function collectPrepare(args: string[]): void {
    const [stampArg = '', limit = '', topic = '', horizonHours = ''] = args;
    const stamp = stampArg || new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).concat('Z');
    const workDir = join('.works', 'kk-collect', stamp);
    const anchorDir = join('.spur', 'runs', 'kk-collect');
    sted('mkdir', join(workDir, '10-ingest'), () => mkdirSync(join(workDir, '10-ingest'), { recursive: true }));
    sted('mkdir', anchorDir, () => mkdirSync(anchorDir, { recursive: true }));
    sted('write', join(anchorDir, 'work-dir.txt'), () =>
        writeFileSync(join(anchorDir, 'work-dir.txt'), `${workDir}\n`),
    );
    sted('write', join(anchorDir, 'stamp.txt'), () => writeFileSync(join(anchorDir, 'stamp.txt'), `${stamp}\n`));
    sted('write', join(workDir, '10-ingest/source.json'), () =>
        writeJsonText(join(workDir, '10-ingest/source.json'), { limit: Number(limit) }),
    );
    sted('write', join(workDir, '10-ingest/last30days.json'), () =>
        writeJsonText(join(workDir, '10-ingest/last30days.json'), { topic }),
    );
    sted('write', join(workDir, '10-ingest/horizon.json'), () =>
        writeJsonText(join(workDir, '10-ingest/horizon.json'), { hours: Number(horizonHours) }),
    );
}

function dailyCollectFacts(args: string[]): void {
    const [workDir = '', runDate = '', pluginsPath = ''] = args;
    const content = join(workDir, '20-facts', `${runDate}_02_collect_content.json`);
    const facts = join(workDir, '20-facts', `${runDate}_02_collect_core-facts.md`);
    const blended = join(workDir, '10-ingest', `${runDate}_02_collect_blended.json`);
    timed(workDir, 'collect', () => {
        if (isFile(content) && isFile(facts)) {
            console.error(`core facts cached: ${facts}`);
            return;
        }
        kk(['executor', 'run', 'core-facts-gen', '--in', blended, '--out', content, ...pluginsArgs(pluginsPath)]);
        const body = readJson(content)?.body;
        if (typeof body !== 'string') failWith(1, `collect: ${content} has no string body`);
        sted('write', facts, () => writeRaw(facts, body));
    });
}

export interface TopicBoundaryRule {
    id: string;
    reason: string;
    keywords: string[];
}

export interface TopicBoundarySpec {
    version: number;
    scanChars: number;
    rules: TopicBoundaryRule[];
    dateConflict: { reason: string };
}

export interface TopicBoundaryExclusion {
    id: string;
    title: string;
    rule: string;
    reason: string;
    matched: string;
}

export function readTopicBoundary(): TopicBoundarySpec {
    const path = join(SCRIPTS_DIR, 'topic-boundary.json');
    let parsed: TopicBoundarySpec;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf-8')) as TopicBoundarySpec;
    } catch (err: unknown) {
        failWith(1, `topic-boundary: spec unreadable at ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
        failWith(1, `topic-boundary: spec at ${path} carries no rules`);
    }
    return parsed;
}

/**
 * Deterministic topic admission for the AI 乱炖 column (task 0189 R2): an item whose mainline is
 * political/diplomatic-trade, military, public-policy dispute, or a social public event is
 * excluded with its ID, rule and matched keyword recorded — sources stay untouched. A date that
 * contradicts the run (publishedAt after the run date, e.g. an aggregated future-dated draft) is
 * inadmissible as evidence (R3). Matches scan the title plus the first `scanChars` chars of the
 * body — precision first: a body-mention far below the fold does not exclude. Matching is
 * case-insensitive (task 0189 F2: both sides lowercased; zh unaffected) so headline-capitalized
 * "President"/"Pentagon" still hit the lowercase English keywords in the spec.
 */
export function applyTopicBoundary(
    docs: unknown[],
    runDate: string,
    spec: TopicBoundarySpec,
): {
    kept: unknown[];
    excluded: TopicBoundaryExclusion[];
} {
    const excluded: TopicBoundaryExclusion[] = [];
    const kept: unknown[] = [];
    for (const doc of docs) {
        const record = (doc ?? {}) as Record<string, unknown>;
        const title = typeof record.title === 'string' ? record.title : '';
        const body = typeof record.body === 'string' ? record.body : '';
        const haystack = `${title}\n${body.slice(0, spec.scanChars)}`;
        // Case-insensitive comparison (task 0189 F2): spec keywords are lowercase English; the
        // recorded `matched` stays the spec's keyword verbatim. zh is unaffected by lowercasing.
        const needle = haystack.toLowerCase();
        let exclusion: TopicBoundaryExclusion | null = null;
        for (const rule of spec.rules) {
            // ASCII keywords must start at a word boundary ("selection" is not "election", "patriot"
            // is not "riot"); the tail stays open so plurals/inflections still hit. zh keywords have
            // no word boundaries and keep plain substring matching.
            const matched = rule.keywords.find((keyword) => {
                const lower = keyword.toLowerCase();
                if (lower === '') return false;
                return /^[a-z]/.test(lower)
                    ? new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(needle)
                    : needle.includes(lower);
            });
            if (matched !== undefined) {
                exclusion = { id: String(record.id ?? ''), title, rule: rule.id, reason: rule.reason, matched };
                break;
            }
        }
        if (exclusion === null) {
            const publishedAt = metadataOf(record).publishedAt;
            const stamp = typeof publishedAt === 'string' ? publishedAt : '';
            const runIso = /^\d{8}$/.test(runDate)
                ? `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}`
                : '';
            if (runIso !== '' && stamp !== '') {
                const published = new Date(stamp);
                if (
                    !Number.isNaN(published.getTime()) &&
                    // No zone suffix: run_date is a LOCAL day, so its end is local too — a UTC
                    // cutoff flags same-evening items west of Greenwich as future-dated.
                    published.getTime() > new Date(`${runIso}T23:59:59`).getTime()
                ) {
                    exclusion = {
                        id: String(record.id ?? ''),
                        title,
                        rule: 'date-conflict',
                        reason: spec.dateConflict.reason,
                        matched: stamp,
                    };
                }
            }
        }
        if (exclusion !== null) excluded.push(exclusion);
        else kept.push(doc);
    }
    return { kept, excluded };
}

export function titleSimilarity(a: string, b: string): number {
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
export function assertScriptContent(scriptPath: string): void {
    // `spawnSync` + `failWith`, deliberately NOT `delegate`: delegate is `never`-returning (it calls
    // process.exit), so using it mid-function would abort the calling stage on SUCCESS — dailyWrapDocs
    // would exit before packaging its docs. A clean exit here falls through to the rest of the stage.
    const sidecar = requireSidecar('', VALIDATE_SIDECAR, 'validate_script');
    const runner = spawnSync(process.execPath, [sidecar, '--in', scriptPath], { stdio: 'inherit' });
    if (runner.status !== 0) {
        failWith(runner.status ?? 1, `script content check failed: ${scriptPath} was rejected (see above)`);
    }
}

export function coverBrief(briefPath: string): { reason: string | null; subject: string } {
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

/** The 0347 cover brief's Hook headline, or '' when the brief is absent, malformed, or headline-less. */
function briefHeadline(briefPath: string): string {
    if (!existsSync(briefPath)) return '';
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(briefPath, 'utf-8'));
    } catch {
        return '';
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
    const headline = (parsed as Record<string, unknown>).headline;
    return typeof headline === 'string' ? headline.trim() : '';
}

export function coverNormalizeBody(workDir: string, runDate: string): void {
    // F614 R5: the artifact name follows the format preset (`<stem>-<format>-NN.<ext>`,
    // paths.ts), so normalize reads the path the plugin itself recorded in the manifest instead
    // of a hard-coded name. The legacy content-cover-01.{png,jpg} paths stay as stale cleanup.
    const legacyPng = join(workDir, '23-cover', 'content-cover-01.png');
    const legacyJpg = join(workDir, '23-cover', 'content-cover-01.jpg');
    // Must match the name dailyPublishPrep and the article->cover workflow guard read:
    // `${runDate}_07_cover_cover.png` (a plain `cover-${runDate}.png` left options.coverPath
    // undefined and silently dropped the cover from both podcast and surfdash — 2026-09-16 run).
    const out = join(workDir, '23-cover', `${runDate}_07_cover_cover.png`);
    const images = metadataOf(readJson(join(workDir, '23-cover', 'content.json'))).images;
    const first = Array.isArray(images) ? images[0] : undefined;
    const recorded =
        first !== null && typeof first === 'object' && typeof (first as Record<string, unknown>).path === 'string'
            ? ((first as Record<string, unknown>).path as string)
            : '';
    if (recorded === '' || !isFile(recorded)) {
        failWith(1, 'cover normalize: no image artifact in 23-cover/content.json');
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
    // 0348: deterministic typography + branding overlay. The 0347 editorial brief carries a
    // Chinese Hook headline; when present, composite it (and the podcast emblem) onto the
    // normalized cover. Missing/invalid brief or empty headline keeps the raw background —
    // downstream stages read the same `${runDate}_07_cover_cover.png` either way.
    const briefPath = join(workDir, '23-cover', `${runDate}_07_cover-brief.json`);
    const headline = briefHeadline(briefPath);
    if (headline !== '') {
        try {
            compositeCover({ backgroundImagePath: out, headline, outputPath: out });
        } catch (error) {
            failWith(1, `cover composite: ${(error as Error).message}`);
        }
        console.error(`cover composited: headline=${headline.replaceAll('\n', ' ')}`);
    }
    console.error(`cover normalized: ${runDate}_07_cover_cover.png`);
}

/** `metadata.images[0]` — the artifact the image-gen plugin recorded for one render. */
export function firstArtifact(content: Record<string, unknown> | null): Record<string, unknown> | null {
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
export function xhsPlan(planPath: string, count: number): { title: string; body: string; cards: XhsCard[] } {
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
            ...(typeof card.itemId === 'string' && card.itemId.trim() !== '' ? { itemId: card.itemId.trim() } : {}),
        };
    });
    return { title, body, cards };
}

export function resultPublishStatus(path: string): string {
    const parsed = readJson(path);
    if (parsed?.ok !== true) return '';
    const status = metadataOf(parsed).publishStatus;
    return status === 'public' || status === 'draft' ? status : '';
}

export function safetyPath(workDir: string, runDate: string, name: string): string {
    return join(workDir, '24-script', `${runDate}_09_${name}`);
}

/**
 * Digest of the exact drafts under review (article Content + VoiceScript). A verdict is only valid
 * for the bytes it was issued on: the gate and publish-prep both recompute this, so an edit after
 * PASS — including a HITL edit at `review` — invalidates the stamp instead of riding on it.
 */
export function safetyDigest(workDir: string, runDate: string): string {
    const hash = createHash('sha256');
    for (const path of safetyDraftPaths(workDir, runDate)) {
        if (!isFile(path)) failWith(1, `safety-review: required draft not found: ${path}`);
        hash.update(readFileSync(path)).update('\0');
    }
    return hash.digest('hex');
}

/** The drafts under review — the digest's bytes, and the quarantine set on a quality block. */
export function safetyDraftPaths(workDir: string, runDate: string): [string, string] {
    return [
        join(workDir, '22-article', `${runDate}_06_article_content.json`),
        join(workDir, '24-script', `${runDate}_08_script_voicescript.yaml`),
    ];
}

export function stampId3Tags(audioFile: string, title: string, runDate: string, artist: string, album: string): void {
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

export function firstPostPath(parsed: Record<string, unknown> | null, target: string): string {
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

/**
 * The public URL a target published to, or '' — the sibling of {@link firstPostPath} for consumers
 * that need the reader-facing address (WeChat's 原文链接 points at the surfdash post).
 */
export function firstTargetUrl(parsed: Record<string, unknown> | null, target: string): string {
    const targets = parsed?.targets;
    if (!Array.isArray(targets)) return '';
    for (const entry of targets) {
        if (entry === null || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        if (record.target !== target || record.ok !== true) continue;
        if (typeof record.url === 'string' && record.url !== '') return record.url;
    }
    return '';
}

function dailyPublishClassify(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const result = join(workDir, '31-publish', `${runDate}_17_publish_result.json`);
    const statusFile = join(workDir, '31-publish', `${runDate}_17_publish_publish-status.txt`);
    const surfdash = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
    const podcast = join(workDir, '31-publish', `${runDate}_16_publish-podcast_result.json`);
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
        // The ledger's Result cell for the legacy `publish` node (task 0212 R1): same target-set
        // shape the voice2 classify writes to publish-classify.summary.txt, so cutover-check can
        // compare baseline and candidate ledgers during the cutover window.
        const summaryFile = join(workDir, 'publish.summary.txt');
        sted('write', summaryFile, () =>
            writeRaw(summaryFile, `${JSON.stringify({ status, published: okCount, targets: total })}\n`),
        );
        // 0220: completeness moved to terminal daily-publish-completeness stage
        console.error(`publish: status=${status} (${okCount}/${total} targets published); routing is transition-owned`);
    });
}

function dailyPublishCompleteness(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    timed(workDir, 'publish-completeness', () => {
        const completeness = publishCompleteness(workDir, runDate);
        const completenessFile = join(workDir, '31-publish', `${runDate}_17_publish_completeness.json`);
        sted('write', completenessFile, () => writeJqText(completenessFile, { runDate, ...completeness }));
        console.error(
            `publish-completeness: ${completeness.rows.map((row) => `${row.channel}=${row.state}`).join(' ')}`,
        );
        if (completeness.missing.length > 0) {
            const details = completeness.rows
                .filter((row) => row.state !== 'done')
                .map((row) => `${row.channel}=${row.state}${row.detail === '' ? '' : ` (${row.detail})`}`)
                .join('; ');
            console.error(
                `WARNING: publish completeness — ${completeness.missing.join(', ')} did not complete: ${details}. ` +
                    'Side-channel and locale rows never enter publish_status; re-run the relevant stages for this work dir (see ' +
                    `${completenessFile})`,
            );
        }
    });
}

function targetsOf(path: string): Record<string, unknown>[] {
    const targets = readJson(path)?.targets;
    return Array.isArray(targets)
        ? (targets.filter((entry) => entry !== null && typeof entry === 'object') as Record<string, unknown>[])
        : [];
}

/**
 * The publish tail's auxiliary channels (locales, XHS, WeChat) and the surfdash CMS re-sync never
 * enter `publish_status` — only the primary Surfdash + podcast pair does. Locales now validate
 * before the primary Surfdash publish; XHS/WeChat remain non-blocking by design. A
 * tail driven by hand can still skip auxiliary channels and leave a `full` status file behind:
 * 20261002 shipped zh-only surfdash with no XHS and no WeChat draft, and nothing in the run's own
 * artifacts said so. Record each channel's state beside the status file so the gap is visible.
 */
function publishCompleteness(
    workDir: string,
    runDate: string,
): { rows: { channel: string; state: string; detail: string }[]; missing: string[] } {
    const at = (name: string): string => join(workDir, '31-publish', `${runDate}_${name}`);
    const markerFilled = (path: string): boolean => isFile(path) && readFileSync(path, 'utf-8').trim() !== '';
    const rows: { channel: string; state: string; detail: string }[] = [];
    const localesScaffolded = ['en', 'ja'].every((locale) =>
        markerFilled(at(`20_translate-localize_${locale}-post-path.txt`)),
    );
    if (!localesScaffolded) {
        rows.push({
            channel: 'locales',
            state: 'not-run',
            detail: 'translate markers absent (en/ja never scaffolded)',
        });
    } else {
        const validationResultFile = at('24_translate-validate_result.json');
        const legacySyncResultFile = at('24_translate-sync_sync-result.json');
        const hasValidationResult = isFile(validationResultFile);
        const validationResult = hasValidationResult ? readJson(validationResultFile) : null;
        const syncResult = isFile(legacySyncResultFile) ? readJson(legacySyncResultFile) : null;
        if (hasValidationResult) {
            const primaryPublished = targetsOf(at('14_publish-surfdash_result.json')).some(
                (entry) => entry.target === 'surfdash-pub' && entry.ok === true && entry.status === 'published',
            );
            if (validationResult?.ok !== true) {
                rows.push({
                    channel: 'locales',
                    state: 'failed',
                    detail: String(validationResult?.error ?? 'translate-validate receipt is missing or malformed'),
                });
            } else if (!primaryPublished) {
                rows.push({
                    channel: 'locales',
                    state: 'failed',
                    detail: 'local validation passed, but final Surfdash publish did not complete',
                });
            } else {
                const untranslated = ['en', 'ja'].filter((locale) => {
                    const marker = readFileSync(at(`20_translate-localize_${locale}-post-path.txt`), 'utf-8').trim();
                    if (!isFile(marker)) return true;
                    const head = readFileSync(marker, 'utf-8').split('---')[1] ?? '';
                    return /^draft:\s*true\s*$/m.test(head);
                });
                rows.push({
                    channel: 'locales',
                    state: untranslated.length === 0 ? 'done' : 'failed',
                    detail:
                        untranslated.length === 0
                            ? 'en/ja drafts validated and published with the primary Surfdash sync'
                            : `${untranslated.join(', ')} draft is still a scaffold (draft: true) — not translated, so it stays unpublished`,
                });
            }
        } else if (syncResult === null) {
            rows.push({
                channel: 'locales',
                state: 'not-run',
                detail: 'en/ja scaffolded, never synced',
            });
        } else if (syncResult.ok === true) {
            // A filled marker only proves the locale was SCAFFOLDED. The workflow's `translate` agent is
            // what publishes it (its prompt flips `draft: true` → `draft: false`), so a run whose
            // translation failed used to report `locales: done` while the site kept an unpublished
            // scaffold — the one channel whose loss nothing in the run's artifacts named. Read the draft
            // the marker points at: still `draft: true` means it was never translated.
            const untranslated = ['en', 'ja'].filter((locale) => {
                const marker = readFileSync(at(`20_translate-localize_${locale}-post-path.txt`), 'utf-8').trim();
                if (!isFile(marker)) return true;
                const head = readFileSync(marker, 'utf-8').split('---')[1] ?? '';
                return /^draft:\s*true\s*$/m.test(head);
            });
            rows.push({
                channel: 'locales',
                state: untranslated.length === 0 ? 'done' : 'failed',
                detail:
                    untranslated.length === 0
                        ? 'en/ja drafts scaffolded and translated'
                        : `${untranslated.join(', ')} draft is still a scaffold (draft: true) — not translated, so it stays unpublished`,
            });
        } else {
            rows.push({
                channel: 'locales',
                state: 'failed',
                detail: String(syncResult.error ?? 'ok=false'),
            });
        }
    }
    const resultChannels: [string, string, string][] = [
        ['xhs', '19_publish-xhs_result.json', ''],
        ['wechat', '20_publish-wechat_result.json', ''],
        ['cms-resync', '23_patch-surfdash_sync-result.json', '23_patch-surfdash_emdash-resync.txt'],
    ];
    for (const [channel, resultName, skipMarkerName] of resultChannels) {
        const result = isFile(at(resultName)) ? readJson(at(resultName)) : null;
        if (result !== null) {
            const metadata = (result.metadata ?? {}) as Record<string, unknown>;
            rows.push({
                channel,
                state: result.ok === true ? 'done' : 'failed',
                detail:
                    result.ok === true
                        ? typeof metadata.publishStatus === 'string'
                            ? metadata.publishStatus
                            : 'ok'
                        : String(result.error ?? 'ok=false'),
            });
            continue;
        }
        const skipMarker = skipMarkerName === '' ? '' : at(skipMarkerName);
        rows.push(
            skipMarker !== '' && isFile(skipMarker)
                ? { channel, state: 'skipped', detail: readFileSync(skipMarker, 'utf-8').trim() }
                : { channel, state: 'not-run', detail: 'no result artifact' },
        );
    }
    return { rows, missing: rows.filter((row) => row.state !== 'done').map((row) => row.channel) };
}

function dailyPublishPartial(args: string[]): void {
    const [workDir = '', runDate = ''] = args;
    const result = join(workDir, '31-publish', `${runDate}_17_publish_result.json`);
    // The marker describes this run, so it belongs under that run's workDir — a cwd-relative path
    // litters whatever tree the caller stood in and hides the note from the episode it describes.
    const marker =
        workDir === ''
            ? join('.spur', 'run', `publish-partial-${runDate}.txt`)
            : join(workDir, '.spur', 'run', `publish-partial-${runDate}.txt`);
    timed(workDir, 'publish-partial', () => {
        const failed = targetsOf(result)
            .filter((entry) => entry.ok !== true || entry.status !== 'published')
            .map((entry) => `${entry.target ?? ''}`)
            .join(',');
        const list = failed === '' ? '(unparsed)' : failed;
        console.error(`WARNING: partial publish — failed targets: ${list}`);
        sted('mkdir', dirname(marker), () => mkdirSync(dirname(marker), { recursive: true }));
        sted('write', marker, () =>
            writeFileSync(
                marker,
                `${runDate} partial publish: failed targets: ${list} (result.json preserved for kk executor fan-out --retry-from)\n`,
            ),
        );
    });
}

/**
 * Post-publish surfdash healing — a thin delegation to the publisher that owns it (2026-10-12).
 *
 * The work itself (podcast cover URL into `image`/`og_image`, the per-locale podcast cross-link, the
 * local cover's `assets/` fallback, the EmDash re-sync that makes CMS cards carry a servable image,
 * and the pathspec commit + push) lives in the `surfdash-pub` `patch` operation now: it is the
 * publisher's job, and every path that publishes a post needs it. This stage only reads the run's
 * publish results into the operation's payload and reports its outcome.
 *
 * `KK_SURFDASH_PATCH_OFFLINE=1` keeps fixture tests hermetic — the plugin would otherwise write to,
 * commit and push a real checkout.
 */
/**
 * `publish-matrix-partial` (0333): a partial/none window leaves an explicit recovery marker.
 *
 * Reads the window's receipt-derived outcome (written by `publish-matrix-classify`) — the legacy
 * `_17_publish_result.json` aggregate is never an input — names the exact failed target ids, and
 * points at the matrix rerun contract (`kk stage run publish-matrix-send <work_dir> --window <w>
 * --retry`). The rerun is receipt-scoped: `--retry` resends only effect-none failures, never a
 * succeeded or live-uncertain row, so there is no `--retry-from`/`_17` style file replay. A full
 * window deletes any stale marker from a previous attempt, so the report never re-flags recovered
 * targets.
 */
function publishMatrixPartial(args: string[]): void {
    const flag = (name: string): string | undefined => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const workDir = args[0] ?? '';
    const window = flag('--window');
    if (workDir === '' || window === undefined || window === '') {
        failWith(1, 'usage: publish-matrix-partial <work_dir> --window <w>');
    }
    const outcomePath = join(workDir, '4-publish', `outcome.${window}.json`);
    const outcome = requireJson(outcomePath, 'publish-matrix-partial') as {
        status?: string;
        rows?: Array<{ id?: string; status?: string; dummy?: boolean }>;
    };
    const marker = join(workDir, '4-publish', `partial-marker.${window}.txt`);
    timed(workDir, 'publish-matrix-partial', () => {
        if (outcome.status === 'full') {
            if (isFile(marker)) sted('rm', marker, () => unlinkSync(marker));
            return;
        }
        const failed = (outcome.rows ?? [])
            .filter((row) => row.dummy !== true && row.status !== 'succeeded')
            .map((row) => row.id ?? '(unknown)')
            .join(',');
        sted('mkdir', dirname(marker), () => mkdirSync(dirname(marker), { recursive: true }));
        sted('write', marker, () =>
            writeRaw(
                marker,
                `window ${window} ended ${outcome.status ?? 'unknown'}: failed targets: ${failed === '' ? '(unparsed)' : failed}\n` +
                    `recovery: kk stage run publish-matrix-send ${workDir} --window ${window} --retry (resends effect-none failures only; receipts scope the retry)\n`,
            ),
        );
        console.error(`WARNING: partial publish — failed targets: ${failed === '' ? '(unparsed)' : failed}`);
    });
}

/**
 * `publish-matrix-patch-surfdash` (0333): patch podcast links into a real surfdash post.
 *
 * The patch payload is derived from the window's own receipts, not from legacy aggregate files and
 * not from a `KK_SURFDASH_ROOT` argument — the plugin resolves its checkout itself. Evidence rules:
 * the surfdash row must have a real (non-dummy) succeeded receipt whose aggregate metadata carries
 * an absolute `postPath`; without that there is nothing to patch and the stage records an explicit
 * skip result instead of fabricating one. Podcast links ride along only when the podcast row is
 * real too — a dummy or missing episode yields explicit empty `coverUrl`/`showNotesUrl`, never a
 * fabricated link. `KK_SURFDASH_PATCH_OFFLINE=1` keeps rehearsal runs hermetic the same way the
 * legacy voice2 stage does.
 */
function publishMatrixPatchSurfdash(args: string[]): void {
    const flag = (name: string): string | undefined => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const workDir = args[0] ?? '';
    const window = flag('--window');
    if (workDir === '' || window === undefined || window === '') {
        failWith(1, 'usage: publish-matrix-patch-surfdash <work_dir> --window <w>');
    }
    const publishDir = join(workDir, '4-publish');
    const resultPath = join(publishDir, 'patch-surfdash.result.json');
    const writeResult = (value: Record<string, unknown>): void => {
        sted('write', resultPath, () => writeJqText(resultPath, value));
    };
    const receipt = (id: string): Record<string, unknown> | null =>
        readJson(join(publishDir, 'receipts', `${id}.json`));
    const aggregateTarget = (receiptPath: string | undefined): Record<string, unknown> => {
        const aggregate = receiptPath === undefined ? null : readJson(receiptPath);
        const targets = aggregate?.targets;
        if (!Array.isArray(targets) || targets.length === 0 || targets[0] === null || typeof targets[0] !== 'object') {
            return {};
        }
        return targets[0] as Record<string, unknown>;
    };
    timed(workDir, 'publish-matrix-patch-surfdash', () => {
        const outcome = readJson(join(publishDir, `outcome.${window}.json`)) as {
            rows?: Array<{ id?: string }>;
        } | null;
        const rowId = (prefix: string): string | undefined =>
            (outcome?.rows ?? []).map((row) => row.id ?? '').find((id) => id.startsWith(prefix));
        const sdId = rowId('surfdash-pub');
        const podId = rowId('podcast-pub');
        if (sdId === undefined) {
            const error = 'skipped: no surfdash target in this window — nothing to patch';
            writeResult({ ok: false, target: 'surfdash-pub', error });
            console.error(`patch-surfdash: ${error}`);
            return;
        }
        const sdReceipt = receipt(sdId);
        const sdReal = sdReceipt !== null && sdReceipt?.dummy !== true && sdReceipt?.status === 'succeeded';
        const sdTarget = aggregateTarget(
            typeof sdReceipt?.aggregatePath === 'string' ? sdReceipt.aggregatePath : undefined,
        );
        const postPath = (sdTarget.metadata as Record<string, unknown> | undefined)?.postPath;
        if (!sdReal || typeof postPath !== 'string' || postPath === '') {
            const error =
                sdReceipt === null
                    ? 'skipped: no surfdash publish receipt — nothing to patch'
                    : typeof postPath !== 'string' || postPath === ''
                      ? 'skipped: surfdash receipt carries no real postPath — nothing to patch'
                      : 'skipped: surfdash receipt is dummy — nothing to patch';
            writeResult({ ok: false, target: 'surfdash-pub', error });
            console.error(`patch-surfdash: ${error}`);
            return;
        }
        // Links ride along only from real podcast evidence; dummy/missing episodes patch as
        // explicit empty strings — the patch must never fabricate a link.
        const podReceipt = podId === undefined ? null : receipt(podId);
        const podReal = podReceipt !== null && podReceipt?.dummy !== true && podReceipt?.status === 'succeeded';
        const podTarget = aggregateTarget(
            typeof podReceipt?.aggregatePath === 'string' ? podReceipt.aggregatePath : undefined,
        );
        const podMeta = (podTarget.metadata ?? {}) as Record<string, unknown>;
        const runDate = String(readJson(join(publishDir, `outcome.${window}.json`))?.runDate ?? '');
        const compactDate = runDate.replaceAll('-', '');
        const bundle = readJson(join(workDir, 'bundle.json')) as { episode?: { title?: unknown } } | null;
        const identity =
            compactDate.length === 8
                ? (readJson(join(workDir, '21-plan', `${compactDate}_05_script_identity.json`)) as {
                      title?: unknown;
                      status?: unknown;
                  } | null)
                : null;
        const episodeTitle =
            typeof podMeta.episodeTitle === 'string' && podMeta.episodeTitle !== ''
                ? podMeta.episodeTitle
                : identity?.status === 'frozen' && typeof identity.title === 'string'
                  ? identity.title
                  : typeof bundle?.episode?.title === 'string'
                    ? bundle.episode.title
                    : '';
        const payload = join(publishDir, 'patch-surfdash.payload.json');
        sted('write', payload, () =>
            writeJqText(payload, {
                body: '',
                options: {
                    operation: 'patch',
                    postPath,
                    coverUrl: podReal && typeof podMeta.imageUrl === 'string' ? podMeta.imageUrl : '',
                    showNotesUrl: podReal && typeof podTarget.url === 'string' ? podTarget.url : '',
                    ...(episodeTitle !== '' ? { episodeTitle } : {}),
                    ...(compactDate.length === 8
                        ? {
                              dateIso: `${compactDate.slice(0, 4)}-${compactDate.slice(4, 6)}-${compactDate.slice(6, 8)}`,
                          }
                        : {}),
                },
            }),
        );
        if (process.env.KK_SURFDASH_PATCH_OFFLINE === '1') {
            // Offline rehearsals still derive the payload (evidence), but never invoke the plugin.
            writeResult({ ok: false, target: 'surfdash-pub', error: 'skipped: offline (KK_SURFDASH_PATCH_OFFLINE=1)' });
            console.error(
                'patch-surfdash: offline — payload derived, plugin patch skipped (KK_SURFDASH_PATCH_OFFLINE=1)',
            );
            return;
        }
        const status = kk(['executor', 'run', 'surfdash-pub', '--in', payload, '--out', resultPath], {
            unset: NESTED_SPUR_UNSET,
            soft: true,
        });
        const result = readJson(resultPath);
        if (result?.ok === true) {
            const meta = (result.metadata ?? {}) as Record<string, unknown>;
            console.error(
                `patch-surfdash: ${String(result.message ?? 'patched')} — cms-resync ${String(meta.cmsResync ?? 'ok')}`,
            );
            return;
        }
        const meta = (result?.metadata ?? {}) as Record<string, unknown>;
        if (meta.cmsResync === 'failed') {
            // The posts are patched and committed; only the CMS re-sync (a soft channel) failed.
            console.error(
                `patch-surfdash: WARNING: cms re-sync failed — ${String(result?.error ?? `exit ${status}`)}; fix: kk executor run surfdash-pub --in ${payload} --out ${resultPath}`,
            );
            return;
        }
        failWith(1, `patch-surfdash: ${String(result?.error ?? `surfdash-pub patch exited ${status}`)}`);
    });
}

/**
 * `publish-matrix-patch-podcast`: patch the real surfdash article URL into an already-published
 * podcast microfeed item (`complete-article` link), once both Tier 0 targets have real succeeded
 * receipts in the window. Derives `4-publish/patch-podcast.payload.json` + `.result.json`.
 */
function publishMatrixPatchPodcast(args: string[]): void {
    const flag = (name: string): string | undefined => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const workDir = args[0] ?? '';
    const window = flag('--window');
    if (workDir === '' || window === undefined || window === '') {
        failWith(1, 'usage: publish-matrix-patch-podcast <work_dir> --window <w>');
    }
    const publishDir = join(workDir, '4-publish');
    const resultPath = join(publishDir, 'patch-podcast.result.json');
    const writeResult = (value: Record<string, unknown>): void => {
        sted('write', resultPath, () => writeJqText(resultPath, value));
    };
    const receipt = (id: string): Record<string, unknown> | null =>
        readJson(join(publishDir, 'receipts', `${id}.json`));
    const aggregateTarget = (receiptPath: string | undefined): Record<string, unknown> => {
        const aggregate = receiptPath === undefined ? null : readJson(receiptPath);
        const targets = aggregate?.targets;
        if (!Array.isArray(targets) || targets.length === 0 || targets[0] === null || typeof targets[0] !== 'object') {
            return {};
        }
        return targets[0] as Record<string, unknown>;
    };
    timed(workDir, 'publish-matrix-patch-podcast', () => {
        const outcome = readJson(join(publishDir, `outcome.${window}.json`)) as {
            rows?: Array<{ id?: string }>;
        } | null;
        const rowId = (prefix: string): string | undefined =>
            (outcome?.rows ?? []).map((row) => row.id ?? '').find((id) => id.startsWith(prefix));
        const podId = rowId('podcast-pub');
        const sdId = rowId('surfdash-pub');
        if (podId === undefined || sdId === undefined) {
            const error = 'skipped: requires both podcast-pub and surfdash-pub targets in this window';
            writeResult({ ok: false, target: 'podcast-pub', error });
            console.error(`patch-podcast: ${error}`);
            return;
        }
        const podReceipt = receipt(podId);
        const podReal = podReceipt !== null && podReceipt?.dummy !== true && podReceipt?.status === 'succeeded';
        const podTarget = aggregateTarget(
            typeof podReceipt?.aggregatePath === 'string' ? podReceipt.aggregatePath : undefined,
        );
        const podMeta = (podTarget.metadata ?? {}) as Record<string, unknown>;
        const itemId =
            typeof podTarget.id === 'string' && podTarget.id !== ''
                ? podTarget.id
                : typeof podMeta.itemId === 'string' && podMeta.itemId !== ''
                  ? podMeta.itemId
                  : '';
        const sdReceipt = receipt(sdId);
        const sdReal = sdReceipt !== null && sdReceipt?.dummy !== true && sdReceipt?.status === 'succeeded';
        const sdTarget = aggregateTarget(
            typeof sdReceipt?.aggregatePath === 'string' ? sdReceipt.aggregatePath : undefined,
        );
        const sdMeta = (sdTarget.metadata ?? {}) as Record<string, unknown>;
        const postPath = typeof sdMeta.postPath === 'string' ? sdMeta.postPath : '';
        const articleUrl =
            typeof sdMeta.articleUrl === 'string' && /^https?:\/\//i.test(sdMeta.articleUrl)
                ? sdMeta.articleUrl
                : typeof sdTarget.url === 'string' && /^https?:\/\//i.test(sdTarget.url)
                  ? sdTarget.url
                  : '';
        if (!podReal || itemId === '' || !sdReal || (postPath === '' && articleUrl === '')) {
            const error =
                !podReal || itemId === ''
                    ? 'skipped: no real podcast publish receipt/itemId — nothing to patch'
                    : 'skipped: no real surfdash publish receipt/postPath — nothing to patch';
            writeResult({ ok: false, target: 'podcast-pub', error });
            console.error(`patch-podcast: ${error}`);
            return;
        }
        const payload = join(publishDir, 'patch-podcast.payload.json');
        sted('write', payload, () =>
            writeJqText(payload, {
                title: 'patch-article-link',
                format: 'markdown',
                body: '',
                options: {
                    operation: 'patch-article-link',
                    itemId,
                    ...(postPath !== '' ? { postPath } : {}),
                    ...(articleUrl !== '' ? { articleUrl } : {}),
                },
            }),
        );
        if (process.env.KK_PODCAST_PATCH_OFFLINE === '1') {
            writeResult({ ok: false, target: 'podcast-pub', error: 'skipped: offline (KK_PODCAST_PATCH_OFFLINE=1)' });
            console.error(
                'patch-podcast: offline — payload derived, plugin patch skipped (KK_PODCAST_PATCH_OFFLINE=1)',
            );
            return;
        }
        const status = kk(['executor', 'run', 'podcast-pub', '--in', payload, '--out', resultPath], {
            unset: NESTED_SPUR_UNSET,
            soft: true,
        });
        const result = readJson(resultPath);
        if (result?.ok === true) {
            console.error(`patch-podcast: ${String(result.message ?? 'patched')}`);
            return;
        }
        console.error(
            `patch-podcast: WARNING: ${String(result?.error ?? `podcast-pub patch-article-link exited ${status}`)}`,
        );
    });
}

/**
 * The day's zh post path when this run's content sits uncommitted in the surfdash checkout.
 *
 * `surfdash-pub` writes the post and its `assets/` into the checkout before it syncs the CMS, and the
 * daily patch stage is the only step that commits them. A publish that fails, or a window whose plan
 * excludes the surfdash target, leaves the write behind with no commit, so the deploy never sees the
 * post — its `./assets/cover.png` 404s on the live site while the run reports only a warning. This
 * finds that state (untracked or modified paths under `content/posts` whose slug starts with the run
 * date) so the patch can heal it instead of looking at a missing receipt and skipping.
 */
function strandedSurfdashPost(root: string, runDate: string): string | undefined {
    const listed = spawnSync('git', ['-C', root, 'status', '--porcelain', '-z', '--', 'content/posts'], {
        encoding: 'utf-8',
    });
    if (listed.status !== 0) return undefined;
    const slugs = new Set<string>();
    // `-z` entries are `XY <path>` NUL-separated, so the status prefix plus its space is 3 chars.
    for (const entry of (listed.stdout ?? '').split('\u0000')) {
        const match = /content\/posts\/articles\/(?:zh|en|ja)\/([^/]+)/.exec(entry.slice(3));
        const slug = match?.[1];
        if (slug?.startsWith(runDate)) slugs.add(slug);
    }
    for (const slug of slugs) {
        const zh = join(root, 'content', 'posts', 'articles', 'zh', slug, 'index.md');
        if (isFile(zh)) return zh;
    }
    return undefined;
}

function dailyPatchSurfdash(args: string[]): void {
    const [workDir = '', runDate = '', surfdashRoot = '', pluginsPath = ''] = args;
    if (!surfdashRoot || !existsSync(surfdashRoot)) {
        console.error(`patch-surfdash: surfdash root '${surfdashRoot}' not found — skip`);
        return;
    }
    timed(workDir, 'patch-surfdash', () => {
        const sdResult = join(workDir, '31-publish', `${runDate}_14_publish-surfdash_result.json`);
        const podcastResult = join(workDir, '31-publish', `${runDate}_16_publish-podcast_result.json`);
        const resultPath = join(workDir, '31-publish', `${runDate}_23_patch-surfdash_sync-result.json`);
        const invalidReceipt = (path: string): boolean => {
            const parsed = readJson(path);
            return (
                !isFile(path) ||
                parsed === null ||
                !Array.isArray(parsed.targets) ||
                parsed.targets.length === 0 ||
                !parsed.targets.every(
                    (target) => target !== null && typeof target === 'object' && !Array.isArray(target),
                )
            );
        };
        const sdUsable = !invalidReceipt(sdResult);
        const podUsable = !invalidReceipt(podcastResult);
        const targetOf = (path: string): Record<string, unknown> => {
            const parsed = readJson(path) as { targets?: Array<Record<string, unknown>> };
            return parsed.targets?.[0] ?? {};
        };
        const sd = sdUsable ? targetOf(sdResult) : {};
        const pod = podUsable ? targetOf(podcastResult) : {};
        const receiptPath = (sd.metadata as Record<string, unknown> | undefined)?.postPath;
        const fromReceipt = typeof receiptPath === 'string' && receiptPath !== '' ? receiptPath : undefined;
        // The publisher writes the post and its `assets/` into the checkout *before* it syncs the CMS,
        // and only this stage commits them. A publish that fails — or a window whose plan excludes the
        // surfdash target (2026-11-20: `not in --channels list`) — leaves that write behind with no
        // commit, so the deploy never sees the post and its `./assets/cover.png` 404s while the run
        // reports nothing worse than a warning. Heal that state instead of skipping it.
        const stranded = fromReceipt === undefined ? strandedSurfdashPost(surfdashRoot, runDate) : undefined;
        const postPath = fromReceipt ?? stranded;
        if (postPath === undefined) {
            if (!sdUsable || !podUsable) {
                const error = 'patch-surfdash: malformed surfdash/podcast publish receipt — nothing to patch';
                sted('write', resultPath, () => writeJqText(resultPath, { ok: false, target: 'surfdash-pub', error }));
                console.error(error);
                return;
            }
            // A surfdash publish that never landed (2026-10-21: its `git push` was rejected with
            // `fetch first`) leaves no postPath to patch. `publish-classify` has already recorded the
            // run as `partial`, and failing here turned a published podcast episode into a `failed`
            // run — the folded tail must not escalate what the classifier already routed.
            console.error('patch-surfdash: surfdash result carries no postPath — nothing to patch, skip');
            return;
        }
        if (fromReceipt === undefined) {
            console.error(
                `patch-surfdash: no surfdash publish receipt, but ${relative(surfdashRoot, postPath)} is uncommitted in the checkout — patching it so the deploy ships the post and its cover`,
            );
        }
        if (process.env.KK_SURFDASH_PATCH_OFFLINE === '1') {
            // The marker keeps the completeness report's cms-resync row honest in offline runs.
            const skipMarker = join(workDir, '31-publish', `${runDate}_23_patch-surfdash_emdash-resync.txt`);
            sted('write', skipMarker, () => writeRaw(skipMarker, 'skipped: offline (KK_SURFDASH_PATCH_OFFLINE=1)\n'));
            console.error('patch-surfdash: offline — skip the plugin patch (KK_SURFDASH_PATCH_OFFLINE=1)');
            return;
        }
        const payload = join(workDir, '31-publish', `${runDate}_23_patch-surfdash_patch.json`);
        const podcastMeta = (pod.metadata ?? {}) as Record<string, unknown>;
        // 0385 R4: the episode's frozen identity title is what the podcast ships (`第<issue>期 · <headline>`).
        // The article states the same identity — the site renders it under its own SEO title, and the
        // zh cross-link names it — so the two surfaces cannot carry different episode names.
        const identity = readJson(join(workDir, '21-plan', `${runDate}_05_script_identity.json`)) as {
            title?: unknown;
            status?: unknown;
        } | null;
        const episodeTitle = identity?.status === 'frozen' && typeof identity.title === 'string' ? identity.title : '';
        if (episodeTitle === '') {
            console.error(
                `patch-surfdash: no frozen episode identity in 21-plan/${runDate}_05_script_identity.json — the article keeps the series · date wording`,
            );
        }
        sted('write', payload, () =>
            writeJqText(payload, {
                body: '',
                options: {
                    operation: 'patch',
                    postPath,
                    coverUrl: typeof podcastMeta.imageUrl === 'string' ? podcastMeta.imageUrl : '',
                    showNotesUrl: typeof pod.url === 'string' ? pod.url : '',
                    dateIso: `${runDate.slice(0, 4)}-${runDate.slice(4, 6)}-${runDate.slice(6, 8)}`,
                    localCover: join(workDir, '23-cover', `${runDate}_07_cover_cover.png`),
                    episodeTitle,
                },
            }),
        );
        const status = kk(
            ['executor', 'run', 'surfdash-pub', '--in', payload, '--out', resultPath, ...pluginsArgs(pluginsPath)],
            { unset: NESTED_SPUR_UNSET, env: { SURFDASH_ROOT: surfdashRoot }, soft: true },
        );
        const result = isFile(resultPath) ? readJson(resultPath) : null;
        const meta = (result?.metadata ?? {}) as Record<string, unknown>;
        if (result?.ok === true) {
            console.error(
                `patch-surfdash: ${String(result.message ?? 'patched')} — cms-resync ${String(meta.cmsResync ?? 'ok')}, commit ${String(meta.gitCommit ?? 'unchanged')}${Array.isArray(meta.absentLocales) && meta.absentLocales.length > 0 ? `, no post for ${(meta.absentLocales as string[]).join('/')}` : ''}`,
            );
            return;
        }
        // The posts are patched and committed; only the EmDash rows keep the unservable cover. That is
        // the soft channel the completeness report carries, so warn instead of failing the run.
        if (meta.cmsResync === 'failed') {
            console.error(
                `patch-surfdash: WARNING: cms re-sync failed — ${String(result?.error ?? `exit ${status}`)}; fix: kk executor run surfdash-pub --in ${payload} --out ${resultPath}${pluginsArgs(pluginsPath).join(' ')}`,
            );
            return;
        }
        failWith(1, `patch-surfdash: ${String(result?.error ?? `surfdash-pub patch exited ${status}`)}`);
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
    const cands = join(workDir, '21-plan', `${runDate}_19_run-report_episode-plan.json`);
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    timed(workDir, 'run-report', () => {
        if (isFile(reportMd)) {
            console.error(`run report cached: ${reportMd}`);
            return;
        }
        if (!isFile(candidates)) {
            console.error('run-report: no candidates.json (run ended below plan step) — skip');
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
                    '21-plan',
                    `${runDate}_04_quality-control-content_candidates.rejected.json`,
                ),
                NEWS_REPORT_TIMING_FILE: join(absWorkDir, 'step-timing.json'),
                // 0139 R5b: the generate stage's QC audit, read best-effort (absent -> section omitted).
                NEWS_REPORT_QC_FILE: join(absWorkDir, '30-audio', `${runDate}_11_generate_content.json`),
                // 20260917 funnel: the plan stage's full selection trail (every fetched title +
                // scores + disposition), rendered as the 选稿漏斗 section (absent -> omitted).
                NEWS_REPORT_PLAN_AUDIT_FILE: join(absWorkDir, '21-plan', `${runDate}_03_plan_plan.json.audit.json`),
                // 20260917 funnel: the blended fan-in input, rendered as the 语料构成
                // source/category composition (absent -> omitted).
                NEWS_REPORT_BLENDED_FILE: join(absWorkDir, '10-ingest', `${runDate}_02_collect_blended.json`),
                // F613 R5: the script stage's Content, read best-effort (absent -> 脚本来源 omitted).
                NEWS_REPORT_SCRIPT_FILE: join(absWorkDir, '24-script', `${runDate}_08_script_content.json`),
                // 20261016: the independent publish channels (xhs/wechat/locales/cms-resync) never
                // enter publish_status, so the report is where an empty draft box becomes visible.
                // Written by the `daily-publish-completeness` stage that precedes this one.
                NEWS_REPORT_COMPLETENESS_FILE: join(
                    absWorkDir,
                    '31-publish',
                    `${runDate}_17_publish_completeness.json`,
                ),
                NEWS_REPORT_DATE: runDate,
            },
        });
        const body = readJson(reportJson)?.body;
        if (typeof body !== 'string') failWith(1, `run-report: ${reportJson} has no string body`);
        sted('write', reportMd, () => writeRaw(reportMd, body));
        console.error(`run report written: ${reportMd}`);
    });
}

const [stage, ...rest] = process.argv.slice(2);

// Imported as a module (unit tests reach `dedupPlanByTitle` / `applyTopicBoundary`) → exports
// only, never a stage run;
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
        case 'collect-prepare':
            collectPrepare(rest);
            break;
        case 'daily-extract': {
            const { dailyExtract } = await loadDailyStages();
            dailyExtract(rest);
            break;
        }
        case 'daily-plan': {
            const { dailyPlan } = await loadDailyStages();
            dailyPlan(rest);
            break;
        }
        case 'daily-qc-content': {
            const { dailyQcContent } = await loadDailyStages();
            dailyQcContent(rest);
            break;
        }
        case 'daily-article': {
            const { dailyArticle } = await loadDailyStages();
            dailyArticle(rest);
            break;
        }
        case 'daily-cover': {
            const { dailyCover } = await loadDailyStages();
            dailyCover(rest);
            break;
        }
        case 'daily-cover-normalize': {
            const { dailyCoverNormalize } = await loadDailyStages();
            dailyCoverNormalize(rest);
            break;
        }
        case 'daily-xhs-render': {
            const { dailyXhsRender } = await loadDailyStages();
            dailyXhsRender(rest);
            break;
        }
        case 'daily-script-style': {
            const { dailyScriptStyle } = await loadDailyStages();
            dailyScriptStyle(rest);
            break;
        }
        case 'daily-script-check': {
            const { dailyScriptCheck } = await loadDailyStages();
            dailyScriptCheck(rest);
            break;
        }
        case 'daily-curate-check': {
            const { dailyCurateCheck } = await loadDailyStages();
            dailyCurateCheck(rest);
            break;
        }
        case 'daily-editorial-render': {
            const { dailyEditorialRender } = await loadDailyStages();
            dailyEditorialRender(rest);
            break;
        }
        case 'news-editorial-commit': {
            // 0384 R4/R10: the judgment commit is async (the ledger's LockPort is promise-shaped).
            const { newsEditorialCommit } = await loadDailyStages();
            await newsEditorialCommit(rest);
            break;
        }
        case 'daily-script': {
            const { dailyScript } = await loadDailyStages();
            dailyScript(rest);
            break;
        }
        case 'audio-quality': {
            const { runAudioQuality } = await loadAudioQuality();
            await runAudioQuality(rest);
            break;
        }
        case 'daily-preflight': {
            const { dailyPreflight } = await loadDailyStages();
            dailyPreflight(rest);
            break;
        }
        case 'daily-safety-manifest': {
            const { dailySafetyManifest } = await loadDailyStages();
            dailySafetyManifest(rest);
            break;
        }
        case 'daily-safety-prep': {
            const { dailySafetyPrep } = await loadDailyStages();
            dailySafetyPrep(rest);
            break;
        }
        case 'daily-safety-gate': {
            const { dailySafetyGate } = await loadDailyStages();
            dailySafetyGate(rest);
            break;
        }
        case 'daily-safety-verdict': {
            const { dailySafetyVerdict } = await loadDailyStages();
            dailySafetyVerdict(rest);
            break;
        }
        case 'daily-safety-revise': {
            const { dailySafetyRevise } = await loadDailyStages();
            dailySafetyRevise(rest);
            break;
        }
        case 'daily-wrap-docs': {
            const { dailyWrapDocs } = await loadDailyStages();
            dailyWrapDocs(rest);
            break;
        }
        case 'daily-generate': {
            const { dailyGenerate } = await loadDailyStages();
            dailyGenerate(rest);
            break;
        }
        case 'daily-intro': {
            const { dailyIntro } = await loadDailyStages();
            dailyIntro(rest);
            break;
        }
        case 'daily-voice-audit': {
            const { dailyVoiceAudit } = await loadDailyStages();
            dailyVoiceAudit(rest);
            break;
        }
        case 'daily-episode-duration': {
            const { dailyEpisodeDuration } = await loadDailyStages();
            dailyEpisodeDuration(rest);
            break;
        }
        case 'daily-quality-report': {
            const { dailyQualityReport } = await loadDailyStages();
            dailyQualityReport(rest);
            break;
        }
        case 'daily-quality-verdict': {
            const { dailyQualityVerdict } = await loadDailyStages();
            dailyQualityVerdict(rest);
            break;
        }
        case 'daily-publish-prep': {
            const { dailyPublishPrep } = await loadDailyStages();
            dailyPublishPrep(rest);
            break;
        }
        case 'daily-publish-surfdash': {
            const { dailyPublishSurfdash } = await loadDailyStages();
            dailyPublishSurfdash(rest);
            break;
        }
        case 'daily-prepare-surfdash': {
            const { dailyPrepareSurfdash } = await loadDailyStages();
            dailyPrepareSurfdash(rest);
            break;
        }
        case 'daily-show-notes': {
            const { dailyShowNotes } = await loadDailyStages();
            dailyShowNotes(rest);
            break;
        }
        case 'daily-publish-podcast': {
            const { dailyPublishPodcast } = await loadDailyStages();
            dailyPublishPodcast(rest);
            break;
        }
        case 'daily-publish-xhs': {
            const { dailyPublishXhs } = await loadDailyStages();
            dailyPublishXhs(rest);
            break;
        }
        case 'daily-publish-wechat': {
            const { dailyPublishWechat } = await loadDailyStages();
            dailyPublishWechat(rest);
            break;
        }
        case 'daily-bundle-variants': {
            const { dailyBundleVariants } = await loadDailyStages();
            dailyBundleVariants(rest);
            break;
        }
        case 'daily-publish-classify':
            dailyPublishClassify(rest);
            break;
        case 'daily-publish-completeness':
            dailyPublishCompleteness(rest);
            break;
        case 'audio-prune': {
            const { dailyAudioPrune } = await loadDailyStages();
            dailyAudioPrune(rest);
            break;
        }
        case 'daily-patch-surfdash':
            dailyPatchSurfdash(rest);
            break;
        case 'daily-publish-partial':
            dailyPublishPartial(rest);
            break;
        case 'publish-matrix-partial':
            publishMatrixPartial(rest);
            break;
        case 'publish-matrix-patch-surfdash':
            publishMatrixPatchSurfdash(rest);
            break;
        case 'publish-matrix-patch-podcast':
            publishMatrixPatchPodcast(rest);
            break;
        case 'daily-run-report':
            dailyRunReport(rest);
            break;
        case 'daily-translate-localize': {
            const { dailyTranslateLocalize } = await loadDailyStages();
            dailyTranslateLocalize(rest);
            break;
        }
        case 'daily-surfdash-refine': {
            const { dailySurfdashRefine } = await loadDailyStages();
            dailySurfdashRefine(rest);
            break;
        }
        case 'daily-translate-sync': {
            const { dailyTranslateSync } = await loadDailyStages();
            dailyTranslateSync(rest);
            break;
        }
        case 'daily-translate-validate': {
            const { dailyTranslateValidate } = await loadDailyStages();
            dailyTranslateValidate(rest);
            break;
        }
        case 'news-localize-validate': {
            const { newsLocalizeValidate } = await loadDailyStages();
            newsLocalizeValidate(rest);
            break;
        }
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
        case 'music-prepare':
        case 'music-explore':
        case 'music-select':
        case 'music-analyze':
        case 'music-judge-input':
        case 'music-finalize': {
            const { runMusicStage } = await loadMusicStages();
            runMusicStage(stage, rest);
            break;
        }
        case 'seo-preflight':
        case 'seo-collect':
        case 'seo-check':
        case 'seo-enrich':
        case 'seo-judge':
        case 'seo-score':
        case 'seo-report': {
            // The seo helper owns its dispatch: cancellation installation, the cancellation marker
            // and the conventional signal exit status must apply however the stage was reached.
            const { runSeoStage } = await loadSeoStages();
            try {
                await runSeoStage(stage, rest);
            } catch (err: unknown) {
                fail(err instanceof Error ? err.message : String(err));
            }
            break;
        }
        default:
            fail(
                `unknown stage: ${stage ?? '(none)'} (expected prepare-itc|prepare-solo|prepare-storm|validate|wrap|duration|render-storm|itc-*|daily-*|seo-*|music-*)`,
            );
    }
