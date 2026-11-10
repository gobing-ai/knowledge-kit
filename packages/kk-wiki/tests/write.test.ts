import { describe, expect, it } from 'bun:test';
import type { VaultPage } from '../src/page';
import { parsePage } from '../src/page';
import { applyWrite, applyWriteToPage, guardHeading } from '../src/write';

const base: VaultPage = {
    path: 'a.md',
    frontmatter: { title: 'A', type: 'concept', tags: [], sources: [], updated_at: '2026-11-10' },
    body: '# A\n\nOriginal prose.\n',
};
const guarded: VaultPage = { ...base, frontmatter: { ...base.frontmatter, user_edited: true } };

describe('applyWrite', () => {
    it('replaces an unguarded body in full mode', () => {
        const result = applyWrite(base, 'New body.\n', { mode: 'full', date: '2026-11-10' });
        expect(result.guard).toBe('clean');
        expect(result.body.trim()).toBe('New body.');
    });

    it('appends under the dated section for a guarded page and reports appended', () => {
        const result = applyWrite(guarded, 'Agent note.', { mode: 'full', date: '2026-11-10' });
        expect(result.guard).toBe('appended');
        expect(result.body).toContain('Original prose.');
        expect(result.body).toContain(guardHeading('2026-11-10'));
        expect(result.body).toContain('Agent note.');
    });

    it('accumulates a second write on the same day inside one section', () => {
        const first = applyWrite(guarded, 'first', { mode: 'full', date: '2026-11-10' });
        const second = applyWrite({ ...guarded, body: first.body }, 'second', { mode: 'full', date: '2026-11-10' });
        expect(second.body.split(guardHeading('2026-11-10'))).toHaveLength(2);
        expect(second.body).toContain('first');
        expect(second.body).toContain('second');
    });

    it('adds a new section on a different day, keeping the earlier one', () => {
        const day1 = applyWrite(guarded, 'first', { mode: 'full', date: '2026-11-10' });
        const day2 = applyWrite({ ...guarded, body: day1.body }, 'second', { mode: 'full', date: '2026-11-11' });
        expect(day2.body).toContain(guardHeading('2026-11-10'));
        expect(day2.body).toContain(guardHeading('2026-11-11'));
    });

    it('inserts before a later section rather than at the end of the file', () => {
        const withTail: VaultPage = {
            ...guarded,
            body: `${guardHeading('2026-11-10')}\n\nfirst\n\n## Later\n\nkept\n`,
        };
        const result = applyWrite(withTail, 'second', { mode: 'full', date: '2026-11-10' });
        expect(result.body.indexOf('second')).toBeLessThan(result.body.indexOf('## Later'));
        expect(result.body).toContain('kept');
    });
});

describe('applyWriteToPage', () => {
    it('renders the page with a bumped updated_at and the guard decision', () => {
        const { text, guard } = applyWriteToPage(guarded, 'note', { mode: 'full', date: '2026-11-11' });
        expect(guard).toBe('appended');
        expect(text).toContain('updated_at: 2026-11-11');
        expect(parsePage(text, 'a.md').frontmatter.user_edited).toBe(true);
    });
});

describe('guardHeading', () => {
    it('renders the frozen heading form', () => {
        expect(guardHeading('2026-11-10')).toBe('## AI Updates (2026-11-10)');
    });
});
