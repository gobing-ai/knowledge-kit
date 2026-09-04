import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { docsToContent, main, processGeneratorIO, renderCoreFacts } from '../src/index';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const OUT_FILE = join(FIXTURES_DIR, 'content.json');

const DOCS: Doc[] = [
    {
        id: 'aihot:one',
        title: 'Alpha ships',
        body: 'Alpha body text.',
        sourceUri: 'https://example.com/alpha',
        mediaType: 'text/markdown',
        metadata: {
            source: 'aihot',
            published_at: '2026-09-02',
            sources: [{ file: '1-ingest/docs.json', sourceUri: 'https://example.com/alpha' }],
        },
    },
    {
        id: 'shared:meta-llama-release-1',
        title: 'Meta releases Llama 4.1',
        body: 'Shared body.',
        sourceUri: 'https://example.com/llama',
        metadata: {
            score: 8,
            sources: [
                { file: '1-ingest/docs.json', sourceUri: 'https://example.com/llama-a' },
                { file: '1-ingest/horizon.json', sourceUri: 'https://example.com/llama-h' },
            ],
        },
    },
    {
        id: 'last30days:r-abc',
        title: 'Claude momentum',
        body: 'last30days body.',
        sourceUri: 'https://reddit.example/abc',
        metadata: {
            source: 'reddit',
            relevance_score: 0.87,
            sources: [{ file: '1-ingest/last30days.json' }],
        },
    },
];

afterEach(async () => {
    await rm(FIXTURES_DIR, { recursive: true, force: true });
});

describe('renderCoreFacts', () => {
    test('emits the template shape: frontmatter roster + doc_count, blank-line-separated headlines', () => {
        const md = renderCoreFacts(DOCS, '2026-09-03');
        expect(md).toContain('date: 2026-09-03');
        expect(md).toContain('dedup_rule: id');
        expect(md).toContain('doc_count: 3');
        expect(md).toContain('- docs.json (1-ingest/docs.json)');
        expect(md).toContain('- horizon.json (1-ingest/horizon.json)');
        expect(md).toContain('- last30days.json (1-ingest/last30days.json)');
        expect(md).toContain('### Alpha ships');
        expect(md).toContain('**Source:** aihot');
        expect(md).toContain('**Score:** 8'); // metadata.score wins
        expect(md).toContain('**Score:** 0.87'); // relevance_score fallback
        expect(md).toContain('## Headlines\n\n### Alpha ships'); // blank line after section
        expect(md).toContain('Alpha body text.\n\n### Meta releases Llama 4.1'); // blank line between blocks
    });

    test('label falls back to the provenance file basename when metadata.source is absent', () => {
        const shared = DOCS[1];
        if (!shared) throw new Error('fixture missing');
        const md = renderCoreFacts([shared], '2026-09-03');
        expect(md).toContain('**Source:** docs.json');
    });

    test('empty Doc[] renders a zero-count digest', () => {
        const md = renderCoreFacts([], '2026-09-03');
        expect(md).toContain('doc_count: 0');
        expect(md).toContain('## Headlines');
    });
});

describe('docsToContent', () => {
    test('maps to Content with title, markdown body, references from sourceUri, provenance metadata', () => {
        const content = docsToContent(DOCS, '2026-09-03');
        expect(content.title).toBe('Core Facts — 2026-09-03');
        expect(content.format).toBe('markdown');
        expect(content.references).toHaveLength(3);
        expect(content.references?.[2]?.cite).toBe('last30days:r-abc');
        expect(content.metadata?.generator).toBe('kk:core-facts');
        expect(content.metadata?.doc_count).toBe(3);
    });
});

describe('processGeneratorIO', () => {
    test('reads --in Doc[] and writes validated Content JSON to --out', async () => {
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(join(FIXTURES_DIR, 'docs.json'), JSON.stringify(DOCS));
        process.env.CORE_FACTS_DATE = '2026-09-03';
        try {
            const content = await processGeneratorIO(join(FIXTURES_DIR, 'docs.json'), OUT_FILE);
            expect(content.metadata?.date).toBe('2026-09-03');
            const written = JSON.parse(await Bun.file(OUT_FILE).text());
            expect(written.title).toBe('Core Facts — 2026-09-03');
        } finally {
            delete process.env.CORE_FACTS_DATE;
        }
    });
});

describe('branch coverage', () => {
    test('sources entries without a string file are skipped in the roster', () => {
        const docs: Doc[] = [
            { id: 'x:1', body: 'b', metadata: { sources: [{ nofile: true }, null, { file: 'f.json' }] } },
        ];
        const md = renderCoreFacts(docs, '2026-09-03');
        expect(md).toContain('- f.json (f.json)');
        expect(md).not.toContain('nofile');
    });
});

describe('main', () => {
    test('returns 1 when --in/--out are missing', async () => {
        const original = process.argv;
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
        } finally {
            process.argv = original;
        }
    });

    test('returns 0 on success and 1 on unreadable input', async () => {
        const original = process.argv;
        await mkdir(FIXTURES_DIR, { recursive: true });
        await writeFile(join(FIXTURES_DIR, 'docs.json'), JSON.stringify(DOCS));
        try {
            process.argv = ['bun', 'index.ts', '--in', join(FIXTURES_DIR, 'docs.json'), '--out', OUT_FILE];
            expect(await main()).toBe(0);
            process.argv = ['bun', 'index.ts', '--in', join(FIXTURES_DIR, 'missing.json'), '--out', OUT_FILE];
            expect(await main()).toBe(1);
        } finally {
            process.argv = original;
        }
    });
});
