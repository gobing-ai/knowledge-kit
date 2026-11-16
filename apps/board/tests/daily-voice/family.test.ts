import { describe, expect, it } from 'bun:test';
import {
    DAILY_WORKFLOW,
    pickDailyFamily,
    RETIRED_DAILY_WORKFLOWS,
    retiredLayoutNotice,
} from '../../src/daily-voice/view';
import type { RunListRow } from '../../src/shared/run-selection';

/** 0384 — the module reads the current family and shows a retired-layout day as retired. */

function row(id: string, workflowName: string): RunListRow {
    return { id, workflowName, status: 'done', startedAt: null, completedAt: null };
}

describe('pickDailyFamily (0384 R1/R2)', () => {
    it('answers with the current family whenever it recorded any run', () => {
        const choice = pickDailyFamily(
            [row('new-1', DAILY_WORKFLOW)],
            [{ family: 'kk-daily-ai-voice2', rows: [row('old-1', 'kk-daily-ai-voice2')] }],
        );
        expect(choice.family).toBe(DAILY_WORKFLOW);
        expect(choice.retired).toBe(false);
        expect(choice.rows.map((entry) => entry.id)).toEqual(['new-1']);
    });

    it('falls back to a retired family and says the answer is retired when the current one is empty', () => {
        const choice = pickDailyFamily(
            [],
            [
                { family: 'kk-daily-ai-voice', rows: [] },
                {
                    family: 'kk-daily-ai-voice2',
                    rows: [row('old-1', 'kk-daily-ai-voice2'), row('old-2', 'kk-daily-ai-voice2')],
                },
            ],
        );
        expect(choice.family).toBe('kk-daily-ai-voice2');
        expect(choice.retired).toBe(true);
        expect(choice.rows).toHaveLength(2);
    });

    it('keeps the current family selected when nothing ran anywhere, so the empty state names it', () => {
        const choice = pickDailyFamily(
            [],
            RETIRED_DAILY_WORKFLOWS.map((family) => ({ family, rows: [] })),
        );
        expect(choice.family).toBe(DAILY_WORKFLOW);
        expect(choice.retired).toBe(false);
        expect(choice.rows).toEqual([]);
    });

    it('reads the families it claims to: the retired list is newest-first and excludes the current one', () => {
        expect(RETIRED_DAILY_WORKFLOWS).not.toContain(DAILY_WORKFLOW);
        expect(RETIRED_DAILY_WORKFLOWS[0]).toBe('kk-daily-ai-voice2');
    });
});

describe('retiredLayoutNotice (0384 R2)', () => {
    it('is silent for the current family', () => {
        expect(
            retiredLayoutNotice({ family: DAILY_WORKFLOW, rows: [row('n', DAILY_WORKFLOW)], retired: false }),
        ).toBeNull();
    });

    it('names the retired family and the run count, and points at the current family', () => {
        const notice = retiredLayoutNotice({
            family: 'kk-daily-ai-voice2',
            rows: [row('a', 'kk-daily-ai-voice2')],
            retired: true,
        });
        expect(notice).toContain('retired kk-daily-ai-voice2 layout');
        expect(notice).toContain('1 run');
        expect(notice).toContain(DAILY_WORKFLOW);
    });

    it('pluralizes the day count', () => {
        const notice = retiredLayoutNotice({
            family: 'kk-daily-ai-voice2',
            rows: [row('a', 'x'), row('b', 'x')],
            retired: true,
        });
        expect(notice).toContain('2 runs');
    });
});
