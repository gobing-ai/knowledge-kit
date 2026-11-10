import { buildVaultIndex, lintExitCode, lintPages, type VaultIndex } from '@gobing-ai/kk-wiki';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { consoleOutput, toJson } from '../output';
import { resolveWikiConfig, WikiConfigError } from './config';

/** `kk wiki lint` (task 0351): report vault defects; nonzero when any is found. */

/** One CLI invocation's outcome. */
export interface WikiLintOutcome {
    ok: boolean;
    code: 0 | 1 | 2;
    payload: unknown;
}

/** Inputs for one `kk wiki lint` run. */
export interface WikiLintOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    json?: boolean;
}

/** Build the index and lint it, returning findings plus the exit code they imply. */
export async function runLint(options: WikiLintOptions = {}): Promise<WikiLintOutcome> {
    let contentDir: string;
    try {
        contentDir = (await resolveWikiConfig({ cwd: options.cwd, env: options.env })).content;
    } catch (error) {
        if (error instanceof WikiConfigError) return { ok: false, code: 1, payload: { error: error.message } };
        throw error;
    }
    const index: VaultIndex = await buildVaultIndex(contentDir, createNodeFileSystem());
    const findings = lintPages(index);
    return {
        ok: findings.length === 0,
        code: lintExitCode(findings),
        payload: { ok: findings.length === 0, findings, pages: index.pages.length },
    };
}

/** Render one lint outcome (JSON document or a line per finding). */
export function printLintOutcome(outcome: WikiLintOutcome, json: boolean): void {
    if (json) {
        consoleOutput.write(toJson(outcome.payload));
        return;
    }
    const payload = outcome.payload as {
        findings?: { path: string; line: number; code: string; message: string }[];
        error?: string;
    };
    if (payload.error !== undefined) {
        consoleOutput.error(`kk.wiki.lint: ${payload.error}`);
        return;
    }
    for (const finding of payload.findings ?? []) {
        consoleOutput.write(`${finding.path}:${finding.line} ${finding.code}: ${finding.message}`);
    }
    if ((payload.findings ?? []).length === 0) consoleOutput.write('vault is clean');
}
