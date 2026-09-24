import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { formatIssues, readPluginJson } from '../src/plugin-output';

async function withTempFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-plugin-output-test-'));
    try {
        const path = join(dir, 'out.json');
        writeFileSync(path, content);
        await fn(path);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('formatIssues', () => {
    it('0157 R10 — renders an empty issue path as the `root` prefix', () => {
        expect(formatIssues({ issues: [{ path: [], message: 'invalid type' }] })).toBe('root: invalid type');
    });

    it('0157 R10 — dot-joins a nested issue path', () => {
        expect(formatIssues({ issues: [{ path: ['targets', 0, 'url'], message: 'expected string' }] })).toBe(
            'targets.0.url: expected string',
        );
    });

    it('0157 R10 — joins multiple issues with `; `', () => {
        expect(
            formatIssues({
                issues: [
                    { path: ['ok'], message: 'one' },
                    { path: [], message: 'two' },
                ],
            }),
        ).toBe('ok: one; root: two');
    });
});

describe('readPluginJson', () => {
    it('0157 R10 — throws `<label> wrote invalid JSON: …` when the file is malformed JSON', async () => {
        await withTempFile('not json', async (path) => {
            try {
                await readPluginJson(
                    createNodeFileSystem(),
                    path,
                    DocListSchema,
                    "Plugin 'x'",
                    'output violates the Doc list schema',
                );
                expect.unreachable();
            } catch (err: unknown) {
                expect(err).toBeInstanceOf(Error);
                expect((err as Error).message).toContain("Plugin 'x' wrote invalid JSON:");
            }
        });
    });

    it('0157 R10 — throws `<label> <violation>: <issues>` when the JSON violates the schema', async () => {
        await withTempFile(JSON.stringify([{ id: 'd1' }]), async (path) => {
            // DocListSchema requires `body`, so item 0 fails at path [0, 'body'].
            try {
                await readPluginJson(
                    createNodeFileSystem(),
                    path,
                    DocListSchema,
                    "Plugin 'x'",
                    'output violates the Doc list schema',
                );
                expect.unreachable();
            } catch (err: unknown) {
                expect(err).toBeInstanceOf(Error);
                expect((err as Error).message).toContain("Plugin 'x' output violates the Doc list schema: 0.body:");
            }
        });
    });

    it('0157 R10 — returns the parsed data for a valid document list', async () => {
        const docs = [{ id: 'd1', body: 'alpha' }];
        await withTempFile(JSON.stringify(docs), async (path) => {
            await expect(
                readPluginJson(
                    createNodeFileSystem(),
                    path,
                    DocListSchema,
                    "Plugin 'x'",
                    'output violates the Doc list schema',
                ),
            ).resolves.toEqual(docs);
        });
    });
});
