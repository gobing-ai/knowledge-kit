import { describe, expect, it } from 'bun:test';
import { PluginManifestSchema, parsePluginManifest } from '../src/index';

describe('PluginManifestSchema', () => {
    it('parses a valid plugin manifest', () => {
        const manifest = parsePluginManifest({
            name: 'karakeep-local',
            kind: 'ingestion',
            entry: 'karakeep-ingest',
            version: '1.0.0',
            description: 'Local karakeep ingestion plugin',
        });
        expect(manifest.name).toBe('karakeep-local');
        expect(manifest.kind).toBe('ingestion');
        expect(manifest.entry).toBe('karakeep-ingest');
    });

    it('rejects manifest missing required fields (kind, entry)', () => {
        const res = PluginManifestSchema.safeParse({ name: 'incomplete' });
        expect(res.success).toBe(false);
        if (!res.success) {
            const fields = res.error.issues.map((i) => i.path.join('.'));
            expect(fields).toContain('kind');
            expect(fields).toContain('entry');
        }
    });

    it('rejects manifest with invalid kind', () => {
        const res = PluginManifestSchema.safeParse({
            name: 'bad-kind',
            kind: 'invalid-kind',
            entry: 'run',
        });
        expect(res.success).toBe(false);
        if (!res.success) {
            const fields = res.error.issues.map((i) => i.path.join('.'));
            expect(fields).toContain('kind');
        }
    });

    it('0110 I3 — accepts declared operations and rejects unknown IO forms', () => {
        const valid = PluginManifestSchema.safeParse({
            name: 'podcast-pub',
            kind: 'publish',
            entry: './src/index.ts',
            operations: { 'show-notes': { input: 'doc-list', output: 'markdown' } },
        });
        expect(valid.success).toBe(true);
        if (valid.success) {
            expect(valid.data.operations?.['show-notes']).toEqual({ input: 'doc-list', output: 'markdown' });
        }

        const badIO = PluginManifestSchema.safeParse({
            name: 'podcast-pub',
            kind: 'publish',
            entry: './src/index.ts',
            operations: { 'show-notes': { input: 'json', output: 'markdown' } },
        });
        expect(badIO.success).toBe(false);
    });
});
