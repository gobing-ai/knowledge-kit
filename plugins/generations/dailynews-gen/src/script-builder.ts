import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';

export const VoiceScriptSchema = z.object({
    title: z.string().min(1),
    language: z.enum(['zh', 'en']),
    default_profile: z.string().min(1).optional(),
    segments: z
        .array(
            z.object({
                text: z.string().min(1),
                gap_ms: z.number().int().nonnegative().optional(),
                instruct: z.string().min(1).optional(),
            }),
        )
        .min(1),
});

export interface VoiceScriptSegment {
    text: string;
    gap_ms?: number;
    instruct?: string;
}

export interface VoiceScript {
    title: string;
    language: string;
    default_profile?: string;
    segments: VoiceScriptSegment[];
}

export interface ScriptBuilderOptions {
    language?: string;
    voiceProfile?: string;
    title?: string;
}

export function buildNewsVoiceScript(docs: Doc[], options?: ScriptBuilderOptions): VoiceScript {
    const language = z.enum(['zh', 'en']).parse((options?.language || 'zh').toLowerCase());
    const isZh = language === 'zh';
    const voiceProfile = options?.voiceProfile || process.env.VOICEBOX_DEFAULT_PROFILE || 'Robin';

    if (docs.length === 0) {
        const title = options?.title || (isZh ? '今日AI快讯（暂无更新）' : 'AI Daily Briefing (No Updates)');
        const segments: VoiceScriptSegment[] = isZh
            ? [
                  {
                      text: '大家好，欢迎收听今日AI快讯。今天暂无最新的精选新闻动态。',
                      gap_ms: 400,
                  },
                  {
                      text: '感谢收听，我们下期再见。',
                      gap_ms: 200,
                  },
              ]
            : [
                  {
                      text: 'Hello and welcome to your AI Daily Briefing. There are no new featured stories today.',
                      gap_ms: 400,
                  },
                  {
                      text: 'Thank you for listening, and have a great day.',
                      gap_ms: 200,
                  },
              ];

        return VoiceScriptSchema.parse({
            title,
            language,
            default_profile: voiceProfile,
            segments,
        });
    }

    const title =
        options?.title || (isZh ? `今日AI快讯（共${docs.length}条）` : `AI Daily Briefing (${docs.length} stories)`);
    const segments: VoiceScriptSegment[] = [];

    // 1. Intro segment
    const introText = isZh
        ? `大家好，欢迎收听今日AI快讯。今天为您精选了 ${docs.length} 条重点动态，让我们快速浏览：`
        : `Hello and welcome to your AI Daily Briefing. Here are ${docs.length} top stories for today:`;

    segments.push({
        text: introText,
        gap_ms: 600,
    });

    // 2. Story segments
    docs.forEach((doc, idx) => {
        const storyIndex = idx + 1;
        const cleanTitle = (doc.title ?? '').trim();
        const cleanBody = (doc.body ?? '').trim();

        const storyText = isZh
            ? `第 ${storyIndex} 条动态：${cleanTitle}。${cleanBody}`
            : `Story number ${storyIndex}: ${cleanTitle}. ${cleanBody}`;

        segments.push({
            text: storyText,
            gap_ms: 500,
        });
    });

    // 3. Outro segment
    const outroText = isZh
        ? '以上就是今天AI快讯的全部精选内容。感谢您的收听，祝您拥有高效的一天。'
        : 'That concludes our AI Daily Briefing for today. Thanks for listening, and have a productive day.';

    segments.push({
        text: outroText,
        gap_ms: 300,
    });

    return VoiceScriptSchema.parse({
        title,
        language,
        default_profile: voiceProfile,
        segments,
    });
}

export function formatVoiceScriptToYaml(script: VoiceScript): string {
    const lines: string[] = [
        `title: ${JSON.stringify(script.title)}`,
        `language: ${JSON.stringify(script.language)}`,
        `default_profile: ${JSON.stringify(script.default_profile || 'Robin')}`,
        'segments:',
    ];
    for (const segment of script.segments) {
        lines.push(`  - text: ${JSON.stringify(segment.text)}`);
        if (segment.gap_ms !== undefined) {
            lines.push(`    gap_ms: ${segment.gap_ms}`);
        }
        if (segment.instruct) {
            lines.push(`    instruct: ${JSON.stringify(segment.instruct)}`);
        }
    }
    return `${lines.join('\n')}\n`;
}
