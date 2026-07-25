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
});
