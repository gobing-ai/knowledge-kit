import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';

/**
 * LLM-authored spoken plan for one daily episode (F613). The plan owns words only; the builder
 * keeps segment order, pacing tokens, fact chunking, and validation
 * (`docs/design/daily-voice-script-plan.md` §3). `version` is pinned so a future shape change
 * fails loud as `schema` instead of mis-substituting.
 */
export interface ScriptPlanItemCard {
    copy: string;
    points: string[];
    subject: string;
}

export interface ScriptPlanCards {
    title: string;
    body: string;
}

export interface ScriptPlanSocial {
    short: string;
    long: string;
}

/**
 * The cover slot has two legal forms (0347 R4, widened by 0385 R4):
 *  - a plain string = the English visual scene (the pre-0347 shape), unchanged;
 *  - an object = `{ scene?, headline, sourceIds? }`, where `headline` is the Chinese 当日要点 the
 *    episode identity freezes (0385 R4) and `sourceIds` names the plan items the point rests on,
 *    so admission dropping them can withhold the point instead of publishing it unsupported.
 */
export interface ScriptPlanCoverObject {
    /** English visual scene for image generation (≤ `caps.cover`); optional so a point-only cover validates. */
    scene?: string;
    /** The frozen 当日要点 — the one point the title and the cover share (≤ `caps.coverHeadline`). */
    headline: string;
    /** Plan item ids the headline rests on; withheld when admission drops every one of them. */
    sourceIds?: string[];
}

export type ScriptPlanCover = string | ScriptPlanCoverObject;

export interface ScriptPlan {
    version: 1;
    intro: string;
    outro: string;
    /**
     * `insight` is optional (0385 R3): a comment-free item is legal, and an empty string means the
     * same thing as omission — the builder skips the insight sentence, never the item.
     */
    items: { id: string; lead: string; insight?: string; card?: ScriptPlanItemCard }[];
    /**
     * Docs deliberately not spoken (topic-boundary exclusions, task 0189). An id here is
     * exempt from `missing-item`; listing an id in both `items` and `excluded` is a
     * `conflict-id` error, and an unknown id is `unknown-id` like any plan item.
     */
    excluded?: { id: string; reason: string }[];
    /** Optional master-artifact fields rendered deterministically by `daily-editorial-render` (0345 R10). */
    cover?: ScriptPlanCover;
    cards?: ScriptPlanCards;
    social?: ScriptPlanSocial;
}

/**
 * Machine-readable part of the style contract `plugins/kk/skills/news-editorial/references/style-contract.zh.md` (ADR-045) — the
 * same fenced `json` block the script-write prompt reads, so prompt and validator share one source.
 */
export interface StyleContract {
    caps: {
        intro: number;
        outro: number;
        lead: number;
        insight: number;
        cover?: number;
        coverHeadline?: number;
        cardCopy?: number;
        cardTitle?: number;
        socialShort?: number;
        socialLong?: number;
    };
    banned: string[];
}

/** One plan rejection: which item (`episode` for plan-level fields) broke which rule. */
export interface ScriptPlanError {
    itemId: string;
    rule: string;
}

export type ScriptPlanValidation = { ok: true; plan: ScriptPlan } | { ok: false; errors: ScriptPlanError[] };

const ScriptPlanItemCardSchema = z.object({
    copy: z.string().min(1),
    points: z.array(z.string().min(1)).min(2).max(4),
    subject: z.string().min(1),
});

/**
 * `insight` is optional (0385 R3): the contract lets an item carry no comment, so omitting it — or
 * sending `""` — must validate. A blank insight is skipped by the builder (no bare 「。」 segment)
 * and by the editorial render (the item still renders, only the comment sentence is dropped).
 */
const ScriptPlanItemSchema = z.object({
    id: z.string().min(1),
    lead: z.string().min(1),
    insight: z.string().optional(),
    card: ScriptPlanItemCardSchema.optional(),
});

/**
 * 0385 R4: the object form is what carries the episode's 当日要点, so the schema has to accept it —
 * a string-only cover made the canonical `第<issue>期 · <headline>` title unreachable.
 */
const ScriptPlanCoverObjectSchema = z.object({
    scene: z.string().min(1).optional(),
    headline: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).optional(),
});

const ScriptPlanCoverSchema = z.union([z.string().min(1), ScriptPlanCoverObjectSchema]);

const ScriptPlanExclusionSchema = z.object({
    id: z.string().min(1),
    reason: z.string().min(1),
});

const ScriptPlanCardsSchema = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
});

const ScriptPlanSocialSchema = z.object({
    short: z.string().min(1),
    long: z.string().min(1),
});

