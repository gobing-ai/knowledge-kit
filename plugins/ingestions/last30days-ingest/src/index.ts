import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';

/**
 * Ingestion adapter over the last30days skill CLI (task 0089 contract).
 * Shells out to `last30days.py --emit=json --json-profile=agent`, captures the
 * agent JSON from `--output`, and maps `results[]` → `Doc[]` (one Doc per item).
 * Without `SETUP_COMPLETE` the tool self-degrades to keyless web search — that
 * degraded `Doc[]` is still valid output (exit 0).
 */

const InputConfigSchema = z.object({
    topic: z.string().trim().min(1),
    days: z.number().int().min(1).max(90).optional(),
    web_backend: z.string().trim().min(1).optional(),
    save_dir: z.string().trim().min(1).optional(),
});

export interface Last30DaysRunResult {
    exitCode: number;
    outputPath: string;
    stderr: string;
}

/** Subprocess seam — tests inject a fake that writes a canned agent JSON. */
export type RunLast30Days = (
    config: z.infer<typeof InputConfigSchema>,
    outputPath: string,
) => Promise<Last30DaysRunResult>;

export const defaultRunner: RunLast30Days = async (config, outputPath) => {
    const skillDir = process.env.LAST30DAYS_SKILL_DIR ?? join(homedir(), '.agents', 'skills', 'last30days');
    // The skill dir is the spawn cwd: when the ~/.agents/skills/last30days symlink dangles,
    // Bun reports it as `ENOENT ... posix_spawn 'python3'` — pointing at the interpreter, not
    // the dir (2026-10-20 incident lost 9h of diagnosis to that). Fail with the real problem.
    if (!existsSync(skillDir)) {
        throw new Error(
            `skill dir missing at ${skillDir} — restore the last30days skill checkout/symlink or set LAST30DAYS_SKILL_DIR`,
        );
    }
    const argv = [
        process.env.LAST30DAYS_PYTHON ?? 'python3',
        join(skillDir, 'scripts', 'last30days.py'),
        config.topic,
        '--emit=json',
        '--json-profile=agent',
        '--output',
        outputPath,
    ];
    if (config.days !== undefined) argv.push('--days', String(config.days));
    if (config.web_backend !== undefined) argv.push('--web-backend', config.web_backend);
    if (config.save_dir !== undefined) argv.push('--save-dir', config.save_dir);
    const proc = Bun.spawnSync(argv, { cwd: skillDir, stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: proc.exitCode ?? 1, outputPath, stderr: proc.stderr.toString() };
};

const AgentJsonSchema = z.object({
    schema_version: z.string().optional(),
    window_days: z.number().optional(),
    query: z.string().optional(),
    results: z.array(z.record(z.string(), z.unknown())),
});

export function mapResultsToDocs(agentJson: unknown, topic: string): Doc[] {
    const parsed = AgentJsonSchema.parse(agentJson);
    const docs: Doc[] = [];
    for (const item of parsed.results) {
        try {
            // Degraded/keyless mode uses the full URL as candidate_id — a 90-char URL id is
            // brittle for downstream STORM citation (outline agents miscite them; dogfood
            // run ff10095b failed assertKnownEvidence with 53 unknown IDs). Hash those.
            const rawId =
                typeof item.candidate_id === 'string' && item.candidate_id ? item.candidate_id : String(item.url ?? '');
            const idSeed = rawId.startsWith('http')
                ? createHash('sha256').update(rawId).digest('hex').slice(0, 16)
                : rawId;
            const doc: Doc = {
                id: `last30days:${idSeed}`,
                body: String(item.summary ?? ''),
            };
            if (typeof item.title === 'string' && item.title) doc.title = item.title;
            if (typeof item.url === 'string' && item.url) doc.sourceUri = item.url;
            doc.mediaType = 'text/markdown';
            doc.metadata = {
                topic,
                window_days: parsed.window_days,
                cluster: item.cluster,
                source: item.source,
                engagement: item.engagement,
                relevance_score: item.relevance_score,
                published_at: item.published_at,
                schema_version: parsed.schema_version,
            };
            docs.push(doc);
        } catch (err: unknown) {
            echoError(
                `last30days-ingest: skipping unparseable item (${err instanceof Error ? err.message : String(err)})`,
            );
        }
    }
    return DocListSchema.parse(docs);
}

export interface IngestionOptions {
    out: string;
}

export async function processIngestionIO(
    options: IngestionOptions,
    config: z.infer<typeof InputConfigSchema>,
    runner: RunLast30Days = defaultRunner,
): Promise<{ docs: Doc[] }> {
    const fs = createNodeFileSystem();
    // Relative --out would split cwd semantics: the engine writes its capture relative to the
    // skill dir (its cwd) while we read it relative to ours. Pin everything to an absolute path.
    const out = resolve(options.out);
    const outDir = dirname(out);
    if (outDir && outDir !== '.') await fs.ensureDir(outDir);
    const capturePath = join(outDir || '.', '.last30days-agent.json');
    const run = await runner(config, capturePath);
    if (run.exitCode !== 0) {
        throw new Error(`last30days exited ${run.exitCode}: ${run.stderr.trim() || 'no stderr'}`);
    }
    const docs = mapResultsToDocs(await readJsonFile(capturePath), config.topic);
    await atomicWriteJson(out, docs, fs);
    return { docs };
}

export async function main(runner?: RunLast30Days): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (err: unknown) {
        echoError(`last30days-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('last30days-ingest failed: Missing required arguments: --in <config.json> --out <docs.json>');
        return 1;
    }
    try {
        const config = InputConfigSchema.parse(await readJsonFile(values.in));
        await processIngestionIO({ out: values.out }, config, runner);
        return 0;
    } catch (err: unknown) {
        echoError(`last30days-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
