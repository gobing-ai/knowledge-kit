import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';

/**
 * Ingestion adapter over the Horizon CLI (task 0089 contract).
 * Runs `uv run horizon` (cwd = the Horizon repo), then parses the digest
 * `<data-dir>/summaries/horizon-<date>-<lang>.md` written during this run —
 * one Doc per `### [title](url)` item block.
 */

const InputConfigSchema = z.object({
    data_dir: z.string().trim().min(1).optional(),
    config: z.string().trim().min(1).optional(),
    hours: z.number().int().min(1).optional(),
    languages: z.array(z.string().trim().min(1)).optional(),
    horizon_dir: z.string().trim().min(1).optional(),
    /**
     * When this tick's run writes no digest (Horizon exits 0 on an empty 6h
     * window), fall back to the newest digest at most this many ms old instead
     * of emitting []. Doc ids are date-keyed and stable, so repeats dedupe
     * downstream (2026-10-23: Oct 21 contributed zero docs — every tick hit an
     * empty window).
     */
    stale_fallback_ms: z.number().int().min(0).optional(),
});

const DEFAULT_STALE_FALLBACK_MS = 26 * 3_600_000;

export interface HorizonRunResult {
    exitCode: number;
    stderr: string;
}

/** Subprocess seam — tests inject a fake that pre-seeds a summaries file. */
export type RunHorizon = (config: z.infer<typeof InputConfigSchema>, horizonDir: string) => Promise<HorizonRunResult>;

