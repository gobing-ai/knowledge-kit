import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';

export const EffectConfigSchema = z.object({
    type: z.string().min(1),
    enabled: z.boolean().optional(),
    params: z.record(z.string(), z.number()).optional(),
});

export type EffectConfig = z.infer<typeof EffectConfigSchema>;

export const VoiceSpeakerSchema = z.object({
    profile: z.string().min(1).optional(),
    profile_id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    engine: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    emotion: z.string().min(1).optional(),
    instruct: z.string().min(1).optional(),
    effects_chain: z.array(EffectConfigSchema).optional(),
    effect_preset: z.string().min(1).optional(),
    personality: z.boolean().optional(),
});

export type VoiceSpeaker = z.infer<typeof VoiceSpeakerSchema>;

export const VoiceScriptSegmentSchema = z.object({
    speaker: z.string().min(1).optional(),
    profile: z.string().min(1).optional(),
    profile_id: z.string().min(1).optional(),
    text: z.string().min(1),
    emotion: z.string().min(1).optional(),
    instruct: z.string().min(1).optional(),
    engine: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    gap_ms: z.number().int().nonnegative().optional(),
    max_chunk_chars: z.number().int().optional(),
    crossfade_ms: z.number().int().optional(),
    personality: z.boolean().optional(),
    seed: z.number().int().nonnegative().optional(),
    effects_chain: z.array(EffectConfigSchema).optional(),
    effect_preset: z.string().min(1).optional(),
});

export type VoiceScriptSegment = z.infer<typeof VoiceScriptSegmentSchema>;

export const VoiceScriptSchema = z.object({
    title: z.string().min(1),
    language: z.enum(['zh', 'en']),
    default_profile: z.string().min(1).optional(),
    default_profile_id: z.string().min(1).optional(),
    default_engine: z.string().min(1).optional(),
    default_emotion: z.string().min(1).optional(),
    default_effects_chain: z.array(EffectConfigSchema).optional(),
    default_effect_preset: z.string().min(1).optional(),
    max_chunk_chars: z.number().int().optional(),
    crossfade_ms: z.number().int().optional(),
    speakers: z.record(z.string(), VoiceSpeakerSchema).optional(),
    segments: z.array(VoiceScriptSegmentSchema).min(1),
});

export type VoiceScript = z.infer<typeof VoiceScriptSchema>;

export interface ScriptBuilderOptions {
    language?: string;
    voiceProfile?: string;
    voiceProfileId?: string;
    title?: string;
    date?: Date;
    emotion?: string;
    effectPreset?: string;
    speakers?: Record<string, VoiceSpeaker>;
}

const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export function formatChineseCount(n: number): string {
    if (n === 2) return '两';
    if (n >= 0 && n <= 10) return ZH_DIGITS[n] ?? String(n);
    return String(n);
}

