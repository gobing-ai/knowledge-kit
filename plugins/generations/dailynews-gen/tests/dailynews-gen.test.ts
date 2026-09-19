import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { YAML } from 'bun';
import {
    buildNewsVoiceScript,
    formatBroadcastDate,
    formatChineseCount,
    formatVoiceScriptToYaml,
    MAX_FACT_SEGMENT_CHARS,
    main,
    normalizeBroadcastText,
    processGeneratorIO,
    splitFactText,
    stripLeadingTitleEcho,
    stripTagMetadataLines,
    type VoiceScript,
    VoiceScriptSchema,
} from '../src/index';

const SAMPLE_DOC_1: Doc = {
    id: 'doc-1',
    title: 'OpenAI Sora 2 Launch',
    sourceUri: 'https://openai.com/blog/sora-2',
    body: 'OpenAI has released the Sora 2 video generation model with cameo avatars and enhanced video quality.',
    metadata: { sourceName: 'OpenAI Blog' },
};

const SAMPLE_DOC_2: Doc = {
    id: 'doc-2',
    title: 'Claude 3.7 Sonnet Hybrid Reasoning',
    sourceUri: 'https://anthropic.com/claude-3-7',
    body: 'Anthropic introduced Claude 3.7 Sonnet, supporting both fast response and extended thinking.',
    metadata: { sourceName: 'Anthropic News' },
};

