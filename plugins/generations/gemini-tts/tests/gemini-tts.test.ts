import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { VoiceboxGenerateBody } from '@gobing-ai/voice-gen';
import { createGeminiVoiceClient, GEMINI_TTS_DEFAULT_MODEL, main } from '../src/index';

/** 24 kHz mono s16le WAV with a constant non-zero level (no loudness dip). */
function testWav(seconds = 1): Uint8Array {
    const samples = 24000 * seconds;
    const buf = new Uint8Array(44 + samples * 2);
    const view = new DataView(buf.buffer);
    const ascii = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, i % 2 ? 3000 : -3000, true);
    return buf;
}

const WAV_B64 = Buffer.from(testWav()).toString('base64');
const audioResponse = () =>
    Response.json({ id: 'v1_x', steps: [{ type: 'model_output', content: [{ type: 'audio', data: WAV_B64 }] }] });
const textResponse = (text: string) =>
    Response.json({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text }] }] });

interface Call {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
}

function stubFetch(responder: (call: Call, n: number) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const fn = (async (url: string | URL | Request, init?: RequestInit) => {
        const call = {
            url: String(url),
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        calls.push(call);
        return responder(call, calls.length);
    }) as typeof fetch;
    return { fn, calls };
}

const noSleep = async () => {};
const body = (over: Partial<VoiceboxGenerateBody> = {}): VoiceboxGenerateBody => ({
    profile_id: 'voice_abc',
    text: '你好世界',
    language: 'zh',
    max_chunk_chars: 800,
    crossfade_ms: 50,
    ...over,
});

let dir: string;
let stderr: ReturnType<typeof createBufferTarget>;
let restoreOutput: () => void;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gemini-tts-'));
    stderr = createBufferTarget();
    restoreOutput = setDefaultOutputTargets({ stdout: createBufferTarget(), stderr });
});
afterEach(() => {
    restoreOutput();
    rmSync(dir, { recursive: true, force: true });
});

