/**
 * 0388 — one publish trigger per FROZEN run date (L3 R9).
 *
 * `kk news publish` stays the single entry point: this module owns the two decisions it makes before
 * the `kk-publish` workflow launches.
 *
 *  1. **The frozen date.** The episode day is resolved ONCE — an explicit `--run-date`, else the
 *     bundle's own `runDate`, else (legacy compatibility, no bundle yet) the window's Los Angeles
 *     day, where `overseas-rss` reads the episode that landed after the 07:00 tick. The retired
 *     behaviour let the *window* pick the day on every call, so `after-generate` and `overseas-rss`
 *     for the same bundle dispatched two different episode numbers
 *     (`apps/cli/src/commands/content-launch.ts:525`). A frozen date is window-independent: once a
 *     flag or a bundle names the day, no window can move it.
 *
 *  2. **The dispatch ledger.** One trigger walks the whole preset graph (every window) and records
 *     each target exactly once per frozen date: `dispatched`, `pending`, `retry`, `blocked`
 *     (dependency not satisfied), `deferred` (its own, later window) or `off` (authorization
 *     matrix). Completed effects are never re-run — a second trigger for the same date adopts the
 *     recorded `dispatched` entries — and an unready target is retried per target.
 *
 * The authorization matrix is preserved, not widened: `off` rows stay off, `draft` rows stay draft,
 * and `wechatmp-pub` never leaves the draft + QR-scan boundary (0395 owns the article binding, 0396
 * the correction evidence — neither is done here).
 */
import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { normalizeRunDate } from './publish-matrix';

/** Basename of the per-date dispatch ledger inside a run's `4-publish/` directory. */
export const DISPATCH_LEDGER_FILE = 'dispatch-ledger.json';

/** Where the frozen day came from. `clock` is the unpinned legacy fallback. */
export type FrozenDateSource = 'flag' | 'bundle' | 'clock';

/** The frozen run date plus the evidence of why it cannot move for this run. */
export interface FrozenRunDate {
    /** `YYYY-MM-DD`, the canonical form the matrix stamps into receipts. */
    runDate: string;
    source: FrozenDateSource;
    /** False only for the clock fallback: no flag and no bundle, so the window still owns the day. */
    pinned: boolean;
}

