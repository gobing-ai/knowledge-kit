import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { YAML } from 'bun';
import {
    buildNewsVoiceScript,
    main,
    parseStyleContract,
    processGeneratorIO,
    type ScriptPlan,
    type ScriptPlanValidation,
    type StyleContract,
    VoiceScriptSchema,
    validateScriptPlan,
} from '../src/index';

// F613: the shipped style contract and the runtime validator are kk sidecars; the tests read the
// real files (not copies) so contract drift fails loud here first.
const STYLE_SIDECAR = join(import.meta.dir, '..', '..', '..', 'kk', 'scripts', 'daily-voice-style.zh.md');
const VOICESCRIPT_VALIDATOR = join(import.meta.dir, '..', '..', '..', 'kk', 'scripts', 'validate-voicescript.ts');

/**
 * The 2026-09-24 US–China item (`.works/…/20260924_03_plan_plan.json`, body trimmed but still
 * mentioning 出口管制/芯片), checked in because `.works/` is gitignored. The trimmed body keeps the
 * 芯片 hit so the template path still fires the hardware bucket line that misfired on the real run.
 */
const FIXTURE_DOC: Doc = JSON.parse(
    readFileSync(join(import.meta.dir, 'fixtures', '20260924-us-china-doc.json'), 'utf-8'),
);

/** Second item with a disjoint insight bucket (电力/算力), so template-path parity has 2 insights. */
const ENERGY_DOC: Doc = {
    id: 'energy-doc-1',
    title: '数据中心电力需求激增',
    body: '数据中心电力需求激增\n\n新的人工智能数据中心正在推高区域电网的电力需求，电力基础设施成为算力竞争的瓶颈。',
    sourceUri: 'https://example.com/energy',
};

/**
 * A valid plan for the two docs above. Text is deliberately free of punctuation the zh normalizer
 * rewrites (：；！…「」) so assertions can match the plan text verbatim after normalization.
 */
function twoDocPlan(): ScriptPlan {
    return {
        version: 1,
        intro: '今天我们聊两件事，一场牵动全局的安全会谈，和一场看得见的电力较量。',
        outro: '无论是安全规则还是电力瓶颈，AI的下一步都取决于这些看不见的基础。',
        items: [
            {
                id: '520246ce54c2a6e6',
                lead: '我们先从一场备受关注的安全会谈说起。',
                insight: '这场对话的看点在于，安全通报机制能否在竞争尚存的两国之间建立最基础的信任。',
            },
            {
                id: 'energy-doc-1',
                lead: '再把目光转向脚下的电网。',
                insight: '电力缺口提醒我们，模型的进步最终要由物理世界的基础设施来买单。',
            },
        ],
    };
}

