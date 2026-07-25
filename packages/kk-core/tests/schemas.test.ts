import { describe, expect, it } from 'bun:test';
import { ContentSchema, DocSchema, ResultSchema } from '../src/index';

describe('DocSchema', () => {
    it('parses a well-formed Doc', () => {
        const doc = DocSchema.parse({ id: 'd1', body: 'hello' });
        expect(doc.id).toBe('d1');
        expect(doc.body).toBe('hello');
    });

    it('rejects missing required field with path naming the field', () => {
        const result = DocSchema.safeParse({ body: 'no-id' });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('id');
        }
    });
});

describe('ContentSchema', () => {
    it('parses a well-formed Content and defaults format to markdown', () => {
        const content = ContentSchema.parse({ body: '# Title\n\nBody' });
        expect(content.body).toContain('Title');
        expect(content.format).toBe('markdown');
    });

    it('rejects missing body with field-level path', () => {
        const result = ContentSchema.safeParse({ title: 't' });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('body');
        }
    });
});

describe('ResultSchema', () => {
    it('parses a well-formed success Result', () => {
        const result = ResultSchema.parse({ ok: true, target: 'surfdash' });
        expect(result.ok).toBe(true);
        expect(result.target).toBe('surfdash');
    });

    it('rejects missing target with field-level path', () => {
        const parsed = ResultSchema.safeParse({ ok: false });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            const paths = parsed.error.issues.map((i) => i.path.join('.'));
            expect(paths).toContain('target');
        }
    });
});
