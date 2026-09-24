import { describe, expect, it } from 'bun:test';
import type { OperationIO, PluginOperation } from '@gobing-ai/kk-core';
import type { Content, Doc, Result } from '../src/index';
import { ContentSchema, DocSchema, OperationIOSchema, ResultSchema } from '../src/index';

describe('exported inferred types', () => {
    it('Doc, Content, Result are assignable from schema parse results', () => {
        const doc: Doc = DocSchema.parse({ id: 'a', body: 'b' });
        const content: Content = ContentSchema.parse({ body: 'c' });
        const result: Result = ResultSchema.parse({ ok: true, target: 't' });
        expect(doc.id).toBe('a');
        expect(content.body).toBe('c');
        expect(result.ok).toBe(true);
    });

    it('exposes OperationIOSchema / OperationIO / PluginOperation from the entry point (0155 R9)', () => {
        expect(OperationIOSchema.options).toEqual(['doc-list', 'markdown']);

        // Type-only import from the package name proves the public surface;
        // must compile under tsc (bun run lint).
        const op: PluginOperation = { input: 'doc-list', output: 'markdown' };
        const io: OperationIO = op.input;
        expect(io).toBe('doc-list');
    });
});
