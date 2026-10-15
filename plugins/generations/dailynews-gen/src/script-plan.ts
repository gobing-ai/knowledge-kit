import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';

/**
 * LLM-authored spoken plan for one daily episode (F613). The plan owns words only; the builder
 * keeps segment order, pacing tokens, fact chunking, and validation
 * (`docs/design/daily-voice-script-plan.md` §3). `version` is pinned so a future shape change
 * fails loud as `schema` instead of mis-substituting.
 */
export interface ScriptPlan {
    version: 1;
    intro: string;
    outro: string;
    items: { id: string; lead: string; insight: string }[];
    /**
     * Docs deliberately not spoken (topic-boundary exclusions, task 0189). An id here is
     * exempt from `missing-item`; listing an id in both `items` and `excluded` is a
     * `conflict-id` error, and an unknown id is `unknown-id` like any plan item.
     */
    excluded?: { id: string; reason: string }[];
}

/**
 * Machine-readable part of the style sidecar `plugins/kk/scripts/daily-voice-style.zh.md` — the
 * same fenced `json` block the script-write prompt reads, so prompt and validator share one source.
 */
export interface StyleContract {
    caps: { intro: number; outro: number; lead: number; insight: number };
    banned: string[];
}

/** One plan rejection: which item (`episode` for plan-level fields) broke which rule. */
export interface ScriptPlanError {
    itemId: string;
    rule: string;
}

export type ScriptPlanValidation = { ok: true; plan: ScriptPlan } | { ok: false; errors: ScriptPlanError[] };

/**
 * Empty spoken text is a shape error (`schema`), not a cap/banned case: an empty intro or insight
 * would normalize to a bare 「。」 segment, which no valid episode contains.
 */
const ScriptPlanItemSchema = z.object({
    id: z.string().min(1),
    lead: z.string().min(1),
    insight: z.string().min(1),
});

const ScriptPlanExclusionSchema = z.object({
    id: z.string().min(1),
    reason: z.string().min(1),
});

const ScriptPlanSchema = z.object({
    version: z.literal(1),
    intro: z.string().min(1),
    outro: z.string().min(1),
    items: z.array(ScriptPlanItemSchema),
    excluded: z.array(ScriptPlanExclusionSchema).optional(),
});

const StyleContractSchema = z.object({
    caps: z.object({
        intro: z.number().int().positive(),
        outro: z.number().int().positive(),
        lead: z.number().int().positive(),
        insight: z.number().int().positive(),
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
export function validateScriptPlan(plan: unknown, docs: Doc[], style: StyleContract): ScriptPlanValidation {
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
        if (!docIds.has(ex.id)) errors.push({ itemId: ex.id, rule: 'unknown-id' });
        if (plannedIds.has(ex.id)) errors.push({ itemId: ex.id, rule: 'conflict-id' });
    }
    for (const doc of docs) {
        if (!plannedIds.has(doc.id) && !excludedIds.has(doc.id)) errors.push({ itemId: doc.id, rule: 'missing-item' });
    }

    if (valid.intro.length > style.caps.intro) errors.push({ itemId: 'episode', rule: 'cap:intro' });
    if (valid.outro.length > style.caps.outro) errors.push({ itemId: 'episode', rule: 'cap:outro' });
    for (const item of valid.items) {
        if (item.lead.length > style.caps.lead) errors.push({ itemId: item.id, rule: 'cap:lead' });
        if (item.insight.length > style.caps.insight) errors.push({ itemId: item.id, rule: 'cap:insight' });
        const doc = docs.find((entry) => entry.id === item.id);
        // unknown-id is already reported above; skip the redundancy check rather than double-report.
        if (
            doc !== undefined &&
            redundantInsightClauses(item.insight, `${item.lead}${doc.body}`) >= REDUNDANT_INSIGHT_CLAUSE_LIMIT
        ) {
            errors.push({ itemId: item.id, rule: 'redundant-insight' });
        }
    }

    const fields: { itemId: string; text: string }[] = [
        { itemId: 'episode', text: valid.intro },
        { itemId: 'episode', text: valid.outro },
        ...valid.items.flatMap((item) => [
            { itemId: item.id, text: item.lead },
            { itemId: item.id, text: item.insight },
        ]),
    ];
    for (const field of fields) {
        for (const phrase of style.banned) {
            if (field.text.includes(phrase)) errors.push({ itemId: field.itemId, rule: `banned:${phrase}` });
        }
    }

    const seenInsights = new Set<string>();
    for (const item of valid.items) {
        if (seenInsights.has(item.insight)) errors.push({ itemId: item.id, rule: 'duplicate-insight' });
        else seenInsights.add(item.insight);
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, plan: valid };
}
