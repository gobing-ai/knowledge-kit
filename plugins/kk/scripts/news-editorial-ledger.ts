#!/usr/bin/env bun
/**
 * The daily editorial judgment ledger (`<works_dir>/kk-news-generate/conclusion.md`) — ADR-054,
 * task 0384 (L3 R4/R10).
 *
 * The news-editorial skill authors a *proposal* (mode `align`, see the skill's SKILL.md); this
 * module is the deterministic half: validate → reconcile → atomic commit → immutable run snapshot.
 * Nothing here trusts the model: every proposal entry is checked against the IDs 0393's selection
 * provenance produced, judged against the ledger already on disk, and only then written.
 *
 * The three protections R10 asks for, in the order they run:
 *
 *  1. **Serialization** — commits take the existing `kk lock` claim named
 *     `kk-news-editorial-ledger` (the store's single-flight DAO, TTL-owned by the run) so two runs
 *     on the same ledger never interleave. The port is injected: the workflow node acquires the
 *     claim (`kk lock acquire --name kk-news-editorial-ledger --run <run_id>`) and hands the stage
 *     an owner; `NULL_LOCK` is the documented no-lock default for tests and offline replay.
 *  2. **Compare-and-swap** — the ledger text is hashed when it is read and re-hashed after the lock
 *     is held. A mismatch means someone committed in between: the loser writes nothing and reports
 *     `conflict`, so a stale proposal can never overwrite a confirmed judgment.
 *  3. **No-op replay** — a proposal whose content digest is already in the ledger appends nothing
 *     and reuses the legal run snapshot; re-running the same day is free.
 *
 * Unavailable or corrupt historical state is an explicit `stop`: the ledger is never rebuilt from a
 * proposal (that would erase the superseded records), the backup path is reported, and the caller
 * fails the run instead of drafting against an invented history.
 *
 * Same-directory temp file + `rename` gives the atomic replacement (one filesystem, one inode
 * swap) and the previous text is copied to `<ledger>.bak-<stamp>` first, so a restore is a `cp`.
 *
 * Node/Bun builtins only — the plugin ships this file beside the other stage bodies.
 */
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Machine block delimiters — the only part of `conclusion.md` this module reads or writes. */
export const LEDGER_BEGIN = '<!-- kk:judgment-ledger:begin -->';
export const LEDGER_END = '<!-- kk:judgment-ledger:end -->';

/** The lock name every judgment commit claims (ADR-054; the kk store single-flight DAO). */
export const LEDGER_LOCK_NAME = 'kk-news-editorial-ledger';

/** A judgment's lifecycle position. `aired` is only ever set by a later evidence step, never here. */
export type JudgmentStatus = 'pending' | 'aired' | 'superseded';

/** Where a judgment came from: the selected item, the evidence URL and when it was checked. */
export interface JudgmentEvidence {
    url: string;
    checkedAt: string;
}

/** One durable editorial judgment, identified by a stable ID. */
export interface Judgment {
    id: string;
    selectedId: string;
    storyKey?: string;
    date: string;
    fact: string;
    attribution: string;
    comment: string;
    evidence: JudgmentEvidence;
    supersedes: string | null;
    status: JudgmentStatus;
    /** Filled when a later judgment supersedes this one; the record itself is never rewritten. */
    supersededBy?: string | null;
    contentDigest: string;
}

/** The committed ledger: judgments plus the superseded records they displaced. */
export interface JudgmentLedger {
    version: 1;
    updatedAt: string;
    judgments: Judgment[];
}

/** One proposed judgment from the agent's alignment pass. */
export interface ProposalEntry {
    id: string;
    selectedId: string;
    storyKey?: string;
    date: string;
    fact: string;
    attribution: string;
    comment: string;
    evidence: JudgmentEvidence;
    supersedes?: string | null;
}

/** The agent's `align` output. An empty `judgments` array is legal and means "nothing new". */
export interface AlignmentProposal {
    version: 1;
    judgments: ProposalEntry[];
    /** Optional editorial preamble (the correction wording the draft must carry). */
    preamble?: string;
}