export function formatBroadcastDate(date: Date, language: 'zh' | 'en'): string {
    if (language === 'zh') {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const weekday = weekdays[date.getDay()] ?? '日';
        return `${year}年${month}月${day}日，星期${weekday}`;
    }
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

export function normalizeBroadcastText(raw: string, isZh: boolean): string {
    let text = raw.trim();

    // 1. Strip markdown links, bold, headers, code, blockquotes
    // Preserves paralinguistic tags like [laugh] or [sigh] because they have no (url)
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/[*#_`>~]/g, '');
    text = text.replace(/\\"/g, '');
    text = text.replace(/["“”«»「」『』]/g, '');

    // 2. Normalize whitespace
    text = text.replace(/\s+/g, ' ');

    if (isZh) {
        text = text.replace(/[''‘’]/g, '');
        // Replace English punctuation with Chinese pauses
        text = text.replace(/[:：]/g, '，');
        text = text.replace(/[;；]/g, '。');
        text = text.replace(/--+/g, '，');
        text = text.replace(/\.{2,}/g, '。');
        text = text.replace(/([0-9]+)\s*条/g, (_, num) => `${formatChineseCount(parseInt(num, 10))}条`);
        text = text.replace(/[!！]/g, '。');
        text = text.replace(/\s*，\s*/g, '，');
        text = text.replace(/\s*。\s*/g, '。');

        // Ensure clean final period
        text = text.replace(/[，、：；\s]+$/, '');
        if (!text.endsWith('。') && !text.endsWith('？')) {
            text += '。';
        }
    } else {
        text = text.replace(/[:;]/g, ',');
        text = text.replace(/--+/g, ',');
        text = text.replace(/\.{2,}/g, '.');
        text = text.replace(/[,\s]+$/, '');
        if (!text.endsWith('.') && !text.endsWith('?')) {
            text += '.';
        }
    }

    return text;
}

export function buildNewsVoiceScript(docs: Doc[], options?: ScriptBuilderOptions): VoiceScript {
    const language = z.enum(['zh', 'en']).parse((options?.language || 'zh').toLowerCase());
    const isZh = language === 'zh';
    const voiceProfile = options?.voiceProfile || process.env.VOICEBOX_DEFAULT_PROFILE || 'Robin';
    const voiceProfileId = options?.voiceProfileId;
    const defaultEmotion = options?.emotion || 'calm, professional';
    const defaultEffectPreset = options?.effectPreset;
    const broadcastDate = options?.date ?? new Date();
    const dateStr = formatBroadcastDate(broadcastDate, language);

    if (docs.length === 0) {
        const title = options?.title || (isZh ? '今日AI快讯（暂无更新）' : 'AI Daily Briefing (No Updates)');
        const segments: VoiceScriptSegment[] = isZh
            ? [
                  {
                      text: `大家好，今天是${dateStr}。欢迎收听由${voiceProfile}为您播报的今日AI快讯。今天暂无最新的精选新闻动态。`,
                      gap_ms: 400,
                      emotion: 'calm',
                  },
                  {
                      text: `感谢您的收听，我是${voiceProfile}，我们下期节目再见。`,
                      gap_ms: 200,
                      emotion: 'warm',
                  },
              ]
            : [
                  {
                      text: `Hello and welcome. Today is ${dateStr}. This is ${voiceProfile} with your AI Daily Briefing. There are no new featured stories today.`,
                      gap_ms: 400,
                      emotion: 'calm',
                  },
                  {
                      text: `Thank you for listening. This is ${voiceProfile}, and have a great day.`,
                      gap_ms: 200,
                      emotion: 'warm',
                  },
              ];

        return VoiceScriptSchema.parse({
            title,
            language,
            default_profile: voiceProfile,
            default_profile_id: voiceProfileId,
            default_emotion: defaultEmotion,
            default_effect_preset: defaultEffectPreset,
            speakers: options?.speakers,
            segments,
        });
    }

    const title =
        options?.title || (isZh ? `今日AI快讯（共${docs.length}条）` : `AI Daily Briefing (${docs.length} stories)`);
    const segments: VoiceScriptSegment[] = [];

    const hostName =
        (options?.speakers?.host?.name as string) ||
        voiceProfile.replace(/[-_]?(news|voice|bot|profile)$/i, '') ||
        voiceProfile;

    // 1. Opening segment: Date + Self Introduction + Program Overview
    const countText = isZh ? `${formatChineseCount(docs.length)}条` : `${docs.length}`;
    const titlesSummary = docs
        .slice(0, 3)
        .map((d) => (d.title ?? '').trim())
        .filter(Boolean)
        .join('、');

    const introText = isZh
        ? `大家好，今天是${dateStr}，欢迎收听由${hostName}为您播报的今日AI快讯。在今天的节目中，我们为您精选了${countText}全球人工智能领域的重点动态${titlesSummary ? `，包括${titlesSummary}` : ''}。下面请听详细报道。`
        : `Hello and welcome. Today is ${dateStr}. This is ${hostName} with your AI Daily Briefing. In today's episode, we bring you ${countText} top stories from the world of artificial intelligence. Here is the detailed report.`;

    segments.push({
        text: normalizeBroadcastText(introText, isZh),
        gap_ms: 700, // Distinct breathing pause before the first news item
        emotion: 'confident, warm',
    });

    // 2. Story segments with natural broadcast transitional language
    const zhTransitions = [
        '首先来看第一条重点消息。',
        '接下来关注第二条动态。',
        '在另一项重要进展中。',
        '此外，行业方面。',
        '最后来看一条重要动态。',
    ];
    const enTransitions = [
        'First up today.',
        'Turning to our next story.',
        'In another key development.',
        'Moving on.',
        'And finally today.',
    ];

    docs.forEach((doc, idx) => {
        const isLast = idx === docs.length - 1 && docs.length > 1;
        const transition = isZh
            ? isLast
                ? zhTransitions[4]
                : (zhTransitions[idx % 4] ?? '接下来关注下一条动态。')
            : isLast
              ? enTransitions[4]
              : (enTransitions[idx % 4] ?? 'Next story.');

        const cleanTitle = (doc.title ?? '').trim();
        const cleanBody = (doc.body ?? '').trim();

        const storyLead = isZh ? `${transition}${cleanTitle}。` : `${transition} ${cleanTitle}.`;

        const normalizedLead = normalizeBroadcastText(storyLead, isZh);
        const normalizedBody = normalizeBroadcastText(cleanBody, isZh);

        const fullStoryText = isZh ? `${normalizedLead}${normalizedBody}` : `${normalizedLead} ${normalizedBody}`;

        segments.push({
            text: fullStoryText,
            gap_ms: 800, // Distinct 800ms pause between different news stories
            emotion: 'professional news delivery',
        });
    });

    // 3. Outro segment: Professional wrap-up
    const outroText = isZh
        ? `以上就是今天AI快讯的全部内容。感谢您的收听，我是${hostName}，祝您拥有充实高效的一天，我们下期节目再见。`
        : `That wraps up today's AI Daily Briefing. Thank you for listening. This is ${hostName}, wishing you a productive and wonderful day. We'll see you in the next episode.`;

    segments.push({
        text: normalizeBroadcastText(outroText, isZh),
        gap_ms: 300,
        emotion: 'warm, friendly',
    });

    return VoiceScriptSchema.parse({
        title,
        language,
        default_profile: voiceProfile,
        default_profile_id: voiceProfileId,
        default_emotion: defaultEmotion,
        default_effect_preset: defaultEffectPreset,
        speakers: options?.speakers,
        segments,
    });
}

export function formatVoiceScriptToYaml(script: VoiceScript): string {
    const lines: string[] = [`title: ${JSON.stringify(script.title)}`, `language: ${JSON.stringify(script.language)}`];

    if (script.default_profile) {
        lines.push(`default_profile: ${JSON.stringify(script.default_profile)}`);
    }
    if (script.default_profile_id) {
        lines.push(`default_profile_id: ${JSON.stringify(script.default_profile_id)}`);
    }
    if (script.default_engine) {
        lines.push(`default_engine: ${JSON.stringify(script.default_engine)}`);
    }
    if (script.default_emotion) {
        lines.push(`default_emotion: ${JSON.stringify(script.default_emotion)}`);
    }
    if (script.default_effect_preset) {
        lines.push(`default_effect_preset: ${JSON.stringify(script.default_effect_preset)}`);
    }
    if (script.default_effects_chain && script.default_effects_chain.length > 0) {
        lines.push('default_effects_chain:');
        for (const eff of script.default_effects_chain) {
            lines.push(`  - type: ${JSON.stringify(eff.type)}`);
            if (eff.enabled !== undefined) lines.push(`    enabled: ${eff.enabled}`);
            if (eff.params) {
                lines.push('    params:');
                for (const [k, v] of Object.entries(eff.params)) {
                    lines.push(`      ${k}: ${v}`);
                }
            }
        }
    }

    if (script.speakers && Object.keys(script.speakers).length > 0) {
        lines.push('speakers:');
        for (const [spkKey, spk] of Object.entries(script.speakers)) {
            lines.push(`  ${spkKey}:`);
            if (spk.profile) lines.push(`    profile: ${JSON.stringify(spk.profile)}`);
            if (spk.profile_id) lines.push(`    profile_id: ${JSON.stringify(spk.profile_id)}`);
            if (spk.name) lines.push(`    name: ${JSON.stringify(spk.name)}`);
            if (spk.role) lines.push(`    role: ${JSON.stringify(spk.role)}`);
            if (spk.language) lines.push(`    language: ${JSON.stringify(spk.language)}`);
            if (spk.engine) lines.push(`    engine: ${JSON.stringify(spk.engine)}`);
            if (spk.emotion) lines.push(`    emotion: ${JSON.stringify(spk.emotion)}`);
            if (spk.instruct) lines.push(`    instruct: ${JSON.stringify(spk.instruct)}`);
            if (spk.effect_preset) lines.push(`    effect_preset: ${JSON.stringify(spk.effect_preset)}`);
            if (spk.personality !== undefined) lines.push(`    personality: ${spk.personality}`);
            if (spk.effects_chain && spk.effects_chain.length > 0) {
                lines.push('    effects_chain:');
                for (const eff of spk.effects_chain) {
                    lines.push(`      - type: ${JSON.stringify(eff.type)}`);
                    if (eff.enabled !== undefined) lines.push(`        enabled: ${eff.enabled}`);
                    if (eff.params) {
                        lines.push('        params:');
                        for (const [k, v] of Object.entries(eff.params)) {
                            lines.push(`          ${k}: ${v}`);
                        }
                    }
                }
            }
        }
    }

    lines.push('segments:');
    for (const segment of script.segments) {
        lines.push(`  - text: ${JSON.stringify(segment.text)}`);
        if (segment.speaker) {
            lines.push(`    speaker: ${JSON.stringify(segment.speaker)}`);
        }
        if (segment.profile) {
            lines.push(`    profile: ${JSON.stringify(segment.profile)}`);
        }
        if (segment.profile_id) {
            lines.push(`    profile_id: ${JSON.stringify(segment.profile_id)}`);
        }
        if (segment.emotion) {
            lines.push(`    emotion: ${JSON.stringify(segment.emotion)}`);
        }
        if (segment.instruct) {
            lines.push(`    instruct: ${JSON.stringify(segment.instruct)}`);
        }
        if (segment.gap_ms !== undefined) {
            lines.push(`    gap_ms: ${segment.gap_ms}`);
        }
        if (segment.seed !== undefined) {
            lines.push(`    seed: ${segment.seed}`);
        }
        if (segment.personality !== undefined) {
            lines.push(`    personality: ${segment.personality}`);
        }
        if (segment.effect_preset) {
            lines.push(`    effect_preset: ${JSON.stringify(segment.effect_preset)}`);
        }
        if (segment.effects_chain && segment.effects_chain.length > 0) {
            lines.push('    effects_chain:');
            for (const eff of segment.effects_chain) {
                lines.push(`      - type: ${JSON.stringify(eff.type)}`);
                if (eff.enabled !== undefined) lines.push(`        enabled: ${eff.enabled}`);
                if (eff.params) {
                    lines.push('        params:');
                    for (const [k, v] of Object.entries(eff.params)) {
                        lines.push(`          ${k}: ${v}`);
                    }
                }
            }
        }
    }
    return `${lines.join('\n')}\n`;
}
