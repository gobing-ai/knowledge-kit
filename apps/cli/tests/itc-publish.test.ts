import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeProcessExecutor, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';
import {
    ItcReceiptSchema,
    itcAuthorVerdict,
    itcCheckTargets,
    itcExportSeo,
    itcMaterializePlan,
    itcReconcileReceipts,
    itcReportSummary,
    itcSendTargets,
} from '../src/itc-publish';
import { silenceOutputPerTest } from './capture';

// Stage stdout is the workflow protocol and stderr is operator diagnostics; neither is this
// suite's subject, so the seam's default targets are silenced for every test here.
silenceOutputPerTest();

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-pub-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function seedReceipt(receiptsDir: string, plugin: string, fields: Record<string, unknown>): void {
    writeFileSync(
        join(receiptsDir, `${plugin}.json`),
        JSON.stringify({
            schemaVersion: 1,
            parentRunId: 'run-rec',
            planDigest: 'd1',
            payloadDigest: 'd2',
            plugin,
            profile: 'article',
            mode: 'draft',
            attemptId: 'attempt-1',
            ...fields,
        }),
    );
}

// The frozen options snapshot is the only source of the run id a receipt binds to.
function seedRun(workDir: string, parentRunId: string): void {
    writeFileSync(join(workDir, 'itc-options.json'), JSON.stringify({ parentRunId }));
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
            // Isolation: no payload inherits a mode switch another planned profile declares.
            expect(qiitaPayload.metadata).not.toHaveProperty('operation');
            expect(qiitaPayload.metadata).not.toHaveProperty('publishStatus');
            expect(wechatPayload.metadata).not.toHaveProperty('private');
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

    it('refuses with exit 1 when a target channel probe fails', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({ schemaVersion: 1, targets: [{ plugin: 'juejin-pub', profile: 'article' }] }),
            );
            const probed: string[][] = [];
            class FailingProbe extends NodeProcessExecutor {
                override async run(options: ProcessOptions): Promise<ProcessResult> {
                    probed.push(options.args ?? []);
                    return {
                        command: options.command,
                        args: options.args ?? [],
                        exitCode: 1,
                        stdout: '',
                        stderr: '',
                        durationMs: 0,
                    } as ProcessResult;
                }
            }

            const code = await itcCheckTargets([workDir], undefined, new FailingProbe());
            expect(code).toBe(1);
            expect(probed).toHaveLength(1);
            expect(probed[0]?.[1]).toBe('check');
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

            seedRun(workDir, 'run-pub-01');
            await itcSendTargets([workDir]);

            const receiptPath = join(publishDir, 'receipts/fake-pub.json');
            expect(existsSync(receiptPath)).toBe(true);

            const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
            expect(ItcReceiptSchema.safeParse(receipt).success).toBe(true);
            expect(receipt.status).toBe('succeeded');
            // The receipt binds to the real run, not a placeholder id.
            expect(receipt.parentRunId).toBe('run-pub-01');
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

            seedRun(workDir, 'run-rec');
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
    it('re-dispatches the safe failure on retry instead of re-reading the first attempt aggregate', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            seedReceipt(receiptsDir, 'pub-ok', { status: 'succeeded', effect: 'confirmed' });
            seedReceipt(receiptsDir, 'pub-safe', { status: 'failed', effect: 'none' });
            seedReceipt(receiptsDir, 'pub-unknown', { status: 'uncertain', effect: 'unknown' });
            // The first attempt's failed aggregate is still on disk.
            writeFileSync(
                join(publishDir, 'fanout-result.pub-safe.json'),
                JSON.stringify({ targets: [{ target: 'pub-safe', ok: false, status: 'failed' }] }),
            );
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    targets: ['pub-ok', 'pub-safe', 'pub-unknown'].map((plugin) => ({
                        plugin,
                        profile: 'article',
                        mode: 'draft',
                    })),
                }),
            );

            const dispatched: string[] = [];
            const dispatch = async (argv: string[]): Promise<number> => {
                const target = argv[argv.indexOf('--target') + 1] ?? '';
                dispatched.push(target);
                writeFileSync(
                    argv[argv.indexOf('--out') + 1] ?? '',
                    JSON.stringify({ targets: [{ target, ok: true, status: 'published' }] }),
                );
                return 0;
            };
            seedRun(workDir, 'run-rec');
            expect(await itcSendTargets([workDir, '--retry'], undefined, dispatch)).toBe(0);

            expect(dispatched).toEqual(['pub-safe']);
            const safe = JSON.parse(readFileSync(join(receiptsDir, 'pub-safe.json'), 'utf-8'));
            expect(safe.attemptId).toBe('retry-1');
            expect(safe.status).toBe('succeeded');
        });
    });

    it('re-dispatches a failed attempt instead of reusing the stale aggregate', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    targets: [{ plugin: 'pub-fix', profile: 'article', mode: 'draft' }],
                }),
            );
            // Prior attempt failed and left both its receipt and its failure aggregate on disk.
            seedReceipt(receiptsDir, 'pub-fix', { status: 'uncertain', effect: 'unknown' });
            writeFileSync(
                join(publishDir, 'fanout-result.pub-fix.json'),
                JSON.stringify({ targets: [{ target: 'pub-fix', ok: false, status: 'failed', error: 'stale' }] }),
            );
            seedRun(workDir, 'run-rec');

            const dispatched: string[] = [];
            const dispatch = async (argv: string[]): Promise<number> => {
                const target = argv[argv.indexOf('--target') + 1] ?? '';
                dispatched.push(target);
                writeFileSync(
                    argv[argv.indexOf('--out') + 1] ?? '',
                    JSON.stringify({ targets: [{ target, ok: true, status: 'published' }] }),
                );
                return 0;
            };
            expect(await itcSendTargets([workDir], undefined, dispatch)).toBe(0);

            // Without deleting the stale aggregate, dispatch would never run and the old failure
            // would be re-read (dogfood 2026-10-17).
            expect(dispatched).toEqual(['pub-fix']);
            const receipt = JSON.parse(readFileSync(join(receiptsDir, 'pub-fix.json'), 'utf-8'));
            expect(receipt.status).toBe('succeeded');
        });
    });

    it('refuses to send without a frozen snapshot naming the run', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({ targets: [{ plugin: 'pub-a', profile: 'article', mode: 'draft' }] }),
            );
            const dispatched: string[][] = [];
            const dispatch = async (argv: string[]): Promise<number> => {
                dispatched.push(argv);
                return 0;
            };
            expect(await itcSendTargets([workDir], undefined, dispatch)).toBe(1);
            expect(dispatched).toEqual([]);
            expect(existsSync(join(publishDir, 'receipts/pub-a.json'))).toBe(false);
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
    it('settles nothing for a brief-driven run without a chosen source', async () => {
        await withTempDir(async (workDir) => {
            const receiptsDir = join(workDir, '4-publish/receipts');
            mkdirSync(receiptsDir, { recursive: true });
            seedReceipt(receiptsDir, 'pub-unknown', { status: 'uncertain', effect: 'unknown' });
            writeFileSync(
                join(workDir, '4-publish/publish-plan.json'),
                JSON.stringify({ schemaVersion: 1, targets: [{ plugin: 'pub-unknown', profile: 'article' }] }),
            );

            expect(await itcReconcileReceipts([workDir])).toBe(0);
            expect(existsSync(join(workDir, '.selection-reconcile.json'))).toBe(false);
        });
    });

    it('retains the chosen source selection under its own run and topic when an outcome is uncertain', async () => {
        await withTempDir(async (workDir) => {
            const receiptsDir = join(workDir, '4-publish/receipts');
            mkdirSync(receiptsDir, { recursive: true });
            seedReceipt(receiptsDir, 'pub-unknown', { status: 'uncertain', effect: 'unknown' });
            writeFileSync(
                join(workDir, '4-publish/publish-plan.json'),
                JSON.stringify({ schemaVersion: 1, targets: [{ plugin: 'pub-unknown', profile: 'article' }] }),
            );
            writeFileSync(
                join(workDir, 'chosen-source.json'),
                JSON.stringify({ schemaVersion: 1, parentRunId: 'run-42', topicProfile: 'rust-weekly', itemIds: [] }),
            );

            expect(await itcReconcileReceipts([workDir])).toBe(0);
            const retained = JSON.parse(readFileSync(join(workDir, '.selection-reconcile.json'), 'utf-8'));
            expect(retained.parentRunId).toBe('run-42');
            expect(retained.topicProfile).toBe('rust-weekly');
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
    it('reports a target contract failure for missing, extra and stale receipts', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            const planRaw = JSON.stringify({
                schemaVersion: 1,
                targets: [
                    { plugin: 'pub-a', profile: 'article' },
                    { plugin: 'pub-b', profile: 'article' },
                ],
            });
            writeFileSync(join(publishDir, 'publish-plan.json'), planRaw);
            const planDigest = createHash('sha256').update(planRaw).digest('hex');
            seedReceipt(receiptsDir, 'pub-a', { planDigest: 'other-plan', status: 'succeeded', effect: 'confirmed' });
            seedReceipt(receiptsDir, 'pub-extra', { planDigest, status: 'succeeded', effect: 'confirmed' });

            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const rep = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(rep.outcome).toBe('failed');
            expect(rep.targetContractFailure).toEqual({
                expected: ['pub-a', 'pub-b'],
                observed: ['pub-a', 'pub-extra'],
                stale: ['pub-a'],
            });
            expect(readFileSync(join(workDir, '5-report/report.md'), 'utf-8')).toContain('Target contract failure');
        });
    });

    it('reports done when every planned target has a current successful receipt', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            const planRaw = JSON.stringify({ schemaVersion: 1, targets: [{ plugin: 'pub-a', profile: 'article' }] });
            writeFileSync(join(publishDir, 'publish-plan.json'), planRaw);
            const planDigest = createHash('sha256').update(planRaw).digest('hex');
            seedReceipt(receiptsDir, 'pub-a', { planDigest, status: 'succeeded', effect: 'confirmed' });

            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const rep = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(rep.outcome).toBe('done');
            expect(rep.targetContractFailure).toBeUndefined();
        });
    });
});

