#!/usr/bin/env bun
/**
 * Deterministic stage runner for kk-solo-podcast (ADR-115 composition owner).
 *
 * The workflow YAML keeps one short resolution block and delegates every
 * multi-command stage here, so each shell action stays a single logical call:
 *
 *   prepare <work_dir> <topic> <input_file> <voice_profile> <force>
 *   validate [<override>] --in <voicescript.yaml>
 *   wrap     [<override>] --in <voicescript.yaml> --out <docs.json> [--profile <name>]
 *   duration <work_dir> <target_duration_min>
 *
 * `validate` / `wrap` resolve the shipped sibling sidecars (the caller's
 * $KK_WORKFLOWS_DIR / ~/.config/kk/workflows override winning when it exists) and
 * delegate to them — nothing about those sidecars changed. `prepare` / `duration`
 * keep the logic that used to live inline in the workflow, message-for-message.
 *
 * Node/Bun builtins only — no @gobing-ai/* and no relative imports (the file may be
 * resolved from the installed package or copied next to the workflow).
 *
 * SYNC: plugins/kk/workflows/kk-solo-podcast.yaml (prepare / script-validate /
 * wrap-docs / duration-check states shell this script). Keep message substrings
 * stable — apps/cli/tests/kk-solo-podcast-workflow.test.ts and
 * apps/cli/tests/solo-podcast-stages.test.ts match them.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const SCRIPTS_DIR = import.meta.dir;
const VALIDATE_SIDECAR = 'validate-voicescript.ts';
const WRAP_SIDECAR = 'wrap-voicescript-doc.ts';

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

/** `[ -f ]` semantics: a path exists AND is a regular file (a directory must not pass). */
function isFile(path: string): boolean {
    return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * Runtime override chain, in the order the workflow used to resolve it inline:
 * explicit var → `KK_WORKFLOWS_DIR` → the shipped package copy → `~/.config/kk/workflows`.
 * The package copy sits BEFORE the config-dir copy on purpose (F8 R1): the shipped bytes win
 * unless the operator elected that directory as an override.
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

/** Fail loud with the remediation path when no copy of a sidecar exists. */
function requireSidecar(override: string, sidecar: string): string {
    const resolved = resolveSidecar(override, sidecar);
    if (!isFile(resolved)) {
        fail(
            `${sidecar} not found (searched: $KK_WORKFLOWS_DIR, the kk package scripts dir, $HOME/.config/kk/workflows) — install the kk package or place an override with /workflow-run kk-solo-podcast --force`,
        );
    }
    return resolved;
}

/** Run a shipped sibling under the same bun runtime, passing stdout/stderr and the exit code through. */
function delegate(sidecar: string, args: string[]): never {
    const runner = spawnSync(process.execPath, [sidecar, ...args], { stdio: 'inherit' });
    process.exit(runner.status ?? 1);
}

function bumpReviseCount(workDir: string): void {
    const path = join(workDir, '.revise-count');
    const previous = Number.parseInt(isFile(path) ? readFileSync(path, 'utf-8') : '', 10);
    writeFileSync(path, `${(Number.isNaN(previous) ? 0 : previous) + 1}\n`);
}

function prepare(args: string[]): void {
    const [workDirArg, topic = '', inputFile = '', voiceProfile = '', force = 'false'] = args;
    if (!workDirArg) fail('missing work_dir');
    const workDir = resolve(workDirArg);
    mkdirSync(join(workDir, '2-outline'), { recursive: true });
    mkdirSync(join(workDir, '4-audio'), { recursive: true });
    if (topic && inputFile) fail('XOR violation: both topic and input_file set');
    if (!topic && !inputFile) fail('XOR violation: neither topic nor input_file set');
    if (!voiceProfile && !process.env.VOICEBOX_DEFAULT_PROFILE) {
        fail('missing voice_profile (set vars.voice_profile or VOICEBOX_DEFAULT_PROFILE)');
    }
    const briefPath = join(workDir, 'brief.md');
    if (isFile(briefPath) && force !== 'true') {
        fail(`initialization target already exists at ${workDirArg}/brief.md; pass force=true to replace`);
    }
    if (topic) {
        writeFileSync(briefPath, `${topic}\n`);
    } else {
        if (!isFile(inputFile)) fail(`input file not found: ${inputFile}`);
        copyFileSync(inputFile, briefPath);
    }
    writeFileSync(join(workDir, '.revise-count'), '0\n');
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
    rmSync(okPath, { force: true });
    if (!isFile(contentPath)) return;

    let raw: unknown;
    try {
        const parsed = JSON.parse(readFileSync(contentPath, 'utf-8')) as { metadata?: { duration?: unknown } };
        raw = parsed.metadata?.duration;
    } catch {
        raw = undefined;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        writeFileSync(
            join(workDir, '.duration-feedback'),
            'Regenerate: audio metadata.duration missing or not a number.\n',
        );
        bumpReviseCount(workDir);
        return;
    }
    const targetSeconds = targetMinutes * 60;
    if (raw >= targetSeconds * 0.5 && raw <= targetSeconds * 2) {
        writeFileSync(okPath, '');
        return;
    }
    writeFileSync(
        join(workDir, '.duration-feedback'),
        `Regenerate: last audio duration ${raw}s outside 0.5x–2x of ${targetSeconds}s; adjust segment lengths toward the target.\n`,
    );
    bumpReviseCount(workDir);
}

/** Positional override (arg 0) + `--flag value` options, for the delegating stages. */
function parseStage(
    rest: string[],
    options: Record<string, { type: 'string' }>,
): { override: string; values: Record<string, string | undefined> } {
    const { values, positionals } = parseArgs({ args: rest, options, allowPositionals: true });
    return {
        override: positionals[0] ?? '',
        values: values as Record<string, string | undefined>,
    };
}

const [stage, ...rest] = process.argv.slice(2);

switch (stage) {
    case 'prepare':
        prepare(rest);
        break;
    case 'duration':
        duration(rest);
        break;
    case 'validate': {
        const { override, values } = parseStage(rest, { in: { type: 'string' } });
        if (!values.in) fail(`usage: solo-podcast-stages.ts validate [<override>] --in <voicescript.yaml>`);
        delegate(requireSidecar(override, VALIDATE_SIDECAR), ['--in', values.in]);
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
                `usage: solo-podcast-stages.ts wrap [<override>] --in <voicescript.yaml> --out <docs.json> [--profile <name>]`,
            );
        }
        delegate(requireSidecar(override, WRAP_SIDECAR), [values.in, values.out, values.profile ?? '']);
        break;
    }
    default:
        fail(`unknown stage: ${stage ?? '(none)'} (expected prepare|validate|wrap|duration)`);
}
