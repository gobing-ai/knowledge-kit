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

/**
 * Episode title for the 「每日AI乱炖」 column of 「咸话咸说」: fixed `每日AI乱炖 · YYYY-MM-DD`
 * (2026-10-08 operator rename, keeping the 2026-10-02 date-only pattern). The date identifies
 * the episode; the day's stories live in the show notes, cards and post body. Pure function so
 * the agent-written and template article paths, ID3, RSS and show notes all derive one title.
 */
export function episodeTitle(date: string): string {
    return `每日AI乱炖 · ${date}`;
}

/** Render the article markdown for a merged Doc[] (pure — exported for tests). */
export function renderDailyArticle(docs: Doc[], date: string): string {
    const items = docs.map(renderDoc).join('\n\n');
    const intro =
        docs.length > 0
            ? `这里是由Robin为你带来的咸话咸说之每日AI乱炖。本期共 ${docs.length} 条内容，均附可点击来源链接。`
            : '这里是由Robin为你带来的咸话咸说之每日AI乱炖。本期没有足够扎实的可聊内容。';
    return `# ${episodeTitle(date)}\n\n${intro}\n\n${items}\n`;
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

/** A leading H1 line — agent bodies used to carry their own title; the canonical title is computed (task 0189 R4). */
const LEADING_H1_RE = /^#(?!#)\s*[^\n]+\n+/.source;

/** ids the article-write note marks as dropped on the topic boundary, e.g. 「…未写入：<id>（原因）、<id>（原因）」. */
const NOTE_EXCLUDED_RE = /未写入[：:](.*)/g;
const HEX_ID_RE = /(?:[a-zA-Z0-9_-]+:)?[0-9a-f]{16,64}/g;

/** Parse the boundary-note ids out of an article body so references/metadata never cite excluded docs (judge finding 2026-10-02). */
export function excludedIdsFromNote(body: string | undefined): Set<string> {
    const ids = new Set<string>();
    if (!body) return ids;
    for (const note of body.matchAll(NOTE_EXCLUDED_RE)) {
        for (const id of (note[1] ?? '').matchAll(HEX_ID_RE)) {
            ids.add(id[0]);
            const colon = id[0].indexOf(':');
            if (colon !== -1) ids.add(id[0].slice(colon + 1));
        }
    }
    return ids;
}

/** Build the article Content from a merged Doc[]; `bodyOverride` replaces the mechanical render (agent-written prose), still scaffold-stripped as a safety net. */
export function docsToContent(docs: Doc[], date: string, bodyOverride?: string): Content {
    const title = episodeTitle(date);
    let body = renderDailyArticle(docs, date);
    if (bodyOverride) {
        // The canonical episode title is computed from the lead item; a leading H1 the agent may
        // still have written is replaced (not duplicated) so body and metadata agree on every path.
        const stripped = stripScaffold(bodyOverride.trim()).trim().replace(new RegExp(LEADING_H1_RE), '');
        body = `# ${title}\n\n${stripped}\n`;
    }
    return ContentSchema.parse({
        title,
        body,
        format: 'markdown',
        references: docs.filter((d) => d.sourceUri).map((d) => ({ url: d.sourceUri, title: d.title, cite: d.id })),
        metadata: { generator: 'kk:daily-article', date, doc_count: docs.length, tags: tagsFor(docs) },
    });
}

export async function processGeneratorIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const raw = process.env.ARTICLE_DATE ?? new Date().toISOString().slice(0, 10);
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    // Agent-written prose body (workflow `article-write` state) replaces the mechanical
    // per-item render; missing/empty env ⇒ mechanical render as before.
    let bodyOverride: string | undefined;
    const bodyFile = process.env.ARTICLE_BODY_FILE;
    if (bodyFile && bodyFile.length > 0) {
        bodyOverride = await Bun.file(bodyFile).text();
        if (bodyOverride.trim() === '') bodyOverride = undefined;
    }
    const excluded = excludedIdsFromNote(bodyOverride);
    const kept =
        excluded.size === 0
            ? docs
            : docs.filter(
                  (d) =>
                      !excluded.has(d.id) && !(d.id.includes(':') && excluded.has(d.id.slice(d.id.indexOf(':') + 1))),
              );
    const content = docsToContent(kept, date, bodyOverride);
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
