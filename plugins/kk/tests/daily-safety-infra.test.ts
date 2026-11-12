import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { safetyDigest } from '../scripts/kk-workflow-stages';

/**
 * 0347 F4 (2026-11-10) — the daily-safety-gate stage separates an executor outage from a real
 * content verdict. When the classification is block AND the evidence the gate grades is missing
 * (request/report/verdict never appeared because a reviewer or judge agent died), the gate writes
 * the safety-infra.json marker the `judge -> infra-fail` transition reads, skips the draft
 * quarantine (an outage did not reject the drafts) and still exits 0 with status block — the
 * caller's "non-zero = never publish" contract is unchanged. A real verdict block quarantines and
 * writes no marker. A pass writes neither.
 */
describe('daily-safety-gate infra-fail separation (0347 F4)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
    const date = '20261109';

    function withFixture(files: Record<string, string>): { dir: string; run: () => ReturnType<typeof spawnSync> } {
        const dir = mkdtempSync(join(tmpdir(), 'kk-safety-infra-'));
        for (const [rel, content] of Object.entries(files)) {
            const path = join(dir, rel);
            mkdirSync(join(path, '..'), { recursive: true });
            writeFileSync(path, content);
        }
        const digest = safetyDigest(dir, date);
        // The request's digest must match the drafts or the gate classifies "edited after review".
        const requestPath = join(dir, '24-script', `${date}_09_safety-review_request.json`);
        if (files[`24-script/${date}_09_safety-review_request.json`] !== undefined) {
            writeFileSync(requestPath, JSON.stringify({ digest }));
        }
        const run = () =>
            spawnSync('bun', [runner, 'daily-safety-gate', dir, date, '2', '24-script'], { encoding: 'utf-8' });
        return { dir, run };
    }

    const drafts = {
        [`22-article/${date}_06_article_content.json`]: JSON.stringify({ schema: 'content.v1', title: 't', body: 'b' }),
        [`24-script/${date}_08_script_voicescript.yaml`]: 'title: t\nsegments: []\n',
    };
    const cleanReport = JSON.stringify({
        escalate: false,
        confidence: 'HIGH',
        platforms: [{ platform: 'xiaoyuzhou', decision: 'OK', findings: [{ category: 3, disposition: 'note' }] }],
    });
    const blockReport = JSON.stringify({
        escalate: false,
        platforms: [
            {
                platform: 'netease',
                decision: 'BLOCK',
                findings: [{ category: 3, item: '姓名', detail: '可识别个人信息' }],
            },
        ],
    });
    const passVerdict = JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', findings: [] });
    const piiFailVerdict = JSON.stringify({
        verdict: 'FAIL',
        confidence: 'HIGH',
        findings: [{ criterion: 'no-prohibited-claims', status: 'fail' }],
    });

    it('executor outage (judge verdict never appeared) — block + infra marker, drafts preserved, exit 0', () => {
        const { dir, run } = withFixture({
            ...drafts,
            [`24-script/${date}_09_safety-review_request.json`]: '{}',
            [`24-script/${date}_09_safety-review_report.json`]: cleanReport,
        });
        const res = run();
        expect(res.status).toBe(0);
        expect(readFileSync(join(dir, '24-script', `${date}_09_safety-judge_status.txt`), 'utf-8').trim()).toBe(
            'block',
        );
        const marker = JSON.parse(readFileSync(join(dir, '24-script', `${date}_09_safety-infra.json`), 'utf-8')) as {
            infra: boolean;
            missing: string[];
        };
        expect(marker.infra).toBe(true);
        expect(marker.missing).toEqual(['judge-verdict']);
        // The outage did not reject the drafts — quarantine is a content-verdict behavior.
        expect(existsSync(join(dir, '22-article', `${date}_06_article_content.json`))).toBe(true);
        expect(existsSync(join(dir, '24-script', `${date}_08_script_voicescript.yaml`))).toBe(true);
        expect(existsSync(join(dir, '24-script', `.quarantine-${date}-judge-block`))).toBe(false);
        expect(res.stderr).toContain('safety: infra');
        rmSync(dir, { recursive: true, force: true });
    });

    it('real content verdict (PII fail, budget spent) — block, NO infra marker, drafts quarantined', () => {
        const { dir, run } = withFixture({
            ...drafts,
            [`24-script/${date}_09_safety-review_request.json`]: '{}',
            [`24-script/${date}_09_safety-review_report.json`]: blockReport,
            [`24-script/${date}_09_safety-judge_verdict.json`]: piiFailVerdict,
            // The remediation budget is spent, so the BLOCK/FAIL lands on the final block.
            '.safety-revise-count': '2',
        });
        const res = run();
        expect(res.status).toBe(0);
        expect(readFileSync(join(dir, '24-script', `${date}_09_safety-judge_status.txt`), 'utf-8').trim()).toBe(
            'block',
        );
        expect(existsSync(join(dir, '24-script', `${date}_09_safety-infra.json`))).toBe(false);
        const q = join(dir, '24-script', `.quarantine-${date}-judge-block`);
        expect(existsSync(q)).toBe(true);
        expect(readdirSync(q).length).toBe(2);
        rmSync(dir, { recursive: true, force: true });
    });

    it('clean pass — no marker, no quarantine, stamp written', () => {
        const { dir, run } = withFixture({
            ...drafts,
            [`24-script/${date}_09_safety-review_request.json`]: '{}',
            [`24-script/${date}_09_safety-review_report.json`]: cleanReport,
            [`24-script/${date}_09_safety-judge_verdict.json`]: passVerdict,
        });
        const res = run();
        expect(res.status).toBe(0);
        expect(readFileSync(join(dir, '24-script', `${date}_09_safety-judge_status.txt`), 'utf-8').trim()).toBe('pass');
        expect(existsSync(join(dir, '24-script', `${date}_09_safety-infra.json`))).toBe(false);
        expect(existsSync(join(dir, '24-script', `${date}_09_safety-judge_stamp.json`))).toBe(true);
        rmSync(dir, { recursive: true, force: true });
    });

    it('a stale infra marker from an earlier outage does not survive a clean pass', () => {
        const { dir, run } = withFixture({
            ...drafts,
            [`24-script/${date}_09_safety-review_request.json`]: '{}',
            [`24-script/${date}_09_safety-review_report.json`]: cleanReport,
            [`24-script/${date}_09_safety-judge_verdict.json`]: passVerdict,
            [`24-script/${date}_09_safety-infra.json`]: JSON.stringify({ infra: true, missing: ['judge-verdict'] }),
        });
        const res = run();
        expect(res.status).toBe(0);
        expect(readFileSync(join(dir, '24-script', `${date}_09_safety-judge_status.txt`), 'utf-8').trim()).toBe('pass');
        expect(existsSync(join(dir, '24-script', `${date}_09_safety-infra.json`))).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });
});
