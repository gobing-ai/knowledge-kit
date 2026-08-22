import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocListSchema } from '@gobing-ai/kk-core';
import {
    type AihotChangesResponse,
    AihotClient,
    type AihotItem,
    type AihotSnapshotResponse,
    computeDocId,
    DEFAULT_AIHOT_USER_AGENT,
    main,
    mapAihotItemsToDocs,
    mapAihotItemToDoc,
    processIngestionIO,
} from '../src/index';

const SAMPLE_ITEM_1: AihotItem = {
    id: 'item-1',
    title: 'OpenAI announces Sora 2',
    originalTitle: null,
    source: { name: 'OpenAI Blog' },
    publishedAt: '2026-08-20T10:00:00.000Z',
    discoveredAt: '2026-08-20T10:05:00.000Z',
    category: 'Video Gen',
    score: 95,
    summary: 'OpenAI has released Sora 2 with real-time cameos and enhanced fidelity.',
    selected: true,
    links: {
        aihot: 'https://aihot.virxact.com/items/item-1',
        original: 'https://openai.com/blog/sora-2',
    },
    attribution: {
        name: 'Aihot',
        url: 'https://aihot.virxact.com',
    },
};

const SAMPLE_ITEM_2: AihotItem = {
    id: 'item-2',
    title: 'Claude 3.7 Sonnet hybrid reasoning',
    originalTitle: null,
    source: { name: 'Anthropic News' },
    publishedAt: '2026-08-21T08:00:00.000Z',
    discoveredAt: '2026-08-21T08:05:00.000Z',
    category: null,
    score: null,
    selected: true,
    summary: 'Anthropic introduced hybrid reasoning in Claude 3.7 Sonnet.',
    links: {
        aihot: 'https://aihot.virxact.com/items/item-2',
        original: 'https://anthropic.com/news/claude-3-7',
    },
};

function snapshot(items: AihotItem[], cursor = 'snapshot-cursor'): AihotSnapshotResponse {
    return {
        schemaVersion: 1,
        asOf: '2026-08-21T12:00:00.000Z',
        fields: 'default',
        cursor,
        count: items.length,
        hasMore: false,
        nextPage: null,
        items,
    };
}

function changes(items: AihotItem[], cursor = 'changes-cursor'): AihotChangesResponse {
    return {
        schemaVersion: 1,
        fields: 'default',
        cursor,
        count: items.length,
        hasMore: false,
        changes: items.map((item) => ({ op: 'upsert', item, changedAt: '2026-08-21T12:00:00.000Z' })),
    };
}

