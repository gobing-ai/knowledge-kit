import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem, type ProcessExecutor, type ProcessOptions } from '@gobing-ai/ts-runtime';
import { type ItcDecisionRequest, itcDecision } from '../src/itc-decision';
import { runItcStage } from '../src/itc-stage';
import { silenceOutputPerTest } from './capture';

// Stage stdout is the workflow protocol and stderr is operator diagnostics; neither is this
// suite's subject, so the seam's default targets are silenced for every test here.
silenceOutputPerTest();

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

describe('itcDecision catalog call (0301 / G21 R1)', () => {
    // Fake `spur decision run`: records the argv and the compacted evidence it was handed.
    function fakeExecutor(
        reply: { exitCode?: number; stdout?: string; stderr?: string } | Error,
        seen: { args: string[]; evidence: string[] },
    ): ProcessExecutor {
        return {
            run: async (opts: ProcessOptions) => {
                seen.args = opts.args ?? [];
                seen.args.forEach((a, i) => {
                    if (seen.args[i - 1] === '--evidence') seen.evidence.push(readFileSync(a, 'utf-8'));
                });
                if (reply instanceof Error) throw reply;
                return { exitCode: reply.exitCode ?? 0, stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' };
            },
        } as unknown as ProcessExecutor;
    }

    function request(dir: string, decisionId: ItcDecisionRequest['decisionId'] = 'kk-itc-topic-choice') {
        return {
            parentRunId: 'run-cat-01',
            decisionId,
            candidates: [
                { id: 'a', title: 'Topic A' },
                { id: 'b', description: 'Topic B' },
            ],
            outPath: join(dir, 'decision.json'),
        } satisfies ItcDecisionRequest;
    }

    it('serves an in-set model pick with compacted evidence, then removes the evidence temp files', async () => {
        await withTempDir(async (dir) => {
            const ev = join(dir, 'ev.txt');
            writeFileSync(ev, 'x'.repeat(3000));
            const seen = { args: [] as string[], evidence: [] as string[] };
            const out = JSON.stringify({ value: ' b ', reason: 'better fit', maker: 'm1', confidence: 0.8 });
            const res = await itcDecision(
                { ...request(dir), evidenceFiles: [ev, join(dir, 'missing.txt')], maker: 'm1' },
                createNodeFileSystem(),
                fakeExecutor({ stdout: out }, seen),
            );
            expect(res).toMatchObject({
                value: 'b',
                source: 'model',
                reason: 'better fit',
                maker: 'm1',
                selected: true,
            });
            expect(res.confidence).toBe(0.8);
            expect(res.candidateDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(seen.args).toContain('candidates=a: Topic A; b: Topic B');
            expect(seen.args.slice(-3)).toEqual(['--maker', 'm1', '--json']);
            expect(seen.evidence).toHaveLength(1);
            expect(JSON.parse(seen.evidence[0] ?? '{}')).toMatchObject({
                originalLength: 3000,
                retainedLength: 1800,
                truncated: true,
            });
            expect(existsSync(join(dir, 'decision.json.evidence-0.json'))).toBe(false);
            expect(JSON.parse(readFileSync(join(dir, 'decision.json'), 'utf-8')).value).toBe('b');
        });
    });

    it('defers an out-of-set model pick instead of guessing', async () => {
        await withTempDir(async (dir) => {
            const seen = { args: [] as string[], evidence: [] as string[] };
            const res = await itcDecision(
                request(dir, 'kk-itc-outline-choice'),
                createNodeFileSystem(),
                fakeExecutor({ stdout: JSON.stringify({ value: 'z' }) }, seen),
            );
            expect(res).toMatchObject({ value: 'defer', source: 'default', selected: false });
            expect(res.reason).toContain('"z" is not among valid candidates');
            expect(seen.args.some((a) => a.startsWith('options='))).toBe(true);
        });
    });

    it('falls back to none for a preset when the catalog fails, exits nonzero, or prints bad JSON', async () => {
        await withTempDir(async (dir) => {
            const seen = { args: [] as string[], evidence: [] as string[] };
            const fs = createNodeFileSystem();
            const preset = request(dir, 'kk-itc-preset-choice');
            const bad = await itcDecision(preset, fs, fakeExecutor({ stdout: '{nope' }, seen));
            expect(bad).toMatchObject({ value: 'none', source: 'default', selected: false });
            expect(bad.reason).toContain('failed to parse decision json');
            expect(seen.args.some((a) => a.startsWith('suggestion='))).toBe(true);

            const exited = await itcDecision(preset, fs, fakeExecutor({ exitCode: 2, stderr: 'boom' }, seen));
            expect(exited.reason).toBe('spur decision run exited with code 2: boom');

            const thrown = await itcDecision(preset, fs, fakeExecutor(new Error('ENOENT'), seen));
            expect(thrown.value).toBe('none');
            expect(thrown.reason).toBe('failed to spawn spur decision run: ENOENT');
        });
    });
});
