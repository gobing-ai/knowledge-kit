/**
 * Task 0433 — the CN-platform lead constraint, enforced deterministically before the TTS spend.
 *
 * Incident 2026-11-24 (`.works/kk-news-generate/20261124`): the curator led the episode with
 * 英伟达董事会恢复黄仁勋职务并新设国家安全与出口管制委员会. The variants safety review then graded that
 * mainline against the skill's own platform stance — `XY-02` (小宇宙) and `WX-01` (公众号) block a
 * 时政/贸易管制 mainline — and dropped both CN rows AFTER the 12.6 min TTS pass had been paid for.
 *
 * Failures enumerated before the fix:
 *  1. AC1: a plan whose lead title/summary carries 国家安全审查 / 出口管制 vocabulary is ACCEPTED by
 *     `daily-curate-check`, so nothing is visible until the post-spend safety verdict;
 *  2. AC2: a product-release lead must pass untouched (the gate is not a blanket keyword filter);
 *  3. the failure must name the platform rule ids the gate stands on (`XY-02` / `WX-01`) and the terms
 *     it matched, because the `curate --fix` pass fixes by rule;
 *  4. the surfaces that are NOT the lead (a body-item mention) must not trip it — this is a
 *     lead-position constraint, not an item exclusion;
 *  5. the documented `--final` fallback (candidates, untranslated, no agent) must still come out with a
 *     safe lead: the deterministic demotion is the only actor left on that path.
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CN_LEAD_RULE_IDS, checkCnLeadPlan, enforceCnLead, scanCnLead } from '../scripts/cn-lead-gate.ts';

const RUNNER = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');

/** AC1's fixture: the 2026-11-24 lead, verbatim from the incident. */
const AC1_TITLE = '英伟达董事会恢复黄仁勋职务并新设国家安全与出口管制委员会';
const AC1_BRIEF =
    '董事会以全票通过恢复黄仁勋的 CEO 与董事职务，并新设国家安全与出口管制委员会，直接向董事会汇报，负责审查对外投资与出口合规。';

/** AC2's fixture: a model/product release, no CN-blocked mainline anywhere in title or summary. */
const AC2_TITLE = 'Anthropic 发布 Claude Opus 5：上下文窗口扩至两百万 token';
const AC2_BRIEF = '新模型在长文档与代码库理解上提升明显，API 定价较上一代下降三成，今天起向全部付费用户开放。';

function doc(id: string, title: string, brief: string, body = '正文'): Record<string, unknown> {
    return { id, title, body, metadata: { brief } };
}

describe('cn-lead-gate scanCnLead (0433 R1/R3)', () => {
    it('trips the 2026-11-24 state-security/export-control lead and names XY-02 / WX-01', () => {
        const scan = scanCnLead(AC1_TITLE, AC1_BRIEF);
        expect(scan.hits.length).toBeGreaterThan(0);
        expect(scan.terms).toContain('出口管制');
        expect(scan.terms).toContain('国家安全');
        expect([...scan.ruleIds].sort()).toEqual([...CN_LEAD_RULE_IDS].sort());
        expect([...scan.ruleIds].sort()).toEqual(['WX-01', 'XY-02']);
    });

    it('passes a product-release lead untouched (AC2)', () => {
        const scan = scanCnLead(AC2_TITLE, AC2_BRIEF);
        expect(scan.hits).toEqual([]);
        expect(scan.terms).toEqual([]);
    });

    it('trips on the summary alone — a clean title is not enough', () => {
        const scan = scanCnLead(AC2_TITLE, '该交易仍需通过美国国家安全审查，市场关注出口管制清单是否扩大。');
        expect(scan.hits.length).toBeGreaterThan(0);
        expect(scan.hits.every((hit) => hit.field === 'summary')).toBe(true);
    });

    it('ignores the body: this is a lead-position constraint, not an item exclusion', () => {
        const plan = [
            doc('a', AC2_TITLE, AC2_BRIEF, '文章正文提到出口管制与国家安全审查的行业背景，但主线仍是模型发布。'),
        ];
        expect(checkCnLeadPlan(plan).ok).toBe(true);
    });

    it("scans the shipped summary fallback — the lead body's first sentence (review P3)", () => {
        // A raw `--final` candidate carries no `metadata.brief`; the podcast notes then ship the
        // lead's first body sentence, so that sentence is a summary surface and must be scanned.
        const plan = [
            {
                id: 'a',
                title: AC2_TITLE,
                body: '美国国家安全审查与出口管制清单扩大，多家芯片公司被列入名单。模型发布只是背景。',
            },
        ];
        const result = checkCnLeadPlan(plan);
        expect(result.ok).toBe(false);
        expect(result.hits.some((hit) => hit.field === 'summary')).toBe(true);
    });

    it('trips an untranslated English lead (the --final fallback carries raw candidates)', () => {
        const scan = scanCnLead('Nvidia board restores Jensen Huang and creates national security review', '');
        expect(scan.terms).toContain('national security');
    });

    it('"software" and other near-misses do not match a short Latin term', () => {
        const scan = scanCnLead('Warehouse software wars: a tooling roundup', '');
        expect(scan.hits).toEqual([]);
    });
});

