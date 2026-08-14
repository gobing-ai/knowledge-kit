import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocListSchema } from '@gobing-ai/kk-core';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { buildFixtureDocs, main, parseInput } from '../src/index';

const TMP_DIR = join(import.meta.dir, 'tmp');
const IN_FILE = join(TMP_DIR, 'in.json');
const OUT_FILE = join(TMP_DIR, 'docs.json');

async function writeInput(topic: string, extra: Record<string, unknown> = {}): Promise<void> {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(IN_FILE, JSON.stringify({ topic, ...extra }), 'utf-8');
}

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_CONSOLE_ERROR = console.error;

afterEach(async () => {
    process.argv = ORIGINAL_ARGV;
    console.error = ORIGINAL_CONSOLE_ERROR;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('web-search fixture plugin', () => {
    test('writes a schema-valid Doc[] to --out via --in/--out', async () => {
        await writeInput('STORM topic research', { fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);

        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs.length).toBeGreaterThanOrEqual(2);
        for (const doc of docs) {
            expect(doc.id).toMatch(/^[0-9a-f]{16}$/);
            expect(doc.body.length).toBeGreaterThan(0);
            expect(doc.sourceUri).toBeDefined();
            expect(doc.title).toBeDefined();
            expect(doc.mediaType).toBe('text/markdown');
            expect(doc.metadata?.query).toBe('STORM topic research');
            expect(typeof doc.metadata?.rank).toBe('number');
        }
    });

    test('Doc ids are deterministic across two runs', async () => {
        await writeInput('STORM topic research', { fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);
        const firstIds = (JSON.parse(await readFile(OUT_FILE, 'utf-8')) as { id: string }[]).map((d) => d.id);

        expect(await main()).toBe(0);
        const secondIds = (JSON.parse(await readFile(OUT_FILE, 'utf-8')) as { id: string }[]).map((d) => d.id);
        expect(secondIds).toEqual(firstIds);
    });

    test('maxResults caps the emitted Doc list', async () => {
        await writeInput('STORM topic research', { maxResults: 2, fixture: true });
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        expect(await main()).toBe(0);
        const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
        expect(docs.length).toBe(2);
    });

    test('invocable via kk executor run (runInvoke)', async () => {
        await writeInput('STORM topic research', { fixture: true });
        try {
            const exitCode = await runInvoke({
                plugin: 'web-search',
                inPath: IN_FILE,
                outPath: OUT_FILE,
                pluginsRoot: join(import.meta.dir, '../..'),
            });
            expect(exitCode).toBe(0);

            const docs = DocListSchema.parse(JSON.parse(await readFile(OUT_FILE, 'utf-8')));
            expect(docs.length).toBeGreaterThanOrEqual(2);
        } finally {
            await rm(OUT_FILE, { force: true });
        }
    });

    test('live mode (fixture absent or false) exits 1 and writes no --out', async () => {
        // 0054 Block 8: `fixture` absent/false = live Firecrawl path; v1 has no live client →
        // fail loud (exit 1, no --out) instead of fabricating research docs as success.
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        for (const extra of [{}, { fixture: false }]) {
            await writeInput('STORM topic research', extra);
            process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
            await rm(OUT_FILE, { force: true });
            expect(await main()).toBe(1);
            await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        }
        expect(errors).toHaveLength(2);
        expect(errors.every((e) => e.includes('live Firecrawl not implemented in v1'))).toBe(true);
    });

    test('missing topic exits 1 and writes no --out', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        await writeInput('   ');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', OUT_FILE];
        await rm(OUT_FILE, { force: true });
        expect(await main()).toBe(1);
        await expect(readFile(OUT_FILE, 'utf-8')).rejects.toThrow();
        expect(errors).toEqual(['web-search failed: --in "topic" is required and must be a non-empty string']);
    });

    test('buildFixtureDocs emits D4-citation-surviving docs with stable ids', () => {
        const docs = buildFixtureDocs('stable topic', 8);
        expect(docs.length).toBeGreaterThanOrEqual(2);
        const ids = new Set(docs.map((d) => d.id));
        expect(ids.size).toBe(docs.length);
        expect(docs.every((d) => d.id && d.sourceUri && d.title && d.body.length > 0)).toBe(true);
    });
});

describe('web-search fail-loud validation (parseInput)', () => {
    test('rejects invalid JSON with a clear error', () => {
        expect(() => parseInput('{not json')).toThrow('--in is not valid JSON');
    });

    test('rejects non-object JSON with a clear error', () => {
        expect(() => parseInput('"just a string"')).toThrow('--in must be a JSON object');
        expect(() => parseInput('null')).toThrow('--in must be a JSON object');
    });

    test('rejects non-positive or non-integer maxResults', () => {
        const bad = (maxResults: unknown) => parseInput(JSON.stringify({ topic: 't', maxResults }));
        expect(() => bad(0)).toThrow('--in "maxResults" must be a positive integer when present');
        expect(() => bad(2.5)).toThrow('--in "maxResults" must be a positive integer when present');
    });
});

describe('web-search CLI failure paths', () => {
    test('missing --in/--out exits 1', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        process.argv = ['bun', 'test'];
        expect(await main()).toBe(1);
        expect(errors).toEqual(['Error: Missing required arguments --in and --out']);
    });

    test('write failure exits 1 with a message', async () => {
        const errors: string[] = [];
        console.error = (msg?: unknown) => errors.push(String(msg));
        await writeInput('STORM topic research', { fixture: true });
        await writeFile(join(TMP_DIR, 'blocker'), 'file, not a dir', 'utf-8');
        process.argv = ['bun', 'test', '--in', IN_FILE, '--out', join(TMP_DIR, 'blocker', 'docs.json')];
        expect(await main()).toBe(1);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('web-search failed:');
    });
});
