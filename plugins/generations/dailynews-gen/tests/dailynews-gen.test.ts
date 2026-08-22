import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { buildNewsVoiceScript, main, processGeneratorIO, type VoiceScript, VoiceScriptSchema } from '../src/index';

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

    it('R3 & R4 — generates structured Chinese broadcast VoiceScript by default', () => {
        const script = buildNewsVoiceScript([SAMPLE_DOC_1, SAMPLE_DOC_2]);
        expect(script.title).toContain('今日AI快讯');
        expect(script.language).toBe('zh');
        expect(script.default_profile).toBe('Robin');
        expect(script.segments.length).toBe(4); // Intro + 2 stories + Outro

        expect(script.segments[0]?.text).toContain('欢迎收听今日AI快讯');
        expect(script.segments[0]?.gap_ms).toBe(600);

        expect(script.segments[1]?.text).toContain('第 1 条动态：OpenAI Sora 2 Launch');
        expect(script.segments[1]?.gap_ms).toBe(500);

        expect(script.segments[2]?.text).toContain('第 2 条动态：Claude 3.7 Sonnet Hybrid Reasoning');
        expect(script.segments[2]?.gap_ms).toBe(500);

        expect(script.segments[3]?.text).toContain('以上就是今天AI快讯的全部精选内容');
        expect(script.segments[3]?.gap_ms).toBe(300);
    });

    it('R3 & R4 — supports English broadcast with custom voice profile and title', () => {
        const script = buildNewsVoiceScript([SAMPLE_DOC_1], {
            language: 'en',
            voiceProfile: 'Alex',
            title: 'Custom Daily Briefing',
        });

        expect(script.title).toBe('Custom Daily Briefing');
        expect(script.language).toBe('en');
        expect(script.default_profile).toBe('Alex');
        expect(script.segments.length).toBe(3); // Intro + 1 story + Outro
        expect(script.segments[0]?.text).toContain('Hello and welcome to your AI Daily Briefing');
        expect(script.segments[1]?.text).toContain('Story number 1: OpenAI Sora 2 Launch');
        expect(script.segments[2]?.text).toContain('That concludes our AI Daily Briefing');
    });

    it('R6 — handles empty Doc[] input gracefully with fallback script', () => {
        const scriptZh = buildNewsVoiceScript([], { language: 'zh' });
        expect(scriptZh.segments.length).toBe(2);
        expect(scriptZh.segments[0]?.text).toContain('今天暂无最新的精选新闻动态');

        const scriptEn = buildNewsVoiceScript([], { language: 'en' });
        expect(scriptEn.segments.length).toBe(2);
        expect(scriptEn.segments[0]?.text).toContain('There are no new featured stories today');
    });

    it('R3 — processGeneratorIO produces validated Content matching ContentSchema', async () => {
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

        // Verify body is valid YAML deserializable into VoiceScript
        const parsedScript = Bun.YAML.parse(written.body) as VoiceScript;
        expect(parsedScript.segments.length).toBe(4);
        expect(VoiceScriptSchema.safeParse(parsedScript).success).toBe(true);
    });

    it('fails loud when input JSON is missing or invalid DocList', async () => {
        writeFileSync(inPath, 'not-json');
        await expect(processGeneratorIO(inPath, outPath)).rejects.toThrow(/Invalid DocList input/);

        expect(() => buildNewsVoiceScript([SAMPLE_DOC_1], { language: 'fr' })).toThrow();

        writeFileSync(inPath, JSON.stringify({ not: 'an-array' }));
        await expect(processGeneratorIO(inPath, outPath)).rejects.toThrow(/Invalid DocList input/);
    });

    it('CLI main() verifies arguments and error handling', async () => {
        writeFileSync(inPath, JSON.stringify([SAMPLE_DOC_1]));

        const origArgv = process.argv;
        const originalLanguage = process.env.DAILYNEWS_LANGUAGE;
        const originalTitle = process.env.DAILYNEWS_TITLE;
        const originalProfile = process.env.VOICEBOX_DEFAULT_PROFILE;
        try {
            // Missing arguments
            process.argv = ['bun', 'index.ts'];
            const exit1 = await main();
            expect(exit1).toBe(1);

            // Missing --out
            process.argv = ['bun', 'index.ts', '--in', inPath];
            const exit2 = await main();
            expect(exit2).toBe(1);

            // Executor-compatible environment configuration.
            process.env.DAILYNEWS_LANGUAGE = 'en';
            process.env.DAILYNEWS_TITLE = 'Configured Briefing';
            process.env.VOICEBOX_DEFAULT_PROFILE = 'Alex';
            process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
            const exit3 = await main();
            expect(exit3).toBe(0);
            expect(existsSync(outPath)).toBe(true);
            const generated = JSON.parse(readFileSync(outPath, 'utf-8'));
            const script = VoiceScriptSchema.parse(Bun.YAML.parse(generated.body));
            expect(script).toMatchObject({ language: 'en', title: 'Configured Briefing', default_profile: 'Alex' });
        } finally {
            process.argv = origArgv;
            if (originalLanguage === undefined) delete process.env.DAILYNEWS_LANGUAGE;
            else process.env.DAILYNEWS_LANGUAGE = originalLanguage;
            if (originalTitle === undefined) delete process.env.DAILYNEWS_TITLE;
            else process.env.DAILYNEWS_TITLE = originalTitle;
            if (originalProfile === undefined) delete process.env.VOICEBOX_DEFAULT_PROFILE;
            else process.env.VOICEBOX_DEFAULT_PROFILE = originalProfile;
        }
    });
});
