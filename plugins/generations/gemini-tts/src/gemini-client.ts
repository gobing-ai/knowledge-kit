import { parseWav, type VoiceboxClient, type VoiceboxGenerateBody, type VoiceboxProfile } from '@gobing-ai/voice-gen';

export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const;
export const GEMINI_TTS_DEFAULT_MODEL = GEMINI_TTS_MODELS[0];
export const GEMINI_ASR_DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_PROFILES_PATH = new URL('../profiles.json', import.meta.url).pathname;
const TRANSCRIBE_PROMPT = 'Transcribe this audio verbatim. Output only the transcript, no commentary.';
/** retry-after above this (Google daily-quota 429s: ~70_000s) is never actionable inside a run. */
const RETRY_AFTER_CAP_SEC = 120;
/**
 * 4xx that retrying can never fix: auth, billing (2026-11-20: a depleted project answered 402 on
 * every call) and malformed requests. Retried, they burn the whole per-segment budget for a
 * certain failure, which is how one episode spent 23 minutes failing over.
 */
const TERMINAL_STATUSES = new Set([400, 401, 402, 403, 404]);
const PLACEHOLDER_VOICE = 'voice_REPLACE_ME';

type Env = Record<string, string | undefined>;

export interface GeminiVoiceClientOptions {
    env?: Env;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}

interface InteractionContent {
    type?: string;
    data?: string;
    text?: string;
}

interface InteractionResponse {
    id?: string;
    steps?: { type?: string; content?: InteractionContent[] }[];
    error?: { message?: string };
}

