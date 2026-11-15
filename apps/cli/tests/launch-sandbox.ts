/**
 * The launch sandbox shared by the launch e2e suites (0365, 0369): a throwaway project root with a
 * temp works dir and store, a `spur` shell stub that records every invocation, and the stub workflow
 * YAMLs under `tests/fixtures/workflows/`. Moved verbatim out of `content-launch.e2e.test.ts`.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

export const repoRoot = resolve(import.meta.dir, '../../..');
const fixtures = join(import.meta.dir, 'fixtures', 'workflows');

export const STUB = `#!/bin/sh
# spur stand-in for the launch e2e (0365): every branch is selected by an env var the test sets.
# A \`*-generate\` run also freezes the bundle its real counterpart would, so \`publish\` has
# something to admit — the launch contract, not the DAG, is what this suite exercises.
printf '%s\\n' "$*" >> "\${KK_STUB_LOG}"
case "$*" in
  *"agent run"*)
    if [ "\${KK_STUB_PROBE:-ok}" = "dead" ]; then
      echo "quota exhausted for scribe" >&2
      exit 1
    fi
    echo "OK"
    exit 0
    ;;
  *"workflow cancel"*) exit 0 ;;
  *"workflow trace"*) echo '{"entries":[]}'; exit 0 ;;
  *"workflow run"*)
    vars=""
    for a in "$@"; do
      case "$a" in
        {*) vars="$a" ;;
      esac
    done
    workdir=$(printf '%s' "$vars" | sed -n 's/.*"work_dir":"\\([^"]*\\)".*/\\1/p')
    rundate=$(printf '%s' "$vars" | sed -n 's/.*"run_date":"\\([^"]*\\)".*/\\1/p')
    case "\${KK_STUB_CHILD:-ok}" in
      fail) echo "node voice failed" >&2; exit 1 ;;
      slow) sleep 5; exit 0 ;;
    esac
    case "$*" in
      *"-generate.yaml"*)
        if [ -n "$workdir" ]; then
          mkdir -p "$workdir/4-publish"
          printf '{"schemaVersion":1,"runId":"stub-run","runDate":"%s","variants":{}}\\n' "$rundate" \
            > "$workdir/4-publish/bundle.json"
        fi
        ;;
    esac
    exit 0
    ;;
esac
exit 0
`;

export interface Project {
    root: string;
    works: string;
    logPath: string;
    env: Record<string, string>;
    /** Every stub invocation so far, one per line. */
    log(): string[];
    workflowRuns(): string[];
    count(needle: string): number;
    restore(): void;
}

export interface ProjectOptions {
    child?: 'ok' | 'fail' | 'slow';
    probe?: 'ok' | 'dead';
    contentTypes?: string;
}

/** A throwaway project root: temp works dir, temp store, stub spur, stub workflows. */
export function project(options: ProjectOptions = {}): Project {
    const root = mkdtempSync(join(tmpdir(), 'kk-launch-e2e-'));
    const works = join(root, 'works');
    const bin = join(root, 'bin');
    const logPath = join(root, 'stub.log');
    const configFile = join(root, 'config.yaml');
    mkdirSync(bin, { recursive: true });
    mkdirSync(works, { recursive: true });
    writeFileSync(logPath, '');
    writeFileSync(join(bin, 'spur'), STUB);
    chmodSync(join(bin, 'spur'), 0o755);
    writeFileSync(
        configFile,
        [
            `works_dir: ${works}`,
            `workflows_dir: ${fixtures}`,
            'store:',
            `  db_path: ${join(root, 'kk.db')}`,
            options.contentTypes ?? '',
            '',
        ].join('\n'),
    );
    // The launcher's package root = this temp dir while the case runs: `plugins` rides a symlink to
    // the checkout, so presets, the writer skill and the workflow YAMLs still resolve, while the
    // preflight's dirty-path check reads this repository instead of the mid-task checkout.
    symlinkSync(join(repoRoot, 'plugins'), join(root, 'plugins'));
    runGit(root, ['init', '-q', '.']);
    runGit(root, ['add', '-A']);
    runGit(root, ['commit', '-q', '-m', 'harness root', '--no-verify']);
    const previousCwd = process.cwd();
    process.chdir(root);
    const saved = {
        PATH: process.env.PATH,
        KK_CONFIG: process.env.KK_CONFIG,
        KK_SPUR_BIN: process.env.KK_SPUR_BIN,
        KK_STUB_LOG: process.env.KK_STUB_LOG,
        KK_STUB_CHILD: process.env.KK_STUB_CHILD,
        KK_STUB_PROBE: process.env.KK_STUB_PROBE,
        KK_WORKS_DIR: process.env.KK_WORKS_DIR,
    };
    process.env.PATH = `${bin}:${saved.PATH ?? ''}`;
    process.env.KK_CONFIG = configFile;
    process.env.KK_SPUR_BIN = join(bin, 'spur');
    process.env.KK_STUB_LOG = logPath;
    process.env.KK_STUB_CHILD = options.child ?? 'ok';
    process.env.KK_STUB_PROBE = options.probe ?? 'ok';
    delete process.env.KK_WORKS_DIR;
    const log = (): string[] =>
        readFileSync(logPath, 'utf8')
            .split('\n')
            .filter((line) => line.trim() !== '');
    return {
        root,
        works,
        logPath,
        env: { ...(process.env as Record<string, string>) },
        log,
        workflowRuns: () => log().filter((line) => line.includes('workflow run')),
        count: (needle: string) => log().filter((line) => line.includes(needle)).length,
        restore: () => {
            process.chdir(previousCwd);
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        },
    };
}

/** One deterministic `git` call inside the throwaway root (the harness repository). */
function runGit(cwd: string, args: string[]): void {
    const result = Bun.spawnSync({
        cmd: [
            'git',
            '-c',
            'user.name=kk-harness',
            '-c',
            'user.email=kk-harness@example.invalid',
            '-c',
            'commit.gpgsign=false',
            ...args,
        ],
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
}

export async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const captured = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: captured.read(), stderr: captured.readErr() };
    } finally {
        captured.restore();
    }
}
