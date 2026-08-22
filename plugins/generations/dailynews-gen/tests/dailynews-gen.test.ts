import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import {
    buildNewsVoiceScript,
    formatBroadcastDate,
    formatChineseCount,
    formatVoiceScriptToYaml,
    main,
    normalizeBroadcastText,
    processGeneratorIO,
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
        expect(script.title).toContain('今日AI快讯');
        expect(script.language).toBe('zh');
        expect(script.default_profile).toBe('Robin');
        expect(script.segments.length).toBe(4); // Intro + 2 stories + Outro

        // Segment 0: Opening with date, self intro, overview
        expect(script.segments[0]?.text).toContain('今天是2026年8月22日');
        expect(script.segments[0]?.text).toContain('欢迎收听由Robin为您播报的今日AI快讯');
        expect(script.segments[0]?.text).toContain('两条全球人工智能领域的重点动态');
        expect(script.segments[0]?.gap_ms).toBe(700);

        // Segment 1: Story 1 with professional transition
        expect(script.segments[1]?.text).toContain('首先来看第一条重点消息');
        expect(script.segments[1]?.text).toContain('OpenAI Sora 2 Launch');
        expect(script.segments[1]?.gap_ms).toBe(800);

        // Segment 2: Story 2
        expect(script.segments[2]?.text).toContain('最后来看一条重要动态');
        expect(script.segments[2]?.text).toContain('Claude 3.7 Sonnet');
        expect(script.segments[2]?.gap_ms).toBe(800);

        // Segment 3: Outro
        expect(script.segments[3]?.text).toContain('以上就是今天AI快讯的全部内容');
        expect(script.segments[3]?.text).toContain('我是Robin');
        expect(script.segments[3]?.gap_ms).toBe(300);
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
        expect(script.segments.length).toBe(3); // Intro + 1 story + Outro
        expect(script.segments[0]?.text).toContain('This is Alex with your AI Daily Briefing');
        expect(script.segments[1]?.text).toContain('First up today');
        expect(script.segments[2]?.text).toContain("That wraps up today's AI Daily Briefing");
    });

    it('R6 — handles empty Doc[] input gracefully with fallback script', () => {
        const scriptZh = buildNewsVoiceScript([], { language: 'zh' });
        expect(scriptZh.segments.length).toBe(2);
        expect(scriptZh.segments[0]?.text).toContain('今天暂无最新的精选新闻动态');

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
        expect(content.title).toContain('今日AI快讯');
        expect(content.references?.length).toBe(2);
        expect(content.metadata?.generator).toBe('kk:dailynews-gen');
        expect(content.metadata?.storyCount).toBe(2);

        expect(existsSync(outPath)).toBe(true);
        const written = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(ContentSchema.safeParse(written).success).toBe(true);

        // Verify body is block-formatted YAML deserializable into VoiceScript
        const parsedScript = Bun.YAML.parse(written.body) as VoiceScript;
        expect(parsedScript.segments.length).toBe(4);
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
