/**
 * Real-Chromium fixture regressions (task 0260 plan step 2 / AC1–AC5 evidence): each scenario spawns
 * `tests/fixtures/wechatmp-dom-runner.ts` — an isolated headless Chromium against synthetic editor
 * DOM — and executes the PRODUCTION enrichment rail / audio picker through `wrapPlaywrightPage`.
 * A missing Chromium or a crashed runner is an actionable failure (the runner's stderr is surfaced),
 * never a silent skip.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const RUNNER = join(import.meta.dir, 'fixtures', 'wechatmp-dom-runner.ts');

interface Facts {
    scenario: string;
    warnings?: string[];
    error?: string;
    ops?: {
        clicks: Record<string, number>;
        uploads: string[];
        audioResult?: string;
        committed?: { original: boolean | null; reward: boolean | null; claim: boolean | null };
        accountValue?: string | null;
        claimText?: string;
        urlValue?: string;
        urlPopoverOpen?: boolean;
        insertedMediaId?: string | null;
        tickedRows?: string[];
        dialogsOpen?: string[];
        insertClicked?: boolean;
    };
}

const run = (scenario: string): Facts => {
    const proc = Bun.spawnSync(['bun', RUNNER, scenario], {
        cwd: join(import.meta.dir, '..'),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const out = proc.stdout.toString().trim();
    const last = out.slice(out.lastIndexOf('\n') + 1);
    if (proc.exitCode !== 0 || !last.startsWith('{')) {
        throw new Error(
            `fixture runner for "${scenario}" failed (exit ${proc.exitCode}):\n${proc.stderr.toString() || out}`,
        );
    }
    return JSON.parse(last) as Facts;
};

describe('wechatmp DOM fixtures (real Chromium, offline)', () => {
    test('0318: URL commits from its popover and reads the row after the field disappears', () => {
        const { warnings, ops } = run('0318-url-commit');
        expect(warnings).toEqual([]);
        expect(ops?.urlValue).toBe('https://example.com/0318');
        expect(ops?.urlPopoverOpen).toBe(false);
        expect(ops?.clicks).toEqual({ url: 1 });
    }, 90_000);

    test('0318: an already committed URL is never reopened', () => {
        const { warnings, ops } = run('0318-url-skip');
        expect(warnings).toEqual([]);
        expect(ops?.urlValue).toBe('https://example.com/0318');
        expect(ops?.clicks).toEqual({});
    }, 90_000);

    test('0318: a refused URL commit warns and releases its popover', () => {
        const { warnings, ops } = run('0318-url-refused');
        expect(warnings?.some((w) => w.startsWith('原文链接:'))).toBe(true);
        expect(ops?.urlValue).toBe('');
        expect(ops?.urlPopoverOpen).toBe(false);
    }, 90_000);

    test('0318: a moved URL field is named and its popover is released', () => {
        const { warnings, ops } = run('0318-url-missing-field');
        expect(warnings?.some((w) => w.includes('no URL field'))).toBe(true);
        expect(ops?.urlValue).toBe('');
        expect(ops?.urlPopoverOpen).toBe(false);
    }, 90_000);

    test('0318: an already checked agreement stays checked when original commits', () => {
        const { warnings, ops } = run('0318-checked-agreement');
        expect(warnings).toEqual([]);
        expect(ops?.committed?.original).toBe(true);
        expect(ops?.clicks).toEqual({ original: 1 });
        expect(ops?.dialogsOpen).toEqual([]);
    }, 90_000);

    test('0318: measured entries commit original with hidden agreement, reward and claim with 确认', () => {
        const { warnings, ops } = run('0318-measured-settings');
        expect(warnings).toEqual([]);
        expect(ops?.committed).toEqual({ original: true, reward: true, claim: true });
        expect(ops?.claimText).toBe('个人观点，仅供参考');
        expect(ops?.clicks).toEqual({ original: 1, reward: 1, claim: 1 });
        expect(ops?.dialogsOpen).toEqual([]);
    }, 120_000);

    test('0318: an unavailable claim stance is named once and the dialog is closed', () => {
        const { warnings, ops } = run('0318-unavailable-stance');
        expect(warnings).toEqual(['创作来源: 平台未提供声明类型「个人观点，仅供参考」，已跳过']);
        expect(ops?.clicks).toEqual({ claim: 1 });
        expect(ops?.committed?.claim).toBe(false);
        expect(ops?.dialogsOpen).toEqual([]);
    }, 90_000);

    test('AC4: already-committed settings are never reopened or toggled off', () => {
        const { warnings, ops } = run('settings-committed-skip');
        expect(warnings).toEqual([]);
        expect(ops?.clicks).toEqual({});
        expect(ops?.dialogsOpen).toEqual([]);
    }, 90_000);

    test('AC4: a refused confirm leaves a named residual warning, never silent success', () => {
        const { warnings, ops } = run('settings-fail-named-warning');
        expect(warnings).toEqual(['原创声明: dialog did not close — check the draft']);
        // The rail's final sweep releases the refused dialog (warn + clean up), and the setting
        // stays uncommitted — success is never inferred from the refused confirm.
        expect(ops?.dialogsOpen).toEqual([]);
        expect(ops?.committed?.original).toBe(false);
    }, 90_000);

    test('AC4: reward account readback is a locator — native-CSS evaluate never sees :visible', () => {
        const { warnings, ops } = run('reward-native-readback');
        expect(warnings).toEqual([]);
        expect(ops?.accountValue).toBe('冰原奔狼');
        expect(ops?.committed?.reward).toBe(true);
        expect(ops?.dialogsOpen).toEqual([]);
    }, 90_000);

    test('AC3: exact-title material (whitespace/NBSP-normalized) is reused without upload', () => {
        const { warnings, ops } = run('audio-exact-reuse');
        expect(warnings).toEqual([]);
        expect(ops?.audioResult).toBe('');
        expect(ops?.tickedRows).toEqual(['media-9']);
        expect(ops?.insertedMediaId).toBe('media-9');
        expect(ops?.uploads).toEqual([]);
    }, 90_000);

    test('AC3: prefix-only match warns and never selects or uploads', () => {
        const { warnings, ops } = run('audio-prefix-warn');
        expect(warnings).toEqual([]);
        expect(ops?.audioResult?.startsWith('音频: 上传音频 control not found')).toBe(true);
        expect(ops?.tickedRows).toEqual([]);
        expect(ops?.insertedMediaId).toBeNull();
        expect(ops?.insertClicked).toBe(false);
    }, 90_000);

    test('AC3: duplicate exact titles are ambiguous — no first-item selection', () => {
        const { warnings, ops } = run('audio-duplicate-warn');
        expect(warnings).toEqual([]);
        expect(ops?.audioResult?.startsWith('音频:')).toBe(true);
        expect(ops?.tickedRows).toEqual([]);
        expect(ops?.insertClicked).toBe(false);
    }, 90_000);

    test('AC2: upload uses the scoped hidden inputs; unrelated modal input stays untouched', () => {
        const { warnings, ops } = run('audio-upload-scoped-inputs');
        expect(warnings).toEqual([]);
        expect(ops?.audioResult).toBe('');
        expect(ops?.uploads).toEqual(['audio-input', 'cover-input']);
        expect(ops?.tickedRows).toEqual(['media-7']);
        expect(ops?.insertedMediaId).toBe('media-7');
    }, 90_000);

    test('AC2: an insert whose body node never appears fails VERIFY (never success)', () => {
        const { warnings, ops } = run('audio-verify-unknown');
        expect(warnings).toEqual([]);
        expect(ops?.audioResult?.startsWith('音频:')).toBe(true);
        expect(ops?.insertClicked).toBe(true);
        expect(ops?.insertedMediaId).toBeNull();
    }, 90_000);

    test('AC5: an unclosable overlay keeps named residual diagnostics on every step', () => {
        const { warnings, ops } = run('unclosable-overlay');
        expect(warnings?.length).toBeGreaterThanOrEqual(2);
        expect(warnings?.[0]).toContain('原创声明');
        expect(ops?.dialogsOpen).toEqual(['dlg-wrp']);
    }, 120_000);

    test('AC5: a closable failed dialog is released before the dependent claim step', () => {
        const { warnings, ops } = run('closable-failure-releases');
        expect(warnings).toEqual(['原创声明: dialog did not close — check the draft']);
        expect(ops?.clicks?.claim).toBeGreaterThan(0);
        expect(ops?.claimText).toBe('个人观点，仅供参考');
        expect(ops?.committed?.claim).toBe(true);
        expect(ops?.dialogsOpen).toEqual([]);
    }, 120_000);
});
