import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AC4 — "Architecture docs record the store decision" — is a documentation criterion, and the
 * pipeline's evidence rule refuses to carry a MET acceptance criterion on a static reference alone:
 * it requires executable evidence (`test` or `command`). This file is that evidence: it asserts the
 * documentation claims so a later edit cannot silently drop them.
 *
 * ## Failure-first list — what this must catch
 *
 * 1. ADR-030 loses its `shipped` status, or its section is renamed/renumbered away.
 * 2. `docs/03_ARCHITECTURE.md`'s **Persistent store** paragraph reverts to describing the store as
 *    unbuilt. Deliberately scoped to THAT paragraph: two unrelated paragraphs legitimately still
 *    say "not yet built" (the DAG-workflow and generator-input-dispatch notes), so a whole-file
 *    assertion would be both wrong and brittle.
 * 3. `docs/04_DESIGN.md` stops listing any of the six `kk store` verbs, or `kk schedule render`.
 * 4. `docs/05_FEATURES.md` starts recording G31 as `done` while task 0213 (G31 scenario R14) is
 *    still outstanding — the false status task 0210's R7 clause 4 was amended to forbid.
 *
 * The command form of the same check (used by the verify pass as the AC4 evidence):
 *   grep -c 'shipped' <(sed -n '/^\*\*Persistent store/p' docs/03_ARCHITECTURE.md)
 */
const REPO = join(import.meta.dir, '../../..');
const read = (relPath: string): string => readFileSync(join(REPO, relPath), 'utf8');

/** The `**Persistent store …**` paragraph of 03, i.e. the block up to its first blank line. */
function persistentStoreParagraph(): string {
    const start = read('docs/03_ARCHITECTURE.md').indexOf('**Persistent store');
    if (start === -1) return '';
    return read('docs/03_ARCHITECTURE.md').slice(start).split('\n\n')[0] ?? '';
}

describe('AC4 — the architecture docs record the store decision', () => {
    it('ADR-030 carries a shipped status', () => {
        const adr = read('docs/00_ADR.md');
        const start = adr.indexOf('## ADR-030');
        expect(start).toBeGreaterThan(-1);
        const nextSection = adr.indexOf('\n## ', start + 1);
        const section = nextSection === -1 ? adr.slice(start) : adr.slice(start, nextSection);
        expect(section).toContain('shipped');
    });

    it('03_ARCHITECTURE describes the store as shipped, not as unbuilt', () => {
        const paragraph = persistentStoreParagraph();
        expect(paragraph).toContain('shipped');
        expect(paragraph).not.toContain('not yet built');
    });

    it('04_DESIGN lists every kk store verb and kk schedule render', () => {
        const design = read('docs/04_DESIGN.md');
        const verbs = [
            'store migrate',
            'store lock',
            'store ingest',
            'store label',
            'store extract',
            'store mark-used',
        ];
        for (const verb of verbs) {
            expect(design).toContain(verb);
        }
        expect(design).toContain('kk schedule render');
    });

    it('05_FEATURES does not record G31 done while 0213 is outstanding', () => {
        const row = read('docs/05_FEATURES.md')
            .split('\n')
            .find((line) => /^\|\s*G31\s*\|/.test(line));
        expect(row).toBeDefined();
        // The STATUS cell must not claim done. Asserting on the whole row would be wrong: the notes
        // cell legitimately contains the word "done" while describing which of G31's tasks ARE done.
        const statusCell = (row?.split('|')[3] ?? '').trim().toLowerCase();
        expect(statusCell).not.toBe('done');
        expect(row).toContain('0213');
        expect(row).toContain('backlog');
    });
});
