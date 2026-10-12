import { describe, expect, it } from 'bun:test';
import {
    ACTIVE_POLL_MS,
    delayMs,
    failed,
    freshnessLabel,
    initialRefresh,
    isStale,
    MAX_BACKOFF_MS,
    succeeded,
    tick,
} from '../../src/shared/refresh';

describe('refresh state machine', () => {
    it('ignores a tick while a request is pending (no overlapping requests)', () => {
        const pending = tick(initialRefresh(ACTIVE_POLL_MS));
        expect(pending.pending).toBe(true);
        expect(tick(pending)).toBe(pending);
    });

    it('records the last success and returns to the steady interval', () => {
        const state = succeeded(1_000, ACTIVE_POLL_MS);
        expect(state.lastSuccessAt).toBe(1_000);
        expect(state.failures).toBe(0);
        expect(delayMs(state, ACTIVE_POLL_MS)).toBe(ACTIVE_POLL_MS);
    });

    it('keeps the last success while failing and backs off up to the cap', () => {
        let state = succeeded(1_000, ACTIVE_POLL_MS);
        state = failed(state, 2_000);
        expect(isStale(state)).toBe(true);
        expect(state.lastSuccessAt).toBe(1_000);
        for (let i = 0; i < 10; i += 1) state = failed(state, 2_000);
        expect(state.backoffMs).toBe(MAX_BACKOFF_MS);
        expect(delayMs(state, ACTIVE_POLL_MS)).toBe(MAX_BACKOFF_MS);
    });

    it('says "not yet loaded" rather than pretending stale data is fresh', () => {
        expect(freshnessLabel(initialRefresh(ACTIVE_POLL_MS))).toBe('Not yet loaded');
    });
});
