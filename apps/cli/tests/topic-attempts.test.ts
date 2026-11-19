/**
 * Task 0392 R2 — both run-report paths consume the one per-attempt counts artifact, and a missing
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
        version: 2,
        runDate: '20261117',
        specVersion: 2,
        attempts: [
            {
                attempt: 1,
                counts: { preFilter: 8, kept: 5, uniqueExcluded: 3, deduped: 1, planned: null },
            },
            {
                attempt: 2,
                counts: { preFilter: 8, kept: 4, uniqueExcluded: 3, deduped: 0, planned: 4 },
                stages: [
                    { stage: 'qc', input: 8, kept: 8, dropped: [] },
                    { stage: 'topicBoundary', input: 8, kept: 5, dropped: ['x', 'y', 'z'] },
                    { stage: 'dedup', input: 5, kept: 5, dropped: [] },
                    { stage: 'curation', input: 5, kept: 4, dropped: ['c'] },
                    { stage: 'plan', input: 4, kept: 4, dropped: [] },
                ],
                curationExcluded: [{ id: 'c', reason: '与主线重复的背景消息' }],
                channelAdmission: [
                    {
                        scope: 'drafts',
                        status: 'exclude',
                        targets: [
                            { target: 'xiaoyuzhou', decision: 'OK' },
                            { target: 'wechatmp', decision: 'BLOCK' },
                        ],
                    },
                ],
            },
        ],
        reconciliation: {
            reconciled: true,
            uniqueIds: 3,
            ruleHits: 4,
            multipleHits: 1,
            zeroKept: false,
            skippedStages: ['floor'],
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

describe('selection attempts view (0392 R2)', () => {
    test('reads the latest attempt, its stages and its channel decisions', () => {
        const view = readSelectionAttempts(workDirWith(artifact()));
        expect(view).toEqual({
            version: 2,
            specVersion: 2,
            attempts: 2,
            preFilter: 8,
            kept: 4,
            uniqueExcluded: 3,
            ruleHits: 4,
            multipleHits: 1,
            curationExcluded: 1,
            stages: [
                { stage: 'qc', input: 8, kept: 8, dropped: 0 },
                { stage: 'topicBoundary', input: 8, kept: 5, dropped: 3 },
                { stage: 'dedup', input: 5, kept: 5, dropped: 0 },
                { stage: 'curation', input: 5, kept: 4, dropped: 1 },
                { stage: 'plan', input: 4, kept: 4, dropped: 0 },
            ],
            channelAdmission: [
                {
                    scope: 'drafts',
                    status: 'exclude',
                    targets: [
                        { target: 'xiaoyuzhou', decision: 'OK' },
                        { target: 'wechatmp', decision: 'BLOCK' },
                    ],
                },
            ],
            zeroKept: false,
            reconciled: true,
            skippedStages: ['floor'],
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
        expect(readSelectionAttempts(workDirWith({ version: 2, attempts: [] }))).toBeNull();
        expect(readSelectionAttempts(workDirWith({ attempts: [{}], reconciliation: 'nope' }))).not.toBeNull();
    });

    test('the no-content note states attempt count, unique IDs, rule hits and channel decisions', () => {
        const note = selectionAttemptsNote(readSelectionAttempts(workDirWith(artifact())));
        expect(note).toContain('selection attempts 2 (spec v2)');
        expect(note).toContain('raw pool 8 → kept 4, 3 unique excluded ID(s) across 4 rule hit(s)');
        expect(note).toContain('1 multi-rule ID(s)');
        expect(note).toContain('1 editorial exclusion(s)');
        expect(note).toContain('counts reconcile');
        expect(note).toContain('unknown: floor');
        expect(note).toContain('channel admission — drafts: xiaoyuzhou=OK, wechatmp=BLOCK (gate exclude)');
    });

    test('the section renders the funnel, editorial exclusions and the missing channel evidence', () => {
        const view = readSelectionAttempts(workDirWith(artifact()));
        const section = selectionAttemptsSection(view);
        expect(section).toContain('qc 8→8 (-0) · topicBoundary 8→5 (-3) · dedup 5→5 (-0)');
        expect(section).toContain('curation 5→4 (-1) · plan 4→4 (-0)');
        expect(section).toContain('Editorial exclusions: 1 (each retains its own reason)');
        // A day whose safety stage never ran says so instead of claiming no BLOCK existed.
        const unreviewed = readSelectionAttempts(
            workDirWith(artifact({ attempts: [{ attempt: 1, counts: { preFilter: 8, kept: 4 } }] })),
        );
        expect(selectionAttemptsSection(unreviewed)).toContain('channel admission: unknown (no safety receipt)');
        expect(selectionAttemptsSection(unreviewed)).toContain('Editorial exclusions: 0 observed');
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
                        issues: ['topicBoundary: input 8 ≠ kept 0 + dropped 7'],
                    },
                }),
            ),
        );
        const section = selectionAttemptsSection(view);
        expect(section).toContain('MISMATCH — see issues');
        expect(section).toContain('zero kept is a valid outcome');
        expect(section).toContain('topicBoundary: input 8 ≠ kept 0 + dropped 7');
        expect(section).toContain('no unknown stages');
        expect(selectionAttemptsNote(view)).toContain('counts do not reconcile');
    });

    test('missing counts print as unknown rather than 0', () => {
        const view = readSelectionAttempts(
            workDirWith(
                artifact({
                    attempts: [{ attempt: 1, counts: { preFilter: null, kept: null, uniqueExcluded: null } }],
                    reconciliation: { reconciled: false, perRuleHits: {}, skippedStages: ['qc'] },
                }),
            ),
        );
        expect(selectionAttemptsNote(view)).toContain('raw pool unknown → kept unknown, unknown unique excluded');
        expect(selectionAttemptsSection(view)).toContain('Rule spec v2, counts artifact v2');
        expect(selectionAttemptsSection(view)).toContain('Funnel: no stage evidence');
    });

    test('the ordinary report body gains the section, prefixed by a blank line', () => {
        const body = appendSelectionAttempts('# Daily run\n\nbody\n', readSelectionAttempts(workDirWith(artifact())));
        expect(body.startsWith('# Daily run\n\nbody\n\n## Topic selection')).toBe(true);
        expect(body.endsWith('\n')).toBe(true);
        expect(body.split('## Topic selection')).toHaveLength(2);
    });
});