/** First `model_output` content part of the given type (observed live shape, 2026-09-24). */
function findOutput(json: InteractionResponse, type: string): InteractionContent | undefined {
    for (const step of json.steps ?? []) {
        if (step.type !== 'model_output') continue;
        const hit = step.content?.find((c) => c.type === type);
        if (hit) return hit;
    }
    return undefined;
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function excerpt(text: string): string {
    return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

/**
 * Deadline every network phase so a stalled connection or response body fails loudly instead of
 * hanging forever (AbortSignal.timeout alone left the event loop parked mid-run, 2026-09-24).
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`response body timed out after ${ms}ms`)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * VoiceboxClient over the Gemini 3.8 TTS REST API, so voice-gen's `processGeneratorIO` pipeline
 * (verify-retry, speed, concat, QC, MP3) runs unchanged against a hosted backend (ADR-023).
 * Synthesis is unary: `generate` buffers the WAV and `waitUntilDone` completes immediately.
 */
export function createGeminiVoiceClient(options: GeminiVoiceClientOptions = {}): VoiceboxClient {
    const env = options.env ?? process.env;
    const doFetch = options.fetch ?? fetch;
    const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
    const baseUrl = (env.GOOGLE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = env.GEMINI_TTS_MODEL || GEMINI_TTS_DEFAULT_MODEL;
    // Fixed persona style sent for every segment. Gemini re-interprets its short-clip custom voice
    // per style annotation, so per-segment emotions make the persona drift across boundaries
    // (2026-09-24 episode review). When set, this replaces each segment's own instruct.
    const styleOverride = env.GEMINI_TTS_STYLE;
    const maxAttempts = positiveInt(env.GEMINI_TTS_MAX_ATTEMPTS, 4);
    const timeoutMs = positiveInt(env.GEMINI_TTS_TIMEOUT_MS, 120_000);
    // Wall-clock ceiling for ONE segment across every attempt and backoff, so a stalled endpoint
    // cannot multiply the per-request timeout by the attempt count (R1).
    const segmentTimeoutMs = positiveInt(env.GEMINI_TTS_SEGMENT_TIMEOUT_MS, 180_000);
    const buffered = new Map<string, Uint8Array>();
    let profiles: Record<string, { voice?: string }> | undefined;
    let seq = 0;

    async function post(body: unknown, label: string): Promise<InteractionResponse> {
        const apiKey = env.GEMINI_API_KEY ?? '';
        const deadline = Date.now() + segmentTimeoutMs;
        for (let attempt = 1; ; attempt++) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new Error(
                    `${label}: segment budget ${segmentTimeoutMs}ms exhausted after ${attempt - 1} attempt(s)`,
                );
            }
            const attemptMs = Math.min(timeoutMs, remaining);
            let res: Response;
            try {
                res = await withDeadline(
                    doFetch(`${baseUrl}/v1beta/interactions`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(attemptMs),
                    }),
                    attemptMs,
                );
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (attempt >= maxAttempts || Date.now() >= deadline)
                    throw new Error(
                        `${label}: request failed after ${attempt} attempt(s) within ${segmentTimeoutMs}ms: ${msg}`,
                    );
                await sleep(Math.min(2000 * 2 ** (attempt - 1), Math.max(0, deadline - Date.now())));
                continue;
            }
            if (res.ok)
                return withDeadline(
                    res.json(),
                    Math.min(timeoutMs, Math.max(1, deadline - Date.now())),
                ) as Promise<InteractionResponse>;
            const raw = await withDeadline(res.text(), timeoutMs);
            let apiMessage = raw.slice(0, 300);
            try {
                apiMessage = (JSON.parse(raw) as InteractionResponse).error?.message ?? apiMessage;
            } catch {
                // non-JSON error body — keep the raw excerpt
            }
            const retryAfter = Number(res.headers.get('retry-after'));
            // 2026-09-24: three generate runs silently slept ~19h on a daily-quota 429's
            // retry-after 69857 — indistinguishable from a wedge. Cap transient backoff;
            // anything beyond the cap (per-day quota, org throttle) fails the run loudly.
            if (retryAfter > RETRY_AFTER_CAP_SEC) {
                throw new Error(
                    `${label}: HTTP ${res.status} quota/reset horizon too far out (retry-after ${retryAfter}s ≈ ${(retryAfter / 3600).toFixed(1)}h): ${apiMessage}`,
                );
            }
            if (TERMINAL_STATUSES.has(res.status)) {
                throw new Error(
                    `${label}: HTTP ${res.status} is not retryable (auth/billing/request class) — failing fast instead of burning the segment budget: ${apiMessage}`,
                );
            }
            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt >= maxAttempts) {
                throw new Error(`${label}: HTTP ${res.status} after ${attempt} attempt(s): ${apiMessage}`);
            }
            await sleep(retryAfter > 0 ? Math.min(retryAfter, RETRY_AFTER_CAP_SEC) * 1000 : 2000 * 2 ** (attempt - 1));
        }
    }

    async function loadProfiles(): Promise<Record<string, { voice?: string }>> {
        if (profiles) return profiles;
        const path = env.GEMINI_TTS_PROFILES || DEFAULT_PROFILES_PATH;
        const file = Bun.file(path);
        if (!(await file.exists())) throw new Error(`gemini-tts: profile map not found: ${path}`);
        profiles = (await file.json()) as Record<string, { voice?: string }>;
        return profiles;
    }

    const client: VoiceboxClient = {
        url: baseUrl,

        async health(): Promise<void> {
            if (!env.GEMINI_API_KEY) throw new Error('gemini-tts: GEMINI_API_KEY is required');
            if (!(GEMINI_TTS_MODELS as readonly string[]).includes(model)) {
                throw new Error(
                    `gemini-tts: unsupported GEMINI_TTS_MODEL "${model}" (allowed: ${GEMINI_TTS_MODELS.join(', ')})`,
                );
            }
        },

        async resolveProfile(nameOrId: string): Promise<VoiceboxProfile> {
            if (/^voice(key)?_/.test(nameOrId) && nameOrId !== PLACEHOLDER_VOICE) {
                return { id: nameOrId, name: nameOrId };
            }
            const voice = (await loadProfiles())[nameOrId]?.voice;
            if (!voice) throw new Error(`gemini-tts: unknown voice profile "${nameOrId}"`);
            if (voice === PLACEHOLDER_VOICE) {
                throw new Error(
                    `gemini-tts: profile "${nameOrId}" still holds the placeholder voice id — create the replicated voice (see plugins/generations/gemini-tts/README.md) and set it in GEMINI_TTS_PROFILES`,
                );
            }
            return { id: voice, name: nameOrId };
        },

        async generate(body: VoiceboxGenerateBody): Promise<{ id: string }> {
            const part: Record<string, unknown> = { type: 'text', text: body.text };
            const style = styleOverride ?? body.instruct;
            if (style) part.annotations = [{ type: 'speech_metadata', style }];
            const json = await post(
                {
                    model,
                    input: [{ type: 'user_input', content: [part] }],
                    response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
                    generation_config: { speech_config: [{ voice: body.profile_id }] },
                },
                `gemini-tts generate ("${excerpt(body.text)}")`,
            );
            const audio = findOutput(json, 'audio');
            if (!audio?.data) throw new Error(`gemini-tts generate ("${excerpt(body.text)}"): response had no audio`);
            seq += 1;
            const id = `${json.id ?? 'gemini'}#${seq}`;
            buffered.set(id, new Uint8Array(Buffer.from(audio.data, 'base64')));
            return { id };
        },

        async waitUntilDone(id: string) {
            const bytes = buffered.get(id);
            if (!bytes) return { status: 'failed' as const, error: `unknown generation id ${id}` };
            const wav = parseWav(bytes);
            return { status: 'completed' as const, duration: wav.dataBytes.length / wav.byteRate };
        },

        async downloadAudio(id: string): Promise<Uint8Array> {
            const bytes = buffered.get(id);
            if (!bytes) throw new Error(`gemini-tts: unknown generation id ${id}`);
            buffered.delete(id);
            return bytes;
        },
    };

    if (env.GEMINI_TTS_ASR !== 'off') {
        const asrModel = env.GEMINI_TTS_ASR_MODEL || GEMINI_ASR_DEFAULT_MODEL;
        client.transcribe = async (audio: Uint8Array) => {
            const json = await post(
                {
                    model: asrModel,
                    input: [
                        { type: 'text', text: TRANSCRIBE_PROMPT },
                        { type: 'audio', data: Buffer.from(audio).toString('base64'), mime_type: 'audio/wav' },
                    ],
                },
                'gemini-tts transcribe',
            );
            return { text: findOutput(json, 'text')?.text?.trim() ?? '' };
        };
    }

    return client;
}
