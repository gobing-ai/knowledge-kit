import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

/**
 * news-report-gen: assemble the per-run report from existing run artifacts —
 * kept-candidate QC scores, per-dimension min/max/avg aggregates, threshold-
 * rejected counts, and per-step wall-clock timing. Output-only Content (task
 * 0117): no publish side effect, no engine data channel (# ponytail: step
 * boundary timing stitched at report time; upgrade path = engine-side ledger
 * if drift ever matters).
 *
 * Inputs:
 * - `--in` Doc[] — kept candidates (`2-plan/episode-plan.json`, built by the
 *   workflow from the filter Content's metadata.docs). Scores live in
 *   `metadata.scores` (quality/importance/urgency/impact 0-5).
 * - `NEWS_REPORT_REJECTED_FILE` — the filter's rejected audit path
 *   (`2-plan/candidates.rejected.json`, RejectedDoc[] of {doc, reasons})
 * - `NEWS_REPORT_QC_FILE` — the generate stage's QC audit path
 *   (`3-audio/<date>_11_generate_content.json`); absent -> the 音频 QC block is omitted;
 *   absent or unreadable -> reject counts render as 0, never throw.
 * - `NEWS_REPORT_TIMING_FILE` — `<work_dir>/step-timing.json` JSONL of
 *   {step, startedAt, endedAt} appended by the workflow shell steps; missing
 *   or unreadable -> the timing section is omitted, never throw.
 * - Threshold consistency: `QC_MIN_*` envs — the exact names the workflow
 *   already pins (must move in lockstep with episode-plan-gen's
 *   DEFAULT_FILTER_CONFIG), so one grep shows both sides.
 * - `NEWS_REPORT_DATE` (YYYYMMDD or ISO), else today (UTC).
 */

const QC_DIMENSIONS = ['quality', 'importance', 'urgency', 'impact'] as const;
type QCDimension = (typeof QC_DIMENSIONS)[number];

const QC_MIN_ENVS: Record<QCDimension, string> = {
    quality: 'QC_MIN_QUALITY',
    importance: 'QC_MIN_IMPORTANCE',
    urgency: 'QC_MIN_URGENCY',
    impact: 'QC_MIN_IMPACT',
};

interface TimingEntry {
    step: string;
    startedAt: string;
    endedAt: string;
}

