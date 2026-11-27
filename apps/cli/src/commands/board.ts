import type { RunCaptureInput, WorkflowName } from '@gobing-ai/kk-board/contracts';
import { type Command, CommanderError } from 'commander';
import { captureRun, parseSetting } from '../board/capture';
import { WORKFLOW_NAMES, workflowFamily } from '../board/manifest';
import { consoleOutput } from '../output';
import { resolveWorksDir } from './daily';

/** Options accepted by `kk board capture`. */
interface CaptureOptions {
    workflow: string;
    run: string;
    workDir: string;
    stamp: string;
    definitionDigest?: string;
    /** A configured works root whose canonical CHILD may be captured (external ITC workspace). */
    trustedRoot?: string;
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
        // §9: an external ITC workspace must be a canonical child of a trusted works root. The ITC
        // default lives under the configured works dir (`$works_dir/kk-itc/<kebab>`), so that root is
        // the binding unless the caller names one explicitly; broad roots are still refused.
        const trustedRoot =
            options.trustedRoot ?? (workflowFamily(workflow) === 'kk-itc' ? resolveWorksDir() : undefined);
        const outcome = await captureRun(input, trustedRoot === undefined ? {} : { trustedWorksRoot: trustedRoot });
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

/** Register the `kk board` noun (`capture`). */
export function registerBoardCommand(program: Command): void {
    const board = program.command('board').description('Board run capture');

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
        .option(
            '--trusted-root <dir>',
            'Configured works root whose canonical child workspace may be captured (external runs)',
        )
        .option('--setting <key=value>', 'Allowlisted effective setting (repeatable)', collectSetting, [])
        .action(captureAction);
}

/** Collect repeated `--setting` values in order. */
function collectSetting(value: string, previous: string[]): string[] {
    return [...previous, value];
}
