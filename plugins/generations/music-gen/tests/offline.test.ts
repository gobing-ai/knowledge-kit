import { describe, expect, test } from 'bun:test';
import { createMusicInstance } from '../src/adapter';
import type { MusicFetch } from '../src/adapter/instance';
import {
    createOfflineInstance,
    OFFLINE_ANALYSIS_SUMMARY,
    OFFLINE_GENERATED_AT,
    OFFLINE_ID_PREFIX,
} from '../src/adapter/offline';
import { detectAudioFormat } from '../src/audio';
import { DEFAULT_GENERATE_TIMEOUT_MS, type MusicConfig } from '../src/config';
import { renderGenerateRequest } from '../src/request';
import { loadGoldenJob } from './goldens';

/**
 * AC4 (R4) — `KK_MUSIC_DRY_RUN=1` performs no network call: a deterministic
 * silent WAV, a synthetic manifest and a synthetic analysis, with no socket and
 * no HTTP stub needed for the test to pass.
 */

const REQUEST = renderGenerateRequest(loadGoldenJob('clip'));

/** A fetch that fails the test the moment anything calls it. */
const forbiddenFetch: MusicFetch = () => {
    throw new Error('the offline adapter must never call fetch');
};

const DRY_RUN_CONFIG: MusicConfig = {
    baseUrl: 'http://127.0.0.1:3000',
    timeoutMs: DEFAULT_GENERATE_TIMEOUT_MS,
    connectTimeoutMs: 5_000,
    prices: { pro: 0.08, clip: 0.04, analyze: null },
    dryRun: true,
};

describe('AC4 — the offline adapter performs no network call', () => {
    test('generate returns a deterministic silent WAV and a synthetic manifest', async () => {
        const first = await createOfflineInstance().generate(REQUEST);
        const second = await createOfflineInstance().generate(REQUEST);

        expect(first.id).toBe(`${OFFLINE_ID_PREFIX}1`);
        expect(first.format).toBe('wav');
        expect(detectAudioFormat(first.bytes)).toBe('wav');
        expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
        expect(first.bytes.byteLength).toBeGreaterThan(44);
        expect(first.generatedAt).toBe(OFFLINE_GENERATED_AT);
        expect(first.prompt).toBe(REQUEST.prompt);
        expect(first.model).toBe(REQUEST.model);
        expect(first.adoptedByReconciliation).toBe(false);
        expect(first.unclaimed).toEqual([]);
    });

    test('list returns the synthetic library in generate order', async () => {
        const instance = createOfflineInstance();
        await instance.generate(REQUEST);
        await instance.generate(REQUEST);
        const library = await instance.listGenerations();
        expect(library.map((take) => take.id)).toEqual([`${OFFLINE_ID_PREFIX}1`, `${OFFLINE_ID_PREFIX}2`]);
        expect(library[0]?.prompt).toBe(REQUEST.prompt);
    });

    test('analyze returns the synthetic analysis with no paid call', async () => {
        const instance = createOfflineInstance();
        const take = await instance.generate(REQUEST);
        const result = await instance.analyze(take.id);
        expect(result.paid).toBe(false);
        expect(result.cached).toBe(true);
        expect((result.analysis as { summary?: string } | null)?.summary).toBe(OFFLINE_ANALYSIS_SUMMARY);

        const missing = await instance.analyze('offline-take-99').catch((error: unknown) => error);
        expect(missing).toBeInstanceOf(Error);
    });

    test('KK_MUSIC_DRY_RUN=1 selects the offline adapter and never touches the injected fetch', async () => {
        const instance = createMusicInstance(DRY_RUN_CONFIG, { fetch: forbiddenFetch });
        expect(instance.provider).toBe('offline');

        const take = await instance.generate(REQUEST);
        expect(detectAudioFormat(take.bytes)).toBe('wav');
        expect(await instance.listGenerations()).toHaveLength(1);
        expect((await instance.analyze(take.id)).cached).toBe(true);
    });

    test('the live client is what a non-dry-run config builds', () => {
        const instance = createMusicInstance({ ...DRY_RUN_CONFIG, dryRun: false }, { fetch: forbiddenFetch });
        expect(instance.provider).toBe('lyria-instance');
    });
});
