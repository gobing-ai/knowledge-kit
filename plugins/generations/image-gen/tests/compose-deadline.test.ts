/**
 * 0212 dogfood (2026-10-08) — ChromiumComposer deadline.
 *
 * Live run 38e53162 hung 40 min in `compose` after the illustration was written: Playwright's
 * Chromium cycle can stall under Bun 1.3.14 and nothing bounded it, so `daily-xhs-render` (and
 * the DAG) waited forever. Failure modes, written before the fix:
 * 1. render never settles   → compose rejects naming the deadline (the process can then exit).
 * 2. render settles in time → bytes pass through untouched; the timer is cleared.
 * 3. render rejects early   → the original error surfaces, not a timeout.
 */

import { describe, expect, test } from 'bun:test';
import type { CardInput } from '../src/compose/card';
import { ChromiumComposer } from '../src/compose/chromium';

class StubComposer extends ChromiumComposer {
    constructor(
        private readonly stub: () => Promise<Uint8Array>,
        timeoutMs: number,
    ) {
        super({ timeoutMs });
    }
    protected override render(_input: CardInput): Promise<Uint8Array> {
        return this.stub();
    }
}

const INPUT = {} as CardInput;

describe('ChromiumComposer deadline', () => {
    test('a render that never settles rejects with the deadline named', async () => {
        const composer = new StubComposer(() => new Promise<Uint8Array>(() => {}), 30);
        await expect(composer.compose(INPUT)).rejects.toThrow(/compose: Chromium did not finish within 30ms/);
    });

    test('a render that settles in time returns its bytes', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const composer = new StubComposer(async () => bytes, 1000);
        expect(await composer.compose(INPUT)).toBe(bytes);
    });

    test('a render that fails early surfaces its own error, not the deadline', async () => {
        const composer = new StubComposer(async () => {
            throw new Error('compose: text overflows the safe area for field(s): headline');
        }, 1000);
        await expect(composer.compose(INPUT)).rejects.toThrow(/overflows the safe area/);
    });
});
