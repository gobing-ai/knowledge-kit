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

describe('PublishingCapabilitiesSchema (0298 / ADR-040)', () => {
    const validPublishing = {
        defaultProfile: 'article',
        profiles: {
            article: {
                format: 'article',
                locale: 'source',
                limits: {
                    title: { max: 100, unit: 'unicode_code_points' },
                    body: { max: 5000, unit: 'unicode_code_points' },
                },
                requires: { cover: true, orderedImages: false },
                modes: {
                    draft: { metadata: { published: false } },
                    live: { metadata: { published: true } },
                },
            },
        },
    };

    it('parses valid publishing capabilities on a publish plugin', () => {
        const parsed = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: validPublishing,
        });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.publishing?.defaultProfile).toBe('article');
            expect(parsed.data.publishing?.profiles.article?.format).toBe('article');
            expect(parsed.data.publishing?.profiles.article?.locale).toBe('source');
            expect(parsed.data.publishing?.profiles.article?.requires?.cover).toBe(true);
            expect(parsed.data.publishing?.profiles.article?.modes.draft?.metadata).toEqual({ published: false });
        }
    });

    it('rejects publishing capabilities on a non-publish plugin', () => {
        const parsed = PluginManifestSchema.safeParse({
            name: 'test-gen',
            kind: 'generator',
            entry: './src/index.ts',
            publishing: validPublishing,
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain('publishing');
        }
    });

    it('rejects empty profiles record or defaultProfile not referencing a declared profile', () => {
        const emptyProfiles = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: { defaultProfile: 'article', profiles: {} },
        });
        expect(emptyProfiles.success).toBe(false);

        const missingDefault = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: {
                defaultProfile: 'missing',
                profiles: validPublishing.profiles,
            },
        });
        expect(missingDefault.success).toBe(false);
    });

    it('rejects unknown keys in publishing or profile objects (strict)', () => {
        const unknownPublishingKey = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: {
                ...validPublishing,
                unknownField: 'bad',
            },
        });
        expect(unknownPublishingKey.success).toBe(false);

        const unknownProfileKey = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: {
                defaultProfile: 'article',
                profiles: {
                    article: {
                        ...validPublishing.profiles.article,
                        execution: 'executor',
                    },
                },
            },
        });
        expect(unknownProfileKey.success).toBe(false);
    });

    it('requires modes to have at least draft or live', () => {
        const noModes = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: {
                defaultProfile: 'article',
                profiles: {
                    article: {
                        format: 'article',
                        locale: 'zh',
                        modes: {},
                    },
                },
            },
        });
        expect(noModes.success).toBe(false);
    });

    it('validates locale format (source or BCP 47 language tag)', () => {
        for (const loc of ['source', 'zh', 'en', 'ja', 'en-US', 'zh-Hans']) {
            const ok = PluginManifestSchema.safeParse({
                name: 'test-pub',
                kind: 'publish',
                entry: './src/index.ts',
                publishing: {
                    defaultProfile: 'article',
                    profiles: {
                        article: {
                            format: 'article',
                            locale: loc,
                            modes: { draft: { metadata: {} } },
                        },
                    },
                },
            });
            expect(ok.success, loc).toBe(true);
        }

        const bad = PluginManifestSchema.safeParse({
            name: 'test-pub',
            kind: 'publish',
            entry: './src/index.ts',
            publishing: {
                defaultProfile: 'article',
                profiles: {
                    article: {
                        format: 'article',
                        locale: 'invalid locale!',
                        modes: { draft: { metadata: {} } },
                    },
                },
            },
        });
        expect(bad.success).toBe(false);
    });
});
