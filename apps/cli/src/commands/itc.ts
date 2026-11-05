import { type Command, CommanderError } from 'commander';
import { type ItcCandidatesOptions, runItcCandidates } from '../itc-candidates';
import { consoleOutput } from '../output';

/** Default parent-run id for `kk itc candidates` when the operator does not pin one. */
function defaultParentRunId(): string {
    return `kk-itc-cand-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
}

interface ItcCandidatesCliOptions {
    profile: string;
    parentRun?: string;
    intakeDir?: string;
    window?: string;
    limit?: string;
    db?: string;
}

function failLoud(error: unknown): never {
    const cause = error instanceof Error ? error.message : String(error);
    const message = `kk.itc.candidates.failed: ${cause}`;
    consoleOutput.error(message);
    throw new CommanderError(1, 'kk.itc.candidates.failed', message);
}

/** `kk itc candidates` — one collected-topic sweep: extract pool → shortlist → validate → decision. */
async function candidatesAction(options: ItcCandidatesCliOptions): Promise<void> {
    const limit = options.limit === undefined ? undefined : Number(options.limit);
    if (!Number.isInteger(limit) || (limit as number) <= 0) {
        failLoud(new Error(`--limit must be a positive integer, got '${options.limit ?? ''}'`));
    }
    const request: ItcCandidatesOptions = {
        profile: options.profile,
        parentRunId: options.parentRun ?? defaultParentRunId(),
        ...(options.intakeDir ? { intakeDir: options.intakeDir } : {}),
        ...(options.window ? { window: options.window } : {}),
        ...(limit ? { limit } : {}),
        ...(options.db ? { dbPath: options.db } : {}),
    };
    try {
        const result = await runItcCandidates(request);
        consoleOutput.write(JSON.stringify({ intakeDir: result.intakeDir, poolCount: result.poolCount }));
    } catch (error) {
        failLoud(error);
    }
}

/** Register the `itc` noun: kk-itc operator helpers that are not workflow stage bodies. */
export function registerItcCommand(program: Command): void {
    const itc = program.command('itc').description('IT content authoring (kk-itc) operator helpers');

    itc.command('candidates')
        .description(
            'Run the collected-topic shortlist sweep: itc-topic-extract -> topic-candidates.json -> ' +
                'itc-topic-validate -> itc-decision (kk-itc-topic-choice); prints the shortlist and the served ' +
                'decision (defer is an outcome, not an error). Follow with kk stage run itc-topic-select.',
        )
        .requiredOption('--profile <slug>', 'Extraction topic profile (e.g. it-topics, ai-news)')
        .option('--parent-run <id>', 'Parent run id every artifact binds to (default timed kk-itc-cand-…)', undefined)
        .option('--intake-dir <dir>', 'Intake dir (default: ./.itc-intake/<parent-run>)', undefined)
        .option('--window <w>', 'Collection window <n>s|m|h|d', '24h')
        .option('--limit <n>', 'Pool cap forwarded to the extract', '20')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)', undefined)
        .action(candidatesAction);
}
