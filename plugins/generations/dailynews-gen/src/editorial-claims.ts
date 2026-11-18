import { splitSentences } from '@gobing-ai/kk-core';
import type { ScriptPlan } from './script-plan';

/**
 * Advisory editorial checks for the two 0385 acceptance criteria the schema cannot express on its
 * own — audience explanation (0385 AC R2) and commercial-claim / commentary evidence (0385 AC R3).
 *
 * Boundary: these are findings, never rejections. `validateScriptPlan` keeps sole authority over
 * whether a plan is usable (a rejected plan silently ships the template fallback), so a plan that
 * validates today still validates after this file exists — the findings ride alongside it.
 * Every rule below quotes the clause it enforces from
 * `plugins/kk/skills/news-editorial/references/style-contract.zh.md` (ADR-045), which is the single
 * vocabulary owner: nothing here invents a new marker or term list.
 */

/** One advisory finding — the same `{itemId, code}` keying the validator's `{itemId, rule}` uses. */
export interface EditorialFinding {
    /** Rule id, prefixed with the AC it backs (`r2:`/`r3:`) so a fix pass can route on it. */
    code: string;
    itemId: string;
    /** Human/agent-facing explanation, printed as-is. */
    message: string;
}

/**
 * First-person commentary markers (0385 R3). Contract:53 「评论…可以带主语「我看」一次，不连用」;
 * contract:39 不连用多个「我会/我建议/我倾向」. The synonyms below are the same 第一人称评论 class the
 * contract's own banned canned-insight lines use (e.g. 「我个人觉得，这次最大的看点是…」), kept in
 * one list so "once per item" is enforceable across them instead of being evaded by a synonym.
 */
export const COMMENTARY_MARKERS = [
    '我看',
    '我觉得',
    '我认为',
    '在我看来',
    '个人觉得',
    '我会',
    '我建议',
    '我倾向',
] as const;

/**
 * Explanation markers for an introduced term (0385 R2). Contract:30 「术语先给白话再说名词：必要术语
 * 用一句「也就是说……」解释（例如「推理成本——也就是每次调用模型要付的钱」）」.
 */
export const EXPLANATION_MARKERS = ['也就是说', '也就是', '即', '相当于', '简单说', '通俗讲', '意思是'] as const;

/**
 * Terms that must be explained in the same breath (0385 R2, contract:30, contract:44). The list is
 * deliberately small and drawn from the contract's own examples — 推理成本 (contract:30) and
 * KV cache (contract:44) — plus the same 术语 class the daily items actually use. A term absent
 * from this list is never a finding: the check is "explain the jargon we know we use", not a
 * general terminology linter.
 */
export const JARGON_TERMS = [
    '推理引擎',
    '推理成本',
    '上下文缓存',
    'KV cache',
    '微调',
    '蒸馏',
    'distillation',
    'token',
    '算子',
    '参数量',
    'embedding',
] as const;

/**
 * Attribution markers (0385 R3). Contract:53 「可归因事实…并交代来源（谁说的、在哪个公告/采访/财报/
 * 诉状里）」 and 「商业声明（融资金额、用户数、性能提升、合规资质）尤其要核查来源」.
 */
export const ATTRIBUTION_MARKERS = [
    '据',
    '来源',
    '官方',
    '公告',
    '财报',
    '诉状',
    '采访',
    '报道',
    '表示',
    '称',
    '宣布',
    '披露',
    '回应',
    '报告',
    '新闻稿',
    '博客',
    '援引',
    '路透',
    '彭博',
    'The Information',
    'http',
] as const;

/** Quantified claim: a number that carries a unit of money, scale, count or a multiple (contract:53). */
const QUANTIFIED_RE = /\d+(?:[.,]\d+)*\s*(?:%|％|亿美元|万美元|亿元|万元|亿|万|倍|美元|元|人|家|次|个月|年|天|台)/u;
/** Superlative claim: 最/第一/唯一/首个 class (contract:53 「不夸大…意义」, contract:39). */
const SUPERLATIVE_RE = /最[高低大强快多好新]|第一|唯一|首个|首款|首家|首度|全球首|史上/iu;

/**
 * A claim in a fact sentence has to name who said it (contract:53). True when the sentence carries
 * an attribution marker or an explicit link.
 */
