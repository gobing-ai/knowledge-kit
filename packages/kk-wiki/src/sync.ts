/**
 * `sync` mechanics (task 0359): resolve a configured remote adapter into an argv.
 *
 * The command template comes from `kk.config.json` (`wiki.remotes.<name>.command`); this module only
 * substitutes the two placeholders and reports the plan. Execution is the caller's decision, so a
 * dry run is free.
 */

/** One resolved remote invocation. */
export interface ResolvedRemote {
    argv: string[];
    remote: string;
    command: string;
}

/** A remote name that the config does not declare. */
export class UnknownRemoteError extends Error {
    constructor(
        override readonly name: string,
        readonly declared: string[],
    ) {
        super(`unknown remote '${name}' (declared: ${declared.length === 0 ? 'none' : declared.join(', ')})`);
        this.name = 'UnknownRemoteError';
    }
}

/** Resolve `{content}` and `{remote}` in the declared command template. */
export function resolveRemote(
    remotes: Record<string, { command: string; remote: string }>,
    name: string,
    substitutions: { content: string },
): ResolvedRemote {
    const declared = Object.keys(remotes).sort();
    const entry = remotes[name];
    if (entry === undefined) throw new UnknownRemoteError(name, declared);
    const command = entry.command.replaceAll('{content}', substitutions.content).replaceAll('{remote}', entry.remote);
    return { argv: command.split(/\s+/).filter((part) => part !== ''), remote: entry.remote, command };
}