/**
 * A retired judgment as it was committed — carried into the snapshot so a consumer told to read only
 * the snapshot (0385/0396) can still name *what* was wrong: old id, date, fact, comment, and the id
 * that displaced it. The ledger stays the authority; this is a read-only projection of it.
 */
export interface SupersededRecord {
    id: string;
    date: string;
    fact: string;
    attribution: string;
    comment: string;
    supersededBy: string;
}

/** One correction the draft owes the listener: which judgment was wrong and what replaces it. */
export interface Correction {
    correctionId: string;
    supersedes: string;
    judgmentId: string;
    selectedId: string;
    /** The superseding judgment's comment — the replacement wording the draft speaks. */
    wording: string;
    /** Render-able correction sentence (old claim + replacement), so no consumer re-invents it. */
    text: string;
    /** The retired judgment verbatim: the evidence 0396 names, without re-reading the ledger. */
    retired: SupersededRecord;
    evidence: JudgmentEvidence;
}

/** The immutable, run-scoped snapshot the draft reads (0385) and the correction list (0396). */
export interface JudgmentSnapshot {
    version: 1;
    runDate: string;
    frozenAt: string;
    ledgerDigest: string;
    proposalDigest: string;
    judgments: Judgment[];
    /** Every retired record the ledger holds (never rewritten here) — the correction's subject. */
    superseded: SupersededRecord[];
    corrections: Correction[];
    /** The `## 本期更正说明` block: the acknowledgment the draft owes, frozen with the records. */
    preamble: string | null;
}

/** What a commit did. `applied` wrote, `no-op` was already there, `conflict` lost the CAS, `stop` refuses. */
export type CommitStatus = 'applied' | 'no-op' | 'conflict' | 'stop';

/** The lock seam: the existing kk store single-flight claim, injected so tests stay offline. */
export interface LockPort {
    acquire(name: string, run: string): Promise<boolean>;
    release(name: string, run: string): Promise<void>;
}

/** No-lock default; the receipt records `lock: "none"` so a skipped claim is visible evidence. */
export const NULL_LOCK: LockPort = {
    acquire: async () => true,
    release: async () => {},
};

/** The commit receipt — the recovery evidence the design asks for. */
export interface CommitReceipt {
    version: 1;
    status: CommitStatus;
    reason: string;
    lock: 'held' | 'none' | 'contended';
    ledgerPath: string;
    snapshotPath: string;
    backupPath: string | null;
    ledgerDigestBefore: string | null;
    ledgerDigestAfter: string | null;
    proposalDigest: string;
    initialized: boolean;
    snapshotReused: boolean;
    appended: string[];
    superseded: string[];
    correctionIds: string[];
    /**
     * Judgments the *stage* dropped before the commit because the settled plan no longer carries the
     * id they cite (the proposal is authored in `curate`, the plan is settled afterwards). Recorded as
     * `<judgmentId>=> <selectedId>` — the drop is never silent.
     */
    droppedByReselection: string[];
    /** Populated on `stop`/`conflict`: the two paths an operator restores from. */
    recovery: { ledgerPath: string; backupPath: string | null; action: string } | null;
    errors: string[];
    committedAt: string;
}

/** Result of one reconcile pass over an in-memory ledger. */
export interface ReconcileResult {
    status: 'applied' | 'no-op' | 'conflict';
    reason: string;
    ledger: JudgmentLedger;
    appended: string[];
    superseded: string[];
    corrections: Correction[];
    errors: string[];
}

/** Options for {@link commitAlignment}. */
export interface CommitOptions {
    ledgerPath: string;
    snapshotPath: string;
    receiptPath: string;
    proposal: AlignmentProposal;
    selectedIds: Set<string>;
    runDate: string;
    runId: string;
    now: string;
    lock?: LockPort;
    /**
     * Ids the caller already dropped as reselected away. The ledger API itself still refuses an
     * unknown id (that refusal is honest); it only surfaces the caller's drop in the receipt.
     */
    droppedByReselection?: string[];
}

/** Stable JSON (sorted keys) so a digest never depends on key order. */
function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

