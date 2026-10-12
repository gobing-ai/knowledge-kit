import type { RunCaptureInput, WorkflowName } from '@gobing-ai/kk-board/contracts';
import { type Command, CommanderError } from 'commander';
import { captureRun, parseSetting } from '../board/capture';
import { WORKFLOW_NAMES } from '../board/manifest';
import { createBoardReader, DEFAULT_BOARD_PORT } from '../board/reader';
import { consoleOutput } from '../output';

/**
 * `kk board` — the local Board reader and the run-capture seam
 * (docs/design/workflow-board-modules.md §9).
 *
 * `serve` runs the read-only loopback reader in the foreground; `capture` binds a run id to
 * its workspace and sanitized settings. Neither verb mutates Spur state or runs a workflow.
 */

/** Options accepted by `kk board serve`. */
interface ServeOptions {
    boardOrigin: string;
    port: number;
}

/** Options accepted by `kk board capture`. */
interface CaptureOptions {
    workflow: string;
    run: string;
    workDir: string;
    stamp: string;
    definitionDigest?: string;
    setting: string[];
}

/**
 * Fail loud: print the `kk.board.<verb>.failed: <cause>` contract line and throw a
 * `CommanderError` that `main()` maps to exit code 1.
 */
function failLoud(code: string, error: unknown): never {
    const cause = error instanceof Error ? error.message : String(error);
    const message = `${code}: ${cause}`;
    consoleOutput.error(message);
    throw new CommanderError(1, code, message);
}

/** Parse `--port`: an integer in range, rejected loudly otherwise. */
function parsePort(raw: string): number {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port must be an integer 0-65535, got '${raw}'`);
    }
    return port;
}

/**
 * `kk board serve --board-origin <origin> [--port <n>]` — run the loopback reader in the
 * foreground until terminated (no scheduler, no daemon).
 */
async function serveAction(options: ServeOptions): Promise<void> {
    try {
        const reader = createBoardReader({ boardOrigin: options.boardOrigin, port: options.port });
        consoleOutput.write(JSON.stringify({ reader: reader.url, boardOrigin: options.boardOrigin }));
        // The entrypoint exits as soon as the command returns, so serve owns the process
        // lifetime explicitly; termination stops it with the process.
        await new Promise<never>(() => {});
    } catch (error) {
        failLoud('kk.board.serve.failed', error);
    }
}

/**
 * `kk board capture --workflow <name> --run <id> --work-dir <dir> --stamp <stamp>
 * [--definition-digest <sha256:…>] [--setting <key=value>]…`.
 *
 * A refused revocation throws (the caller must not overwrite results); after a successful
 * revocation an optional capture failure only warns and reports `captured: false`.
 */
async function captureAction(options: CaptureOptions): Promise<void> {
    try {
        if (!WORKFLOW_NAMES.includes(options.workflow as WorkflowName)) {
            throw new Error(`--workflow must be one of ${WORKFLOW_NAMES.join(', ')}, got '${options.workflow}'`);
        }
        const workflow = options.workflow as WorkflowName;
        const settings: Record<string, string> = {};
        for (const raw of options.setting) {
            const parsed = parseSetting(workflow, raw);
            if (parsed !== null) settings[parsed.key] = parsed.value;
        }
        const input: RunCaptureInput = {
            workflow,
            runId: options.run,
            workDir: options.workDir,
            stamp: options.stamp,
            settings,
            ...(options.definitionDigest === undefined || options.definitionDigest === ''
                ? {}
                : { definitionDigest: options.definitionDigest }),
        };
        const outcome = await captureRun(input);
        consoleOutput.write(
            JSON.stringify({
                revoked: outcome.revoked,
                captured: outcome.captured,
                runId: options.run,
                workflow,
                workspacePath: outcome.record?.workspacePath ?? options.workDir,
                diagnostics: outcome.diagnostics,
            }),
        );
    } catch (error) {
        failLoud('kk.board.capture.failed', error);
    }
}

/** Register the `kk board` noun (`serve`, `capture`). */
export function registerBoardCommand(program: Command): void {
    const board = program.command('board').description('Local Board reader and run capture');

    board
        .command('serve')
        .description('Serve the read-only loopback reader for the current project')
        .requiredOption('--board-origin <origin>', 'Exact Board origin allowed to call the reader')
        .option('--port <n>', 'Loopback port (default: 4340)', String(DEFAULT_BOARD_PORT))
        .action(async (options: { boardOrigin: string; port: string }) =>
            serveAction({ boardOrigin: options.boardOrigin, port: parsePort(options.port) }),
        );

    board
        .command('capture')
        .description('Bind a run id to its workspace and sanitized settings (local preparation)')
        .requiredOption('--workflow <name>', `Workflow name (${WORKFLOW_NAMES.join(', ')})`)
        .requiredOption('--run <id>', 'Run id (single safe path segment)')
        .requiredOption(
            '--work-dir <dir>',
            'Run workspace inside a works root (.works/ or works/); a relative path resolves against the project',
        )
        .requiredOption('--stamp <stamp>', 'Run stamp (alphanumerics, dash, underscore, T/Z)')
        .option('--definition-digest <digest>', 'Definition digest sha256:<64 hex>')
        .option('--setting <key=value>', 'Allowlisted effective setting (repeatable)', collectSetting, [])
        .action(captureAction);
}

/** Collect repeated `--setting` values in order. */
function collectSetting(value: string, previous: string[]): string[] {
    return [...previous, value];
}