/** Set plan env vars for one test and restore the previous process-global state afterwards. */
async function withPlanEnv(env: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

describe('F613 R1 — style contract sidecar', () => {
    it('parseStyleContract reads the real shipped sidecar: caps and the full banned list', () => {
        const style = parseStyleContract(readFileSync(STYLE_SIDECAR, 'utf-8'));
        expect(style.caps).toEqual({ intro: 120, outro: 120, lead: 60, insight: 160 });
        // every current zhInsightFor canned line is banned, so a plan can never reuse them
        for (const canned of [
            '在各种技术光环背后，正是这样专注而不知疲倦的底层攻坚者，为今天整个大模型生态奠定了最坚实的技术基石。',
            '这其实释放了一个非常明确的信号：AI竞争的下半场，已经不再只是单纯拼模型参数，更是电力、能源和全栈工业基础设施的硬核较量。',
            '真正被重新定义的，是硬件层承担的安全与算力责任：把能力做进硅片层更可靠、也更难绕过，但生态锁定的代价需要一起算进去。',
            '我个人觉得，这次最大的看点是内容创作门槛的再次降低。不过正如团队提到的，如何平衡创作自由与防止低质内容泛滥，会是整个行业接下来最值得观察的关键考题。',
            '这项进展反映出资本与产业界正在加速形成合力，后续实际业务场景的落地效果非常值得我们持续跟进。',
            '这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。',
        ]) {
            expect(style.banned).toContain(canned);
        }
        for (const opener of ['首先', '接着', '最后']) expect(style.banned).toContain(opener);
        for (const label of ['可做角度', '背景', '潜在影响', '读者宜另行核实', '仍待验证']) {
            expect(style.banned).toContain(label);
        }
    });

    it('parseStyleContract throws on a missing or invalid json block', () => {
        expect(() => parseStyleContract('a contract with no machine-readable block')).toThrow();
        expect(() => parseStyleContract('```json\n{"caps":{"intro":120}}\n```')).toThrow();
        expect(() => parseStyleContract('```json\nnot json\n```')).toThrow();
    });
});

describe('F613 R2 — validateScriptPlan rules', () => {
    const style: StyleContract = {
        caps: { intro: 120, outro: 120, lead: 60, insight: 160 },
        banned: [
            '首先',
            '背景',
            '这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。',
        ],
    };
    const docs: Doc[] = [FIXTURE_DOC, ENERGY_DOC];

    it('accepts a valid plan and returns it parsed', () => {
        const result = validateScriptPlan(twoDocPlan(), docs, style);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.plan.version).toBe(1);
            expect(result.plan.items.map((item) => item.id)).toEqual(['520246ce54c2a6e6', 'energy-doc-1']);
        }
    });

    it('rejects a wrong shape or version with the schema rule at itemId episode', () => {
        const schemaError: ScriptPlanValidation = { ok: false, errors: [{ itemId: 'episode', rule: 'schema' }] };
        expect(validateScriptPlan({ ...twoDocPlan(), version: 2 }, docs, style)).toEqual(schemaError);
        expect(validateScriptPlan({ version: 1, intro: 'x', outro: 'y' }, docs, style)).toEqual(schemaError);
        expect(validateScriptPlan({ ...twoDocPlan(), intro: '' }, docs, style)).toEqual(schemaError);
        expect(validateScriptPlan('not a plan', docs, style)).toEqual(schemaError);
    });

    it('rejects plan items whose id is not a doc (unknown-id)', () => {
        const plan = twoDocPlan();
        plan.items = [...plan.items, { id: 'no-such-doc', lead: '多出来的一条。', insight: '这条并不存在。' }];
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'no-such-doc', rule: 'unknown-id' }],
        });
    });

    it('rejects docs with no plan item (missing-item)', () => {
        const plan = twoDocPlan();
        plan.items = [plan.items[0] as ScriptPlan['items'][number]];
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'energy-doc-1', rule: 'missing-item' }],
        });
    });

    // Task 0189: a topic-boundary exclusion replaces the missing item instead of triggering
    // missing-item; bad exclusion ids fail loud like any plan item id.
    it('accepts a declared exclusion instead of missing-item, but validates its id', () => {
        const plan = twoDocPlan();
        plan.items = [plan.items[0] as ScriptPlan['items'][number]];
        plan.excluded = [{ id: 'energy-doc-1', reason: '主线为公共政策争议' }];
        expect(validateScriptPlan(plan, docs, style)).toEqual({ ok: true, plan });

        plan.excluded = [{ id: 'no-such-doc', reason: '不存在' }];
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [
                { itemId: 'no-such-doc', rule: 'unknown-id' },
                { itemId: 'energy-doc-1', rule: 'missing-item' },
            ],
        });

        plan.items = [
            plan.items[0] as ScriptPlan['items'][number],
            twoDocPlan().items[1] as ScriptPlan['items'][number],
        ];
        plan.excluded = [{ id: 'energy-doc-1', reason: '重复' }];
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'energy-doc-1', rule: 'conflict-id' }],
        });
    });

    it('rejects fields over their char cap (cap:<field>), episode fields at itemId episode', () => {
        const over = (n: number) => '好'.repeat(n);
        expect(validateScriptPlan({ ...twoDocPlan(), intro: over(121) }, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'episode', rule: 'cap:intro' }],
        });
        expect(validateScriptPlan({ ...twoDocPlan(), outro: over(121) }, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'episode', rule: 'cap:outro' }],
        });
        const longLead = twoDocPlan();
        longLead.items[0] = { ...(longLead.items[0] as ScriptPlan['items'][number]), lead: over(61) };
        expect(validateScriptPlan(longLead, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: '520246ce54c2a6e6', rule: 'cap:lead' }],
        });
        const longInsight = twoDocPlan();
        longInsight.items[1] = { ...(longInsight.items[1] as ScriptPlan['items'][number]), insight: over(161) };
        expect(validateScriptPlan(longInsight, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'energy-doc-1', rule: 'cap:insight' }],
        });
        // boundary: exactly at the cap is valid
        const atCap = twoDocPlan();
        atCap.intro = over(120);
        expect(validateScriptPlan(atCap, docs, style).ok).toBe(true);
    });

    it('rejects fields containing banned phrases (banned:<phrase>)', () => {
        const openerLead = twoDocPlan();
        openerLead.items[0] = {
            ...(openerLead.items[0] as ScriptPlan['items'][number]),
            lead: '首先来聊聊大家非常关注的话题。',
        };
        expect(validateScriptPlan(openerLead, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: '520246ce54c2a6e6', rule: 'banned:首先' }],
        });

        const cannedInsight = twoDocPlan();
        cannedInsight.items[1] = {
            ...(cannedInsight.items[1] as ScriptPlan['items'][number]),
            insight: '这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。',
        };
        expect(validateScriptPlan(cannedInsight, docs, style)).toEqual({
            ok: false,
            errors: [
                {
                    itemId: 'energy-doc-1',
                    rule: 'banned:这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。',
                },
            ],
        });

        const scaffoldIntro = { ...twoDocPlan(), intro: '从背景说起，今天有两件事。' };
        expect(validateScriptPlan(scaffoldIntro, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'episode', rule: 'banned:背景' }],
        });
    });

    it('rejects the same insight text on two items (duplicate-insight)', () => {
        const plan = twoDocPlan();
        const shared = plan.items[0]?.insight ?? '';
        plan.items[1] = { ...(plan.items[1] as ScriptPlan['items'][number]), insight: shared };
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [{ itemId: 'energy-doc-1', rule: 'duplicate-insight' }],
        });
    });

    it('accumulates every violation in one result (all-or-nothing)', () => {
        const plan = twoDocPlan();
        plan.intro = '好'.repeat(121);
        plan.items[0] = {
            ...(plan.items[0] as ScriptPlan['items'][number]),
            lead: '首先来聊聊大家非常关注的话题。',
        };
        plan.items[1] = { id: 'no-such-doc', lead: '多出来的一条。', insight: '这条并不存在。' };
        expect(validateScriptPlan(plan, docs, style)).toEqual({
            ok: false,
            errors: [
                { itemId: 'no-such-doc', rule: 'unknown-id' },
                { itemId: 'energy-doc-1', rule: 'missing-item' },
                { itemId: 'episode', rule: 'cap:intro' },
                { itemId: '520246ce54c2a6e6', rule: 'banned:首先' },
            ],
        });
    });
});

