import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 0138 AC9 — the daily-ai-voice content-quality seam end to end: blend → plan (annotate) → filter
 * (QC) → plan-translate stand-in → article → script (VoiceScript).
 *
 * Every stage runs the real plugin / stage-runner entrypoint (spawned, not imported), so the three
 * defect classes must compose rather than merely pass in isolation. The fixture reproduces the
 * measured 2026-09-16 shapes: aihot stubs at 234/243/255 EN chars, the 348-char substantive
 * control, the Gemini 3.8 Live pair whose zh titles score 0.417 bigram Jaccard (under the 0.6
 * pre-translate threshold, over the 0.4 post-translate one), and — verbatim from the run's
 * `20260916_03_plan_plan.json` — the two translated bodies that leaked research scaffolding into
 * published copy. The same two bodies produce the failure that killed the unattended daily run at
 * the `script` state on 2026-10-03/04: a `**「label」**` research heading landing at a VoiceScript
 * segment start, which `validate-voicescript.ts` rejects.
 */
const REPO = join(import.meta.dir, '../../..');
const PLAN_GEN = join(REPO, 'plugins/generations/episode-plan-gen/src/index.ts');
const RUNNER = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');
const PLUGINS_ROOT = join(REPO, 'plugins');

const STAMP = '20260916';

function blendDoc(id: string, title: string, body: string, source: string): Record<string, unknown> {
    return {
        id,
        title,
        body,
        sourceUri: `https://example.com/${id}`,
        mediaType: 'text/markdown',
        metadata: { source, sourceName: 'example.com', publishedAt: '2026-09-16T00:20:39.000Z' },
    };
}

const STUBS = [
    blendDoc(
        'stub-234',
        "We don't need AI regulation — leave safety to us, Nvidia's Jensen Huang says",
        'x'.repeat(234),
        'aihot',
    ),
    blendDoc(
        'stub-243',
        'The AI graveyard: a running list of projects and startups that died',
        'x'.repeat(243),
        'aihot',
    ),
    blendDoc('stub-255', 'Meta now lets AI agents handle the boring parts of WhatsApp', 'x'.repeat(255), 'aihot'),
];
const CONTROL = blendDoc('control-348', 'OpenAI 据报道考虑以约 1.2 万亿美元估值融资', 'x'.repeat(348), 'rss');

// Run item 5 (812 zh chars) — the doubled 「可做角度」 label plus the 「为什么现在值得注意」 heading.
const GEMINI_FIRST_BODY =
    'Google 发布了两款语音到语音模型 Gemini 3.8 Live 与 Gemini 3.8 Live Extended Thinking，定位与 OpenAI 的 GPT-Live 系列类似。Simon Willison 用一个 LLM 阅读官方文档后生成了一套浏览器端 Web UI，可在网页中选择模型与声音预设、输入可选的系统提示，并通过麦克风进行语音对话，且支持在模型说话时中途打断。该实现不使用任何第三方库，通过 WebSocket 端点 wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent 与 Gemini Live API 通信，并借助 Web Audio API 的 AudioContext 完成采集与回放。\n**「为什么现在值得注意」** 这是 Google 在实时语音到语音方向的一次模型更新，其中 Extended Thinking 变体把推理过程引入语音流，是语音交互形态上的一个变化点。不过目前来源材料中没有第三方基准、延迟数字或独立评测，实际效果差异仍待验证。\n**「可做角度」** 可做角度：从 Simon Willison 这个零依赖、单 HTML 文件的浏览器实现切入，拆解浏览器端调用 Gemini Live WebSocket API 进行实时语音对话与中途打断的关键链路，包括 WebSocket 连接建立、Web Audio API 的采集与回放、以及打断当前回复的实现方式，并对照官方 get-started-websocket 文档列出可复现的最小路径。\n**标签**: `#Google Gemini`, `#语音到语音模型`, `#多模态AI`, `#实时语音交互`, `#模型发布`';

