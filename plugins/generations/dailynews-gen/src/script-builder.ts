import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';
import type { ScriptPlan } from './script-plan';

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
    // Per-segment playback rate (0.5–2.0). Facts read at 1.0 (precise), insights at 1.12
    // (conversational); omitted -> the generator's global default (workflow OMNIVOICE_SPEED).
    speed: z.number().min(0.5).max(2.0).optional(),
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
    /** LLM-authored spoken plan (F613). Substituted on the zh path only; en ignores it. */
    scriptPlan?: ScriptPlan;
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
 *
 * `used` is the per-episode set of lines already spoken (task 0139 R2). A colliding item gets
 * `null` — no commentary segment at all — because a repeated line is worse than none and a
 * second-choice line would be a different topic misfire (Q&A item 5).
 */
export function synthesizePersonalUnderstanding(
    title: string,
    body: string,
    isZh: boolean,
    used: Set<string>,
): string | null {
    const combined = `${title} ${body}`.toLowerCase();
    const line = isZh ? zhInsightFor(combined) : enInsightFor(combined);
    if (used.has(line)) return null;
    used.add(line);
    return line;
}

/**
 * Bucket order is first-match-wins, and the buckets are deliberately disjoint (task 0139 R2).
 * The energy line requires energy-side keywords: the pre-fix bucket matched bare
 * `芯片|硬件|工厂`, so it fired after the Nvidia-regulation and Apple Secure-Enclave items on the
 * 2026-09-16 run. Hardware/chip content now has its own line instead.
 */
function zhInsightFor(combined: string): string {
    if (/jakub|szymon|首席科学家|创始团队|技术领袖|黄金搭档/i.test(combined)) {
        return '在各种技术光环背后，正是这样专注而不知疲倦的底层攻坚者，为今天整个大模型生态奠定了最坚实的技术基石。';
    }
    if (/算力|吉瓦|电力|能源|数据中心|基础设施|基建/.test(combined)) {
        return '这其实释放了一个非常明确的信号：AI竞争的下半场，已经不再只是单纯拼模型参数，更是电力、能源和全栈工业基础设施的硬核较量。';
    }
    if (/芯片|硬件|处理器|enclave/i.test(combined)) {
        return '真正被重新定义的，是硬件层承担的安全与算力责任：把能力做进硅片层更可靠、也更难绕过，但生态锁定的代价需要一起算进去。';
    }
    // Video/creation only — bare `生成` matched every generative-AI body (Meta and both Gemini
    // items on the 2026-09-16 run) and bare `chatgpt` matched the Meta item, which is what made
    // this line a topic misfire. A product name is not a creation-barrier story.
    if (/sora|视频|生成视频|视频生成|文生视频|内容创作|cameo/i.test(combined)) {
        return '我个人觉得，这次最大的看点是内容创作门槛的再次降低。不过正如团队提到的，如何平衡创作自由与防止低质内容泛滥，会是整个行业接下来最值得观察的关键考题。';
    }
    if (/融资|投资|市场|商业|估值|合作/.test(combined)) {
        return '这项进展反映出资本与产业界正在加速形成合力，后续实际业务场景的落地效果非常值得我们持续跟进。';
    }
    return '这项新动态反映出技术演进正在进一步提速，对相关领域的实际影响也非常值得我们持续关注。';
}

/** English mirror of {@link zhInsightFor} — same bucket order, same disjointness rule. */
function enInsightFor(combined: string): string {
    if (/jakub|szymon|chief scientist|founding team|technical leader|partnership/i.test(combined)) {
        return 'Behind the headlines, it is relentless technical leadership and deep engineering rigor that continue to drive these foundational milestones.';
    }
    if (/compute|gigawatt|power|energy|datacenter|infrastructure/.test(combined)) {
        return 'This signals clearly that the AI frontier is no longer just about algorithms, but a massive contest of power, energy, and full-stack industrial engineering.';
    }
    if (/chip|hardware|processor|enclave/i.test(combined)) {
        return 'What stands out is the hardware layer quietly taking on the security and compute burden: putting the guarantee in silicon is harder to bypass, and it carries its own lock-in cost.';
    }
    if (/sora|video|video generation|content creation|cameo/i.test(combined)) {
        return 'In my view, the biggest takeaway here is the dramatic lowering of creation barriers, while content quality governance will be the key test ahead.';
    }
    return 'This development highlights how rapidly the ecosystem is moving from experimental proofs of concept into large-scale execution.';
}