describe('createGeminiVoiceClient', () => {
    it('R2 — defaults to gemini-3.8-flash-tts and honors GEMINI_TTS_MODEL=flash-lite', async () => {
        for (const [model, expected] of [
            [undefined, GEMINI_TTS_DEFAULT_MODEL],
            ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-lite-tts'],
        ] as const) {
            const { fn, calls } = stubFetch(() => audioResponse());
            const client = createGeminiVoiceClient({
                env: { GEMINI_API_KEY: 'k', GEMINI_TTS_MODEL: model },
                fetch: fn,
            });
            await client.health();
            await client.generate(body());
            expect(calls[0]?.body.model).toBe(expected);
        }
    });

    it('R2 — an unsupported model fails health naming the allowed models', async () => {
        const client = createGeminiVoiceClient({ env: { GEMINI_API_KEY: 'k', GEMINI_TTS_MODEL: 'gemini-2' } });
        await expect(client.health()).rejects.toThrow(/gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts/);
    });

    it('R6 — a missing GEMINI_API_KEY fails health before any network call', async () => {
        const { fn, calls } = stubFetch(() => audioResponse());
        const client = createGeminiVoiceClient({ env: {}, fetch: fn });
        await expect(client.health()).rejects.toThrow(/GEMINI_API_KEY/);
        expect(calls).toHaveLength(0);
    });

    it('R3/R4 — request carries the voice, speech_metadata style, WAV format, and API key header', async () => {
        const { fn, calls } = stubFetch(() => audioResponse());
        const client = createGeminiVoiceClient({
            env: { GEMINI_API_KEY: 'secret', GOOGLE_BASE_URL: 'http://stub/' },
            fetch: fn,
        });
        const { id } = await client.generate(body({ instruct: 'calm news anchor, warm' }));
        const call = calls[0] as Call;
        expect(call.url).toBe('http://stub/v1beta/interactions');
        expect(call.headers.get('x-goog-api-key')).toBe('secret');
        expect(call.body.generation_config).toEqual({ speech_config: [{ voice: 'voice_abc' }] });
        expect(call.body.response_format).toEqual({ type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 });
        expect(call.body.input).toEqual([
            {
                type: 'user_input',
                content: [
                    {
                        type: 'text',
                        text: '你好世界',
                        annotations: [{ type: 'speech_metadata', style: 'calm news anchor, warm' }],
                    },
                ],
            },
        ]);
        expect(await client.waitUntilDone(id)).toEqual({ status: 'completed', duration: 1 });
        expect((await client.downloadAudio(id)).length).toBe(testWav().length);
        await expect(client.downloadAudio(id)).rejects.toThrow(/unknown generation id/);
        expect((await client.waitUntilDone(id)).status).toBe('failed');
    });

    it('GEMINI_TTS_STYLE overrides every segment instruct with one stable persona style', async () => {
        const { calls, fn } = stubFetch(() => audioResponse());
        const client = createGeminiVoiceClient({
            env: { GEMINI_API_KEY: 'secret', GEMINI_TTS_STYLE: 'calm professional podcast host, steady pace' },
            fetch: fn,
        });
        await client.generate(body({ instruct: 'thoughtful, personal' }));
        await client.generate(body({}));
        for (const call of calls as Call[]) {
            const content = (call.body.input as { content: { annotations?: { style: string } }[] }[])[0].content[0];
            expect(content.annotations).toEqual([
                { type: 'speech_metadata', style: 'calm professional podcast host, steady pace' },
            ]);
        }
    });

    it('R3 — resolves profiles through the map, passes raw ids through, and rejects unknown or placeholder', async () => {
        const map = join(dir, 'profiles.json');
        writeFileSync(
            map,
            JSON.stringify({
                'robin-news': { voice: 'voice_abc' },
                anchor: { voice: 'Kore' },
                todo: { voice: 'voice_REPLACE_ME' },
            }),
        );
        const client = createGeminiVoiceClient({ env: { GEMINI_TTS_PROFILES: map } });
        expect(await client.resolveProfile('robin-news')).toEqual({ id: 'voice_abc', name: 'robin-news' });
        expect((await client.resolveProfile('anchor')).id).toBe('Kore');
        expect((await client.resolveProfile('voicekey_zz')).id).toBe('voicekey_zz');
        await expect(client.resolveProfile('nobody')).rejects.toThrow(/unknown voice profile "nobody"/);
        await expect(client.resolveProfile('todo')).rejects.toThrow(/placeholder voice id/);
    });

    it('R3 — shipped profile map carries a robin-news entry; a missing map path fails clearly', async () => {
        const shipped = createGeminiVoiceClient({ env: {} });
        await expect(shipped.resolveProfile('robin-news')).rejects.toThrow(/placeholder voice id/);
        const missing = createGeminiVoiceClient({ env: { GEMINI_TTS_PROFILES: join(dir, 'nope.json') } });
        await expect(missing.resolveProfile('robin-news')).rejects.toThrow(/profile map not found/);
    });

    it('R6 — retries 429/5xx with backoff honoring Retry-After, then succeeds', async () => {
        const waits: number[] = [];
        const { fn, calls } = stubFetch((_c, n) =>
            n === 1
                ? new Response('{}', { status: 429, headers: { 'retry-after': '3' } })
                : n === 2
                  ? new Response('boom', { status: 503 })
                  : audioResponse(),
        );
        const client = createGeminiVoiceClient({
            env: { GEMINI_API_KEY: 'k' },
            fetch: fn,
            sleep: async (ms) => {
                waits.push(ms);
            },
        });
        await client.generate(body());
        expect(calls).toHaveLength(3);
        expect(waits).toEqual([3000, 4000]);
    });

    it('R6 — gives up after the attempt cap naming status, API message, and text excerpt', async () => {
        const { fn, calls } = stubFetch(
            () => new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), { status: 429 }),
        );
        const client = createGeminiVoiceClient({
            env: { GEMINI_API_KEY: 'k', GEMINI_TTS_MAX_ATTEMPTS: '2' },
            fetch: fn,
            sleep: noSleep,
        });
        await expect(client.generate(body())).rejects.toThrow(
            /generate \("你好世界"\): HTTP 429 after 2 attempt\(s\): quota exhausted/,
        );
        expect(calls).toHaveLength(2);
    });

    it('R6 — non-retryable 4xx fails at once; network errors retry then fail', async () => {
        const bad = stubFetch(() => new Response('not json', { status: 400 }));
        const c1 = createGeminiVoiceClient({ env: { GEMINI_API_KEY: 'k' }, fetch: bad.fn, sleep: noSleep });
        await expect(c1.generate(body())).rejects.toThrow(/HTTP 400 after 1 attempt\(s\): not json/);
        expect(bad.calls).toHaveLength(1);

        let n = 0;
        const down = (async () => {
            n++;
            throw new Error('ECONNRESET');
        }) as unknown as typeof fetch;
        const c2 = createGeminiVoiceClient({
            env: { GEMINI_API_KEY: 'k', GEMINI_TTS_MAX_ATTEMPTS: '3' },
            fetch: down,
            sleep: noSleep,
        });
        await expect(c2.generate(body({ text: 'x'.repeat(40) }))).rejects.toThrow(
            /request failed after 3 attempts: ECONNRESET/,
        );
        expect(n).toBe(3);
    });

    it('R1 — a response without audio is an error', async () => {
        const { fn } = stubFetch(() => textResponse('nope'));
        const client = createGeminiVoiceClient({ env: { GEMINI_API_KEY: 'k' }, fetch: fn });
        await expect(client.generate(body())).rejects.toThrow(/response had no audio/);
    });

    it('R7 — transcribe sends inline WAV to the ASR model; GEMINI_TTS_ASR=off omits it', async () => {
        const { fn, calls } = stubFetch(() => textResponse(' 你好世界 \n'));
        const client = createGeminiVoiceClient({ env: { GEMINI_API_KEY: 'k' }, fetch: fn });
        expect(await client.transcribe?.(testWav())).toEqual({ text: '你好世界' });
        const input = calls[0]?.body.input as { type: string; mime_type?: string }[];
        expect(calls[0]?.body.model).toBe('gemini-3.8-flash');
        expect(input.map((p) => p.type)).toEqual(['text', 'audio']);
        expect(input[1]?.mime_type).toBe('audio/wav');

        expect(createGeminiVoiceClient({ env: { GEMINI_TTS_ASR: 'off' } }).transcribe).toBeUndefined();
    });
});