// Run item 7 (1082 zh chars) — 「背景」「影响」「社区讨论」 headings plus mid-paragraph hedging.
const GEMINI_SECOND_BODY =
    'Google 宣布推出 Gemini 3.8 Live 与 3.8 Live Extended Thinking 两款实时语音 AI 模型，围绕多语言质量、延迟与可靠性引发广泛社区讨论。Extended Thinking 变体为语音交互引入了推理模式，基础版本则侧重对话级语音表现。社区反馈呈现分化：有用户称赞其多语言流畅度（包括南非荷兰语等小语种）、语音音色自然、延迟较低，并支持此前被多数近期版本排除的 Workspace 账号；也有用户批评模型在连续对话中丢失上下文，以及回复中夹带未询问的商品链接。值得注意的是，原始博客内容本次未能获取，且「3.8」这一版本编号与 Google 历来 Gemini 的命名习惯存在差异，读者宜另行核实具体版本号。\n**「背景」** Gemini Live 是 Google 推出的实时语音对话模型系列，其上一代版本 Gemini 3.1 Flash Live 已在数月前发布，此次的 3.8 Live 与 3.8 Live Extended Thinking 隶属同一家族，与上月新加入的 Gemini 3.5 Transcribe 共同构成不断扩展的 Gemini Audio 体系。两个新模型均采用原生语音到语音（speech-to-speech）架构，可在语音层面直接完成对话处理，区别在于 Extended Thinking 版本引入了更深入的并行推理以应对复杂任务。需要指出的是，Google 既往公开的 Gemini 版本号通常采用 1.5、2.0、2.5、3.0 等整数或半整数形式，“3.8”这一编号目前仅见于官方博客与第三方媒体报道，因此读者最好结合 Google 官方发布渠道进一步核实。\n**「影响」** 早期测试者报告 Google 实时语音 AI 在多语言音色与延迟上有所改善，但仍有用户遭遇上下文丢失与广告链接插入，可靠性表现不一。Workspace 账号此前被多数近期语音版本拒之门外，本次据一名测试者反馈已恢复可用。\n**「社区讨论」** Hacker News 评论者观点分歧：正面反馈集中在小语种（如南非荷兰语）发音质量、语音自然度、低延迟以及 Workspace 账号重新可用；批评意见指出模型在下一条消息即丢失上下文，且回复中夹带未请求的商品链接；另有用户询问 Gemini 何时能超越 Fable、Astra 等竞品，以及 Gemini 4 何时发布。\n**标签**: `#ai`, `#google`, `#gemini`, `#voice-ai`, `#llm`';

const GEMINI_FIRST = blendDoc(
    'gemini-first',
    'Google 发布 Gemini 3.8 Live 实时语音模型，Simon Willison 推出浏览器零依赖实现',
    GEMINI_FIRST_BODY,
    'rss',
);
const GEMINI_SECOND = blendDoc(
    'gemini-second',
    'Google 发布 Gemini 3.8 Live 与 3.8 Live Extended Thinking 实时语音模型',
    GEMINI_SECOND_BODY,
    'rss',
);

/** A `kk` stub that forwards `executor run <plugin>` to the real plugin entrypoint in this checkout. */
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
            `const entry = ${JSON.stringify(PLUGINS_ROOT)} + '/generations/' + args[2] + '/src/index.ts';`,
            'const result = spawnSync("bun", [entry, ...args.slice(3)], { stdio: "inherit" });',
            'process.exit(result.status ?? 1);',
        ].join('\n'),
    );
    chmodSync(path, 0o755);
    return { PATH: `${bin}:${process.env.PATH ?? ''}` };
}

