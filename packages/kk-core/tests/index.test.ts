import { describe, expect, it } from 'bun:test';
import type { Content, Doc, Result } from '../src/index';
import { ContentSchema, DocSchema, ResultSchema } from '../src/index';

describe('exported inferred types', () => {
    it('Doc, Content, Result are assignable from schema parse results', () => {
        const doc: Doc = DocSchema.parse({ id: 'a', body: 'b' });
        const content: Content = ContentSchema.parse({ body: 'c' });
        const result: Result = ResultSchema.parse({ ok: true, target: 't' });
        expect(doc.id).toBe('a');
        expect(content.body).toBe('c');
        expect(result.ok).toBe(true);
    });
});
