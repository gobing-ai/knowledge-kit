import { buildVaultIndex, packContext, publishVault, rankPages, resolveRemote } from '@gobing-ai/kk-wiki';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { consoleOutput, toJson } from '../output';
import { resolveWikiConfig, WikiConfigError } from './config';

/**
 * `kk wiki publish`, `kk wiki sync`, `kk wiki query` and `kk wiki context` (task 0354).
 *
 * Publish projects the vault into a Quartz tree, sync resolves a configured remote into an argv
 * (never executing it in a dry run), and the two retrieval verbs return ranked pages or a packed
 * graph block. None of them calls a provider.
 */

/** One CLI invocation's outcome. */
export interface WikiRetrievalOutcome {
    ok: boolean;
    code: 0 | 1 | 2;
    payload: unknown;
}

/** Shared inputs for the retrieval and transport verbs. */
export interface WikiRetrievalOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    json?: boolean;
    /** publish target directory / sync remote name / query prompt / context topic. */
    value?: string;
    dryRun?: boolean;
    limit?: number;
    depth?: number;
}

async function configOrError(options: WikiRetrievalOptions) {
    try {
        return await resolveWikiConfig({ cwd: options.cwd, env: options.env });
    } catch (error) {
        if (error instanceof WikiConfigError) return { error: error.message };
        throw error;
    }
}

/** `kk wiki publish --target <dir> [--json]`. */
export async function runPublish(options: WikiRetrievalOptions): Promise<WikiRetrievalOutcome> {
    const config = await configOrError(options);
    if ('error' in config) return { ok: false, code: 1, payload: config };
    try {
        const index = await buildVaultIndex(config.content);
        const result = await publishVault(index, {
            target: options.value ?? '',
            fileSystem: createNodeFileSystem(),
        });
        if (result.refused !== undefined) {
            return { ok: false, code: 2, payload: { ok: false, error: 'target is inside the vault' } };
        }
        return { ok: true, code: 0, payload: { ok: true, ...result } };
    } catch (error) {
        return { ok: false, code: 1, payload: { ok: false, error: (error as Error).message } };
    }
}

/** `kk wiki sync <remote> [--dry-run] [--json]`. */
export async function runSync(options: WikiRetrievalOptions): Promise<WikiRetrievalOutcome> {
    const config = await configOrError(options);
    if ('error' in config) return { ok: false, code: 1, payload: config };
    try {
        const resolved = resolveRemote(config.remotes, options.value ?? '', { content: config.content });
        return { ok: true, code: 0, payload: { ok: true, dryRun: options.dryRun !== false, ...resolved } };
    } catch (error) {
        return { ok: false, code: 2, payload: { ok: false, error: (error as Error).message } };
    }
}

/** `kk wiki query <prompt> [--limit <n>] [--json]`. */
export async function runQuery(options: WikiRetrievalOptions): Promise<WikiRetrievalOutcome> {
    const config = await configOrError(options);
    if ('error' in config) return { ok: false, code: 1, payload: config };
    const index = await buildVaultIndex(config.content);
    const hits = rankPages(index, options.value ?? '', { limit: options.limit });
    return { ok: true, code: 0, payload: { ok: true, hits } };
}

/** `kk wiki context <topic> [--depth <n>] [--json]`. */
export async function runContext(options: WikiRetrievalOptions): Promise<WikiRetrievalOutcome> {
    const config = await configOrError(options);
    if ('error' in config) return { ok: false, code: 1, payload: config };
    const index = await buildVaultIndex(config.content);
    const packed = packContext(index, options.value ?? '', { depth: options.depth });
    return { ok: true, code: 0, payload: { ok: true, ...packed } };
}

/** Render one retrieval outcome (JSON document or a human-readable summary). */
export function printRetrievalOutcome(outcome: WikiRetrievalOutcome, json: boolean): void {
    if (json) {
        consoleOutput.write(toJson(outcome.payload));
        return;
    }
    const payload = outcome.payload as {
        error?: string;
        files?: string[];
        command?: string;
        hits?: { path: string; score: number }[];
        markdown?: string;
    };
    if (payload.error !== undefined) {
        consoleOutput.error(`kk.wiki: ${payload.error}`);
        return;
    }
    if (payload.files !== undefined) {
        consoleOutput.write(`published ${payload.files.length} file(s)`);
        return;
    }
    if (payload.command !== undefined) {
        consoleOutput.write(`remote: ${payload.command}`);
        return;
    }
    if (payload.hits !== undefined) {
        for (const hit of payload.hits) consoleOutput.write(`${hit.path} (${hit.score})`);
        return;
    }
    consoleOutput.write(payload.markdown ?? '');
}