/**
 * Task 0310 (G21 R5) — re-entering a failed publish tail stays bound to the run that froze the
 * snapshot. The tail run has its own fresh id, but `itc-options.json` still names the failed run,
 * so every receipt it writes carries that id and a target the failed run already published is not
 * dispatched a second time.
 */
describe('publish tail re-entry binding (0310 R5)', () => {
    it('binds new receipts to the frozen run, skips an already-succeeded target and reports PASS', async () => {
        await withTempDir(async (workDir) => {
            const publishDir = join(workDir, '4-publish');
            const receiptsDir = join(publishDir, 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            const failedRun = 'kk-itc-failed-0310';
            const planRaw = JSON.stringify({
                schemaVersion: 1,
                parentRunId: failedRun,
                live: false,
                targets: ['pub-sent', 'pub-pending'].map((plugin) => ({ plugin, profile: 'article', mode: 'draft' })),
            });
            writeFileSync(join(publishDir, 'publish-plan.json'), planRaw);
            // The failed run got this far: its receipt is current for the frozen plan.
            seedReceipt(receiptsDir, 'pub-sent', {
                parentRunId: failedRun,
                planDigest: createHash('sha256').update(planRaw).digest('hex'),
                status: 'succeeded',
                effect: 'confirmed',
            });
            seedRun(workDir, failedRun);

            const dispatched: string[] = [];
            const dispatch = async (argv: string[]): Promise<number> => {
                const target = argv[argv.indexOf('--target') + 1] ?? '';
                dispatched.push(target);
                writeFileSync(
                    argv[argv.indexOf('--out') + 1] ?? '',
                    JSON.stringify({ targets: [{ target, ok: true, status: 'published' }] }),
                );
                return 0;
            };
            expect(await itcSendTargets([workDir], undefined, dispatch)).toBe(0);

            // Nothing is published twice, and the new receipt belongs to the failed run.
            expect(dispatched).toEqual(['pub-pending']);
            const pending = JSON.parse(readFileSync(join(receiptsDir, 'pub-pending.json'), 'utf-8'));
            expect(pending.parentRunId).toBe(failedRun);
            expect(pending.status).toBe('succeeded');

            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const rep = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(rep.outcome).toBe('done');
            expect(rep.verdict).toBe('PASS');
            expect(rep.targetContractFailure).toBeUndefined();
        });
    });

    // The HIGH/MEDIUM/LOW enum is enforced where the verdict is written (`itc-author-verdict`);
    // re-entry only reports the frozen verdict, so every accepted level must still report a pass.
    it.each(['HIGH', 'MEDIUM', 'LOW'])('reports a frozen PASS + %s verdict as PASS after re-entry', async (level) => {
        await withTempDir(async (workDir) => {
            writeFileSync(join(workDir, '.itc-verdict.json'), JSON.stringify({ verdict: 'PASS', confidence: level }));
            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const rep = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(rep.verdict).toBe('PASS');
            expect(rep.outcome).toBe('done');
        });
    });

    it('reports a frozen non-PASS verdict as failed, not as a pass', async () => {
        await withTempDir(async (workDir) => {
            writeFileSync(join(workDir, '.itc-verdict.json'), JSON.stringify({ verdict: 'FAIL', confidence: 'HIGH' }));
            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const rep = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(rep.verdict).toBe('FAIL');
            expect(rep.outcome).toBe('failed');
        });
    });
});

describe('itcMaterializePlan from the frozen snapshot (0300 R1 / 0301 R1)', () => {
    // A package root the preset resolver discovers from cwd: one preset plus a topic profile
    // that suggests it, so the snapshot's preset sources resolve without the shipped catalog.
    function seedPackageRoot(root: string): void {
        mkdirSync(join(root, 'plugins/kk/publish-presets'), { recursive: true });
        mkdirSync(join(root, 'plugins/kk/decisions/extract'), { recursive: true });
        writeFileSync(
            join(root, 'plugins/kk/publish-presets/demo-preset.json'),
            JSON.stringify({
                schemaVersion: 1,
                name: 'demo-preset',
                targets: [{ plugin: 'qiita-pub', profile: 'article' }],
            }),
        );
        writeFileSync(
            join(root, 'plugins/kk/decisions/extract/demo-topic.yaml'),
            'topic: demo-topic\nwhere:\n  kk-item-category: { in: [ai-news] }\npublishPreset: demo-preset\n',
        );
    }
    async function materialize(
        snapshot: Record<string, unknown>,
        spurValue?: string,
    ): Promise<{ code: number; plan: { origin: string; targets: Array<{ plugin: string }> }; workDir: string }> {
        const root = mkdtempSync(join(tmpdir(), 'kk-itc-mat-'));
        const priorCwd = process.cwd();
        const priorSpur = process.env.SPUR_BIN;
        try {
            seedPackageRoot(root);
            const workDir = join(root, 'ws');
            mkdirSync(workDir, { recursive: true });
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Title\n\nBody text.');
            writeFileSync(
                join(workDir, 'itc-options.json'),
                JSON.stringify({
                    parentRunId: 'run-m',
                    publishTargets: '',
                    sourceLocale: 'en',
                    publishLive: false,
                    publishPreset: null,
                    publishPresetSource: null,
                    topicProfile: null,
                    launchProjectRoot: root,
                    ...snapshot,
                }),
            );
            if (spurValue !== undefined) {
                const bin = join(root, 'spur-stub');
                writeFileSync(bin, `#!/bin/sh\nprintf '{"value":"${spurValue}","reason":"stub"}'\n`);
                chmodSync(bin, 0o755);
                process.env.SPUR_BIN = bin;
            }
            process.chdir(root);
            const code = await itcMaterializePlan([workDir]);
            const plan = JSON.parse(readFileSync(join(workDir, '4-publish/publish-plan.json'), 'utf-8'));
            return { code, plan, workDir };
        } finally {
            process.chdir(priorCwd);
            if (priorSpur === undefined) delete process.env.SPUR_BIN;
            else process.env.SPUR_BIN = priorSpur;
            rmSync(root, { recursive: true, force: true });
        }
    }

    it('a launch preset plans as explicit-preset, ignoring stale positional args', async () => {
        const { code, plan } = await materialize({ publishPreset: 'demo-preset', publishPresetSource: 'launch' });
        expect(code).toBe(0);
        expect(plan.origin).toBe('explicit-preset');
        expect(plan.targets.map((t) => t.plugin)).toEqual(['qiita-pub']);
    });

    it('a config preset plans as workflow-config', async () => {
        const { plan } = await materialize({ publishPreset: 'demo-preset', publishPresetSource: 'config' });
        expect(plan.origin).toBe('workflow-config');
        expect(plan.targets.map((t) => t.plugin)).toEqual(['qiita-pub']);
    });

    it('an accepted topic-profile suggestion plans its preset', async () => {
        const { plan } = await materialize({ topicProfile: 'demo-topic' }, 'suggested');
        expect(plan.origin).toBe('topic-profile');
        expect(plan.targets.map((t) => t.plugin)).toEqual(['qiita-pub']);
    });

    it('a declined or failed topic-profile decision plans nothing rather than guessing', async () => {
        const { code, plan } = await materialize({ topicProfile: 'demo-topic' }, 'banana');
        expect(code).toBe(0);
        expect(plan.origin).toBe('none');
        expect(plan.targets).toEqual([]);
    });

    it('an unknown preset fails loud', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-itc-mat-bad-'));
        try {
            writeFileSync(join(root, '3-draft-draft-article.md'), '# T\n\nBody.');
            writeFileSync(
                join(root, 'itc-options.json'),
                JSON.stringify({ parentRunId: 'r', publishPreset: 'no-such', publishPresetSource: 'launch' }),
            );
            expect(await itcMaterializePlan([root])).toBe(1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('itc publish stage edge contracts (0302)', () => {
    it('every stage refuses a missing work_dir with exit 1', async () => {
        for (const stage of [
            itcMaterializePlan,
            itcCheckTargets,
            itcSendTargets,
            itcReconcileReceipts,
            itcExportSeo,
            itcReportSummary,
            itcAuthorVerdict,
        ]) {
            expect(await stage([])).toBe(1);
        }
    });

    it('materialize refuses a missing draft, a draft without H1, and an empty body', async () => {
        await withTempDir(async (workDir) => {
            expect(await itcMaterializePlan([workDir])).toBe(1);
            writeFileSync(join(workDir, '3-draft-draft-article.md'), 'no heading here');
            expect(await itcMaterializePlan([workDir])).toBe(1);
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Title\n\n   ');
            expect(await itcMaterializePlan([workDir])).toBe(1);
        });
    });

    it('legacy positional materialize carries brief frontmatter, references and the outline into content.json', async () => {
        await withTempDir(async (workDir) => {
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Title\n\nBody.');
            mkdirSync(join(workDir, '2-outline'), { recursive: true });
            writeFileSync(join(workDir, '2-outline/outline-approved.md'), '- a\n');
            writeFileSync(
                join(workDir, 'brief.md'),
                '---\ntags: [ai, \'llm\']\nkeywords: rag, agents\ndescription: "A short one"\n---\n# Brief\n',
            );
            writeFileSync(
                join(workDir, 'docs.json'),
                JSON.stringify([{ id: 'd1', title: 'Doc', sourceUri: 'https://x.test/d1' }, { id: 7 }]),
            );
            expect(await itcMaterializePlan([workDir, '', 'en', 'false'])).toBe(0);
            const content = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8'));
            expect(content.outline).toBe('- a');
            expect(content.references).toEqual([{ url: 'https://x.test/d1', title: 'Doc', cite: 'd1' }, {}]);
            expect(content.metadata).toEqual({
                published: false,
                tags: ['ai', 'llm'],
                keywords: ['rag', 'agents'],
                description: 'A short one',
            });
            const plan = JSON.parse(readFileSync(join(workDir, '4-publish/publish-plan.json'), 'utf-8'));
            expect(plan.targets).toEqual([]);

            // Malformed docs.json and a brief without frontmatter are ignored, not fatal.
            writeFileSync(join(workDir, 'docs.json'), '{not json');
            writeFileSync(join(workDir, 'brief.md'), '# Brief only\n');
            expect(await itcMaterializePlan([workDir, '', 'en', 'false'])).toBe(0);
            const again = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8'));
            expect(again.references).toBeUndefined();
            expect(again.metadata).toEqual({ published: false });
        });
    });

    it('reconcile fails loud on a corrupt receipt', async () => {
        await withTempDir(async (workDir) => {
            const receiptsDir = join(workDir, '4-publish/receipts');
            mkdirSync(receiptsDir, { recursive: true });
            writeFileSync(
                join(workDir, '4-publish/publish-plan.json'),
                JSON.stringify({ targets: [{ plugin: 'qiita-pub', mode: 'draft' }] }),
            );
            writeFileSync(join(receiptsDir, 'qiita-pub.json'), '{corrupt');
            expect(await itcReconcileReceipts([workDir])).toBe(1);
        });
    });

    it('report marks a malformed verdict and a non-succeeded receipt as failed, counting revisions', async () => {
        await withTempDir(async (workDir) => {
            const receiptsDir = join(workDir, '4-publish/receipts');
            mkdirSync(receiptsDir, { recursive: true });
            writeFileSync(join(workDir, '.itc-verdict.json'), '{bad');
            writeFileSync(join(workDir, '.auto-revise-count'), '2\n');
            writeFileSync(join(receiptsDir, 'junk.json'), '{bad');
            seedReceipt(receiptsDir, 'qiita-pub', { status: 'failed', effect: 'none' });
            expect(await itcReportSummary([workDir, '2'])).toBe(0);
            const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(report.outcome).toBe('failed');
            expect(report.revisions).toBe(2);
        });
    });
});

describe('itcAuthorVerdict dispositions (0301 R2)', () => {
    async function disposition(workDir: string, env: Record<string, string | undefined> = {}): Promise<string> {
        const prior = { auto: process.env.KK_ITC_AUTO, max: process.env.KK_ITC_MAX_REVISIONS };
        process.env.KK_ITC_AUTO = env.auto;
        process.env.KK_ITC_MAX_REVISIONS = env.max;
        if (env.auto === undefined) delete process.env.KK_ITC_AUTO;
        if (env.max === undefined) delete process.env.KK_ITC_MAX_REVISIONS;
        try {
            expect(await itcAuthorVerdict([workDir])).toBe(0);
            return readFileSync(join(workDir, '.itc/disposition.txt'), 'utf-8').trim();
        } finally {
            if (prior.auto === undefined) delete process.env.KK_ITC_AUTO;
            else process.env.KK_ITC_AUTO = prior.auto;
            if (prior.max === undefined) delete process.env.KK_ITC_MAX_REVISIONS;
            else process.env.KK_ITC_MAX_REVISIONS = prior.max;
        }
    }
    const verdict = (workDir: string, v: unknown): void =>
        writeFileSync(join(workDir, '.itc-verdict.json'), typeof v === 'string' ? v : JSON.stringify(v));

    it('finishes without a verdict or on PASS with an in-enum confidence', async () => {
        await withTempDir(async (workDir) => {
            expect(await disposition(workDir)).toBe('finish');
            verdict(workDir, { verdict: 'PASS', confidence: 'LOW' });
            expect(await disposition(workDir)).toBe('finish');
        });
    });

    it('fails on FAIL, an out-of-enum confidence, or an unparseable verdict', async () => {
        await withTempDir(async (workDir) => {
            verdict(workDir, { verdict: 'PASS', confidence: 'SURE' });
            expect(await disposition(workDir)).toBe('fail');
            verdict(workDir, { verdict: 'FAIL', confidence: 'HIGH' });
            expect(await disposition(workDir)).toBe('fail');
            verdict(workDir, '{oops');
            expect(await disposition(workDir)).toBe('fail');
        });
    });

    it('bounds revisions: manual up to 3, auto up to KK_ITC_MAX_REVISIONS', async () => {
        await withTempDir(async (workDir) => {
            verdict(workDir, { verdict: 'NEEDS_REVISION', confidence: 'HIGH' });
            expect(await disposition(workDir)).toBe('revise');
            writeFileSync(join(workDir, '.revise-count'), '3');
            expect(await disposition(workDir)).toBe('fail');
            expect(await disposition(workDir, { auto: 'true', max: '1' })).toBe('autorevise');
            writeFileSync(join(workDir, '.auto-revise-count'), '1');
            expect(await disposition(workDir, { auto: 'true', max: '1' })).toBe('fail');
            writeFileSync(join(workDir, '.auto-revise-count'), 'NaN-ish');
            expect(await disposition(workDir, { auto: 'true' })).toBe('autorevise');
        });
    });
});
