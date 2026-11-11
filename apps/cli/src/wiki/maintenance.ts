import { join } from 'node:path';
import { applyGc, buildVaultIndex, compileIndex, mergePages, needsWrite, planGc } from '@gobing-ai/kk-wiki';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { consoleOutput, toJson } from '../output';
import { resolveWikiConfig, WikiConfigError } from './config';

/**
 * `kk wiki merge`, `kk wiki compile` and `kk wiki gc` (task 0358).
 *
 * Each verb is deterministic and confined: merge writes the surviving page, the redirect stub and
 * the inbound-link rewrites; compile writes only the two compiled files; gc deletes nothing without
 * `--yes` and skips every configured mirror directory.
 */

/** One CLI invocation's outcome. */
export interface WikiMaintenanceOutcome {
    ok: boolean;
    code: 0 | 1 | 2;
    payload: unknown;
}

/** Shared inputs for the maintenance verbs. */
export interface WikiMaintenanceOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    json?: boolean;
    date?: string;
    /** merge: source and target page paths. */
    from?: string;
    to?: string;
    /** gc: delete instead of printing the plan. */
    yes?: boolean;
}

async function withConfig<T>(
    options: WikiMaintenanceOptions,
    run: (context: { contentDir: string; rawDir: string; mirrors: string[] }) => Promise<T>,
): Promise<T | { error: string }> {
    try {
        const config = await resolveWikiConfig({ cwd: options.cwd, env: options.env });
        return await run({ contentDir: config.content, rawDir: config.raw, mirrors: config.mirrors });
    } catch (error) {
        if (error instanceof WikiConfigError) return { error: error.message };
        throw error;
    }
}

/** `kk wiki merge <source> <target> [--json]`. */
export async function runMerge(options: WikiMaintenanceOptions): Promise<WikiMaintenanceOutcome> {
    const result = await withConfig(options, async ({ contentDir }) => {
        const index = await buildVaultIndex(contentDir);
        const merge = mergePages(index, options.from ?? '', options.to ?? '', {
            date: options.date ?? new Date().toISOString().slice(0, 10),
        });
        if (merge.guard === 'refused') return { refused: true as const, path: merge.written };
        const fs = createNodeFileSystem();
        await fs.writeFile(join(contentDir, merge.written), merge.targetText);
        const sourcePage = index.pages.find((page) => page.slug === merge.sourceSlug);
        if (sourcePage !== undefined) await fs.writeFile(join(contentDir, sourcePage.path), merge.sourceText);
        for (const page of merge.rewrittenPages) await fs.writeFile(join(contentDir, page.path), page.text);
        return {
            refused: false as const,
            path: merge.written,
            redirects: merge.redirects,
            rewritten: merge.rewritten,
            rewrittenPages: merge.rewrittenPages,
            sourceText: merge.sourceText,
            sourceSlug: merge.sourceSlug,
        };
    });
    if ('error' in result) return { ok: false, code: 1, payload: result };
    if (result.refused === true) {
        return { ok: false, code: 1, payload: { ok: false, error: 'source page is user_edited; merge refused' } };
    }
    return { ok: true, code: 0, payload: { ok: true, ...result } };
}

/** `kk wiki compile [--json]`. */
export async function runCompile(options: WikiMaintenanceOptions): Promise<WikiMaintenanceOutcome> {
    const result = await withConfig(options, async ({ contentDir }) => {
        const index = await buildVaultIndex(contentDir);
        const compiled = compileIndex(index.pages, { date: options.date ?? new Date().toISOString().slice(0, 10) });
        const fs = createNodeFileSystem();
        const written: string[] = [];
        for (const [name, rendered] of [
            ['index.md', compiled.index],
            ['MAP.md', compiled.map],
        ] as const) {
            const path = join(contentDir, name);
            const current = (await fs.exists(path)) ? await fs.readFile(path) : null;
            if (!needsWrite(current, rendered)) continue;
            await fs.writeFile(path, rendered);
            written.push(name);
        }
        return { written };
    });
    if ('error' in result) return { ok: false, code: 1, payload: result };
    return { ok: true, code: 0, payload: { ok: true, ...result } };
}

/** `kk wiki gc [--yes] [--json]`. */
export async function runGc(options: WikiMaintenanceOptions): Promise<WikiMaintenanceOutcome> {
    const result = await withConfig(options, async ({ contentDir, rawDir, mirrors }) => {
        const fs = createNodeFileSystem();
        const index = await buildVaultIndex(contentDir);
        const plan = await planGc(index, { rawDir, mirrors, fileSystem: fs });
        if (options.yes !== true) return { plan, deleted: [] as string[] };
        const { deleted } = await applyGc(plan, fs);
        return { plan, deleted };
    });
    if ('error' in result) return { ok: false, code: 1, payload: result };
    return { ok: true, code: 0, payload: { ok: true, ...result } };
}

/** Render one maintenance outcome (JSON document or a line per result). */
export function printMaintenanceOutcome(outcome: WikiMaintenanceOutcome, json: boolean): void {
    if (json) {
        consoleOutput.write(toJson(outcome.payload));
        return;
    }
    const payload = outcome.payload as {
        error?: string;
        path?: string;
        redirects?: number;
        rewritten?: string[];
        written?: string[];
        plan?: { delete: string[]; keep: string[]; skippedMirrors: string[] };
        deleted?: string[];
    };
    if (payload.error !== undefined) {
        consoleOutput.error(`kk.wiki: ${payload.error}`);
        return;
    }
    if (payload.plan !== undefined) {
        for (const path of payload.plan.delete) consoleOutput.write(`delete: ${path}`);
        for (const path of payload.plan.skippedMirrors) consoleOutput.write(`skip (mirror): ${path}`);
        if ((payload.deleted ?? []).length === 0) consoleOutput.write('dry run — pass --yes to delete');
        return;
    }
    if (payload.rewritten !== undefined) {
        consoleOutput.write(`merged into ${payload.path} (${payload.redirects} links rewritten)`);
        return;
    }
    for (const name of payload.written ?? []) consoleOutput.write(`compiled: ${name}`);
    if ((payload.written ?? []).length === 0) consoleOutput.write('already up to date');
}
