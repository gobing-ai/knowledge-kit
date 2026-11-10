import { type Command, CommanderError } from 'commander';
import { consoleOutput, toJson } from '../output';
import { runIngest } from '../wiki/ingest';
import { printLinkOutcome, runLink } from '../wiki/link';
import { printLintOutcome, runLint } from '../wiki/lint';

/** Options accepted by `kk wiki ingest`. */
interface WikiIngestOptions {
    type?: string;
    out?: string;
    json?: boolean;
}

/**
 * `kk wiki ingest <source|-> [--type=url|pdf|html|rss] [--out <dir>] [--json]` (feature I1, task 0350).
 *
 * The verb normalises one file, URL or stdin body into a layer-1 raw snapshot. It never calls a
 * model: html/pdf/url go through the markitdown normaliser, everything else is written as given.
 */
async function ingestAction(source: string, options: WikiIngestOptions): Promise<void> {
    const outcome = await runIngest({ source, type: options.type, out: options.out, json: options.json });
    if (outcome.ok) {
        if (options.json === true) consoleOutput.write(toJson(outcome.payload));
        else consoleOutput.write(`raw snapshot: ${outcome.payload.path}`);
        return;
    }
    const message = `kk.wiki.ingest: ${outcome.payload.error}`;
    if (options.json === true) consoleOutput.write(toJson({ ok: false, error: outcome.payload.error }));
    consoleOutput.error(message);
    throw new CommanderError(outcome.code, 'kk.wiki.ingest', message);
}

/** `kk wiki link [--fix]`: report unlinked mentions of page titles, or inject them. */
async function linkAction(options: { fix?: boolean; json?: boolean }): Promise<void> {
    const outcome = await runLink({ fix: options.fix === true, json: options.json === true });
    printLinkOutcome(outcome, options.json === true);
    if (!outcome.ok) throw new CommanderError(outcome.code, 'kk.wiki.link', 'kk.wiki.link failed');
}

/** `kk wiki lint`: audit the vault; exits 1 when findings exist. */
async function lintAction(options: { json?: boolean }): Promise<void> {
    const outcome = await runLint({ json: options.json === true });
    printLintOutcome(outcome, options.json === true);
    if (outcome.code !== 0) throw new CommanderError(outcome.code, 'kk.wiki.lint', 'kk.wiki.lint findings');
}

/** Register the `wiki` noun. One subcommand module per verb (docs/design/kk-wiki.md §1). */
export function registerWikiCommand(parent: Command): void {
    const wiki = parent.command('wiki').description('Deterministic Markdown vault mechanics (ADR-046)');

    wiki.command('ingest')
        .description('Normalise a file, URL or stdin body into a layer-1 raw snapshot')
        .argument('<source>', 'File path, http(s) URL, or - for stdin')
        .option('--type <type>', 'Source type: url | pdf | html | rss (default: from the extension)')
        .option('--out <dir>', 'Raw directory override (default: wiki.raw from kk.config.json)')
        .option('--json', 'Print one JSON document instead of a one-line summary')
        .action(ingestAction);

    wiki.command('link')
        .description('Report unlinked mentions of existing page titles; --fix injects them')
        .option('--fix', 'Rewrite the reported mentions to [[slug|Surface]]')
        .option('--json', 'Print one JSON document')
        .action(linkAction);

    wiki.command('lint')
        .description('Audit the vault for broken links, orphan pages and frontmatter defects')
        .option('--json', 'Print one JSON document')
        .action(lintAction);
}
