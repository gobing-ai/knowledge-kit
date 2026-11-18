/**
 * Task 0392 R14 — both run-report paths consume the one per-attempt counts artifact, and a missing
 * or partial artifact degrades to "unknown" instead of a fabricated zero.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSelectionAttempts, selectionAttemptsPath } from '../src/commands/daily';
import {
    appendSelectionAttempts,
    parseSelectionAttempts,
    selectionAttemptsNote,
    selectionAttemptsSection,
} from '../src/topic-attempts';

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: 1,
        runDate: '20261117',
        specVersion: 2,
        attempts: [
            {
                attempt: 1,
                counts: { preFilter: 8, kept: 5, uniqueExcluded: 3, deduped: 1, planned: null },
            },
            {
                attempt: 2,
                counts: { preFilter: 8, kept: 5, uniqueExcluded: 3, deduped: 0, planned: null },
            },
        ],
        reconciliation: {
            reconciled: true,
            uniqueIds: 3,
            ruleHits: 4,
            multipleHits: 1,
            zeroKept: false,
            skippedStages: ['plan', 'floor'],
            issues: [],
        },
        ...overrides,
    };
}

function workDirWith(value: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-topic-attempts-'));
    mkdirSync(join(dir, '21-plan'), { recursive: true });
    writeFileSync(selectionAttemptsPath(dir), typeof value === 'string' ? value : JSON.stringify(value));
    return dir;
}

describe('selection attempts view (0392 R14)', () => {
    test('reads the latest attempt and keeps unique IDs apart from rule hits', () => {
        const view = readSelectionAttempts(workDirWith(artifact()));
        expect(view).toEqual({
            version: 1,
            specVersion: 2,
            attempts: 2,
            preFilter: 8,
            kept: 5,
            uniqueExcluded: 3,
            ruleHits: 4,
            multipleHits: 1,
            zeroKept: false,
            reconciled: true,
            skippedStages: ['plan', 'floor'],
            issues: [],
        });
    });

    test('an absent artifact is unknown, not zero', () => {
        const empty = mkdtempSync(join(tmpdir(), 'kk-topic-attempts-none-'));
        expect(readSelectionAttempts(empty)).toBeNull();
        expect(selectionAttemptsNote(null)).toBe('');
        expect(selectionAttemptsSection(null)).toBe('');
        expect(appendSelectionAttempts('body', null)).toBe('body');
    });

    test('junk and shapeless artifacts degrade to null', () => {
        // The projection is pure: the parser alone already rejects junk (daily.ts owns the read).
        expect(parseSelectionAttempts('{not json')).toBeNull();
        expect(readSelectionAttempts(workDirWith('{not json'))).toBeNull();
        expect(readSelectionAttempts(workDirWith('[]'))).toBeNull();
        expect(readSelectionAttempts(workDirWith({ version: 1, attempts: [] }))).toBeNull();
        expect(readSelectionAttempts(workDirWith({ attempts: [{}], reconciliation: 'nope' }))).not.toBeNull();
    });

    test('the no-content note states attempt count, unique IDs and rule hits', () => {
        const note = selectionAttemptsNote(readSelectionAttempts(workDirWith(artifact())));
        expect(note).toContain('selection attempts 2 (spec v2)');
        expect(note).toContain('pre-filter 8 → kept 5, 3 unique excluded ID(s) across 4 rule hit(s)');
        expect(note).toContain('1 multi-rule ID(s)');
        expect(note).toContain('counts reconcile');
        expect(note).toContain('unknown: plan, floor');
    });

    test('a zero-kept day is named as a valid outcome, and a mismatch surfaces its issues', () => {
        const view = readSelectionAttempts(
            workDirWith(
                artifact({
                    reconciliation: {
                        reconciled: false,
                        uniqueIds: 8,
                        ruleHits: 0,
                        multipleHits: 0,
                        zeroKept: true,
                        skippedStages: [],
                        issues: ['counts do not reconcile: preFilter 8 ≠ kept 0 + excluded 7'],
                    },
                }),
            ),
        );
        const section = selectionAttemptsSection(view);
        expect(section).toContain('MISMATCH — see issues');
        expect(section).toContain('zero kept is a valid outcome');
        expect(section).toContain('counts do not reconcile: preFilter 8 ≠ kept 0 + excluded 7');
        expect(section).toContain('no unknown stages');
        expect(selectionAttemptsNote(view)).toContain('counts do not reconcile');
    });

    test('missing counts print as unknown rather than 0', () => {
        const view = readSelectionAttempts(
            workDirWith(
                artifact({
                    attempts: [{ attempt: 1, counts: { preFilter: null, kept: null, uniqueExcluded: null } }],
                    reconciliation: { reconciled: false, perRuleHits: {}, skippedStages: ['preFilter'] },
                }),
            ),
        );
        expect(selectionAttemptsNote(view)).toContain('pre-filter unknown → kept unknown, unknown unique excluded');
        expect(selectionAttemptsSection(view)).toContain('Rule spec v2, counts artifact v1');
    });

    test('the ordinary report body gains the section, prefixed by a blank line', () => {
        const body = appendSelectionAttempts('# Daily run\n\nbody\n', readSelectionAttempts(workDirWith(artifact())));
        expect(body.startsWith('# Daily run\n\nbody\n\n## Topic selection')).toBe(true);
        expect(body.endsWith('\n')).toBe(true);
        expect(body.split('## Topic selection')).toHaveLength(2);
    });
});
