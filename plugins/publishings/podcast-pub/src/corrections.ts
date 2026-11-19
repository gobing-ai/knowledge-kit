/**
 * 0396 R1/R2 — traceable public corrections (L3 R17: 已播纠错随新版节目送达并可追溯).
 *
 * A correction is *not* a retro-edit of a published episode. It is content carried by the NEXT
 * eligible episode, and it is traceable in two directions:
 *
 *  - **into the content** — `renderCorrectionsBlock` turns the frozen judgment snapshot's
 *    `corrections[]` (0384: stable `corr-<digest>` ids, the retired record, the replacement wording,
 *    the evidence) into the acknowledgement + apology + corrected fact block, naming the prior
 *    episode the wrong judgment aired in. No frozen correction list ⇒ `null`, so a caller can never
 *    emit an empty heading.
 *  - **out of the delivery** — `classifyCorrectionTarget` / `recordCorrectionDeliveries` produce one
 *    delivery record per target (`{correctionId, target, state, reason}`), naming the 0388 target and
 *    the correction id. A target that is manual, blocked or unsupported gets an EXACT target-level
 *    reason verbatim (never a generic failure) and is never recorded as `delivered`.
 *
 * Reuse, not a second transport: the records are plain data written beside the run's publish receipts
 * (`correctionDeliveryPath`), and the anchor for an update of an already-published item stays
 * podcast-pub's existing `update` operation. Nothing here calls an API.
 */
import { join } from 'node:path';
import { ensureDirForFile, readJsonFile, writeJsonFile } from '@gobing-ai/ts-runtime';

/** The evidence a correction rests on — carried verbatim from the frozen judgment. */
export interface CorrectionEvidence {
    url: string;
    checkedAt: string | null;
}

/** The retired judgment as committed: the correction's subject, answerable without the ledger. */
export interface RetiredJudgment {
    id: string;
    /** The (prior) episode date the wrong judgment aired on — the "prior episode" reference. */
    date: string;
    fact: string;
    attribution: string | null;
}

/** One frozen correction: what was wrong, what replaces it, and the stable id that names it. */
export interface Correction {
    /** `corr-<digest>` from 0384 — stable across replays, the dedupe key. */
    correctionId: string;
    supersedes: string;
    judgmentId: string;
    selectedId: string | null;
    /** The replacement wording the episode speaks. */
    wording: string;
    /** The renderable correction sentence frozen with the snapshot. */
    text: string;
    retired: RetiredJudgment;
    evidence: CorrectionEvidence;
}

/** The validated read of a frozen snapshot's correction projection. */
export interface FrozenCorrectionSet {
    runDate: string | null;
    corrections: Correction[];
    /** `## 本期更正说明` preamble frozen by 0384 (null when the run owed none). */
    preamble: string | null;
    /** Malformed / duplicate entries — reported, never silently dropped. */
    diagnostics: string[];
}

const EMPTY: Correction[] = [];
const NO_DELIVERIES: CorrectionDelivery[] = [];

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** `第261118期（2026-11-18）` — the issue label the correction names as the prior episode. */
export function priorEpisodeReference(retired: RetiredJudgment): string {
    const digits = retired.date.replaceAll(/\D/g, '');
    if (digits.length < 8) return `该期（${retired.date.trim()}）`;
    const day = digits.slice(0, 8);
    const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    return `第${day.slice(-6)}期（${iso}）`;
}

