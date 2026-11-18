import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import {
    analyzeEditorialClaims,
    COMMENTARY_MARKERS,
    type EditorialFinding,
    EXPLANATION_MARKERS,
    JARGON_TERMS,
    parseStyleContract,
    processGeneratorIO,
    type ScriptPlan,
    validateScriptPlan,
} from '../src/index';

/**
 * 0385 AC R2 (按受众影响选择和解释新闻) and AC R3 (核查商业声明与评论证据) — the two criteria the
 * schema cannot express, made mechanically checkable by `src/editorial-claims.ts`.
 *
 * The boundary under test is double-sided: every rule fires on its own failing input, AND a plan the
 * existing validator already accepts produces zero findings (the blast-radius proof at the bottom).
 * Advisory means advisory — no rule here may reject a plan.
 */
const STYLE_SIDECAR = join(
    import.meta.dir,
    '..',
    '..',
    '..',
    'kk',
    'skills',
    'news-editorial',
    'references',
    'style-contract.zh.md',
);
const style = parseStyleContract(readFileSync(STYLE_SIDECAR, 'utf-8'));

const DOC: Doc = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', '20260924-us-china-doc.json'), 'utf-8'));
const ENERGY_DOC: Doc = {
    id: 'energy-doc-1',
    title: '数据中心电力需求激增',
    body: '数据中心电力需求激增\n\n新的人工智能数据中心正在推高区域电网的电力需求。',
    sourceUri: 'https://example.com/energy',
};
const DOCS: Doc[] = [DOC, ENERGY_DOC];

/** A one-item plan whose fields a test overrides — the shape is always legal so only the rule fires. */
function planWith(lead: string, insight?: string): ScriptPlan {
    return {
        version: 1,
        intro: '今天有一条消息值得听一听。',
        outro: '接下来值得看的是这条消息会不会落到产品里。',
        items: [{ id: DOC.id, lead, ...(insight === undefined ? {} : { insight }) }],
    };
}

/** Codes only, so a test asserts the rule set instead of re-typing messages. */
function codes(plan: ScriptPlan): string[] {
    return analyzeEditorialClaims(plan).map((finding) => finding.code);
}

describe('0385 AC R3 — commentary markers are one per item and live only in insight', () => {
    it('flags two commentary markers in one item, accepts one (r3:commentary-repeat)', () => {
        const twice = planWith('先说这条消息。', '我看这次调整值得关注，我觉得节奏比预期快。');
        expect(codes(twice)).toContain('r3:commentary-repeat');
        expect(analyzeEditorialClaims(twice).find((f) => f.code === 'r3:commentary-repeat')).toMatchObject({
            itemId: DOC.id,
        });

        const once = planWith('先说这条消息。', '我看这次调整的节奏比预期快。');
        expect(codes(once)).not.toContain('r3:commentary-repeat');
    });

    it('counts a synonym as the same marker, so 「我看」+「我觉得」 is two (prefix marker list is contract-owned)', () => {
        expect(COMMENTARY_MARKERS).toContain('我看');
        expect(COMMENTARY_MARKERS).toContain('我觉得');
        expect(codes(planWith('先说这条消息。', '我看它重要。我觉得它急。'))).toContain('r3:commentary-repeat');
    });

    it('flags a commentary marker in the fact sentence, accepts it only in insight (r3:commentary-in-facts)', () => {
        const inLead = planWith('我觉得这项调整值得关注。', '这条点评放在 insight 里。');
        expect(codes(inLead)).toContain('r3:commentary-in-facts');

        const inInsight = planWith('这项调整今天生效。', '我看这条对产品团队的排期影响最大。');
        expect(codes(inInsight)).not.toContain('r3:commentary-in-facts');
    });

    it('flags an insight longer than one sentence, accepts exactly one (r3:insight-multi-sentence)', () => {
        const two = planWith('先说这条消息。', '这条对成本的影响是直接的。接下来还要看续费能不能跟上。');
        expect(codes(two)).toContain('r3:insight-multi-sentence');

        const one = planWith('先说这条消息。', '这条对成本的影响是直接的。');
        expect(codes(one)).not.toContain('r3:insight-multi-sentence');
        // An omitted comment is legal (0385 R3) and is not "too many sentences".
        expect(codes(planWith('先说这条消息。'))).not.toContain('r3:insight-multi-sentence');
    });
});

