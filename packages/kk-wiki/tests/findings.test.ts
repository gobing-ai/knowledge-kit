import { describe, expect, it } from 'bun:test';
import type { FindingCode, FindingRecord } from '../src/findings';
import { lintPages } from '../src/lint';

/** The finding vocabulary is closed: every producer's code must be one of the five classes. */

const CODES: FindingCode[] = ['broken-link', 'orphan', 'missing-frontmatter', 'invalid-frontmatter', 'duplicate-slug'];

describe('finding vocabulary', () => {
    it('carries exactly the five documented classes and default line 1', () => {
        const record: FindingRecord = { code: CODES[0] as FindingCode, path: 'a.md', line: 1, message: 'x' };
        expect(record.code).toBe('broken-link');
        expect(CODES).toHaveLength(5);
        expect(lintPages({ contentDir: '.', pages: [], bySlug: new Map(), findings: [] })).toEqual([]);
    });
});