function run(entry: string, args: string[], env: Record<string, string> = {}) {
    return spawnSync('bun', [entry, ...args], { encoding: 'utf-8', env: { ...process.env, ...env } });
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

describe('0138 AC9 — daily-ai-voice content quality end to end', () => {
    it('rejects the stubs, keeps one Gemini item, and renders copy without scaffolding', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-0138-'));
        try {
            const planDir = join(dir, '21-plan');
            const articleDir = join(dir, '22-article');
            const scriptDir = join(dir, '24-script');
            mkdirSync(planDir, { recursive: true });
            mkdirSync(articleDir, { recursive: true });
            mkdirSync(scriptDir, { recursive: true });

            // 1. blend → plan mode (annotate + gate + select). The pre-translate title dedup runs at
            //    0.6, so the Gemini pair survives it — exactly the 2026-09-16 defect (0.4225 zh).
            const blend = join(dir, 'blended.json');
            const planContent = join(planDir, `${STAMP}_03_plan_content.json`);
            writeFileSync(blend, JSON.stringify([...STUBS, CONTROL, GEMINI_FIRST, GEMINI_SECOND]));
            const planned = run(PLAN_GEN, ['--in', blend, '--out', planContent], {
                EPISODE_PLAN_DATE: STAMP,
                EPISODE_PLAN_MAX_ITEMS: '10',
            });
            expect(planned.status).toBe(0);

            const annotated = join(planDir, `${STAMP}_04_quality-control-content_annotated.json`);
            const annotatedDocs = readJson<{ metadata: { docs: { id: string; body: string }[] } }>(planContent).metadata
                .docs;
            expect(annotatedDocs).toHaveLength(6);
            // The plan body is the copy source for every later consumer (article, VoiceScript,
            // safety review): a research-note heading must not survive the plan funnel, or the
            // VoiceScript gate rejects the whole unattended run at the `script` state.
            for (const entry of annotatedDocs) {
                expect(entry.body).not.toMatch(/\*\*\s*[「『][^」』\n]{1,80}[」』]\s*\*\*/);
            }
            writeFileSync(annotated, JSON.stringify(annotatedDocs));

            // 2. filter mode (QC) — the stubs must die on the body floor.
            const candidates = join(planDir, `${STAMP}_04_quality-control-content_candidates.json`);
            const filtered = run(PLAN_GEN, ['--in', annotated, '--out', candidates, '--mode', 'filter']);
            expect(filtered.status).toBe(0);

            const keptIds = readJson<{ metadata: { docs: { id: string }[] } }>(candidates).metadata.docs.map(
                (entry) => entry.id,
            );
            expect(keptIds).toEqual(['control-348', 'gemini-first', 'gemini-second']);

            const rejected = readJson<{ rejected: { doc: { id: string }; reasons: string[] }[] }>(
                join(planDir, `${STAMP}_04_quality-control-content_candidates.rejected.json`),
            );
            for (const stub of STUBS) {
                const entry = rejected.rejected.find((candidate) => candidate.doc.id === stub.id);
                expect(entry?.reasons).toContain('quality:1<2');
            }

            // 3. plan-translate stand-in: the kept docs become plan.json (same order, same ids).
            const planIn = join(planDir, `${STAMP}_03_plan_plan.json`);
            writeFileSync(
                planIn,
                JSON.stringify(readJson<{ metadata: { docs: unknown[] } }>(candidates).metadata.docs),
            );

            // 4. article stage — post-translation dedup (0.4) then render.
            const article = run(RUNNER, ['daily-article', dir, STAMP, ''], fakeKk(dir));
            expect(article.status).toBe(0);
            expect(article.stderr).toContain('near-duplicate plan item(s)');

            const deduped = readJson<{ id: string }[]>(planIn);
            expect(deduped.map((entry) => entry.id)).toEqual(['control-348', 'gemini-first']);

            const markdown = readFileSync(join(articleDir, `${STAMP}_06_article_article.md`), 'utf-8');
            expect(markdown.match(/^## /gm)).toHaveLength(2); // the pair collapsed to one item
            expect(markdown).toContain('Gemini 3.8 Live 实时语音模型');
            expect(markdown).not.toContain('3.8 Live Extended Thinking 实时语音模型');
            for (const label of ['可做角度', '为什么现在值得注意', '社区讨论', '背景', '影响']) {
                expect(markdown).not.toContain(`**「${label}」**`);
            }
            expect(markdown).not.toContain('读者宜另行核实');
            expect(markdown).not.toContain('仍待验证');

            // 5. script stage — the research-note headings must not survive into spoken copy. The
            //    stage validates its own write (validate-voicescript.ts), so a leaking heading exits
            //    non-zero exactly like the 2026-10-04 scheduler run ("segment 19 opens with a
            //    research scaffold label").
            const script = run(RUNNER, ['daily-script', dir, STAMP, '', 'zh', '', 'Robin'], fakeKk(dir));
            expect(script.status).toBe(0);

            const voicescript = readFileSync(join(scriptDir, `${STAMP}_08_script_voicescript.yaml`), 'utf-8');
            const segments = [...voicescript.matchAll(/^ {2}- text: "(.*)"$/gm)].map((match) => match[1] ?? '');
            expect(segments.length).toBeGreaterThan(2); // greeting + facts + sign-off
            for (const text of segments) {
                expect(text).not.toMatch(
                    /^(?:\*\*)?[「『]?(?:背景|潜在影响|可做角度|为什么现在值得注意|社区讨论)[」』]?(?:\*\*)?(?:[：:，,]|\s|$)/,
                );
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