describe('aihot-ingest plugin (0072)', () => {
    let testDir: string;
    let outPath: string;
    let statePath: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `kk-aihot-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(testDir, { recursive: true });
        outPath = join(testDir, 'docs.json');
        statePath = join(testDir, 'state.json');
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('R1 & R4 — maps Aihot items to standard Doc[] objects', () => {
        const doc1 = mapAihotItemToDoc(SAMPLE_ITEM_1);
        expect(doc1.id).toBe('item-1');
        expect(doc1.title).toBe('OpenAI announces Sora 2');
        expect(doc1.sourceUri).toBe('https://openai.com/blog/sora-2');
        expect(doc1.body).toBe('OpenAI has released Sora 2 with real-time cameos and enhanced fidelity.\n');
        expect(doc1.metadata?.sourceName).toBe('OpenAI Blog');
        expect(doc1.metadata?.category).toBe('Video Gen');

        const doc2 = mapAihotItemToDoc(SAMPLE_ITEM_2);
        expect(doc2.id).toBe('item-2');
        expect(doc2.sourceUri).toBe('https://anthropic.com/news/claude-3-7');
        expect(doc2.metadata?.category).toBeUndefined();

        const doc3 = mapAihotItemToDoc({
            ...SAMPLE_ITEM_1,
            id: '',
            title: '',
            summary: null,
        });
        expect(doc3.id).toBe(computeDocId(SAMPLE_ITEM_1.links.original));
        expect(doc3.title).toBe('Untitled AI News');

        const docs = mapAihotItemsToDocs([SAMPLE_ITEM_1, SAMPLE_ITEM_2]);
        expect(DocListSchema.safeParse(docs).success).toBe(true);
    });

    it('fails loud when state-file is corrupted rather than resetting the cursor', async () => {
        await Bun.write(statePath, 'not-valid-json');
        let fetched = false;
        const fakeFetch = async () => {
            fetched = true;
            return new Response('{}');
        };
        await expect(processIngestionIO({ out: outPath, stateFile: statePath }, { fetch: fakeFetch })).rejects.toThrow(
            /Failed to parse JSON file/,
        );
        expect(fetched).toBe(false);
        expect(existsSync(outPath)).toBe(false);
    });

    it('R1 — skips malformed snapshot items and change records with diagnostics', async () => {
        const invalidItem = { ...SAMPLE_ITEM_1, id: 42 };
        const snapshotPayload = {
            ...snapshot([SAMPLE_ITEM_1]),
            count: 2,
            items: [SAMPLE_ITEM_1, invalidItem],
        };
        const validChanges = changes([SAMPLE_ITEM_2]);
        const changesPayload = {
            ...validChanges,
            count: 2,
            changes: [
                ...validChanges.changes,
                { op: 'upsert', item: invalidItem, changedAt: '2026-08-21T12:00:00.000Z' },
            ],
        };
        const payloads = [snapshotPayload, changesPayload];
        const warnings: string[] = [];
        const client = new AihotClient({
            fetch: async () => new Response(JSON.stringify(payloads.shift())),
            warn: (message) => warnings.push(message),
        });

        expect((await client.fetchSnapshot()).items).toEqual([SAMPLE_ITEM_1]);
        expect((await client.fetchChanges({ cursor: 'cursor' })).changes).toEqual(validChanges.changes);
        expect(warnings).toEqual([
            expect.stringContaining('snapshot item at index 1'),
            expect.stringContaining('change record at index 1'),
        ]);
    });

    it('R2 — fetches snapshot when no cursor is provided', async () => {
        const mockSnapshot = snapshot([SAMPLE_ITEM_1, SAMPLE_ITEM_2], 'cursor-v1-abc');

        let requestedUrl = '';
        let requestedUserAgent = '';
        const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
            requestedUrl = String(url);
            requestedUserAgent = (init?.headers as Record<string, string>)?.['User-Agent'] ?? '';
            return new Response(JSON.stringify(mockSnapshot), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        const result = await processIngestionIO({ out: outPath, limit: 10 }, { fetch: fakeFetch });

        expect(requestedUrl).toContain('/api/v1/selected/snapshot?limit=10&fields=default');
        expect(requestedUserAgent).toBe(DEFAULT_AIHOT_USER_AGENT);
        expect(result.docs.length).toBe(2);
        expect(result.cursor).toBe('cursor-v1-abc');
        expect(existsSync(outPath)).toBe(true);

        const writtenDocs = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(writtenDocs.length).toBe(2);
        expect(writtenDocs[0].title).toBe('OpenAI announces Sora 2');
    });

    it('R2 — fetches incremental changes when cursor is provided', async () => {
        const mockChanges = changes([SAMPLE_ITEM_2], 'cursor-v2-new');
        mockChanges.changes.push({ op: 'remove', id: 'deleted-item', changedAt: '2026-08-21T12:00:00.000Z' });
        mockChanges.count = 2;

        let requestedUrl = '';
        const fakeFetch = async (url: string | URL | Request) => {
            requestedUrl = String(url);
            return new Response(JSON.stringify(mockChanges), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };

        const result = await processIngestionIO(
            { out: outPath, cursor: 'cursor-v1-abc', limit: 5 },
            { fetch: fakeFetch },
        );

        expect(requestedUrl).toContain('/api/v1/selected/changes?cursor=cursor-v1-abc&limit=5');
        expect(result.docs.length).toBe(1);
        expect(result.cursor).toBe('cursor-v2-new');
    });

    it('R2 & R3 — loads cursor from state-file and updates it on completion', async () => {
        const initialState = { cursor: 'stored-cursor-999' };
        await Bun.write(statePath, JSON.stringify(initialState));

        const mockChanges = changes([SAMPLE_ITEM_1], 'new-cursor-1000');

        let requestedUrl = '';
        const fakeFetch = async (url: string | URL | Request) => {
            requestedUrl = String(url);
            return new Response(JSON.stringify(mockChanges), { status: 200 });
        };

        const result = await processIngestionIO({ out: outPath, stateFile: statePath }, { fetch: fakeFetch });

        expect(requestedUrl).toContain('cursor=stored-cursor-999');
        expect(result.cursor).toBe('new-cursor-1000');

        const savedState = JSON.parse(readFileSync(statePath, 'utf-8'));
        expect(savedState.cursor).toBe('new-cursor-1000');
        expect(savedState.itemCount).toBe(1);
    });

    it('R6 — handles empty items list gracefully', async () => {
        const emptySnapshot = snapshot([], 'cursor-empty');

        const fakeFetch = async () => new Response(JSON.stringify(emptySnapshot), { status: 200 });
        const result = await processIngestionIO({ out: outPath }, { fetch: fakeFetch });

        expect(result.docs.length).toBe(0);
        const writtenDocs = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(writtenDocs).toEqual([]);
    });

    it('fails loud when API returns non-200 error', async () => {
        const fakeFetch = async () =>
            new Response('Rate limit exceeded', {
                status: 429,
                statusText: 'Too Many Requests',
            });

        const client = new AihotClient({ fetch: fakeFetch });
        await expect(client.fetchSnapshot()).rejects.toThrow(/aihot snapshot request failed \(HTTP 429/);
        await expect(client.fetchChanges({ cursor: 'test' })).rejects.toThrow(
            /aihot changes request failed \(HTTP 429/,
        );
    });

    it('CLI main() verifies arguments and error handling', async () => {
        const fakeFetch = async () => new Response(JSON.stringify(snapshot([SAMPLE_ITEM_1], 'c1')), { status: 200 });

        // Missing --out
        const origArgv = process.argv;
        try {
            process.argv = ['bun', 'index.ts'];
            const exit1 = await main({ fetch: fakeFetch });
            expect(exit1).toBe(1);

            // Invalid --limit
            process.argv = ['bun', 'index.ts', '--out', outPath, '--limit', '-5'];
            const exit2 = await main({ fetch: fakeFetch });
            expect(exit2).toBe(1);

            process.argv = ['bun', 'index.ts', '--out', outPath, '--limit', '2x'];
            expect(await main({ fetch: fakeFetch })).toBe(1);

            // Executor-compatible input config, with the documented default limit.
            const inPath = join(testDir, 'source.json');
            await Bun.write(inPath, '{}');
            let requestedUrl = '';
            const recordingFetch = async (url: string | URL | Request) => {
                requestedUrl = String(url);
                return fakeFetch();
            };
            process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
            const exit3 = await main({ fetch: recordingFetch });
            expect(exit3).toBe(0);
            expect(existsSync(outPath)).toBe(true);
            expect(requestedUrl).toContain('limit=10');
        } finally {
            process.argv = origArgv;
        }
    });
});
