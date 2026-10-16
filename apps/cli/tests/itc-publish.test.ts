import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ItcReceiptSchema,
    itcCheckTargets,
    itcExportSeo,
    itcMaterializePlan,
    itcReconcileReceipts,
    itcReportSummary,
    itcSendTargets,
} from '../src/itc-publish';

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-pub-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('itcMaterializePlan & Target Payloads (0302 / G21 R2)', () => {
    it('materializes content.json and writes isolated target payloads with cleaned mode keys', async () => {
        await withTempDir(async (workDir) => {
            writeFileSync(
                join(workDir, '3-draft-draft-article.md'),
                '# Test Draft Article\n\nFull substantive markdown body.',
            );
            mkdirSync(join(workDir, '2-outline'), { recursive: true });
            writeFileSync(join(workDir, '2-outline/outline-approved.md'), '# Outline\n\n- Point 1\n- Point 2');
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'png');

            const code = await itcMaterializePlan([workDir, 'qiita-pub,wechatmp-pub', 'en', 'false']);
            expect(code).toBe(0);

            const contentJsonPath = join(workDir, '4-publish/content.json');
            expect(existsSync(contentJsonPath)).toBe(true);
            const content = JSON.parse(readFileSync(contentJsonPath, 'utf-8'));
            expect(content.title).toBe('Test Draft Article');

            const planPath = join(workDir, '4-publish/publish-plan.json');
            expect(existsSync(planPath)).toBe(true);
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
            expect(plan.targets).toHaveLength(2);

            // Verify isolated Qiita payload has private: true and published: false
            const qiitaPayloadPath = join(workDir, '4-publish/content.qiita-pub.json');
            expect(existsSync(qiitaPayloadPath)).toBe(true);
            const qiitaPayload = JSON.parse(readFileSync(qiitaPayloadPath, 'utf-8'));
            expect(qiitaPayload.metadata.private).toBe(true);
            expect(qiitaPayload.metadata.published).toBe(false);

            // Verify isolated WeChat payload has operation: 文章 and publishStatus: draft
            const wechatPayloadPath = join(workDir, '4-publish/content.wechatmp-pub.json');
            expect(existsSync(wechatPayloadPath)).toBe(true);
            const wechatPayload = JSON.parse(readFileSync(wechatPayloadPath, 'utf-8'));
            expect(wechatPayload.metadata.operation).toBe('文章');
            expect(wechatPayload.metadata.publishStatus).toBe('draft');
        });
    });
});

describe('itcCheckTargets & Probes (0302 / G21 R1)', () => {
    it('passes when targets require no probes or probes pass', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    targets: [{ plugin: 'medium-pub', profile: 'article' }],
                }),
            );

            const code = await itcCheckTargets([workDir]);
            expect(code).toBe(0);
        });
    });
});

describe('itcSendTargets, Receipts & Recovery (0302 / G21 R3, R4)', () => {
    it('creates valid receipts and excludes unverified URLs from publicUrlVerified', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-pub-01',
                    live: false,
                    targets: [
                        {
                            plugin: 'fake-pub',
                            profile: 'article',
                            mode: 'draft',
                            variant: 'en-article',
                            payloadPath: '4-publish/content.json',
                        },
                    ],
                    fanout: [],
                }),
            );

            // Seed fake fanout result indicating success with draft URL
            writeFileSync(
                join(publishDir, 'fanout-result.fake-pub.json'),
                JSON.stringify({
                    ok: true,
                    summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                    targets: [
                        {
                            target: 'fake-pub',
                            ok: true,
                            status: 'published',
                            url: 'https://example.com/draft/123',
                            durationMs: 150,
                            metadata: {},
                        },
                    ],
                }),
            );

            await itcSendTargets([workDir]);

            const receiptPath = join(publishDir, 'receipts/fake-pub.json');
            expect(existsSync(receiptPath)).toBe(true);

            const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
            expect(ItcReceiptSchema.safeParse(receipt).success).toBe(true);
            expect(receipt.status).toBe('succeeded');
            expect(receipt.effect).toBe('confirmed');
            // Draft mode URLs must not be marked verified public
            expect(receipt.publicUrlVerified).toBe(false);
        });
    });

    it('retries only effect: none failures and skips confirmed successes or uncertain failures in retry mode', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });

            // Seed prior receipts: one success, one effect:none, one uncertain
            writeFileSync(
                join(receiptsDir, 'pub-success.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-rec',
                    planDigest: 'd1',
                    payloadDigest: 'd2',
                    plugin: 'pub-success',
                    profile: 'article',
                    mode: 'draft',
                    attemptId: 'attempt-1',
                    status: 'succeeded',
                    effect: 'confirmed',
                    publicUrlVerified: false,
                }),
            );
            writeFileSync(
                join(receiptsDir, 'pub-safe-fail.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-rec',
                    planDigest: 'd1',
                    payloadDigest: 'd2',
                    plugin: 'pub-safe-fail',
                    profile: 'article',
                    mode: 'draft',
                    attemptId: 'attempt-1',
                    status: 'failed',
                    effect: 'none',
                    publicUrlVerified: false,
                }),
            );
            writeFileSync(
                join(receiptsDir, 'pub-uncertain.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-rec',
                    planDigest: 'd1',
                    payloadDigest: 'd2',
                    plugin: 'pub-uncertain',
                    profile: 'article',
                    mode: 'draft',
                    attemptId: 'attempt-1',
                    status: 'uncertain',
                    effect: 'unknown',
                    publicUrlVerified: false,
                }),
            );

            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'run-rec',
                    targets: [
                        { plugin: 'pub-success', profile: 'article', mode: 'draft' },
                        { plugin: 'pub-safe-fail', profile: 'article', mode: 'draft' },
                        { plugin: 'pub-uncertain', profile: 'article', mode: 'draft' },
                    ],
                }),
            );

            // Execute retry
            await itcSendTargets([workDir, '--retry']);

            // Safe fail receipt should be updated with attemptId: retry-1
            const safeReceipt = JSON.parse(readFileSync(join(receiptsDir, 'pub-safe-fail.json'), 'utf-8'));
            expect(safeReceipt.attemptId).toBe('retry-1');

            // Success and uncertain receipts remain untouched from attempt-1
            const successReceipt = JSON.parse(readFileSync(join(receiptsDir, 'pub-success.json'), 'utf-8'));
            expect(successReceipt.attemptId).toBe('attempt-1');

            const uncertainReceipt = JSON.parse(readFileSync(join(receiptsDir, 'pub-uncertain.json'), 'utf-8'));
            expect(uncertainReceipt.attemptId).toBe('attempt-1');
        });
    });
});

