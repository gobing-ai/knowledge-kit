/**
 * G83/0440 — the day-centric console's view model.
 *
 * Failure list written before the code:
 * 1. the tab strip is exactly the five tabs, in order, and NO retired voice2 symbol survives in
 *    the module sources (a grep assertion, not a runtime one);
 * 2. Today's facts never render an unrecorded figure as a zero or an empty cell — every unknown is
 *    the word `unknown` with its reason;
 * 3. an empty attention list is an explicit all-clear the panel can branch on;
 * 4. the attention order is the projection's, so the console and `kk news digest` agree;
 * 5. History keeps a gap for a step a day never recorded (`null`, never 0) and lists days newest
 *    first;
 * 6. a recipe renders byte-identical to the resolved argv, with POSIX quoting only where needed;
 * 7. the hash round-trips the day and tab, and validates both (an operator can edit it).
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DailyDigest, DaySummary } from '../../src/contracts';
import {
    actionLogRows,
    actionPlaneEnabled,
    attentionRows,
    CONSOLE_TAB_LABELS,
    CONSOLE_TABS,
    consoleHash,
    durationTrend,
    formatDuration,
    generationFacts,
    historyRange,
    historyRows,
    isDayKey,
    parseConsoleHash,
    quoteArg,
    recipeText,
    windowRows,
} from '../../src/daily-voice/day-view';

const REPO = join(import.meta.dir, '../../../..');

/** A minimal digest: everything unrecorded, which is the state every unknown rule must survive. */
function digest(overrides: Partial<DailyDigest> = {}): DailyDigest {
    return {
        schemaVersion: 1,
        day: '20261125',
        status: 'unknown',
        generation: {
            runId: null,
            launchStatus: null,
            exitCode: null,
            startedAt: null,
            finishedAt: null,
            outcome: null,
            attempts: [],
            bundle: null,
            durations: [],
            unknownReason: 'no-launch-receipt',
        },
        windows: [
            {
                window: 'after-generate',
                runId: null,
                launchStatus: 'not-run',
                unknownReason: null,
                recordedStatus: null,
                provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                targets: [],
            },
        ],
        safety: { verdict: null, judge: null, unknownReason: 'no-safety-decision' },
        attention: [],
        actions: { enabled: false, lines: [] },
        sources: {},
        diagnostics: [],
        ...overrides,
    };
}

describe('the tab strip (AC1, feature R1)', () => {
    it('is the five frozen tabs, in the design order, each with its label', () => {
        expect([...CONSOLE_TABS]).toEqual(['today', 'generation', 'publishing', 'history', 'actions']);
        expect(CONSOLE_TABS.map((tab) => CONSOLE_TAB_LABELS[tab])).toEqual([
            'Today',
            'Generation',
            'Publishing',
            'History',
            'Actions log',
        ]);
    });

    it('leaves no retired voice2 symbol in the module sources', () => {
        const index = readFileSync(join(REPO, 'apps/board/src/daily-voice/index.tsx'), 'utf-8');
        const model = readFileSync(join(REPO, 'apps/board/src/daily-voice/day-view.ts'), 'utf-8');
        for (const retired of [
            'supplyContextOf',
            'RETIRED_DAILY_WORKFLOWS',
            'retiredLayoutNotice',
            'pickDailyFamily',
            'funnelView',
            'projectDailyResults',
            'LegacyProgressPanel',
        ]) {
            expect(`${retired}: ${index.includes(retired)}`).toBe(`${retired}: false`);
            expect(`${retired}: ${model.includes(retired)}`).toBe(`${retired}: false`);
        }
    });
});

