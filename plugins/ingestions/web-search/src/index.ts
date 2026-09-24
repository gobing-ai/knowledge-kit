import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { getLogger, initializeLogger } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

const log = getLogger('kk.ingestion.web-search');

/** Per-request timeout (ms) for the Firecrawl call — Bun's `fetch` has no default deadline (R5). */
const REQUEST_TIMEOUT_MS = 120_000;

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

/** markitdown normalizer — HTML in, markdown out (ADR-013 D3). Throws on non-zero exit or
 * empty output; callers treat a throw as unusable content (per-URL fallback, D5). */
export type MarkitdownRunner = (html: string) => Promise<string>;

/** Live-path dependencies — fetch, env, clock, scrape, and markitdown are all injectable for tests. */
export interface SearchDeps {
    fetch: FetchLike;
    env: Record<string, string | undefined>;
    now: () => Date;
    /** Scrape transport; defaults to `deps.fetch` so tests can route both Firecrawl calls separately. */
    scrape?: FetchLike;
    /** markitdown runner; when absent in live mode, `main` probes PATH and fails loud (R6). */
    markitdown?: MarkitdownRunner;
}

/** Real markitdown runner: `markitdown -x .html`, HTML on stdin, markdown on stdout. The
 * `-x .html` extension hint is required — bare stdin passes HTML through unconverted.
 * Spawns the absolute path resolved via Bun.which (with an explicit PATH option — plain
 * argv[0] lookup can resolve against a startup PATH snapshot, missing runtime edits). */
export const realMarkitdown: MarkitdownRunner = async (html: string): Promise<string> => {
    const bin = Bun.which('markitdown', { PATH: process.env.PATH });
    if (!bin) {
        throw new Error('markitdown is not on PATH');
    }
    const proc = Bun.spawn([bin, '-x', '.html'], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    proc.stdin.write(html);
    await proc.stdin.end();
    const [stdout, stderrText, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) {
        const detail = stderrText.trim();
        throw new Error(`markitdown exited ${exitCode}${detail ? `: ${detail}` : ''}`);
    }
    const markdown = stdout.trim();
    if (markdown.length === 0) {
        throw new Error('markitdown produced empty output');
    }
    return markdown;
};

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

/** One Firecrawl `/v2/scrape` body — the subset the cache pass consumes. */
interface FirecrawlScrapeResponse {
    success?: unknown;
    data?: { html?: unknown; markdown?: unknown } | null;
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
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
            log.warn(`web-search: skipping result without usable markdown (url=${url ?? 'missing'})`);
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

/** Scrape + normalize + cache pass over the search results (ADR-013 D1–D6). Sequential
 * per Doc — deliberate, no parallel fan-out (rate-limit friendly, deterministic). Cache hit
 * (`references/<doc-id>.md` exists) reuses the file with no new /v2/scrape call (R3/R4);
 * otherwise scrape → normalize (html via markitdown, markdown as-is) → write cache → body
 * swap. Per-URL failure or unusable content warns and keeps the snippet body (R5/R11) — never
 * fatal. Returns a new Doc[]; input order and non-body fields are untouched. */
export async function scrapeAndCacheDocs(docs: Doc[], deps: SearchDeps, outPath: string): Promise<Doc[]> {
    const fs = createNodeFileSystem();
    const cacheDir = join(dirname(outPath), 'references');
    const scrapeFetch = deps.scrape ?? deps.fetch;
    const out: Doc[] = [];
    for (const doc of docs) {
        const uri = doc.sourceUri;
        if (!uri) {
            out.push(doc);
            continue;
        }
        const cacheFile = join(cacheDir, `${doc.id}.md`);
        try {
            const cached = await fs.readFile(cacheFile);
            if (cached.trim().length > 0) {
                out.push({ ...doc, body: cached });
                continue;
            }
        } catch {
            // Cache miss — fall through to the live scrape.
        }
        try {
            const key = deps.env.FIRECRAWL_API_KEY;
            if (!key) throw new Error('FIRECRAWL_API_KEY is unset');
            const res = await scrapeFetch('https://api.firecrawl.dev/v2/scrape', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`,
                },
                body: JSON.stringify({ url: uri, formats: ['html', 'markdown'] }),
            });
            if (!res.ok || res.status !== 200) {
                throw new Error(`Firecrawl HTTP ${res.status}`);
            }
            const parsed = JSON.parse(await res.text()) as FirecrawlScrapeResponse;
            if (parsed.success !== true || parsed.data === null || parsed.data === undefined) {
                throw new Error('Firecrawl malformed scrape response');
            }
            const html = typeof parsed.data.html === 'string' ? parsed.data.html : undefined;
            const markdown = typeof parsed.data.markdown === 'string' ? parsed.data.markdown : undefined;
            let normalized: string;
            if (html && html.trim().length > 0) {
                normalized = await (deps.markitdown ?? realMarkitdown)(html);
            } else if (markdown && markdown.trim().length > 0) {
                normalized = markdown.trim();
            } else {
                throw new Error('scrape returned no usable content');
            }
            await fs.ensureDir(cacheDir);
            await fs.writeFile(cacheFile, normalized);
            out.push({ ...doc, body: normalized });
        } catch (err: unknown) {
            log.warn(`web-search: scrape failed (url=${uri}): ${err instanceof Error ? err.message : String(err)}`);
            out.push(doc);
        }
    }
    return out;
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

export async function main(depsOverride?: Partial<SearchDeps>): Promise<number> {
    const fs = createNodeFileSystem();
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('Error: Missing required arguments --in and --out');
        return 1;
    }

    let input: InInput;
    try {
        input = parseInput(await fs.readFile(values.in));
    } catch (err: unknown) {
        echoError(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    if (!input.fixture) {
        // 0054 Block 1/Block 8: `fixture` absent/false = LIVE Firecrawl path.
        try {
            const deps: SearchDeps = {
                fetch: globalThis.fetch,
                env: process.env,
                now: () => new Date(),
                ...depsOverride,
            };
            // Bun.which with an explicit PATH — without the option it can ignore runtime
            // process.env.PATH changes (observed on Bun 1.3.14).
            if (!deps.markitdown && !Bun.which('markitdown', { PATH: deps.env.PATH })) {
                // R6 — live mode requires the normalizer; fail before any network call.
                throw new Error('markitdown is not on PATH');
            }
            const docs = await searchFirecrawl(input, deps);
            const cached = await scrapeAndCacheDocs(docs, deps, values.out);
            const outDir = dirname(values.out);
            if (outDir && outDir !== '.') {
                await fs.ensureDir(outDir);
            }
            await fs.writeFile(values.out, JSON.stringify(DocListSchema.parse(cached), null, 2));
            return 0;
        } catch (err: unknown) {
            echoError(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }
    }

    try {
        const docs = DocListSchema.parse(buildFixtureDocs(input.topic, input.maxResults));
        const outDir = dirname(values.out);
        if (outDir && outDir !== '.') {
            await fs.ensureDir(outDir);
        }
        await fs.writeFile(values.out, JSON.stringify(docs, null, 2));
        return 0;
    } catch (err: unknown) {
        echoError(`web-search failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    await initializeLogger({ console: process.env.NODE_ENV !== 'test', json: true, level: 'warn' });
    process.exit(await main());
}