/** sha256 of the stable JSON form — the digest every comparison uses. */
export function digestOf(value: unknown): string {
    return createHash('sha256').update(stableJson(value)).digest('hex');
}

/** The evidence-and-comment digest of one judgment; a changed value is a conflicting rewrite. */
export function judgmentDigest(entry: {
    selectedId: string;
    date: string;
    fact: string;
    attribution: string;
    comment: string;
    evidence: JudgmentEvidence;
    storyKey?: string;
}): string {
    return digestOf({
        selectedId: entry.selectedId,
        storyKey: entry.storyKey ?? '',
        date: entry.date,
        fact: entry.fact,
        attribution: entry.attribution,
        comment: entry.comment,
        evidence: { url: entry.evidence.url, checkedAt: entry.evidence.checkedAt },
    });
}

/** An empty ledger for a run that has never committed (first initialization, R10 "首次初始化"). */
export function emptyLedger(now: string): JudgmentLedger {
    return { version: 1, updatedAt: now, judgments: [] };
}

/** Parse the machine block. `error` is set for anything that is present but unreadable. */
export function parseConclusion(text: string): { ledger: JudgmentLedger | null; error: string | null } {
    // `lastIndexOf`: the render preamble quotes both markers in prose, the block is the last one.
    const begin = text.lastIndexOf(LEDGER_BEGIN);
    const end = text.lastIndexOf(LEDGER_END);
    if (begin < 0 && end < 0) {
        return { ledger: null, error: null };
    }
    if (begin < 0 || end < begin) {
        return { ledger: null, error: 'judgment ledger block markers are unbalanced' };
    }
    const body = text.slice(begin + LEDGER_BEGIN.length, end).trim();
    const fenced = body.match(/```json\n([\s\S]*?)\n```/);
    if (!fenced) {
        return { ledger: null, error: 'judgment ledger block carries no ```json fence' };
    }
    try {
        const parsed = JSON.parse(fenced[1]) as JudgmentLedger;
        if (!parsed || !Array.isArray(parsed.judgments)) {
            return { ledger: null, error: 'judgment ledger block has no judgments array' };
        }
        return { ledger: parsed, error: null };
    } catch (error) {
        return { ledger: null, error: `judgment ledger block is not valid JSON: ${String(error)}` };
    }
}

/** Render the human-readable records plus the machine block the next run parses. */
export function renderConclusion(ledger: JudgmentLedger, preamble?: string): string {
    const active = ledger.judgments.filter((entry) => entry.status !== 'superseded');
    const retired = ledger.judgments.filter((entry) => entry.status === 'superseded');
    const lines: string[] = [
        '# 每日判断账本 · conclusion',
        '',
        '本文件是《每日AI乱炖》唯一的可写判断账本（ADR-054）。人工可读部分由确定性步骤生成，',
        `机器块（${LEDGER_BEGIN} … ${LEDGER_END}）请勿手改；更正记录一经提交不再改写。`,
        '',
    ];
    if (preamble?.trim()) {
        lines.push('## 本期更正说明', '', preamble.trim(), '');
    }
    lines.push(`## 现行判断（${active.length}）`, '');
    for (const entry of active) {
        lines.push(`### ${entry.id} · ${entry.date}`, '');
        lines.push(`- 事实：${entry.fact}`);
        lines.push(`- 归因：${entry.attribution}`);
        lines.push(`- 评论：${entry.comment}`);
        lines.push(`- 证据：${entry.evidence.url}（核查于 ${entry.evidence.checkedAt}）`);
        lines.push(`- 关联选题：${entry.selectedId}${entry.storyKey ? ` · ${entry.storyKey}` : ''}`);
        lines.push(`- 状态：${entry.status}`);
        lines.push('');
    }
    lines.push(`## 被取代记录（${retired.length}，保留不改写）`, '');
    for (const entry of retired) {
        lines.push(`- ${entry.id}（${entry.date}）→ 由 ${entry.supersededBy ?? '未记录'} 取代：${entry.fact}`);
    }
    if (retired.length === 0) {
        lines.push('- 无');
    }
    lines.push('');
    lines.push('<!-- 机器块：确定性步骤写入 -->');
    lines.push(LEDGER_BEGIN);
    lines.push('```json');
    lines.push(JSON.stringify(ledger, null, 2));
    lines.push('```');
    lines.push(LEDGER_END);
    lines.push('');
    return lines.join('\n');
}