describe('dailynews-gen plugin (0073)', () => {
    let testDir: string;
    let inPath: string;
    let outPath: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `kk-dailynews-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(testDir, { recursive: true });
        inPath = join(testDir, 'input.json');
        outPath = join(testDir, 'content.json');
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('DAILYNEWS_MAX_ITEMS caps the story count (blend can carry 50+ docs)', async () => {
        // Dogfood daily-ai-news-20260903: 64 blended docs produced 132 TTS segments (~2.2h).
        const docs: Doc[] = Array.from({ length: 30 }, (_, i) => ({
            id: `doc-${i}`,
            title: `Story ${i}`,
            sourceUri: `https://example.com/${i}`,
            body: `Body ${i}`,
        }));
        writeFileSync(inPath, JSON.stringify(docs));
        process.env.DAILYNEWS_MAX_ITEMS = '5';
        try {
            const content = await processGeneratorIO(inPath, outPath, { date: new Date(2026, 7, 22) });
            const script = VoiceScriptSchema.parse(YAML.parse(content.body));
            // R2 (0139): the default filler line is emitted at most once per episode, so five
            // same-bucket stories yield intro + 5 fact segments + 1 insight + outro (was 12 before
            // the uniqueness rule — a repeated line is worse than none).
            expect(script.segments.length).toBe(8);
        } finally {
            delete process.env.DAILYNEWS_MAX_ITEMS;
        }
    });

    it('formatBroadcastDate formats Chinese and English dates cleanly', () => {
        const testDate = new Date(2026, 7, 22); // Aug 22, 2026 (Saturday)
        const zh = formatBroadcastDate(testDate, 'zh');
        expect(zh).toContain('2026年8月22日');
        expect(zh).toContain('星期六');

        const en = formatBroadcastDate(testDate, 'en');
        expect(en).toContain('August 22, 2026');
        expect(en).toContain('Saturday');
    });

    it('formatChineseCount converts numbers to Chinese digits', () => {
        expect(formatChineseCount(1)).toBe('一');
        expect(formatChineseCount(2)).toBe('两');
        expect(formatChineseCount(3)).toBe('三');
        expect(formatChineseCount(10)).toBe('十');
    });

    it('normalizeBroadcastText cleans markdown and punctuation', () => {
        const rawZh = 'OpenAI发布**Sora 2**模型，具有[cameo](https://example.com)功能: \\"很强\\" -- 支持3条视频！';
        const cleanedZh = normalizeBroadcastText(rawZh, true);
        expect(cleanedZh).not.toContain('**');
        expect(cleanedZh).not.toContain('https://');
        expect(cleanedZh).not.toContain('\\"');
        expect(cleanedZh).toContain('三条');
        expect(cleanedZh.endsWith('。')).toBe(true);
    });

    it('R3 & R4 — generates structured Chinese broadcast VoiceScript with intro and news transitions', () => {
        const testDate = new Date(2026, 7, 22);
        const script = buildNewsVoiceScript([SAMPLE_DOC_1, SAMPLE_DOC_2], { date: testDate });
        expect(script.title).toContain('今日AI科技漫谈');
        expect(script.language).toBe('zh');
        expect(script.default_profile).toBe('Robin');
        expect(script.segments.length).toBeGreaterThanOrEqual(4); // Intro + stories + Outro

        // Segment 0: Opening with date, self intro, overview
        expect(script.segments[0]?.text).toContain('今天是2026年8月22日');
        expect(script.segments[0]?.text).toContain('欢迎收听由Robin为您带来的今日AI科技漫谈');
        expect(script.segments[0]?.text).toContain('两条最值得关注的重点动态');
        expect(script.segments[0]?.gap_ms).toBe(700);

        // Story 1: Conversational lead
        expect(script.segments[1]?.text).toContain('首先来聊聊大家非常关注的');
        expect(script.segments[1]?.text).toContain('OpenAI Sora 2 Launch');

        // Personal insight
        const allText = script.segments.map((s) => s.text).join('\n');
        expect(allText).toContain('我个人觉得');
        expect(allText).toContain('最后，来看看今天的最后一条资讯');
        expect(allText).toContain('Claude 3.7 Sonnet');

        // Outro
        const lastSegment = script.segments[script.segments.length - 1];
        expect(lastSegment?.text).toContain('以上就是今天AI科技漫谈的全部内容');
        expect(lastSegment?.text).toContain('我是Robin');
        expect(lastSegment?.gap_ms).toBe(300);
    });

    it('R3 & R4 — supports English broadcast with custom voice profile and title', () => {
        const testDate = new Date(2026, 7, 22);
        const script = buildNewsVoiceScript([SAMPLE_DOC_1], {
            language: 'en',
            voiceProfile: 'Alex',
            title: 'Custom Daily Briefing',
            date: testDate,
        });

        expect(script.title).toBe('Custom Daily Briefing');
        expect(script.language).toBe('en');
        expect(script.default_profile).toBe('Alex');
        expect(script.segments.length).toBeGreaterThanOrEqual(3); // Intro + 1 story + Outro
        expect(script.segments[0]?.text).toContain('This is Alex with your AI Daily Briefing');
        expect(script.segments[1]?.text).toContain("First up today, let's look at");
        const lastSegment = script.segments[script.segments.length - 1];
        expect(lastSegment?.text).toContain("That wraps up today's AI Daily Briefing");
    });

    it('R6 — handles empty Doc[] input gracefully with fallback script', () => {
        const scriptZh = buildNewsVoiceScript([], { language: 'zh' });
        expect(scriptZh.segments.length).toBe(2);
        expect(scriptZh.segments[0]?.text).toContain('今天科技圈暂无最新的精选动态');

        const scriptEn = buildNewsVoiceScript([], { language: 'en' });
        expect(scriptEn.segments.length).toBe(2);
        expect(scriptEn.segments[0]?.text).toContain('There are no new featured stories today');
    });

    it('R3 — processGeneratorIO produces validated Content matching ContentSchema and block YAML', async () => {
        writeFileSync(inPath, JSON.stringify([SAMPLE_DOC_1, SAMPLE_DOC_2]));

        const content = await processGeneratorIO(inPath, outPath, {
            voiceProfile: 'Robin',
            language: 'zh',
        });

        expect(content.format).toBe('markdown');
        expect(content.title).toContain('今日AI科技漫谈');
        expect(content.references?.length).toBe(2);
        expect(content.metadata?.generator).toBe('kk:dailynews-gen');
        expect(content.metadata?.storyCount).toBe(2);

        expect(existsSync(outPath)).toBe(true);
        const written = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(ContentSchema.safeParse(written).success).toBe(true);

        // Verify body is block-formatted YAML deserializable into VoiceScript
        const parsedScript = Bun.YAML.parse(written.body) as VoiceScript;
        expect(parsedScript.segments.length).toBeGreaterThanOrEqual(4);
        expect(VoiceScriptSchema.safeParse(parsedScript).success).toBe(true);
    });

    it('supports multi-speaker discussion schema with profile_id, emotions, and effects', () => {
        const script = buildNewsVoiceScript([SAMPLE_DOC_1], {
            voiceProfile: 'Robin',
            voiceProfileId: 'prof-robin-id',
            emotion: 'excited',
            effectPreset: 'Radio',
            speakers: {
                host: {
                    profile: 'Robin',
                    profile_id: 'prof-robin-id',
                    name: 'Robin Min',
                    role: 'Host',
                    emotion: 'confident',
                    effect_preset: 'Radio',
                    personality: true,
                },
                guest: {
                    profile: 'Narrator',
                    name: 'Alex',
                    role: 'Guest',
                    emotion: 'thoughtful',
                },
            },
        });

        expect(script.default_profile_id).toBe('prof-robin-id');
        expect(script.default_emotion).toBe('excited');
        expect(script.default_effect_preset).toBe('Radio');
        expect(script.speakers?.host?.profile_id).toBe('prof-robin-id');
        expect(script.speakers?.host?.effect_preset).toBe('Radio');
        expect(script.speakers?.guest?.role).toBe('Guest');

        const yaml = Bun.YAML.stringify(script);
        expect(yaml).toContain('prof-robin-id');
        expect(yaml).toContain('Radio');

        // Test formatVoiceScriptToYaml with full speaker and effect properties
        const fullScript: VoiceScript = {
            title: 'Full Options Script',
            language: 'zh',
            default_profile: 'Robin',
            default_profile_id: 'prof-1',
            default_engine: 'qwen',
            default_emotion: 'authoritative',
            default_effect_preset: 'Radio',
            default_effects_chain: [{ type: 'highpass', enabled: true, params: { cutoff_frequency_hz: 100 } }],
            speakers: {
                host: {
                    profile: 'Robin',
                    profile_id: 'prof-1',
                    name: 'Robin',
                    role: 'Host',
                    language: 'zh',
                    engine: 'qwen',
                    emotion: 'warm',
                    instruct: 'Speak clearly',
                    effect_preset: 'Radio',
                    personality: true,
                    effects_chain: [{ type: 'gain', enabled: true, params: { gain_db: 2 } }],
                },
            },
            segments: [
                {
                    speaker: 'host',
                    profile: 'Robin',
                    profile_id: 'prof-1',
                    text: 'Hello world',
                    emotion: 'cheerful',
                    instruct: 'Speak loud',
                    gap_ms: 500,
                    seed: 123,
                    personality: false,
                    effect_preset: 'Robotic',
                    effects_chain: [{ type: 'reverb', enabled: true, params: { room_size: 0.5 } }],
                },
            ],
        };

        const formattedYaml = formatVoiceScriptToYaml(fullScript);
        expect(formattedYaml).toContain('default_engine: "qwen"');
        expect(formattedYaml).toContain('cutoff_frequency_hz: 100');
        expect(formattedYaml).toContain('gain_db: 2');
        expect(formattedYaml).toContain('room_size: 0.5');
        expect(formattedYaml).toContain('seed: 123');
        expect(formattedYaml).toContain('Robotic');
    });

    it('fails loud when input JSON is missing or invalid DocList', async () => {
        writeFileSync(inPath, 'not-json');
        await expect(processGeneratorIO(inPath, outPath)).rejects.toThrow(/Invalid DocList input/);

        writeFileSync(inPath, JSON.stringify({ not: 'an-array' }));
        await expect(processGeneratorIO(inPath, outPath)).rejects.toThrow(/Invalid DocList input/);
    });

    it('CLI main() verifies arguments and error handling', async () => {
        writeFileSync(inPath, JSON.stringify([SAMPLE_DOC_1]));

        const origArgv = process.argv;
        try {
            // Missing arguments
            process.argv = ['bun', 'index.ts'];
            const exit1 = await main();
            expect(exit1).toBe(1);

            // Missing --out
            process.argv = ['bun', 'index.ts', '--in', inPath];
            const exit2 = await main();
            expect(exit2).toBe(1);

            // Valid execution
            process.argv = [
                'bun',
                'index.ts',
                '--in',
                inPath,
                '--out',
                outPath,
                '--language',
                'zh',
                '--voice-profile',
                'Robin',
            ];
            const exit3 = await main();
            expect(exit3).toBe(0);
            expect(existsSync(outPath)).toBe(true);
        } finally {
            process.argv = origArgv;
        }
    });
});