describe('main (kk executor surface)', () => {
    let server: ReturnType<typeof Bun.serve>;
    let saved: NodeJS.ProcessEnv;
    let requests: Record<string, unknown>[];
    let asrText: string;

    beforeEach(() => {
        requests = [];
        asrText = '你好世界';
        server = Bun.serve({
            port: 0,
            async fetch(req) {
                const json = (await req.json()) as Record<string, unknown>;
                requests.push(json);
                return String(json.model).endsWith('-tts') ? audioResponse() : textResponse(asrText);
            },
        });
        saved = { ...process.env };
        const map = join(dir, 'profiles.json');
        writeFileSync(map, JSON.stringify({ 'robin-news': { voice: 'voice_abc' } }));
        Object.assign(process.env, {
            GEMINI_API_KEY: 'k',
            GOOGLE_BASE_URL: server.url.origin,
            GEMINI_TTS_PROFILES: map,
        });
    });
    afterEach(() => {
        server.stop(true);
        process.env = saved;
    });

    const writeDocs = (docs: Doc[]) => {
        const inPath = join(dir, 'docs.json');
        writeFileSync(inPath, JSON.stringify(docs));
        return inPath;
    };
    const scriptDoc = (): Doc => ({
        id: 'd1',
        sourceUri: 'https://example.com',
        title: 'Daily',
        body: 'title: "Daily"\ndefault_profile: robin-news\nsegments:\n  - text: "你好世界"\n    instruct: "calm news anchor"\n',
    });

    it('R1/R7 — renders a VoiceScript into audio Content with QC and a sibling WAV', async () => {
        const out = join(dir, 'content.json');
        expect(await main(['--in', writeDocs([scriptDoc()]), '--out', out])).toBe(0);
        const content = ContentSchema.parse(JSON.parse(readFileSync(out, 'utf-8')));
        expect(content.format).toBe('audio');
        expect(content.metadata?.generator).toBe('kk:gemini-tts');
        expect(content.metadata?.audioPath).toBe(join(dir, 'content.wav'));
        expect(content.metadata?.duration).toBe(1);
        expect(existsSync(join(dir, 'content.wav'))).toBe(true);
        const qc = content.metadata?.qc as { passed: boolean };
        expect(qc.passed).toBe(true);
        expect(requests.map((r) => r.model)).toContain('gemini-3.8-flash');
    });

    it('R7 — VOICE_GEN_FAIL_ON_QC with a failing audit exits 1 and writes no output', async () => {
        asrText = '完全不同的内容重复重复重复重复重复';
        process.env.VOICE_GEN_FAIL_ON_QC = 'true';
        const out = join(dir, 'content.json');
        expect(await main(['--in', writeDocs([scriptDoc()]), '--out', out])).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(stderr.text()).toContain('gemini-tts failed: Voice Quality Control failed');
    });

    it('R10 — empty input writes the notice Content without any request', async () => {
        const out = join(dir, 'content.json');
        expect(await main(['--in', writeDocs([]), '--out', out])).toBe(0);
        expect(JSON.parse(readFileSync(out, 'utf-8')).title).toBe('Notice');
        expect(requests).toHaveLength(0);
    });

    it('R1 — missing --in/--out exits 1', async () => {
        expect(await main([])).toBe(1);
        expect(stderr.text()).toContain('Missing required arguments');
    });
});