/**
 * Longest fact segment the script emits (task 0139 R4).
 * ponytail: observed zh speech rates 3.4–6.1 chars/s put 300 chars at 49–88s per chunk; raise only
 * with measured evidence. 400 would reach ~117s at the slowest observed rate, where whisper
 * transcription fidelity collapsed to 0.25–0.41 on the 2026-09-16 run.
 */
export const MAX_FACT_SEGMENT_CHARS = 300;

/** Punctuation and space the translator drifts between a title and its body restatement. */
const TITLE_ECHO_NOISE_RE = /[，。、：:；;!！?？…\s「」『』【】]/g;

/**
 * Drop a leading restatement of the item title from its body (task 0139 R1).
 *
 * `plan-translate` derives each title from the body's first sentence, so the echo is always a
 * prefix with at most punctuation drift (`：` → `，`) — the rule is a deterministic significant-
 * character prefix compare, never a fuzzy/LLM similarity match (anti-pattern list). The body is
 * returned untouched whenever the normalized prefix does not equal the normalized title, and a
 * body that is *only* the restatement collapses to the empty string (the lead alone carries it).
 *
 * 20260929 dogfood: plan bodies can restate the title MORE THAN once — a bare first line plus a
 * restated line carrying a parenthetical extension (`title（来源标注日期为…）`). A single pass
 * strips only the first, so the second becomes the new head and the VoiceScript validator rejects
 * the segment. Keep stripping until the head no longer echoes; every accepted pass strictly
 * shortens the body, so the loop terminates.
 */
export function stripLeadingTitleEcho(body: string, title: string): string {
    const wanted = title.replace(TITLE_ECHO_NOISE_RE, '');
    if (wanted.length < 4) return body; // a short title would match too much of the body
    let text = body;
    for (;;) {
        let matched = '';
        let end = -1;
        for (let i = 0; i < text.length && matched.length < wanted.length; i++) {
            const kept = (text[i] ?? '').replace(TITLE_ECHO_NOISE_RE, '');
            if (kept === '') continue; // drift punctuation between title and echo
            matched += kept;
            if (matched.length >= wanted.length) end = i + 1;
        }
        if (end === -1 || matched !== wanted) return text;
        text = text.slice(end).replace(/^[，。、：:；;!！?？…\s「」『』【】]+/, '');
    }
}

/**
 * Drop `**标签**: …` metadata lines from a plan doc body (0139 R3).
 *
 * `plan-translate` keeps the research note's trailing tag line in the body it hands over; spoken
 * aloud it reads as a `标签，…` tail the script validator rejects. The line is article metadata,
 * not copy — remove whole lines that open with the 标签 label + separator; anything else is left
 * for the validator to fail loud on.
 */
const TAG_METADATA_LINE_RE = /^\s*\**\s*标签\s*\**\s*[：:，,]/;

export function stripTagMetadataLines(body: string): string {
    const kept = body
        .split('\n')
        .filter((line) => !TAG_METADATA_LINE_RE.test(line))
        .join('\n');
    return kept === body ? body : kept.trim();
}

