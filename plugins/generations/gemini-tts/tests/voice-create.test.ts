import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { GEMINI_TTS_DEFAULT_MODEL } from '../src/gemini-client';
import { createReplicatedVoice, main, validateVoiceWav } from '../src/voice-create';

function wav(
    opts: { seconds?: number; rate?: number; channels?: number; bits?: number; riff?: boolean } = {},
): Uint8Array {
    const rate = opts.rate ?? 24000;
    const channels = opts.channels ?? 1;
    const bits = opts.bits ?? 16;
    const seconds = opts.seconds ?? 1;
    const samples = Math.round(rate * seconds);
    const bytesPerSample = bits / 8;
    const dataLen = samples * channels * bytesPerSample;
    const buf = new Uint8Array(44 + dataLen);
    const view = new DataView(buf.buffer);
    const ascii = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    };
    ascii(0, opts.riff === false ? 'XXXX' : 'RIFF');
    view.setUint32(4, 36 + dataLen, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bits, true);
    ascii(36, 'data');
    view.setUint32(40, dataLen, true);
    return buf;
}

const sourceWav = () => wav({ seconds: 12 });
const consentWav = () => wav({ seconds: 7 });

let dir: string;
let stdout: ReturnType<typeof createBufferTarget>;
let stderr: ReturnType<typeof createBufferTarget>;
let restoreOutput: () => void;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voice-create-'));
    stdout = createBufferTarget();
    stderr = createBufferTarget();
    restoreOutput = setDefaultOutputTargets({ stdout, stderr });
});
afterEach(() => {
    restoreOutput();
    rmSync(dir, { recursive: true, force: true });
});

function writePair(source = sourceWav(), consent = consentWav()): { source: string; consent: string } {
    const sourcePath = join(dir, 'source.wav');
    const consentPath = join(dir, 'consent.wav');
    writeFileSync(sourcePath, source);
    writeFileSync(consentPath, consent);
    return { source: sourcePath, consent: consentPath };
}

describe('validateVoiceWav', () => {
    it('accepts a 10s and 30s 24 kHz mono s16 source and a short consent clip', () => {
        expect(() => validateVoiceWav(wav({ seconds: 10 }), 'source')).not.toThrow();
        expect(() => validateVoiceWav(wav({ seconds: 30 }), 'source')).not.toThrow();
        expect(() => validateVoiceWav(wav({ seconds: 7 }), 'consent')).not.toThrow();
    });

    it('names rate, channels, bits, and duration when the clip is the wrong shape', () => {
        expect(() => validateVoiceWav(wav({ rate: 16000, seconds: 12 }), 'source')).toThrow(/16000 Hz/);
        expect(() => validateVoiceWav(wav({ channels: 2, seconds: 12 }), 'source')).toThrow(/2 ch/);
        expect(() => validateVoiceWav(wav({ bits: 8, seconds: 12 }), 'source')).toThrow(/8-bit/);
        expect(() => validateVoiceWav(wav({ riff: false, seconds: 12 }), 'source')).toThrow(/not a RIFF WAV/);
        expect(() => validateVoiceWav(wav({ seconds: 9 }), 'source')).toThrow(/9\.00s/);
        expect(() => validateVoiceWav(wav({ seconds: 31 }), 'source')).toThrow(/31\.00s/);
    });
});