function scoreOf(doc: Doc, dim: QCDimension): number | null {
    const meta = doc.metadata as Record<string, unknown> | undefined;
    const value = (meta?.scores as Record<string, unknown> | undefined)?.[dim];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Per-dimension min/max/avg/count over the kept candidates' scores. */
export function scoreAggregates(
    docs: Doc[],
): Record<QCDimension, { min: number | null; max: number | null; avg: number | null; count: number }> {
    const out = {} as Record<
        QCDimension,
        { min: number | null; max: number | null; avg: number | null; count: number }
    >;
    for (const dim of QC_DIMENSIONS) {
        const values = docs.map((d) => scoreOf(d, dim)).filter((v): v is number => v !== null);
        const count = values.length;
        out[dim] =
            count === 0
                ? { min: null, max: null, avg: null, count: 0 }
                : {
                      min: Math.min(...values),
                      max: Math.max(...values),
                      avg: Math.round((values.reduce((a, b) => a + b, 0) / count) * 10) / 10,
                      count,
                  };
    }
    return out;
}

/** Hostname of a URL-ish value; unparseable/absent → '—'. */
function domainOf(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') return '—';
    try {
        return new URL(value).hostname || '—';
    } catch {
        return '—';
    }
}

/**
 * Per-source item counts with domain sub-counts from candidate metadata
 * (`source`/`sourceName`, falling back to the URL hostname).
 */
export function sourceBreakdown(
    docs: Doc[],
): { source: string; items: number; domains: { domain: string; items: number }[] }[] {
    const bySource = new Map<string, Map<string, number>>();
    for (const doc of docs) {
        const meta = doc.metadata as Record<string, unknown> | undefined;
        const source = typeof meta?.source === 'string' && meta.source.trim() !== '' ? meta.source : '未知';
        const domain =
            typeof meta?.sourceName === 'string' && meta.sourceName.trim() !== ''
                ? meta.sourceName
                : domainOf(meta?.originalUrl ?? doc.sourceUri);
        const domains = bySource.get(source) ?? new Map<string, number>();
        domains.set(domain, (domains.get(domain) ?? 0) + 1);
        bySource.set(source, domains);
    }
    return [...bySource.entries()]
        .map(([source, domains]) => ({
            source,
            items: [...domains.values()].reduce((sum, count) => sum + count, 0),
            domains: [...domains.entries()]
                .map(([domain, count]) => ({ domain, items: count }))
                .sort((a, b) => b.items - a.items || a.domain.localeCompare(b.domain)),
        }))
        .sort((a, b) => b.items - a.items || a.source.localeCompare(b.source));
}

/** Rejected-count per threshold dimension from the filter's rejection reasons (`dim:<score><<min>`). */
export function rejectedCounts(
    rejected: { doc: Doc; reasons: string[] }[],
): Record<QCDimension, number> & { category: number } {
    const out = { category: 0 } as Record<QCDimension, number> & { category: number };
    for (const dim of QC_DIMENSIONS) out[dim] = 0;
    for (const entry of rejected) {
        if (entry.reasons.includes('category:not-in-allowlist')) out.category += 1;
        for (const dim of QC_DIMENSIONS) {
            if (entry.reasons.some((r) => r.startsWith(`${dim}:`))) out[dim] += 1;
        }
    }
    return out;
}

export function minimumsFromEnv(): Record<QCDimension, number | null> {
    const out = {} as Record<QCDimension, number | null>;
    for (const dim of QC_DIMENSIONS) {
        const raw = process.env[QC_MIN_ENVS[dim]];
        const n = raw === undefined || raw.trim() === '' ? Number.NaN : Number.parseInt(raw, 10);
        out[dim] = Number.isFinite(n) ? n : null;
    }
    return out;
}

interface RejectedAudit {
    doc: Doc;
    reasons: string[];
}

/** Generate-stage audio QC summary rendered into the run report (task 0139 R5b). */
export interface QcSummary {
    passed: boolean;
    overallScore: number;
    /** Per-issue-type counts, most frequent first; `duration_anomaly: <detail>` counts as its type. */
    issues: { type: string; count: number }[];
}

/**
 * Read the generate stage's QC audit (`<run_date>_11_generate_content.json`) (task 0139 R5b).
 *
 * Best-effort by contract: an absent, unreadable, or malformed file returns `null` and the report
 * omits the section — a run report must never fail a run. Issue types are the text before the first
 * `:` so a detailed `duration_anomaly: expected …` rolls up under one row.
 */
export async function readQcSummary(path: string | undefined): Promise<QcSummary | null> {
    if (!path || path.trim() === '') return null;
    try {
        const parsed = JSON.parse(await Bun.file(path).text()) as { metadata?: { qc?: unknown } } | null;
        const qc = parsed?.metadata?.qc;
        if (qc === null || typeof qc !== 'object') return null;
        const record = qc as { passed?: unknown; overallScore?: unknown; segmentAudits?: unknown };
        const counts = new Map<string, number>();
        const audits = Array.isArray(record.segmentAudits) ? record.segmentAudits : [];
        for (const audit of audits) {
            const issues = (audit as { issues?: unknown } | null)?.issues;
            if (!Array.isArray(issues)) continue;
            for (const issue of issues) {
                if (typeof issue !== 'string') continue;
                const type = issue.split(':')[0]?.trim() || issue;
                counts.set(type, (counts.get(type) ?? 0) + 1);
            }
        }
        return {
            passed: record.passed === true,
            overallScore: typeof record.overallScore === 'number' ? record.overallScore : 0,
            issues: [...counts.entries()]
                .map(([type, count]) => ({ type, count }))
                .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
        };
    } catch {
        return null;
    }
}

/** Parse the timing JSONL; unreadable/missing -> [] (never throw). Last entry per step wins. */
export async function readTiming(path: string | undefined): Promise<TimingEntry[]> {
    if (!path || path.trim() === '') return [];
    let raw: string;
    try {
        raw = await Bun.file(path).text();
    } catch {
        return [];
    }
    const last = new Map<string, TimingEntry>();
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        try {
            const entry = JSON.parse(trimmed) as Partial<TimingEntry>;
            if (typeof entry.step !== 'string' || entry.step.trim() === '') continue;
            if (typeof entry.startedAt !== 'string' || typeof entry.endedAt !== 'string') continue;
            last.set(entry.step, { step: entry.step, startedAt: entry.startedAt, endedAt: entry.endedAt });
        } catch {
            // skip malformed JSONL line (# ponytail: report-side tolerance, stamping owns the format)
        }
    }
    return [...last.values()];
}

