import { describe, expect, it } from 'bun:test';
import {
    FrontmatterError,
    PageFrontmatterSchema,
    parseFrontmatter,
    parsePage,
    renderPage,
    resolveSlug,
    type VaultPage,
} from '../src/page';

const VALID = `---
title: Vector index
type: concept
tags:
  - retrieval
sources:
  - raw/html/a1
updated_at: 2026-11-10
---

# Vector index

HNSW beats flat search above ~10k vectors.
`;

describe('parseFrontmatter', () => {
    it('parses flat keys, arrays and the body after the block', () => {
        const parsed = parseFrontmatter(VALID);
        expect(parsed.errors).toEqual([]);
        expect(parsed.data.title).toBe('Vector index');
        expect(parsed.data.type).toBe('concept');
        expect(parsed.data.tags).toEqual(['retrieval']);
        expect(parsed.data.sources).toEqual(['raw/html/a1']);
        expect(parsed.body).toStartWith('# Vector index');
    });

    it('reports a missing block instead of failing the whole vault', () => {
        const parsed = parseFrontmatter('# no frontmatter\n');
        expect(parsed.errors).toEqual(['missing-frontmatter']);
        expect(parsed.data).toEqual({});
    });

    it('reports an unterminated block', () => {
        expect(parseFrontmatter('---\ntitle: x\n').errors).toEqual(['unterminated-frontmatter']);
    });

    it('rejects a nested map line (flat-only contract)', () => {
        const parsed = parseFrontmatter('---\ntitle: x\nmeta:\n  child: 1\n---\nbody\n');
        expect(parsed.errors.some((entry) => entry.includes('nested or malformed'))).toBe(true);
    });

    it('reports an array item with no key above it', () => {
        const parsed = parseFrontmatter('---\n  - orphan\n---\nbody\n');
        expect(parsed.errors.some((entry) => entry.includes('array item without a key'))).toBe(true);
    });

    it('unquotes scalars and coerces booleans', () => {
        const parsed = parseFrontmatter('---\ntitle: "a: b"\nuser_edited: true\n---\n');
        expect(parsed.data.title).toBe('a: b');
        expect(parsed.data.user_edited).toBe(true);
    });

    it('treats an empty value and [] as an empty array', () => {
        expect(parseFrontmatter('---\ntags:\n---\n').data.tags).toEqual([]);
        expect(parseFrontmatter('---\ntags: []\n---\n').data.tags).toEqual([]);
    });
});

describe('parsePage', () => {
    it('validates a schema-conforming page', () => {
        const page = parsePage(VALID, 'content/concepts/vector-index.md');
        expect(page.frontmatter.title).toBe('Vector index');
        expect(page.frontmatter.user_edited).toBeUndefined();
        expect(page.path).toBe('content/concepts/vector-index.md');
    });

    it('throws FrontmatterError carrying the path and the issues', () => {
        const bad = '---\ntitle: x\n---\nbody\n';
        expect(() => parsePage(bad, 'content/x.md')).toThrow(FrontmatterError);
        try {
            parsePage(bad, 'content/x.md');
        } catch (error) {
            const typed = error as FrontmatterError;
            expect(typed.path).toBe('content/x.md');
            expect(typed.issues.length).toBeGreaterThan(0);
        }
    });
});

describe('renderPage', () => {
    it('round-trips tags, sources, user_edited and redirect_to', () => {
        const page: VaultPage = {
            path: 'content/concepts/vector-index.md',
            frontmatter: {
                title: 'Vector index',
                type: 'concept',
                tags: ['retrieval', 'ann'],
                sources: ['raw/html/a1'],
                updated_at: '2026-11-10',
                user_edited: true,
                redirect_to: 'ann-index',
            },
            body: '# Vector index\n\nBody text.',
        };
        const rendered = renderPage(page);
        const back = parsePage(rendered, page.path);
        expect(back.frontmatter).toEqual(page.frontmatter);
        expect(back.body).toContain('Body text.');
    });

    it('renders empty arrays explicitly so a re-parse is stable', () => {
        const rendered = renderPage({
            path: 'content/index.md',
            frontmatter: { title: 'Home', type: 'index', tags: [], sources: [], updated_at: '2026-11-10' },
            body: 'Home.',
        });
        expect(rendered).toContain('tags: []');
        expect(rendered).toContain('sources: []');
        expect(parsePage(rendered, 'content/index.md').frontmatter.tags).toEqual([]);
    });

    it('quotes values that would otherwise break the flat format', () => {
        const rendered = renderPage({
            path: 'a.md',
            frontmatter: { title: 'a: b', type: 'concept', tags: ['x: y'], sources: [], updated_at: '2026-11-10' },
            body: 'x',
        });
        expect(rendered).toContain('title: "a: b"');
        expect(parsePage(rendered, 'a.md').frontmatter.title).toBe('a: b');
    });
});

describe('PageFrontmatterSchema', () => {
    it('applies empty defaults for tags and sources', () => {
        const parsed = PageFrontmatterSchema.parse({ title: 'x', type: 'entity', updated_at: '2026-11-10' });
        expect(parsed.tags).toEqual([]);
        expect(parsed.sources).toEqual([]);
    });
});

describe('resolveSlug', () => {
    it('lowercases and collapses non-alphanumerics', () => {
        expect(resolveSlug('Vector Index (HNSW) — 2026!')).toBe('vector-index-hnsw-2026');
        expect(resolveSlug('  --Leading dashes--  ')).toBe('leading-dashes');
    });
});