const ScriptPlanSchema = z.object({
    version: z.literal(1),
    intro: z.string().min(1),
    outro: z.string().min(1),
    items: z.array(ScriptPlanItemSchema),
    excluded: z.array(ScriptPlanExclusionSchema).optional(),
    cover: ScriptPlanCoverSchema.optional(),
    cards: ScriptPlanCardsSchema.optional(),
    social: ScriptPlanSocialSchema.optional(),
});

const StyleContractSchema = z.object({
    caps: z.object({
        intro: z.number().int().positive(),
        outro: z.number().int().positive(),
        lead: z.number().int().positive(),
        insight: z.number().int().positive(),
        cover: z.number().int().positive().optional(),
        coverHeadline: z.number().int().positive().optional(),
        cardCopy: z.number().int().positive().optional(),
        cardTitle: z.number().int().positive().optional(),
        socialShort: z.number().int().positive().optional(),
        socialLong: z.number().int().positive().optional(),
    }),
    banned: z.array(z.string().min(1)),
});

const STYLE_JSON_FENCE_RE = /```json\s*([\s\S]*?)```/;

/**
 * Parse the style contract out of the sidecar markdown: the FIRST fenced `json` block. A missing
 * or invalid block throws — the caller turns that into the `no-style` fallback rule (a plan must
 * never run without its contract).
 */
