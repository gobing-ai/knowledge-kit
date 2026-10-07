import { afterAll, describe, expect, it } from 'bun:test';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('CollectRunsDao', () => {
    it('records a run and closes it with its counters', async () => {
        const { store } = await openTempStore(makeTempDir(), 'runs.db');
        const started = await store.collectRuns.start(
            { runId: 'run-7', sourceCounts: { aihot: 3, horizon: 5 } },
            1_000,
        );
        expect(started.status).toBe('running');
        expect(started.startedAt).toBe(1_000);
        expect(started.sourceCountsJson).toBe('{"aihot":3,"horizon":5}');
        expect(started.inserted).toBe(0);

        expect(await store.collectRuns.finish('run-7', { status: 'done', inserted: 7, updated: 1 }, 2_000)).toBe(true);
        const finished = await store.collectRuns.findById('run-7');
        expect(finished?.status).toBe('done');
        expect(finished?.inserted).toBe(7);
        expect(finished?.updated).toBe(1);
        expect(finished?.finishedAt).toBe(2_000);
        expect(finished?.sourceCountsJson).toBe('{"aihot":3,"horizon":5}');
    });

    it('fails loudly when a run id is recorded twice, and reports an unknown run', async () => {
        const { store } = await openTempStore(makeTempDir(), 'runs-dupe.db');
        await store.collectRuns.start({ runId: 'run-1' });
        await expect(store.collectRuns.start({ runId: 'run-1' })).rejects.toThrow();
        expect(await store.collectRuns.finish('absent', { status: 'done' })).toBe(false);
    });
});
