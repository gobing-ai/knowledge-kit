import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { mergeDocLists, runFanin } from '../src/fanin';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-fanin-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('mergeDocLists', () => {
    it('R1 — merges two doc lists sharing an id into one, deduped, with both sources', () => {
        const a: Doc[] = [
            { id: 'd1', body: 'alpha' },
            { id: 'd2', body: 'first body' },
        ];
        const b: Doc[] = [
            { id: 'd2', body: 'second body' },
            { id: 'd3', body: 'gamma' },
        ];

        const merged = mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(merged.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
        // First-seen wins: d2 keeps the first input's body.
        expect(merged[1]?.body).toBe('first body');
        // Provenance lists every originating source in input order.
        expect(merged[1]?.metadata?.sources).toEqual([{ file: 'a.json' }, { file: 'b.json' }]);
        // Unshared docs carry their single source.
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }]);
    });

    it('keeps documents in deterministic first-appearance order', () => {
        const a: Doc[] = [
            { id: 'x', body: '1' },
            { id: 'y', body: '2' },
        ];
        const b: Doc[] = [{ id: 'y', body: 'dup' }];
        const c: Doc[] = [{ id: 'z', body: '3' }];

        expect(mergeDocLists([a, b, c], ['a', 'b', 'c']).map((d) => d.id)).toEqual(['x', 'y', 'z']);
    });

    it('handles a duplicate id within a single input (first occurrence wins)', () => {
        const input: Doc[] = [
            { id: 'd1', body: 'first' },
            { id: 'd1', body: 'second' },
        ];

        const merged = mergeDocLists([input], ['a.json']);

        expect(merged).toHaveLength(1);
        expect(merged[0]?.body).toBe('first');
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }, { file: 'a.json' }]);
    });

    it('returns an empty list for empty inputs', () => {
        expect(mergeDocLists([], [])).toEqual([]);
        expect(mergeDocLists([[]], ['a.json'])).toEqual([]);
    });

    it('never mutates the input doc lists', () => {
        const a: Doc[] = [{ id: 'd1', body: 'alpha', metadata: { tag: 'keep' } }];
        const b: Doc[] = [{ id: 'd1', body: 'dup' }];
        const snapshotA = structuredClone(a);
        const snapshotB = structuredClone(b);

        mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(a).toEqual(snapshotA);
        expect(b).toEqual(snapshotB);
    });

    it('carries sourceUri into the provenance entry and preserves other metadata', () => {
        const a: Doc[] = [{ id: 'd1', body: 'alpha', sourceUri: 'https://example.com/a', metadata: { tag: 'keep' } }];
        const b: Doc[] = [{ id: 'd1', body: 'dup', sourceUri: 'https://example.com/b' }];

        const merged = mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(merged[0]?.metadata?.sources).toEqual([
            { file: 'a.json', sourceUri: 'https://example.com/a' },
            { file: 'b.json', sourceUri: 'https://example.com/b' },
        ]);
        expect(merged[0]?.metadata?.tag).toBe('keep');
        // metadata.sources is replaced by fanin provenance, not accumulated.
        expect(Object.keys(merged[0]?.metadata ?? {})).toEqual(['tag', 'sources']);
    });

    it('creates metadata.sources for docs that had no metadata', () => {
        const merged = mergeDocLists([[{ id: 'd1', body: 'alpha' }]], ['a.json']);
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }]);
    });
});

describe('runFanin', () => {
    // Negative-path tests call logger.error intentionally; silence stderr so --dots stays clean.
    let origError: typeof logger.error;
    let errLog: string[];

    beforeEach(() => {
        errLog = [];
        origError = logger.error;
        logger.error = (msg: string) => {
            errLog.push(msg);
        };
    });

    afterEach(() => {
        logger.error = origError;
    });

    it('R1 — writes one deduplicated output file with provenance for both sources', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            const bFile = join(root, 'b.json');
            const outFile = join(root, 'merged.json');
            writeFileSync(
                aFile,
                JSON.stringify([
                    { id: 'd1', body: 'alpha' },
                    { id: 'd2', body: 'first' },
                ]),
            );
            writeFileSync(bFile, JSON.stringify([{ id: 'd2', body: 'second' }]));

            const code = await runFanin(['--in', aFile, '--in', bFile, '--out', outFile]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
            // The shared document appears exactly once with both originating sources.
            expect(outData[1].metadata.sources).toEqual([{ file: aFile }, { file: bFile }]);
        });
    });

    it('accepts a single --in input', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            const outFile = join(root, 'merged.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));

            const code = await runFanin(['--in', aFile, '--out', outFile]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData).toEqual([{ id: 'd1', body: 'alpha', metadata: { sources: [{ file: aFile }] } }]);
        });
    });

    it('fails with non-zero exit naming the file when an input is missing', async () => {
        await withTempDir(async (root) => {
            const missing = join(root, 'nope.json');
            const code = await runFanin(['--in', missing, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog.join('\n')).toContain(missing);
        });
    });

    it('fails with non-zero exit naming the file when an input is invalid JSON', async () => {
        await withTempDir(async (root) => {
            const badFile = join(root, 'bad.json');
            writeFileSync(badFile, '{ invalid json');
            const code = await runFanin(['--in', badFile, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog.join('\n')).toContain(badFile);
            expect(errLog.join('\n')).toContain('invalid JSON');
        });
    });

    it('fails with non-zero exit naming the file when an input violates the Doc list schema', async () => {
        await withTempDir(async (root) => {
            const badFile = join(root, 'bad-schema.json');
            writeFileSync(badFile, JSON.stringify([{ id: 'd1' }])); // missing required 'body'
            const code = await runFanin(['--in', badFile, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog.join('\n')).toContain(badFile);
        });
    });

    it('fails with exit code 2 on usage errors', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));

            // Missing --out
            expect(await runFanin(['--in', aFile])).toBe(2);
            // No --in at all
            expect(await runFanin(['--out', join(root, 'merged.json')])).toBe(2);
            // Unknown flag
            expect(await runFanin(['--in', aFile, '--out', join(root, 'm.json'), '--bogus'])).toBe(2);
        });
    });

    it('fails with exit code 2 when --in or --out is missing its value', async () => {
        await withTempDir(async (root) => {
            expect(await runFanin(['--in'])).toBe(2);
            expect(errLog.join('\n')).toContain('--in requires a file path');

            errLog = [];
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));
            expect(await runFanin(['--in', aFile, '--out'])).toBe(2);
            expect(errLog.join('\n')).toContain('--out requires a file path');
        });
    });

    it('fails with non-zero exit naming the file when an input exists but cannot be read', async () => {
        await withTempDir(async (root) => {
            // A directory exists but readFileSync cannot read it as a file (EISDIR).
            const dirInput = join(root, 'input-dir');
            mkdirSync(dirInput);

            const code = await runFanin(['--in', dirInput, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog.join('\n')).toContain(dirInput);
            expect(errLog.join('\n')).toContain('Failed to read input file');
        });
    });

    it('fails with non-zero exit when the output file cannot be written', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));
            const badOut = join(root, 'missing-dir', 'merged.json');

            const code = await runFanin(['--in', aFile, '--out', badOut]);

            expect(code).toBe(1);
            expect(errLog.join('\n')).toContain('Failed to write output file');
        });
    });
});
