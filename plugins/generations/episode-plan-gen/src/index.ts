import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * episode-plan-gen: plan the daily episode from the blended `Doc[]`. Annotate
 * every doc first (MECE `metadata.category` + four 0–5 `metadata.scores` QC
 * dimensions — deterministic, no LLM), then mechanically select: score each doc
 * (source weight + normalized relevance + log-scaled engagement), dedup by
 * normalized URL then by title bigram similarity, keep the top N, and flag
 * English items for the workflow's translation step. Output is a Content whose `metadata.docs` carries the
 * selected `Doc[]`; the workflow extracts that array for downstream steps.
 *
 * Env: `EPISODE_PLAN_MAX_ITEMS` (default 20), `EPISODE_PLAN_DATE` (YYYYMMDD or
 * ISO, else today UTC). `--mode filter` (0094) adds the quality-controller gate:
 * annotated `Doc[]` in, category-allowlist + inclusive per-dimension minimums
 * out — survivors to `--out`, rejection audit to `<out>.rejected.json`; env
 * `QC_CATEGORIES` (default 'ai-news,ai-industry'),
 * `QC_MIN_QUALITY/IMPORTANCE/URGENCY/IMPACT` (defaults 2/3/2/1 — 0099 recalibration);
 * invalid values exit 1 (fail loud, no clamping).
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
const FRESHNESS_DAYS = 7; // a daily episode drops items published before this window (dogfood 20260906: aihot served a 2020-2025 blog archive as "selected")
const PER_SOURCE_CAP = 5; // one feed can't flood the episode even when all its items score high
const NON_NEWS_TAGS = new Set(['geopolitics', 'military-conflict', 'war']); // horizon finance-news tags (dogfood 20260906: Iran oil tankers in an AI episode)

/**
 * MECE category taxonomy for the annotate pass (v1 — tune later). classifyCategory
 * resolves first match wins: (1) a metadata.tags hit in TAG_CATEGORY, (2) a source
 * in NON_AI_SOURCES (default-deny — skips the keyword scan), (3) keyword signals in
 * the title + first 200 chars of the body, (4) default `non-ai`.
 */
export type Category = 'ai-news' | 'ai-technical' | 'ai-research' | 'ai-industry' | 'non-ai';

/** The four QC dimensions written to `metadata.scores`; each an integer 0–5 (v1 rubric — tune later). */
export interface DimensionScores {
    quality: number;
    importance: number;
    urgency: number;
    impact: number;
}

/**
 * tag (lowercased) → category; checked before any source or keyword signal. The
 * generic-AI / major-lab entries are the 0099 expansion (0098 dogfood r7: items tagged
 * OpenAI/AI/LLM fell through to `non-ai` under the v1 map).
 */
const TAG_CATEGORY: Record<string, Category> = {
    'ai-news': 'ai-news',
    ai: 'ai-news',
    'artificial-intelligence': 'ai-news',
    'generative-ai': 'ai-news',
    genai: 'ai-news',
    llm: 'ai-news',
    llms: 'ai-news',
    openai: 'ai-news',
    anthropic: 'ai-news',
    deepmind: 'ai-news',
    'google-deepmind': 'ai-news',
    'meta-ai': 'ai-news',
    mistral: 'ai-news',
    xai: 'ai-news',
    'coding-agents': 'ai-news',
    'coding agent': 'ai-news',
    research: 'ai-research',
    alignment: 'ai-research',
    'research-paper': 'ai-research',
    paper: 'ai-research',
    tutorial: 'ai-technical',
    guide: 'ai-technical',
    geopolitics: 'non-ai',
    'military-conflict': 'non-ai',
    war: 'non-ai',
};

/** Sources whose items are by default not AI content — the keyword scan is skipped for them. */
const NON_AI_SOURCES = new Set(['polymarket']);

