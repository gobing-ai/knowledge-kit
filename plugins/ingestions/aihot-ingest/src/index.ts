import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { atomicWriteJson, createNodeFileSystem, readJsonFile } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { z } from 'zod';
import { type AihotDeps, createAihotClient } from './client';
import { mapAihotItemsToDocs } from './mapper';
import { AIHOT_FEED_URL_DEFAULT, fetchRssDocs, type RssFetchLike } from './rss';

export * from './client';
export * from './mapper';
export * from './rss';

export interface IngestionOptions {
    out: string;
    limit?: number;
    cursor?: string;
    stateFile?: string;
}

export interface IngestionResult {
    docs: Doc[];
    cursor: string;
    asOf?: string;
}

const IngestionInputSchema = z.object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).optional(),
    stateFile: z.string().trim().min(1).optional(),
});

const CursorStateSchema = z.object({ cursor: z.string().trim().min(1) });

function parseLimit(value: string): number {
    return z.coerce.number().int().min(1).max(100).parse(value);
}

export async function processIngestionIO(
    options: IngestionOptions,
    depsOverride?: Partial<AihotDeps>,
    rssFetchLike: RssFetchLike = fetch,
): Promise<IngestionResult> {
    const fs = createNodeFileSystem();

    // RSS is the default source (2026-09-08 dogfood: the aihot.virxact.com API served a
    // 2020–2025 archive — every item failed the 7-day freshness gate; see rss.ts). The API
    // path stays reachable with AIHOT_SOURCE=api for when the CMS carries live curated items.
    const source = process.env.AIHOT_SOURCE?.trim() || 'rss';
    if (source === 'api') {
        return processApiSource(options, fs, depsOverride);
    }
    return processRssSource(options, fs, rssFetchLike);
}

/** Legacy aihot.virxact.com API source (cursor/stateFile contract preserved). */
async function processApiSource(
    options: IngestionOptions,
    fs: ReturnType<typeof createNodeFileSystem>,
    depsOverride?: Partial<AihotDeps>,
): Promise<IngestionResult> {
    const client = createAihotClient(depsOverride);

    let effectiveCursor = options.cursor?.trim();
    if (!effectiveCursor && options.stateFile && (await fs.exists(options.stateFile))) {
        effectiveCursor = CursorStateSchema.parse(await readJsonFile(options.stateFile, fs)).cursor;
    }

    let items: import('./client').AihotItem[];
    let cursor: string;
    let asOf: string | undefined;

    if (effectiveCursor) {
        const changes = await client.fetchChanges({
            cursor: effectiveCursor,
            limit: options.limit,
        });
        items = changes.changes.flatMap((change) => (change.op === 'upsert' ? [change.item] : []));
        cursor = changes.cursor;
    } else {
        const snapshot = await client.fetchSnapshot({
            limit: options.limit,
        });
        items = snapshot.items;
        cursor = snapshot.cursor;
        asOf = snapshot.asOf;
    }

    const docs = DocListSchema.parse(mapAihotItemsToDocs(items));
    await writeOutput(fs, options, docs);

    if (options.stateFile) {
        await writeState(fs, options.stateFile, {
            cursor,
            asOf,
            lastSyncAt: new Date().toISOString(),
            itemCount: docs.length,
        });
    }

    return { docs, cursor, asOf };
}

/** RSS feed source (default): stateless fetch, no cursor (feed order is newest-first). */
async function processRssSource(
    options: IngestionOptions,
    fs: ReturnType<typeof createNodeFileSystem>,
    rssFetchLike: RssFetchLike,
): Promise<IngestionResult> {
    const feedUrl = process.env.AIHOT_FEED_URL?.trim() || AIHOT_FEED_URL_DEFAULT;
    const limit = options.limit ?? 10;
    const { docs, asOf } = await fetchRssDocs(feedUrl, limit, rssFetchLike);
    const validated = DocListSchema.parse(docs);
    await writeOutput(fs, options, validated);

    if (options.stateFile) {
        await writeState(fs, options.stateFile, {
            source: 'rss',
            feedUrl,
            asOf,
            lastSyncAt: new Date().toISOString(),
            itemCount: validated.length,
        });
    }

    return { docs: validated, cursor: '', asOf };
}

async function writeOutput(
    fs: ReturnType<typeof createNodeFileSystem>,
    options: IngestionOptions,
    docs: Doc[],
): Promise<void> {
    const outDir = dirname(options.out);
    if (outDir && outDir !== '.') {
        await fs.ensureDir(outDir);
    }
    await atomicWriteJson(options.out, docs, fs);
}

async function writeState(
    fs: ReturnType<typeof createNodeFileSystem>,
    stateFile: string,
    payload: Record<string, unknown>,
): Promise<void> {
    const stateDir = dirname(stateFile);
    if (stateDir && stateDir !== '.') {
        await fs.ensureDir(stateDir);
    }
    await atomicWriteJson(stateFile, payload, fs);
}

export async function main(depsOverride?: Partial<AihotDeps>): Promise<number> {
    let values: { in?: string; out?: string; limit?: string; cursor?: string; 'state-file'?: string };
    try {
        ({ values } = parseArgs({
            options: {
                in: { type: 'string' },
                out: { type: 'string' },
                limit: { type: 'string' },
                cursor: { type: 'string' },
                'state-file': { type: 'string' },
            },
        }));
    } catch (err: unknown) {
        echoError(`aihot-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    if (!values.out) {
        echoError('aihot-ingest failed: Missing required argument: --out');
        return 1;
    }

    try {
        const input = values.in ? IngestionInputSchema.parse(await readJsonFile(values.in)) : {};
        await processIngestionIO(
            {
                out: values.out,
                limit: values.limit ? parseLimit(values.limit) : (input.limit ?? 10),
                cursor: values.cursor ?? input.cursor,
                stateFile: values['state-file'] ?? input.stateFile,
            },
            depsOverride,
        );
        return 0;
    } catch (err: unknown) {
        echoError(`aihot-ingest failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