describe('cn-lead-gate checkCnLeadPlan (0433 R3)', () => {
    it('fails the plan, naming the lead, the terms and the rule ids', () => {
        const verdict = checkCnLeadPlan([doc('a', AC1_TITLE, AC1_BRIEF), doc('b', AC2_TITLE, AC2_BRIEF)]);
        expect(verdict.ok).toBe(false);
        expect(verdict.leadId).toBe('a');
        expect(verdict.message).toContain('XY-02');
        expect(verdict.message).toContain('WX-01');
        expect(verdict.message).toContain('出口管制');
    });

    it('accepts a product lead regardless of what sits behind it', () => {
        const verdict = checkCnLeadPlan([doc('a', AC2_TITLE, AC2_BRIEF), doc('b', AC1_TITLE, AC1_BRIEF)]);
        expect(verdict.ok).toBe(true);
        expect(verdict.message).toBe('');
    });

    it('accepts an empty plan — the empty-plan rule owns that case', () => {
        expect(checkCnLeadPlan([]).ok).toBe(true);
    });
});

describe('cn-lead-gate enforceCnLead (0433 R2 — the deterministic demotion)', () => {
    it('demotes the tripping lead to a body position and leads with the first clean item', () => {
        const plan = [doc('a', AC1_TITLE, AC1_BRIEF), doc('b', AC2_TITLE, AC2_BRIEF), doc('c', '第三条', '')];
        const { docs, demoted, blocked } = enforceCnLead(plan);
        expect(blocked).toBeNull();
        expect(demoted).toEqual({ id: 'a', from: 0, to: 1 });
        expect(docs.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
        expect(checkCnLeadPlan(docs).ok).toBe(true);
    });

    it('leaves a clean plan byte-identical', () => {
        const plan = [doc('b', AC2_TITLE, AC2_BRIEF), doc('c', '第三条', '')];
        const { docs, demoted, blocked } = enforceCnLead(plan);
        expect(demoted).toBeNull();
        expect(blocked).toBeNull();
        expect(docs).toBe(plan as unknown as Record<string, unknown>[]);
    });

    it('blocks (never synthesizes) a pool whose every item trips the vocabulary', () => {
        const plan = [doc('a', AC1_TITLE, AC1_BRIEF), doc('b', '美方对华出口管制再收紧', '')];
        const { demoted, blocked } = enforceCnLead(plan);
        expect(demoted).toBeNull();
        expect(blocked?.id).toBe('a');
        expect(blocked?.message).toContain('XY-02');
    });
});

interface StageFixture {
    workDir: string;
    runDate: string;
    plan: () => Record<string, unknown>[];
    errors: () => { itemId: string; rule: string; detail?: string }[] | null;
    refusal: () => Record<string, unknown> | null;
    run: (final: boolean) => { status: number; stdout: string; stderr: string };
    cleanup: () => void;
}

function withStageFixture(planDocs: Record<string, unknown>[]): StageFixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-cn-lead-'));
    const workDir = join(root, 'kk-news-generate-20261124-1');
    const runDate = '20261124';
    mkdirSync(join(workDir, '21-plan'), { recursive: true });
    const candidates = join(workDir, '21-plan', `${runDate}_04_quality-control-content_candidates.json`);
    const plan = join(workDir, '21-plan', `${runDate}_03_plan_plan.json`);
    const excluded = join(workDir, '21-plan', `${runDate}_03_curate_excluded.json`);
    const errors = join(workDir, '21-plan', `${runDate}_03_curate_errors.json`);
    const refusal = join(workDir, '21-plan', `${runDate}_03_cn-lead-refusal.json`);
    writeFileSync(candidates, JSON.stringify({ metadata: { docs: planDocs } }));
    writeFileSync(plan, JSON.stringify(planDocs));
    writeFileSync(excluded, JSON.stringify([]));
    return {
        workDir,
        runDate,
        plan: () => JSON.parse(readFileSync(plan, 'utf-8')) as Record<string, unknown>[],
        errors: () => {
            try {
                return JSON.parse(readFileSync(errors, 'utf-8')) as { itemId: string; rule: string; detail?: string }[];
            } catch {
                return null;
            }
        },
        refusal: () => {
            try {
                return JSON.parse(readFileSync(refusal, 'utf-8')) as Record<string, unknown>;
            } catch {
                return null;
            }
        },
        run: (final: boolean) => {
            const result = spawnSync(
                'bun',
                [RUNNER, 'daily-curate-check', workDir, runDate, ...(final ? ['--final'] : [])],
                { encoding: 'utf-8' },
            );
            return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
        },
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

describe('daily-curate-check refuses a CN-blocked lead before synthesis (0433 R3/R4)', () => {
    it('AC1 — the state-security lead is rejected with rule cn-lead:XY-02 and the plan is left for the fix pass', () => {
        const fixture = withStageFixture([doc('a', AC1_TITLE, AC1_BRIEF), doc('b', AC2_TITLE, AC2_BRIEF)]);
        const res = fixture.run(false);
        expect(res.status, res.stderr).toBe(0);
        const errors = fixture.errors();
        expect(errors).not.toBeNull();
        expect(errors?.map((entry) => entry.rule)).toContain('cn-lead:XY-02');
        expect(errors?.[0]?.itemId).toBe('a');
        expect(String(errors?.[0]?.detail)).toContain('WX-01');
        // The check reports; it does not silently rewrite the agent's plan.
        expect(fixture.plan().map((entry) => entry.id)).toEqual(['a', 'b']);
        expect(res.stderr).toContain('cn-lead');
        fixture.cleanup();
    });

    it('AC2 — the product lead passes and the run continues to the floor gate', () => {
        const fixture = withStageFixture([doc('a', AC2_TITLE, AC2_BRIEF), doc('b', AC1_TITLE, AC1_BRIEF)]);
        const res = fixture.run(false);
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.errors()).toBeNull();
        expect(res.stdout).toContain('curate-check: accepted');
        fixture.cleanup();
    });

    it('--final demotes a tripping fallback lead deterministically (no agent on that path)', () => {
        const fixture = withStageFixture([doc('a', AC1_TITLE, AC1_BRIEF), doc('b', AC2_TITLE, AC2_BRIEF)]);
        const res = fixture.run(true);
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.plan().map((entry) => entry.id)).toEqual(['b', 'a']);
        expect(fixture.errors()).toBeNull();
        expect(res.stderr).toContain('cn-lead');
        fixture.cleanup();
    });

    it('--final refuses (no synthesis) when every candidate trips, and records why', () => {
        const fixture = withStageFixture([
            doc('a', AC1_TITLE, AC1_BRIEF),
            doc('b', '美方对华出口管制再收紧', '实体清单新增十二家算力公司。'),
        ]);
        const res = fixture.run(true);
        expect(res.status).not.toBe(0);
        const refusal = fixture.refusal();
        expect(refusal).not.toBeNull();
        expect(refusal?.rule).toBe('cn-lead:XY-02');
        expect(String(refusal?.message)).toContain('XY-02');
        expect(String(res.stderr)).toContain('cn-lead');
        fixture.cleanup();
    });
});