describe('F613 R3 — plan substitution in buildNewsVoiceScript', () => {
    const date = new Date(2026, 8, 24);
    const docs: Doc[] = [FIXTURE_DOC, ENERGY_DOC];

    it('keeps segment count and order, emotion, speed and gap_ms identical to the template path', () => {
        const template = buildNewsVoiceScript(docs, { date, language: 'zh', voiceProfile: 'Robin' });
        const planned = buildNewsVoiceScript(docs, {
            date,
            language: 'zh',
            voiceProfile: 'Robin',
            scriptPlan: twoDocPlan(),
        });
        expect(planned.segments.length).toBe(template.segments.length);
        expect(planned.segments.map((segment) => segment.emotion)).toEqual(
            template.segments.map((segment) => segment.emotion),
        );
        expect(planned.segments.map((segment) => segment.speed)).toEqual(
            template.segments.map((segment) => segment.speed),
        );
        expect(planned.segments.map((segment) => segment.gap_ms)).toEqual(
            template.segments.map((segment) => segment.gap_ms),
        );
    });

    it('speaks the plan intro, lead-then-【title】, insight and outro; facts still come from doc.body', () => {
        const planned = buildNewsVoiceScript(docs, {
            date,
            language: 'zh',
            voiceProfile: 'Robin',
            scriptPlan: twoDocPlan(),
        });
        const texts = planned.segments.map((segment) => segment.text);
        const spoken = texts.join('\n');

        // intro: builder greeting + plan intro, template tail gone
        expect(texts[0]).toContain(
            '欢迎收听咸话咸说的AI 乱炖栏目，我是Robin。今天我们聊两件事，一场牵动全局的安全会谈',
        );
        expect(spoken).not.toContain('话不多说');
        // lead: plan bridge keeps 【title】 spoken exactly once, and the title is not in the bridge
        const leadSeg = texts.find((text) => text.includes('我们先从一场备受关注的安全会谈说起'));
        expect(leadSeg).toContain('【专家警告，特朗普的对华竞争与AI 竞赛错觉可能危及美国】');
        expect(leadSeg?.indexOf('专家警告')).toBe(leadSeg?.lastIndexOf('专家警告'));
        // insight: the plan insight is spoken in the insight slot
        const insight = planned.segments.find((segment) => segment.emotion === 'thoughtful, personal');
        expect(insight?.text).toContain('安全通报机制能否在竞争尚存的两国之间建立最基础的信任');
        // facts unchanged: body text still spoken in the fact slot
        expect(spoken).toContain('切断中国获取芯片与硬件的渠道');
        // outro: plan outro + builder sign-off
        const lastSegment = texts[texts.length - 1];
        expect(lastSegment).toContain('无论是安全规则还是电力瓶颈');
        expect(lastSegment).toContain('感谢您的收听，我是Robin');
        // 0189 R1: the AI-voice disclosure is builder-owned, so a plan outro cannot drop it.
        expect(lastSegment).toContain('AI 合成配音');
        expect(lastSegment).toContain('我们下期节目不见不散');
        expect(spoken).not.toContain('好了，以上就是');
    });

    it('matches plan items by id and lets doc order win', () => {
        const forward = twoDocPlan();
        const reversed: ScriptPlan = { ...forward, items: [...forward.items].reverse() };
        const a = buildNewsVoiceScript(docs, { date, language: 'zh', voiceProfile: 'Robin', scriptPlan: forward });
        const b = buildNewsVoiceScript(docs, { date, language: 'zh', voiceProfile: 'Robin', scriptPlan: reversed });
        expect(b.segments.map((segment) => segment.text)).toEqual(a.segments.map((segment) => segment.text));
    });

    it('en ignores the plan and keeps the template script', () => {
        const planned = buildNewsVoiceScript(docs, {
            date,
            language: 'en',
            voiceProfile: 'Robin',
            scriptPlan: twoDocPlan(),
        });
        const template = buildNewsVoiceScript(docs, { date, language: 'en', voiceProfile: 'Robin' });
        expect(planned.segments).toEqual(template.segments);
        expect(planned.segments.map((segment) => segment.text).join('')).not.toContain('今天我们聊两件事');
    });
});

