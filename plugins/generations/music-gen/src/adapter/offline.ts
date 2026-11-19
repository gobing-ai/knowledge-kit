import { silentWav } from '../audio';
import type { MusicGenerateRequest } from '../request';
import type {
    AnalysisOutcome,
    GeneratedTake,
    InstanceTake,
    MusicAnalysis,
    MusicInstance,
    UnclaimedTake,
} from './instance';

/**
 * Offline adapter (task 0398 R4): `KK_MUSIC_DRY_RUN=1`.
 *
 * Deterministic silent WAV, synthetic manifest, synthetic analysis — and **zero
 * network calls by construction**: this class holds no fetch seam and no socket.
 * It is the default for the plugin's whole test suite, so a paid call can never
 * be made from a test.
 *
 * Everything it emits is a *synthetic* artefact and says so: the generation id
 * is `offline-take-<n>`, the analysis summary starts with `offline:`, and
 * `Content.metadata.dryRun` is `true`, so an operator can never mistake a
 * dry-run take for a delivered one.
 */

/** Generation-id prefix of a synthetic take. */
export const OFFLINE_ID_PREFIX = 'offline-take-';

/** Synthetic audio URL scheme: a dry run has no reachable instance, and the URL says so. */
export const OFFLINE_AUDIO_SCHEME = 'offline';

/** The synthetic audio URL of one take (the `Content.references` provenance slot, marked synthetic). */
export function offlineAudioUrl(instanceId: string): string {
    return `${OFFLINE_AUDIO_SCHEME}://generations/${encodeURIComponent(instanceId)}/audio`;
}

/**
 * Fixed `generatedAt` for every synthetic take. A constant, not a clock read:
 * two dry runs must produce identical sidecars byte for byte.
 */
export const OFFLINE_GENERATED_AT = '1970-01-01T00:00:00.000Z';

/** Synthetic analysis summary prefix — proves in one glance the analysis was not paid for. */
export const OFFLINE_ANALYSIS_SUMMARY = 'offline: synthetic analysis, no instance was called';

/** Build the synthetic analysis for one take. */
export function offlineAnalysis(model: string): MusicAnalysis {
    return {
        summary: OFFLINE_ANALYSIS_SUMMARY,
        model,
        provider: 'offline',
        durationSeconds: 1,
    };
}

/** The offline instance: an in-memory library, no HTTP. */
export class OfflineInstance implements MusicInstance {
    readonly provider = 'offline';

    /** Synthetic library, in generate order. */
    private readonly library: InstanceTake[] = [];

    /** Library URL for one synthetic generation (there is no real route — the id rides the host). */
    libraryUrl(instanceId: string): string {
        return `${OFFLINE_AUDIO_SCHEME}://generations/${encodeURIComponent(instanceId)}`;
    }

    /** One deterministic take: the same request always yields the same bytes. */
    async generate(request: MusicGenerateRequest): Promise<GeneratedTake> {
        const id = `${OFFLINE_ID_PREFIX}${String(this.library.length + 1)}`;
        const bytes = silentWav();
        const analysis = offlineAnalysis(request.model);
        const take: InstanceTake = {
            id,
            prompt: request.prompt,
            model: request.model,
            generatedAt: OFFLINE_GENERATED_AT,
            audioUrl: offlineAudioUrl(id),
            ...(request.durationTarget === undefined ? {} : { durationTarget: request.durationTarget }),
            language: request.language,
            batchCount: request.batchCount,
            title: request.title,
            format: request.format,
            analysis,
        };
        this.library.push(take);
        const unclaimed: UnclaimedTake[] = [];
        return {
            ...take,
            prompt: request.prompt,
            model: request.model,
            bytes,
            format: 'wav',
            contentType: 'audio/wav',
            adoptedByReconciliation: false,
            unclaimed,
            elapsedMs: 0,
        };
    }

    /** The synthetic library, in generate order. */
    async listGenerations(): Promise<InstanceTake[]> {
        return this.library.map((take) => ({ ...take }));
    }

    /** Synthetic analysis; `cached` is true because the synthetic manifest already carries it. */
    async analyze(instanceId: string): Promise<AnalysisOutcome> {
        const take = this.library.find((entry) => entry.id === instanceId);
        if (take === undefined) {
            throw new Error(`offline adapter: unknown generation ${instanceId} (no instance was called)`);
        }
        return {
            instanceId,
            analysis: take.analysis ?? offlineAnalysis(String(take.model ?? '')),
            cached: true,
            paid: false,
        };
    }
}

/** Build the offline adapter. */
export function createOfflineInstance(): OfflineInstance {
    return new OfflineInstance();
}
