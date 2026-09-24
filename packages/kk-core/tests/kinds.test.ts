import { describe, expect, it } from 'bun:test';
import {
    ContentSchema,
    collectionForKind,
    DocListSchema,
    isPluginKind,
    KK_CAPABILITY_COLLECTION,
    kindContract,
    kindForCollection,
    PLUGIN_KIND_COLLECTIONS,
    PLUGIN_KINDS,
    ResultSchema,
} from '../src/index';

describe('kindContract', () => {
    it('resolves ingestion → output Doc[] and null input', () => {
        const c = kindContract('ingestion');
        expect(c.kind).toBe('ingestion');
        expect(c.input).toBeNull();
        expect(c.output).toBe(DocListSchema);
        const docs = DocListSchema.parse([{ id: '1', body: 'x' }]);
        expect(docs).toHaveLength(1);
    });

    it('resolves generator → input Doc[] and output Content', () => {
        const c = kindContract('generator');
        expect(c.kind).toBe('generator');
        expect(c.input).toBe(DocListSchema);
        expect(c.output).toBe(ContentSchema);
    });

    it('resolves publish → input Content and output Result', () => {
        const c = kindContract('publish');
        expect(c.kind).toBe('publish');
        expect(c.output).toBe(ResultSchema);
        // 0110 I3: publish input is the ordinary Content object again. The bare
        // Doc[] show-notes form (0095) is reachable only via a manifest-declared
        // doc-list operation — not through the kind contract (the executor
        // cannot treat an undeclared array as safe, and its output bypassed
        // Result validation).
        expect(c.input?.safeParse({ body: 'Article content', format: 'markdown' }).success).toBe(true);
        expect(c.input?.safeParse([{ id: 'd1', body: 'episode plan doc' }]).success).toBe(false);
        // Off-schema shapes still fail loud.
        expect(c.input?.safeParse({ nope: true }).success).toBe(false);
    });

    it('throws on unknown kind', () => {
        expect(() => kindContract('unknown')).toThrow(/Unknown plugin kind/);
    });
});

describe('PluginKind helpers', () => {
    it('lists the three kinds', () => {
        expect([...PLUGIN_KINDS]).toEqual(['ingestion', 'generator', 'publish']);
    });

    it('isPluginKind guards known kinds', () => {
        expect(isPluginKind('ingestion')).toBe(true);
        expect(isPluginKind('nope')).toBe(false);
    });

    it('maps kinds to ADR-009 collection directories and back', () => {
        expect(PLUGIN_KIND_COLLECTIONS).toEqual({
            ingestion: 'ingestions',
            generator: 'generations',
            publish: 'publishings',
        });
        expect(collectionForKind('ingestion')).toBe('ingestions');
        expect(collectionForKind('generator')).toBe('generations');
        expect(collectionForKind('publish')).toBe('publishings');
        expect(kindForCollection('ingestions')).toBe('ingestion');
        expect(kindForCollection('generations')).toBe('generator');
        expect(kindForCollection('publishings')).toBe('publish');
        expect(kindForCollection(KK_CAPABILITY_COLLECTION)).toBeUndefined();
        expect(kindForCollection('content-gen')).toBeUndefined();
        // 0155 R1: `in` walks Object.prototype, so inherited names must not count
        // as kind collections.
        for (const protoKey of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
            expect(kindForCollection(protoKey)).toBeUndefined();
        }
    });
});
