import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

/**
 * 0347 F7 (2026-11-10) — the publish3 repair node sends `--retry` on every gated-miss day, but a
 * gated miss never plans (the plan node is conditioned on the rss-gate hit), so "no plan" there is
 * a vacuous repair. `--retry` with no plan settles as a clean no-op; a non-retry send still fails
 * loud pointing at publish-matrix-plan.
 */
describe('publish-matrix-send vacuous repair (0347 F7)', () => {
    it('returns 0 with a no-op notice when --retry finds no plan', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-send-repair-'));
        const workDir = join(root, 'work');
        mkdirSync(join(workDir, '4-publish'), { recursive: true });
        const out = captureOutput();
        let code = 1;
        try {
            code = await sendPublishMatrix([workDir, '--window', 'after-generate', '--retry', '--tier', '0']);
        } finally {
            out.restore();
        }
        expect(code).toBe(0);
        expect(out.read()).toContain('nothing was planned, nothing to resend');
        rmSync(root, { recursive: true, force: true });
    });

    it('still fails loud without --retry when no plan exists', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-send-loud-'));
        const workDir = join(root, 'work');
        mkdirSync(join(workDir, '4-publish'), { recursive: true });
        const out = captureOutput();
        let code = 0;
        try {
            code = await sendPublishMatrix([workDir, '--window', 'after-generate']);
        } finally {
            out.restore();
        }
        expect(code).toBe(1);
        expect(out.readErr()).toContain('run publish-matrix-plan first');
        rmSync(root, { recursive: true, force: true });
    });
});
