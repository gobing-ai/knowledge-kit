import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverPlugins, getByName, listByKind } from '../src/index';

function withTempDir(fn: (dir: string) => void): void {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-registry-test-'));
    try {
        fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('discoverPlugins', () => {
    it('discovers valid plugins grouped by kind and supports listByKind & getByName', () => {
        withTempDir((root) => {
            const p1 = join(root, 'plugin-ingest');
            mkdirSync(p1, { recursive: true });
            writeFileSync(
                join(p1, 'plugin.json'),
                JSON.stringify({ name: 'ingest-a', kind: 'ingestion', entry: 'sp:ingest' }),
            );

            const p2 = join(root, 'plugin-gen');
            mkdirSync(p2, { recursive: true });
            writeFileSync(
                join(p2, 'plugin.json'),
                JSON.stringify({ name: 'gen-b', kind: 'generator', entry: 'sp:gen' }),
            );

            const res = discoverPlugins(root);
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins).toHaveLength(2);

            const ingestions = listByKind(res, 'ingestion');
            expect(ingestions).toHaveLength(1);
            expect(ingestions[0]?.name).toBe('ingest-a');

            const generators = listByKind(res, 'generator');
            expect(generators).toHaveLength(1);
            expect(generators[0]?.name).toBe('gen-b');

            const pub = listByKind(res, 'publish');
            expect(pub).toHaveLength(0);

            const found = getByName(res, 'gen-b');
            expect(found?.dir).toBe(p2);
        });
    });

    it('skips malformed plugin.json without aborting scan (R3)', () => {
        withTempDir((root) => {
            const p1 = join(root, 'bad-plugin');
            mkdirSync(p1, { recursive: true });
            writeFileSync(join(p1, 'plugin.json'), JSON.stringify({ name: 'bad' })); // missing kind & entry

            const p2 = join(root, 'good-plugin');
            mkdirSync(p2, { recursive: true });
            writeFileSync(join(p2, 'plugin.json'), JSON.stringify({ name: 'good', kind: 'publish', entry: 'sp:pub' }));

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('good');

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('malformed');
            expect(res.diagnostics[0]?.path).toBe(join(p1, 'plugin.json'));
            expect(res.diagnostics[0]?.reason).toContain('kind');
        });
    });

    it('emits duplicate_name diagnostic for duplicate plugin names, first-wins (R4)', () => {
        withTempDir((root) => {
            const p1 = join(root, 'plugin-1');
            mkdirSync(p1, { recursive: true });
            writeFileSync(
                join(p1, 'plugin.json'),
                JSON.stringify({ name: 'same-name', kind: 'ingestion', entry: 'e1' }),
            );

            const p2 = join(root, 'plugin-2');
            mkdirSync(p2, { recursive: true });
            writeFileSync(
                join(p2, 'plugin.json'),
                JSON.stringify({ name: 'same-name', kind: 'generator', entry: 'e2' }),
            );

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.dir).toBe(p1);

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('duplicate_name');
            expect(res.diagnostics[0]?.path).toBe(join(p2, 'plugin.json'));
        });
    });

    it('silently skips child directories without plugin.json', () => {
        withTempDir((root) => {
            const noManifest = join(root, 'regular-dir');
            mkdirSync(noManifest, { recursive: true });

            const p1 = join(root, 'plugin-ok');
            mkdirSync(p1, { recursive: true });
            writeFileSync(join(p1, 'plugin.json'), JSON.stringify({ name: 'ok-plugin', kind: 'publish', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('ok-plugin');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('emits unreadable diagnostic when root directory does not exist', () => {
        const res = discoverPlugins('/path/does/not/exist/for/kk/test');
        expect(res.plugins).toHaveLength(0);
        expect(res.diagnostics).toHaveLength(1);
        expect(res.diagnostics[0]?.code).toBe('unreadable');
    });
});
