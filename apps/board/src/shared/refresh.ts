/**
 * The polling/backoff state machine shared by every tab (design §6).
 *
 * Pure reducer: the React layer only dispatches events and reads the derived delay, so
 * refresh semantics (no overlapping requests, no selection theft, capped backoff,
 * last-success timestamps) are testable without timers or a DOM.
 */

/** Selected active run poll interval while the document is visible. */
export const ACTIVE_POLL_MS = 5_000;

/** Run-history poll interval while the document is visible. */
export const HISTORY_POLL_MS = 30_000;

/** Backoff cap after consecutive failures. */
export const MAX_BACKOFF_MS = 30_000;

/** One polled source's refresh state. */
export interface RefreshState {
    /** A request is in flight; a tick while pending is ignored (never overlap). */
    pending: boolean;
    /** Consecutive failures since the last success. */
    failures: number;
    /** Current retry delay: the steady interval, or the capped backoff. */
    backoffMs: number;
    /** Epoch ms of the last success, or null when the source never answered. */
    lastSuccessAt: number | null;
    /** Epoch ms of the first failure in the current streak, or null when healthy. */
    failingSince: number | null;
}

/** The initial state for a source polled at `intervalMs`. */
export function initialRefresh(intervalMs: number): RefreshState {
    return { pending: false, failures: 0, backoffMs: intervalMs, lastSuccessAt: null, failingSince: null };
}

/** Dispatch a tick: ignored while a request is pending, so requests never overlap. */
export function tick(state: RefreshState): RefreshState {
    return state.pending ? state : { ...state, pending: true };
}

/** Dispatch a success: fresh data, back to the steady interval. `lastSuccessAt` moves only here. */
export function succeeded(now: number, intervalMs: number): RefreshState {
    return { pending: false, failures: 0, backoffMs: intervalMs, lastSuccessAt: now, failingSince: null };
}

/** Dispatch a failure: keep the last successful payload, mark staleness, grow the backoff. */
export function failed(state: RefreshState, now: number): RefreshState {
    const failures = state.failures + 1;
    return {
        pending: false,
        failures,
        backoffMs: Math.min(state.backoffMs * 2, MAX_BACKOFF_MS),
        lastSuccessAt: state.lastSuccessAt,
        failingSince: state.failingSince ?? now,
    };
}

/** The delay before the next tick: the capped backoff while failing, else the steady interval. */
export function delayMs(state: RefreshState, intervalMs: number): number {
    return state.failures > 0 ? state.backoffMs : intervalMs;
}

/** Whether the displayed payload is stale (a failure streak is open). */
export function isStale(state: RefreshState): boolean {
    return state.failures > 0;
}

/**
 * The honest label for the current view: the last successful update, or an explicit
 * "not yet loaded" when the source never answered.
 */
export function freshnessLabel(state: RefreshState): string {
    if (state.lastSuccessAt === null) return 'Not yet loaded';
    const updated = new Date(state.lastSuccessAt).toISOString();
    return isStale(state) ? `Stale — last success ${updated}` : `Updated ${updated}`;
}
