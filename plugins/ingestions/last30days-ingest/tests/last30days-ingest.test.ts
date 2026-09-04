import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { main, mapResultsToDocs, processIngestionIO } from '../src/index';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const OUT_FILE = join(FIXTURES_DIR, 'docs.json');

const AGENT_JSON = {
    schema_version: '1.2',
    query: 'AI news',
    window_days: 30,
    source_status: { reddit: 'ok', x: 'skipped-unconfigured' },
    results: [
        {
            candidate_id: 'r-abc',
            title: 'Claude Code momentum',
            source: 'reddit',
            url: 'https://reddit.example/abc',
            summary: 'Sustained discussion of agentic coding.',
            relevance_score: 0.87,
            cluster: 0,
        },
        {
            candidate_id: 'x-def',
            title: 'Benchmark debate',
            source: 'x',
            url: 'https://x.example/def',
            summary: 'Benchmark methodology under debate.',
            relevance_score: 0.72,
            cluster: 1,
        },
    ],
};

function fakeRunner(agentJson: unknown, exitCode = 0, stderr = '') {
    return async (_config: unknown, outputPath: string) => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(outputPath, JSON.stringify(agentJson));
        return { exitCode, outputPath, stderr };
    };
}

afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true });
});

describe('mapResultsToDocs', () => {
    test('maps results[] to Doc[] with deterministic last30days: ids and full metadata', () => {
        const docs = mapResultsToDocs(AGENT_JSON, 'AI news');
        expect(docs).toHaveLength(2);
        expect(docs[0]?.id).toBe('last30days:r-abc');
        expect(docs[0]?.title).toBe('Claude Code momentum');
        expect(docs[0]?.body).toBe('Sustained discussion of agentic coding.');
        expect(docs[0]?.sourceUri).toBe('https://reddit.example/abc');
        expect(docs[0]?.mediaType).toBe('text/markdown');
        expect(docs[0]?.metadata?.relevance_score).toBe(0.87);
        expect(docs[0]?.metadata?.topic).toBe('AI news');
        expect(docs[0]?.metadata?.schema_version).toBe('1.2');
    });

    test('URL-shaped candidate_id (degraded keyless mode) is hashed to a short stable id', () => {
        // Dogfood run ff10095b: 90-char URL ids broke STORM citation (53 unknown IDs).
        const docs = mapResultsToDocs(
            {
                results: [
                    {
                        candidate_id: 'https://techcrunch.com/2026/09/02/some-long-article-slug',
                        summary: 's',
                        title: 't',
                        url: 'https://techcrunch.com/2026/09/02/some-long-article-slug',
                    },
                ],
            },
            't',
        );
        expect(docs[0]?.id).toMatch(/^last30days:[0-9a-f]{16}$/);
    });

    test('falls back to sha256(url) when candidate_id is missing', () => {
        const docs = mapResultsToDocs({ results: [{ url: 'https://x.example/1', summary: 's', title: 't' }] }, 't');
        expect(docs[0]?.id).toMatch(/^last30days:[0-9a-f]{16}$/);
    });

    test('empty results produce an empty Doc[] (not an error)', () => {
        expect(mapResultsToDocs({ results: [] }, 't')).toEqual([]);
    });
});

describe('processIngestionIO', () => {
    test('runs the tool, maps the captured agent JSON, and writes Doc[] to --out', async () => {
        const { docs } = await processIngestionIO({ out: OUT_FILE }, { topic: 'AI news' }, fakeRunner(AGENT_JSON));
        expect(docs).toHaveLength(2);
        const written = JSON.parse(await Bun.file(OUT_FILE).text());
        expect(written).toHaveLength(2);
        expect(written[1].id).toBe('last30days:x-def');
    });

    test('fails loud when the tool exits non-zero', async () => {
        await expect(
            processIngestionIO({ out: OUT_FILE }, { topic: 'AI news' }, fakeRunner({}, 1, 'boom')),
        ).rejects.toThrow('last30days exited 1: boom');
    });
});

describe('defaultRunner (fake python3 via LAST30DAYS_PYTHON)', () => {
    test('spawns the tool, captures --output, maps Doc[]', async () => {
        const binDir = join(FIXTURES_DIR, 'bin');
        await mkdir(binDir, { recursive: true });
        const fakePython = join(binDir, 'python3');
        await writeFile(
            fakePython,
            `#!/usr/bin/env bun
const out = process.argv[process.argv.indexOf('--output') + 1];
await Bun.write(out, JSON.stringify({ schema_version: '1.2', results: [{ candidate_id: 'x1', title: 'T', summary: 'S', url: 'https://x.example/1' }] }));
`,
        );
        await chmod(fakePython, 0o755);
        process.env.LAST30DAYS_PYTHON = fakePython;
        process.env.LAST30DAYS_SKILL_DIR = FIXTURES_DIR;
        try {
            const { docs } = await processIngestionIO({ out: OUT_FILE }, { topic: 'AI news' });
            expect(docs).toHaveLength(1);
            expect(docs[0]?.id).toBe('last30days:x1');
        } finally {
            delete process.env.LAST30DAYS_PYTHON;
            delete process.env.LAST30DAYS_SKILL_DIR;
        }
    });
});

describe('main', () => {
    test('returns 1 when --in/--out are missing', async () => {
        const original = process.argv;
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main(fakeRunner(AGENT_JSON))).toBe(1);
        } finally {
            process.argv = original;
        }
    });

    test('returns 0 on success and 1 when the tool fails', async () => {
        const original = process.argv;
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(join(FIXTURES_DIR, 'cfg.json'), JSON.stringify({ topic: 'AI news' }));
        try {
            process.argv = ['bun', 'index.ts', '--in', join(FIXTURES_DIR, 'cfg.json'), '--out', OUT_FILE];
            expect(await main(fakeRunner(AGENT_JSON))).toBe(0);
            expect(await main(fakeRunner({}, 1, 'boom'))).toBe(1);
        } finally {
            process.argv = original;
        }
    });
});
