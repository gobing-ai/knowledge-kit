import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * episode-plan-gen: plan the daily episode from the blended `Doc[]`. Mechanical
 * selection — no LLM. Score each doc (source weight + normalized relevance +
 * log-scaled engagement), dedup by normalized URL then by title bigram
 * similarity, keep the top N, and flag English items for the workflow's
 * translation step. Output is a Content whose `metadata.docs` carries the
 * selected `Doc[]`; the workflow extracts that array for downstream steps.
 *
 * Env: `EPISODE_PLAN_MAX_ITEMS` (default 20), `EPISODE_PLAN_DATE` (YYYYMMDD or
 * ISO, else today UTC).
 */

/** Tunable scoring knobs (kept here so the shape is greppable, not config-filed). */
const SOURCE_BASE: Record<string, number> = {
    aihot: 30, // human-curated feed — outranks everything at equal evidence
    rss: 12, // horizon-ranked feed items
    hackernews: 10,
    youtube: 8,
    github: 6,
    reddit: 5,
    grounding: 5,
    polymarket: 4,
};
const DEFAULT_SOURCE_BASE = 5;
const TITLE_SIMILARITY_THRESHOLD = 0.6; // character-bigram Jaccard

export interface PlanOptions {
    maxItems: number;
}

/** Strip `⭐️ x.y/10` ratings and `### [title](url)` heading copies from a body. */
export function cleanBody(body: string): string {
    return body
        .replace(/⭐️\s*[\d.]+\s*\/\s*10/g, '')
        .replace(/^#{1,6}\s*\[[^\]]*\]\([^)]*\)\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Canonical URL key: drop query, fragment, trailing slash, `www.`/`amp.` prefixes. */
export function normalizeUrl(raw: string | undefined): string | null {
    if (!raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const host = url.hostname.replace(/^(www|amp)\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${host}${path}`;
}

/** ASCII ratio of a string; > 0.5 on the title marks an English item. */
function asciiRatio(text: string): number {
    const chars = [...text].filter((c) => !/\s/.test(c));
    if (chars.length === 0) return 0;
    return chars.filter((c) => c.charCodeAt(0) < 128).length / chars.length;
}

/** Character-bigram set for Jaccard similarity. */
function bigrams(text: string): Set<string> {
    const s = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
}

export function titleSimilarity(a: string, b: string): number {
    const A = bigrams(a);
    const B = bigrams(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const g of A) if (B.has(g)) inter++;
    return inter / (A.size + B.size - inter);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function toNumber(value: unknown): number | undefined {
    const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
    return Number.isFinite(n) ? n : undefined;
}

/** Engagement magnitude → 0..10 via log10 scaling (mixed units across sources). */
function engagementScore(engagement: Record<string, unknown>): number {
    let max = 0;
    for (const v of Object.values(engagement)) {
        const n = toNumber(v);
        if (n !== undefined && n > max) max = n;
    }
    if (max <= 0) return 0;
    return Math.min(10, Math.log10(max));
}

/** Composite 0..100-ish score; ordering matters more than absolute value. */
export function planScore(doc: Doc): number {
    const meta = asRecord(doc.metadata);
    const source = typeof meta.source === 'string' ? meta.source : '';
    let score = SOURCE_BASE[source] ?? DEFAULT_SOURCE_BASE;

    const relevance = toNumber(meta.relevance_score) ?? toNumber(meta.score);
    if (relevance !== undefined) {
        // horizon `score` is 0..10; last30days `relevance_score` is 0..1.
        score += relevance <= 1 ? relevance * 10 : Math.min(relevance * 10, 40) / 4;
    }
    const engagement = engagementScore(asRecord(meta.engagement));
    score += engagement * 1.5;
    return Math.round(score * 10) / 10;
}

/** Winner of a merge keeps a trace of what it absorbed (source + URL). */
interface MergedFrom {
    source: string;
    title: string;
    url: string | null;
}

interface ScoredDoc {
    doc: Doc;
    score: number;
    mergedFrom: MergedFrom[];
}

/** Full plan pipeline: clean → score → URL-dedup → title-dedup → top N. */
export function planEpisode(docs: Doc[], options: PlanOptions): Doc[] {
    // URL dedup happens on the original sourceUri (first occurrence wins ties,
    // resolved below by score after the map).
    const byUrl = new Map<string, ScoredDoc>();
    const scored: ScoredDoc[] = [];
    for (const doc of docs) {
        const cleaned: Doc = {
            ...doc,
            body: cleanBody(doc.body ?? ''),
            metadata: { ...asRecord(doc.metadata) },
        };
        const record = { doc: cleaned, score: planScore(cleaned), mergedFrom: [] as MergedFrom[] };
        const urlKey = normalizeUrl(doc.sourceUri);
        if (urlKey) {
            const existing = byUrl.get(urlKey);
            if (existing) {
                // Higher score wins; the loser is recorded in mergedFrom.
                const loser = record.score > existing.score ? existing : record;
                const winner = record.score > existing.score ? record : existing;
                winner.mergedFrom.push({
                    source: sourceOf(loser.doc),
                    title: loser.doc.title ?? '',
                    url: loser.doc.sourceUri ?? null,
                });
                if (winner !== existing) {
                    existing.doc = winner.doc;
                    existing.score = winner.score;
                    existing.mergedFrom = winner.mergedFrom;
                }
                continue;
            }
            byUrl.set(urlKey, record);
        }
        scored.push(record);
    }

    // Title-similarity dedup across distinct URLs: keep the higher-scoring doc.
    const absorbed = new Set<ScoredDoc>();
    for (let i = 0; i < scored.length; i++) {
        for (let j = i + 1; j < scored.length; j++) {
            const a = scored[i];
            const b = scored[j];
            if (!a || !b || absorbed.has(a) || absorbed.has(b)) continue;
            const titleA = a.doc.title ?? '';
            const titleB = b.doc.title ?? '';
            if (!titleA || !titleB) continue;
            if (titleSimilarity(titleA, titleB) < TITLE_SIMILARITY_THRESHOLD) continue;
            const loser = a.score < b.score ? a : b;
            const winner = a.score < b.score ? b : a;
            winner.mergedFrom.push({
                source: sourceOf(loser.doc),
                title: loser.doc.title ?? '',
                url: loser.doc.sourceUri ?? null,
            });
            absorbed.add(loser);
        }
    }

    return scored
        .filter((r) => !absorbed.has(r))
        .sort((a, b) => b.score - a.score)

        .slice(0, Math.max(1, options.maxItems))
        .map((r) => {
            const meta = asRecord(r.doc.metadata);
            const ascii = asciiRatio(r.doc.title ?? '');
            return {
                ...r.doc,
                metadata: {
                    ...meta,
                    planScore: r.score,
                    ...(ascii > 0.5 ? { needsTranslation: true } : {}),
                    ...(r.mergedFrom.length > 0 ? { mergedFrom: r.mergedFrom } : {}),
                },
            } satisfies Doc;
        });
}

function sourceOf(doc: Doc): string {
    const meta = asRecord(doc.metadata);
    return typeof meta.source === 'string' ? meta.source : 'unknown';
}

/** Human-readable plan markdown (the Content body; not consumed downstream). */
export function renderPlanMarkdown(docs: Doc[], date: string): string {
    const items = docs
        .map((doc, i) => {
            const meta = asRecord(doc.metadata);
            const parts = [
                `## ${i + 1}. ${doc.title ?? `条目 ${i + 1}`}`,
                `${meta.planScore !== undefined ? `planScore: ${String(meta.planScore)}\n` : ''}${doc.body ?? ''}`,
            ];
            return parts.join('\n\n');
        })
        .join('\n\n');
    return `# 每日 AI 播客选稿计划 — ${date}\n\n本期共 ${docs.length} 条（评分/去重/标记后精选）。\n\n${items}\n`;
}

/** Build the plan Content; `metadata.docs` is the contract with the workflow. */
export function docsToContent(docs: Doc[], date: string): Content {
    const planned = planEpisode(docs, { maxItems: maxItemsFromEnv() });
    return ContentSchema.parse({
        title: `每日 AI 播客选稿计划 — ${date}`,
        body: renderPlanMarkdown(planned, date),
        format: 'markdown',
        metadata: {
            generator: 'kk:episode-plan',
            date,
            doc_count: planned.length,
            docs: planned,
        },
    });
}

function maxItemsFromEnv(): number {
    const raw = process.env.EPISODE_PLAN_MAX_ITEMS;
    if (raw === undefined || raw.trim() === '') return 20;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
}

export async function processGeneratorIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const raw = process.env.EPISODE_PLAN_DATE ?? new Date().toISOString().slice(0, 10);
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
        echoError(`episode-plan-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('episode-plan-gen failed: Missing required arguments: --in <docs.json> --out <content.json>');
        return 1;
    }
    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`episode-plan-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