function durationMs(entry: TimingEntry): number | null {
    const start = Date.parse(entry.startedAt);
    const end = Date.parse(entry.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return Math.max(0, end - start);
}

/** Render the report markdown for a kept-candidate Doc[] (pure — exported for tests). */
export function renderReportMarkdown(
    docs: Doc[],
    date: string,
    options: {
        rejected?: { doc: Doc; reasons: string[] }[];
        timing?: TimingEntry[];
        qc?: QcSummary | null;
    } = {},
): string {
    const lines: string[] = [`# 每日 AI 语音运行报告 — ${date}`, ''];
    lines.push('## 选稿评分（保留候选）', '');
    if (docs.length === 0) {
        lines.push('本期无保留候选。', '');
    } else {
        lines.push('| # | 候选 | quality | importance | urgency | impact |', '| --- | --- | --- | --- | --- | --- |');
        docs.forEach((doc, i) => {
            const cells = QC_DIMENSIONS.map((dim) => scoreOf(doc, dim) ?? '—');
            lines.push(`| ${i + 1} | ${(doc.title ?? doc.id ?? '').replace(/\|/g, '\\|')} | ${cells.join(' | ')} |`);
        });
        lines.push('');
        const agg = scoreAggregates(docs);
        lines.push('**维度聚合**（min / max / avg / 样本数）', '');
        lines.push('| 维度 | min | max | avg | count |', '| --- | --- | --- | --- | --- |');
        for (const dim of QC_DIMENSIONS) {
            const a = agg[dim];
            lines.push(`| ${dim} | ${a.min ?? '—'} | ${a.max ?? '—'} | ${a.avg ?? '—'} | ${a.count} |`);
        }
        lines.push('');
        lines.push('## 来源分布', '');
        lines.push('| 来源 | 条数 | 域名 |', '| --- | --- | --- |');
        for (const group of sourceBreakdown(docs)) {
            const domainCell = group.domains.map((d) => `${d.domain.replace(/\|/g, '\\|')} (${d.items})`).join(', ');
            lines.push(`| ${group.source} | ${group.items} | ${domainCell || '—'} |`);
        }
        lines.push('');
    }

    const mins = minimumsFromEnv();
    const counts = rejectedCounts(options.rejected ?? []);
    lines.push('## 阈值拒绝计数', '');
    lines.push('| 检查 | 阈值 | 拒绝数 |', '| --- | --- | --- |');
    for (const dim of QC_DIMENSIONS) {
        const min = mins[dim];
        lines.push(`| ${dim} | ${min === null ? '—' : min} | ${counts[dim]} |`);
    }
    lines.push(`| category allowlist | — | ${counts.category} |`);
    lines.push('');

    const qc = options.qc ?? null;
    if (qc !== null) {
        // 0139 R5b: the audio QC verdict is otherwise invisible in the report — this run published
        // an episode whose audit said `passed:false`, and nothing but the artifact recorded it.
        lines.push('## 音频 QC', '');
        lines.push('| 指标 | 值 |', '| --- | --- |');
        lines.push(`| 综合评分 | ${qc.overallScore} |`);
        lines.push(`| 通过 | ${qc.passed ? '是' : '否'} |`);
        for (const issue of qc.issues) lines.push(`| ${issue.type} | ${issue.count} |`);
        lines.push('');
    }

    const timing = options.timing ?? [];
    if (timing.length > 0) {
        lines.push('## 步耗时', '');
        lines.push('| 步骤 | startedAt | endedAt | 耗时 |', '| --- | --- | --- | --- |');
        let totalMs = 0;
        let totalKnown = true;
        for (const entry of timing) {
            const ms = durationMs(entry);
            if (ms === null) totalKnown = false;
            else totalMs += ms;
            lines.push(`| ${entry.step} | ${entry.startedAt} | ${entry.endedAt} | ${ms === null ? '—' : `${ms} ms`} |`);
        }
        lines.push('');
        if (totalKnown) lines.push(`**总耗时**: ${totalMs} ms（各步相加）`, '');
    }

    return lines.join('\n');
}

/**
 * Read the rejected audit; absent/unreadable/malformed -> [] (never throw).
 *
 * Two writer shapes: a bare `RejectedAudit[]` (older producers) and episode-plan-gen's
 * `{ rejected, config, total }` envelope (`processFilterIO` — the live one). Reading only the
 * array shape reported 0 rejections for every real run (task 0138 D1).
 */
export async function readRejectedAudit(path: string | undefined): Promise<RejectedAudit[]> {
    if (!path || path.trim() === '') return [];
    try {
        const parsed: unknown = JSON.parse(await Bun.file(path).text());
        if (Array.isArray(parsed)) return parsed as RejectedAudit[];
        const rejected = (parsed as { rejected?: unknown } | null)?.rejected;
        return Array.isArray(rejected) ? (rejected as RejectedAudit[]) : [];
    } catch {
        return [];
    }
}

/** Build the report Content from a kept-candidate Doc[]. */
export function docsToContent(
    docs: Doc[],
    date: string,
    options: {
        rejected?: { doc: Doc; reasons: string[] }[];
        timing?: TimingEntry[];
        qc?: QcSummary | null;
    },
): Content {
    return ContentSchema.parse({
        title: `每日 AI 语音运行报告 — ${date}`,
        body: renderReportMarkdown(docs, date, options),
        format: 'markdown',
        metadata: { generator: 'kk:news-report', date, doc_count: docs.length },
    });
}

function dateFromEnv(): string {
    const raw = process.env.NEWS_REPORT_DATE ?? new Date().toISOString().slice(0, 10);
    return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
}

export async function processGeneratorIO(inputPath: string, outputPath: string): Promise<Content> {
    const docs = DocListSchema.parse(await readJsonFile(inputPath));
    const rejected = await readRejectedAudit(process.env.NEWS_REPORT_REJECTED_FILE);
    const timing = await readTiming(process.env.NEWS_REPORT_TIMING_FILE);
    const qc = await readQcSummary(process.env.NEWS_REPORT_QC_FILE);
    const content = docsToContent(docs, dateFromEnv(), { rejected, timing, qc });
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
        echoError(`news-report-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('news-report-gen failed: Missing required arguments: --in <docs.json> --out <content.json>');
        return 1;
    }
    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`news-report-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