// ── 0139 regression fixtures (2026-09-16 run) ────────────────────────────────────────────────

/**
 * The seven translated plan items from `20260916_03_plan_plan.json`, verbatim. They are the R2
 * regression fixture: on this exact episode the energy line misfired after the Nvidia-regulation
 * and Apple items, and the creation line after the Meta and both Gemini items.
 */
const RUN_PLAN_ITEMS: Doc[] = (
    [
        {
            id: '049ed956b8239821',
            title: 'Nvidia 黄仁勋表示：AI 不需要监管，安全应由厂商自行负责',
            body: 'Nvidia 黄仁勋表示：AI 不需要监管，安全应由厂商自行负责\n\n黄仁勋认为，AI 并不是某种全新的「外星心智」，只是硬件与软件的组合，因此安全可以由每一家 AI 产品厂商自行设计。',
        },
        {
            id: '15b4350032237535',
            title: 'Meta 上线 WhatsApp Business MCP 服务器，让 AI 代理处理繁琐配置',
            body: 'Meta 上线 WhatsApp Business MCP 服务器，让 AI 代理处理繁琐配置\n\n全新的 WhatsApp Business MCP 服务器允许开发者使用 Claude、Cursor、Codex、ChatGPT 等 AI 编程代理来处理配置、消息模板、测试与故障排查。',
        },
        {
            id: '539f7b66fb8e6d78',
            title: 'AI 项目墓地更新：覆盖 Apple Siri AI 跳票与 OpenAI 超级应用混乱上线',
            body: 'AI 项目墓地更新：覆盖 Apple Siri AI 跳票与 OpenAI 超级应用混乱上线\n\n从 Apple 屡次跳票的 Siri AI，到 OpenAI 混乱上线的「超级应用」，本文梳理了那些关停或未达预期的 AI 项目。',
        },
        {
            id: 'horizon:2026-09-16-finance-news-1',
            title: 'OpenAI 据报道考虑以约 1.2 万亿美元估值融资',
            body: '英国《金融时报》报道，OpenAI 正考虑在潜在 IPO（首次公开募股）之前以约 1.2 万亿美元的估值进行新一轮融资，《纽约时报》则称估值可能高达 1.5 万亿美元；交易仍处于早期讨论阶段，尚未最终确定。\n**「背景」** OpenAI 上一轮融资于 2024 年 10 月完成，估值约为 1570 亿美元；本轮若落实，公司估值将在不到一年内提升数倍，可能成为人工智能行业迄今规模最大的私募估值之一。\n**「潜在影响」** 若融资落实，将推高市场对 AI 初创公司的定价预期，并为 OpenAI 未来 IPO 时的估值基准提供参照。\n**标签**: `#Private Markets`, `#AI/Tech`, `#IPO`, `#Venture Capital`, `#Valuation`',
        },
        {
            id: 'horizon:2026-09-16-ai-creator-1',
            title: 'Google 发布 Gemini 3.8 Live 实时语音模型，Simon Willison 推出浏览器零依赖实现',
            body: 'Google 发布了两款语音到语音模型 Gemini 3.8 Live 与 Gemini 3.8 Live Extended Thinking，定位与 OpenAI 的 GPT-Live 系列类似。Simon Willison 用一个 LLM 阅读官方文档后生成了一套浏览器端 Web UI，可在网页中选择模型与声音预设、输入可选的系统提示，并通过麦克风进行语音对话，且支持在模型说话时中途打断。该实现不使用任何第三方库，通过 WebSocket 端点 wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent 与 Gemini Live API 通信，并借助 Web Audio API 的 AudioContext 完成采集与回放。\n**「为什么现在值得注意」** 这是 Google 在实时语音到语音方向的一次模型更新，其中 Extended Thinking 变体把推理过程引入语音流，是语音交互形态上的一个变化点。不过目前来源材料中没有第三方基准、延迟数字或独立评测，实际效果差异仍待验证。\n**「可做角度」** 可做角度：从 Simon Willison 这个零依赖、单 HTML 文件的浏览器实现切入，拆解浏览器端调用 Gemini Live WebSocket API 进行实时语音对话与中途打断的关键链路，包括 WebSocket 连接建立、Web Audio API 的采集与回放、以及打断当前回复的实现方式，并对照官方 get-started-websocket 文档列出可复现的最小路径。\n**标签**: `#Google Gemini`, `#语音到语音模型`, `#多模态AI`, `#实时语音交互`, `#模型发布`',
        },
        {
            id: 'horizon:2026-09-16-tech-news-1',
            title: 'Apple 推出「参考图像」:基于 Secure Enclave 的硬件级图像真伪验证',
            body: 'Apple 发布了一种名为「参考图像」的硬件级图像真实性验证方案,通过 Secure Enclave 在图像捕获到显示的整条管线内进行端到端密码学签名。系统使用 ECDSA 与 RSA 对传感器采集的光子数据进行签名,使生成的图像成为可在新闻、保险理赔和身份核验等场景中验证真伪的参考图像。该机制依赖 Apple 的服务器进行签名校验,并要求传感器在初始化阶段生成不可恢复的私钥,这一过程引发了关于随机性来源的讨论。作为内容凭证\\(C2PA\\)生态之外的独立路径,Apple 的方案为对抗 AI 生成虚假图像提供了一条基于硬件信任根的新选择。\n**「背景」** Secure Enclave 是 Apple 自 A7 以来集成于 A 系列与 M 系列芯片中的独立安全子系统,用于在主 CPU 之外生成并保护加密密钥;内容凭证\\(C2PA\\)则是由多家厂商推动的开放标准,旨在为数字媒体附加可验证的来源与编辑历史信息。「参考图像」与 C2PA 的目标相近,但将信任根放在 Apple 自家硬件与服务器上,而非依赖开放联盟与跨厂商协议。\n**「影响」** 对于新闻机构、保险公司和身份核验服务而言,该机制可能成为可信图像采集的事实标准,但也意味着这些场景对 Apple 生态的依赖将进一步加深,形成没有 iPhone 便难以正常生活的现实门槛。\n**「社区讨论」** 社区普遍认可该方案的技术巧妙,但对通过高分辨率显示器拍摄屏幕实现的「重放攻击」、对闭源链与 Apple 服务器的集中依赖,以及「已认证真实」标签可能被滥用为叙事工具等议题提出了显著担忧。\n**标签**: `#security`, `#cryptography`, `#content-authenticity`, `#apple`, `#hardware-security`',
        },
        {
            id: 'horizon:2026-09-16-tech-news-3',
            title: 'Google 发布 Gemini 3.8 Live 与 3.8 Live Extended Thinking 实时语音模型',
            body: 'Google 宣布推出 Gemini 3.8 Live 与 Gemini 3.8 Live Extended Thinking 两款实时语音 AI 模型，围绕多语言质量、延迟与可靠性引发广泛社区讨论。Extended Thinking 变体为语音交互引入了推理模式，基础版本则侧重对话级语音表现。社区反馈呈现分化：有用户称赞其多语言流畅度（包括南非荷兰语等小语种）、语音音色自然、延迟较低，并支持此前被多数近期版本排除的 Workspace 账号；也有用户批评模型在连续对话中丢失上下文，以及回复中夹带未询问的商品链接。值得注意的是，原始博客内容本次未能获取，且「3.8」这一版本编号与 Google 历来 Gemini 的命名习惯存在差异，读者宜另行核实具体版本号。\n**「背景」** Gemini Live 是 Google 推出的实时语音对话模型系列，其上一代版本 Gemini 3.1 Flash Live 已在数月前发布，此次的 3.8 Live 与 3.8 Live Extended Thinking 隶属同一家族，与上月新加入的 Gemini 3.5 Transcribe 共同构成不断扩展的 Gemini Audio 体系。两个新模型均采用原生语音到语音（speech-to-speech）架构，可在语音层面直接完成对话处理，区别在于 Extended Thinking 版本引入了更深入的并行推理以应对复杂任务。需要指出的是，Google 既往公开的 Gemini 版本号通常采用 1.5、2.0、2.5、3.0 等整数或半整数形式，“3.8”这一编号目前仅见于官方博客与第三方媒体报道，因此读者最好结合 Google 官方发布渠道进一步核实。\n**「影响」** 早期测试者报告 Google 实时语音 AI 在多语言音色与延迟上有所改善，但仍有用户遭遇上下文丢失与广告链接插入，可靠性表现不一。Workspace 账号此前被多数近期语音版本拒之门外，本次据一名测试者反馈已恢复可用。\n**「社区讨论」** Hacker News 评论者观点分歧：正面反馈集中在小语种（如南非荷兰语）发音质量、语音自然度、低延迟以及 Workspace 账号重新可用；批评意见指出模型在下一条消息即丢失上下文，且回复中夹带未请求的商品链接；另有用户询问 Gemini 何时能超越 Fable、Astra 等竞品，以及 Gemini 4 何时发布。\n**标签**: `#ai`, `#google`, `#gemini`, `#voice-ai`, `#llm`',
        },
    ] as { id: string; title: string; body: string }[]
).map((item) => ({
    ...item,
    sourceUri: `https://example.com/${item.id}`,
    mediaType: 'text/markdown',
    metadata: { sourceName: 'example.com' },
}));

