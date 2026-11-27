import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newsEditorialCommit } from '../scripts/daily-stages.ts';
import {
    type AlignmentProposal,
    buildSnapshot,
    commitAlignment,
    dropReselectedJudgments,
    type JudgmentLedger,
    LEDGER_LOCK_NAME,
    type LockPort,
    NULL_LOCK,
    parseConclusion,
    readPreamble,
    readSnapshot,
    reconcileLedger,
    renderConclusion,
    validateProposal,
} from '../scripts/news-editorial-ledger';

let stageLog: { mockRestore(): void };
let stageError: { mockRestore(): void };
beforeEach(() => {
    stageLog = spyOn(console, 'log').mockImplementation(() => {});
    stageError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    stageLog.mockRestore();
    stageError.mockRestore();
});

/**
 * 0384 R10 — the daily editorial judgment ledger's retry and concurrency protections. Each case
 * replays what the workflow does after final selection: propose, commit, re-run.
 */
const NOW = '2026-11-18T06:00:00.000Z';
const RUN_DATE = '20261118';

function proposal(overrides: Partial<AlignmentProposal> = {}): AlignmentProposal {
    return {
        version: 1,
        judgments: [
            {
                id: 'j-openai-20261118',
                selectedId: 'doc-openai',
                storyKey: 'story-openai',
                date: RUN_DATE,
                fact: 'OpenAI 开源了某模型权重。',
                attribution: 'OpenAI 官方博客',
                comment: '开源权重把推理成本压到自建集群可承受的区间。',
                evidence: { url: 'https://openai.com/blog/x', checkedAt: NOW },
                supersedes: null,
            },
        ],
        ...overrides,
    };
}