describe('createReplicatedVoice', () => {
    it('posts the replicated voice and returns a voice_ id', async () => {
        const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
        const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
            calls.push({
                url: String(url),
                headers: new Headers(init?.headers),
                body: JSON.parse(String(init?.body)) as Record<string, unknown>,
            });
            return Response.json({ id: 'voice_abc' });
        }) as typeof fetch;
        const created = await createReplicatedVoice({
            source: sourceWav(),
            consent: consentWav(),
            name: 'robin-news',
            store: true,
            model: 'gemini-3.8-flash-tts',
            env: { GEMINI_API_KEY: 'secret-key', GOOGLE_BASE_URL: 'http://stub/' },
            fetch: fetchStub,
        });
        expect(created.id).toBe('voice_abc');
        expect(calls[0]?.url).toBe('http://stub/v1beta/voices');
        expect(calls[0]?.headers.get('x-goog-api-key')).toBe('secret-key');
        expect(calls[0]?.body.store).toBe(true);
        const voice = calls[0]?.body.voice as {
            model: string;
            type: string;
            display_name: string;
            replicated: { source_audio: { mime_type: string; data: string }; consent_audio: { mime_type: string } };
        };
        expect(voice).toMatchObject({
            model: 'gemini-3.8-flash-tts',
            type: 'replicated',
            display_name: 'robin-news',
        });
        expect(voice.replicated.source_audio.mime_type).toBe('audio/wav');
        expect(voice.replicated.source_audio.data.length).toBeGreaterThan(10);
        expect(voice.replicated.consent_audio.mime_type).toBe('audio/wav');
    });

    it('accepts a voicekey_ id in name and fails when no voice id is present', async () => {
        const ok = (async () => Response.json({ name: 'voicekey_zz' })) as typeof fetch;
        expect(
            (
                await createReplicatedVoice({
                    source: sourceWav(),
                    consent: consentWav(),
                    name: 'robin-news',
                    store: false,
                    model: 'gemini-3.8-flash-tts',
                    env: { GEMINI_API_KEY: 'k' },
                    fetch: ok,
                })
            ).id,
        ).toBe('voicekey_zz');
        const bad = (async () => Response.json({ nope: true })) as typeof fetch;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: { GEMINI_API_KEY: 'k' },
                fetch: bad,
            }),
        ).rejects.toThrow(/keys: nope/);
    });

    it('fails an HTTP 400 without echoing the key, and does not fetch when the key is missing', async () => {
        let calls = 0;
        const fetchStub = (async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: { message: 'bad voice secret-key' } }), { status: 400 });
        }) as typeof fetch;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: { GEMINI_API_KEY: 'secret-key' },
                fetch: fetchStub,
            }),
        ).rejects.toThrow(/HTTP 400: bad voice \[redacted\]/);
        expect(calls).toBe(1);

        calls = 0;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: {},
                fetch: fetchStub,
            }),
        ).rejects.toThrow(/GEMINI_API_KEY/);
        expect(calls).toBe(0);
    });

    it('reads a nested voice id, and reports network and non-JSON failures', async () => {
        const nested = (async () => Response.json({ voice: { id: 'voice_nested' } })) as typeof fetch;
        expect(
            (
                await createReplicatedVoice({
                    source: sourceWav(),
                    consent: consentWav(),
                    name: 'robin-news',
                    store: true,
                    model: 'gemini-3.8-flash-tts',
                    env: { GEMINI_API_KEY: 'k' },
                    fetch: nested,
                })
            ).id,
        ).toBe('voice_nested');
        const down = (async () => {
            throw new Error('ECONNRESET');
        }) as unknown as typeof fetch;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: { GEMINI_API_KEY: 'k' },
                fetch: down,
            }),
        ).rejects.toThrow(/request failed: ECONNRESET/);
        const junk = (async () => new Response('not-json', { status: 200 })) as typeof fetch;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: { GEMINI_API_KEY: 'k' },
                fetch: junk,
            }),
        ).rejects.toThrow(/not JSON/);
        const textErr = (async () => new Response('plain secret', { status: 502 })) as typeof fetch;
        await expect(
            createReplicatedVoice({
                source: sourceWav(),
                consent: consentWav(),
                name: 'robin-news',
                store: true,
                model: 'gemini-3.8-flash-tts',
                env: { GEMINI_API_KEY: 'secret' },
                fetch: textErr,
            }),
        ).rejects.toThrow(/HTTP 502: plain \[redacted\]/);
    });
});

describe('main', () => {
    it('prints the voice id and defaults store and model', async () => {
        const paths = writePair();
        let body: Record<string, unknown> = {};
        const fetchStub = (async (_url: string | URL | Request, init?: RequestInit) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return Response.json({ id: 'voice_from_main' });
        }) as typeof fetch;
        expect(
            await main(['--source', paths.source, '--consent', paths.consent, '--name', 'robin-news'], {
                env: { GEMINI_API_KEY: 'k' },
                fetch: fetchStub,
            }),
        ).toBe(0);
        expect(stdout.text()).toContain('voice_from_main');
        expect(body.store).toBe(true);
        expect((body.voice as { model: string }).model).toBe(GEMINI_TTS_DEFAULT_MODEL);
        expect(stderr.text()).not.toContain('k');
    });

    it('exits 1 for a bad clip, an API error, a missing key, and missing args', async () => {
        const bad = writePair(wav({ seconds: 9 }), consentWav());
        expect(
            await main(['--source', bad.source, '--consent', bad.consent, '--name', 'robin-news'], {
                env: { GEMINI_API_KEY: 'secret-key' },
            }),
        ).toBe(1);
        expect(stderr.text()).toContain('9.00s');

        const paths = writePair();
        const fetchStub = (async () =>
            new Response(JSON.stringify({ error: { message: 'nope secret-key' } }), { status: 400 })) as typeof fetch;
        expect(
            await main(['--source', paths.source, '--consent', paths.consent, '--name', 'robin-news'], {
                env: { GEMINI_API_KEY: 'secret-key' },
                fetch: fetchStub,
            }),
        ).toBe(1);
        expect(stderr.text()).toContain('HTTP 400');
        expect(stderr.text()).not.toContain('secret-key');

        expect(
            await main(['--source', paths.source, '--consent', paths.consent, '--name', 'robin-news'], { env: {} }),
        ).toBe(1);
        expect(stderr.text()).toContain('GEMINI_API_KEY');

        expect(await main(['--source', paths.source])).toBe(1);
        expect(stderr.text()).toContain('missing required arguments');

        expect(
            await main([
                '--source',
                paths.source,
                '--consent',
                paths.consent,
                '--name',
                'robin-news',
                '--store',
                'maybe',
            ]),
        ).toBe(1);
        expect(stderr.text()).toContain('--store must be true or false');
        expect(await main(['--nope'])).toBe(1);
        expect(
            await main(['--source', join(dir, 'missing.wav'), '--consent', paths.consent, '--name', 'robin-news']),
        ).toBe(1);
        expect(stderr.text()).toContain('source not found');
    });
});