describe('0385 AC R3 — a quantified or superlative claim carries attribution', () => {
    it('flags an unattributed funding figure, accepts the same figure with a named source', () => {
        const bare = planWith('这次融资 3 亿美元，团队扩到 200 人。');
        expect(codes(bare)).toContain('r3:unattributed-claim');

        const attributed = planWith('据路透社报道，这次融资 3 亿美元，团队扩到 200 人。');
        expect(codes(attributed)).not.toContain('r3:unattributed-claim');
    });

    it('flags an unattributed superlative, accepts it when the announcement is named', () => {
        const bare = planWith('这是全球首个面向企业的合规模型。');
        expect(codes(bare)).toContain('r3:unattributed-claim');

        const attributed = planWith('官方公告称，这是全球首个面向企业的合规模型。');
        expect(codes(attributed)).not.toContain('r3:unattributed-claim');
    });

    it('accepts a fact sentence with no number and no superlative, and an attribution link counts', () => {
        expect(codes(planWith('公司今天发布了一版新的调度方案。'))).not.toContain('r3:unattributed-claim');
        expect(codes(planWith('财报显示收入增长 30%。'))).not.toContain('r3:unattributed-claim');
    });

    it('reports the offending sentence so a fix pass knows what to re-attribute', () => {
        const findings: EditorialFinding[] = analyzeEditorialClaims(planWith('用户数涨到 5000 万。'));
        const finding = findings.find((entry) => entry.code === 'r3:unattributed-claim');
        expect(finding?.message).toContain('用户数涨到 5000 万');
    });
});

describe('0385 AC R2 — an introduced technical term is explained in the same breath', () => {
    it('flags bare jargon, accepts a dash gloss and a parenthetical gloss', () => {
        const bare = planWith('这次更新换掉了推理引擎。');
        expect(codes(bare)).toContain('r2:unexplained-jargon');

        const dash = planWith('这次更新换掉了推理引擎——也就是每次调用模型的那层调度。');
        expect(codes(dash)).not.toContain('r2:unexplained-jargon');

        const bracket = planWith('这次更新换掉了推理引擎（每次调用模型的那层调度）。');
        expect(codes(bracket)).not.toContain('r2:unexplained-jargon');
    });

    it('accepts the contract own 「也就是说」 shape and flags the same term inside insight too', () => {
        expect(EXPLANATION_MARKERS).toContain('也就是说');
        expect(JARGON_TERMS).toContain('推理成本');
        expect(codes(planWith('推理成本也就是说每次调用模型要付的钱，正在下降。'))).not.toContain(
            'r2:unexplained-jargon',
        );
        expect(codes(planWith('先说这条消息。', '上下文缓存的收益最大。'))).toContain('r2:unexplained-jargon');
    });

    it('matches latin jargon case-insensitively and ignores text with no listed term', () => {
        // `token` is on the list in lower case; the sentence spells it capitalised.
        expect(codes(planWith('Token 价格又降了。'))).toContain('r2:unexplained-jargon');
        expect(codes(planWith('公司今天发布了一版新的调度方案。'))).toEqual([]);
    });

    it('a gloss in a different sentence does not rescue the term in this one', () => {
        const findings = analyzeEditorialClaims(planWith('这次更新换掉了推理引擎。也就是说调度层重写了。'));
        expect(findings.map((finding) => finding.code)).toEqual(['r2:unexplained-jargon']);
    });
});