describe('itcReconcileReceipts & Exact Target Audit (0302 / G21 R5)', () => {
    it('fails loud naming missing receipts when an expected target has no receipt', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(join(publishDir, 'receipts'), { recursive: true });

            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    targets: [{ plugin: 'expected-pub', profile: 'article' }],
                }),
            );

            const code = await itcReconcileReceipts([workDir]);
            expect(code).toBe(1);
        });
    });
});

describe('itcExportSeo (0302 / G21 R7, R16)', () => {
    it('mode off writes not-assessed status with empty pages', async () => {
        await withTempDir(async (workDir) => {
            const code = await itcExportSeo([workDir, 'off']);
            expect(code).toBe(0);

            const pub = JSON.parse(readFileSync(join(workDir, 'seo/published-pages.json'), 'utf-8'));
            expect(pub.status).toBe('not-assessed');
            expect(pub.pages).toHaveLength(0);
        });
    });

    it('mode handoff exports only confirmed live publicUrlVerified URLs', async () => {
        await withTempDir(async (workDir) => {
            const receiptsDir = join(workDir, '4-publish/receipts');
            mkdirSync(receiptsDir, { recursive: true });

            // Verified live public page
            writeFileSync(
                join(receiptsDir, 'live-pub.json'),
                JSON.stringify({
                    plugin: 'live-pub',
                    mode: 'live',
                    status: 'succeeded',
                    effect: 'confirmed',
                    publicUrlVerified: true,
                    url: 'https://example.com/live/page-1',
                }),
            );

            // Draft page with URL (should be excluded)
            writeFileSync(
                join(receiptsDir, 'draft-pub.json'),
                JSON.stringify({
                    plugin: 'draft-pub',
                    mode: 'draft',
                    status: 'succeeded',
                    effect: 'confirmed',
                    publicUrlVerified: false,
                    url: 'https://example.com/draft/page-2',
                }),
            );

            const code = await itcExportSeo([workDir, 'handoff']);
            expect(code).toBe(0);

            const published = JSON.parse(readFileSync(join(workDir, 'seo/published-pages.json'), 'utf-8'));
            expect(published.status).toBe('assessed');
            expect(published.pages).toEqual([{ plugin: 'live-pub', url: 'https://example.com/live/page-1' }]);
        });
    });
});

describe('itcReportSummary (0302 / G21 R5)', () => {
    it('produces report.json and report.md preserving legacy outcome and revisions fields', async () => {
        await withTempDir(async (workDir) => {
            const code = await itcReportSummary([workDir, '2']);
            expect(code).toBe(0);

            const repPath = join(workDir, '5-report/report.json');
            expect(existsSync(repPath)).toBe(true);
            const rep = JSON.parse(readFileSync(repPath, 'utf-8'));
            expect(rep.outcome).toBe('done');
            expect(rep.verdict).toBe('PASS');
            expect(rep.maxRevisions).toBe(2);

            const mdPath = join(workDir, '5-report/report.md');
            expect(readFileSync(mdPath, 'utf-8')).toContain('ITC Publication Run Report');
        });
    });
});