describe('the Today tab (AC2, feature R3)', () => {
    it('renders every unrecorded figure as unknown with its reason, never as zero', () => {
        const facts = generationFacts(digest());
        const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));
        expect(byLabel.get('run')).toBe('unknown (no-launch-receipt)');
        expect(byLabel.get('attempts')).toBe('unknown (no-capture-record)');
        expect(byLabel.get('bundle')).toBe('unknown');
        expect(byLabel.get('safety')).toBe('unknown (no-safety-decision)');
        expect(facts.some((fact) => fact.value === '0')).toBe(false);
        expect(facts.find((fact) => fact.label === 'attempts')?.tone).toBe('warn');
    });

    it('states the recorded figures and their tones when the day is healthy', () => {
        const facts = generationFacts(
            digest({
                status: 'ok',
                generation: {
                    ...digest().generation,
                    runId: 'run-1',
                    launchStatus: 'done',
                    outcome: 'episode',
                    attempts: [{ runId: 'run-1', capturedAt: '2026-11-25T12:00:00Z', status: 'done' }],
                    bundle: {
                        identity: '20261125-run-1',
                        runDate: '20261125',
                        parentRunId: 'run-1',
                        title: 'an episode',
                        variants: [],
                        safety: 'pass',
                    },
                    unknownReason: null,
                },
                safety: { verdict: 'pass', judge: 'PASS', unknownReason: null },
            }),
        );
        const byLabel = new Map(facts.map((fact) => [fact.label, fact.value]));
        expect(byLabel.get('day status')).toBe('all clear');
        expect(byLabel.get('bundle')).toBe('20261125-run-1 · an episode');
        expect(byLabel.get('safety')).toBe('pass (judge PASS)');
        expect(byLabel.get('attempts')).toBe('1');
    });

    it('renders an empty attention list as an all-clear and keeps the projection order', () => {
        expect(attentionRows(digest())).toEqual([]);
        const rows = attentionRows(
            digest({
                attention: [
                    {
                        severity: 'error',
                        kind: 'target-failed',
                        subject: 'after-generate',
                        message: 'one target failed',
                        evidence: null,
                        recipes: [],
                    },
                    {
                        severity: 'warn',
                        kind: 'safety-flag',
                        subject: 'safety',
                        message: 'safety held',
                        evidence: '4-safety-variants',
                        recipes: [],
                    },
                ],
            }),
        );
        expect(rows.map((row) => row.severity)).toEqual(['error', 'warn']);
        expect(rows.map((row) => row.tone)).toEqual(['error', 'warn']);
    });

    it('labels each window and carries its targets, unknown state included', () => {
        const windows = windowRows(
            digest({
                windows: [
                    {
                        window: 'overseas-rss',
                        runId: 'kk-publish-1',
                        launchStatus: 'unknown',
                        unknownReason: 'no-launch-receipt',
                        recordedStatus: null,
                        provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                        targets: [
                            {
                                id: 'shipinhao-pub.audio',
                                tier: 0,
                                mode: 'live',
                                target: 'shipinhao-pub',
                                status: 'failed',
                                effect: 'none',
                                url: null,
                                guid: null,
                                finishedAt: null,
                                error: 'upload rejected',
                                evidence: { plan: '4-publish/plan.overseas-rss.json', receipt: null },
                            },
                        ],
                    },
                ],
            }),
        );
        expect(windows[0]?.label).toBe('Overseas rss');
        expect(windows[0]?.launch).toBe('unknown');
        expect(windows[0]?.tone).toBe('warn');
        expect(windows[0]?.recorded).toBe('unknown');
        expect(windows[0]?.targets[0]).toMatchObject({ id: 'shipinhao-pub.audio', effect: 'none' });
    });
});

describe('the Actions log tab (G83/0442)', () => {
    it('reads preview, launch, exit and refusal lines newest-first with their tones', () => {
        const rows = actionLogRows(
            digest({
                actions: {
                    enabled: true,
                    lines: [
                        {
                            ts: '2026-11-25T12:00:00Z',
                            kind: 'publish-retry',
                            day: '20261125',
                            argv: ['kk', 'news', 'publish', '--retry'],
                            origin: 'http://127.0.0.1:4340',
                            tokenHash: 'a',
                            runId: null,
                            exit: null,
                            result: 'preview',
                        },
                        {
                            ts: '2026-11-25T12:01:00Z',
                            kind: 'publish-retry',
                            day: '20261125',
                            argv: ['kk', 'news', 'publish', '--retry'],
                            origin: 'http://127.0.0.1:4340',
                            tokenHash: 'a',
                            runId: null,
                            exit: null,
                            result: 'launched',
                        },
                        {
                            ts: '2026-11-25T12:02:00Z',
                            kind: 'publish-retry',
                            day: '20261125',
                            argv: ['kk', 'news', 'publish', '--retry'],
                            origin: 'http://127.0.0.1:4340',
                            tokenHash: 'a',
                            runId: 'kk-publish-9',
                            exit: 2,
                        },
                        {
                            ts: '2026-11-25T12:03:00Z',
                            kind: 'cancel-run',
                            day: '20261125',
                            argv: [],
                            origin: 'http://evil.example',
                            tokenHash: null,
                            runId: null,
                            exit: null,
                            refusal: 'actions.origin.refused',
                        },
                    ],
                },
            }),
        );
        expect(rows.map((row) => row.word)).toEqual([
            'refused: actions.origin.refused',
            'exit 2',
            'launched',
            'preview',
        ]);
        expect(rows.map((row) => row.tone)).toEqual(['warn', 'error', 'info', 'success']);
        expect(rows[1]?.argv).toBe('kk news publish --retry');
        expect(actionPlaneEnabled(digest({ actions: { enabled: false, lines: [] } }))).toBe(false);
    });
});