/** Validate a proposal against the selection provenance and its own evidence. */
export function validateProposal(proposal: AlignmentProposal, selectedIds: Set<string>): { errors: string[] } {
    const errors: string[] = [];
    if (!proposal || !Array.isArray(proposal.judgments)) {
        return { errors: ['proposal has no judgments array'] };
    }
    const seen = new Set<string>();
    for (const entry of proposal.judgments) {
        const label = entry?.id ? entry.id : '<missing id>';
        if (!entry?.id || typeof entry.id !== 'string') {
            errors.push(`${label}: judgment is missing a stable id`);
        } else if (seen.has(entry.id)) {
            errors.push(`${label}: duplicate judgment id in one proposal`);
        }
        if (entry?.id) {
            seen.add(entry.id);
        }
        if (!entry.selectedId || !selectedIds.has(entry.selectedId)) {
            errors.push(`${label}: selected id '${entry.selectedId}' is not in this run's selection`);
        }
        if (!entry.evidence?.url || !/^https?:\/\//.test(entry.evidence.url)) {
            errors.push(`${label}: evidence needs an http(s) url`);
        }
        if (!entry.evidence?.checkedAt || Number.isNaN(Date.parse(entry.evidence.checkedAt))) {
            errors.push(`${label}: evidence needs an ISO checkedAt`);
        }
        for (const field of ['fact', 'attribution', 'comment', 'date'] as const) {
            if (!entry[field] || typeof entry[field] !== 'string') {
                errors.push(`${label}: missing ${field}`);
            }
        }
    }
    return { errors };
}

/** A correction ID bound to its superseded judgment — stable, so 0396 can dedupe deliveries. */
export function correctionIdFor(supersedes: string, judgmentId: string): string {
    return `corr-${digestOf({ supersedes, judgmentId }).slice(0, 16)}`;
}

/**
 * Reconcile a proposal against the committed ledger.
 *
 * Same id + same digest → replay (no append). Same id + different digest → `conflict`: a confirmed
 * judgment is never overwritten. Superseded records stay in place with `supersededBy` set.
 */
export function reconcileLedger(
    ledger: JudgmentLedger,
    proposal: AlignmentProposal,
    selectedIds: Set<string>,
    now: string,
): ReconcileResult {
    const validation = validateProposal(proposal, selectedIds);
    const result: ReconcileResult = {
        status: 'no-op',
        reason: 'no new judgments',
        ledger: { ...ledger, judgments: [...ledger.judgments] },
        appended: [],
        superseded: [],
        corrections: [],
        errors: validation.errors,
    };
    if (validation.errors.length > 0) {
        result.status = 'stop' as ReconcileResult['status'];
        result.reason = 'proposal failed validation — nothing committed';
        return result;
    }

    const byId = new Map(ledger.judgments.map((entry) => [entry.id, entry]));
    const next: Judgment[] = [...ledger.judgments];

    for (const entry of proposal.judgments) {
        const digest = judgmentDigest(entry);
        const existing = byId.get(entry.id);
        if (existing) {
            if (existing.contentDigest === digest) {
                continue; // replay: identical judgment already committed
            }
            result.status = 'conflict';
            result.reason = `judgment '${entry.id}' already exists with different content`;
            result.errors.push(`${entry.id}: conflict with the committed judgment`);
            return result;
        }
        const target = entry.supersedes ? byId.get(entry.supersedes) : null;
        if (entry.supersedes && !target) {
            result.status = 'conflict';
            result.reason = `supersedes target '${entry.supersedes}' is not in the ledger`;
            result.errors.push(`${entry.id}: unknown supersedes target '${entry.supersedes}'`);
            return result;
        }
        if (target && target.status === 'superseded') {
            result.status = 'conflict';
            result.reason = `supersedes target '${entry.supersedes}' was already superseded`;
            result.errors.push(`${entry.id}: '${entry.supersedes}' is already superseded`);
            return result;
        }
        next.push({
            id: entry.id,
            selectedId: entry.selectedId,
            ...(entry.storyKey ? { storyKey: entry.storyKey } : {}),
            date: entry.date,
            fact: entry.fact,
            attribution: entry.attribution,
            comment: entry.comment,
            evidence: { url: entry.evidence.url, checkedAt: entry.evidence.checkedAt },
            supersedes: entry.supersedes ?? null,
            status: 'pending',
            supersededBy: null,
            contentDigest: digest,
        });
        result.appended.push(entry.id);
        if (target) {
            result.superseded.push(target.id);
            result.corrections.push({
                correctionId: correctionIdFor(target.id, entry.id),
                supersedes: target.id,
                judgmentId: entry.id,
                selectedId: entry.selectedId,
                wording: entry.comment,
                evidence: { url: entry.evidence.url, checkedAt: entry.evidence.checkedAt },
            });
        }
    }

    if (result.appended.length > 0) {
        result.status = 'applied';
        result.reason = `appended ${result.appended.length} judgment(s)`;
        const supersededSet = new Set(result.superseded);
        result.ledger = {
            version: 1,
            updatedAt: now,
            judgments: next.map((entry) => {
                if (!supersededSet.has(entry.id)) {
                    return entry;
                }
                const replacement = result.corrections.find((correction) => correction.supersedes === entry.id);
                return {
                    ...entry,
                    status: 'superseded' as JudgmentStatus,
                    supersededBy: replacement?.judgmentId ?? null,
                };
            }),
        };
    }
    return result;
}