describe('F613 R4 — processGeneratorIO plan handling and explicit fallback', () => {
    let testDir: string;
    let inPath: string;
    let outPath: string;
    let planPath: string;
    let stylePath: string;
    const date = new Date(2026, 8, 24);
    const options = { date, language: 'zh' as const };

    beforeEach(() => {
        testDir = join(tmpdir(), `kk-dailynews-plan-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(testDir, { recursive: true });
        inPath = join(testDir, 'input.json');
        outPath = join(testDir, 'content.json');
        planPath = join(testDir, 'plan.json');
        stylePath = join(testDir, 'style.md');
        writeFileSync(inPath, JSON.stringify([FIXTURE_DOC, ENERGY_DOC]));
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('with DAILYNEWS_SCRIPT_PLAN unset, builds from templates with scriptSource template and no errors', async () => {
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: undefined, DAILYNEWS_STYLE_FILE: undefined }, async () => {
            const content = await processGeneratorIO(inPath, outPath, options);
            expect(content.metadata?.scriptSource).toBe('template');
            expect(content.metadata?.scriptPlanErrors).toEqual([]);
        });
    });

    it('falls back byte-identically to the template body when the plan file is absent (missing-plan)', async () => {
        let plainBody = '';
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: undefined, DAILYNEWS_STYLE_FILE: undefined }, async () => {
            plainBody = (await processGeneratorIO(inPath, join(testDir, 'plain.json'), options)).body;
        });
        await withPlanEnv(
            { DAILYNEWS_SCRIPT_PLAN: join(testDir, 'absent-plan.json'), DAILYNEWS_STYLE_FILE: STYLE_SIDECAR },
            async () => {
                const fallback = await processGeneratorIO(inPath, outPath, options);
                expect(fallback.body).toBe(plainBody);
                expect(fallback.metadata?.scriptSource).toBe('template');
                expect(fallback.metadata?.scriptPlanErrors).toEqual([{ itemId: 'episode', rule: 'missing-plan' }]);
            },
        );
    });

    it('falls back with the schema rule when the plan file is unparseable', async () => {
        writeFileSync(planPath, '{not-json');
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: STYLE_SIDECAR }, async () => {
            const content = await processGeneratorIO(inPath, outPath, options);
            expect(content.metadata?.scriptSource).toBe('template');
            expect(content.metadata?.scriptPlanErrors).toEqual([{ itemId: 'episode', rule: 'schema' }]);
        });
    });

    it('falls back with the no-style rule when the style file is unreadable or has no contract block', async () => {
        writeFileSync(planPath, JSON.stringify(twoDocPlan()));
        await withPlanEnv(
            { DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: join(testDir, 'absent-style.md') },
            async () => {
                const unreadable = await processGeneratorIO(inPath, outPath, options);
                expect(unreadable.metadata?.scriptPlanErrors).toEqual([{ itemId: 'episode', rule: 'no-style' }]);
            },
        );
        writeFileSync(stylePath, 'prose only, no ```json block');
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: stylePath }, async () => {
            const unparsable = await processGeneratorIO(inPath, outPath, options);
            expect(unparsable.metadata?.scriptPlanErrors).toEqual([{ itemId: 'episode', rule: 'no-style' }]);
            expect(unparsable.metadata?.scriptSource).toBe('template');
        });
    });

    // Task 0189 topic boundary: a declared exclusion removes the doc from title/storyCount,
    // stories, and references — the episode must say, count, and cite only what it speaks.
    it('builds from a plan with an exclusion, dropping the doc from content and metadata', async () => {
        writeFileSync(stylePath, readFileSync(STYLE_SIDECAR, 'utf-8'));
        const plan = twoDocPlan();
        plan.items = [plan.items[0] as ScriptPlan['items'][number]];
        plan.excluded = [{ id: 'energy-doc-1', reason: '主线为公共政策争议' }];
        writeFileSync(planPath, JSON.stringify(plan));
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: stylePath }, async () => {
            const content = await processGeneratorIO(inPath, outPath, options);
            expect(content.metadata?.scriptSource).toBe('plan');
            expect(content.metadata?.scriptPlanErrors).toEqual([]);
            expect(content.metadata?.storyCount).toBe(1);
            const metadata = content.metadata as { stories?: { id: string }[] } | undefined;
            expect(metadata?.stories?.map((s) => s.id)).toEqual(['520246ce54c2a6e6']);
            expect(content.references?.map((r) => r.url)).toEqual([
                'https://arstechnica.com/tech-policy/2026/09/china-silent-as-us-touts-plan-for-ai-safety-alerts-that-omits-tech-experts/',
            ]);
            expect(content.body).not.toContain(ENERGY_DOC.title);
        });
    });

    it('a rejected plan falls back to templates, warns once naming every itemId/rule, and exits 0', async () => {
        const rejected = twoDocPlan();
        rejected.intro = '好'.repeat(121);
        rejected.items[0] = {
            ...(rejected.items[0] as ScriptPlan['items'][number]),
            lead: '首先来聊聊大家非常关注的话题。',
        };
        rejected.items = [rejected.items[0] as ScriptPlan['items'][number]];
        writeFileSync(planPath, JSON.stringify(rejected));

        const stderrBuffer = createBufferTarget();
        const restoreTargets = setDefaultOutputTargets({ stderr: stderrBuffer });
        try {
            await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: STYLE_SIDECAR }, async () => {
                const content = await processGeneratorIO(inPath, outPath, options);
                expect(content.metadata?.scriptSource).toBe('template');
                expect(content.metadata?.scriptPlanErrors).toEqual([
                    { itemId: 'energy-doc-1', rule: 'missing-item' },
                    { itemId: 'episode', rule: 'cap:intro' },
                    { itemId: '520246ce54c2a6e6', rule: 'banned:首先' },
                ]);
            });
        } finally {
            restoreTargets();
        }
        const warnings = stderrBuffer
            .text()
            .split('\n')
            .filter((line) => line.includes('falling back to templates'));
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('episode:cap:intro');
        expect(warnings[0]).toContain('520246ce54c2a6e6:banned:首先');
        expect(warnings[0]).toContain('energy-doc-1:missing-item');
    });

    it('a valid plan fills the text slots, stamps scriptSource plan, and the YAML passes validate-voicescript', async () => {
        writeFileSync(planPath, JSON.stringify(twoDocPlan()));
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: STYLE_SIDECAR }, async () => {
            const content = await processGeneratorIO(inPath, outPath, options);
            expect(content.metadata?.scriptSource).toBe('plan');
            expect(content.metadata?.scriptPlanErrors).toEqual([]);
            expect(ContentSchema.safeParse(JSON.parse(readFileSync(outPath, 'utf-8'))).success).toBe(true);

            const script = VoiceScriptSchema.parse(YAML.parse(content.body));
            const spoken = script.segments.map((segment) => segment.text).join('\n');
            expect(spoken).toContain('今天我们聊两件事，一场牵动全局的安全会谈');
            expect(spoken).toContain('安全通报机制能否在竞争尚存的两国之间建立最基础的信任');
            expect(spoken).not.toContain('话不多说');
            expect(spoken).not.toContain('硬件层承担的安全与算力责任');

            const yamlPath = join(testDir, 'voicescript.yaml');
            writeFileSync(yamlPath, content.body);
            const check = Bun.spawnSync([process.execPath, VOICESCRIPT_VALIDATOR, '--in', yamlPath], {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(check.exitCode).toBe(0);
        });
    });

    it('en ignores a present plan env and stamps template with no errors (builder template-builds en)', async () => {
        // 0161-review P2: script-builder's isZh guard drops the plan on en, so stamping 'plan'
        // there would report a path that never ran. Resolution is skipped entirely for en.
        writeFileSync(planPath, JSON.stringify(twoDocPlan()));
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: STYLE_SIDECAR }, async () => {
            const content = await processGeneratorIO(inPath, outPath, { date, language: 'en' as const });
            expect(content.metadata?.scriptSource).toBe('template');
            expect(content.metadata?.scriptPlanErrors).toEqual([]);
            expect(content.body).not.toContain('今天我们聊两件事');
        });
    });

    it('the CLI still exits 0 when the plan is rejected (fallback is not a failure)', async () => {
        const rejected = twoDocPlan();
        rejected.items[0] = {
            ...(rejected.items[0] as ScriptPlan['items'][number]),
            lead: '首先来聊聊大家非常关注的话题。',
        };
        writeFileSync(planPath, JSON.stringify(rejected));
        const origArgv = process.argv;
        await withPlanEnv({ DAILYNEWS_SCRIPT_PLAN: planPath, DAILYNEWS_STYLE_FILE: STYLE_SIDECAR }, async () => {
            process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath, '--language', 'zh'];
            try {
                expect(await main()).toBe(0);
                const content = JSON.parse(readFileSync(outPath, 'utf-8'));
                expect(content.metadata.scriptSource).toBe('template');
                expect(content.metadata.scriptPlanErrors).toEqual([
                    { itemId: '520246ce54c2a6e6', rule: 'banned:首先' },
                ]);
            } finally {
                process.argv = origArgv;
            }
        });
    });
});

