import { isAbsolute, join } from 'node:path';
import { buildVaultIndex, type PageType, summarizePage, synthesizePage, type VaultIndex } from '@gobing-ai/kk-wiki';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { consoleOutput, toJson } from '../output';
import { resolveWikiConfig, WikiConfigError } from './config';

/**
 * `kk wiki summarize` and `kk wiki synthesize` (task 0352).
 *
 * Both verbs take agent-authored text on stdin (`--from -`) or from a file and perform only
 * deterministic placement: section rendering, reference linking, frontmatter upkeep and the
 * `user_edited` guard. No provider call happens here.
 */

/** One CLI invocation's outcome. */
export interface WikiWriteOutcome {
    ok: boolean;
    code: 0 | 1 | 2;
    payload: unknown;
}

/** Shared inputs for the two write verbs. */
export interface WikiWriteOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    /** Target page path or topic title. */
    target: string;
    /** Text source: `-` for stdin, or a file path. */
    from: string;
    type?: string;
    json?: boolean;
    date?: string;
    readStdin?: () => Promise<string>;
}

async function readMaterial(options: WikiWriteOptions): Promise<string> {
    if (options.from === '-') {
        if (options.readStdin !== undefined) return options.readStdin();
        const chunks: Uint8Array[] = [];
        for await (const chunk of Bun.stdin.stream()) chunks.push(chunk);
        return Buffer.concat(chunks).toString('utf8');
    }
    // A relative text source resolves against the invocation cwd, matching `ingest`.
    const path = isAbsolute(options.from) ? options.from : join(options.cwd ?? process.cwd(), options.from);
    return createNodeFileSystem().readFile(path);
}

async function resolveContext(
    options: WikiWriteOptions,
): Promise<{ index: VaultIndex; contentDir: string } | { error: string }> {
    try {
        const config = await resolveWikiConfig({ cwd: options.cwd, env: options.env });
        const index = await buildVaultIndex(config.content);
        return { index, contentDir: config.content };
    } catch (error) {
        if (error instanceof WikiConfigError) return { error: error.message };
        throw error;
    }
}

/** `kk wiki summarize <file|dir> --from <stdin|path> [--json]`. */
export async function runSummarize(options: WikiWriteOptions): Promise<WikiWriteOutcome> {
    const context = await resolveContext(options);
    if ('error' in context) return { ok: false, code: 1, payload: { error: context.error } };
    const target = context.index.pages.find((page) => page.path === options.target);
    if (target === undefined) {
        return { ok: false, code: 1, payload: { error: `no page at '${options.target}'` } };
    }
    const material = await readMaterial(options);
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    const result = summarizePage(context.index, target, material, { date });
    await createNodeFileSystem().writeFile(join(context.contentDir, result.path), result.text);
    return { ok: true, code: 0, payload: { ok: true, path: result.path, guard: result.guard, links: result.links } };
}

/** `kk wiki synthesize <topic|file> --from <stdin|path> [--type <pageType>] [--json]`. */
export async function runSynthesize(options: WikiWriteOptions): Promise<WikiWriteOutcome> {
    const context = await resolveContext(options);
    if ('error' in context) return { ok: false, code: 1, payload: { error: context.error } };
    const material = await readMaterial(options);
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    const type = options.type as PageType | undefined;
    const result = synthesizePage(context.index, { target: options.target, material, type, date });
    await createNodeFileSystem().writeFile(join(context.contentDir, result.path), result.text);
    return {
        ok: true,
        code: 0,
        payload: { ok: true, path: result.path, slug: result.slug, guard: result.guard, created: result.created },
    };
}

/** Render one write outcome (JSON document or a one-line summary). */
export function printWriteOutcome(outcome: WikiWriteOutcome, json: boolean): void {
    if (json) {
        consoleOutput.write(toJson(outcome.payload));
        return;
    }
    const payload = outcome.payload as { error?: string; path?: string; guard?: string; created?: boolean };
    if (payload.error !== undefined) {
        consoleOutput.error(`kk.wiki.write: ${payload.error}`);
        return;
    }
    consoleOutput.write(
        `${payload.created === true ? 'created' : 'updated'} ${payload.path} (guard: ${payload.guard})`,
    );
}
