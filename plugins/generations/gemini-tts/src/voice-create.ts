import { parseArgs } from 'node:util';
import { echo, echoError } from '@gobing-ai/ts-utils';
import { parseWav } from '@gobing-ai/voice-gen';
import { GEMINI_TTS_DEFAULT_MODEL } from './gemini-client';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const VOICE_ID = /^(?:voice_|voicekey_)/;

export interface CreateReplicatedVoiceOptions {
    source: Uint8Array;
    consent: Uint8Array;
    name: string;
    store: boolean;
    model: string;
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
}

/**
 * Reject a clip that is not 24 kHz mono 16-bit PCM WAV. Source clips must also be 10–30 s.
 * The error names the measured rate, channels, bits, and duration.
 */
export function validateVoiceWav(bytes: Uint8Array, role: 'source' | 'consent'): void {
    let wav: ReturnType<typeof parseWav>;
    try {
        wav = parseWav(bytes);
    } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
            `gemini-tts voice-create: ${role} is not a RIFF WAV (${detail}); need 24000 Hz, 1 ch, 16-bit PCM`,
        );
    }
    const duration = wav.byteRate > 0 ? wav.dataBytes.length / wav.byteRate : 0;
    const problems: string[] = [];
    if (wav.audioFormat !== 1) problems.push(`audioFormat ${wav.audioFormat} (need PCM 1)`);
    if (wav.sampleRate !== 24000) problems.push(`${wav.sampleRate} Hz (need 24000)`);
    if (wav.numChannels !== 1) problems.push(`${wav.numChannels} ch (need 1)`);
    if (wav.bitsPerSample !== 16) problems.push(`${wav.bitsPerSample}-bit (need 16)`);
    if (role === 'source' && (duration < 10 || duration > 30)) {
        problems.push(`duration ${duration.toFixed(2)}s (need 10–30s)`);
    }
    if (problems.length > 0) {
        throw new Error(
            `gemini-tts voice-create: ${role} is ${wav.sampleRate} Hz, ${wav.numChannels} ch, ${wav.bitsPerSample}-bit, ${duration.toFixed(2)}s — ${problems.join('; ')}`,
        );
    }
}

function pickVoiceId(json: Record<string, unknown>): string | undefined {
    const candidates: unknown[] = [json.name, json.id, json.key];
    const nested = json.voice;
    if (nested && typeof nested === 'object') {
        const voice = nested as Record<string, unknown>;
        candidates.push(voice.name, voice.id, voice.key);
    }
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && VOICE_ID.test(candidate)) return candidate;
    }
    return undefined;
}

function redact(text: string, secret: string): string {
    return secret ? text.split(secret).join('[redacted]') : text;
}

/** POST /v1beta/voices and return the stored or stateless voice id. Never includes the API key in errors. */
export async function createReplicatedVoice(opts: CreateReplicatedVoiceOptions): Promise<{ id: string }> {
    const env = opts.env ?? process.env;
    const apiKey = env.GEMINI_API_KEY ?? '';
    if (!apiKey) throw new Error('gemini-tts voice-create: GEMINI_API_KEY is required');
    const baseUrl = (env.GOOGLE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const doFetch = opts.fetch ?? fetch;
    let res: Response;
    try {
        res = await doFetch(`${baseUrl}/v1beta/voices`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                store: opts.store,
                voice: {
                    model: opts.model,
                    type: 'replicated',
                    display_name: opts.name,
                    replicated: {
                        source_audio: { mime_type: 'audio/wav', data: Buffer.from(opts.source).toString('base64') },
                        consent_audio: { mime_type: 'audio/wav', data: Buffer.from(opts.consent).toString('base64') },
                    },
                },
            }),
            signal: AbortSignal.timeout(120_000),
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`gemini-tts voice-create: request failed: ${redact(msg, apiKey)}`);
    }
    const raw = await res.text();
    if (!res.ok) {
        let apiMessage = raw.slice(0, 300);
        try {
            const parsed = JSON.parse(raw) as { error?: { message?: string } };
            apiMessage = parsed.error?.message ?? apiMessage;
        } catch {
            // non-JSON error body — keep the raw excerpt
        }
        throw new Error(`gemini-tts voice-create: HTTP ${res.status}: ${redact(apiMessage, apiKey)}`);
    }
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        throw new Error('gemini-tts voice-create: response was not JSON');
    }
    const id = pickVoiceId(json);
    if (!id) {
        throw new Error(`gemini-tts voice-create: response had no voice id (keys: ${Object.keys(json).join(', ')})`);
    }
    return { id };
}

async function readWav(path: string, role: 'source' | 'consent'): Promise<Uint8Array> {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`gemini-tts voice-create: ${role} not found: ${path}`);
    return new Uint8Array(await file.arrayBuffer());
}

export async function main(
    argv: string[] = process.argv.slice(2),
    deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<number> {
    let values: { source?: string; consent?: string; name?: string; store?: string; model?: string };
    try {
        ({ values } = parseArgs({
            args: argv,
            options: {
                source: { type: 'string' },
                consent: { type: 'string' },
                name: { type: 'string' },
                store: { type: 'string' },
                model: { type: 'string' },
            },
        }));
    } catch (err: unknown) {
        echoError(`gemini-tts voice-create: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
    if (!values.source || !values.consent || !values.name) {
        echoError('gemini-tts voice-create: missing required arguments: --source, --consent, and --name');
        return 1;
    }
    const storeRaw = values.store ?? 'true';
    if (storeRaw !== 'true' && storeRaw !== 'false') {
        echoError(`gemini-tts voice-create: --store must be true or false (got "${storeRaw}")`);
        return 1;
    }
    try {
        const source = await readWav(values.source, 'source');
        const consent = await readWav(values.consent, 'consent');
        validateVoiceWav(source, 'source');
        validateVoiceWav(consent, 'consent');
        const env = deps.env ?? process.env;
        const { id } = await createReplicatedVoice({
            source,
            consent,
            name: values.name,
            store: storeRaw === 'true',
            model: values.model || env.GEMINI_TTS_MODEL || GEMINI_TTS_DEFAULT_MODEL,
            env,
            fetch: deps.fetch,
        });
        echo(id);
        return 0;
    } catch (err: unknown) {
        echoError(err instanceof Error ? err.message : String(err));
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
