import { buildVaultIndex, findMentions, fixLinks } from '@gobing-ai/kk-wiki';
import { consoleOutput, toJson } from '../output';
import { resolveWikiConfig, WikiConfigError } from './config';

/** `kk wiki link [--fix]` (task 0351): report unlinked mentions, or inject them on request. */

/** One CLI invocation's outcome. */
export interface WikiLinkOutcome {
    ok: boolean;
    code: 0 | 1 | 2;
    payload: unknown;
}

/** Inputs for one `kk wiki link` run. */
export interface WikiLinkOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    fix?: boolean;
    json?: boolean;
    /** Local date stamp for the guard section (defaults to today). */
    date?: string;
}

/** Report (or repair) unlinked mentions of existing page titles. */
export async function runLink(options: WikiLinkOptions = {}): Promise<WikiLinkOutcome> {
    let contentDir: string;
    try {
        contentDir = (await resolveWikiConfig({ cwd: options.cwd, env: options.env })).content;
    } catch (error) {
        if (error instanceof WikiConfigError) return { ok: false, code: 1, payload: { error: error.message } };
        throw error;
    }
    const index = await buildVaultIndex(contentDir);
    const date = options.date ?? new Date().toISOString().slice(0, 10);
    if (options.fix !== true) {
        const mentions = findMentions(index);
        return { ok: true, code: 0, payload: { ok: true, fix: false, mentions } };
    }
    const result = await fixLinks(index, { date, contentDir });
    return { ok: true, code: 0, payload: { ok: true, fix: true, ...result } };
}

/** Render one link outcome (JSON document or a line per mention / changed page). */
export function printLinkOutcome(outcome: WikiLinkOutcome, json: boolean): void {
    if (json) {
        consoleOutput.write(toJson(outcome.payload));
        return;
    }
    const payload = outcome.payload as {
        error?: string;
        fix?: boolean;
        mentions?: { path: string; line: number; slug: string; surface: string }[];
        changed?: string[];
        refused?: string[];
    };
    if (payload.error !== undefined) {
        consoleOutput.error(`kk.wiki.link: ${payload.error}`);
        return;
    }
    if (payload.fix === true) {
        for (const path of payload.changed ?? []) consoleOutput.write(`linked: ${path}`);
        for (const path of payload.refused ?? []) consoleOutput.write(`guard: ${path} (appended under AI Updates)`);
        if ((payload.changed ?? []).length === 0 && (payload.refused ?? []).length === 0) {
            consoleOutput.write('no unlinked mentions');
        }
        return;
    }
    for (const mention of payload.mentions ?? []) {
        consoleOutput.write(`${mention.path}:${mention.line} ${mention.surface} -> [[${mention.slug}]]`);
    }
    if ((payload.mentions ?? []).length === 0) consoleOutput.write('no unlinked mentions');
}
