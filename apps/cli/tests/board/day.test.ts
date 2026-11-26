/**
 * G83/0439 — `projectDay` / `listDays` (feature R2/R12, AC1/AC4).
 *
 * Failure list written before the code:
 * 1. a day with no directory is `notFound` naming the path, never an empty digest;
 * 2. a publish plan with no launch receipt reads `unknown` (never `not-run`, never success);
 * 3. a window with no receipt and no plan reads `not-run`, and only reports attention once its slot passed;
 * 4. a malformed receipt/safety file reads `unknown` with a diagnostic, never a fabricated figure;
 * 5. every figure carries a source (artifact path or run id);
 * 6. worst-of status: running > failed > attention > ok, and `unknown` when nothing was recorded;
 * 7. a failed target with `effect: none` fails the day even though the outcome file says `partial`;
 * 8. a sticky `no-content` receipt is an attention item with no recipe (nothing step-level undoes it);
 * 9. a safety verdict other than `pass` raises `safety-flag` with the safety-node resume recipe;
 * 10. `listDays` stays inside the range, is newest-first, and refuses an inverted or oversized range.
 *
 * Real temporary directories only: the projection is the behavior under test, not a mock of it.
 */

import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyDigest, DaySummary } from '@gobing-ai/kk-board/contracts';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { type DayNotFound, listDays, MAX_DAY_RANGE, projectDay } from '../../src/board/day';

const fs = createNodeFileSystem();

/** A project root carrying one day directory and its capture records. */
function fixture(day: string): { root: string; dir: string; runId: string } {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-day-')));
    const dir = join(root, '.works', 'kk-news-generate', day);
    mkdirSync(join(dir, '4-publish', 'receipts'), { recursive: true });
    mkdirSync(join(dir, '4-safety-variants'), { recursive: true });
    const runId = `kk-news-generate-${day}-1`;
    writeRecord(root, dir, day, runId);
    return { root, dir, runId };
}

