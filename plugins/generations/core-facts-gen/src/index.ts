import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * core-facts-gen (task 0090 contract, docs/design/core-facts-template.md):
 * render a merged `Doc[]` (from `kk executor fan-in`) into one dated core-facts
 * markdown `Content`. Mechanical template fill — no LLM.
 *
 * Run date: `CORE_FACTS_DATE` env var, else today (UTC).
 */

/** Narrow a metadata.sources[] entry to its `file` string (provenance shape written by fan-in). */
function sourceFileOf(entry: unknown): string | null {
    if (entry && typeof entry === 'object' && 'file' in entry) {
        const file = entry.file;
        return typeof file === 'string' ? file : null;
    }
    return null;
}

/** Render the facts markdown for a merged Doc[] (pure — exported for tests). */
export function renderCoreFacts(docs: Doc[], date: string): string {
    const sources = new Set<string>();
    for (const doc of docs) {
        const entries = doc.metadata?.sources;
        if (Array.isArray(entries)) {
            for (const entry of entries) {
                const file = sourceFileOf(entry);
                if (file) sources.add(file);
            }
        }
    }
    const roster = [...sources].map((file) => `  - ${basename(file)} (${file})`).join('\n');

    const labelOf = (d: Doc): string => {
        const source = d.metadata?.source;
        if (typeof source === 'string' && source) return source;
        const entries = d.metadata?.sources;
        if (Array.isArray(entries)) {
            const file = entries.length > 0 ? sourceFileOf(entries[0]) : null;
            if (file) return basename(file);
        }
        return '';
    };
    const scoreOf = (d: Doc): unknown => d.metadata?.score ?? d.metadata?.relevance_score ?? '';
    const dateOf = (d: Doc): string => {
        const published = d.metadata?.published_at;
        return typeof published === 'string' ? published : '';
    };
    const headlines = docs
        .map(
            (d) =>
                `### ${d.title ?? ''}\n` +
                `**Source:** ${labelOf(d)} · **URI:** ${d.sourceUri ?? ''} · **ID:** \`${d.id}\`\n` +
                `**Date:** ${dateOf(d)} · **Score:** ${String(scoreOf(d))}\n` +
                `${d.body}`,
        )
        .join('\n\n');

    return (
        `---\ndate: ${date}\nsources:\n${roster}\ndedup_rule: id\ndoc_count: ${docs.length}\n---\n\n` +
        `# Core Facts — ${date}\n\n` +
        '> Daily AI news core-facts digest. Merge: `kk executor fan-in` (id dedupe, first-seen wins).\n' +
        '> Render: core-facts-gen generator (mechanical; no LLM).\n\n' +
        `## Headlines\n\n${headlines}\n`
    );
}

export function docsToContent(docs: Doc[], date: string): Content {
    return ContentSchema.parse({
        title: `Core Facts — ${date}`,
        body: renderCoreFacts(docs, date),
        format: 'markdown',
        references: docs.filter((d) => d.sourceUri).map((d) => ({ url: d.sourceUri, title: d.title, cite: d.id })),
        metadata: { generator: 'kk:core-facts', date, doc_count: docs.length },
    });
}

export async function processGeneratorIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const date = process.env.CORE_FACTS_DATE ?? new Date().toISOString().slice(0, 10);
    const content = docsToContent(docs, date);
    const fs = createNodeFileSystem();
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await fs.ensureDir(outDir);
    await atomicWriteJson(outputPath, content, fs);
    return content;
}

export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (err: unknown) {
        echoError(`core-facts-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('core-facts-gen failed: Missing required arguments: --in <docs.json> --out <content.json>');
        return 1;
    }
    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`core-facts-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
