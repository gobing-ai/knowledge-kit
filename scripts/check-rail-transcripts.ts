#!/usr/bin/env bun
/**
 * `rail-transcript-header` checker (task 0382 R8).
 *
 * A channel rail that names no recording is a rail whose selectors were guessed — the failure this
 * task exists to end. Every `plugins/publishings/<plugin>/src/*rail*.ts` and `*flow*.ts` module
 * (excluding generated rails) must therefore carry ONE header line, on its first twenty lines:
 *
 *     // transcript: <repo path>
 *     // transcript: none — <reason>
 *
 * The reason arm is not a loophole: it forces the author to say why no recording exists, which a
 * reviewer can reject. Passing explicit files is the seam the self-test uses.
 *
 * LEGACY REGISTRY (`--legacy=<path>`, repeatable). Rails that predate this task are exempt by name,
 * declared in the rule YAML, and reported as a NOTICE on every run — never silently skipped. The
 * exemption is deliberate: those files are exercised only against live sites, so annotating them
 * would drag untestable modules into the changed-file coverage floor without teaching anyone
 * anything. A rail NOT in the registry is judged, which is what keeps a new rail honest.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Root the sweep starts from; overridable so a caller can point at another tree. */
const DEFAULT_ROOT = 'plugins/publishings';

/** How far into a module the header may sit before it stops being a header. */
const HEADER_WINDOW = 20;

/** Modules a rail change can be measured through. */
const RAIL_PATTERN = /(rail|flow)[^/]*\.ts$/;

/** The header contract: a named source, or `none` followed by a reason. */
const HEADER_PATTERN = /^\s*\/\/\s*transcript:\s*(?:none\s*[—–-]\s*\S.*|(?!none\b)\S.*)$/;

/** A finding, kept structured so callers can format or assert on it. */
export interface RailHeaderFinding {
    file: string;
    reason: 'missing-header' | 'empty-reason';
}

/** Registry entries and explicit files, split so `--legacy` never doubles as a check target. */
export function splitArgs(args: string[]): { legacy: string[]; explicit: string[] } {
    const legacy: string[] = [];
    const explicit: string[] = [];
    for (const arg of args) {
        if (arg.startsWith('--legacy=')) legacy.push(arg.slice('--legacy='.length));
        else if (!arg.startsWith('-')) explicit.push(arg);
    }
    return { legacy, explicit };
}

/** Every registry entry that resolves on disk, with its human line. */
export function legacyNotices(legacy: string[]): string[] {
    return legacy.map(
        (path) => `NOTE: ${relative(process.cwd(), path)} predates the rail-transcript rule and is exempt`,
    );
}

/** Collect every rail/flow module under `root`, skipping generated rails and test trees. */
export function railModules(root: string = DEFAULT_ROOT): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name === '.venv') continue;
                walk(path);
                continue;
            }
            if (!RAIL_PATTERN.test(entry.name) || /\.generated\.ts$/.test(entry.name)) continue;
            if (path.includes('/src/')) found.push(path);
        }
    };
    walk(root);
    return found.sort();
}

/** Judge one module: does it carry a usable `// transcript:` header? */
export function checkRailHeader(path: string): RailHeaderFinding | null {
    const window = readFileSync(path, 'utf8').split('\n').slice(0, HEADER_WINDOW);
    const line = window.find((candidate) => /^\s*\/\/\s*transcript:/.test(candidate));
    if (line === undefined) return { file: path, reason: 'missing-header' };
    if (!HEADER_PATTERN.test(line)) return { file: path, reason: 'empty-reason' };
    return null;
}

/** Judge every module in the list; one finding per offending module. */
export function checkRailHeaders(paths: string[]): RailHeaderFinding[] {
    return paths.map(checkRailHeader).filter((finding): finding is RailHeaderFinding => finding !== null);
}

/** Human/CI output for one finding. */
export function formatFinding(finding: RailHeaderFinding): string {
    const file = relative(process.cwd(), finding.file);
    return finding.reason === 'missing-header'
        ? `INVALID: ${file}: rail module carries no \`// transcript:\` header — name the recording it was measured from, or \`// transcript: none — <reason>\``
        : `INVALID: ${file}: \`// transcript: none\` gives no reason — say why no recording exists`;
}

/** Outcome of one CLI invocation, so the caller decides the exit code. */
export interface CliResult {
    ok: boolean;
    checked: number;
    findings: RailHeaderFinding[];
}

/** Where a checker line goes: stdout carries the `--json` report, stderr the human lines. */
export type CliSink = (channel: 'out' | 'err', text: string) => void;

/** Run the checker over `args`; the sink is injected so the leaf is testable in-process. */
export function runCli(args: string[], sink: CliSink): CliResult {
    const { legacy, explicit } = splitArgs(args);
    const exempt = new Set(legacy.map((path) => join(path)));
    const candidates = explicit.length > 0 ? explicit : railModules(process.env.RAIL_ROOT ?? DEFAULT_ROOT);
    const files: string[] = [];
    for (const path of candidates) if (!exempt.has(join(path))) files.push(path);
    const findings = checkRailHeaders(files);
    for (const notice of legacyNotices(legacy)) sink('err', `${notice}\n`);
    for (const finding of findings) sink('err', `${formatFinding(finding)}\n`);
    const result = { ok: findings.length === 0, checked: files.length, findings };
    if (args.includes('--json')) sink('out', `${JSON.stringify(result, null, 2)}\n`);
    return result;
}

/** Route one line to the process stream it belongs on. */
function writeToProcess(channel: 'out' | 'err', text: string): void {
    const stream = channel === 'out' ? process.stdout : process.stderr;
    stream.write(text);
}

/** Process wiring: run the checker against real argv and return the exit code. */
export function cliMain(argv: string[]): number {
    return runCli(argv, writeToProcess).ok ? 0 : 1;
}

if (import.meta.main) process.exit(cliMain(process.argv.slice(2)));