/** Validates one snapshot correction entry; `null` (with a diagnostic reason) when unusable. */
function readCorrection(raw: unknown, index: number): { correction: Correction } | { reason: string } {
    const entry = asRecord(raw);
    if (entry === null) return { reason: `corrections[${index}] is not an object` };
    const correctionId = asString(entry.correctionId);
    if (correctionId === '') return { reason: `corrections[${index}] has no correctionId` };
    const retiredRaw = asRecord(entry.retired);
    if (retiredRaw === null) return { reason: `corrections[${index}] (${correctionId}) has no retired record` };
    const date = asString(retiredRaw.date);
    const fact = asString(retiredRaw.fact);
    if (date === '' || fact === '') {
        return { reason: `corrections[${index}] (${correctionId}) has no retired date/fact to name the prior episode` };
    }
    const evidenceRaw = asRecord(entry.evidence);
    const wording = asString(entry.wording);
    const text = asString(entry.text);
    return {
        correction: {
            correctionId,
            supersedes: asString(entry.supersedes) || asString(retiredRaw.id),
            judgmentId: asString(entry.judgmentId),
            selectedId: asString(entry.selectedId) || null,
            wording,
            text: text || `「${fact}」经核验有误，现更正为：${wording || '（新判断）'}`,
            retired: {
                id: asString(retiredRaw.id),
                date,
                fact,
                attribution: asString(retiredRaw.attribution) || null,
            },
            evidence: {
                url: asString(evidenceRaw?.url),
                checkedAt: asString(evidenceRaw?.checkedAt) || null,
            },
        },
    };
}

/**
 * Read the frozen snapshot's correction projection (0384 `21-plan/<date>_judgment-snapshot.json`).
 * Tolerant by contract: a missing/odd shape yields zero corrections plus a diagnostic — an absent
 * frozen judgment means *no correction block*, never a fabricated one and never a generic crash.
 * Correction ids are unique: a repeated id is ignored (the first wins) and reported.
 */
export function readFrozenCorrections(raw: unknown, options: { runDate?: string | null } = {}): FrozenCorrectionSet {
    const runDateFromOptions = options.runDate ?? null;
    const snapshot = asRecord(raw);
    if (snapshot === null) {
        return {
            runDate: runDateFromOptions,
            corrections: EMPTY,
            preamble: null,
            diagnostics: ['correction snapshot is not an object: no corrections carried'],
        };
    }
    const runDate = asString(snapshot.runDate) || runDateFromOptions;
    const rawCorrections = Array.isArray(snapshot.corrections) ? snapshot.corrections : [];
    const corrections: Correction[] = [];
    const diagnostics: string[] = [];
    const seen = new Set<string>();
    for (const [index, entry] of rawCorrections.entries()) {
        const parsed = readCorrection(entry, index);
        if ('reason' in parsed) {
            diagnostics.push(parsed.reason);
            continue;
        }
        const { correctionId } = parsed.correction;
        if (seen.has(correctionId)) {
            diagnostics.push(`duplicate correction id "${correctionId}" at corrections[${index}] ignored`);
            continue;
        }
        seen.add(correctionId);
        corrections.push(parsed.correction);
    }
    return {
        runDate,
        corrections,
        preamble: asString(snapshot.preamble) || null,
        diagnostics,
    };
}

/** `<!--kk:corrections-->` — the marker the show-notes renderer trusts (one block, one place). */
export const CORRECTIONS_TAG = '<!--kk:corrections-->';

/**
 * The public correction block: acknowledgement, apology, corrected fact, prior-episode reference and
 * the evidence. Returns `null` when the run owes no correction (no frozen judgment ⇒ no block and no
 * empty heading). Each entry is a flat, closed bullet list so the RSS/plain-text degradation keeps it
 * readable, and every line is escaped for markdown-unsafe characters.
 */
export function renderCorrectionsBlock(set: FrozenCorrectionSet): string | null {
    if (set.corrections.length === 0) return null;
    const lines: string[] = ['## 本期更正说明', '', CORRECTIONS_TAG, ''];
    if (set.preamble !== null && set.preamble !== '') lines.push(set.preamble, '');
    lines.push('此前节目中的一处判断经核验有误，我们在此更正并致歉。', '');
    for (const correction of set.corrections) {
        lines.push(
            `- **更正 ${correction.correctionId}** · 上期节目 ${priorEpisodeReference(correction.retired)}`,
            `  - 原判断：「${correction.retired.fact}」`,
            `  - 更正为：${correction.wording !== '' ? correction.wording : correction.text}`,
            `  - ${evidenceLine(correction)}`,
        );
    }
    return `${lines.join('\n')}\n`;
}

