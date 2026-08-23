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

/**
 * Synthesizes a natural, concise spoken perspective / takeaway based on the story facts.
 * Gives the monologue a demonstrative tech podcast talk feel rather than mechanical news reading.
 */
export function synthesizePersonalUnderstanding(title: string, body: string, isZh: boolean): string {
    const combined = `${title} ${body}`.toLowerCase();

    if (isZh) {
        if (/jakub|szymon|首席科学家|创始团队|技术领袖|黄金搭档/i.test(combined)) {
            return '在各种技术光环背后，正是这样专注而不知疲倦的底层攻坚者，为今天整个大模型生态奠定了最坚实的技术基石。';
        }
        if (/算力|吉瓦|工厂|电力|芯片|基础设施|基建|硬件|能源/i.test(combined)) {
            return '这其实释放了一个非常明确的信号：AI竞争的下半场，已经不再只是单纯拼模型参数，更是电力、能源和全栈工业基础设施的硬核较量。';
        }
        if (/sora|视频|生成|cameo|chatgpt/i.test(combined)) {
            return '我个人觉得，这次最大的看点是内容创作门槛的再次降低。不过正如团队提到的，如何平衡创作自由与防止低质内容泛滥，会是整个行业接下来最值得观察的关键考题。';
        }
        if (/融资|投资|市场|商业|估值|合作/i.test(combined)) {
            return '这项进展反映出资本与产业界正在加速形成合力，后续实际业务场景的落地效果非常值得我们持续跟进。';
        }
        return '这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。';
    }

    // English spoken insights
    if (/jakub|szymon|chief scientist|founding team|technical leader|partnership/i.test(combined)) {
        return 'Behind the headlines, it is relentless technical leadership and deep engineering rigor that continue to drive these foundational milestones.';
    }
    if (/compute|gigawatt|factory|power|chip|infrastructure|datacenter/i.test(combined)) {
        return 'This signals clearly that the AI frontier is no longer just about algorithms, but a massive contest of power, energy, and full-stack industrial engineering.';
    }
    if (/sora|video|generation|cameo|chatgpt/i.test(combined)) {
        return 'In my view, the biggest takeaway here is the dramatic lowering of creation barriers, while content quality governance will be the key test ahead.';
    }
    return 'This development highlights how rapidly the ecosystem is moving from experimental proofs of concept into large-scale execution.';
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
        const title = options?.title || (isZh ? '今日AI科技漫谈（暂无更新）' : 'AI Daily Briefing (No Updates)');
        const segments: VoiceScriptSegment[] = isZh
            ? [
                  {
                      text: `大家好，今天是${dateStr}。欢迎收听由${voiceProfile}为您带来的今日AI科技漫谈。今天科技圈暂无最新的精选动态。`,
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
        options?.title ||
        (isZh ? `今日AI科技漫谈（共${docs.length}条）` : `AI Daily Briefing (${docs.length} stories)`);
    const segments: VoiceScriptSegment[] = [];

    let hostName =
        (options?.speakers?.host?.name as string) ||
        voiceProfile.replace(/[-_]?(news|voice|bot|profile)$/i, '') ||
        voiceProfile;
    if (hostName.length > 0) {
        hostName = hostName.charAt(0).toUpperCase() + hostName.slice(1);
    }

    // 1. Opening segment: Conversational podcast hook + overview
    const countText = isZh ? `${formatChineseCount(docs.length)}条` : `${docs.length}`;
    const titlesSummary = docs
        .slice(0, 3)
        .map((d) => (d.title ?? '').trim())
        .filter(Boolean)
        .join('、');

    const introText = isZh
        ? `大家好，今天是${dateStr}，欢迎收听由${hostName}为您带来的今日AI科技漫谈。今天科技圈有几条非常有看点的大消息，我精选了${countText}最值得关注的重点动态来和大家聊一聊${titlesSummary ? `，包括${titlesSummary}` : ''}。话不多说，我们马上进入今天的正题。`
        : `Hello and welcome. Today is ${dateStr}. This is ${hostName} with your AI Daily Briefing. In today's episode, we have ${countText} fascinating stories from the AI world. Let's dive straight in.`;

    segments.push({
        text: normalizeBroadcastText(introText, isZh),
        gap_ms: 700, // Breathing pause before the first story
        emotion: 'confident, warm',
    });

    // 2. Story segments: demonstrative talk with facts + conversational insight
    docs.forEach((doc, idx) => {
        const isLast = idx === docs.length - 1 && docs.length > 1;
        const cleanTitle = (doc.title ?? '').trim();
        const cleanBody = (doc.body ?? '').trim();

        // Conversational lead
        const lead = isZh
            ? idx === 0
                ? `首先来聊聊大家非常关注的【${cleanTitle}】。`
                : isLast
                  ? `最后，来跟大家分享一条很有温度的幕后故事，【${cleanTitle}】。`
                  : `接着我们把目光转向另一条重要进展，【${cleanTitle}】。`
            : idx === 0
              ? `First up today, let's look at ${cleanTitle}.`
              : isLast
                ? `And finally today, let's wrap up with ${cleanTitle}.`
                : `Next, turning our attention to ${cleanTitle}.`;

        const normalizedLead = normalizeBroadcastText(lead, isZh);
        const normalizedBody = normalizeBroadcastText(cleanBody, isZh);
        const insight = synthesizePersonalUnderstanding(cleanTitle, cleanBody, isZh);
        const normalizedInsight = normalizeBroadcastText(insight, isZh);

        const factText = isZh ? `${normalizedLead}${normalizedBody}` : `${normalizedLead} ${normalizedBody}`;

        // Emit facts followed by personal insight commentary
        segments.push({
            text: factText,
            gap_ms: 500, // Natural breathing pause before giving personal perspective
            emotion: 'professional, clear',
        });
        segments.push({
            text: normalizedInsight,
            gap_ms: 800, // Distinct 800ms pause before the next story
            emotion: 'thoughtful, personal',
        });
    });

    // 3. Outro segment: Warm, conversational wrap-up
    const outroText = isZh
        ? `好了，以上就是今天AI科技漫谈的全部内容。不知道今天这几条消息有没有给您带来一些新的启发？感谢您的收听，我是${hostName}，祝您拥有充实高效的一天，我们下期节目不见不散！`
        : `That wraps up today's AI Daily Briefing. I hope today's highlights gave you some useful takeaways. Thank you for listening. This is ${hostName}, wishing you a productive and wonderful day. Until next time!`;

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
