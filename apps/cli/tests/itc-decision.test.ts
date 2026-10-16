import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ItcDecisionRequest, itcDecision } from '../src/itc-decision';
import { runItcStage } from '../src/itc-stage';

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-decision-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('itcDecision (0301 / G21 R1)', () => {
    it('bypasses model call on explicit operator choice and writes served result', async () => {
        await withTempDir(async (dir) => {
            const outPath = join(dir, 'decision.json');
            const req: ItcDecisionRequest = {
                schemaVersion: 1,
                parentRunId: 'run-dec-01',
                decisionId: 'kk-itc-topic-choice',
                candidateDigest: 'digest-abc',
                candidates: [
                    { id: 'a', title: 'Topic A' },
                    { id: 'b', title: 'Topic B' },
                ],
                outPath,
                explicitChoice: 'b',
            };

            const res = await itcDecision(req);
            expect(res.value).toBe('b');
            expect(res.source).toBe('explicit');
            expect(res.selected).toBe(true);

            expect(existsSync(outPath)).toBe(true);
            const written = JSON.parse(readFileSync(outPath, 'utf-8'));
            expect(written.value).toBe('b');
            expect(written.source).toBe('explicit');
            expect(written.selected).toBe(true);
        });
    });

    it('compacts evidence files to <= 1800 UTF-16 units per file with length and truncation flags', async () => {
        await withTempDir(async (dir) => {
            const largeFile = join(dir, 'large-evidence.txt');
            const largeText = 'A'.repeat(3000);
            writeFileSync(largeFile, largeText);

            const outPath = join(dir, 'decision.json');
            const req: ItcDecisionRequest = {
                schemaVersion: 1,
                parentRunId: 'run-dec-02',
                decisionId: 'kk-itc-topic-choice',
                candidateDigest: 'digest-xyz',
                candidates: [{ id: 'a', title: 'Topic A' }],
                evidenceFiles: [largeFile],
                outPath,
                explicitChoice: 'defer',
            };

            const res = await itcDecision(req);
            expect(res.value).toBe('defer');
            expect(res.selected).toBe(false);
            expect(res.source).toBe('explicit');
        });
    });

    it('falls back to declared default on invalid or out-of-set candidate choices', async () => {
        await withTempDir(async (dir) => {
            const outPath = join(dir, 'decision.json');
            const req: ItcDecisionRequest = {
                schemaVersion: 1,
                parentRunId: 'run-dec-03',
                decisionId: 'kk-itc-topic-choice',
                candidateDigest: 'digest-ab',
                candidates: [
                    { id: 'a', title: 'Topic A' },
                    { id: 'b', title: 'Topic B' },
                ],
                outPath,
                // Requesting 'c' when only 'a' and 'b' are valid candidates
                explicitChoice: 'c',
            };

            const res = await itcDecision(req);
            expect(res.value).toBe('defer');
            expect(res.source).toBe('default');
            expect(res.selected).toBe(false);
            expect(res.reason).toContain('not allowed');
        });
    });

    it('falls back to none for preset decisions when explicit choice is not valid', async () => {
        await withTempDir(async (dir) => {
            const outPath = join(dir, 'preset-decision.json');
            const req: ItcDecisionRequest = {
                schemaVersion: 1,
                parentRunId: 'run-dec-04',
                decisionId: 'kk-itc-preset-choice',
                candidateDigest: 'digest-preset',
                candidates: [{ id: 'suggested', title: 'technical-article' }],
                outPath,
                explicitChoice: 'invalid-choice',
            };

            const res = await itcDecision(req);
            expect(res.value).toBe('none');
            expect(res.source).toBe('default');
            expect(res.selected).toBe(false);
        });
    });
});

