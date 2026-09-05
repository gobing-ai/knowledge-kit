import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * daily-article-gen: render a merged `Doc[]` into one readable daily AI-news
 * article. Mechanical template fill — no LLM, no STORM. Every news item keeps
 * a human-clickable source link (`[来源](sourceUri)`) so readers can trace
 * claims to their origin.
 *
 * Run date: `ARTICLE_DATE` env var (YYYYMMDD or ISO), else today (UTC).
 * Language-neutral: the Doc bodies already carry the summary language.
 */

/** Pretty source label for an item line. */
function sourceLabelOf(doc: Doc): string {
    const meta = doc.metadata as Record<string, unknown> | undefined;
    const name = meta?.sourceName;
    if (typeof name === 'string' && name.trim().length > 0) return name.trim();
    try {
        return new URL(doc.sourceUri ?? '').hostname.replace(/^www\./, '');
    } catch {
        return '来源';
    }
}

/** Render one news item section: heading, source link, and summary body. */
function renderDoc(doc: Doc, index: number): string {
    const heading = doc.title?.trim() || `新闻 ${index + 1}`;
    const link = doc.sourceUri ? `[来源：${sourceLabelOf(doc)}](${doc.sourceUri})` : '';
    const meta = doc.metadata as Record<string, unknown> | undefined;
    const publishedAt = typeof meta?.publishedAt === 'string' ? meta.publishedAt.slice(0, 10) : '';
    const metaLine = [link, publishedAt].filter(Boolean).join(' · ');
    return `## ${index + 1}. ${heading}\n\n${metaLine ? `${metaLine}\n\n` : ''}${(doc.body ?? '').trim()}`;
}

/** Render the article markdown for a merged Doc[] (pure — exported for tests). */
export function renderDailyArticle(docs: Doc[], date: string): string {
    const items = docs.map(renderDoc).join('\n\n');
    return `# 每日 AI 资讯 — ${date}\n\n本期共 ${docs.length} 条新闻，均附可点击来源链接。\n\n${items}\n`;
}

/** Build the article Content from a merged Doc[]. */
export function docsToContent(docs: Doc[], date: string): Content {
    return ContentSchema.parse({
        title: `每日 AI 资讯 — ${date}`,
        body: renderDailyArticle(docs, date),
        format: 'markdown',
        references: docs.filter((d) => d.sourceUri).map((d) => ({ url: d.sourceUri, title: d.title, cite: d.id })),
        metadata: { generator: 'kk:daily-article', date, doc_count: docs.length },
    });
}

export async function processGeneratorIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const raw = process.env.ARTICLE_DATE ?? new Date().toISOString().slice(0, 10);
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
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
        echoError(`daily-article-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('daily-article-gen failed: Missing required arguments: --in <docs.json> --out <content.json>');
        return 1;
    }
    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`daily-article-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