describe('the History tab (AC3, feature R7)', () => {
    const days: DaySummary[] = [
        {
            day: '20261125',
            status: 'ok',
            runId: 'run-25',
            windows: [{ window: 'after-generate', launchStatus: 'done' }],
            durations: [
                { step: 'voice', startedAt: 'a', endedAt: 'b', durationMs: 180_000 },
                { step: 'script', startedAt: 'a', endedAt: 'b', durationMs: 4_000 },
            ],
        },
        {
            day: '20261124',
            status: 'attention',
            runId: null,
            windows: [{ window: 'cn-peak', launchStatus: 'not-run' }],
            durations: [{ step: 'voice', startedAt: 'a', endedAt: 'b', durationMs: null }],
        },
    ];

    it('lists each day with its status, windows and total generation time', () => {
        const rows = historyRows(days);
        expect(rows[0]).toMatchObject({ day: '20261125', word: 'all clear', totalMs: 184_000 });
        expect(rows[1]).toMatchObject({ day: '20261124', word: 'needs attention', totalMs: null });
        expect(rows[1]?.windows[0]?.tone).toBe('neutral');
    });

    it('keeps a null point for a step a day never timed, and reads oldest first', () => {
        const trend = durationTrend(days);
        const voice = trend.find((series) => series.step === 'voice');
        expect(voice?.points.map((point) => point.day)).toEqual(['20261124', '20261125']);
        expect(voice?.points.map((point) => point.ms)).toEqual([null, 180_000]);
        expect(voice?.latestMs).toBe(180_000);
        expect(trend.find((series) => series.step === 'script')?.points.map((point) => point.ms)).toEqual([
            null,
            4_000,
        ]);
    });

    it('formats a duration, and an unrecorded one as the explicit unknown', () => {
        expect(formatDuration(null)).toBe('unknown');
        expect(formatDuration(420)).toBe('420ms');
        expect(formatDuration(12_600)).toBe('13s');
        expect(formatDuration(184_000)).toBe('3m 04s');
    });

    it('asks for a bounded default range that contains the anchor day', () => {
        expect(historyRange('20261125')).toEqual({ from: '20261112', until: '20261125' });
        expect(historyRange('20261125', 1)).toEqual({ from: '20261125', until: '20261125' });
    });
});

describe('the hash and the recipes (AC4 / deep links)', () => {
    it('round-trips the day and tab', () => {
        const hash = consoleHash('20261125', 'history');
        expect(hash).toBe('#day=20261125&tab=history');
        expect(parseConsoleHash(hash)).toEqual({ day: '20261125', tab: 'history' });
        expect(consoleHash(null, 'today')).toBe('#tab=today');
    });

    it('validates an operator-edited hash instead of trusting it', () => {
        expect(parseConsoleHash('#day=2026-11-25&tab=nowhere')).toEqual({ day: null, tab: 'today' });
        expect(parseConsoleHash('#tab=actions')).toEqual({ day: null, tab: 'actions' });
        expect(parseConsoleHash('')).toEqual({ day: null, tab: 'today' });
        expect(isDayKey('20261125')).toBe(true);
        expect(isDayKey('2026112')).toBe(false);
    });

    it('renders a recipe byte-identical to its resolved argv', () => {
        const argv = ['kk', 'news', 'publish', '--run-date', '20261125', '--window', 'after-generate', '--retry'];
        expect(recipeText(argv)).toBe(argv.join(' '));
        expect(quoteArg('shipinhao-pub:retry')).toBe('shipinhao-pub:retry');
        expect(quoteArg('--channels=a,b')).toBe('--channels=a,b');
    });

    it('quotes only the arguments that need it, and never loses the value', () => {
        expect(quoteArg('two words')).toBe("'two words'");
        expect(quoteArg("it's")).toBe(`'it'\\''s'`);
        expect(quoteArg('')).toBe("''");
        expect(recipeText(['kk', 'news', 'digest', '--run-date', '20261125'])).toBe(
            'kk news digest --run-date 20261125',
        );
    });
});