export function parseStyleContract(markdown: string): StyleContract {
    const match = markdown.match(STYLE_JSON_FENCE_RE);
    if (!match?.[1]) {
        throw new Error('style contract has no ```json fenced block');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1].trim());
    } catch (err: unknown) {
        throw new Error(
            `style contract json block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    return StyleContractSchema.parse(parsed);
}

/**
 * Validate a plan against the docs and the style contract. Rules (task 0161 R2), accumulated —
 * one warn line names every violation, so a rejected plan is diagnosable in one read:
 *
 * - `schema`: wrong shape or version (`itemId: episode`)
 * - `unknown-id`: a plan item (or exclusion) id that is not a doc
 * - `missing-item`: a doc with no plan item and no exclusion
 * - `conflict-id`: an id listed in both `items` and `excluded`
 * - `cap:<field>`: a field over its cap (`intro`/`outro` report `itemId: episode`)
 * - `banned:<phrase>`: a field containing a banned phrase
 * - `duplicate-insight`: the same insight text on two items in one episode
 * - `redundant-insight`: the insight restates the narration — ≥ 3 of its clauses each share a
 *   ≥ 14-char verbatim span with the item's spoken facts (lead + doc body). 20261014 episode: the
 *   prompt told the planner to restate facts, so the listener heard near-identical wording twice
 *   per item. One repeated number is tolerable; three copied clauses is a second narration.
 *
 * All-or-nothing by contract (Q&A): a partially valid plan is never partially applied.
 */
/** Verbatim-span length (normalized) that counts a clause as restated, not as a fact mention. */
const REDUNDANT_INSIGHT_SPAN = 14;
/** A listener tolerates one restated clause; at this many the item reads as a second narration. */
const REDUNDANT_INSIGHT_CLAUSE_LIMIT = 3;

function redundantInsightClauses(insight: string, reference: string): number {
    const ref = reference.replace(/[\s\p{P}\p{S}]+/gu, '');
    let count = 0;
    for (const clause of insight.split(/[。！？；，]/)) {
        const norm = clause.replace(/[\s\p{P}\p{S}]+/gu, '');
        if (norm.length < REDUNDANT_INSIGHT_SPAN) continue;
        for (let i = 0; i + REDUNDANT_INSIGHT_SPAN <= norm.length; i++) {
            if (ref.includes(norm.slice(i, i + REDUNDANT_INSIGHT_SPAN))) {
                count++;
                break;
            }
        }
    }
    return count;
}
export function validateScriptPlan(
    plan: unknown,
    docs: Doc[],
    style: StyleContract,
    preExcludedIds?: ReadonlySet<string>,
): ScriptPlanValidation {
    const parsed = ScriptPlanSchema.safeParse(plan);
    if (!parsed.success) {
        return { ok: false, errors: [{ itemId: 'episode', rule: 'schema' }] };
    }
    const valid = parsed.data;
    const errors: ScriptPlanError[] = [];
    const docIds = new Set(docs.map((doc) => doc.id));

    for (const item of valid.items) {
        if (!docIds.has(item.id)) errors.push({ itemId: item.id, rule: 'unknown-id' });
    }
    const plannedIds = new Set(valid.items.map((item) => item.id));
    const excludedIds = new Set((valid.excluded ?? []).map((ex) => ex.id));
    for (const ex of valid.excluded ?? []) {
        if (!docIds.has(ex.id) && !preExcludedIds?.has(ex.id)) {
            errors.push({ itemId: ex.id, rule: 'unknown-id' });
        }
        if (plannedIds.has(ex.id)) errors.push({ itemId: ex.id, rule: 'conflict-id' });
    }
    for (const doc of docs) {
        if (!plannedIds.has(doc.id) && !excludedIds.has(doc.id)) errors.push({ itemId: doc.id, rule: 'missing-item' });
    }

    if (valid.intro.length > style.caps.intro) errors.push({ itemId: 'episode', rule: 'cap:intro' });
    if (valid.outro.length > style.caps.outro) errors.push({ itemId: 'episode', rule: 'cap:outro' });
    // 0385 R4: both cover forms are capped. The string form is one scene (the pre-0347 shape); the
    // object form caps its scene at the same place and its 当日要点 at the (much tighter) headline cap.
    if (typeof valid.cover === 'string') {
        if (valid.cover.length > (style.caps.cover ?? 240)) errors.push({ itemId: 'episode', rule: 'cap:cover' });
    } else if (valid.cover !== undefined) {
        if (valid.cover.scene !== undefined && valid.cover.scene.length > (style.caps.cover ?? 240)) {
            errors.push({ itemId: 'episode', rule: 'cap:cover' });
        }
        if (valid.cover.headline.length > (style.caps.coverHeadline ?? 25)) {
            errors.push({ itemId: 'episode', rule: 'cap:coverHeadline' });
        }
    }
    if (valid.cards !== undefined && valid.cards.title.length > (style.caps.cardTitle ?? 20)) {
        errors.push({ itemId: 'episode', rule: 'cap:cardTitle' });
    }
    if (valid.social !== undefined) {
        if (valid.social.short.length > (style.caps.socialShort ?? 140)) {
            errors.push({ itemId: 'episode', rule: 'cap:socialShort' });
        }
        if (valid.social.long.length > (style.caps.socialLong ?? 500)) {
            errors.push({ itemId: 'episode', rule: 'cap:socialLong' });
        }
    }
    for (const item of valid.items) {
        if (item.lead.length > style.caps.lead) errors.push({ itemId: item.id, rule: 'cap:lead' });
        // 0385 R3: an omitted/blank insight is legal (the item still renders), so it has no cap,
        // no banned-phrase and no duplicate rule to break.
        const insight = item.insight?.trim() ?? '';
        if (insight.length > style.caps.insight) errors.push({ itemId: item.id, rule: 'cap:insight' });
        if (item.card !== undefined && item.card.copy.length > (style.caps.cardCopy ?? 12)) {
            errors.push({ itemId: item.id, rule: 'cap:cardCopy' });
        }
        const doc = docs.find((entry) => entry.id === item.id);
        // unknown-id is already reported above; skip the redundancy check rather than double-report.
        if (
            doc !== undefined &&
            insight !== '' &&
            redundantInsightClauses(insight, `${item.lead}${doc.body}`) >= REDUNDANT_INSIGHT_CLAUSE_LIMIT
        ) {
            errors.push({ itemId: item.id, rule: 'redundant-insight' });
        }
    }

    const fields: { itemId: string; text: string }[] = [
        { itemId: 'episode', text: valid.intro },
        { itemId: 'episode', text: valid.outro },
        ...(typeof valid.cover === 'string'
            ? [{ itemId: 'episode', text: valid.cover }]
            : valid.cover !== undefined
              ? [
                    { itemId: 'episode', text: valid.cover.headline },
                    ...(valid.cover.scene !== undefined ? [{ itemId: 'episode', text: valid.cover.scene }] : []),
                ]
              : []),
        ...(valid.cards !== undefined
            ? [
                  { itemId: 'episode', text: valid.cards.title },
                  { itemId: 'episode', text: valid.cards.body },
              ]
            : []),
        ...(valid.social !== undefined
            ? [
                  { itemId: 'episode', text: valid.social.short },
                  { itemId: 'episode', text: valid.social.long },
              ]
            : []),
        ...valid.items.flatMap((item) => [
            { itemId: item.id, text: item.lead },
            ...((item.insight?.trim() ?? '') !== '' ? [{ itemId: item.id, text: item.insight as string }] : []),
            ...(item.card !== undefined
                ? [
                      { itemId: item.id, text: item.card.copy },
                      ...item.card.points.map((point) => ({ itemId: item.id, text: point })),
                  ]
                : []),
        ]),
    ];
    for (const field of fields) {
        for (const phrase of style.banned) {
            if (field.text.includes(phrase)) errors.push({ itemId: field.itemId, rule: `banned:${phrase}` });
        }
    }

    // Two comment-free items are not "the same insight" — only real comment text can collide.
    const seenInsights = new Set<string>();
    for (const item of valid.items) {
        const insight = item.insight?.trim() ?? '';
        if (insight === '') continue;
        if (seenInsights.has(insight)) errors.push({ itemId: item.id, rule: 'duplicate-insight' });
        else seenInsights.add(insight);
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: valid };
}