/** Same-directory temp file + rename: a reader never sees a partial ledger. */
export function writeAtomic(destPath: string, text: string): void {
    const parent = dirname(destPath);
    if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
    }
    const tmpPath = `${destPath}.tmp.${process.pid}.${Date.now()}`;
    const mode = existsSync(destPath) ? statSync(destPath).mode & 0o777 : 0o644;
    try {
        writeFileSync(tmpPath, text, { encoding: 'utf-8', mode });
        renameSync(tmpPath, destPath);
    } catch (error) {
        rmSync(tmpPath, { force: true });
        throw error;
    }
}

/** Read the snapshot the draft consumes; `null` when absent. */
export function readSnapshot(snapshotPath: string): JudgmentSnapshot | null {
    if (!existsSync(snapshotPath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(snapshotPath, 'utf-8')) as JudgmentSnapshot;
    } catch {
        return null;
    }
}

/**
 * Commit one alignment proposal.
 *
 * Order matters and is the whole contract: read → validate → lock → CAS → backup → atomic write →
 * snapshot → receipt. Every early return writes a receipt too, so a stop or a lost CAS leaves the
 * same auditable artifact as a success.
 */
export async function commitAlignment(options: CommitOptions): Promise<CommitReceipt> {
    const { ledgerPath, snapshotPath, receiptPath, proposal, selectedIds, runDate, runId, now } = options;
    const lock = options.lock ?? NULL_LOCK;
    const proposalDigest = digestOf(proposal.judgments ?? []);
    const receipt = (filled?: Partial<CommitReceipt>): CommitReceipt => ({
        version: 1,
        status: 'stop',
        reason: '',
        lock: 'none',
        ledgerPath,
        snapshotPath,
        backupPath: null,
        ledgerDigestBefore: null,
        ledgerDigestAfter: null,
        proposalDigest,
        initialized: false,
        snapshotReused: false,
        appended: [],
        superseded: [],
        correctionIds: [],
        droppedByReselection: options.droppedByReselection ?? [],
        recovery: null,
        errors: [],
        committedAt: now,
        ...filled,
    });

    // 1. Read the historical state. Unavailable or corrupt is a STOP, never a rebuild.
    let before: string | null = null;
    let ledger: JudgmentLedger;
    let initialized = false;
    if (existsSync(ledgerPath)) {
        try {
            before = readFileSync(ledgerPath, 'utf-8');
        } catch (error) {
            const stopped = receipt({
                reason: `judgment ledger is unreadable: ${String(error)}`,
                backupPath: `${ledgerPath}.bak`,
                recovery: { ledgerPath, backupPath: `${ledgerPath}.bak`, action: 'restore the ledger, then re-run' },
                errors: ['ledger-unreadable'],
            });
            persistReceipt(receiptPath, stopped);
            return stopped;
        }
        const parsed = parseConclusion(before);
        if (parsed.error) {
            const stopped = receipt({
                status: 'stop',
                reason: `judgment ledger is corrupt: ${parsed.error}`,
                ledgerDigestBefore: digestOf(before),
                backupPath: `${ledgerPath}.corrupt`,
                recovery: {
                    ledgerPath,
                    backupPath: `${ledgerPath}.corrupt`,
                    action: 'inspect the machine block; restore a backup; do not regenerate the ledger from a proposal',
                },
                errors: [parsed.error],
            });
            // Keep the corrupt text so the operator can diff it, and never overwrite it.
            safeCopy(ledgerPath, `${ledgerPath}.corrupt`);
            persistReceipt(receiptPath, stopped);
            return stopped;
        }
        ledger = parsed.ledger ?? emptyLedger(now);
    } else {
        ledger = emptyLedger(now);
        initialized = true;
    }
    const beforeDigest = before === null ? null : digestOf(before);

    // 2. Serialize on the existing kk lock (scoped to the ledger), then CAS against the re-read.
    let lockState: CommitReceipt['lock'] = 'none';
    let acquired = true;
    if (options.lock) {
        acquired = await lock.acquire(LEDGER_LOCK_NAME, runId);
        lockState = acquired ? 'held' : 'contended';
    }
    if (!acquired) {
        const stopped = receipt({
            status: 'conflict',
            reason: 'another run holds the judgment ledger lock',
            lock: lockState,
            ledgerDigestBefore: beforeDigest,
            recovery: { ledgerPath, backupPath: null, action: 're-run after the holder releases the claim' },
        });
        persistReceipt(receiptPath, stopped);
        return stopped;
    }

    try {
        const reRead = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf-8') : null;
        const reReadDigest = reRead === null ? null : digestOf(reRead);
        if (reReadDigest !== beforeDigest) {
            const stopped = receipt({
                status: 'conflict',
                reason: 'judgment ledger changed while the proposal was being prepared (CAS mismatch)',
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                recovery: { ledgerPath, backupPath: null, action: 're-align against the newest ledger' },
            });
            persistReceipt(receiptPath, stopped);
            return stopped;
        }

        const reconciled = reconcileLedger(ledger, proposal, selectedIds, now);
        if (reconciled.status === 'stop') {
            const stopped = receipt({
                status: 'stop',
                reason: reconciled.reason,
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                recovery: { ledgerPath, backupPath: null, action: 'fix the proposal and re-align' },
                errors: reconciled.errors,
            });
            persistReceipt(receiptPath, stopped);
            return stopped;
        }
        if (reconciled.status === 'conflict') {
            const stopped = receipt({
                status: 'conflict',
                reason: reconciled.reason,
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                recovery: {
                    ledgerPath,
                    backupPath: null,
                    action: 'a confirmed judgment differs; publish a superseding judgment instead',
                },
                errors: reconciled.errors,
            });
            persistReceipt(receiptPath, stopped);
            return stopped;
        }

        // 3. Snapshot: reuse the legal one when there is nothing new; a changed digest on the same
        //    run date is a conflict (the snapshot is immutable evidence for the draft).
        const existingSnapshot = readSnapshot(snapshotPath);
        if (reconciled.status === 'no-op') {
            const reusable =
                existingSnapshot !== null &&
                existingSnapshot.runDate === runDate &&
                (beforeDigest === null || existingSnapshot.ledgerDigest === beforeDigest);
            if (reusable) {
                const noop = receipt({
                    status: 'no-op',
                    reason: 'replayed proposal — ledger and snapshot already carry these judgments',
                    lock: lockState,
                    ledgerDigestBefore: beforeDigest,
                    ledgerDigestAfter: beforeDigest,
                    initialized: false,
                    snapshotReused: true,
                    correctionIds: existingSnapshot.corrections.map((entry) => entry.correctionId),
                });
                persistReceipt(receiptPath, noop);
                return noop;
            }
            // No new judgment but no legal snapshot yet: freeze one from the committed ledger.
            const afterText = before ?? renderConclusion(reconciled.ledger);
            const afterDigest = digestOf(afterText);
            const snapshot = buildSnapshot(
                reconciled.ledger,
                runDate,
                now,
                afterDigest,
                proposalDigest,
                resolvePreamble(proposal, before),
            );
            writeAtomic(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
            const noop = receipt({
                status: 'no-op',
                reason: 'no new judgment — the committed ledger is the snapshot for this run',
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                ledgerDigestAfter: afterDigest,
                initialized: false,
                snapshotReused: false,
                correctionIds: snapshot.corrections.map((entry) => entry.correctionId),
            });
            persistReceipt(receiptPath, noop);
            return noop;
        }

        if (
            existingSnapshot !== null &&
            existingSnapshot.runDate === runDate &&
            existingSnapshot.ledgerDigest !== (beforeDigest ?? '')
        ) {
            // The run already froze a different history: adopting the new one would rewrite evidence.
            const stopped = receipt({
                status: 'conflict',
                reason: 'this run already froze a snapshot from a different ledger revision',
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                backupPath: null,
                recovery: { ledgerPath, backupPath: null, action: 'start a new run directory for the new judgments' },
            });
            persistReceipt(receiptPath, stopped);
            return stopped;
        }

        const preamble = resolvePreamble(proposal, before);
        const text = renderConclusion(reconciled.ledger, preamble);
        if (before !== null) {
            const backupPath = `${ledgerPath}.bak-${now.replace(/[:.]/g, '')}`;
            copyFileSync(ledgerPath, backupPath);
            writeAtomic(ledgerPath, text);
            const afterDigest = digestOf(readFileSync(ledgerPath, 'utf-8'));
            const snapshot = buildSnapshot(
                reconciled.ledger,
                runDate,
                now,
                afterDigest,
                proposalDigest,
                resolvePreamble(proposal, before),
            );
            writeAtomic(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
            const applied = receipt({
                status: 'applied',
                reason: reconciled.reason,
                lock: lockState,
                ledgerDigestBefore: beforeDigest,
                ledgerDigestAfter: afterDigest,
                backupPath,
                snapshotReused: false,
                appended: reconciled.appended,
                superseded: reconciled.superseded,
                correctionIds: snapshot.corrections.map((entry) => entry.correctionId),
            });
            persistReceipt(receiptPath, applied);
            return applied;
        }

        writeAtomic(ledgerPath, text);
        const afterDigest = digestOf(readFileSync(ledgerPath, 'utf-8'));
        const snapshot = buildSnapshot(
            reconciled.ledger,
            runDate,
            now,
            afterDigest,
            proposalDigest,
            resolvePreamble(proposal, before),
        );
        writeAtomic(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
        const applied = receipt({
            status: 'applied',
            reason: `${reconciled.reason} (first initialization)`,
            lock: lockState,
            ledgerDigestBefore: null,
            ledgerDigestAfter: afterDigest,
            backupPath: null,
            initialized,
            snapshotReused: false,
            appended: reconciled.appended,
            superseded: reconciled.superseded,
            correctionIds: snapshot.corrections.map((entry) => entry.correctionId),
        });
        persistReceipt(receiptPath, applied);
        return applied;
    } finally {
        if (options.lock) {
            await lock.release(LEDGER_LOCK_NAME, runId);
        }
    }
}

/** Keep an existing `## 本期更正说明` block when the ledger is rewritten. */
export function readPreamble(text: string | null): string | undefined {
    if (!text) {
        return undefined;
    }
    const match = text.match(/## 本期更正说明\n\n([\s\S]*?)\n\n## /);
    return match ? match[1].trim() : undefined;
}

/** The retired part of a judgment record, projected without the lifecycle fields. */
function retiredRecord(entry: Judgment): SupersededRecord {
    return {
        id: entry.id,
        date: entry.date,
        fact: entry.fact,
        attribution: entry.attribution,
        comment: entry.comment,
        supersededBy: entry.supersededBy as string,
    };
}

/** The correction sentence: what was said, and what replaces it — renderable, no invention needed. */
function correctionSentence(retired: SupersededRecord, replacement: Judgment | undefined): string {
    const corrected = replacement?.comment?.trim() || '（新判断）';
    return `${retired.date} 的判断「${retired.fact}」经核验有误，现更正为：${corrected}`;
}

/** The preamble the draft must carry: this proposal's wording wins, the committed one is the fallback. */
export function resolvePreamble(proposal: AlignmentProposal, ledgerText: string | null): string | undefined {
    const proposed = proposal.preamble?.trim();
    return proposed ? proposed : readPreamble(ledgerText);
}

/**
 * Freeze the run-scoped snapshot the draft (0385) and corrections (0396) consume.
 *
 * The snapshot is a *projection*, not a second ledger: retired records are excluded from
 * `judgments` (they may not be drafted from) but carried verbatim in `superseded` and inside each
 * `correction.retired`, so "what was wrong" is answerable from the snapshot alone.
 */
export function buildSnapshot(
    ledger: JudgmentLedger,
    runDate: string,
    now: string,
    ledgerDigest: string,
    proposalDigest: string,
    preamble?: string | null,
): JudgmentSnapshot {
    const retired = ledger.judgments.filter((entry) => entry.status === 'superseded' && entry.supersededBy);
    const superseded = retired.map((entry) => retiredRecord(entry));
    const corrections: Correction[] = retired.map((entry) => {
        const replacement = ledger.judgments.find((candidate) => candidate.id === entry.supersededBy);
        const record = retiredRecord(entry);
        return {
            correctionId: correctionIdFor(entry.id, entry.supersededBy as string),
            supersedes: entry.id,
            judgmentId: entry.supersededBy as string,
            selectedId: replacement?.selectedId ?? entry.selectedId,
            wording: replacement?.comment ?? '',
            text: correctionSentence(record, replacement),
            retired: record,
            evidence: replacement?.evidence ?? entry.evidence,
        };
    });
    return {
        version: 1,
        runDate,
        frozenAt: now,
        ledgerDigest,
        proposalDigest,
        judgments: ledger.judgments.filter((entry) => entry.status !== 'superseded'),
        superseded,
        corrections,
        preamble: preamble?.trim() || null,
    };
}

/**
 * Reselect tolerance for the *stage*, not the ledger (0384 P3 follow-up).
 *
 * The `align` proposal is authored inside the `curate` node; `curate-check`, `curate-fix` and the
 * `--final` fallback settle the plan afterwards, so a proposal can legitimately cite a selected id
 * the settled plan no longer carries. {@link validateProposal} refuses that id — correctly, an
 * unknown id must never be committed — so the stage drops those judgments *before* the commit and
 * records the ids in the receipt: the surviving judgments still commit, and a proposal with nothing
 * committable left behaves exactly like the documented empty proposal (reuse this run's snapshot).
 */
export function dropReselectedJudgments(
    proposal: AlignmentProposal,
    selectedIds: Set<string>,
): { proposal: AlignmentProposal; dropped: string[]; droppedIds: string[] } {
    const keep: ProposalEntry[] = [];
    const dropped: string[] = [];
    const droppedIds: string[] = [];
    for (const entry of proposal.judgments ?? []) {
        const cited = typeof entry?.selectedId === 'string' ? entry.selectedId.trim() : '';
        if (cited !== '' && !selectedIds.has(cited)) {
            dropped.push(`${entry.id || '<missing id>'}=> ${cited}`);
            droppedIds.push(entry.id || '<missing id>');
            continue;
        }
        keep.push(entry);
    }
    return {
        proposal: dropped.length === 0 ? proposal : { ...proposal, judgments: keep },
        dropped,
        droppedIds,
    };
}

function persistReceipt(receiptPath: string, receipt: CommitReceipt): void {
    writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function safeCopy(from: string, to: string): void {
    try {
        copyFileSync(from, to);
    } catch {
        // best-effort: the receipt still names the path
    }
}