/**
 * Review visit 2 measured these 8 plausible XY-02/WX-01-class leads as PASSING the gate: the incident
 * shape was caught, a routine re-phrasing of it was not — so the day would still pay for the TTS pass.
 * The vocabulary must name the class, not one incident's phrasing.
 */
const TRADE_CONTROL_LEAD_SHAPES = [
    '美国商务部发布 AI 芯片出口新规',
    '美方收紧 AI 芯片出口许可，英伟达对华出货受限',
    '英伟达 H200 获准对华出口，许可证制度落地',
    '美国对华加征 25% 芯片关税',
    '美国商务部对华芯片出口许可收紧，中国厂商转向国产替代',
    '台积电对华出货需申请许可，先进制程受限',
    '台湾地区选举结果影响半导体政策',
    'OpenAI 与美军签署试点合同',
];

describe('cn-lead-gate vocabulary covers the class, not one incident (0433 R1/R3)', () => {
    it.each(TRADE_CONTROL_LEAD_SHAPES)('trips %s', (title) => {
        const scan = scanCnLead(title, '');
        expect(scan.hits.length).toBeGreaterThan(0);
    });

    it('still passes an ordinary product release', () => {
        expect(scanCnLead(AC2_TITLE, AC2_BRIEF).hits).toEqual([]);
        expect(scanCnLead('小米发布新一代旗舰手机，影像与续航升级', '').hits).toEqual([]);
        expect(scanCnLead('Anthropic raises a new round at a higher valuation', '').hits).toEqual([]);
    });
});