describe('news-editorial-ledger (0384 R10)', () => {
    let root: string;
    let ledgerPath: string;
    let snapshotPath: string;
    let receiptPath: string;
    const selected = new Set(['doc-openai', 'doc-anthropic']);

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-judgment-ledger-'));
        const works = join(root, '.works', 'kk-news-generate');
        mkdirSync(works, { recursive: true });
        mkdirSync(join(root, 'run', '20-editorial'), { recursive: true });
        ledgerPath = join(works, 'conclusion.md');
        snapshotPath = join(root, 'run', '20-editorial', 'judgment-snapshot.json');
        receiptPath = join(root, 'run', '20-editorial', 'judgment-commit-receipt.json');
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    function commit(p: AlignmentProposal, lock: LockPort = NULL_LOCK, now = NOW) {
        return commitAlignment({
            ledgerPath,
            snapshotPath,
            receiptPath,
            proposal: p,
            selectedIds: selected,
            runDate: RUN_DATE,
            runId: 'run-1',
            now,
            lock,
        });
    }

    it('first initialization is distinguishable and freezes a run snapshot', async () => {
        const receipt = await commit(proposal());
        expect(receipt.status).toBe('applied');
        expect(receipt.initialized).toBe(true);
        expect(receipt.backupPath).toBeNull();
        expect(receipt.appended).toEqual(['j-openai-20261118']);

        const text = readFileSync(ledgerPath, 'utf-8');
        expect(text).toContain('被取代记录');
        expect(text).toContain('https://openai.com/blog/x');
        const parsed = parseConclusion(text);
        expect(parsed.error).toBeNull();
        expect(parsed.ledger?.judgments).toHaveLength(1);

        const snapshot = readSnapshot(snapshotPath);
        expect(snapshot?.runDate).toBe(RUN_DATE);
        expect(snapshot?.judgments.map((entry) => entry.id)).toEqual(['j-openai-20261118']);
        expect(receipt.ledgerDigestAfter).toBe(snapshot?.ledgerDigest);
        expect(JSON.parse(readFileSync(receiptPath, 'utf-8')).status).toBe('applied');
    });

    it('replaying the same proposal appends nothing and reuses the snapshot', async () => {
        const first = await commit(proposal());
        const ledgerBefore = readFileSync(ledgerPath, 'utf-8');
        const second = await commit(proposal());

        expect(second.status).toBe('no-op');
        expect(second.appended).toEqual([]);
        expect(second.snapshotReused).toBe(true);
        expect(readFileSync(ledgerPath, 'utf-8')).toBe(ledgerBefore);
        expect(second.ledgerDigestBefore).toBe(first.ledgerDigestAfter);
        expect(second.ledgerDigestAfter).toBe(first.ledgerDigestAfter);
    });

    it('an empty proposal with no snapshot yet freezes one from the committed ledger', async () => {
        await commit(proposal());
        rmSync(snapshotPath);
        const receipt = await commit({ version: 1, judgments: [] });
        expect(receipt.status).toBe('no-op');
        expect(receipt.snapshotReused).toBe(false);
        expect(readSnapshot(snapshotPath)?.judgments).toHaveLength(1);
    });

    it('a conflicting rewrite of a confirmed judgment is refused and nothing is written', async () => {
        await commit(proposal());
        const ledgerBefore = readFileSync(ledgerPath, 'utf-8');
        const conflicting = proposal();
        conflicting.judgments[0].fact = '改写后的事实。';

        const receipt = await commit(conflicting);
        expect(receipt.status).toBe('conflict');
        expect(receipt.errors.join(' ')).toContain('conflict');
        expect(readFileSync(ledgerPath, 'utf-8')).toBe(ledgerBefore);
        expect(receipt.recovery?.action).toContain('superseding');
    });

    it('a concurrent writer that commits between read and lock makes the CAS lose cleanly', async () => {
        await commit(proposal());
        const concurrent = proposal({
            judgments: [
                {
                    ...proposal().judgments[0],
                    id: 'j-anthropic-20261118',
                    selectedId: 'doc-anthropic',
                    fact: 'Anthropic 发布了新的对齐报告。',
                    evidence: { url: 'https://anthropic.com/x', checkedAt: NOW },
                },
            ],
        });
        // The other run wins the race while this one is preparing its proposal.
        const racing: LockPort = {
            acquire: async () => {
                await commit(concurrent);
                return true;
            },
            release: async () => {},
        };
        const receipt = await commit(proposal({ judgments: [] }), racing);
        expect(receipt.status).toBe('conflict');
        expect(receipt.reason).toContain('CAS mismatch');
        expect(receipt.lock).toBe('held');
        const ledger = parseConclusion(readFileSync(ledgerPath, 'utf-8')).ledger;
        expect(ledger?.judgments.map((entry) => entry.id).sort()).toEqual([
            'j-anthropic-20261118',
            'j-openai-20261118',
        ]);
    });

    it('a contended lock reports the claim instead of writing', async () => {
        const busy: LockPort = {
            acquire: async (name) => {
                expect(name).toBe(LEDGER_LOCK_NAME);
                return false;
            },
            release: async () => {
                throw new Error('must not release a claim it never held');
            },
        };
        const receipt = await commit(proposal(), busy);
        expect(receipt.status).toBe('conflict');
        expect(receipt.lock).toBe('contended');
        expect(existsSync(ledgerPath)).toBe(false);
    });

    it('corrupt history is an explicit stop: never rebuilt, backup path reported', async () => {
        writeFileSync(
            ledgerPath,
            '# conclusion\n\n<!-- kk:judgment-ledger:begin -->\n```json\n{not json}\n```\n<!-- kk:judgment-ledger:end -->\n',
        );
        const corruptBefore = readFileSync(ledgerPath, 'utf-8');
        const receipt = await commit(proposal());

        expect(receipt.status).toBe('stop');
        expect(receipt.errors[0]).toContain('not valid JSON');
        expect(receipt.recovery?.backupPath).toBe(`${ledgerPath}.corrupt`);
        expect(readFileSync(ledgerPath, 'utf-8')).toBe(corruptBefore);
        expect(readFileSync(`${ledgerPath}.corrupt`, 'utf-8')).toBe(corruptBefore);
        expect(existsSync(snapshotPath)).toBe(false);
    });

    it('an unavailable ledger (unreadable path) is a stop, not a silent re-initialization', async () => {
        mkdirSync(join(ledgerPath, 'nested'), { recursive: true });
        const receipt = await commit(proposal());
        expect(receipt.status).toBe('stop');
        expect(receipt.errors).toContain('ledger-unreadable');
        expect(receipt.recovery).not.toBeNull();
    });

    it('an unknown selected id fails validation before anything is committed', async () => {
        const unknown = proposal();
        unknown.judgments[0].selectedId = 'doc-unknown';
        const receipt = await commit(unknown);
        expect(receipt.status).toBe('stop');
        expect(receipt.errors.join(' ')).toContain('is not in this run');
        expect(existsSync(ledgerPath)).toBe(false);
    });

    it('a superseding judgment keeps the retired record and emits a correction id', async () => {
        await commit(proposal());
        const correction = proposal({
            preamble: '上一期关于开源权重的说法有误，特此更正并致歉。',
            judgments: [
                {
                    id: 'j-openai-fix-20261119',
                    selectedId: 'doc-openai',
                    date: '20261119',
                    fact: 'OpenAI 并未开源该模型权重（更正）。',
                    attribution: 'OpenAI 官方博客（更新）',
                    comment: '上期说该模型开源有误，向听众致歉；以官方更新为准。',
                    evidence: { url: 'https://openai.com/blog/x-update', checkedAt: NOW },
                    supersedes: 'j-openai-20261118',
                },
            ],
        });
        const receipt = await commit(correction, NULL_LOCK, '2026-11-19T06:00:00.000Z');
        expect(receipt.status).toBe('applied');
        expect(receipt.superseded).toEqual(['j-openai-20261118']);
        expect(receipt.correctionIds).toHaveLength(1);

        const ledger = parseConclusion(readFileSync(ledgerPath, 'utf-8')).ledger as JudgmentLedger;
        const retired = ledger.judgments.find((entry) => entry.id === 'j-openai-20261118');
        expect(retired?.status).toBe('superseded');
        expect(retired?.supersededBy).toBe('j-openai-fix-20261119');

        const snapshot = readSnapshot(snapshotPath);
        expect(snapshot?.judgments.map((entry) => entry.id)).toEqual(['j-openai-fix-20261119']);
        expect(snapshot?.corrections[0]).toMatchObject({
            supersedes: 'j-openai-20261118',
            judgmentId: 'j-openai-fix-20261119',
        });
        expect(snapshot?.corrections[0].correctionId).toStartWith('corr-');

        // 0384 P3 (architecture): the snapshot must let a consumer *name* what was wrong without
        // reading the ledger — the retired record travels verbatim, plus the renderable sentence.
        expect(snapshot?.superseded).toHaveLength(1);
        expect(snapshot?.corrections[0].retired).toEqual({
            id: 'j-openai-20261118',
            date: RUN_DATE,
            fact: 'OpenAI 开源了某模型权重。',
            attribution: 'OpenAI 官方博客',
            comment: '开源权重把推理成本压到自建集群可承受的区间。',
            supersededBy: 'j-openai-fix-20261119',
        });
        expect(snapshot?.corrections[0].wording).toContain('致歉');
        expect(snapshot?.corrections[0].text).toContain('OpenAI 开源了某模型权重。');
        expect(snapshot?.corrections[0].text).toContain('上期说该模型开源有误');
        // The proposal's own preamble is the acknowledgement the draft owes: it is written to the
        // ledger *and* frozen in the snapshot, so the draft never has to read the live ledger.
        expect(snapshot?.preamble).toBe('上一期关于开源权重的说法有误，特此更正并致歉。');
        expect(readFileSync(ledgerPath, 'utf-8')).toContain('上一期关于开源权重的说法有误');

        // A subsequent run with no new supersession must not re-emit yesterday's correction or preamble.
        const nextDaySnapshotPath = join(root, 'run-next', '20-editorial', 'judgment-snapshot.json');
        const nextDayReceiptPath = join(root, 'run-next', '20-editorial', 'judgment-commit-receipt.json');
        const nextDayReceipt = await commitAlignment({
            ledgerPath,
            snapshotPath: nextDaySnapshotPath,
            receiptPath: nextDayReceiptPath,
            proposal: { version: 1, judgments: [] },
            selectedIds: new Set(['doc-openai']),
            runDate: '20261120',
            runId: 'run-20261120',
            now: '2026-11-20T06:00:00.000Z',
        });
        expect(nextDayReceipt.correctionIds).toEqual([]);
        const nextDaySnapshot = readSnapshot(nextDaySnapshotPath);
        expect(nextDaySnapshot?.corrections).toEqual([]);
        expect(nextDaySnapshot?.preamble).toBeNull();
    });

    it('superseding an already superseded record is refused', async () => {
        await commit(proposal());
        const first = proposal({
            judgments: [
                {
                    ...proposal().judgments[0],
                    id: 'j-openai-fix-a',
                    fact: '更正 A。',
                    evidence: { url: 'https://openai.com/a', checkedAt: NOW },
                    supersedes: 'j-openai-20261118',
                },
            ],
        });
        expect((await commit(first, NULL_LOCK, '2026-11-19T06:00:00.000Z')).status).toBe('applied');
        const second = proposal({
            judgments: [
                {
                    ...proposal().judgments[0],
                    id: 'j-openai-fix-b',
                    fact: '更正 B。',
                    evidence: { url: 'https://openai.com/b', checkedAt: NOW },
                    supersedes: 'j-openai-20261118',
                },
            ],
        });
        const receipt = await commit(second, NULL_LOCK, '2026-11-20T06:00:00.000Z');
        expect(receipt.status).toBe('conflict');
        expect(receipt.reason).toContain('already superseded');
    });

    it('a new judgment in the same run chains the snapshot; a foreign revision is refused', async () => {
        await commit(proposal());
        const firstSnapshot = readSnapshot(snapshotPath);
        const next = proposal({
            judgments: [
                {
                    ...proposal().judgments[0],
                    id: 'j-anthropic-late',
                    selectedId: 'doc-anthropic',
                    fact: '后补判断。',
                    evidence: { url: 'https://example.com/late', checkedAt: NOW },
                },
            ],
        });
        const applied = await commit(next);
        expect(applied.status).toBe('applied');
        expect(readSnapshot(snapshotPath)?.judgments).toHaveLength(2);
        expect(readSnapshot(snapshotPath)?.ledgerDigest).not.toBe(firstSnapshot?.ledgerDigest);

        // A snapshot frozen from a revision that is not the ledger on disk cannot be rewritten.
        const foreign = { ...(readSnapshot(snapshotPath) as object), ledgerDigest: 'other-revision' };
        writeFileSync(snapshotPath, `${JSON.stringify(foreign, null, 2)}\n`);
        const snapshotBefore = readFileSync(snapshotPath, 'utf-8');
        const third = proposal({
            judgments: [
                {
                    ...proposal().judgments[0],
                    id: 'j-third',
                    fact: '第三条判断。',
                    evidence: { url: 'https://example.com/third', checkedAt: NOW },
                },
            ],
        });
        const receipt = await commit(third);
        expect(receipt.status).toBe('conflict');
        expect(receipt.reason).toContain('already froze a snapshot');
        expect(readFileSync(snapshotPath, 'utf-8')).toBe(snapshotBefore);
    });

    it('render/parse round-trip keeps the editorial preamble and the retired records', () => {
        const snapshotInput = buildSnapshot(
            {
                version: 1,
                updatedAt: NOW,
                judgments: [
                    {
                        id: 'j1',
                        selectedId: 'doc-openai',
                        date: RUN_DATE,
                        fact: '事实一',
                        attribution: '来源一',
                        comment: '评论一',
                        evidence: { url: 'https://example.com/1', checkedAt: NOW },
                        supersedes: null,
                        status: 'superseded',
                        supersededBy: 'j2',
                        contentDigest: 'x',
                    },
                    {
                        id: 'j2',
                        selectedId: 'doc-openai',
                        date: RUN_DATE,
                        fact: '事实二',
                        attribution: '来源二',
                        comment: '上期说法有误，向听众致歉。',
                        evidence: { url: 'https://example.com/2', checkedAt: NOW },
                        supersedes: 'j1',
                        status: 'pending',
                        supersededBy: null,
                        contentDigest: 'y',
                    },
                ],
            },
            RUN_DATE,
            NOW,
            'digest',
            'proposal',
            '  上一期把 A 说成了 B，特此更正并致歉。  ',
        );
        expect(snapshotInput.preamble).toBe('上一期把 A 说成了 B，特此更正并致歉。');
        expect(snapshotInput.judgments).toHaveLength(1);
        expect(snapshotInput.corrections[0].wording).toContain('致歉');
        expect(snapshotInput.superseded.map((entry) => entry.id)).toEqual(['j1']);
        expect(snapshotInput.superseded[0].fact).toBe('事实一');
        expect(snapshotInput.corrections[0].retired.fact).toBe('事实一');

        const text = renderConclusion(
            { version: 1, updatedAt: NOW, judgments: snapshotInput.judgments },
            '上一期把 A 说成了 B，特此更正并致歉。',
        );
        expect(readPreamble(text)).toBe('上一期把 A 说成了 B，特此更正并致歉。');
        expect(text).toContain('被取代记录（0，保留不改写）');
        expect(parseConclusion(text).ledger?.judgments).toHaveLength(1);
    });

    it('validateProposal names every missing field and bad evidence url', () => {
        const broken: AlignmentProposal = {
            version: 1,
            judgments: [
                {
                    id: '',
                    selectedId: 'doc-openai',
                    date: '',
                    fact: '',
                    attribution: '',
                    comment: '',
                    evidence: { url: 'ftp://nope', checkedAt: 'not-a-date' },
                },
            ],
        };
        const { errors } = validateProposal(broken, selected);
        expect(errors.join('\n')).toContain('missing a stable id');
        expect(errors.join('\n')).toContain('needs an http(s) url');
        expect(errors.join('\n')).toContain('needs an ISO checkedAt');
        expect(validateProposal({ version: 1 } as AlignmentProposal, selected).errors).toEqual([
            'proposal has no judgments array',
        ]);
    });

    it('parseConclusion tolerates an absent block and reports unbalanced markers', () => {
        expect(parseConclusion('# just prose\n')).toEqual({ ledger: null, error: null });
        expect(parseConclusion('<!-- kk:judgment-ledger:begin -->\n').error).toContain('unbalanced');
        expect(
            parseConclusion('<!-- kk:judgment-ledger:begin -->\nno fence\n<!-- kk:judgment-ledger:end -->\n').error,
        ).toContain('no ```json fence');
        expect(
            parseConclusion(
                '<!-- kk:judgment-ledger:begin -->\n```json\n{"version":1}\n```\n<!-- kk:judgment-ledger:end -->\n',
            ).error,
        ).toContain('no judgments array');
    });

    it('reconcileLedger leaves the ledger untouched when the proposal is a pure replay', () => {
        const first = reconcileLedger({ version: 1, updatedAt: NOW, judgments: [] }, proposal(), selected, NOW);
        const second = reconcileLedger(first.ledger, proposal(), selected, NOW);
        expect(second.status).toBe('no-op');
        expect(second.ledger.judgments).toHaveLength(1);
    });
});