/**
 * Split a fact text into chunks of at most `maxChars` (task 0139 R4).
 *
 * Greedy packing at clause boundaries: a chunk closes when the next clause would push it past the
 * cap, so `chunks.join('') === text` always holds — the `[\s\S]` alternative is what keeps leading
 * or stray punctuation from being dropped by the match. `；` is a boundary too: a clause-joined
 * sentence would otherwise stay whole and blow past the ~90s budget the cap exists to protect. A
 * single clause longer than the cap is emitted whole — splitting mid-thought is worse than a long
 * segment — and is left to the QC duration audit.
 */
export function splitFactText(text: string, maxChars: number = MAX_FACT_SEGMENT_CHARS): string[] {
    if (text.length <= maxChars) return [text];
    const clauses = text.match(/[^。！？…；]+[。！？…；]*|[\s\S]/g) ?? [text];
    const chunks: string[] = [];
    let current = '';
    for (const clause of clauses) {
        if (current !== '' && current.length + clause.length > maxChars) {
            chunks.push(current);
            current = clause;
            continue;
        }
        current += clause;
    }
    if (current !== '') chunks.push(current);
    return chunks.length > 0 ? chunks : [text];
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
        const title = options?.title || (isZh ? 'AI 乱炖（暂无更新）' : 'AI 乱炖 (No Updates)');
        const segments: VoiceScriptSegment[] = isZh
            ? [
                  {
                      // Task 0189 R1/R4: honest no-content episode — the copy names the show
                      // (咸话咸说) and the column (AI 乱炖), and never claims a news digest happened.
                      text: `大家好，今天是${dateStr}。欢迎收听「咸话咸说」的「AI 乱炖」栏目，我是${voiceProfile}。今天没有足够扎实的可聊内容。`,
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
                      text: `Hello and welcome. Today is ${dateStr}. This is ${voiceProfile} with AI 乱炖, our chat about AI tools, papers, and hands-on practice. There is nothing solid enough to share today.`,
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

    const title = options?.title || (isZh ? `AI 乱炖（共${docs.length}条）` : `AI 乱炖 (${docs.length} stories)`);
    const segments: VoiceScriptSegment[] = [];

    let hostName =
        (options?.speakers?.host?.name as string) ||
        voiceProfile.replace(/[-_]?(news|voice|bot|profile)$/i, '') ||
        voiceProfile;
    if (hostName.length > 0) {
        hostName = hostName.charAt(0).toUpperCase() + hostName.slice(1);
    }

    // F613: the plan owns the words on the zh path; en keeps templates (design: substitution is
    // zh-only). Items are matched to docs by id and doc order wins; plan item order is ignored.
    const scriptPlan = isZh ? options?.scriptPlan : undefined;
    const planItems = new Map((scriptPlan?.items ?? []).map((item) => [item.id, item]));

    // 1. Opening segment: Conversational podcast hook + overview
    const countText = isZh ? `${formatChineseCount(docs.length)}条` : `${docs.length}`;
    const titlesSummary = docs
        .slice(0, 3)
        .map((d) => (d.title ?? '').trim())
        .filter(Boolean)
        .join('、');

    const introText = isZh
        ? scriptPlan
            ? // F613: fixed greeting stays builder-owned; the plan only fills the slot between
              // greeting and first story (the template tail 从「今天科技圈有几条…正题。」 is replaced).
              // Task 0189 R1: the greeting names the show (咸话咸说) and the column (AI 乱炖).
              `大家好，今天是${dateStr}，欢迎收听「咸话咸说」的「AI 乱炖」栏目，我是${hostName}。${scriptPlan.intro}`
            : `大家好，今天是${dateStr}，欢迎收听「咸话咸说」的「AI 乱炖」栏目，我是${hostName}。今天我从 AI 工具、论文和实践中整理了${countText}值得聊的内容${titlesSummary ? `，包括${titlesSummary}` : ''}，咱们一条条来聊。`
        : `Hello and welcome. Today is ${dateStr}. This is ${hostName} with AI 乱炖, where we talk about AI tools, papers, and hands-on practice. In today's episode, we have ${countText} stories. Let's dive straight in.`;

    segments.push({
        text: normalizeBroadcastText(introText, isZh),
        gap_ms: 700, // Breathing pause before the first story
        emotion: 'confident, warm',
    });

    // 2. Story segments: demonstrative talk with facts + conversational insight
    const usedInsights = new Set<string>(); // one per episode (task 0139 R2)
    docs.forEach((doc, idx) => {
        const isLast = idx === docs.length - 1 && docs.length > 1;
        const cleanTitle = (doc.title ?? '').trim();
        // R1: drop the title restatement plan-translate prepends to the body, so the lead's
        // 【title】 is the only place the title is spoken for this item.
        const cleanBody = stripLeadingTitleEcho(stripTagMetadataLines((doc.body ?? '').trim()), cleanTitle);

        // Conversational lead. F613: the plan lead is a bridge that keeps 【title】 spoken exactly
        // once (0139 R1) and must not contain the title itself (style contract, R1).
        const planItem = planItems.get(doc.id);
        const lead = planItem
            ? `${planItem.lead}【${cleanTitle}】。`
            : isZh
              ? idx === 0
                  ? `首先来聊聊大家非常关注的【${cleanTitle}】。`
                  : isLast
                    ? `最后，来看看今天的最后一条资讯，【${cleanTitle}】。`
                    : `接着我们把目光转向另一条重要进展，【${cleanTitle}】。`
              : idx === 0
                ? `First up today, let's look at ${cleanTitle}.`
                : isLast
                  ? `And finally today, let's wrap up with ${cleanTitle}.`
                  : `Next, turning our attention to ${cleanTitle}.`;

        const normalizedLead = normalizeBroadcastText(lead, isZh);
        const normalizedBody = cleanBody === '' ? '' : normalizeBroadcastText(cleanBody, isZh);
        // F613: the plan insight is grounded in this item and always spoken; the keyword-bucket
        // synthesizer (and its uniqueness set) only runs on the template path.
        const insight = planItem?.insight ?? synthesizePersonalUnderstanding(cleanTitle, cleanBody, isZh, usedInsights);
        const normalizedInsight = insight === null ? null : normalizeBroadcastText(insight, isZh);

        const factText = isZh ? `${normalizedLead}${normalizedBody}` : `${normalizedLead} ${normalizedBody}`;

        // R4: facts first, chunked so no single segment runs past ~90s of speech; then the insight
        // only when this episode has not already spoken that line (R2 collision ⇒ no segment).
        for (const chunk of splitFactText(factText)) {
            segments.push({
                text: chunk,
                gap_ms: 500, // Natural breathing pause before giving personal perspective
                emotion: 'professional, clear',
                speed: 1.0, // 20260917 pacing: facts/data read slower than the global 1.06 default
            });
        }
        if (normalizedInsight !== null) {
            segments.push({
                text: normalizedInsight,
                gap_ms: 1200, // Clear breath between news items (listener complaint: items ran together)
                emotion: 'thoughtful, personal',
                speed: 1.12, // 20260917 pacing: conversational asides read faster than facts
            });
        }
    });

    // 3. Outro segment: Warm, conversational wrap-up. F613: the plan outro replaces the template
    // wrap-up head; the fixed sign-off stays builder-owned.
    const outroText = isZh
        ? scriptPlan
            ? `${scriptPlan.outro}感谢您的收听，我是${hostName}，祝您拥有充实高效的一天，我们下期节目不见不散！`
            : `好了，本期AI乱炖就聊到这里。希望今天这些工具、论文和实践的经验对您有启发。感谢您的收听，我是${hostName}，祝您拥有充实高效的一天，我们下期节目不见不散！`
        : `That wraps up this episode of AI 乱炖. I hope today's takeaways were useful. Thank you for listening. This is ${hostName}, wishing you a productive and wonderful day. Until next time!`;

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
        if (segment.speed !== undefined) {
            lines.push(`    speed: ${segment.speed}`);
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
