import { type Command, CommanderError } from 'commander';
import { createProgram } from './cli';
import { normalizeStageArgs } from './commands/stage';
import { consoleOutput } from './output';

/** Optional overrides for main()'s output writers (test capture / embedding). */
export interface MainOptions {
    /** Override for commander stdout output (defaults to the project logger). */
    stdout?: (text: string) => void;
    /** Override for commander stderr output (defaults to the project logger). */
    stderr?: (text: string) => void;
}

/**
 * Run the kk CLI and return the process exit code.
 *
 * Commander runs under exitOverride so help/version/error paths throw a
 * CommanderError instead of calling process.exit; the exit code is the
 * error's exitCode (0 for help/version). The entrypoint owns the real
 * `process.exit(await main())` — command modules never call process.exit.
 *
 * `argv` must be the full process argv including the node/script prefix (as
 * `index.ts` passes it): `main()` slices off `argv.slice(2)`, so passing bare
 * args like `main(['invoke', '--help'])` yields the full-program help.
 */
export async function main(argv: string[] = process.argv, options: MainOptions = {}): Promise<number> {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({
        // Default writers route through the ts-utils output seam (consoleOutput →
        // echo/echoError), never process.stdout/stderr directly (surface rule
        // no-raw-stdout-stderr). Callers may override for test capture.
        writeOut: options.stdout ?? ((text: string) => consoleOutput.write(text)),
        writeErr: options.stderr ?? ((text: string) => consoleOutput.error(text)),
    });
    // Subcommands copied _exitCallback/_outputConfiguration at creation, before the
    // calls above; re-inherit through every level so `kk help <cmd>`, nested groups
    // (e.g. `plugins list`, `store lock acquire`) and their help/error paths honor both
    // (otherwise they fall through to process.exit and the default writers).
    const inheritSettings = (parent: Command): void => {
        for (const child of parent.commands) {
            child.copyInheritedSettings(parent);
            inheritSettings(child);
        }
    };
    inheritSettings(program);
    const userArgs = argv.slice(2);
    const isHelpOrVersion =
        userArgs.length === 0 ||
        userArgs[0] === 'help' ||
        ['--help', '-h', '--version', '-V'].some((flag) => userArgs.includes(flag));
    const previousExitCode = process.exitCode;
    // Commander help inherits process.exitCode; isolate explicit help/version from earlier signal exits.
    if (isHelpOrVersion) process.exitCode = 0;
    try {
        // Bare invocation (no args at all): print help and exit 0. Commander 15
        // otherwise routes missing-subcommand to help({error:true}) → exit 1.
        if (userArgs.length === 0) {
            program.help();
        }
        // Legacy `kk stage <stage>` spelling → canonical `stage run <stage>` before Commander
        // parses (A22 R2 / ADR-037): the stage name is data, not a command word.
        await program.parseAsync(normalizeStageArgs(argv));
        return 0;
    } catch (err) {
        if (err instanceof CommanderError) {
            // Content nouns reserve exit 2 for Commander usage errors, including an option
            // rejected before the noun action runs (`kk news --type …`). The older command
            // surface keeps its historical Commander exit code for compatibility.
            if (err.code === 'commander.unknownOption' && (userArgs[0] === 'article' || userArgs[0] === 'news')) {
                return 2;
            }
            return err.exitCode;
        }
        throw err;
    } finally {
        if (isHelpOrVersion) process.exitCode = previousExitCode;
    }
}
