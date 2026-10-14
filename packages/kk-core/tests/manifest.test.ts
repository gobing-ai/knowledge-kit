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

    it('keeps unknown manifest keys (loose object, 0155 R8)', () => {
        const manifest = parsePluginManifest({ name: 'n', kind: 'publish', entry: 'e', extra: 1 });
        expect((manifest as { extra?: unknown }).extra).toBe(1);
    });
});

describe('BrowserSessionDescriptorSchema (0277 R1)', () => {
    const base = { name: 'x-pub', kind: 'publish', entry: './src/index.ts', check: './src/profile-check.ts' };

    it('accepts a safe descriptor with and without a homeUrl', () => {
        const withUrl = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'x', homeUrl: 'https://x.com/compose/articles' },
        });
        expect(withUrl.success).toBe(true);

        const withoutUrl = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'substack' },
        });
        expect(withoutUrl.success).toBe(true);
        if (withoutUrl.success) {
            expect(withoutUrl.data.browserSession).toEqual({ profileName: 'substack' });
        }
    });

    it('requires kind publish and a check probe entry', () => {
        const ingestion = PluginManifestSchema.safeParse({
            name: 'x',
            kind: 'ingestion',
            entry: 'e',
            browserSession: { profileName: 'x' },
        });
        expect(ingestion.success).toBe(false);
        if (!ingestion.success) {
            expect(ingestion.error.issues.map((i) => i.path.join('.'))).toContain('browserSession');
        }

        const noCheck = PluginManifestSchema.safeParse({
            name: 'x',
            kind: 'publish',
            entry: 'e',
            browserSession: { profileName: 'x' },
        });
        expect(noCheck.success).toBe(false);
    });

    it('enforces the safe profile-name rule and credential-free http(s) homeUrl', () => {
        const unsafe = PluginManifestSchema.safeParse({ ...base, browserSession: { profileName: 'a b' } });
        expect(unsafe.success).toBe(false);

        const userinfo = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'x', homeUrl: 'https://user:pass@x.com/' },
        });
        expect(userinfo.success).toBe(false);

        const fragment = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'x', homeUrl: 'https://x.com/#frag' },
        });
        expect(fragment.success).toBe(false);

        const ftp = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'x', homeUrl: 'ftp://x.com/' },
        });
        expect(ftp.success).toBe(false);
    });

    it('keeps a plugin-fixed navigation query (Juejin v=2) on the declared homeUrl', () => {
        const canonical = PluginManifestSchema.safeParse({
            ...base,
            browserSession: { profileName: 'juejin', homeUrl: 'https://juejin.cn/editor/drafts/new?v=2' },
        });
        expect(canonical.success).toBe(true);
    });
});