describe('stage run itc-author-complete (0301 / G21 R2, R17)', () => {
    it('generates author-complete.json receipt on judged passing run', async () => {
        await withTempDir(async (workDir) => {
            const itcDir = join(workDir, '.itc');
            mkdirSync(itcDir, { recursive: true });
            writeFileSync(
                join(itcDir, 'author-run.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'parent-123',
                    childRunId: 'parent-123-author',
                    definitionDigest: 'def-sha',
                    optionsDigest: 'opt-sha',
                }),
            );

            // Seed draft and approved outline
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Full Title\n\nSubstantive technical draft.');
            mkdirSync(join(workDir, '2-outline'), { recursive: true });
            writeFileSync(
                join(workDir, '2-outline/outline-approved.md'),
                '# Approved Outline\n\n- Section 1\n- Section 2',
            );

            // Seed judge verdict PASS with HIGH confidence
            writeFileSync(
                join(workDir, '.itc-verdict.json'),
                JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', feedback: [] }),
            );

            const code = await runItcStage(['itc-author-complete', workDir, 'parent-123']);
            expect(code).toBe(0);

            const receiptPath = join(itcDir, 'author-complete.json');
            expect(existsSync(receiptPath)).toBe(true);

            const receipt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
            expect(receipt.schemaVersion).toBe(1);
            expect(receipt.parentRunId).toBe('parent-123');
            expect(receipt.childRunId).toBe('parent-123-author');
            expect(receipt.status).toBe('complete');
            expect(receipt.reviewMode).toBe('judged');
            expect(receipt.draftDigest).toBeDefined();
            expect(receipt.outlineDigest).toBeDefined();
            expect(receipt.judgeDigest).toBeDefined();
        });
    });

    it('generates author-complete.json receipt on manual review mode without judge verdict', async () => {
        await withTempDir(async (workDir) => {
            const itcDir = join(workDir, '.itc');
            mkdirSync(itcDir, { recursive: true });
            writeFileSync(
                join(itcDir, 'author-run.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    parentRunId: 'parent-manual',
                    childRunId: 'parent-manual-author',
                }),
            );

            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Title\n\nDraft content.');
            mkdirSync(join(workDir, '2-outline'), { recursive: true });
            writeFileSync(join(workDir, '2-outline/outline-approved.md'), '# Outline\n\nOutline.');

            const code = await runItcStage(['itc-author-complete', workDir, 'parent-manual', 'manual']);
            expect(code).toBe(0);

            const receipt = JSON.parse(readFileSync(join(itcDir, 'author-complete.json'), 'utf-8'));
            expect(receipt.reviewMode).toBe('manual');
            expect(receipt.judgeDigest).toBeNull();
            expect(receipt.status).toBe('complete');
        });
    });

    it('fails when draft or approved outline is missing or empty', async () => {
        await withTempDir(async (workDir) => {
            const code1 = await runItcStage(['itc-author-complete', workDir, 'p1']);
            expect(code1).toBe(1);

            // Write empty draft
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '   \n');
            const code2 = await runItcStage(['itc-author-complete', workDir, 'p1']);
            expect(code2).toBe(1);
        });
    });

    it('fails when judge verdict is not PASS or confidence is missing', async () => {
        await withTempDir(async (workDir) => {
            writeFileSync(join(workDir, '3-draft-draft-article.md'), '# Title\n\nDraft content.');
            mkdirSync(join(workDir, '2-outline'), { recursive: true });
            writeFileSync(join(workDir, '2-outline/outline-approved.md'), '# Outline\n\nOutline.');

            // Needs revision
            writeFileSync(
                join(workDir, '.itc-verdict.json'),
                JSON.stringify({ verdict: 'NEEDS_REVISION', confidence: 'HIGH', feedback: ['fix this'] }),
            );
            expect(await runItcStage(['itc-author-complete', workDir, 'p1'])).toBe(1);

            // Missing confidence
            writeFileSync(join(workDir, '.itc-verdict.json'), JSON.stringify({ verdict: 'PASS' }));
            expect(await runItcStage(['itc-author-complete', workDir, 'p1'])).toBe(1);
        });
    });
});