export const defaultRunner: RunHorizon = async (config, horizonDir) => {
    const argv = [process.env.HORIZON_UV ?? 'uv', 'run', 'horizon'];
    if (config.hours !== undefined) argv.push('--hours', String(config.hours));
    if (config.data_dir !== undefined) argv.push('-d', config.data_dir);
    if (config.config !== undefined) argv.push('-c', config.config);
    const proc = Bun.spawnSync(argv, { cwd: horizonDir, stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
};

const HEADING_RE = /^### \[(.+)\]\((.+)\) ⭐️ ([\d.]+)\/10\s*$/m;
const ANCHOR_RE = /<a id="item-([a-z0-9-]+)-(\d+)"><\/a>/;

interface ParsedItem {
    anchorProfile: string;
    anchorN: string;
    title: string;
    url: string;
    score: number;
    block: string;
}

/** Split a digest markdown file into per-item blocks keyed off the item anchors. */
export function splitItemBlocks(markdown: string): ParsedItem[] {
    const items: ParsedItem[] = [];
    const segments = markdown.split(/(?=<a id="item-)/);
    for (const segment of segments) {
        const anchor = segment.match(ANCHOR_RE);
        const heading = segment.match(HEADING_RE);
        if (!anchor || !heading) continue;
        items.push({
            anchorProfile: anchor[1] ?? '',
            anchorN: anchor[2] ?? '',
            title: heading[1] ?? '',
            url: heading[2] ?? '',
            score: Number(heading[3]),
            block: segment,
        });
    }
    return items;
}

/** Map one parsed item block to a Doc. */
export function itemToDoc(item: ParsedItem, date: string, lang: string): Doc {
    const lines = item.block.split('\n');
    const bodyParts: string[] = [];
    const references: string[] = [];
    let sourceLine = '';
    let tags: string[] = [];
    let inDetails = false;
    for (const line of lines.slice(1)) {
        if (line.startsWith('<details')) inDetails = true;
        if (line.startsWith('</details>')) {
            inDetails = false;
            continue;
        }
        if (inDetails) {
            const href = line.match(/<a href="([^"]+)"/);
            if (href?.[1]) references.push(href[1]);
            continue;
        }
        const tagMatch = line.match(/^\*\*Tags\*\*:\s*(.+)$/);
        if (tagMatch?.[1]) {
            tags = [...tagMatch[1].matchAll(/#([^`,\s]+)/g)].map((m) => m[1] ?? '');
            continue;
        }
        if (/^---\s*$/.test(line)) continue;
        if (/^[a-z0-9_-]+ · /i.test(line) && !sourceLine) {
            sourceLine = line.trim();
            continue;
        }
        if (line.trim()) bodyParts.push(line);
    }
    const doc: Doc = {
        id: `horizon:${date}-${item.anchorProfile}-${item.anchorN}`,
        title: item.title,
        body: bodyParts.join('\n').trim(),
        sourceUri: item.url,
        mediaType: 'text/markdown',
        metadata: {
            lang,
            date,
            profile: item.anchorProfile,
            score: item.score,
            source: sourceLine.split(' · ')[0] ?? '',
            source_line: sourceLine,
            tags,
            references,
        },
    };
    return doc;
}

/** Parse a full digest file into Doc[]. */
export function digestToDocs(markdown: string, date: string, lang: string): Doc[] {
    return DocListSchema.parse(splitItemBlocks(markdown).map((item) => itemToDoc(item, date, lang)));
}

export interface IngestionOptions {
    out: string;
}

export async function processIngestionIO(
    options: IngestionOptions,
    config: z.infer<typeof InputConfigSchema>,
    runner: RunHorizon = defaultRunner,
    now: Date = new Date(),
): Promise<{ docs: Doc[] }> {
    const fs = createNodeFileSystem();
    const horizonDir = config.horizon_dir ?? process.env.HORIZON_DIR ?? join(homedir(), 'tools', 'Horizon');
    const dataDir = config.data_dir ?? join(horizonDir, 'data');

    const runStartedAt = now.getTime();
    const run = await runner(config, horizonDir);
    if (run.exitCode !== 0) {
        throw new Error(`horizon exited ${run.exitCode}: ${run.stderr.trim() || 'no stderr'}`);
    }

    // Collect digests written (or refreshed) during this run. The date comes from the
    // FILENAME, not the run clock — Horizon names the digest for the date it finishes,
    // which crosses UTC midnight when a long crawl runs late in the day (dogfood
    // daily-ai-news-20260903: run started 23:35 UTC, digest written 00:03 UTC next day).
    const langs = new Set(config.languages ?? ['zh', 'en']);
    const summariesDir = join(dataDir, 'summaries');
    const docs: Doc[] = [];
    if (!(await fs.exists(summariesDir))) {
        echoError(`horizon-ingest: no summaries dir at ${summariesDir} — emitting []`);
    }
    const digestRe = /^horizon-(\d{4}-\d{2}-\d{2})-([a-z-]+)\.md$/;
    const entries = (await fs.exists(summariesDir)) ? await fs.readDir(summariesDir) : [];
    for (const entry of entries) {
        const match = entry.match(digestRe);
        if (!match?.[1] || !match?.[2] || !langs.has(match[2])) continue;
        const file = join(summariesDir, entry);
        const stat = await fs.stat(file);
        if (!stat || stat.mtimeMs < runStartedAt - 1000) continue; // stale file from an earlier run
        docs.push(...digestToDocs(await fs.readFile(file), match[1], match[2]));
    }
    if (docs.length === 0) {
        // This tick wrote no digest (empty fetch window exits 0). Reuse the newest
        // digest while it is young enough to still matter for a daily podcast.
        const fallbackMs = config.stale_fallback_ms ?? DEFAULT_STALE_FALLBACK_MS;
        let newest: { entry: string; mtimeMs: number } | null = null;
        for (const entry of entries) {
            const match = entry.match(digestRe);
            if (!match?.[1] || !match?.[2] || !langs.has(match[2])) continue;
            const stat = await fs.stat(join(summariesDir, entry));
            if (!stat) continue;
            if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { entry, mtimeMs: stat.mtimeMs };
        }
        if (newest && runStartedAt - newest.mtimeMs <= fallbackMs) {
            const match = newest.entry.match(digestRe);
            if (match?.[1] && match?.[2]) {
                echoError(
                    `horizon-ingest: no fresh digest this run — falling back to ${newest.entry} (${Math.round(
                        (runStartedAt - newest.mtimeMs) / 3_600_000,
                    )}h old)`,
                );
                docs.push(...digestToDocs(await fs.readFile(join(summariesDir, newest.entry)), match[1], match[2]));
            }
        }
    }
    if (docs.length === 0) {
        echoError(
            `horizon-ingest: no fresh digest in ${summariesDir} (languages: ${[...langs].join(', ')}) — emitting []`,
        );
    }

    const outDir = dirname(options.out);
    if (outDir && outDir !== '.') await fs.ensureDir(outDir);
    await atomicWriteJson(options.out, DocListSchema.parse(docs), fs);
    return { docs };
}

export async function main(runner?: RunHorizon): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (err: unknown) {
        echoError(`horizon-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('horizon-ingest failed: Missing required arguments: --in <config.json> --out <docs.json>');
        return 1;
    }
    try {
        const config = InputConfigSchema.parse(await readJsonFile(values.in));
        await processIngestionIO({ out: values.out }, config, runner);
        return 0;
    } catch (err: unknown) {
        echoError(`horizon-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
