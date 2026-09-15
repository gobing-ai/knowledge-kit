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
 *
 * `validate` / `wrap` / `render-storm` resolve the shipped sibling sidecars and delegate to them;
 * nothing about those sidecars changed. The `prepare-*` verbs and `duration` keep the logic that
 * used to live inline in `plugins/kk/workflows/*.yaml`, message-for-message.
 *
 * Node/Bun builtins only — no @gobing-ai/* and no relative imports (the file is resolved from the
 * installed package or from a checkout).
 *
 * The YAML prelude resolves this file as `$pkg/plugins/kk/scripts/kk-workflow-stages.ts` where `pkg`
 * comes from the `command -v kk` symlink walk. When `kk` is absent from PATH that walk yields an empty
 * `kbin`, `dirname(dirname(""))` is `.`, and the prelude therefore probes
 * `./plugins/kk/scripts/kk-workflow-stages.ts` — that cwd-relative path is the deliberate checkout
 * tier kk-storm-research's render has always relied on, not an accident.
 *
 * SYNC: plugins/kk/workflows/{kk-solo-podcast,kk-itc,kk-storm-research}.yaml shell this script. Keep
 * message substrings stable — apps/cli/tests/kk-workflow-stages.test.ts and the three workflow
 * static tests match them.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const SCRIPTS_DIR = import.meta.dir;
const VALIDATE_SIDECAR = 'validate-voicescript.ts';
const WRAP_SIDECAR = 'wrap-voicescript-doc.ts';
const RENDER_SIDECAR = 'render-md.ts';
const REVISE_COUNT = '.revise-count';

function fail(message: string): never {
    console.error(message);
    process.exit(1);
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

const [stage, ...rest] = process.argv.slice(2);

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
        delegate(requireSidecar(override, WRAP_SIDECAR, 'wrap_script'), [values.in, values.out, values.profile ?? '']);
        break;
    }
    case 'render-storm': {
        const { override, values } = parseStage(rest, { in: { type: 'string' }, out: { type: 'string' } });
        if (!values.in || !values.out) {
            fail('usage: kk-workflow-stages.ts render-storm [<override>] --in <content.json> --out <content.md>');
        }
        delegate(requireSidecar(override, RENDER_SIDECAR, 'render_script'), ['--in', values.in, '--out', values.out]);
        break;
    }
    default:
        fail(
            `unknown stage: ${stage ?? '(none)'} (expected prepare-itc|prepare-solo|prepare-storm|validate|wrap|duration|render-storm)`,
        );
}
