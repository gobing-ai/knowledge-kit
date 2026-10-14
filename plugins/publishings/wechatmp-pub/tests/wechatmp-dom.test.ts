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
