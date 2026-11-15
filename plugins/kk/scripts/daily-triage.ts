/**
 * daily-triage — print the five-line triage summary for a failed daily run (0347 F3, 2026-11-10).
 *
 *   bun plugins/kk/scripts/daily-triage.ts --run <runId> [--repo <dir>] [--json]
 *   bun plugins/kk/scripts/daily-triage.ts --latest [--repo <dir>] [--json]
 *
 * Exit codes: 0 = triage produced (even for a rerun-able outcome — this is a read-only tool);
 * 1 = usage error; 2 = run receipt not found / not failed. The scheduler embeds the same summary
 * in the failure receipt, so this CLI is for ad-hoc inspection and for reproducing the embedded
 * triage when the receipt was written by an older supervisor build.
 */
import { join } from 'node:path';
import { collectTriage, latestFailedRun, summarizeTriage } from './daily-triage-core';

interface CliValues {
    run?: string;
    latest?: boolean;
    repo?: string;
    json?: boolean;
}

function fail(code: number, message: string): never {
    console.error(`daily-triage: ${message}`);
    process.exit(code);
}

export function main(args: string[]): void {
    const values: CliValues = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--run') values.run = args[++i];
        else if (arg === '--latest') values.latest = true;
        else if (arg === '--repo') values.repo = args[++i];
        else if (arg === '--json') values.json = true;
        else if (arg === '--help' || arg === '-h') {
            console.log('usage: daily-triage.ts (--run <runId> | --latest) [--repo <dir>] [--json]');
            process.exit(0);
        } else fail(1, `unknown argument: ${arg}`);
    }
    if (values.run !== undefined && values.latest) fail(1, '--run and --latest are mutually exclusive');
    if (values.run === undefined && !values.latest) fail(1, 'pass --run <runId> or --latest');

    const repo = values.repo ?? process.cwd();
    let runId = values.run ?? '';
    let receiptPath: string | undefined;
    if (values.latest) {
        const found = latestFailedRun(repo);
        if (found === null) {
            console.log('daily-triage: no failed daily run found under .works — nothing to triage');
            process.exit(0);
        }
        runId = found.runId;
        receiptPath = found.receiptPath;
    }
    const report = collectTriage(repo, runId, { receiptPath });
    if (report.receipt === null && !values.latest) {
        console.log(
            `daily-triage: no schedule receipt found for ${runId} (overwritten by a later attempt?) — triaging from trace only`,
        );
    }
    if (values.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    for (const line of summarizeTriage(report)) console.log(line);
    const nestedRunId = report.nestedRuns[0]?.runId;
    console.log(
        `details: bun plugins/kk/scripts/daily-triage.ts --run ${runId} --repo ${join(repo)} --json${nestedRunId ? `; nested: spur workflow trace ${nestedRunId} --json` : ''}`,
    );
}

if (import.meta.main) {
    main(process.argv.slice(2));
}
