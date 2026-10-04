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
            // The publish payload: AI 乱炖 episode title (R1/R4), one kept item, mandatory ai-news tag.
            expect(content.title).toBe('AI 乱炖 · 2026-09-16');
            expect(content.metadata.generator).toBe('kk:daily-article');
            expect(content.metadata.doc_count).toBe(1);
            expect(content.metadata.tags).toEqual(['ai-news']);
            expect(content.metadata.date).toBe('2026-09-16');
            expect(content.references).toEqual([
                { url: 'https://example.com/ok-1', title: '浏览器端零依赖语音实现', cite: 'ok-1' },
            ]);
            // Publish-payload capture quoted in .spur/run/0189/evidence/e2e-publish-payload.md.
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('content-safety verdict gate (task 0189 R10 / AC10)', () => {
    const OK_REPORT = { platforms: [{ platform: 'xiaoyuzhou', decision: 'OK', findings: [] }], escalate: false };
    const PASS_VERDICT = { verdict: 'PASS', rubric: 'compliance', score: 0.95, confidence: 'HIGH' };
    const at = (dir: string, name: string) => join(dir, '24-script', `${STAMP}_09_${name}`);

    /** Drafts + prep; the two agent.run outputs are written by the test in place of the agents. */
    function setup(report?: unknown, verdict?: unknown): string {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0189-safety-'));
        for (const sub of ['22-article', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
        writeFileSync(join(dir, '22-article', `${STAMP}_06_article_content.json`), JSON.stringify({ title: 'T' }));
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), 'segments: []\n');
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
});

describe('daily-episode-duration stage — 15–20 min standing gate', () => {
    const mkAudio = (dir: string, duration: unknown) => {
        const d = join(dir, '30-audio');
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, `${STAMP}_11_generate_content.json`), JSON.stringify({ metadata: { duration } }));
    };

    it('fails loud below the min bound', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-duration-'));
        mkAudio(dir, 495); // today's pre-fix episode: 8.25 min
        const result = runStage(['daily-episode-duration', dir, STAMP, '15', '20']);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('8.3');
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