function hasAttribution(sentence: string): boolean {
    const lower = sentence.toLowerCase();
    return ATTRIBUTION_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

/** True when the sentence contains one of the quantified/superlative claim shapes above. */
function hasClaim(sentence: string): boolean {
    return QUANTIFIED_RE.test(sentence) || SUPERLATIVE_RE.test(sentence);
}

/**
 * A gloss counts when the term is followed in the same sentence by an explanation marker, or when
 * the sentence carries a parenthetical/dash gloss at all — 「推理成本——也就是每次调用模型要付的钱」
 * and 「推理成本（每次调用要付的钱）」 are both the contract's shape (contract:30).
 */
function hasGloss(sentence: string): boolean {
    if (EXPLANATION_MARKERS.some((marker) => sentence.includes(marker))) return true;
    return /（[^）]{2,}）|\([^)]{2,}\)/u.test(sentence) || /——[^—]{2,}/u.test(sentence);
}

/** Occurrences of every commentary marker in `text`, as `[marker, offset]` pairs (deduped by offset). */
function commentaryHits(text: string): { marker: string }[] {
    const hits: { marker: string }[] = [];
    for (const marker of COMMENTARY_MARKERS) {
        let from = text.indexOf(marker);
        while (from !== -1) {
            hits.push({ marker });
            from = text.indexOf(marker, from + marker.length);
        }
    }
    return hits;
}

/**
 * Analyse a validated master script plan for the 0385 AC R2/R3 editorial rules and return advisory
 * findings in plan order. `insight` is the commentary slot and `lead` the narration slot
 * (style contract 段落角色), so the two are treated asymmetrically on purpose:
 *
 * - `r3:commentary-repeat` — more than one 第一人称评论 marker in one item (contract:39, contract:53).
 * - `r3:commentary-in-facts` — a commentary marker in the fact sentence `lead` instead of `insight`
 *   (contract:49 「三种话必须分得开」).
 * - `r3:insight-multi-sentence` — the per-item comment runs past one sentence (0385 AC R3 「至多一句」).
 * - `r3:unattributed-claim` — a number/superlative in `lead` with no attribution in that sentence
 *   (contract:53 「商业声明…尤其要核查来源」).
 * - `r2:unexplained-jargon` — a `JARGON_TERMS` hit in either slot with no same-sentence gloss
 *   (contract:30 「术语先给白话再说名词」).
 */
export function analyzeEditorialClaims(plan: ScriptPlan): EditorialFinding[] {
    const findings: EditorialFinding[] = [];
    for (const item of plan.items) {
        const lead = item.lead.trim();
        const insight = item.insight?.trim() ?? '';

        const hits = commentaryHits(`${lead}${insight}`);
        if (hits.length > 1) {
            findings.push({
                code: 'r3:commentary-repeat',
                itemId: item.id,
                message: `commentary markers used ${hits.length} times (${hits
                    .map((hit) => hit.marker)
                    .join(', ')}); at most one per item`,
            });
        }
        const leaked = commentaryHits(lead);
        if (leaked.length > 0) {
            findings.push({
                code: 'r3:commentary-in-facts',
                itemId: item.id,
                message: `commentary marker (${leaked.map((hit) => hit.marker).join(', ')}) in the fact sentence; move the judgement into insight`,
            });
        }
        if (insight !== '') {
            const sentences = splitSentences(insight, { cjkOnly: true });
            if (sentences.length > 1) {
                findings.push({
                    code: 'r3:insight-multi-sentence',
                    itemId: item.id,
                    message: `insight is ${sentences.length} sentences; the per-item comment is at most one`,
                });
            }
        }
        for (const sentence of splitSentences(lead, { cjkOnly: true })) {
            if (hasClaim(sentence) && !hasAttribution(sentence)) {
                findings.push({
                    code: 'r3:unattributed-claim',
                    itemId: item.id,
                    message: `claim without attribution: 「${sentence}」 — name the source (据/公告/财报/公司称) or drop the figure`,
                });
            }
        }
        for (const [slot, text] of [
            ['lead', lead],
            ['insight', insight],
        ] as const) {
            if (text === '') continue;
            for (const sentence of splitSentences(text, { cjkOnly: true })) {
                const lowered = sentence.toLowerCase();
                const term = JARGON_TERMS.find((candidate) => lowered.includes(candidate.toLowerCase()));
                if (term !== undefined && !hasGloss(sentence)) {
                    findings.push({
                        code: 'r2:unexplained-jargon',
                        itemId: item.id,
                        message: `${slot} introduces 「${term}」 with no plain-language gloss (也就是说/即/相当于, or a 括号/破折号 explanation)`,
                    });
                }
            }
        }
    }
    return findings;
}
