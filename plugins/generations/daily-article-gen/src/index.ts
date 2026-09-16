import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * daily-article-gen: render a merged `Doc[]` into one readable daily AI-news
 * article. Mechanical template fill — no LLM, no STORM. Every news item keeps
 * a human-clickable source link (`[来源](sourceUri)`) so readers can trace
 * claims to their origin. Research scaffolding is stripped before render
 * (task 0138 R4b — see `stripScaffold`).
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

/**
 * Research-scaffold labels that must never reach reader copy (task 0138 R4b). The last30days
 * research style emits them as `**「label」**` prefixes; the plan-translate prompt forbids them,
 * but this deterministic pass catches what the agent misses. Grows with sources.
 */
const SCAFFOLD_LABELS = ['可做角度', '为什么现在值得注意', '社区讨论', '背景', '潜在影响', '影响'];

/** Self-referential hedging markers — research voice, not news copy (task 0138 R4b). */
const HEDGING_MARKERS = ['读者宜另行核实', '读者最好', '仍待验证', '尚待验证', '需另行核实'];

/**
 * Length of a leading scaffold label in any shape the research bodies use — `**「背景」**`,
 * `「背景」`, `**背景**`, `### 背景`, `背景：` — or 0 when the line does not open with a known label.
 * The capture is greedy and unbounded on purpose: it must reach the whole label (so `可做` cannot
 * satisfy it where `可做角度` is the real one) and must not impose a length the label list outgrows.
 * The `SCAFFOLD_LABELS` membership check, not the regex, decides.
 */
function scaffoldPrefixLength(text: string): number {
    const match = text.match(
        /^(?:#{1,6}\s*)?(?:\*\*)?\s*[「『]?\s*([^」』*：:\n]{2,})\s*[」』]?\s*(?:\*\*)?\s*[：:]?\s*/,
    );
    if (match === null || !SCAFFOLD_LABELS.includes((match[1] ?? '').trim())) return 0;
    return match[0].length;
}

/** Drop every leading scaffold label, keeping the prose after it (`**「可做角度」** 可做角度：X` -> `X`). */
function collapseScaffoldLabels(text: string): string {
    let rest = text;
    for (;;) {
        const next = rest.slice(scaffoldPrefixLength(rest));
        if (next === rest) return rest;
        rest = next;
    }
}

/** Drop the sentences carrying a hedging marker; a line that is only hedging collapses to ''. */
function stripHedging(text: string): string {
    if (!HEDGING_MARKERS.some((marker) => text.includes(marker))) return text;
    return text
        .split(/(?<=。)/)
        .filter((sentence) => !HEDGING_MARKERS.some((marker) => sentence.includes(marker)))
        .join('')
        .trim();
}

/**
 * Strip research scaffolding from a Doc body before it reaches reader copy (task 0138 R4b):
 * standalone label lines are dropped, inline label prefixes collapse to their prose, and hedging
 * sentences are removed. A clean body passes through byte-identical.
 */
export function stripScaffold(body: string): string {
    const kept: string[] = [];
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') {
            kept.push(line); // paragraph breaks survive untouched
            continue;
        }
        const collapsed = stripHedging(collapseScaffoldLabels(trimmed));
        if (collapsed === '') continue;
        kept.push(collapsed === trimmed ? line : collapsed);
    }
    return kept.join('\n');
}

/** Render one news item section: heading, source link, and summary body. */
function renderDoc(doc: Doc, index: number): string {
    const heading = doc.title?.trim() || `新闻 ${index + 1}`;
    const link = doc.sourceUri ? `[来源：${sourceLabelOf(doc)}](${doc.sourceUri})` : '';
    const meta = doc.metadata as Record<string, unknown> | undefined;
    const publishedAt = typeof meta?.publishedAt === 'string' ? meta.publishedAt.slice(0, 10) : '';
    const metaLine = [link, publishedAt].filter(Boolean).join(' · ');
    return `## ${index + 1}. ${heading}\n\n${metaLine ? `${metaLine}\n\n` : ''}${stripScaffold(doc.body ?? '').trim()}`;
}

/** Render the article markdown for a merged Doc[] (pure — exported for tests). */
export function renderDailyArticle(docs: Doc[], date: string): string {
    const items = docs.map(renderDoc).join('\n\n');
    return `# 每日 AI 资讯 — ${date}\n\n本期共 ${docs.length} 条新闻，均附可点击来源链接。\n\n${items}\n`;
}

/** Single-source daily tag: stamped on every Content this generator emits (task 0119). */
const AI_NEWS_TAG = 'ai-news';

/** Merge existing item tags (deduped) with the mandatory `ai-news` tag, first position. */
function tagsFor(docs: Doc[]): string[] {
    const existing = docs.flatMap((d) => {
        const meta = d.metadata as Record<string, unknown> | undefined;
        return Array.isArray(meta?.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [];
    });
    return [AI_NEWS_TAG, ...existing.filter((t) => t !== AI_NEWS_TAG)];
}

/** Build the article Content from a merged Doc[]. */
export function docsToContent(docs: Doc[], date: string): Content {
    return ContentSchema.parse({
        title: `每日 AI 资讯 — ${date}`,
        body: renderDailyArticle(docs, date),
        format: 'markdown',
        references: docs.filter((d) => d.sourceUri).map((d) => ({ url: d.sourceUri, title: d.title, cite: d.id })),
        metadata: { generator: 'kk:daily-article', date, doc_count: docs.length, tags: tagsFor(docs) },
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
