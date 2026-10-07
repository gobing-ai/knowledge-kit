import { afterAll, describe, expect, it } from 'bun:test';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('EpisodeUsageDao', () => {
    it('marks an item used once per (workflow, run) and lists only that workflow', async () => {
        const { store } = await openTempStore(makeTempDir(), 'usage.db');
        await store.usage.markUsed({ itemId: 'i2', workflow: 'kk-daily-ai-voice2', runId: 'run-1' }, 1_000);
        await store.usage.markUsed({ itemId: 'i2', workflow: 'kk-daily-ai-voice2', runId: 'run-1' }, 2_000);
        await store.usage.markUsed({ itemId: 'i1', workflow: 'kk-daily-ai-voice2', runId: 'run-1' });
        await store.usage.markUsed({ itemId: 'i3', workflow: 'other-workflow', runId: 'run-9' });

        const rows = await store.usage.findAll();
        expect(rows).toHaveLength(3);
        expect(rows.find((row) => row.itemId === 'i2')?.usedAt).toBe(2_000);
        expect(await store.usage.usedItemIds('kk-daily-ai-voice2')).toEqual(['i1', 'i2']);
        expect(await store.usage.usedItemIds('other-workflow')).toEqual(['i3']);
    });

    it('records an item used by the same workflow in a later run as a second row', async () => {
        const { store } = await openTempStore(makeTempDir(), 'usage-runs.db');
        await store.usage.markUsed({ itemId: 'i1', workflow: 'w', runId: 'run-1' });
        await store.usage.markUsed({ itemId: 'i1', workflow: 'w', runId: 'run-2' });

        expect((await store.usage.findAll()).map((row) => row.runId)).toEqual(['run-1', 'run-2']);
    });
});
