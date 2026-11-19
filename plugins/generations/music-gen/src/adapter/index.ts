import type { MusicConfig } from '../config';
import { createInstanceClient, type InstanceClientOptions, type MusicInstance } from './instance';
import { createOfflineInstance } from './offline';

/**
 * Adapter selection (task 0398 R2/R4).
 *
 * `KK_MUSIC_DRY_RUN=1` — surfaced as {@link MusicConfig.dryRun} — selects the
 * offline adapter and nothing else: the selected client holds no fetch seam, so
 * a dry run cannot open a socket even if the injected fetch would answer.
 */

export * from './instance';
export * from './offline';

/**
 * Build the adapter for one run.
 *
 * @param config  resolved music config (its `dryRun` is the `KK_MUSIC_DRY_RUN=1` switch)
 * @param options live-client overrides; ignored by the offline adapter
 */
export function createMusicInstance(
    config: Pick<MusicConfig, 'baseUrl' | 'timeoutMs' | 'connectTimeoutMs' | 'dryRun'>,
    options: InstanceClientOptions = {},
): MusicInstance {
    if (config.dryRun) {
        return createOfflineInstance();
    }
    return createInstanceClient({
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        connectTimeoutMs: config.connectTimeoutMs,
        ...options,
    });
}