function evidenceLine(correction: Correction): string {
    const { url, checkedAt } = correction.evidence;
    if (url === '') return `依据：判断记录 ${correction.retired.id || correction.supersedes}`;
    return `依据：${url}${checkedAt === null ? '' : `（核验于 ${checkedAt}）`}`;
}

/** Where a correction stands for one target. Only `delivered` means it reached the audience. */
export type CorrectionTargetState = 'delivered' | 'pending' | 'manual' | 'blocked' | 'unsupported';

/** One 0388 target as the correction delivery sees it (dispatch ledger row + capability facts). */
export interface CorrectionDeliveryTarget {
    /** 0388 dispatch id, e.g. `podcast-pub` / `surfdash-pub@article`. */
    target: string;
    mode?: string;
    /** 0388 `DispatchState`: dispatched | pending | retry | blocked | deferred | off. */
    state?: string;
    manualStep?: string;
    blockedBy?: readonly string[];
    lastError?: string;
    /**
     * Explicit capability: does this adapter carry episode content and support updating it? A target
     * without both is `unsupported` — its reason names the adapter gap, never "delivery failed".
     */
    supportsCorrections: boolean;
    /** The adapter-specific capability gap, when `supportsCorrections` is false. */
    capabilityReason?: string;
    /**
     * Evidence that THIS target's approved content actually carries the correction block (the
     * published item's url or content id). A dispatched non-podcast target without it is `blocked`:
     * the ledger must not claim a correction travelled somewhere nobody looked (0396 review P3).
     */
    deliveryEvidence?: string;
}

/** One correction's delivery outcome on one target — the traceable record. */
export interface CorrectionDelivery {
    correctionId: string;
    target: string;
    runDate: string | null;
    state: CorrectionTargetState;
    /** EXACT reason, always present, always naming the target and the correction id. */
    reason: string;
    deliveredAt: string | null;
    url?: string;
    itemId?: string;
}

/** The durable delivery ledger (beside the run's publish receipts). */
export interface CorrectionDeliveryLedger {
    schemaVersion: 1;
    runDate: string | null;
    deliveries: CorrectionDelivery[];
}

const DELIVERED_KEY = (delivery: { correctionId: string; target: string }): string =>
    `${delivery.correctionId}\u0000${delivery.target}`;

function delivery(
    correction: Correction,
    target: CorrectionDeliveryTarget,
    runDate: string | null,
    state: CorrectionTargetState,
    reason: string,
    deliveredAt: string | null,
    url?: string,
): CorrectionDelivery {
    return {
        correctionId: correction.correctionId,
        target: target.target,
        runDate,
        state,
        reason,
        deliveredAt: state === 'delivered' ? deliveredAt : null,
        ...(state === 'delivered' && url !== undefined && url !== '' ? { url } : {}),
    };
}

/**
 * The target whose delivery this module can verify itself: the podcast item, anchored by the item id
 * and public URL the caller just produced. Any other target must supply `deliveryEvidence`.
 */
function isSelfTarget(target: string): boolean {
    return target === SELF_TARGET;
}

/** The podcast row the plugin itself dispatches (`TARGET` in index.ts is 'podcast-pub'). */
const SELF_TARGET = 'podcast-pub';

/**
 * Classify one correction against one target. Order matters: a duplicate (replay) is recognised
 * before anything else so a retried trigger never re-sends, and an authorization `off` outranks the
 * dispatch state (an off target is off even if a stale ledger says `pending`).
 */
