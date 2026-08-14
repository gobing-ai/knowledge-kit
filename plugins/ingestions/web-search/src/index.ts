import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';

/** Validated `--in` input per the 0054 contract (`topic` required; `maxResults`/`fixture` optional). */
interface InInput {
    topic: string;
    maxResults: number;
    fixture: boolean;
}

/** Canned web-search results — the v1 fixture stub. Stable sourceUris → stable Doc ids. */
interface FixtureEntry {
    sourceUri: string;
    title: string;
    body: string;
    position: number;
}

const FIXTURE_ENTRIES: FixtureEntry[] = [
    {
        sourceUri: 'https://example.org/research/storm-overview',
        title: 'STORM: Topic Research via Composed Plugins — Overview',
        body: '# STORM Overview\n\nSTORM chains ingestion and generation plugins over a single research topic.\n\n- **Ingest**: a web-search plugin materializes a `topic` into `Doc[]`\n- **Generate**: a generator plugin (content-gen) turns the `Doc[]` into grounded Content\n\nThis is fixture content emitted by the `web-search` v1 stub; no live Firecrawl call is made.',
        position: 1,
    },
    {
        sourceUri: 'https://example.org/research/storm-contract',
        title: 'The web-search Ingest Contract (0054)',
        body: '# Ingest Contract\n\nThe web-search `--in` JSON carries `topic` (required, non-empty string), `maxResults` (optional positive integer, default 8), and `fixture` (optional boolean, reserved for the stub).\n\nDoc `id` is the sha256 hex prefix (16 chars) of the canonical `sourceUri`, keeping ids deterministic across re-runs.',
        position: 2,
    },
    {
        sourceUri: 'https://example.org/research/storm-dry-run',
        title: 'Dry-Running kk-storm-research',
        body: '# Dry-Run\n\nThe `kk-storm-research` state machine materializes the topic `--vars` into the ingest `--in` JSON, runs `web-search`, then `content-gen`, and terminates at the Content-written `done` state — no publish.',
        position: 3,
    },
];

/** Deterministic Doc id: sha256(sourceUri) hex prefix, same idea as karakeep-local (0054 Block 4). */
function computeId(uri: string): string {
    return createHash('sha256').update(uri).digest('hex').slice(0, 16);
}

/**
 * Build the fixture `Doc[]` for a topic (0054 Block 4 mapping). Always emits
 * canned docs — the v1 plugin has no live Firecrawl path.
 */
export function buildFixtureDocs(topic: string, maxResults: number): Doc[] {
    // maxResults caps the list per 0054 (cap semantics); `maxResults: 1` deliberately yields a
    // single Doc. The Design's "always ≥2 items" wording applies to the default path (maxResults ≥ 2 → 3 canned entries).
    const entries = FIXTURE_ENTRIES.slice(0, Math.max(0, Math.min(FIXTURE_ENTRIES.length, maxResults)));
    return entries.map((entry, rank) => ({
        id: computeId(entry.sourceUri),
        body: entry.body,
        title: entry.title,
        sourceUri: entry.sourceUri,
        mediaType: 'text/markdown',
        metadata: {
            query: topic,
            rank,
            position: entry.position,
            // Per-run timestamp by design (0054 Block 4): determinism is required only for `id`.
            scraped_at: new Date().toISOString(),
        },
    }));
}

/** Parse and validate the `--in` JSON; missing/invalid topic → throws (fail-loud row 1). */
export function parseInput(raw: string): InInput {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error('--in is not valid JSON');
    }
    if (typeof data !== 'object' || data === null) {
        throw new Error('--in must be a JSON object');
    }
    const input = data as Record<string, unknown>;
    if (typeof input.topic !== 'string' || input.topic.trim() === '') {
        throw new Error('--in "topic" is required and must be a non-empty string');
    }
    let maxResults = 8;
    if (input.maxResults !== undefined) {
        if (typeof input.maxResults !== 'number' || !Number.isInteger(input.maxResults) || input.maxResults <= 0) {
            throw new Error('--in "maxResults" must be a positive integer when present');
        }
        maxResults = input.maxResults;
    }
    return { topic: input.topic, maxResults, fixture: input.fixture === true };
}

export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        console.error('Error: Missing required arguments --in and --out');
        return 1;
    }

    let input: InInput;
    try {
        input = parseInput(await readFile(values.in, 'utf-8'));
    } catch (err: unknown) {
        console.error(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    if (!input.fixture) {
        // 0054 Block 1/Block 8: `fixture` absent or false selects the LIVE Firecrawl path; v1 has no
        // live client. Fail loud (Block 5 row-2 semantics: exit 1, no --out) instead of silently
        // fabricating research docs — an obvious failure beats a surprising recovery.
        console.error(
            'web-search failed: live Firecrawl not implemented in v1 (pass "fixture": true to use the fixture stub)',
        );
        return 1;
    }

    try {
        const docs = DocListSchema.parse(buildFixtureDocs(input.topic, input.maxResults));
        const outDir = dirname(values.out);
        if (outDir && outDir !== '.') {
            await mkdir(outDir, { recursive: true });
        }
        await writeFile(values.out, JSON.stringify(docs, null, 2), 'utf-8');
        return 0;
    } catch (err: unknown) {
        console.error(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
