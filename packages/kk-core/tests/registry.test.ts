import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    collectionForKind,
    discoverPlugins,
    getByName,
    KK_CAPABILITY_COLLECTION,
    listByKind,
    type PluginKind,
} from '../src/index';

function withTempDir(fn: (dir: string) => void): void {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-registry-test-'));
    try {
        fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function writePlugin(
    root: string,
    kind: PluginKind,
    name: string,
    extra: { dirName?: string; entry?: string; omitKind?: boolean } = {},
): string {
    const dir = join(root, collectionForKind(kind), extra.dirName ?? name);
    mkdirSync(dir, { recursive: true });
    const body = extra.omitKind
        ? { name, entry: extra.entry ?? 'sp:entry' }
        : { name, kind, entry: extra.entry ?? 'sp:entry' };
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(body));
    return dir;
}

describe('discoverPlugins', () => {
    it('discovers valid plugins grouped by kind and supports listByKind & getByName', () => {
        withTempDir((root) => {
            const p1 = writePlugin(root, 'ingestion', 'ingest-a');
            const p2 = writePlugin(root, 'generator', 'gen-b');

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
            expect(p1).toContain(collectionForKind('ingestion'));
        });
    });

    it('scans a kind-collection directory as the plugins root', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'only-pub');
            const collectionRoot = join(root, collectionForKind('publish'));
            const res = discoverPlugins(collectionRoot);
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('only-pub');
            expect(res.plugins[0]?.kind).toBe('publish');
        });
    });

    it('skips the kk capability collection even when it has a plugin.json', () => {
        withTempDir((root) => {
            writePlugin(root, 'ingestion', 'keep');
            const kkDir = join(root, KK_CAPABILITY_COLLECTION);
            mkdirSync(kkDir, { recursive: true });
            writeFileSync(
                join(kkDir, 'plugin.json'),
                JSON.stringify({ name: 'kk', version: '1.0.0', description: 'capability plugin' }),
            );

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['keep']);
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('emits misplaced when a plugin.json sits at the plugins root', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'ok-pub');
            const stray = join(root, 'stray-plugin');
            mkdirSync(stray, { recursive: true });
            const strayManifest = join(stray, 'plugin.json');
            writeFileSync(strayManifest, JSON.stringify({ name: 'stray', kind: 'publish', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['ok-pub']);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('misplaced');
            expect(res.diagnostics[0]?.path).toBe(strayManifest);
        });
    });

    it('emits kind_mismatch when manifest kind does not match the collection', () => {
        withTempDir((root) => {
            const dir = join(root, collectionForKind('ingestion'), 'wrong-kind');
            mkdirSync(dir, { recursive: true });
            const manifestPath = join(dir, 'plugin.json');
            writeFileSync(manifestPath, JSON.stringify({ name: 'wrong', kind: 'publish', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(0);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('kind_mismatch');
            expect(res.diagnostics[0]?.path).toBe(manifestPath);
        });
    });

    it('emits malformed for invalid JSON without aborting the scan', () => {
        withTempDir((root) => {
            const dir = join(root, collectionForKind('publish'), 'broken-json');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'plugin.json'), '{ not json');
            writePlugin(root, 'publish', 'ok-after-broken');

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['ok-after-broken']);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('malformed');
            expect(res.diagnostics[0]?.reason).toContain('Invalid JSON');
        });
    });

    it('skips malformed plugin.json without aborting scan (R3)', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'bad', { omitKind: true, dirName: 'bad-plugin' });
            writePlugin(root, 'publish', 'good', { dirName: 'good-plugin' });

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('good');

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('malformed');
            expect(res.diagnostics[0]?.path).toBe(join(root, 'publishings', 'bad-plugin', 'plugin.json'));
            expect(res.diagnostics[0]?.reason).toContain('kind');
        });
    });

    it('emits duplicate_name diagnostic for duplicate plugin names, first-wins (R4)', () => {
        withTempDir((root) => {
            const p1 = writePlugin(root, 'ingestion', 'same-name', { dirName: 'plugin-1' });
            writePlugin(root, 'ingestion', 'same-name', { dirName: 'plugin-2' });

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.dir).toBe(p1);

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('duplicate_name');
            expect(res.diagnostics[0]?.path).toBe(
                join(root, collectionForKind('ingestion'), 'plugin-2', 'plugin.json'),
            );
        });
    });

    it('silently skips child directories without plugin.json', () => {
        withTempDir((root) => {
            mkdirSync(join(root, 'publishings', 'regular-dir'), { recursive: true });
            writePlugin(root, 'publish', 'ok-plugin');

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

    it('discovers the shipped kind-collection tree and skips plugins/kk', () => {
        const res = discoverPlugins(join(import.meta.dir, '../../../plugins'));
        expect(res.diagnostics).toHaveLength(0);
        expect(res.plugins.map((p) => p.name).sort()).toEqual([
            'content-gen',
            'karakeep-local',
            'qiita-pub',
            'surfdash-pub',
            'zenn-pub',
        ]);
        expect(getByName(res, 'karakeep-local')?.kind).toBe('ingestion');
        expect(getByName(res, 'content-gen')?.kind).toBe('generator');
        expect(getByName(res, 'surfdash-pub')?.dir).toContain(`${collectionForKind('publish')}/surfdash-pub`);
    });
});