export function classifyCorrectionTarget(
    correction: Correction,
    target: CorrectionDeliveryTarget,
    options: { runDate?: string | null; prior?: readonly CorrectionDelivery[]; now?: string } = {},
): CorrectionDelivery {
    const runDate = options.runDate ?? null;
    const now = options.now ?? new Date().toISOString();
    const id = correction.correctionId;
    const prior = (options.prior ?? NO_DELIVERIES).find(
        (entry) => entry.correctionId === id && entry.target === target.target && entry.state === 'delivered',
    );
    if (prior !== undefined) {
        return delivery(
            correction,
            target,
            runDate,
            'delivered',
            `target "${target.target}" already received correction ${id} (delivered ${prior.deliveredAt ?? 'earlier'}); not re-sent`,
            prior.deliveredAt ?? now,
        );
    }
    if (target.mode === 'off') {
        return delivery(
            correction,
            target,
            runDate,
            'unsupported',
            `target "${target.target}" is off in the authorization matrix (mode=off): correction ${id} cannot be delivered there`,
            now,
        );
    }
    if (target.manualStep !== undefined && target.manualStep !== '') {
        return delivery(
            correction,
            target,
            runDate,
            'manual',
            `target "${target.target}" requires the manual step "${target.manualStep}": correction ${id} stays a pending operator step until it is confirmed`,
            now,
        );
    }
    if (target.state === 'blocked') {
        const blockers = (target.blockedBy ?? []).join(', ');
        return delivery(
            correction,
            target,
            runDate,
            'blocked',
            `target "${target.target}" is blocked by unsatisfied dependenc${(target.blockedBy ?? []).length === 1 ? 'y' : 'ies'} ${blockers === '' ? '(unspecified)' : blockers}: correction ${id} is not delivered yet`,
            now,
        );
    }
    if (target.state === 'retry') {
        return delivery(
            correction,
            target,
            runDate,
            'blocked',
            `target "${target.target}" failed its last dispatch (${target.lastError ?? 'dispatch failed'}): correction ${id} is not delivered`,
            now,
        );
    }
    if (target.state === 'deferred') {
        return delivery(
            correction,
            target,
            runDate,
            'pending',
            `target "${target.target}" dispatches in its own, later window: correction ${id} is carried when that window runs`,
            now,
        );
    }
    if (!target.supportsCorrections) {
        return delivery(
            correction,
            target,
            runDate,
            'unsupported',
            `target "${target.target}" cannot carry an episode correction (${target.capabilityReason ?? 'no correction-capable content surface with same-item update'}): correction ${id} is unsupported there`,
            now,
        );
    }
    if (target.state === 'dispatched') {
        const evidence = target.deliveryEvidence?.trim() ?? '';
        if (isSelfTarget(target.target) || evidence !== '') {
            return delivery(
                correction,
                target,
                runDate,
                'delivered',
                `target "${target.target}" dispatched${runDate === null ? '' : ` on ${runDate}`} with the episode: correction ${id} travelled in its approved content${evidence === '' ? '' : ` (evidence: ${evidence})`}`,
                now,
                evidence === '' ? undefined : evidence,
            );
        }
        return delivery(
            correction,
            target,
            runDate,
            'blocked',
            `target "${target.target}" dispatched${runDate === null ? '' : ` on ${runDate}`} but carries no delivery evidence for correction ${id}: the block's presence in that content is unverified, so the correction is not recorded as delivered`,
            now,
        );
    }
    return delivery(
        correction,
        target,
        runDate,
        'pending',
        `target "${target.target}" has not dispatched yet: correction ${id} is queued with the next eligible episode`,
        now,
    );
}

/** Classify every frozen correction against every target (the per-target delivery plan). */
export function planCorrectionDeliveries(
    set: FrozenCorrectionSet,
    targets: readonly CorrectionDeliveryTarget[],
    options: { runDate?: string | null; prior?: readonly CorrectionDelivery[]; now?: string } = {},
): CorrectionDelivery[] {
    const deliveries: CorrectionDelivery[] = [];
    for (const correction of set.corrections) {
        for (const target of targets) {
            deliveries.push(classifyCorrectionTarget(correction, target, options));
        }
    }
    return deliveries;
}

