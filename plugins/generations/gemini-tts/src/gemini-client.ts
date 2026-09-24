import { parseWav, type VoiceboxClient, type VoiceboxGenerateBody, type VoiceboxProfile } from '@gobing-ai/voice-gen';

export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const;
export const GEMINI_TTS_DEFAULT_MODEL = GEMINI_TTS_MODELS[0];
export const GEMINI_ASR_DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_PROFILES_PATH = new URL('../profiles.json', import.meta.url).pathname;
const TRANSCRIBE_PROMPT = 'Transcribe this audio verbatim. Output only the transcript, no commentary.';
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
    const maxAttempts = positiveInt(env.GEMINI_TTS_MAX_ATTEMPTS, 4);
    const timeoutMs = positiveInt(env.GEMINI_TTS_TIMEOUT_MS, 120_000);
    const buffered = new Map<string, Uint8Array>();
    let profiles: Record<string, { voice?: string }> | undefined;
    let seq = 0;

    async function post(body: unknown, label: string): Promise<InteractionResponse> {
        const apiKey = env.GEMINI_API_KEY ?? '';
        for (let attempt = 1; ; attempt++) {
            let res: Response;
            try {
                res = await doFetch(`${baseUrl}/v1beta/interactions`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeoutMs),
                });
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (attempt >= maxAttempts)
                    throw new Error(`${label}: request failed after ${attempt} attempts: ${msg}`);
                await sleep(2000 * 2 ** (attempt - 1));
                continue;
            }
            if (res.ok) return (await res.json()) as InteractionResponse;
            const raw = await res.text();
            let apiMessage = raw.slice(0, 300);
            try {
                apiMessage = (JSON.parse(raw) as InteractionResponse).error?.message ?? apiMessage;
            } catch {
                // non-JSON error body — keep the raw excerpt
            }
            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt >= maxAttempts) {
                throw new Error(`${label}: HTTP ${res.status} after ${attempt} attempt(s): ${apiMessage}`);
            }
            const retryAfter = Number(res.headers.get('retry-after'));
            await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1));
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
            if (body.instruct) part.annotations = [{ type: 'speech_metadata', style: body.instruct }];
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
