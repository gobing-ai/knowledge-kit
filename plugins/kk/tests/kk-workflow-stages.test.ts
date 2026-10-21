import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0189 F1 — the topic-boundary QC gate (R2/R3) and the article handoff it feeds (R1/R4).
 *
 * `kk-workflow-stages.ts` is a spawned stage runner, not an in-process library: importing its
 * ~2300-line body into the test process registers it with coverage and fails the bunfig.toml
 * threshold (same reasoning as apps/cli/tests/kk-workflow-stages.test.ts dedupPlanByTitle). Every
 * call here goes out of process — pure-function probes via `bun -e`, stage chains via the real
 * runner with a `kk` stub that forwards plugin executions to this checkout (fully offline).
 */
const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const specPath = join(import.meta.dir, '../scripts/topic-boundary.json');
const pluginsRoot = join(import.meta.dir, '../../generations');

const STAMP = '20260916';
/** The smallest VoiceScript the shipped validator accepts — the safety stages re-validate drafts. */
const MINIMAL_VOICESCRIPT = 'title: T\nsegments:\n  - text: 大家好，欢迎收听。\n';

// daily-qc-content stage args after <work_dir> <run_date>: pluginsPath '', qcCategories '',
// QC floors 1/1/1/1 (deterministic; see qcDoc).
const qcStageArgs = ['', '', '1', '1', '1', '1'] as const;

interface BoundaryExclusion {
    id: string;
    title: string;
    rule: string;
    reason: string;
    matched: string;
}

interface BoundaryResult {
    kept: { id?: unknown }[];
    excluded: BoundaryExclusion[];
}

/** applyTopicBoundary probe: the pure (docs, runDate, spec) function, called against the real spec data. */
function applyBoundary(docs: unknown[], runDate: string, tz = 'UTC'): BoundaryResult {
    const script = [
        `import { readFileSync } from 'node:fs';`,
        `import { applyTopicBoundary } from ${JSON.stringify(runner)};`,
        `const spec = JSON.parse(readFileSync(${JSON.stringify(specPath)}, 'utf-8'));`,
        `console.log(JSON.stringify(applyTopicBoundary(${JSON.stringify(docs)}, ${JSON.stringify(runDate)}, spec)));`,
    ].join('\n');
    const result = spawnSync('bun', ['-e', script], { encoding: 'utf-8', env: { ...process.env, TZ: tz } });
    if (result.status !== 0) throw new Error(`applyTopicBoundary failed: ${result.stderr}`);
    return JSON.parse(result.stdout) as BoundaryResult;
}

/** A `kk` stub forwarding `executor run <plugin>` to the real plugin entrypoint in this checkout. */
function fakeKk(dir: string): Record<string, string> {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const path = join(bin, 'kk');
    writeFileSync(
        path,
        [
            '#!/usr/bin/env bun',
            "const { spawnSync } = require('node:child_process');",
            'const args = process.argv.slice(2);', // executor run <plugin> --in X --out Y
            `const entry = ${JSON.stringify(pluginsRoot)} + '/' + args[2] + '/src/index.ts';`,
            'const result = spawnSync("bun", [entry, ...args.slice(3)], { stdio: "inherit" });',
            'process.exit(result.status ?? 1);',
        ].join('\n'),
    );
    chmodSync(path, 0o755);
    return { PATH: `${bin}:${process.env.PATH ?? ''}` };
}