/**
 * Fold deliveries into the ledger. `delivered` is the only state that is recorded as a delivery and
 * the only one deduped per `(correctionId, target)` pair: a correction already delivered is never
 * re-delivered (the repeat is returned in `skipped`), and a later non-delivered pass can never
 * downgrade a delivered pair — the record of a real delivery is immutable.
 */
export function recordCorrectionDeliveries(
    ledger: CorrectionDeliveryLedger,
    deliveries: readonly CorrectionDelivery[],
): { ledger: CorrectionDeliveryLedger; recorded: CorrectionDelivery[]; skipped: CorrectionDelivery[] } {
    const kept = [...ledger.deliveries];
    const recorded: CorrectionDelivery[] = [];
    const skipped: CorrectionDelivery[] = [];
    const deliveredKeys = new Set(kept.filter((entry) => entry.state === 'delivered').map(DELIVERED_KEY));
    for (const entry of deliveries) {
        const key = DELIVERED_KEY(entry);
        const index = kept.findIndex((existing) => DELIVERED_KEY(existing) === key);
        if (entry.state === 'delivered') {
            if (deliveredKeys.has(key)) {
                skipped.push(entry);
                continue;
            }
            deliveredKeys.add(key);
            recorded.push(entry);
            if (index === -1) kept.push(entry);
            else kept[index] = entry;
            continue;
        }
        recorded.push(entry);
        if (index === -1) kept.push(entry);
        else if (kept[index]?.state !== 'delivered') kept[index] = entry;
    }
    return { ledger: { ...ledger, deliveries: kept }, recorded, skipped };
}

/** The correction ids a ledger proves delivered (optionally narrowed to one target). */
export function deliveredCorrectionIds(ledger: CorrectionDeliveryLedger, target?: string): string[] {
    const ids = new Set<string>();
    for (const entry of ledger.deliveries) {
        if (entry.state !== 'delivered') continue;
        if (target !== undefined && entry.target !== target) continue;
        ids.add(entry.correctionId);
    }
    return [...ids];
}

/** An empty ledger for `runDate`. */
export function emptyDeliveryLedger(runDate: string | null): CorrectionDeliveryLedger {
    return { schemaVersion: 1, runDate, deliveries: [] };
}

/** Absolute path of a run's correction delivery ledger: `31-publish/<date>_16_corrections-delivery.json`. */
export function correctionDeliveryPath(workDir: string, runDate: string): string {
    return join(workDir, '31-publish', `${runDate}_16_corrections-delivery.json`);
}

/**
 * Read a delivery ledger. An absent or corrupt file is an EMPTY ledger, never an error: an unreadable
 * record cannot prove a delivery, so the next pass re-classifies from the dispatch state (it does not
 * re-send a delivered item — the 0388 ledger still says `dispatched`).
 */
export async function readCorrectionDeliveries(
    path: string,
    runDate: string | null = null,
): Promise<CorrectionDeliveryLedger> {
    try {
        // The ts-runtime JSON seam (never `node:fs`): an absent file throws here and lands in the same
        // `catch`, which is the documented "unreadable record proves nothing" path.
        const parsed: unknown = await readJsonFile(path);
        const record = asRecord(parsed);
        const deliveries = Array.isArray(record?.deliveries) ? record.deliveries : [];
        return {
            schemaVersion: 1,
            runDate: asString(record?.runDate) || runDate,
            deliveries: deliveries.filter((entry): entry is CorrectionDelivery => {
                const candidate = asRecord(entry);
                return (
                    candidate !== null &&
                    asString(candidate.correctionId) !== '' &&
                    asString(candidate.target) !== '' &&
                    ['delivered', 'pending', 'manual', 'blocked', 'unsupported'].includes(asString(candidate.state))
                );
            }),
        };
    } catch {
        return emptyDeliveryLedger(runDate);
    }
}

/** Persist the delivery ledger (durable evidence of where each correction was delivered). */
export async function writeCorrectionDeliveries(path: string, ledger: CorrectionDeliveryLedger): Promise<string> {
    await ensureDirForFile(path);
    await writeJsonFile(path, ledger);
    return path;
}