/** Occurrences of a needle in a haystack — used to assert "at most once per episode". */
function occurrences(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

describe('0139 R3 — tag metadata lines', () => {
    const body = [
        '所谓「突破」，是指 AI 模型在受控评估环境中自主获取对外部系统的访问能力。',
        '**「影响」** 该事件凸显了凭据管理的重要性。',
        '**标签**: `#AI safety`, `#AI security`, `#red-teaming`',
    ].join('\n');

    it('drops the trailing 标签 metadata line plan-translate keeps in the body', () => {
        const stripped = stripTagMetadataLines(body);
        expect(stripped).not.toContain('标签');
        expect(stripped.endsWith('重要性。')).toBe(true);
    });

    it('absorbs the bold/comma variants the validator fails loud on', () => {
        expect(stripTagMetadataLines('**标签**, `#ai`')).toBe('');
        expect(stripTagMetadataLines('标签：a, b')).toBe('');
        expect(stripTagMetadataLines('标签，a, b')).toBe('');
    });

    it('leaves a body without a 标签-labeled line untouched', () => {
        const plain = '这条新闻的标签体系值得研究。';
        expect(stripTagMetadataLines(plain)).toBe(plain);
    });
});

describe('0139 R1 — title echo', () => {
    const title = 'Nvidia 黄仁勋表示：AI 不需要监管，安全应由厂商自行负责';
    const body = `${title}\n\n黄仁勋认为，AI 并不是某种全新的「外星心智」，只是硬件与软件的组合，因此安全可以由每一家 AI 产品厂商自行设计。`;

    it('drops the title restatement plan-translate prepends to the body', () => {
        const stripped = stripLeadingTitleEcho(body, title);
        expect(stripped.startsWith('黄仁勋认为')).toBe(true);
        expect(stripped).not.toContain(title);
    });

    it('absorbs the translator inserting ， where the title had ：', () => {
        const drifted =
            'Nvidia 黄仁勋表示，AI 不需要监管，安全应由厂商自行负责\n\n黄仁勋认为，安全可以由厂商自行设计。';
        expect(stripLeadingTitleEcho(drifted, title).startsWith('黄仁勋认为')).toBe(true);
    });

    it('leaves a body that does not open with the title unchanged', () => {
        const other = '英国《金融时报》报道，OpenAI 正考虑以约 1.2 万亿美元的估值进行新一轮融资。';
        expect(stripLeadingTitleEcho(other, 'OpenAI 据报道考虑以约 1.2 万亿美元估值融资')).toBe(other);
    });

    it('speaks the item title exactly once in the emitted fact segment', () => {
        const script = buildNewsVoiceScript([RUN_PLAN_ITEMS[0] as Doc], { language: 'zh', voiceProfile: 'Robin' });
        const fact = script.segments[1]?.text ?? '';
        expect(occurrences(fact, 'Nvidia 黄仁勋表示')).toBe(1);
    });
});

describe('0139 R2 — commentary uniqueness and topic fit', () => {
    const script = buildNewsVoiceScript(RUN_PLAN_ITEMS, { language: 'zh', voiceProfile: 'Robin' });
    const spoken = script.segments.map((segment) => segment.text).join('\n');

    it('never speaks the same filler line twice in one episode', () => {
        const insights = script.segments
            .filter((segment) => segment.emotion === 'thoughtful, personal')
            .map((segment) => segment.text);
        expect(insights.length).toBeGreaterThan(0);
        expect(new Set(insights).size).toBe(insights.length);
    });

    it('never fires the energy line on this episode (Nvidia-regulation and Apple are not energy stories)', () => {
        expect(spoken).not.toContain('AI竞争的下半场');
    });

    it('never fires the creation line on this episode (Meta and Gemini are not video stories)', () => {
        expect(spoken).not.toContain('内容创作门槛的再次降低');
    });

    it('emits a colliding bucket line at most once, so later items get no commentary', () => {
        expect(occurrences(spoken, '这项新动态反映出技术演进正在进一步提速')).toBe(1); // default
        expect(occurrences(spoken, '把能力做进硅片层')).toBe(1); // hardware: Nvidia then Apple
        expect(occurrences(spoken, '资本与产业界正在加速形成合力')).toBe(1); // capital: the funding item
    });
});

describe('0139 R4 — fact-segment splitting', () => {
    it('splits the 1082-char run body at sentence boundaries, preserving the text exactly', () => {
        const body = RUN_PLAN_ITEMS[6]?.body ?? '';
        const chunks = splitFactText(body);
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_FACT_SEGMENT_CHARS);
        expect(chunks.join('')).toBe(body);
    });

    it('keeps a single sentence longer than the cap whole, and a short item unsplit', () => {
        const longSentence = `${'x'.repeat(320)}。`;
        expect(splitFactText(longSentence)).toEqual([longSentence]);
        const short = 'Nvidia 黄仁勋表示：AI 不需要监管。';
        expect(splitFactText(short)).toEqual([short]);
    });

    it('keeps every character when the text opens with punctuation or a stray clause break', () => {
        // R4's byte-identical concatenation invariant: the splitter must consume every character,
        // not only sequences that start with a non-boundary — a leading 。 was silently dropped.
        for (const text of [
            `。${'x'.repeat(400)}。`,
            `a；${'y'.repeat(400)}`,
            `
${'z'.repeat(400)}。`,
        ]) {
            const chunks = splitFactText(text);
            expect(chunks.join('')).toBe(text);
        }
    });

    it('emits every fact chunk as its own segment with the fact emotion and gap', () => {
        const script = buildNewsVoiceScript([RUN_PLAN_ITEMS[6] as Doc], { language: 'zh', voiceProfile: 'Robin' });
        const facts = script.segments.filter((segment) => segment.emotion === 'professional, clear');
        expect(facts.length).toBeGreaterThan(1);
        for (const fact of facts) {
            expect(fact.text.length).toBeLessThanOrEqual(MAX_FACT_SEGMENT_CHARS);
            expect(fact.gap_ms).toBe(500);
        }
    });
});
