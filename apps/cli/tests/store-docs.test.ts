import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
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
 * 3. `docs/04_DESIGN.md` stops listing any of the `kk store` verbs, or `kk schedule render`.
 * 4. `docs/05_FEATURES.md` records a G31 status that disagrees with the feature file — `done`
 *    while work is outstanding (the false status task 0210's R7 clause 4 forbids), or still
 *    `active` after the feature closed. Invariant: the status cell contains `done` iff the
 *    `docs/features/G31_*.md` frontmatter status is `done`. Substring match, not equality: 05
 *    spells a completed row `✅ done`, so a bare-token compare never binds. Bound to the feature
 *    file, never to a task WBS or phrase in the notes — those pin a transitional state and go red
 *    on a correct sync.
 * 5. The G31 confidence-surface inventory (task 0213 R1) disappears, or one of its `file:line`
 *    anchors stops resolving (file gone, or line past EOF).
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
            'store select',
            'store mark-published',
            'store release',
        ];
        for (const verb of verbs) {
            expect(design).toContain(verb);
        }
        expect(design).toContain('kk schedule render');
    });

    it('05_FEATURES records G31 with its real status (done iff the feature file says done)', () => {
        const row = read('docs/05_FEATURES.md')
            .split('\n')
            .find((line) => /^\|\s*G31\s*\|/.test(line));
        expect(row).toBeDefined();
        // Only the STATUS cell: the notes cell legitimately says "done" about individual tasks.
        const statusCell = (row?.split('|')[3] ?? '').trim().toLowerCase();
        const featureFile = readdirSync(join(REPO, 'docs/features')).find((name) => name.startsWith('G31_'));
        expect(featureFile).toBeDefined();
        const featureStatus = read(`docs/features/${featureFile}`).match(/^status:\s*(\S+)/m)?.[1];
        expect(featureStatus).toBeDefined();
        expect(statusCell.includes('done')).toBe(featureStatus === 'done');
    });

    it('the G31 confidence-surface inventory exists and every anchor resolves', () => {
        const design = read('docs/design/kk-collect-and-daily-voice2.md');
        const start = design.indexOf('### Confidence surfaces');
        expect(start).toBeGreaterThan(-1);
        const table = design.slice(start).split('\n## ')[0] ?? '';
        const anchors = [...table.matchAll(/`([\w./-]+\.\w+):(\d+)`/g)];
        expect(anchors.length).toBeGreaterThanOrEqual(7);
        for (const [, file, line] of anchors) {
            expect(read(file as string).split('\n').length).toBeGreaterThanOrEqual(Number(line));
        }
    });
});
