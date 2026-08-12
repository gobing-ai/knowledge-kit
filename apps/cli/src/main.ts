import { logger } from '@gobing-ai/utils';
import { CommanderError } from 'commander';
import { createProgram } from './cli';

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
        // Default writers route through the project output seam (@gobing-ai/utils
        // logger → Bun.write), never process.stdout/stderr directly (surface rule
        // no-raw-stdout-stderr). Callers may override for test capture.
        writeOut: options.stdout ?? ((text: string) => logger.out(text)),
        writeErr: options.stderr ?? ((text: string) => logger.error(text)),
    });
    // Subcommands copied _exitCallback/_outputConfiguration at creation, before the
    // calls above; re-inherit so `kk help <cmd>` and subcommand help honor both
    // (otherwise they fall through to process.exit and the default writers).
    for (const cmd of program.commands) {
        cmd.copyInheritedSettings(program);
        // Nested groups (e.g. `plugins list`/`plugins doctor`) also copied the
        // pre-seam settings at creation; re-inherit so their help honors the
        // configured writers and the exitOverride seam instead of calling
        // process.exit directly.
        for (const sub of cmd.commands) {
            sub.copyInheritedSettings(cmd);
        }
    }
    try {
        // Bare invocation (no args at all): print help and exit 0. Commander 15
        // otherwise routes missing-subcommand to help({error:true}) → exit 1.
        const userArgs = argv.slice(2);
        if (userArgs.length === 0) {
            program.help();
        }
        await program.parseAsync(argv);
        return 0;
    } catch (err) {
        if (err instanceof CommanderError) {
            return err.exitCode;
        }
        throw err;
    }
}