/** Calendar day (compact `YYYYMMDD`) of an instant in America/Los_Angeles, plus a day offset. */
export function losAngelesDate(instant: number, offsetDays = 0): string {
    const shifted = new Date(instant + offsetDays * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(shifted).replaceAll('-', '');
}

/**
 * Freeze the episode day. Precedence: explicit `--run-date`, then the archived bundle's own
 * `runDate`, then the clock. `window` is consulted ONLY by the clock fallback (legacy windows).
 * Throws when a supplied day is not a real calendar day or when the clock fallback produced one that
 * is not — a wrong day must stop the launch, not dispatch.
 */
export function resolveFrozenRunDate(input: {
    runDate?: string;
    bundleRunDate?: string;
    window: string;
    now?: number;
}): FrozenRunDate {
    if (input.runDate !== undefined && input.runDate.trim() !== '') {
        const day = normalizeRunDate(input.runDate);
        if (day === undefined) throw new Error(`--run-date '${input.runDate}' is not a real calendar day`);
        return { runDate: day, source: 'flag', pinned: true };
    }
    if (input.bundleRunDate !== undefined && input.bundleRunDate.trim() !== '') {
        const day = normalizeRunDate(input.bundleRunDate);
        if (day === undefined) throw new Error(`bundle runDate '${input.bundleRunDate}' is not a real calendar day`);
        return { runDate: day, source: 'bundle', pinned: true };
    }
    const compact = losAngelesDate(input.now ?? Date.now(), input.window === 'overseas-rss' ? -1 : 0);
    const day = normalizeRunDate(compact);
    if (day === undefined) throw new Error(`clock produced a non-calendar run date '${compact}'`);
    return { runDate: day, source: 'clock', pinned: false };
}

/** A preset target as the dispatch graph sees it (a subset of `PublishPresetTarget`). */
export interface DispatchTarget {
    plugin: string;
    id?: string;
    operation?: string;
    variant?: string;
    window?: string;
    mode?: 'off' | 'dummy' | 'draft' | 'live';
    tier?: number;
    required?: boolean;
}

/** Narrow set of modes a dispatch entry can actually hold; `off` never dispatches. */
export type DispatchMode = 'off' | 'dummy' | 'draft' | 'live';

/**
 * `dispatched` ran, `pending` may run on this trigger, `retry` failed and may be re-attempted alone,
 * `blocked` waits on an unsatisfied dependency, `deferred` belongs to a later window, `off` is the
 * authorization matrix saying no.
 */
export type DispatchState = 'dispatched' | 'pending' | 'retry' | 'blocked' | 'deferred' | 'off';

/** One target's position in the frozen-date graph. */
export interface DispatchEntry {
    id: string;
    plugin: string;
    window: string;
    tier: number;
    /** The mode the dispatch may actually use — never wider than the preset's own row. */
    mode: DispatchMode;
    state: DispatchState;
    attempts: number;
    /** WeChat's manual half of the boundary: the operator scans a QR and confirms the draft. */
    manualStep?: 'qr-scan';
    /** Why a `blocked` entry cannot run yet. */
    blockedBy?: string[];
    lastError?: string;
    url?: string;
}

/** The whole preset graph for one frozen date. */
export interface DispatchLedger {
    schemaVersion: 1;
    runDate: string;
    /** The window this trigger fires; the other windows' rows stay `deferred`. */
    window: string;
    frozenSource: FrozenDateSource;
    bundleRunId?: string;
    entries: DispatchEntry[];
}

/** Stable target id: `plugin[@operation]`, matching the matrix's own `targetId`. */
export function dispatchTargetId(target: DispatchTarget): string {
    if (target.id !== undefined && target.id !== '') return target.id;
    return target.operation === undefined ? target.plugin : `${target.plugin}@${target.operation}`;
}

/**
 * The mode a target may dispatch with. The preset is the authority (no widening), and WeChat keeps
 * its draft + QR boundary: a `live` wechatmp row is dispatched as a draft with the manual QR step
 * recorded, because the article binding is 0395's job and an auto-published WeChat article cannot be
 * recalled.
 */
export function effectiveMode(target: DispatchTarget): { mode: DispatchMode; manualStep?: 'qr-scan' } {
    const declared = target.mode ?? 'draft';
    if (declared === 'off') return { mode: 'off' };
    if (target.plugin === 'wechatmp-pub') {
        return declared === 'dummy' ? { mode: 'dummy' } : { mode: 'draft', manualStep: 'qr-scan' };
    }
    return { mode: declared };
}

/**
 * The dependency graph. Tier N depends on every non-`off` target of a LOWER tier in the SAME window:
 * the episode/article a later row links to must exist first, which is exactly what the tier field
 * encodes. Independent windows do not depend on each other — the frozen date is what ties them.
 */
export function dependenciesOf(target: DispatchTarget, targets: readonly DispatchTarget[]): string[] {
    const window = target.window ?? 'after-generate';
    const tier = target.tier ?? 3;
    return targets
        .filter(
            (other) =>
                (other.window ?? 'after-generate') === window &&
                (other.tier ?? 3) < tier &&
                effectiveMode(other).mode !== 'off',
        )
        .map(dispatchTargetId);
}

/**
 * Plan (or re-adopt) the frozen-date ledger. Idempotent per date: entries already `dispatched` keep
 * their state and attempts, so a second trigger for the same date never re-runs a completed effect.
 * A ledger from another date — or another window of a different run — is rebuilt from scratch.
 */
export function planDispatch(input: {
    runDate: string;
    window: string;
    targets: readonly DispatchTarget[];
    frozenSource?: FrozenDateSource;
    bundleRunId?: string;
    ledger?: DispatchLedger | null;
}): DispatchLedger {
    const prior =
        input.ledger !== null &&
        input.ledger !== undefined &&
        input.ledger.runDate === input.runDate &&
        (input.bundleRunId === undefined || input.ledger.bundleRunId === input.bundleRunId)
            ? new Map(input.ledger.entries.map((entry) => [entry.id, entry]))
            : new Map<string, DispatchEntry>();

    const entries: DispatchEntry[] = [];
    for (const target of input.targets) {
        const id = dispatchTargetId(target);
        const { mode, manualStep } = effectiveMode(target);
        const window = target.window ?? 'after-generate';
        const tier = target.tier ?? 3;
        const before = prior.get(id);
        const base = {
            id,
            plugin: target.plugin,
            window,
            tier,
            mode,
            ...(manualStep === undefined ? {} : { manualStep }),
        };
        if (mode === 'off') {
            entries.push({ ...base, state: 'off', attempts: before?.attempts ?? 0 });
            continue;
        }
        if (before !== undefined && (before.state === 'dispatched' || before.state === 'retry')) {
            // A completed effect (or a failed attempt awaiting a per-target retry) is adopted as is:
            // the trigger never re-runs it, and never silently upgrades its mode.
            entries.push({
                ...base,
                state: before.state,
                attempts: before.attempts,
                ...(before.lastError === undefined ? {} : { lastError: before.lastError }),
                ...(before.url === undefined ? {} : { url: before.url }),
            });
            continue;
        }
        const pending = dependenciesOf(target, input.targets).filter((dep) => {
            const recorded = prior.get(dep);
            return recorded === undefined ? true : recorded.state !== 'dispatched';
        });
        if (window !== input.window) {
            entries.push({ ...base, state: 'deferred', attempts: before?.attempts ?? 0 });
            continue;
        }
        if (pending.length > 0) {
            entries.push({ ...base, state: 'blocked', attempts: before?.attempts ?? 0, blockedBy: pending });
            continue;
        }
        entries.push({ ...base, state: 'pending', attempts: before?.attempts ?? 0 });
    }
    return {
        schemaVersion: 1,
        runDate: input.runDate,
        window: input.window,
        frozenSource: input.frozenSource ?? 'flag',
        ...(input.bundleRunId === undefined ? {} : { bundleRunId: input.bundleRunId }),
        entries,
    };
}

/** Entries this trigger may send now. */
export function dispatchable(ledger: DispatchLedger): DispatchEntry[] {
    return ledger.entries.filter((entry) => entry.state === 'pending');
}

/** Entries awaiting a per-target retry — the only ones a `--retry` trigger may re-attempt. */
export function retryable(ledger: DispatchLedger): DispatchEntry[] {
    return ledger.entries.filter((entry) => entry.state === 'retry');
}

/**
 * Fold one pass's outcomes into the ledger. `ok` promotes to `dispatched` (attempts + 1) and records
 * the owner URL; a failure becomes `retry` so only that target is re-attempted. Targets absent from
 * `results` keep their state — an un-attempted entry is never treated as done, and a done entry is
 * never re-opened by a partial pass.
 */
export function applyDispatchResults(
    ledger: DispatchLedger,
    results: ReadonlyArray<{ id: string; ok: boolean; url?: string; error?: string }>,
): DispatchLedger {
    const byId = new Map(results.map((result) => [result.id, result]));
    return {
        ...ledger,
        entries: ledger.entries.map((entry) => {
            const result = byId.get(entry.id);
            if (result === undefined) return entry;
            if (entry.state !== 'pending' && entry.state !== 'retry') return entry;
            const attempts = entry.attempts + 1;
            if (result.ok) {
                return {
                    ...entry,
                    state: 'dispatched',
                    attempts,
                    ...(result.url === undefined ? {} : { url: result.url }),
                };
            }
            return { ...entry, state: 'retry', attempts, lastError: result.error ?? 'dispatch failed' };
        }),
    };
}

/** One owner receipt as written by a send step. */
export interface OwnerReceipt {
    id?: string;
    plugin?: string;
    targetId?: string;
    bundleRunId?: string;
    parentRunId?: string;
    status?: string;
    mode?: string;
    url?: string;
}

/** Successful owner URLs, split by whether they may be linked as public owner URLs. */
export interface OwnerUrlResolution {
    /** Same-bundle, real (live) sends: usable as `{{article_url}}`-style owner links. */
    owner: Record<string, string>;
    /** Same-bundle drafts: recorded, but never promoted into a public owner link. */
    draft: Record<string, string>;
    /** Targets whose receipt belongs to another bundle (or is not a success) and were ignored. */
    ignored: string[];
}

/** Receipt statuses a resolver may treat as "this target owns a URL". */
const OK_STATUSES = new Set(['ok', 'sent', 'published', 'draft', 'succeeded', 'success']);

/**
 * Resolve owner URLs from THIS bundle's receipts only (0388: same-bundle receipts). A receipt whose
 * `bundleRunId`/`parentRunId` names an older bundle revision is ignored — linking a previous
 * episode's URL into today's post is the wrong-episode bug in a different disguise.
 */
export function resolveOwnerUrls(
    receipts: readonly OwnerReceipt[],
    input: { bundleRunId: string },
): OwnerUrlResolution {
    const resolution: OwnerUrlResolution = { owner: {}, draft: {}, ignored: [] };
    for (const receipt of receipts) {
        const id = receipt.targetId ?? receipt.id ?? receipt.plugin;
        if (id === undefined || id === '') continue;
        const bundleId = receipt.bundleRunId ?? receipt.parentRunId;
        const status = receipt.status ?? 'ok';
        if (
            bundleId === undefined ||
            bundleId !== input.bundleRunId ||
            !OK_STATUSES.has(status) ||
            receipt.url === undefined ||
            receipt.url === ''
        ) {
            resolution.ignored.push(id);
            continue;
        }
        if (receipt.mode === 'draft' || status === 'draft') {
            resolution.draft[id] = receipt.url;
            continue;
        }
        resolution.owner[id] = receipt.url;
    }
    return resolution;
}

/** Absolute path of a run's dispatch ledger. */
export function dispatchLedgerPath(workDir: string): string {
    return join(workDir, '4-publish', DISPATCH_LEDGER_FILE);
}

/** Read a run's dispatch ledger, or null when absent/corrupt (a corrupt ledger rebuilds). */
export async function readDispatchLedger(fs: FileSystem, workDir: string): Promise<DispatchLedger | null> {
    const path = dispatchLedgerPath(workDir);
    if (!(await fs.exists(path))) return null;
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(path));
        if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as DispatchLedger).entries)) {
            return null;
        }
        return parsed as DispatchLedger;
    } catch {
        return null;
    }
}

/** Persist a run's dispatch ledger (the durable record of "dispatched once per frozen date"). */
export async function writeDispatchLedger(fs: FileSystem, workDir: string, ledger: DispatchLedger): Promise<string> {
    const path = dispatchLedgerPath(workDir);
    await fs.ensureDir(join(workDir, '4-publish'));
    await fs.writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
    return path;
}
