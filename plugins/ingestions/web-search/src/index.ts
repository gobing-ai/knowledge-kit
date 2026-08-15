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

/** Deterministic Doc id: sha256(sourceUri) hex prefix, same idea as karakeep-local (0054 Block 4).
 * Exported so 0059's local-Doc mapping can stay consistent if a later helper imports it (R3). */
export function computeId(uri: string): string {
    return createHash('sha256').update(uri).digest('hex').slice(0, 16);
}

/** Fetch signature the live path accepts, so tests can inject a fake (CI never hits the network). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Live-path dependencies — fetch, env, and clock are all injectable for tests. */
export interface SearchDeps {
    fetch: FetchLike;
    env: Record<string, string | undefined>;
    now: () => Date;
}

/** One Firecrawl `data.web[]` item — the subset of fields 0054 Block 3/4 consume. */
interface FirecrawlWebItem {
    url?: unknown;
    title?: unknown;
    markdown?: unknown;
    position?: unknown;
}

interface FirecrawlSearchResponse {
    success?: unknown;
    error?: unknown;
    data?: { web?: FirecrawlWebItem[] | null } | null;
}

/**
 * Live Firecrawl search → Doc[] (0054 Blocks 2–5). Throws an Error whose message is the
 * fail-loud diagnostic; `main` prefixes it with `web-search failed: ` and returns 1.
 * Never writes `--out` on a thrown path (no DocListSchema.parse, no file write here).
 */
export async function searchFirecrawl(input: InInput, deps: SearchDeps): Promise<Doc[]> {
    const key = deps.env.FIRECRAWL_API_KEY;
    if (!key) {
        // 0054 Block 5 row 2 — key required by this plugin's contract, not by Firecrawl.
        throw new Error('FIRECRAWL_API_KEY is unset');
    }

    let res: Response;
    try {
        res = await deps.fetch('https://api.firecrawl.dev/v2/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                query: input.topic,
                limit: input.maxResults,
                sources: ['web'],
                scrapeOptions: { formats: ['markdown'] },
            }),
        });
    } catch (err: unknown) {
        // 0054 Block 5 row 3 — transport error (DNS, refused, TLS, fetch throws).
        throw new Error(`Firecrawl network error: ${err instanceof Error ? err.message : String(err)}`);
    }

    let bodyText: string;
    try {
        bodyText = await res.text();
    } catch {
        throw new Error(`Firecrawl HTTP ${res.status}: empty response body`);
    }

    if (!res.ok || res.status !== 200) {
        // 0054 Block 5 rows 4–5 — 401/402/400/404/408/429/5xx. No silent retry in v1.
        throw new Error(`Firecrawl HTTP ${res.status}: ${extractError(bodyText)}`);
    }

    let parsed: FirecrawlSearchResponse;
    try {
        parsed = JSON.parse(bodyText) as FirecrawlSearchResponse;
    } catch {
        // 200 but not JSON → malformed response (row 5).
        throw new Error('Firecrawl malformed response: invalid JSON');
    }

    if (parsed.success === false) {
        // 0054 Block 5 row 5 — `success:false` in a 200 body.
        throw new Error(`Firecrawl HTTP 200: ${extractError(bodyText)}`);
    }

    if (parsed.success !== true) {
        throw new Error('Firecrawl malformed response: success missing');
    }

    // Row 5 (P4): a 200 `success:true` with `data` absent/null is malformed, not zero hits.
    if (parsed.data === null || parsed.data === undefined) {
        throw new Error('Firecrawl malformed response: data missing');
    }

    const web = parsed.data.web ?? [];

    // Row 6 — true zero hits: write `[]`, exit 0.
    if (web.length === 0) {
        return [];
    }

    const docs: Doc[] = [];
    let skipped = 0;
    for (const [rank, item] of web.entries()) {
        const url = typeof item.url === 'string' ? item.url : undefined;
        const markdown = typeof item.markdown === 'string' ? item.markdown : undefined;
        const body = markdown?.trim() ?? '';
        if (!url || body.length === 0) {
            // Row 7 — partial item failure: skip + stderr warn, continue.
            skipped += 1;
            console.warn(`web-search: skipping result without usable markdown (url=${url ?? 'missing'})`);
            continue;
        }
        docs.push({
            id: computeId(url),
            body,
            title: typeof item.title === 'string' ? item.title : undefined,
            sourceUri: url,
            mediaType: 'text/markdown',
            metadata: {
                query: input.topic,
                rank,
                position: typeof item.position === 'number' ? item.position : undefined,
                scraped_at: deps.now().toISOString(),
            },
        });
    }

    // Row 8 — hits > 0 but every item skipped: deliberate departure from C1 (0054 Block 6b).
    if (docs.length === 0 && skipped > 0) {
        throw new Error('Firecrawl returned hits but no usable markdown bodies');
    }

    return docs;
}

/** Best-effort `error` message from a Firecrawl error body; empty when unavailable. */
function extractError(bodyText: string): string {
    try {
        const parsed = JSON.parse(bodyText) as { error?: unknown };
        const error = parsed.error;
        if (typeof error === 'string' && error.length > 0) {
            return error;
        }
        if (error !== undefined && error !== null) {
            return JSON.stringify(error);
        }
    } catch {
        // Non-JSON error body — fall through to empty.
    }
    return '';
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
        // 0054 Block 1/Block 8: `fixture` absent/false = LIVE Firecrawl path.
        try {
            const docs = await searchFirecrawl(input, {
                fetch: globalThis.fetch,
                env: process.env,
                now: () => new Date(),
            });
            const outDir = dirname(values.out);
            if (outDir && outDir !== '.') {
                await mkdir(outDir, { recursive: true });
            }
            await writeFile(values.out, JSON.stringify(DocListSchema.parse(docs), null, 2), 'utf-8');
            return 0;
        } catch (err: unknown) {
            console.error(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
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