/**
 * 0384 R4/R10 — the stage body the workflow node runs (`kk stage news-editorial-commit`), end to
 * end on a fixture workspace: the commit, then the same stage again = no-op reuse. The refusal
 * paths exit non-zero, so they run as a subprocess exactly as the YAML node does.
 */
describe('news-editorial-commit stage (0384)', () => {
    let root: string;
    const RUN_DATE = '20261118';
    const previousOffline = process.env.KK_EDITORIAL_COMMIT_OFFLINE;

    function workspace(): { workDir: string; proposalPath: string; ledgerPath: string } {
        const workDir = join(root, '.works', 'kk-news-generate', 'kk-news-generate-20261118-1');
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        writeFileSync(
            join(workDir, '21-plan', `${RUN_DATE}_03_plan_plan.json`),
            JSON.stringify([
                { id: 'doc-openai', title: '开源权重' },
                { id: 'doc-anthropic', title: '新模型' },
            ]),
        );
        return {
            workDir,
            proposalPath: join(workDir, '21-plan', `${RUN_DATE}_judgment-proposal.json`),
            ledgerPath: join(root, '.works', 'kk-news-generate', 'conclusion.md'),
        };
    }

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-editorial-commit-'));
        process.env.KK_EDITORIAL_COMMIT_OFFLINE = '1';
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
        if (previousOffline === undefined) delete process.env.KK_EDITORIAL_COMMIT_OFFLINE;
        else process.env.KK_EDITORIAL_COMMIT_OFFLINE = previousOffline;
    });

    it('commits a proposal, then re-running the stage is a no-op reuse', async () => {
        const { workDir, proposalPath, ledgerPath } = workspace();
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        writeFileSync(proposalPath, JSON.stringify(proposal()));

        await newsEditorialCommit([workDir, RUN_DATE, 'run-stage']);
        const receiptPath = join(workDir, '21-plan', `${RUN_DATE}_judgment-commit-receipt.json`);
        const first = JSON.parse(readFileSync(receiptPath, 'utf-8'));
        expect(first.status).toBe('applied');
        expect(first.initialized).toBe(true);
        expect(first.lock).toBe('none');
        expect(first.ledgerPath).toBe(ledgerPath);
        const ledgerAfterFirst = readFileSync(ledgerPath, 'utf-8');
        expect(parseConclusion(ledgerAfterFirst).ledger?.judgments).toHaveLength(1);

        await newsEditorialCommit([workDir, RUN_DATE, 'run-stage']);
        const second = JSON.parse(readFileSync(receiptPath, 'utf-8'));
        expect(second.status).toBe('no-op');
        expect(second.snapshotReused).toBe(true);
        expect(second.appended).toEqual([]);
        expect(readFileSync(ledgerPath, 'utf-8')).toBe(ledgerAfterFirst);
        const snapshot = readSnapshot(join(workDir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`));
        expect(snapshot?.runDate).toBe(RUN_DATE);
        expect(snapshot?.judgments.map((entry) => entry.id)).toEqual(['j-openai-20261118']);
    });

    it('an absent proposal freezes the committed ledger as this run snapshot', async () => {
        const { workDir, ledgerPath } = workspace();
        await newsEditorialCommit([workDir, RUN_DATE, 'run-stage']);
        const receipt = JSON.parse(
            readFileSync(join(workDir, '21-plan', `${RUN_DATE}_judgment-commit-receipt.json`), 'utf-8'),
        );
        expect(receipt.status).toBe('no-op');
        expect(receipt.snapshotReused).toBe(false);
        expect(readSnapshot(join(workDir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`))?.runDate).toBe(RUN_DATE);
        // Nothing was proposed, so nothing was appended: the ledger file stays absent (a first
        // commitment of zero judgments is not a reason to create one) and the snapshot is the
        // run's legal evidence.
        expect(existsSync(ledgerPath)).toBe(false);
    });

    function runStage(workDir: string): { status: number | null; stdout: string; stderr: string } {
        const runner = join(import.meta.dir, '..', 'scripts', 'kk-workflow-stages.ts');
        return spawnSync('bun', [runner, 'news-editorial-commit', workDir, RUN_DATE, 'run-stage'], {
            encoding: 'utf-8',
            env: { ...process.env, KK_EDITORIAL_COMMIT_OFFLINE: '1' },
        });
    }

    function readReceipt(workDir: string): Record<string, unknown> {
        return JSON.parse(readFileSync(join(workDir, '21-plan', `${RUN_DATE}_judgment-commit-receipt.json`), 'utf-8'));
    }

    it('a judgment whose id the settled plan dropped is recorded and dropped, the rest still commits', () => {
        const { workDir, proposalPath, ledgerPath } = workspace();
        writeFileSync(
            proposalPath,
            JSON.stringify({
                version: 1,
                judgments: [
                    { ...proposal().judgments[0], id: 'j-ghost-20261118', selectedId: 'doc-dropped' },
                    { ...proposal().judgments[0] },
                ],
            }),
        );
        const child = runStage(workDir);
        // Reselection alone is never a hard stop: the repair/fallback row must not fail the run,
        // and the drop is printed (loud) rather than silently swallowed.
        expect(child.status).toBe(0);
        expect(child.stderr).toContain('dropped 1 judgment(s)');
        expect(child.stderr).toContain('j-ghost-20261118=> doc-dropped');
        expect(child.stderr).not.toContain('editorial-commit: stop');

        const receipt = readReceipt(workDir);
        expect(receipt.status).toBe('applied');
        expect(receipt.droppedByReselection).toEqual(['j-ghost-20261118=> doc-dropped']);
        expect(receipt.appended).toEqual(['j-openai-20261118']);
        const ledger = parseConclusion(readFileSync(ledgerPath, 'utf-8')).ledger;
        expect(ledger?.judgments.map((entry) => entry.id)).toEqual(['j-openai-20261118']);
        const snapshot = readSnapshot(join(workDir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`));
        expect(snapshot?.judgments.map((entry) => entry.id)).toEqual(['j-openai-20261118']);
    });

    it('a proposal whose every judgment was reselected away behaves like the empty proposal', () => {
        const { workDir, proposalPath, ledgerPath } = workspace();
        writeFileSync(
            proposalPath,
            JSON.stringify({
                version: 1,
                judgments: [{ ...proposal().judgments[0], id: 'j-ghost-20261118', selectedId: 'doc-dropped' }],
            }),
        );
        const child = runStage(workDir);
        expect(child.status).toBe(0);
        const receipt = readReceipt(workDir);
        expect(receipt.status).toBe('no-op');
        expect(receipt.droppedByReselection).toEqual(['j-ghost-20261118=> doc-dropped']);
        expect(receipt.appended).toEqual([]);
        // Nothing committable: the ledger is never invented, the run's legal snapshot is written.
        expect(existsSync(ledgerPath)).toBe(false);
        expect(readSnapshot(join(workDir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`))?.runDate).toBe(RUN_DATE);
    });

    it("the ledger API itself still refuses an unknown selected id (the drop is the stage's job)", async () => {
        const { workDir } = workspace();
        const receipt = await commitAlignment({
            ledgerPath: join(root, '.works', 'kk-news-generate', 'conclusion.md'),
            snapshotPath: join(workDir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`),
            receiptPath: join(workDir, '21-plan', `${RUN_DATE}_judgment-commit-receipt.json`),
            proposal: proposal({ judgments: [{ ...proposal().judgments[0], selectedId: 'doc-dropped' }] }),
            selectedIds: new Set(['doc-openai']),
            runDate: RUN_DATE,
            runId: 'run-stage',
            now: NOW,
        });
        expect(receipt.status).toBe('stop');
        expect(receipt.errors.join(' ')).toContain('is not in this run');
        expect(receipt.droppedByReselection).toEqual([]);
    });

    it('dropReselectedJudgments keeps the judgments the settled plan still carries', () => {
        const result = dropReselectedJudgments(
            proposal({
                judgments: [
                    { ...proposal().judgments[0], id: 'j-kept' },
                    { ...proposal().judgments[0], id: 'j-gone', selectedId: 'doc-gone' },
                ],
            }),
            new Set(['doc-openai']),
        );
        expect(result.proposal.judgments.map((entry) => entry.id)).toEqual(['j-kept']);
        expect(result.dropped).toEqual(['j-gone=> doc-gone']);
        expect(result.droppedIds).toEqual(['j-gone']);
    });
});
