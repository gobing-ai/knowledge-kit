export interface VoiceboxGenerateBody {
    profile_id: string;
    text: string;
    language: string;
    engine?: string;
    instruct?: string;
    max_chunk_chars: number;
    crossfade_ms: number;
    personality: false;
    normalize: true;
}

export interface VoiceboxProfile {
    id: string;
    name: string;
    description?: string;
    engine?: string;
    language?: string;
}

export interface VoiceboxHistory {
    id: string;
    status: 'pending' | 'generating' | 'completed' | 'failed' | string;
    duration?: number;
    error?: string;
}

export interface VoiceboxClient {
    readonly url: string;
    health(): Promise<void>;
    resolveProfile(nameOrId: string): Promise<VoiceboxProfile>;
    generate(body: VoiceboxGenerateBody): Promise<{ id: string }>;
    waitUntilDone(
        id: string,
        timeoutMs?: number,
        pollMs?: number,
    ): Promise<{ status: 'completed' | 'failed'; duration?: number; error?: string }>;
    downloadAudio(id: string): Promise<Uint8Array>;
}

export interface VoiceboxClientOptions {
    url?: string;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Creates a client for the Voicebox local REST API.
 */
export function createVoiceboxClient(options: VoiceboxClientOptions = {}): VoiceboxClient {
    const rawUrl = options.url || process.env.VOICEBOX_URL || 'http://127.0.0.1:17493';
    const url = rawUrl.replace(/\/+$/, '');
    const customFetch = options.fetch ?? globalThis.fetch;
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

    return {
        url,

        async health(): Promise<void> {
            try {
                const res = await customFetch(`${url}/health`);
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} ${res.statusText}`);
                }
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox health check failed at ${url}: ${reason}`);
            }
        },

        async resolveProfile(nameOrId: string): Promise<VoiceboxProfile> {
            let res: Response;
            try {
                res = await customFetch(`${url}/profiles`);
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /profiles request failed at ${url}: ${reason}`);
            }

            if (!res.ok) {
                throw new Error(`Voicebox /profiles request failed at ${url}: HTTP ${res.status} ${res.statusText}`);
            }

            let profiles: VoiceboxProfile[];
            try {
                profiles = (await res.json()) as VoiceboxProfile[];
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /profiles returned invalid JSON at ${url}: ${reason}`);
            }

            if (!Array.isArray(profiles)) {
                throw new Error(`Voicebox /profiles returned non-array at ${url}`);
            }

            const targetLower = nameOrId.toLowerCase();
            const matched = profiles.find((p) => p.id === nameOrId || (p.name && p.name.toLowerCase() === targetLower));

            if (!matched) {
                throw new Error(`Voicebox profile "${nameOrId}" not found at ${url}`);
            }

            return matched;
        },

        async generate(body: VoiceboxGenerateBody): Promise<{ id: string }> {
            let res: Response;
            try {
                res = await customFetch(`${url}/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                });
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /generate request failed at ${url}: ${reason}`);
            }

            if (!res.ok) {
                let errorDetails = '';
                try {
                    errorDetails = await res.text();
                } catch {
                    // ignore
                }
                throw new Error(
                    `Voicebox /generate failed at ${url}: HTTP ${res.status} ${res.statusText} ${errorDetails}`.trim(),
                );
            }

            let data: { id: string };
            try {
                data = (await res.json()) as { id: string };
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /generate returned invalid JSON at ${url}: ${reason}`);
            }

            if (!data || typeof data.id !== 'string') {
                throw new Error(`Voicebox /generate response missing id at ${url}`);
            }

            return { id: data.id };
        },

        async waitUntilDone(
            id: string,
            timeoutMs?: number,
            pollMs?: number,
        ): Promise<{ status: 'completed' | 'failed'; duration?: number; error?: string }> {
            const timeout =
                timeoutMs ?? (process.env.VOICEBOX_TIMEOUT_MS ? parseInt(process.env.VOICEBOX_TIMEOUT_MS, 10) : 600000);
            const poll = pollMs ?? (process.env.VOICEBOX_POLL_MS ? parseInt(process.env.VOICEBOX_POLL_MS, 10) : 1000);

            const startTime = Date.now();

            while (true) {
                let res: Response;
                try {
                    res = await customFetch(`${url}/history/${id}`);
                } catch (err: unknown) {
                    const reason = err instanceof Error ? err.message : String(err);
                    throw new Error(`Voicebox /history/${id} request failed at ${url}: ${reason}`);
                }

                if (!res.ok) {
                    throw new Error(
                        `Voicebox /history/${id} request failed at ${url}: HTTP ${res.status} ${res.statusText}`,
                    );
                }

                let history: VoiceboxHistory;
                try {
                    history = (await res.json()) as VoiceboxHistory;
                } catch (err: unknown) {
                    const reason = err instanceof Error ? err.message : String(err);
                    throw new Error(`Voicebox /history/${id} returned invalid JSON at ${url}: ${reason}`);
                }

                if (history.status === 'completed') {
                    return { status: 'completed', duration: history.duration };
                }
                if (history.status === 'failed') {
                    return {
                        status: 'failed',
                        duration: history.duration,
                        error: history.error || 'Generation status failed',
                    };
                }

                if (Date.now() - startTime >= timeout) {
                    throw new Error(`Voicebox generation timed out after ${timeout}ms for id: ${id} at ${url}`);
                }

                await sleep(poll);
            }
        },

        async downloadAudio(id: string): Promise<Uint8Array> {
            let res: Response;
            try {
                res = await customFetch(`${url}/audio/${id}`);
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /audio/${id} request failed at ${url}: ${reason}`);
            }

            if (!res.ok) {
                throw new Error(`Voicebox /audio/${id} request failed at ${url}: HTTP ${res.status} ${res.statusText}`);
            }

            try {
                const arrayBuf = await res.arrayBuffer();
                return new Uint8Array(arrayBuf);
            } catch (err: unknown) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`Voicebox /audio/${id} failed to read audio stream at ${url}: ${reason}`);
            }
        },
    };
}