describe('0385 AC R2/R3 — blast radius: a plan the repo already accepts produces no findings', () => {
    const REAL_PLAN: ScriptPlan = JSON.parse(
        readFileSync(join(import.meta.dir, 'fixtures', '20260924-master-plan.json'), 'utf-8'),
    );

    it('the realistic fixture plan still validates against the shipped contract', () => {
        expect(validateScriptPlan(REAL_PLAN, DOCS, style)).toEqual({ ok: true, plan: REAL_PLAN });
    });

    it('and yields zero advisory findings', () => {
        expect(analyzeEditorialClaims(REAL_PLAN)).toEqual([]);
    });

    it('the generator stamps the advisories beside an accepted plan and still exits on the plan path', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0385-advisory-'));
        setDefaultOutputTargets({ stderr: createBufferTarget() });
        try {
            const inPath = join(dir, 'docs.json');
            const planPath = join(dir, 'plan.json');
            const outPath = join(dir, 'content.json');
            writeFileSync(inPath, JSON.stringify(DOCS));
            writeFileSync(
                planPath,
                JSON.stringify({
                    ...REAL_PLAN,
                    items: REAL_PLAN.items.map((item, index) =>
                        index === 0 ? { ...item, insight: '我看这条的节奏比预期快。我觉得这是重点。' } : item,
                    ),
                }),
            );
            const saved = { plan: process.env.DAILYNEWS_SCRIPT_PLAN, style: process.env.DAILYNEWS_STYLE_FILE };
            process.env.DAILYNEWS_SCRIPT_PLAN = planPath;
            process.env.DAILYNEWS_STYLE_FILE = STYLE_SIDECAR;
            try {
                const content = await processGeneratorIO(inPath, outPath, {
                    language: 'zh',
                    date: new Date(2026, 8, 24),
                });
                // An advisory finding never rejects: the plan path still runs.
                expect(content.metadata?.scriptSource).toBe('plan');
                expect(content.metadata?.scriptPlanErrors).toEqual([]);
                // Two markers → commentary-repeat; the second marker's own sentence is also a
                // second sentence of commentary. Both are advisory, both are stamped.
                const stamped = (content.metadata?.scriptPlanAdvisories ?? []) as EditorialFinding[];
                expect(stamped.map((finding) => `${finding.itemId}:${finding.code}`)).toEqual([
                    `${DOC.id}:r3:commentary-repeat`,
                    `${DOC.id}:r3:insight-multi-sentence`,
                ]);
            } finally {
                for (const [key, value] of [
                    ['DAILYNEWS_SCRIPT_PLAN', saved.plan],
                    ['DAILYNEWS_STYLE_FILE', saved.style],
                ] as const) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('0385 AC R2/R3 — determinism', () => {
    beforeEach(() => setDefaultOutputTargets({ stderr: createBufferTarget() }));
    afterEach(() => setDefaultOutputTargets({}));

    it('returns findings in plan order with the item id attached, and is idempotent', () => {
        const plan: ScriptPlan = {
            version: 1,
            intro: '导语。',
            outro: '收尾。',
            items: [
                { id: DOC.id, lead: '我觉得这次融资 3 亿美元。' },
                { id: 'energy-doc-1', lead: '换掉了推理引擎。' },
            ],
        };
        const first = analyzeEditorialClaims(plan);
        expect(first.map((finding) => `${finding.itemId}:${finding.code}`)).toEqual([
            `${DOC.id}:r3:commentary-in-facts`,
            `${DOC.id}:r3:unattributed-claim`,
            'energy-doc-1:r2:unexplained-jargon',
        ]);
        expect(analyzeEditorialClaims(plan)).toEqual(first);
    });
});

/**
 * The reporting hook: `daily-script-check` (the stage that already reports non-schema validator
 * issues) has to surface the advisory findings WITHOUT re-opening the fix loop. Driven through the
 * real stage runner and a `kk` shim, like `plugins/kk/tests/daily-script-retry-regression.test.ts`.
 */
describe('0385 AC R2/R3 — daily-script-check reports advisories beside an accepted plan', () => {
    const runner = join(import.meta.dir, '..', '..', '..', 'kk', 'scripts', 'kk-workflow-stages.ts');

    function runCheck(metadata: unknown): { dir: string; stdout: string; status: number | null } {
        const root = mkdtempSync(join(tmpdir(), 'kk-0385-advisory-stage-'));
        const binDir = join(root, 'bin');
        const workDir = join(root, 'work');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        mkdirSync(join(workDir, '24-script'), { recursive: true });
        writeFileSync(
            join(workDir, '21-plan', '20261120_03_plan_plan.json'),
            JSON.stringify({ items: [{ id: DOC.id }] }),
        );
        writeFileSync(
            join(workDir, '24-script', '20261120_08_script-write_plan.json'),
            JSON.stringify({ version: 1, intro: 'i', outro: 'o', items: [{ id: DOC.id, lead: 'l' }] }),
        );
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(args[args.indexOf('--out') + 1] ?? '', ${JSON.stringify(JSON.stringify({ metadata }))});
`,
        );
        chmodSync(shimPath, 0o755);
        const res = spawnSync('bun', [runner, 'daily-script-check', workDir, '20261120'], {
            encoding: 'utf-8',
            env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
        });
        return { dir: root, stdout: res.stdout, status: res.status };
    }

    it('writes the advisory file and leaves the rejection file absent (advisory never triggers the fix pass)', () => {
        const finding = { code: 'r2:unexplained-jargon', itemId: DOC.id, message: 'gloss 推理引擎' };
        const run = runCheck({ scriptSource: 'plan', scriptPlanErrors: [], scriptPlanAdvisories: [finding] });
        try {
            expect(run.status).toBe(0);
            expect(run.stdout).toContain('script plan accepted by the validator (1 advisory finding(s))');
            const advisoriesPath = join(run.dir, 'work', '24-script', '20261120_08_script-write_advisories.json');
            expect(JSON.parse(readFileSync(advisoriesPath, 'utf-8'))).toEqual([finding]);
            expect(existsSync(join(run.dir, 'work', '24-script', '20261120_08_script-write_errors.json'))).toBe(false);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    it('a clean plan leaves no advisory file behind and keeps the old acceptance line', () => {
        const run = runCheck({ scriptSource: 'plan', scriptPlanErrors: [], scriptPlanAdvisories: [] });
        try {
            expect(run.status).toBe(0);
            expect(run.stdout).toContain('script plan accepted by the validator');
            expect(run.stdout).not.toContain('advisory finding');
            expect(existsSync(join(run.dir, 'work', '24-script', '20261120_08_script-write_advisories.json'))).toBe(
                false,
            );
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });
});