function runStage(args: string[], env: Record<string, string> = {}) {
    return spawnSync('bun', [runner, ...args], { encoding: 'utf-8', env: { ...process.env, ...env } });
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

/**
 * Annotated doc fixture: `metadata.category` + `metadata.scores` are what the plan-mode annotate
 * pass (LLM, stubbed away offline) normally writes; the filter rejects unannotated docs fail-loud.
 * Scores 2/3/2/1 pass even the default floors, so the QC filter is deterministic and ONLY the
 * topic boundary decides admission.
 */
function qcDoc(id: string, title: string, publishedAt = '2026-09-16T00:20:39.000Z'): Record<string, unknown> {
    return {
        id,
        title,
        body: 'x'.repeat(348),
        sourceUri: `https://example.com/${id}`,
        mediaType: 'text/markdown',
        metadata: {
            source: 'rss',
            sourceName: 'example.com',
            publishedAt,
            category: 'ai-news',
            scores: { quality: 2, importance: 3, urgency: 2, impact: 1 },
        },
    };
}

describe('topic boundary — applyTopicBoundary (task 0189 R2/R3/F1)', () => {
    it('excludes a zh political-mainline doc with its rule, reason and matched keyword', () => {
        const { kept, excluded } = applyBoundary(
            [qcDoc('zh-1', '台海局势牵动芯片供应链'), qcDoc('ok-1', '浏览器端零依赖语音实现')],
            STAMP,
        );
        expect(kept.map((doc) => doc.id)).toEqual(['ok-1']);
        expect(excluded).toEqual([
            {
                id: 'zh-1',
                title: '台海局势牵动芯片供应链',
                rule: 'political-diplomatic',
                reason: expect.stringContaining('政治/外交主线'),
                matched: '台海',
            },
        ]);
    });

    it('excludes a headline-capitalized English keyword (F2: matching is case-insensitive)', () => {
        const { kept, excluded } = applyBoundary([qcDoc('en-1', 'Antitrust suit targets search ad stack')], STAMP);
        expect(kept).toEqual([]);
        expect(excluded).toEqual([
            expect.objectContaining({ id: 'en-1', rule: 'policy-dispute', matched: 'antitrust' }),
        ]);
    });

    it('excludes a doc published after the run date as inadmissible date-conflict evidence (R3)', () => {
        const { kept, excluded } = applyBoundary(
            [
                qcDoc('future-1', '前沿模型训练暂停报告', '2026-09-17T08:00:00.000Z'),
                qcDoc('past-1', '浏览器端零依赖语音实现', '2026-09-16T09:00:00.000Z'),
            ],
            STAMP,
        );
        expect(kept.map((doc) => doc.id)).toEqual(['past-1']);
        expect(excluded).toEqual([
            expect.objectContaining({ id: 'future-1', rule: 'date-conflict', matched: '2026-09-17T08:00:00.000Z' }),
        ]);
    });

    it('does not match an English keyword buried inside a longer word (patriot ≠ riot)', () => {
        const { kept, excluded } = applyBoundary(
            [qcDoc('fp-1', 'Model selection heuristics for agents'), qcDoc('fp-2', 'Patriot: a Rust tracing library')],
            STAMP,
        );
        expect(excluded).toEqual([]);
        expect(kept.map((doc) => doc.id)).toEqual(['fp-1', 'fp-2']);
    });

    it('still matches an English keyword at a word start, including plurals', () => {
        const { excluded } = applyBoundary([qcDoc('en-2', 'New tariffs hit GPU imports')], STAMP);
        expect(excluded).toEqual([expect.objectContaining({ id: 'en-2', rule: 'trade-controls', matched: 'tariff' })]);
    });

    it('judges date-conflict against the local run day, not UTC (a Pacific-evening item is not future-dated)', () => {
        // 2026-09-17T03:00Z is 20:00 on 2026-09-16 in Los Angeles — same local day as the run.
        const { kept, excluded } = applyBoundary(
            [qcDoc('evening-1', '浏览器端零依赖语音实现', '2026-09-17T03:00:00.000Z')],
            STAMP,
            'America/Los_Angeles',
        );
        expect(excluded).toEqual([]);
        expect(kept.map((doc) => doc.id)).toEqual(['evening-1']);
    });

    it('keeps nothing when every doc is excluded (zero-kept → done-no-content edge)', () => {
        const { kept, excluded } = applyBoundary(
            [qcDoc('zh-1', '台海局势再度紧张'), qcDoc('zh-2', '中美关系谈判重启')],
            STAMP,
        );
        expect(kept).toEqual([]);
        expect(excluded.map((entry) => entry.rule)).toEqual(['political-diplomatic', 'political-diplomatic']);
    });
});

describe('daily-qc-content stage — exclusions audit + idempotent rerun (task 0189 R2/F1)', () => {
    const exclusionsPath = (dir: string) => join(dir, '21-plan', `${STAMP}_04_quality-control-content_exclusions.json`);
    const candidatesPath = (dir: string) => join(dir, '21-plan', `${STAMP}_04_quality-control-content_candidates.json`);

    function setup(docs: Record<string, unknown>[]): string {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0189-qc-'));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(join(dir, '21-plan', `${STAMP}_03_plan_content.json`), JSON.stringify({ metadata: { docs } }));
        return dir;
    }

    // QC floors at 1 so the filter is deterministic (quality 1 from the 348-char body passes);
    // the docs are shaped so ONLY the topic boundary decides admission.
    const stage = (dir: string, env: Record<string, string>) =>
        runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], env);

    it('writes the exclusions audit {version, runDate, excluded, kept} and narrows candidates to kept docs', () => {
        const dir = setup([
            qcDoc('zh-1', '台海局势牵动芯片供应链'),
            qcDoc('future-1', '前沿模型训练暂停报告', '2026-09-17T08:00:00.000Z'),
            qcDoc('ok-1', '浏览器端零依赖语音实现'),
        ]);
        try {
            const result = stage(dir, fakeKk(dir));
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('topic-boundary: excluded 2 item(s)');
            const audit = readJson<{ version: number; runDate: string; excluded: BoundaryExclusion[]; kept: string[] }>(
                exclusionsPath(dir),
            );
            expect(audit.version).toBe(1);
            expect(audit.runDate).toBe(STAMP);
            expect(audit.excluded.map((entry) => [entry.id, entry.rule])).toEqual([
                ['zh-1', 'political-diplomatic'],
                ['future-1', 'date-conflict'],
            ]);
            expect(audit.kept).toEqual(['ok-1']);
            const candidates = readJson<{ metadata: { docs: { id: string }[] } }>(candidatesPath(dir));
            expect(candidates.metadata.docs.map((doc) => doc.id)).toEqual(['ok-1']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rerun is idempotent: cached candidates, boundary no-op, audit and candidates untouched', () => {
        const dir = setup([qcDoc('zh-1', '台海局势牵动芯片供应链'), qcDoc('ok-1', '浏览器端零依赖语音实现')]);
        try {
            expect(runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], fakeKk(dir)).status).toBe(0);
            const auditBefore = readFileSync(exclusionsPath(dir), 'utf-8');
            const candidatesBefore = readFileSync(candidatesPath(dir), 'utf-8');
            const rerun = runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], fakeKk(dir));
            expect(rerun.status).toBe(0);
            expect(rerun.stdout).toContain('candidates cached');
            // The already-filtered candidates carry no boundary hits → no new exclusion, no rewrite.
            expect(rerun.stdout).not.toContain('topic-boundary: excluded');
            expect(readFileSync(exclusionsPath(dir), 'utf-8')).toBe(auditBefore);
            expect(readFileSync(candidatesPath(dir), 'utf-8')).toBe(candidatesBefore);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('zero kept docs leaves candidates empty for the workflow done-no-content edge', () => {
        const dir = setup([qcDoc('zh-1', '台海局势再度紧张'), qcDoc('zh-2', '中美关系谈判重启')]);
        try {
            const result = runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], fakeKk(dir));
            expect(result.status).toBe(0);
            const candidates = readJson<{ metadata: { docs: unknown[] } }>(candidatesPath(dir));
            expect(candidates.metadata.docs).toEqual([]);
            const audit = readJson<{ kept: string[]; excluded: BoundaryExclusion[] }>(exclusionsPath(dir));
            expect(audit.kept).toEqual([]);
            expect(audit.excluded).toHaveLength(2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('daily-qc-content stage — cached-candidates title dedup (task 0250 R2/AC2)', () => {
    const candidatesPath = (dir: string) => join(dir, '21-plan', `${STAMP}_04_quality-control-content_candidates.json`);

    // The same near-duplicate pair apps/cli's dedup probe measures at 0.417 (threshold 0.4).
    // Both titles are technical, so the topic boundary stays a no-op and only the cache-path
    // dedup rewrite (daily-stages.ts:191-200) is under test.
    const geminiFirst = 'Google 发布 Gemini 3.8 Live 实时语音模型，Simon Willison 推出浏览器零依赖实现';
    const geminiSecond = 'Google 发布 Gemini 3.8 Live 与 3.8 Live Extended Thinking 实时语音模型';

    /** Pre-write the candidates file so the stage takes its cached path and only the dedup runs. */
    function setupCached(docs: Record<string, unknown>[]): string {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0250-qc-'));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(candidatesPath(dir), JSON.stringify({ metadata: { docs } }));
        return dir;
    }

    const stage = (dir: string, env: Record<string, string>) =>
        runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], env);

    it('drops a near-duplicate title from the cached candidates, rewrites the file, and names the id on stderr', () => {
        const dir = setupCached([qcDoc('keep-1', geminiFirst), qcDoc('dup-1', geminiSecond)]);
        try {
            const result = stage(dir, fakeKk(dir));
            expect(result.status).toBe(0);
            expect(result.stdout).toContain('candidates cached');
            const candidates = readJson<{ metadata: { docs: { id: string }[] } }>(candidatesPath(dir));
            expect(candidates.metadata.docs.map((doc) => doc.id)).toEqual(['keep-1']);
            expect(result.stderr).toContain('qc: dropped');
            expect(result.stderr).toContain('dup-1');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('leaves the candidates bytes unchanged across two runs when no title is a near-duplicate', () => {
        const dir = setupCached([qcDoc('a', '浏览器端零依赖语音实现'), qcDoc('b', '本地向量数据库基准测试方法')]);
        try {
            expect(stage(dir, fakeKk(dir)).status).toBe(0);
            const afterFirst = readFileSync(candidatesPath(dir), 'utf-8');
            const second = stage(dir, fakeKk(dir));
            expect(second.status).toBe(0);
            // daily-stages.ts:192 — dropped.length === 0 returns without a write.
            expect(second.stderr).not.toContain('qc: dropped');
            expect(readFileSync(candidatesPath(dir), 'utf-8')).toBe(afterFirst);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('offline generation → publish-payload E2E (task 0189 F4b)', () => {
    it('daily-qc-content → daily-article renders the publish payload from kept docs only', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0189-e2e-'));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        const docs = [qcDoc('zh-1', '台海局势牵动芯片供应链'), qcDoc('ok-1', '浏览器端零依赖语音实现')];
        writeFileSync(join(dir, '21-plan', `${STAMP}_03_plan_content.json`), JSON.stringify({ metadata: { docs } }));
        const env = fakeKk(dir);
        try {
            expect(runStage(['daily-qc-content', dir, STAMP, ...qcStageArgs], env).status).toBe(0);
            // plan-translate stand-in (the workflow's LLM state): the QC-narrowed candidates ARE
            // the plan — a same-order identity copy, exactly what plan-translate is prompted to
            // emit (kk-daily-ai-voice.yaml plan-translate → 03_plan_plan.json).
            const candidates = readJson<{ metadata: { docs: unknown[] } }>(
                join(dir, '21-plan', `${STAMP}_04_quality-control-content_candidates.json`),
            );
            writeFileSync(join(dir, '21-plan', `${STAMP}_03_plan_plan.json`), JSON.stringify(candidates.metadata.docs));
            expect(runStage(['daily-article', dir, STAMP, ''], env).status).toBe(0);
            const content = readJson<{
                title: string;
                body: string;
                metadata: { generator: string; doc_count: number; tags: string[]; date: string };
                references: { url: string; title: string; cite: string }[];
            }>(join(dir, '22-article', `${STAMP}_06_article_content.json`));
            // The publish payload: 每日AI乱炖 episode title, one kept item, mandatory ai-news + sub-category:ai-daily tags.
            expect(content.title).toBe('每日AI乱炖 · 2026-09-16');
            expect(content.metadata.generator).toBe('kk:daily-article');
            expect(content.metadata.doc_count).toBe(1);
            expect(content.metadata.tags).toEqual(['ai-news', 'sub-category:ai-daily']);
            expect(content.metadata.date).toBe('2026-09-16');
            expect(content.references).toEqual([
                { url: 'https://example.com/ok-1', title: '浏览器端零依赖语音实现', cite: 'ok-1' },
            ]);
            // Publish-payload capture quoted in .spur/run/0189/evidence/e2e-publish-payload.md.
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('regenerates content.json when only the article markdown survived', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-article-cache-'));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', `${STAMP}_03_plan_plan.json`),
            JSON.stringify([qcDoc('ok-1', '浏览器端零依赖语音实现')]),
        );
        const env = fakeKk(dir);
        const json = join(dir, '22-article', `${STAMP}_06_article_content.json`);
        const md = join(dir, '22-article', `${STAMP}_06_article_article.md`);
        try {
            expect(runStage(['daily-article', dir, STAMP, ''], env).status).toBe(0);
            expect(existsSync(json)).toBe(true);
            expect(existsSync(md)).toBe(true);

            // The half-cached state that starved publish-prep: the markdown is there, the json is
            // not. Caching on the markdown alone returned early and never regenerated it.
            rmSync(json);
            expect(runStage(['daily-article', dir, STAMP, ''], env).status).toBe(0);
            expect(existsSync(json)).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('content-safety verdict gate (task 0189 R10 / AC10)', () => {
    const OK_REPORT = { platforms: [{ platform: 'xiaoyuzhou', decision: 'OK', findings: [] }], escalate: false };
    const PASS_VERDICT = { verdict: 'PASS', rubric: 'compliance', score: 0.95, confidence: 'HIGH' };
    const at = (dir: string, name: string) => join(dir, '24-script', `${STAMP}_09_${name}`);
    /** Opening + one spoken item + closing — the smallest script the section splitter counts as 1. */
    const ONE_ITEM_SCRIPT = [
        'title: T',
        'segments:',
        '  - text: 开场。',
        '  - text: 只剩一条。',
        '    gap_ms: 1200',
        '  - text: 收尾。',
        '',
    ].join('\n');
    const TWO_ITEM_SCRIPT = [
        'title: T',
        'segments:',
        '  - text: 开场。',
        '  - text: 第一条事实。',
        '    gap_ms: 1200',
        '  - text: 第二条事实。',
        '    gap_ms: 1200',
        '  - text: 收尾。',
        '',
    ].join('\n');

    /** Drafts + prep; the two agent.run outputs are written by the test in place of the agents. */
    function setup(report?: unknown, verdict?: unknown): string {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0189-safety-'));
        for (const sub of ['22-article', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
        writeFileSync(
            join(dir, '22-article', `${STAMP}_06_article_content.json`),
            JSON.stringify({ title: 'T', body: 'B' }),
        );
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), MINIMAL_VOICESCRIPT);
        expect(runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']).status).toBe(0);
        if (report !== undefined) writeFileSync(at(dir, 'safety-review_report.json'), JSON.stringify(report));
        if (verdict !== undefined) writeFileSync(at(dir, 'safety-judge_verdict.json'), JSON.stringify(verdict));
        return dir;
    }

    /** Run the gate; routing is transition-owned, so it always exits 0 and the status file decides. */
    function gate(dir: string): string {
        const result = runStage(['daily-safety-gate', dir, STAMP]);
        expect(result.status).toBe(0);
        rmSync(dir, { recursive: true, force: true });
        return `${result.stdout.match(/safety: status=(\w+)/)?.[1]}|${result.stdout}`;
    }

    it('PASS verdict + all-OK report on the unchanged drafts → pass, with a digest stamp', () => {
        const dir = setup(OK_REPORT, PASS_VERDICT);
        expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('pass');
        const request = readJson<{ digest: string; platforms: string[] }>(at(dir, 'safety-review_request.json'));
        expect(request.platforms).toEqual(['xiaoyuzhou']);
        expect(readJson<{ digest: string }>(at(dir, 'safety-judge_stamp.json')).digest).toBe(request.digest);
        rmSync(dir, { recursive: true, force: true });
    });

    it.each([
        ['missing verdict', OK_REPORT, undefined],
        ['missing report', undefined, PASS_VERDICT],
        ['FAIL verdict', OK_REPORT, { verdict: 'FAIL' }],
        ['NEEDS_REVISION verdict', OK_REPORT, { verdict: 'NEEDS_REVISION' }],
        ['unrecognized verdict', OK_REPORT, { verdict: 'pass' }],
        ['PASS verdict without a confidence level', OK_REPORT, { verdict: 'PASS', rubric: 'compliance', score: 0.95 }],
        ['unrecognized confidence level', OK_REPORT, { verdict: 'PASS', confidence: 'SURE' }],
        ['lowercase confidence level', OK_REPORT, { verdict: 'PASS', confidence: 'high' }],
        ['non-string confidence level', OK_REPORT, { verdict: 'PASS', confidence: 1 }],
        ['empty-string confidence level', OK_REPORT, { verdict: 'PASS', confidence: '' }],
        ['BLOCK decision despite a PASS verdict', { platforms: [{ decision: 'BLOCK' }] }, PASS_VERDICT],
        ['report without platforms', { platforms: [] }, PASS_VERDICT],
        ['unknown decision', { platforms: [{ decision: 'FINE' }] }, PASS_VERDICT],
    ])('%s → block, no stamp', (_name, report, verdict) => {
        const dir = setup(report, verdict);
        expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('block');
        expect(() => readFileSync(at(dir, 'safety-judge_stamp.json'))).toThrow();
        rmSync(dir, { recursive: true, force: true });
    });

    it.each(['MEDIUM', 'LOW'])(
        'a %s confidence verdict still routes pass on an all-OK report (routing stays with decisions/escalate)',
        (confidence) => {
            const dir = setup(OK_REPORT, { verdict: 'PASS', rubric: 'compliance', score: 0.9, confidence });
            expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
            expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('pass');
            rmSync(dir, { recursive: true, force: true });
        },
    );

    it('unparsable verdict JSON → block', () => {
        const dir = setup(OK_REPORT);
        writeFileSync(at(dir, 'safety-judge_verdict.json'), '{not json');
        expect(gate(dir)).toStartWith('block|');
    });

    it('a RISK decision or escalate:true cannot be auto-passed by a PASS verdict → escalate', () => {
        expect(gate(setup({ platforms: [{ decision: 'RISK' }], escalate: false }, PASS_VERDICT))).toStartWith(
            'escalate|',
        );
        expect(gate(setup({ platforms: [{ decision: 'OK' }], escalate: true }, PASS_VERDICT))).toStartWith('escalate|');
    });

    it(
        '20261007 disposition contract: gap/note RISK on a clean PASS → exclude at recorded risk' +
            ' (empty exclusions, stamp written), not escalate',
        () => {
            const dir = setup(
                {
                    platforms: [
                        {
                            platform: 'xiaoyuzhou',
                            decision: 'RISK',
                            findings: [
                                { category: 4, item: 'XY-01', evidenceGap: true, disposition: 'gap' },
                                { category: 1, item: 'XY-03', disposition: 'note' },
                            ],
                        },
                    ],
                    escalate: false,
                    confidence: 'HIGH',
                },
                PASS_VERDICT,
            );
            expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
            expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('exclude');
            const stamp = readJson<{ status: string; excludedPlatforms: string[] }>(at(dir, 'safety-judge_stamp.json'));
            expect(stamp.status).toBe('exclude');
            expect(stamp.excludedPlatforms).toEqual([]);
            rmSync(dir, { recursive: true, force: true });
        },
    );

    it('20261007 disposition contract: a disposition:"escalate" finding still escalates on a clean PASS', () => {
        const dir = setup(
            {
                platforms: [
                    {
                        platform: 'xiaoyuzhou',
                        decision: 'RISK',
                        findings: [{ category: 2, item: 'XY-09', disposition: 'escalate' }],
                    },
                ],
                escalate: true,
                confidence: 'HIGH',
            },
            PASS_VERDICT,
        );
        expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('escalate');
        rmSync(dir, { recursive: true, force: true });
    });

    // The contract that classifies with dispositions must also self-grade its confidence
    // (HIGH|MEDIUM|LOW) — missing or out-of-enum blocks, mirroring the verdict hardening.
    const DISPOSITIONS_REPORT = {
        platforms: [
            {
                platform: 'xiaoyuzhou',
                decision: 'RISK',
                findings: [
                    { category: 4, item: 'XY-01', evidenceGap: true, disposition: 'gap' },
                    { category: 1, item: 'XY-03', disposition: 'note' },
                ],
            },
        ],
        escalate: false,
    };

    it.each([
        ['missing confidence level', undefined],
        ['unrecognized confidence level', 'SURE'],
        ['lowercase confidence level', 'high'],
        ['non-string confidence level', 1],
        ['empty-string confidence level', ''],
    ])('20261007 contract: a disposition report with a %s → block', (_name, confidence) => {
        const dir = setup({ ...DISPOSITIONS_REPORT, confidence }, PASS_VERDICT);
        expect(gate(dir)).toStartWith('block|');
    });

    it.each(['HIGH', 'MEDIUM', 'LOW'])(
        '20261007 contract: report confidence %s keeps gap/note RISK at recorded-risk exclude',
        (confidence) => {
            const dir = setup({ ...DISPOSITIONS_REPORT, confidence }, PASS_VERDICT);
            expect(gate(dir)).toStartWith('exclude|');
        },
    );

    it('drafts edited after the review was requested → block (an old PASS does not carry over)', () => {
        const dir = setup(OK_REPORT, PASS_VERDICT);
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), 'segments: [edited]\n');
        expect(gate(dir)).toStartWith('block|');
    });

    it('a quality-verdict block quarantines the drafts (mv, not rm) while verdict artifacts stay; a digest-mismatch block keeps them', () => {
        const dir = setup(OK_REPORT, { verdict: 'FAIL' });
        expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
        const q = join(dir, '24-script', `.quarantine-${STAMP}-judge-block`);
        expect(existsSync(join(q, `${STAMP}_06_article_content.json`))).toBe(true);
        expect(existsSync(join(q, `${STAMP}_08_script_voicescript.yaml`))).toBe(true);
        expect(() => readFileSync(at(dir, 'safety-review_report.json'))).not.toThrow();
        // A digest-mismatch block is a deliberate HITL edit: the drafts stay put for re-review.
        const dir2 = setup(OK_REPORT, PASS_VERDICT);
        writeFileSync(join(dir2, '24-script', `${STAMP}_08_script_voicescript.yaml`), 'segments: [edited]\n');
        expect(runStage(['daily-safety-gate', dir2, STAMP]).status).toBe(0);
        expect(readFileSync(at(dir2, 'safety-judge_status.txt'), 'utf-8')).toBe('block');
        expect(existsSync(join(dir2, '24-script', `${STAMP}_08_script_voicescript.yaml`))).toBe(true);
        rmSync(dir, { recursive: true, force: true });
        rmSync(dir2, { recursive: true, force: true });
    });

    it('re-running prep drops the previous report, verdict and stamp, so a retry must be re-reviewed', () => {
        const dir = setup(OK_REPORT, PASS_VERDICT);
        expect(runStage(['daily-safety-gate', dir, STAMP]).status).toBe(0);
        expect(runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']).status).toBe(0);
        for (const name of ['safety-review_report.json', 'safety-judge_verdict.json', 'safety-judge_stamp.json']) {
            expect(() => readFileSync(at(dir, name))).toThrow();
        }
        expect(gate(dir)).toStartWith('block|');
    });

    it('prep fails loud when a draft is missing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0189-safety-'));
        const result = runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('safety-review');
        rmSync(dir, { recursive: true, force: true });
    });

    // ---- 20261005: the gate alerts and adjusts instead of stopping the run ----------------

    /** A report of the real 20261005 shape: two admission BLOCKs (category 2) + one RISK. */
    const ADMISSION_REPORT = {
        platforms: [
            {
                platform: 'xiaoyuzhou',
                decision: 'BLOCK',
                findings: [
                    { category: 2, item: 'XY-01', evidence: '「今天是2026年10月5日，星期一…」', evidenceGap: true },
                ],
            },
            {
                platform: 'wechatmp',
                decision: 'BLOCK',
                findings: [{ category: 2, item: 'WX-02', evidence: '「AI 乱炖 · 2026-10-05」', evidenceGap: true }],
            },
            {
                platform: 'apple-podcasts',
                decision: 'RISK',
                findings: [{ category: 5, item: 'AP-05', evidence: 'no metadata disclosure', evidenceGap: true }],
            },
        ],
        escalate: true,
    };
    /** The judge's side of the same run: a must-pass fail on the admission criterion only. */
    const ADMISSION_VERDICT = {
        verdict: 'FAIL',
        rubric: 'compliance',
        score: 0.475,
        confidence: 'LOW',
        findings: [{ criterion: 'jurisdictional-rules', status: 'fail', detail: '资质口径' }],
    };

    /** The gate with an explicit remediation budget; the caller owns the temp dir. */
    function gateWith(dir: string, maxRevise: string): string {
        const result = runStage(['daily-safety-gate', dir, STAMP, maxRevise]);
        expect(result.status).toBe(0);
        return result.stdout.match(/safety: status=(\w+)/)?.[1] ?? '';
    }

    it('spends the remediation budget on a non-PASS verdict before classifying anything', () => {
        const dir = setup(ADMISSION_REPORT, ADMISSION_VERDICT);
        expect(gateWith(dir, '2')).toBe('revise');
        // A revise is not a verdict: no stamp, and the drafts stay put for the edit.
        expect(() => readFileSync(at(dir, 'safety-judge_stamp.json'))).toThrow();
        expect(existsSync(join(dir, '22-article', `${STAMP}_06_article_content.json`))).toBe(true);
        // One pass spent → the second is still available; the budget is what ends the loop.
        writeFileSync(join(dir, '.safety-revise-count'), '1\n');
        expect(gateWith(dir, '2')).toBe('revise');
        writeFileSync(join(dir, '.safety-revise-count'), '2\n');
        expect(gateWith(dir, '2')).toBe('exclude');
        rmSync(dir, { recursive: true, force: true });
    });

    it('admission-only residue → exclude: the platform list is stamped and the drafts are kept', () => {
        const dir = setup(ADMISSION_REPORT, ADMISSION_VERDICT);
        expect(gateWith(dir, '0')).toBe('exclude');
        const stamp = readJson<{ status: string; excludedPlatforms: string[] }>(at(dir, 'safety-judge_stamp.json'));
        expect(stamp.status).toBe('exclude');
        // apple-podcasts only RISKed: its category-5 finding must not drag the whole draft down.
        expect(stamp.excludedPlatforms).toEqual(['xiaoyuzhou', 'wechatmp']);
        expect(existsSync(join(dir, '24-script', `.quarantine-${STAMP}-judge-block`))).toBe(false);
        expect(existsSync(join(dir, '22-article', `${STAMP}_06_article_content.json`))).toBe(true);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('exclude');
        rmSync(dir, { recursive: true, force: true });
    });

    it('a NEEDS_REVISION that documents only warn-grade findings is admission-only → exclude', () => {
        const verdict = {
            verdict: 'NEEDS_REVISION',
            rubric: 'compliance',
            score: 0.775,
            confidence: 'LOW',
            findings: [
                { criterion: 'no-prohibited-claims', status: 'pass' },
                { criterion: 'disclosure-presence', status: 'warn' },
                { criterion: 'jurisdictional-rules', status: 'warn' },
            ],
        };
        const dir = setup(
            { platforms: [{ platform: 'xiaoyuzhou', decision: 'RISK', findings: [] }], escalate: true },
            verdict,
        );
        expect(gateWith(dir, '0')).toBe('exclude');
        const stamp = readJson<{ excludedPlatforms: string[] }>(at(dir, 'safety-judge_stamp.json'));
        expect(stamp.excludedPlatforms).toEqual([]);
        rmSync(dir, { recursive: true, force: true });
    });

    it('draft-integrity findings survive exclusion → block + quarantine', () => {
        // A category-3 (PII) platform BLOCK and a non-admission verdict fail: dropping a target
        // cannot fix these, so the drafts must not publish anywhere.
        const report = {
            platforms: [
                {
                    platform: 'wechatmp',
                    decision: 'BLOCK',
                    findings: [{ category: 3, item: 'WX-04', evidence: '手机号' }],
                },
            ],
            escalate: true,
        };
        const verdict = {
            verdict: 'FAIL',
            confidence: 'LOW',
            findings: [{ criterion: 'data-handling', status: 'fail' }],
        };
        const dir = setup(report, verdict);
        expect(gateWith(dir, '0')).toBe('block');
        expect(existsSync(join(dir, '24-script', `.quarantine-${STAMP}-judge-block`))).toBe(true);
        rmSync(dir, { recursive: true, force: true });
    });

    it('daily-safety-revise restores a VoiceScript whose item-section structure the edit broke', () => {
        // 2026-10-21 04:30: the remediation pass removed 3 segments (27 → 24, 6 → 5 item sections).
        // `daily-wrap-docs` derives the spoken sections from `gap_ms: 1200` and refuses a mismatch with
        // the episode's included items, so the scheduled run died at `generate` and published nothing.
        // The pre-revision bytes are snapshotted by `daily-safety-prep`; this stage puts them back.
        const dir = setup(OK_REPORT, PASS_VERDICT);
        const scriptPath = join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`);
        const twoItems = TWO_ITEM_SCRIPT;
        writeFileSync(scriptPath, twoItems);
        writeFileSync(
            join(dir, '24-script', `${STAMP}_08_script-write_plan.json`),
            JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] }),
        );
        // Re-open the review so the snapshot holds the two-item structure, then break it.
        expect(runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']).status).toBe(0);
        writeFileSync(scriptPath, ONE_ITEM_SCRIPT);

        const repaired = runStage(['daily-safety-revise', dir, STAMP]);
        expect(repaired.status, repaired.stderr).toBe(0);
        expect(repaired.stderr).toContain('restored the pre-revision structure');
        expect(readFileSync(scriptPath, 'utf-8')).toBe(twoItems);
        expect(readFileSync(join(dir, '.safety-revise-count'), 'utf-8')).toBe('1\n');
        rmSync(dir, { recursive: true, force: true });
    });

    it('daily-safety-revise keeps a VoiceScript drop the article boundary already recorded', () => {
        // 2026-10-21: the article excluded the 通用汽车 buyback as non-technical, the safety pass removed
        // it from the VoiceScript, and `generate` still refused 5 sections against the 6-item plan. The
        // recorded exclusion is the contract, so the drop stands and the run continues.
        const dir = setup(OK_REPORT, PASS_VERDICT);
        const scriptPath = join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`);
        writeFileSync(
            join(dir, '22-article', `${STAMP}_06_article_content.json`),
            JSON.stringify({ title: 'T', body: 'B', metadata: { excludedIds: ['b'] } }),
        );
        writeFileSync(scriptPath, TWO_ITEM_SCRIPT);
        writeFileSync(
            join(dir, '24-script', `${STAMP}_08_script-write_plan.json`),
            JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] }),
        );
        expect(runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']).status).toBe(0);
        writeFileSync(scriptPath, ONE_ITEM_SCRIPT);

        const revised = runStage(['daily-safety-revise', dir, STAMP]);
        expect(revised.status, revised.stderr).toBe(0);
        expect(revised.stderr).not.toContain('restored the pre-revision structure');
        expect(readFileSync(scriptPath, 'utf-8')).toBe(ONE_ITEM_SCRIPT);
        rmSync(dir, { recursive: true, force: true });
    });

    it('daily-generate counts the plan items the article excluded', () => {
        // Same 2026-10-21 shape at the seam that actually failed: 2 plan items, 1 item the article
        // excluded, a 1-section script. The count must hold, otherwise the run dies after the safety
        // gate, hours after the decision was made.
        const dir = setup(OK_REPORT, PASS_VERDICT);
        const articlePath = join(dir, '22-article', `${STAMP}_06_article_content.json`);
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), ONE_ITEM_SCRIPT);
        writeFileSync(
            join(dir, '24-script', `${STAMP}_08_script-write_plan.json`),
            JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] }),
        );
        // `kk` never runs: the count check fires before synthesis, and the stub fails any TTS call.
        const bin = join(dir, 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'kk'), '#!/bin/sh\necho "kk stub: refusing" >&2\nexit 1\n');
        chmodSync(join(bin, 'kk'), 0o755);
        const env = { PATH: `${bin}:${process.env.PATH ?? ''}` };
        const generate = () => runStage(['daily-generate', dir, STAMP, '', 'false', 'voxcpm', '1', '20'], env);

        const refused = generate();
        expect(refused.status).toBe(1);
        expect(refused.stderr).toContain('does not match script item sections (1)');

        writeFileSync(articlePath, JSON.stringify({ title: 'T', body: 'B', metadata: { excludedIds: ['b'] } }));
        const admitted = generate();
        expect(admitted.stderr).not.toContain('item sections');
        expect(admitted.status).not.toBe(0);
        rmSync(dir, { recursive: true, force: true });
    });

    it('daily-safety-revise validates the edited drafts and spends one budget unit per pass', () => {
        const dir = setup(OK_REPORT, PASS_VERDICT);
        expect(runStage(['daily-safety-revise', dir, STAMP]).status).toBe(0);
        expect(readFileSync(join(dir, '.safety-revise-count'), 'utf-8')).toBe('1\n');
        expect(runStage(['daily-safety-revise', dir, STAMP]).status).toBe(0);
        expect(readFileSync(join(dir, '.safety-revise-count'), 'utf-8')).toBe('2\n');
        // A revision that breaks the article contract fails inside the loop, not at wrap-docs.
        writeFileSync(join(dir, '22-article', `${STAMP}_06_article_content.json`), JSON.stringify({ title: 'T' }));
        const broken = runStage(['daily-safety-revise', dir, STAMP]);
        expect(broken.status).not.toBe(0);
        expect(broken.stderr).toContain('body');
        // A VoiceScript the builder would reject is rejected here too.
        writeFileSync(
            join(dir, '22-article', `${STAMP}_06_article_content.json`),
            JSON.stringify({ title: 'T', body: 'B' }),
        );
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), 'segments: []\n');
        expect(runStage(['daily-safety-revise', dir, STAMP]).status).not.toBe(0);
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('daily-episode-duration stage — 15–20 min standing gate', () => {
    const mkAudio = (dir: string, duration: unknown) => {
        const d = join(dir, '30-audio');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, `${STAMP}_11_generate_content.json`), JSON.stringify({ metadata: { duration } }));
    };

    it('closes no-content below the min bound — exit 0 + refusal artifact (0266)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir, 495); // today's pre-fix episode: 8.25 min
        const result = runStage(['daily-episode-duration', dir, STAMP, '15', '20']);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toContain('8.3');
        const refusal = JSON.parse(
            readFileSync(join(dir, '30-audio', `${STAMP}_11_generate_content_duration-refusal.json`), 'utf-8'),
        ) as { measuredMinutes: number; minMinutes: number };
        expect(refusal.measuredMinutes).toBeCloseTo(8.3, 5);
        expect(refusal.minMinutes).toBe(15);
        rmSync(dir, { recursive: true, force: true });
    });

    it('fails loud above the max bound', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir, 1500);
        expect(runStage(['daily-episode-duration', dir, STAMP, '15', '20']).status).not.toBe(0);
        rmSync(dir, { recursive: true, force: true });
    });

    it('passes inside the window and accepts numeric-string durations', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir, '980.5');
        const result = runStage(['daily-episode-duration', dir, STAMP, '15', '20']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('16.3');
        rmSync(dir, { recursive: true, force: true });
    });

    it('fails loud on missing duration, missing audio, and invalid bounds', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir, undefined);
        expect(runStage(['daily-episode-duration', dir, STAMP, '15', '20']).status).not.toBe(0);
        rmSync(dir, { recursive: true, force: true });

        const dir2 = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        expect(runStage(['daily-episode-duration', dir2, STAMP, '15', '20']).status).not.toBe(0);
        rmSync(dir2, { recursive: true, force: true });

        const dir3 = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir3, 980);
        expect(runStage(['daily-episode-duration', dir3, STAMP, '', '20']).status).not.toBe(0);
        expect(runStage(['daily-episode-duration', dir3, STAMP, '20', '15']).status).not.toBe(0);
        rmSync(dir3, { recursive: true, force: true });
    });
});
