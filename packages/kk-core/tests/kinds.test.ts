import { describe, expect, it } from 'bun:test';
import { ContentSchema, DocListSchema, isPluginKind, kindContract, PLUGIN_KINDS, ResultSchema } from '../src/index';

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
        expect(c.input).toBe(ContentSchema);
        expect(c.output).toBe(ResultSchema);
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
});