function writeRecord(root: string, dir: string, day: string, runId: string, capturedAt?: string): void {
    const runs = join(root, '.works', '.board', 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(
        join(runs, `${runId}.json`),
        JSON.stringify({
            schemaVersion: 1,
            projectPath: root,
            workflow: 'kk-news-generate',
            runId,
            workspacePath: dir,
            stamp: day,
            capturedAt: capturedAt ?? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:30:00.000Z`,
            settings: {},
        }),
    );
}

function json(path: string, value: unknown): void {
    writeFileSync(path, JSON.stringify(value));
}

function receipt(dir: string, value: Record<string, unknown>): void {
    json(join(dir, 'schedule-receipt.json'), { schemaVersion: 1, ...value });
}

function windowReceipt(dir: string, window: string, value: Record<string, unknown>): void {
    json(join(dir, '4-publish', `schedule-receipt.${window}.json`), { schemaVersion: 1, window, ...value });
}

function plan(
    dir: string,
    window: string,
    input: { bundleRunId: string; parentRunId: string; runDate?: string; rows?: string[] },
): void {
    json(join(dir, '4-publish', `plan.${window}.json`), {
        schemaVersion: 1,
        window,
        bundleRunId: input.bundleRunId,
        parentRunId: input.parentRunId,
        presetName: 'preset',
        presetDigest: 'digest',
        ...(input.runDate === undefined ? {} : { runDate: input.runDate }),
        excluded: [],
        rows: (input.rows ?? []).map((id) => ({
            id,
            plugin: id.split('.')[0],
            variant: 'episode',
            tier: 0,
            window,
            mode: 'live',
            required: true,
            approval: 'none',
            status: 'planned',
            payloadPath: '4-publish/payloads/x.json',
            payloadDigest: 'digest',
        })),
    });
}

function bundle(dir: string, day: string, runId: string, safety = 'pass'): void {
    json(join(dir, 'bundle.json'), {
        schemaVersion: 1,
        runId: `${day}-${runId}`,
        runDate: day,
        parentRunId: runId,
        episode: { title: 'an episode' },
        variants: {},
        safety: { status: safety },
    });
}

function safetyDecision(dir: string, day: string, value: string): void {
    json(join(dir, '4-safety-variants', `${day}_09_safety-verdict.decision`), {
        schemaVersion: 1,
        id: 'safety-verdict',
        value,
        method: 'choice',
    });
    json(join(dir, '4-safety-variants', `${day}_09_safety-judge_verdict.json`), {
        verdict: value === 'pass' ? 'PASS' : 'FAIL',
        // The confidence enum is part of the contract: a verdict without it is not evidence.
        confidence: 'MEDIUM',
        rubric: 'compliance',
    });
}

/** A settled, healthy day: receipt done, bundle frozen, one window published. */
function healthyDay(day: string): { root: string; dir: string; runId: string } {
    const fx = fixture(day);
    receipt(fx.dir, { runId: fx.runId, status: 'done', exitCode: 0 });
    bundle(fx.dir, day, fx.runId);
    plan(fx.dir, 'after-generate', {
        bundleRunId: `${day}-${fx.runId}`,
        parentRunId: fx.runId,
        runDate: day,
        rows: ['x-pub.post'],
    });
    windowReceipt(fx.dir, 'after-generate', { runId: `kk-publish-${day}-1`, status: 'done' });
    safetyDecision(fx.dir, day, 'pass');
    writeFileSync(
        join(fx.dir, 'step-timing.json'),
        `${JSON.stringify({ step: 'extract', startedAt: '2026-11-25T12:00:00Z', endedAt: '2026-11-25T12:00:30Z' })}\n${JSON.stringify({ step: 'voice', startedAt: '2026-11-25T12:01:00Z', endedAt: '2026-11-25T12:04:00Z' })}\n`,
    );
    return fx;
}

describe('projectDay — the join (AC1, R1)', () => {
    it('joins generation, publish windows and safety with a source for every figure group', async () => {
        const fx = healthyDay('29991231');
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991231')) as DailyDigest;

        expect(digest.status).toBe('ok');
        expect(digest.generation.runId).toBe(fx.runId);
        expect(digest.generation.launchStatus).toBe('done');
        expect(digest.generation.outcome).toBe('episode');
        expect(digest.generation.bundle?.title).toBe('an episode');
        expect(digest.generation.attempts.map((attempt) => attempt.runId)).toEqual([fx.runId]);
        expect(digest.generation.durations.map((duration) => duration.step)).toEqual(['extract', 'voice']);
        expect(digest.generation.durations[1]?.durationMs).toBe(180_000);

        const window = digest.windows.find((entry) => entry.window === 'after-generate');
        expect(window?.launchStatus).toBe('done');
        expect(window?.runId).toBe('kk-publish-29991231-1');
        expect(window?.targets.map((target) => target.id)).toEqual(['x-pub.post']);
        expect(window?.provenance.dateMatch).toBe(true);
        expect(digest.safety).toEqual({ verdict: 'pass', judge: 'PASS', unknownReason: null });

        expect(digest.sources['generation.attempts']).toContain(fx.runId);
        expect(digest.sources['generation.launch']).toBe('schedule-receipt.json');
        expect(digest.sources['generation.bundle']).toBe('bundle.json');
        expect(digest.sources['windows.after-generate']).toBe('4-publish/plan.after-generate.json');
        expect(digest.sources['windows.after-generate.launch']).toBe('4-publish/schedule-receipt.after-generate.json');
        expect(digest.sources.safety).toContain('4-safety-variants');
        expect(digest.attention).toEqual([]);
    });

    it('compares a dashed plan run date against the 8-digit day instead of calling it a mismatch', async () => {
        const fx = fixture('29991230');
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        bundle(fx.dir, '29991230', fx.runId);
        plan(fx.dir, 'cn-peak', {
            bundleRunId: `29991230-${fx.runId}`,
            parentRunId: fx.runId,
            runDate: '2999-12-30',
        });
        windowReceipt(fx.dir, 'cn-peak', { runId: 'kk-publish-29991230-1', status: 'done' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991230')) as DailyDigest;
        expect(digest.windows.find((w) => w.window === 'cn-peak')?.provenance.dateMatch).toBe(true);
    });
});

describe('projectDay — unknowns stay explicit (AC4, R6)', () => {
    it('returns notFound with the looked-up path for a day that has no directory', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-day-empty-')));
        const result = (await projectDay({ projectPath: root, fs }, '29990101')) as DayNotFound;
        expect(result.notFound).toBe(true);
        expect(result.lookedUp).toBe(join(root, '.works', 'kk-news-generate', '29990101'));
    });

    it('refuses a malformed day key without touching the filesystem', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-day-bad-')));
        expect((await projectDay({ projectPath: root, fs }, '2026-11-25')) as DayNotFound).toMatchObject({
            notFound: true,
        });
    });

    it('reads a plan with no launch receipt as unknown (no-launch-receipt), never as not-run', async () => {
        const fx = fixture('29991229');
        plan(fx.dir, 'after-generate', { bundleRunId: 'x', parentRunId: 'y', rows: ['x-pub.post'] });
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991229')) as DailyDigest;
        const window = digest.windows.find((entry) => entry.window === 'after-generate');
        expect(window?.launchStatus).toBe('unknown');
        expect(window?.unknownReason).toBe('no-launch-receipt');
    });

    it('reads a malformed receipt as unknown with a diagnostic', async () => {
        const fx = fixture('29991228');
        writeFileSync(join(fx.dir, 'schedule-receipt.json'), '{ not json');
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991228')) as DailyDigest;
        expect(digest.generation.launchStatus).toBeNull();
        expect(digest.diagnostics.map((diagnostic) => diagnostic.code)).toContain('board.day.receipt-invalid');
        expect(digest.status).toBe('unknown');
    });

    it('keeps an unrecognized window status unknown rather than guessing', async () => {
        const fx = fixture('29991227');
        windowReceipt(fx.dir, 'cn-peak', { runId: 'kk-publish-29991227-1', status: 'half-done' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991227')) as DailyDigest;
        const window = digest.windows.find((entry) => entry.window === 'cn-peak');
        expect(window?.launchStatus).toBe('unknown');
        expect(window?.unknownReason).toBe('unrecognized-launch-status');
    });

    it('reads a day with no recorded evidence at all as unknown with a reason', async () => {
        const fx = fixture('29991226');
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991226')) as DailyDigest;
        expect(digest.status).toBe('unknown');
        expect(digest.generation.unknownReason).toBe('no-launch-receipt');
        expect(digest.generation.attempts).toHaveLength(1);
        expect(digest.safety.unknownReason).toBe('no-safety-decision');
    });

    it('surfaces no judge verdict whose confidence is missing or outside the enum', async () => {
        const day = '29991223';
        const fx = fixture(day);
        safetyDecision(fx.dir, day, 'pass');
        json(join(fx.dir, '4-safety-variants', `${day}_09_safety-judge_verdict.json`), {
            verdict: 'PASS',
            confidence: 'CERTAIN',
            rubric: 'compliance',
        });
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        expect(digest.safety.judge).toBeNull();
        expect(digest.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
            'board.day.judge-confidence-unverified',
        );
    });

    it('reports the bundle safety card when the safety directory is absent', async () => {
        const fx = fixture('29991225');
        bundle(fx.dir, '29991225', fx.runId, 'exclude');
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991225')) as DailyDigest;
        expect(digest.safety.verdict).toBe('exclude');
        expect(digest.sources.safety).toBe('bundle.json');
        expect(digest.attention.map((item) => item.kind)).toContain('safety-flag');
    });
});

describe('projectDay — status worst-of and the attention rules (AC1/R2)', () => {
    it('reports a running window as running before anything else', async () => {
        const fx = healthyDay('29991224');
        windowReceipt(fx.dir, 'cn-peak', { runId: 'kk-publish-29991224-2', status: 'running' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, '29991224')) as DailyDigest;
        expect(digest.status).toBe('running');
    });

    it('fails the day for a target that failed with effect none and offers the retry recipe', async () => {
        const day = '29991223';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        bundle(fx.dir, day, fx.runId);
        plan(fx.dir, 'after-generate', {
            bundleRunId: `${day}-${fx.runId}`,
            parentRunId: fx.runId,
            runDate: day,
            rows: ['shipinhao-pub.audio'],
        });
        windowReceipt(fx.dir, 'after-generate', { runId: `kk-publish-${day}-1`, status: 'done' });
        json(join(fx.dir, '4-publish', 'receipts', 'shipinhao-pub.audio.json'), {
            schemaVersion: 1,
            parentRunId: fx.runId,
            // The receipt must name the plan's own bytes: a digest of anything else is untrusted.
            planDigest: createHash('sha256')
                .update(readFileSync(join(fx.dir, '4-publish', 'plan.after-generate.json')))
                .digest('hex'),
            plugin: 'shipinhao-pub',
            profile: 'shipinhao-pub',
            mode: 'live',
            attemptId: 'attempt-1',
            status: 'failed',
            effect: 'none',
            target: 'shipinhao-pub.audio',
            window: 'after-generate',
            error: 'upload rejected',
        });
        json(join(fx.dir, '4-publish', 'outcome.after-generate.json'), {
            schemaVersion: 1,
            window: 'after-generate',
            runDate: day,
            status: 'partial',
            published: 0,
            targets: 1,
            excluded: [],
            rows: [
                { id: 'shipinhao-pub.audio', tier: 0, required: true, status: 'failed', effect: 'none', dummy: false },
            ],
        });
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        expect(digest.status).toBe('failed');
        const item = digest.attention.find((entry) => entry.kind === 'target-failed');
        expect(item?.severity).toBe('error');
        expect(item?.message).toContain('shipinhao-pub.audio');
        expect(item?.recipes[0]?.argv).toEqual([
            'kk',
            'news',
            'publish',
            '--run-date',
            day,
            '--window',
            'after-generate',
            '--retry',
            '--channels',
            'shipinhao-pub',
        ]);
        expect(item?.recipes[0]?.dryRunArgv?.at(-1)).toBe('--dry-run');
    });

    it('names a refusal from the receipt and the report line, with no recipe', async () => {
        const day = '29991222';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'no-content', exitCode: 0 });
        writeFileSync(
            join(fx.dir, 'run-report.summary.txt'),
            'no-content: the episode ran 12.6 min (pre-spend estimate 58.2 min), below the 13 min floor\n',
        );
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        expect(digest.status).toBe('attention');
        const item = digest.attention.find((entry) => entry.kind === 'generation-refused');
        expect(item?.message).toContain('below the 13 min floor');
        expect(item?.recipes).toEqual([]);
    });

    it('offers a resume recipe when a failed run left one step open', async () => {
        const day = '29991221';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'failed', exitCode: 1 });
        writeFileSync(
            join(fx.dir, 'step-timing.json'),
            `${JSON.stringify({ step: 'extract', startedAt: '2026-11-21T12:00:00Z', endedAt: '2026-11-21T12:00:30Z' })}\n${JSON.stringify({ step: 'voice', startedAt: '2026-11-21T12:01:00Z' })}\n`,
        );
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        expect(digest.status).toBe('failed');
        const item = digest.attention.find((entry) => entry.kind === 'generation-failed');
        expect(item?.subject).toBe('voice');
        expect(item?.recipes[0]?.argv).toContain('--from-run');
        expect(item?.recipes[0]?.argv).toContain(fx.runId);
    });

    it('keeps the recipe off a failed run whose stopping node was never recorded', async () => {
        const day = '29991220';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'failed', exitCode: 1 });
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        const item = digest.attention.find((entry) => entry.kind === 'generation-failed');
        expect(item?.recipes).toEqual([]);
        expect(item?.message).toContain('no step recorded where it stopped');
    });

    it('raises window-not-run for a past day only, and a provenance mismatch for a false check', async () => {
        const day = '20200101';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        bundle(fx.dir, day, fx.runId);
        plan(fx.dir, 'cn-peak', { bundleRunId: 'someone-else', parentRunId: 'someone-else', runDate: day });
        windowReceipt(fx.dir, 'cn-peak', { runId: 'kk-publish-20200101-1', status: 'done' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        const kinds = digest.attention.map((item) => item.kind);
        expect(kinds).toContain('provenance-mismatch');
        expect(kinds).toContain('window-not-run');
        expect(digest.status).toBe('attention');
        const notRun = digest.attention.find((item) => item.kind === 'window-not-run');
        expect(notRun?.recipes[0]?.argv).toContain('--dummy');
        expect(notRun?.recipes[0]?.live).toBe(false);
    });

    it('orders the attention list by severity, error before warn', async () => {
        const day = '20200102';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        bundle(fx.dir, day, fx.runId);
        safetyDecision(fx.dir, day, 'exclude');
        plan(fx.dir, 'cn-peak', { bundleRunId: 'other', parentRunId: 'other', runDate: day });
        windowReceipt(fx.dir, 'cn-peak', { runId: 'kk-publish-20200102-1', status: 'done' });
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        const severities = digest.attention.map((item) => item.severity);
        expect(severities).toEqual([...severities].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)));
        expect(severities[0]).toBe('warn');
    });

    it('raises safety-flag with the safety-node resume recipe when a run is known', async () => {
        const day = '29991219';
        const fx = fixture(day);
        receipt(fx.dir, { runId: fx.runId, status: 'done' });
        safetyDecision(fx.dir, day, 'exclude');
        const digest = (await projectDay({ projectPath: fx.root, fs }, day)) as DailyDigest;
        const item = digest.attention.find((entry) => entry.kind === 'safety-flag');
        expect(item?.message).toContain("'exclude'");
        expect(item?.recipes[0]?.argv).toContain('safety');
    });
});

describe('listDays — the History list (R7 input, bounded)', () => {
    it('lists the days in range, newest first, with each day’s status', async () => {
        const fx = healthyDay('29991218');
        const second = join(fx.root, '.works', 'kk-news-generate', '29991217');
        mkdirSync(second, { recursive: true });
        receipt(second, { runId: 'kk-news-generate-29991217-1', status: 'done' });
        const days = (await listDays({ projectPath: fx.root, fs }, '29991217', '29991218')) as DaySummary[];
        expect(days.map((day) => day.day)).toEqual(['29991218', '29991217']);
        expect(days[0]?.status).toBe('ok');
        expect(days[0]?.durations.map((duration) => duration.step)).toEqual(['extract', 'voice']);
        expect(days[0]?.windows.find((window) => window.window === 'after-generate')?.launchStatus).toBe('done');
    });

    it('refuses an inverted, malformed or oversized range', async () => {
        const fx = healthyDay('29991216');
        expect(await listDays({ projectPath: fx.root, fs }, '29991218', '29991216')).toEqual([]);
        expect(await listDays({ projectPath: fx.root, fs }, 'nope', '29991216')).toEqual([]);
        const wide = await listDays({ projectPath: fx.root, fs }, '20200101', '20201231');
        expect(wide.length).toBeLessThanOrEqual(MAX_DAY_RANGE);
    });

    it('returns an empty list for a works root with no day directory at all', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-day-none-')));
        expect(await listDays({ projectPath: root, fs }, '20200101', '20200131')).toEqual([]);
    });
});