/**
 * Title/body keyword signals, scanned in array order (junk → technical → news → industry);
 * first hit wins. The junk group is the 0099 audit: ingest template artifacts — error logs,
 * checklist boilerplate — used to absorb AI keywords riding along in the boilerplate (0098
 * dogfood r7: a yt-dlp HTTP-403 error post classified INTO ai-industry via the word "policy"
 * in its "NO AI / NO LLM POLICY" checklist), so they now land `non-ai` instead.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<{ category: Category; words: string[] }> = [
    {
        // Ingest junk: error-log titles and template checklists. Phrases are tight enough
        // to never fire on genuine coverage (verified against the r6/r7 blended corpora).
        category: 'non-ai',
        words: ['error:', 'http error', 'unable to download'],
    },
    {
        // Technical vocabulary: APIs, tutorials, benchmarks, architecture, inference.
        category: 'ai-technical',
        words: ['api', 'tutorial', 'benchmark', 'architecture', 'sdk', 'cli', 'quantization', 'inference', 'fine-tun'],
    },
    {
        // Launch/release/announce verbs + product names.
        category: 'ai-news',
        words: [
            'launch',
            'release',
            'announce',
            'unveil',
            'debuts',
            'ships',
            '发布',
            '上线',
            '推出',
            '开源',
            'sora',
            'gpt',
            'claude',
            'gemini',
            'llama',
            'grok',
            'copilot',
        ],
    },
    {
        // Company/funding/policy signals.
        category: 'ai-industry',
        words: [
            'funding',
            'raises',
            'acquisition',
            'acquires',
            'ipo',
            'valuation',
            'policy',
            'regulation',
            'lawsuit',
            '融资',
            '收购',
            '法案',
            '监管',
        ],
    },
];

/** Source-tier base for the importance dimension (derived from SOURCE_BASE tiers: aihot → 4, rss/hackernews → 3, tail → 2). */
const IMPORTANCE_BASE: Record<string, number> = { aihot: 4, rss: 3, hackernews: 3 };
const DEFAULT_IMPORTANCE = 2;

export interface PlanOptions {
    maxItems: number;
    date?: string; // episode date (YYYY-MM-DD); freshness is judged against it, default today
}

/** Best-effort publication timestamp from mixed source metadata (aihot: publishedAt/discoveredAt; horizon: date). */
function docTimestamp(doc: Doc): number | null {
    const meta = asRecord(doc.metadata);
    for (const key of ['publishedAt', 'discoveredAt']) {
        const value = meta[key];
        if (typeof value === 'string' && value.trim()) {
            const t = Date.parse(value);
            if (Number.isFinite(t)) return t;
        }
    }
    const date = meta.date;
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
        return Date.parse(date.trim().slice(0, 10));
    }
    return null;
}