/**
 * Review visit 3 measured the residual gap: enumeration catches keyword-dense leads but only ~6/23
 * ordinarily-written class leads. The two-signal detector (AI-industry object × policy action) must
 * close that WITHOUT turning the gate into a keyword filter on ordinary product news.
 */
const ORDINARY_CLASS_LEADS = [
    '美国拟进一步收紧对华芯片出口',
    '美国收紧 AI 芯片出口规则，供应商需申请许可',
    '国会就 AI 芯片举行听证',
    '白宫发布人工智能行政令',
    '两会代表提议加快算力基础设施建设',
    '台海局势影响半导体供应链',
    '欧盟委员会对英伟达启动反垄断调查',
];

const ORDINARY_PRODUCT_LEADS = [
    'Anthropic 发布 Claude Opus 5：上下文窗口扩至两百万 token',
    '小米发布新一代旗舰手机，影像与续航升级',
    'Anthropic raises a new round at a higher valuation',
    'OpenAI 更新模型使用政策，新增企业级审计日志',
    '英伟达发布新一代数据中心 GPU，能效提升四成',
    '某开源大模型在代码榜单上超过闭源对手',
];

describe('cn-lead-gate two-signal detector (0433 R3, review visit 3)', () => {
    it.each(ORDINARY_CLASS_LEADS)('trips the ordinarily-written class lead %s', (title) => {
        expect(scanCnLead(title, '').hits.length).toBeGreaterThan(0);
    });

    it.each(ORDINARY_PRODUCT_LEADS)('still passes the product lead %s', (title) => {
        expect(scanCnLead(title, '').hits).toEqual([]);
    });
});

/** Review visit 4's material misses: the domestic policy surface names 人工智能, and ordinary
 *  administrative acts are 办法 / 行动计划 / 约谈 / 规范 — not the enumerated compounds. */
const REVIEW_V4_CLASS_LEADS = [
    '中国网信办发布生成式 AI 服务管理新办法',
    '国家网信办约谈多家大模型企业',
    '工信部发布人工智能产业发展行动计划',
    '多地出台人工智能产业扶持办法',
    '中央经济工作会议定调人工智能发展方向',
    '军控谈判或影响 AI 芯片供应链',
    '军用无人机搭载新款 AI 推理芯片',
];

/** …and the product-usage-policy family must stay clean whichever noun it uses. */
const PRODUCT_POLICY_LEADS = [
    'OpenAI 更新大模型使用政策',
    'OpenAI 更新大模型使用规则，新增审计日志',
    '国内厂商发布大模型应用规范指南',
    '英伟达更新 GPU 驱动规则说明',
];

describe('cn-lead-gate domestic policy surface (0433 R3, review visit 4)', () => {
    it.each(REVIEW_V4_CLASS_LEADS)('trips %s', (title) => {
        expect(scanCnLead(title, '').hits.length).toBeGreaterThan(0);
    });

    it.each(PRODUCT_POLICY_LEADS)('still passes the product-policy lead %s', (title) => {
        expect(scanCnLead(title, '').hits).toEqual([]);
    });
});