describe('F613 R5 — 20260924 misfire regression (doc 520246ce54c2a6e6)', () => {
    const date = new Date(2026, 8, 24);

    it('with a plan grounded in the talks, the plan insight is spoken and the hardware canned line is absent', () => {
        const plan: ScriptPlan = {
            version: 1,
            intro: '今天我们把目光放在中美之间一场刚刚启动的AI安全会谈。',
            outro: '从出口管制到通报机制，竞争与合作的天平如何摆动，值得持续关注。',
            items: [
                {
                    id: '520246ce54c2a6e6',
                    lead: '我们先从这场安全会谈说起。',
                    insight: '真正的看点在于，通报机制能否在缺乏信任的竞争者之间，为AI安全提供一条最基础的沟通渠道。',
                },
            ],
        };
        const script = buildNewsVoiceScript([FIXTURE_DOC], {
            date,
            language: 'zh',
            voiceProfile: 'Robin',
            scriptPlan: plan,
        });
        const spoken = script.segments.map((segment) => segment.text).join('\n');
        expect(spoken).toContain('通报机制能否在缺乏信任的竞争者之间');
        expect(spoken).not.toContain('硬件层承担的安全与算力责任');
    });

    it('the same doc without a plan still produces that canned line, pinning the bug the plan fixes', () => {
        const script = buildNewsVoiceScript([FIXTURE_DOC], { date, language: 'zh', voiceProfile: 'Robin' });
        expect(script.segments.map((segment) => segment.text).join('\n')).toContain('硬件层承担的安全与算力责任');
    });
});