/** Freshness + non-news gates applied before scoring/dedup (archived or off-topic items never enter the pool). */
function passesGates(doc: Doc, planDate: string): boolean {
    const meta = asRecord(doc.metadata);
    const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [];
    if (tags.some((tag) => NON_NEWS_TAGS.has(tag.toLowerCase()))) return false;
    const published = docTimestamp(doc);
    if (published === null) return true; // undated sources (hackernews/reddit last30days) are curated same-day by construction
    return published >= Date.parse(planDate) - FRESHNESS_DAYS * 86_400_000;
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

/** Largest engagement number across mixed units (points/comments/stars/...); 0 when empty. */
function maxEngagement(engagement: Record<string, unknown>): number {
    let max = 0;
    for (const v of Object.values(engagement)) {
        const n = toNumber(v);
        if (n !== undefined && n > max) max = n;
    }
    return max;
}

/** Engagement magnitude → 0..10 via log10 scaling (mixed units across sources). */
function engagementScore(engagement: Record<string, unknown>): number {
    const max = maxEngagement(engagement);
    if (max <= 0) return 0;
    return Math.min(10, Math.log10(max));
}

/**
 * Latin keywords match on a whole-word boundary plus common inflections
 * (`launch` still hits `launches`/`launched`/`launching` and `fine-tun` hits
 * `fine-tuning`, but short keywords never prefix-over-match — `cli` does not
 * hit `client`); CJK keywords match as substrings.
 */
function matchesKeyword(haystack: string, word: string): boolean {
    if (word.charCodeAt(0) > 0x2e80) return haystack.includes(word);
    return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s|ed|d|ing)?\\b`, 'i').test(haystack);
}

/**
 * MECE category of a doc (v1 — tune later), first match wins: tag map →
 * non-AI source deny → title + body-head keyword scan → `non-ai`.
 * Deterministic, no LLM.
 */
export function classifyCategory(doc: Doc): Category {
    const meta = asRecord(doc.metadata);
    const tags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [];
    for (const tag of tags) {
        const hit = TAG_CATEGORY[tag.toLowerCase()];
        if (hit) return hit;
    }
    if (NON_AI_SOURCES.has(typeof meta.source === 'string' ? meta.source : '')) return 'non-ai';
    const title = (doc.title ?? '').toLowerCase();
    const bodyHead = (doc.body ?? '').slice(0, 200).toLowerCase();
    for (const { category, words } of CATEGORY_KEYWORDS) {
        if (words.some((w) => matchesKeyword(title, w) || matchesKeyword(bodyHead, w))) return category;
    }
    return 'non-ai';
}

/**
 * Four QC dimensions (v1 — tune later), integers 0–5. Purity contract: a pure
 * function of (doc, planDate) — `planDate` is REQUIRED and the caller passes the
 * resolved plan date (never the wall clock), so the same input always yields the
 * same output (R3 determinism). quality from body length + sourcedness,
 * importance from source tier + relevance, urgency from publication date vs
 * `planDate`, impact from engagement magnitude. Ranking still uses planScore;
 * these feed QC thresholds (0094 filter mode).
 */
export function scoreDimensions(doc: Doc, planDate: string): DimensionScores {
    const meta = asRecord(doc.metadata);
    let quality = 1 + Math.min(4, Math.round((doc.body ?? '').length / 1500));
    if (doc.sourceUri) quality = Math.min(5, quality + 1);

    const source = typeof meta.source === 'string' ? meta.source : '';
    let importance = IMPORTANCE_BASE[source] ?? DEFAULT_IMPORTANCE;
    const relevance = toNumber(meta.relevance_score);
    if (relevance !== undefined && relevance >= 0.8) importance = Math.min(5, importance + 1);

    const published = docTimestamp(doc);
    let urgency = 3; // undated → curated same-day sources
    if (published !== null) {
        const dayMs = 86_400_000;
        const planDay = Math.floor(Date.parse(planDate) / dayMs);
        const ageDays = planDay - Math.floor(published / dayMs);
        urgency = ageDays <= 0 ? 5 : ageDays <= 2 ? 4 : ageDays <= 7 ? 3 : 1;
    }

    const max = maxEngagement(asRecord(meta.engagement));
    const impact = max > 1000 ? 5 : max > 100 ? 4 : max > 10 ? 3 : max > 1 ? 2 : 1;

    return { quality, importance, urgency, impact };
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

/** Full plan pipeline: clean → annotate (category + 4-dim QC scores) → gate (freshness/non-news) → score → URL-dedup → title-dedup → per-source cap → top N. */
export function planEpisode(docs: Doc[], options: PlanOptions): Doc[] {
    const planDate = options.date ?? new Date().toISOString().slice(0, 10);
    // URL dedup happens on the original sourceUri (first occurrence wins ties,
    // resolved below by score after the map).
    const byUrl = new Map<string, ScoredDoc>();
    const scored: ScoredDoc[] = [];
    for (const doc of docs) {
        // Annotate before any gate — understanding precedes selection; annotate drops nothing.
        const cleaned: Doc = {
            ...doc,
            body: cleanBody(doc.body ?? ''),
            metadata: {
                ...asRecord(doc.metadata),
                category: classifyCategory(doc),
                scores: scoreDimensions(doc, planDate),
            },
        };
        if (!passesGates(cleaned, planDate)) continue;
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

    const candidates = scored.filter((r) => !absorbed.has(r)).sort((a, b) => b.score - a.score);
    // Per-source cap, applied in score order: one feed's flood stops at PER_SOURCE_CAP.
    const perSource = new Map<string, number>();
    const selected: ScoredDoc[] = [];
    for (const record of candidates) {
        const source = sourceOf(record.doc);
        const count = perSource.get(source) ?? 0;
        if (count >= PER_SOURCE_CAP) continue;
        perSource.set(source, count + 1);
        selected.push(record);
        if (selected.length >= Math.max(1, options.maxItems)) break;
    }

    return selected.map((r) => {
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
    const planned = planEpisode(docs, { maxItems: maxItemsFromEnv(), date });
    return planContent(planned, date);
}

/** Shared ContentSchema wrapper (plan + filter modes); `metadata.docs: []` stays a valid exit-0 Content. */
function planContent(docs: Doc[], date: string): Content {
    return ContentSchema.parse({
        title: `每日 AI 播客选稿计划 — ${date}`,
        body: renderPlanMarkdown(docs, date),
        format: 'markdown',
        metadata: {
            generator: 'kk:episode-plan',
            date,
            doc_count: docs.length,
            docs,
        },
    });
}

function maxItemsFromEnv(): number {
    const raw = process.env.EPISODE_PLAN_MAX_ITEMS;
    if (raw === undefined || raw.trim() === '') return 20;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
}

/** Plan date shared by both modes: `EPISODE_PLAN_DATE` (YYYYMMDD or ISO) else today UTC. */
function resolvePlanDate(): string {
    const raw = process.env.EPISODE_PLAN_DATE ?? new Date().toISOString().slice(0, 10);
    return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

// ---------------------------------------------------------------------------
// Quality-controller filter mode (0094) — annotated Doc[] in, auditable
// kept/rejected split out (ADR-019 D3: QC is a visible, threshold-driven node).
// ---------------------------------------------------------------------------

/** Run modes: `plan` (default — the gated selection pipeline, unchanged) or `filter` (the QC gate). */
export type GeneratorMode = 'plan' | 'filter';

/** The closed MECE taxonomy (the values `classifyCategory` emits) — filter allowlists validate against it. */
const MECE_CATEGORIES: readonly Category[] = ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'];

/** The four QC dimensions, in reason-reporting order. */
const QC_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;
type QCDimension = (typeof QC_DIMENSIONS)[number];

/** Quality-controller filter configuration; every minimum is inclusive (score == min passes). */
export interface FilterConfig {
    /** Category allowlist — a doc survives only when `metadata.category` is one of these. */
    categories: Category[];
    minQuality: number;
    minImportance: number;
    minUrgency: number;
    minImpact: number;
}

/** A doc the filter dropped, with every failed check (`category:not-in-allowlist`, `quality:2<3`, …). */
export interface RejectedDoc {
    doc: Doc;
    reasons: string[];
}

/** Single source of filter defaults — standalone CLI and workflow stay in lockstep (no divergence). */
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
    categories: ['ai-news', 'ai-industry'],
    // 0098 dogfood calibration (r7, owner-approved 0099): the shipped 3/3/2/2 rejected 20/20
    // live candidates — the two strongest ai-news items died solely on `impact:1<2`, and
    // discussion-tier last30days content scores quality 2. quality 3→2, impact 2→1
    // (importance/urgency unchanged). The workflow's QC_* pins (kk-daily-ai-voice.yaml)
    // move in lockstep — env wins over these defaults, so a half-move is silently wrong.
    minQuality: 2,
    minImportance: 3,
    minUrgency: 2,
    minImpact: 1,
};

/** One QC_MIN_* threshold: an integer 0–5 or absent (→ fallback); anything else fails loud — never clamped. */
function parseFilterThreshold(raw: string | undefined, name: string, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = raw.trim();
    if (!/^\d+$/.test(value)) throw new Error(`${name}='${raw}' is not an integer in 0–5 (fail loud, no clamping)`);
    const parsed = Number.parseInt(value, 10);
    if (parsed < 0 || parsed > 5) throw new Error(`${name}=${parsed} is outside 0–5 (fail loud, no clamping)`);
    return parsed;
}

/** QC_CATEGORIES: a comma list of MECE categories; unknown entries fail loud (no silent drops). */
function parseFilterCategories(raw: string | undefined): Category[] {
    if (raw === undefined || raw.trim() === '') return [...DEFAULT_FILTER_CONFIG.categories];
    const entries = raw.split(',').map((entry) => entry.trim());
    for (const entry of entries) {
        if (!MECE_CATEGORIES.includes(entry as Category)) {
            throw new Error(
                `QC_CATEGORIES entry '${entry}' is not a MECE category (valid: ${MECE_CATEGORIES.join(', ')})`,
            );
        }
    }
    return entries as Category[];
}

/** Filter env in one place: QC_CATEGORIES + QC_MIN_{QUALITY,IMPORTANCE,URGENCY,IMPACT}; defaults from DEFAULT_FILTER_CONFIG. */
export function filterConfigFromEnv(env: Record<string, string | undefined> = process.env): FilterConfig {
    return {
        categories: parseFilterCategories(env.QC_CATEGORIES),
        minQuality: parseFilterThreshold(env.QC_MIN_QUALITY, 'QC_MIN_QUALITY', DEFAULT_FILTER_CONFIG.minQuality),
        minImportance: parseFilterThreshold(
            env.QC_MIN_IMPORTANCE,
            'QC_MIN_IMPORTANCE',
            DEFAULT_FILTER_CONFIG.minImportance,
        ),
        minUrgency: parseFilterThreshold(env.QC_MIN_URGENCY, 'QC_MIN_URGENCY', DEFAULT_FILTER_CONFIG.minUrgency),
        minImpact: parseFilterThreshold(env.QC_MIN_IMPACT, 'QC_MIN_IMPACT', DEFAULT_FILTER_CONFIG.minImpact),
    };
}

/** Read 0093's annotations off a filter input doc; fail loud naming the doc id — never silently pass unannotated docs. */
function requireAnnotation(doc: Doc): { category: Category; scores: Record<QCDimension, number> } {
    const meta = asRecord(doc.metadata);
    const category = meta.category;
    if (typeof category !== 'string' || !MECE_CATEGORIES.includes(category as Category)) {
        throw new Error(`doc '${doc.id}' has missing/invalid metadata.category — run the annotate pass first`);
    }
    const raw = asRecord(meta.scores);
    const scores = {} as Record<QCDimension, number>;
    for (const dim of QC_DIMENSIONS) {
        const value = raw[dim];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) {
            throw new Error(`doc '${doc.id}' has missing/invalid metadata.scores.${dim} — run the annotate pass first`);
        }
        scores[dim] = value;
    }
    return { category: category as Category, scores };
}

/**
 * Quality-controller filter (0094): an annotated `Doc[]` in, a kept/rejected split out. A doc
 * survives iff `metadata.category` is in the allowlist AND every dimension score is ≥ its inclusive
 * minimum (score == min passes). Rejection reasons accumulate every failed check in a fixed order —
 * `category:not-in-allowlist`, then `quality:2<3` / `importance:…` / `urgency:…` / `impact:…`.
 * Pure: docs are consumed read-only (no re-annotation, no mutation, kept docs returned as-is);
 * a missing or invalid annotation throws naming the doc id (main() → exit 1).
 */
export function filterAnnotated(docs: Doc[], config: FilterConfig): { kept: Doc[]; rejected: RejectedDoc[] } {
    const kept: Doc[] = [];
    const rejected: RejectedDoc[] = [];
    const minimums: Record<QCDimension, number> = {
        quality: config.minQuality,
        importance: config.minImportance,
        urgency: config.minUrgency,
        impact: config.minImpact,
    };
    for (const doc of docs) {
        const { category, scores } = requireAnnotation(doc);
        const reasons: string[] = [];
        if (!config.categories.includes(category)) reasons.push('category:not-in-allowlist');
        for (const dim of QC_DIMENSIONS) {
            if (scores[dim] < minimums[dim]) reasons.push(`${dim}:${scores[dim]}<${minimums[dim]}`);
        }
        if (reasons.length > 0) rejected.push({ doc, reasons });
        else kept.push(doc);
    }
    return { kept, rejected };
}

/** Sibling rejected-audit path: `<out>.json` → `<out>.rejected.json` (candidates.json → candidates.rejected.json). */
export function rejectedOutPath(outputPath: string): string {
    return outputPath.endsWith('.json')
        ? `${outputPath.slice(0, -'.json'.length)}.rejected.json`
        : `${outputPath}.rejected.json`;
}

/** The plugin's single atomic write seam (plan Content and the rejected audit both ride it). */
async function atomicWrite(path: string, value: unknown): Promise<void> {
    const fs = createNodeFileSystem();
    const outDir = dirname(path);
    if (outDir && outDir !== '.') await fs.ensureDir(outDir);
    await atomicWriteJson(path, value, fs);
}

export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    mode: GeneratorMode = 'plan',
): Promise<Content> {
    return mode === 'filter' ? processFilterIO(inputPath, outputPath) : processPlanIO(inputPath, outputPath);
}

/** Plan mode (default, behavior unchanged): blended `Doc[]` → gated/annotated plan Content. */
async function processPlanIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const content = docsToContent(docs, resolvePlanDate());
    await atomicWrite(outputPath, content);
    return content;
}

/**
 * Filter mode (0094): annotated `Doc[]` → QC-gated Content at `--out` plus the rejection audit at
 * `<out>.rejected.json` (`{ rejected, config, total }`, total = input doc count). Zero survivors is
 * a valid exit-0 outcome — the workflow routes `metadata.docs | length == 0` to done-no-content,
 * never a failure.
 */
async function processFilterIO(inputPath: string, outputPath: string): Promise<Content> {
    const config = filterConfigFromEnv();
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const { kept, rejected } = filterAnnotated(docs, config);
    const content = planContent(kept, resolvePlanDate());
    await atomicWrite(outputPath, content);
    await atomicWrite(rejectedOutPath(outputPath), { rejected, config, total: docs.length });
    return content;
}

export async function main(): Promise<number> {
    let values: { in?: string; out?: string; mode?: string };
    try {
        ({ values } = parseArgs({
            options: { in: { type: 'string' }, out: { type: 'string' }, mode: { type: 'string' } },
        }));
    } catch (err: unknown) {
        echoError(`episode-plan-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('episode-plan-gen failed: Missing required arguments: --in <docs.json> --out <content.json>');
        return 1;
    }
    // Mode precedence (0097 kk-seam wiring): explicit --mode flag > EPISODE_PLAN_MODE env > 'plan'.
    // The env rung exists because `kk executor run` spawns plugin entries with --in/--out only
    // (ADR-006, apps/cli/src/invoke.ts) and cannot forward extra CLI args.
    const mode = values.mode ?? process.env.EPISODE_PLAN_MODE ?? 'plan';
    if (mode !== 'plan' && mode !== 'filter') {
        echoError(
            `episode-plan-gen failed: unknown mode '${mode}' (from --mode flag or EPISODE_PLAN_MODE env; valid: plan, filter)`,
        );
        return 1;
    }
    try {
        await processGeneratorIO(values.in, values.out, mode);
        return 0;
    } catch (err: unknown) {
        echoError(`episode-plan-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
