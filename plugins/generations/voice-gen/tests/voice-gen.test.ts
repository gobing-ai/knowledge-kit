import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc, discoverPlugins } from '@gobing-ai/kk-core';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    concatWavs,
    createVoiceboxClient,
    main,
    mergeVoiceScripts,
    parseDocToVoiceScript,
    parseWav,
    processGeneratorIO,
    type VoiceboxClient,
    type VoiceboxGenerateBody,
    type VoiceboxProfile,
    validateVoiceScript,
} from '../src/index';

function createTestWav(numSamples = 100, sampleRate = 24000, numChannels = 1, bitsPerSample = 16): Uint8Array {
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const totalSize = 44 + dataSize;
    const buf = new Uint8Array(totalSize);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    buf[0] = 'R'.charCodeAt(0);
    buf[1] = 'I'.charCodeAt(0);
    buf[2] = 'F'.charCodeAt(0);
    buf[3] = 'F'.charCodeAt(0);
    view.setUint32(4, 36 + dataSize, true);
    buf[8] = 'W'.charCodeAt(0);
    buf[9] = 'A'.charCodeAt(0);
    buf[10] = 'V'.charCodeAt(0);
    buf[11] = 'E'.charCodeAt(0);

    buf[12] = 'f'.charCodeAt(0);
    buf[13] = 'm'.charCodeAt(0);
    buf[14] = 't'.charCodeAt(0);
    buf[15] = ' '.charCodeAt(0);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    buf[36] = 'd'.charCodeAt(0);
    buf[37] = 'a'.charCodeAt(0);
    buf[38] = 't'.charCodeAt(0);
    buf[39] = 'a'.charCodeAt(0);
    view.setUint32(40, dataSize, true);

    return buf;
}

describe('voice-gen generator plugin (0070)', () => {
    let testDir: string;
    let inputPath: string;
    let outputPath: string;
    let audioPath: string;

    beforeEach(() => {
        testDir = join(tmpdir(), `kk-voice-gen-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        mkdirSync(testDir, { recursive: true });
        inputPath = join(testDir, 'input.json');
        outputPath = join(testDir, 'output.json');
        audioPath = join(testDir, 'output.wav');
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    function createMockClient(overrides: Partial<VoiceboxClient> = {}): VoiceboxClient {
        const defaultProfiles: VoiceboxProfile[] = [
            { id: 'prof-1', name: 'Robin' },
            { id: 'prof-2', name: 'Narrator' },
            { id: 'prof-3', name: 'Host' },
        ];

        const generatedBodies: VoiceboxGenerateBody[] = [];
        let genCounter = 0;

        return {
            url: 'http://127.0.0.1:17493',
            health: async () => {},
            resolveProfile: async (nameOrId: string) => {
                const targetLower = nameOrId.toLowerCase();
                const matched = defaultProfiles.find((p) => p.id === nameOrId || p.name.toLowerCase() === targetLower);
                if (!matched) {
                    throw new Error(`Voicebox profile "${nameOrId}" not found at http://127.0.0.1:17493`);
                }
                return matched;
            },
            generate: async (body: VoiceboxGenerateBody) => {
                generatedBodies.push(body);
                genCounter++;
                return { id: `gen-${genCounter}` };
            },
            waitUntilDone: async (_id: string) => {
                return { status: 'completed', duration: 2.5 };
            },
            downloadAudio: async (_id: string) => {
                return createTestWav(2400, 24000);
            },
            ...overrides,
        };
    }

    it('R1 — Plugin is discoverable and invocable via registry and executor', async () => {
        const { plugins } = await discoverPlugins(join(import.meta.dir, '../../..'));
        const voiceGen = plugins.find((p) => p.name === 'voice-gen');
        expect(voiceGen).toBeDefined();
        expect(voiceGen?.kind).toBe('generator');

        const docs: Doc[] = [];
        writeFileSync(inputPath, JSON.stringify(docs));

        const exitCode = await runInvoke({
            plugin: 'voice-gen',
            inPath: inputPath,
            outPath: outputPath,
            pluginsRoot: join(import.meta.dir, '../../..'),
        });

        expect(exitCode).toBe(0);
        expect(existsSync(outputPath)).toBe(true);
        const parsed = JSON.parse(readFileSync(outputPath, 'utf-8'));
        expect(parsed.title).toBe('Notice');
        expect(parsed.format).toBe('markdown');
    });

    it('R2 — Plain-text Doc generates speech via REST /generate and writes audio Content', async () => {
        const doc: Doc = {
            id: 'doc-1',
            sourceUri: 'https://example.com/test',
            title: 'Test Article',
            body: 'This is plain text content to be spoken.',
            metadata: {
                voiceProfile: 'Robin',
            },
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        const calls: VoiceboxGenerateBody[] = [];
        const client = createMockClient({
            generate: async (body) => {
                calls.push(body);
                return { id: 'gen-plain-1' };
            },
        });

        await processGeneratorIO(inputPath, outputPath, client);

        expect(calls.length).toBe(1);
        expect(calls[0].profile_id).toBe('prof-1');
        expect(calls[0].text).toBe('This is plain text content to be spoken.');
        expect(calls[0].personality).toBe(false);
        expect(calls[0].normalize).toBe(true);

        expect(existsSync(outputPath)).toBe(true);
        expect(existsSync(audioPath)).toBe(true);

        const content = JSON.parse(readFileSync(outputPath, 'utf-8'));
        const validated = ContentSchema.parse(content);
        expect(validated.format).toBe('audio');
        expect(validated.metadata?.audioPath).toBe(audioPath);
        expect(validated.metadata?.generator).toBe('kk:voice-gen');
        expect(validated.metadata?.duration).toBe(2.5);
    });

    it('R3 — VoiceScript multi-speaker input becomes sequential generations concatenated in script order', async () => {
        const scriptYaml = `
title: "Tech Podcast Episode 1"
speakers:
  host:
    profile: "Host"
    instruct: "Upbeat and energetic"
  guest:
    profile: "Robin"
segments:
  - speaker: host
    text: "Welcome to the show!"
    gap_ms: 200
  - speaker: guest
    text: "Thanks for having me."
    gap_ms: 300
`;
        const doc: Doc = {
            id: 'doc-podcast',
            sourceUri: 'https://example.com/podcast',
            title: 'Podcast Script',
            body: scriptYaml,
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        const calls: VoiceboxGenerateBody[] = [];
        const client = createMockClient({
            generate: async (body) => {
                calls.push(body);
                return { id: `gen-${calls.length}` };
            },
            waitUntilDone: async (_id) => {
                return { status: 'completed', duration: 1.5 };
            },
        });

        await processGeneratorIO(inputPath, outputPath, client);

        expect(calls.length).toBe(2);
        expect(calls[0].profile_id).toBe('prof-3');
        expect(calls[0].text).toBe('Welcome to the show!');
        expect(calls[0].instruct).toBe('Upbeat and energetic');

        expect(calls[1].profile_id).toBe('prof-1');
        expect(calls[1].text).toBe('Thanks for having me.');

        expect(existsSync(outputPath)).toBe(true);
        expect(existsSync(audioPath)).toBe(true);

        const content = JSON.parse(readFileSync(outputPath, 'utf-8'));
        expect(content.title).toBe('Tech Podcast Episode 1');
        expect(content.format).toBe('audio');
        expect(content.metadata.duration).toBeCloseTo(3.5, 2); // 1.5 + 0.2 + 1.5 + 0.3
        expect(content.metadata.segments.length).toBe(2);

        // Verify WAV concatenation
        const wavBytes = readFileSync(audioPath);
        const parsed = parseWav(wavBytes);
        expect(parsed.sampleRate).toBe(24000);
    });

    it('R4 — Segment text over 50,000 characters fails loud without writing --out', async () => {
        const largeText = 'A'.repeat(50001);
        const doc: Doc = {
            id: 'doc-large',
            sourceUri: 'https://example.com/large',
            title: 'Large Text',
            body: largeText,
            metadata: { voiceProfile: 'Robin' },
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        const client = createMockClient();

        let thrownError: Error | undefined;
        try {
            await processGeneratorIO(inputPath, outputPath, client);
        } catch (err: unknown) {
            thrownError = err instanceof Error ? err : new Error(String(err));
        }

        expect(thrownError).toBeDefined();
        expect(thrownError?.message).toContain('50,000-character');
        expect(existsSync(outputPath)).toBe(false);
        expect(existsSync(audioPath)).toBe(false);
    });

    it('R5 — Voicebox unavailable, missing profile, failure, or timeout fails loud', async () => {
        const doc: Doc = {
            id: 'doc-1',
            sourceUri: 'https://example.com/test',
            title: 'Test',
            body: 'Hello world',
            metadata: { voiceProfile: 'NonExistentProfile' },
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        // 1. Missing profile
        const client1 = createMockClient();
        await expect(processGeneratorIO(inputPath, outputPath, client1)).rejects.toThrow(
            /profile "NonExistentProfile" not found/,
        );
        expect(existsSync(outputPath)).toBe(false);

        // 2. Health check failed
        const client2 = createMockClient({
            health: async () => {
                throw new Error('Voicebox health check failed at http://127.0.0.1:17493: connection refused');
            },
        });
        doc.metadata = { voiceProfile: 'Robin' };
        writeFileSync(inputPath, JSON.stringify([doc]));
        await expect(processGeneratorIO(inputPath, outputPath, client2)).rejects.toThrow(
            /Voicebox health check failed at http:\/\/127\.0\.0\.1:17493/,
        );

        // 3. Generation status failed
        const client3 = createMockClient({
            waitUntilDone: async () => {
                return { status: 'failed', error: 'CUDA out of memory' };
            },
        });
        await expect(processGeneratorIO(inputPath, outputPath, client3)).rejects.toThrow(
            /Voicebox generation failed for profile "Robin": CUDA out of memory/,
        );

        // 4. Timeout
        const client4 = createMockClient({
            waitUntilDone: async () => {
                throw new Error('Voicebox generation timed out after 600000ms for id: gen-1 at http://127.0.0.1:17493');
            },
        });
        await expect(processGeneratorIO(inputPath, outputPath, client4)).rejects.toThrow(/timed out/);
    });

    it('R6 — Empty DocList input writes notice Content and makes zero Voicebox calls', async () => {
        writeFileSync(inputPath, JSON.stringify([]));

        let called = false;
        const client = createMockClient({
            health: async () => {
                called = true;
            },
            generate: async () => {
                called = true;
                return { id: 'x' };
            },
        });

        await processGeneratorIO(inputPath, outputPath, client);

        expect(called).toBe(false);
        expect(existsSync(outputPath)).toBe(true);
        expect(existsSync(audioPath)).toBe(false);

        const content = JSON.parse(readFileSync(outputPath, 'utf-8'));
        expect(content.title).toBe('Notice');
        expect(content.body).toContain('# Notice');
        expect(content.format).toBe('markdown');
    });

    it('R7 — Invalid VoiceScript fails loud and does not fall through to plain text', async () => {
        // 1. JSON object without segments
        const invalidJsonDoc: Doc = {
            id: 'doc-invalid-json',
            sourceUri: 'https://example.com/invalid',
            title: 'Invalid Script',
            body: JSON.stringify({ title: 'No Segments Here', speakers: { a: { profile: 'Robin' } } }),
        };
        writeFileSync(inputPath, JSON.stringify([invalidJsonDoc]));

        const client = createMockClient();
        await expect(processGeneratorIO(inputPath, outputPath, client)).rejects.toThrow(/segments/);
        expect(existsSync(outputPath)).toBe(false);

        // 2. YAML object with speakers but no segments
        const invalidYamlDoc: Doc = {
            id: 'doc-invalid-yaml',
            sourceUri: 'https://example.com/invalid-yaml',
            title: 'Invalid Yaml',
            body: 'default_profile: Robin\nspeakers:\n  h: { profile: Robin }\n',
        };
        writeFileSync(inputPath, JSON.stringify([invalidYamlDoc]));
        await expect(processGeneratorIO(inputPath, outputPath, client)).rejects.toThrow(/segments/);
    });

    it('R8 — Unit tests run offline against a fake Voicebox HTTP server', async () => {
        const client = createMockClient();
        writeFileSync(
            inputPath,
            JSON.stringify([
                {
                    id: 'doc-offline',
                    title: 'Offline',
                    body: 'Spoken offline.',
                    metadata: { voiceProfile: 'Robin' },
                },
            ]),
        );
        await processGeneratorIO(inputPath, outputPath, client);
        expect(existsSync(outputPath)).toBe(true);
        expect(client.url.startsWith('http://127.0.0.1')).toBe(true);
    });

    it('R9 — Auto-chunk knobs pass through to /generate within 100-5000 and 0-500 bounds', async () => {
        const scriptYaml = `
max_chunk_chars: 1200
crossfade_ms: 100
segments:
  - profile: "Robin"
    text: "Testing chunk knobs."
    max_chunk_chars: 1500
    crossfade_ms: 80
`;
        const doc: Doc = {
            id: 'doc-knobs',
            sourceUri: 'https://example.com/knobs',
            title: 'Knobs Test',
            body: scriptYaml,
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        const calls: VoiceboxGenerateBody[] = [];
        const client = createMockClient({
            generate: async (body) => {
                calls.push(body);
                return { id: 'gen-knobs' };
            },
        });

        await processGeneratorIO(inputPath, outputPath, client);

        expect(calls.length).toBe(1);
        expect(calls[0].max_chunk_chars).toBe(1500);
        expect(calls[0].crossfade_ms).toBe(80);

        // Invalid chunk knobs
        const invalidChunkYaml = `
segments:
  - profile: "Robin"
    text: "Invalid chunk"
    max_chunk_chars: 50
`;
        writeFileSync(inputPath, JSON.stringify([{ ...doc, body: invalidChunkYaml }]));
        await expect(processGeneratorIO(inputPath, outputPath, client)).rejects.toThrow(
            /max_chunk_chars must be between 100 and 5000/,
        );

        const invalidCrossfadeYaml = `
segments:
  - profile: "Robin"
    text: "Invalid crossfade"
    crossfade_ms: 600
`;
        writeFileSync(inputPath, JSON.stringify([{ ...doc, body: invalidCrossfadeYaml }]));
        await expect(processGeneratorIO(inputPath, outputPath, client)).rejects.toThrow(
            /crossfade_ms must be between 0 and 500/,
        );
    });

    it('R10 — Instruct over 500 characters fails loud before HTTP', async () => {
        const longInstruct = 'I'.repeat(501);
        const scriptYaml = `
segments:
  - profile: "Robin"
    text: "Hello world"
    instruct: "${longInstruct}"
`;
        const doc: Doc = {
            id: 'doc-instruct',
            sourceUri: 'https://example.com/instruct',
            title: 'Instruct Test',
            body: scriptYaml,
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        let httpCalled = false;
        const client = createMockClient({
            generate: async () => {
                httpCalled = true;
                return { id: 'x' };
            },
        });

        await expect(processGeneratorIO(inputPath, outputPath, client)).rejects.toThrow(/500/);
        expect(httpCalled).toBe(false);
        expect(existsSync(outputPath)).toBe(false);
    });

    it('R11 — Paralinguistic tags are passed through uninterpreted on /generate', async () => {
        const bodyWithTag = '[laugh] That was hilarious! [sigh] But now we must work.';
        const doc: Doc = {
            id: 'doc-tag',
            sourceUri: 'https://example.com/tag',
            title: 'Tag Test',
            body: bodyWithTag,
            metadata: { voiceProfile: 'Robin' },
        };
        writeFileSync(inputPath, JSON.stringify([doc]));

        const calls: VoiceboxGenerateBody[] = [];
        const client = createMockClient({
            generate: async (body) => {
                calls.push(body);
                return { id: 'gen-tag' };
            },
        });

        await processGeneratorIO(inputPath, outputPath, client);

        expect(calls.length).toBe(1);
        expect(calls[0].text).toBe('[laugh] That was hilarious! [sigh] But now we must work.');
    });

    it('HTTP client — createVoiceboxClient handles real URL formatting, timeouts, and headers', async () => {
        const requests: { url: string; method?: string; body?: string; headers?: Record<string, string> }[] = [];

        const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            requests.push({
                url,
                method: init?.method,
                body: init?.body ? String(init.body) : undefined,
                headers: (init?.headers as Record<string, string>) || {},
            });

            if (url.endsWith('/health')) {
                return new Response(JSON.stringify({ status: 'ok', model_loaded: false }), { status: 200 });
            }
            if (url.endsWith('/profiles')) {
                return new Response(JSON.stringify([{ id: 'p1', name: 'Alice' }]), { status: 200 });
            }
            if (url.endsWith('/generate')) {
                return new Response(JSON.stringify({ id: 'gen-123', status: 'generating' }), { status: 200 });
            }
            if (url.endsWith('/history/gen-123')) {
                return new Response(JSON.stringify({ id: 'gen-123', status: 'completed', duration: 1.2 }), {
                    status: 200,
                });
            }
            if (url.endsWith('/audio/gen-123')) {
                return new Response(createTestWav(100), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
            }
            return new Response('Not found', { status: 404 });
        };

        const client = createVoiceboxClient({
            url: 'http://custom-voicebox:17493/',
            fetch: mockFetch,
        });

        await client.health();
        const profile = await client.resolveProfile('alice');
        expect(profile.id).toBe('p1');

        const { id } = await client.generate({
            profile_id: 'p1',
            text: 'Hello custom',
            language: 'en',
            max_chunk_chars: 800,
            crossfade_ms: 50,
            personality: false,
            normalize: true,
        });
        expect(id).toBe('gen-123');

        const history = await client.waitUntilDone(id);
        expect(history.status).toBe('completed');
        expect(history.duration).toBe(1.2);

        const audio = await client.downloadAudio(id);
        expect(audio.length).toBeGreaterThan(44);

        expect(requests.some((r) => r.url === 'http://custom-voicebox:17493/health')).toBe(true);
        expect(requests.some((r) => r.url === 'http://custom-voicebox:17493/profiles')).toBe(true);
        expect(requests.some((r) => r.url === 'http://custom-voicebox:17493/generate')).toBe(true);
        expect(requests.some((r) => r.url === 'http://custom-voicebox:17493/history/gen-123')).toBe(true);
        expect(requests.some((r) => r.url === 'http://custom-voicebox:17493/audio/gen-123')).toBe(true);
    });

    it('HTTP client error branches — throws on network errors, non-200, malformed JSON, and timeouts', async () => {
        // Health network error
        const netErrHealth = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => {
                throw new Error('Network error');
            },
        });
        await expect(netErrHealth.health()).rejects.toThrow(/Network error/);

        // Profiles network error
        const netErrProfiles = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => {
                throw new Error('Network error');
            },
        });
        await expect(netErrProfiles.resolveProfile('Robin')).rejects.toThrow(/Network error/);

        // Profiles invalid JSON
        const badJsonProfiles = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('invalid-json', { status: 200 }),
        });
        await expect(badJsonProfiles.resolveProfile('Robin')).rejects.toThrow(/invalid JSON/);

        // Profiles non-array
        const notArrayProfiles = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('{"not":"array"}', { status: 200 }),
        });
        await expect(notArrayProfiles.resolveProfile('Robin')).rejects.toThrow(/non-array/);

        // Profiles non-200
        const notFoundProfiles = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('Not found', { status: 404 }),
        });
        await expect(notFoundProfiles.resolveProfile('Robin')).rejects.toThrow(/HTTP 404/);

        // Generate network error
        const netErrGenerate = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => {
                throw new Error('Network fail');
            },
        });
        await expect(
            netErrGenerate.generate({
                profile_id: 'p1',
                text: 'hi',
                language: 'en',
                max_chunk_chars: 800,
                crossfade_ms: 50,
                personality: false,
                normalize: true,
            }),
        ).rejects.toThrow(/Network fail/);

        // Generate non-200 with error details
        const errGen = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('Invalid input param', { status: 400, statusText: 'Bad Request' }),
        });
        await expect(
            errGen.generate({
                profile_id: 'p1',
                text: 'hi',
                language: 'en',
                max_chunk_chars: 800,
                crossfade_ms: 50,
                personality: false,
                normalize: true,
            }),
        ).rejects.toThrow(/Invalid input param/);

        // Generate invalid JSON response
        const badJsonGen = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('not-json', { status: 200 }),
        });
        await expect(
            badJsonGen.generate({
                profile_id: 'p1',
                text: 'hi',
                language: 'en',
                max_chunk_chars: 800,
                crossfade_ms: 50,
                personality: false,
                normalize: true,
            }),
        ).rejects.toThrow(/invalid JSON/);

        // Generate missing id response
        const missingIdGen = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('{}', { status: 200 }),
        });
        await expect(
            missingIdGen.generate({
                profile_id: 'p1',
                text: 'hi',
                language: 'en',
                max_chunk_chars: 800,
                crossfade_ms: 50,
                personality: false,
                normalize: true,
            }),
        ).rejects.toThrow(/missing id/);

        // History network error
        const netErrHistory = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => {
                throw new Error('History fail');
            },
        });
        await expect(netErrHistory.waitUntilDone('id1')).rejects.toThrow(/History fail/);

        // History invalid JSON
        const badJsonHistory = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response('not-json', { status: 200 }),
        });
        await expect(badJsonHistory.waitUntilDone('id1')).rejects.toThrow(/invalid JSON/);

        // History status failed with custom error
        const failedHistory = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response(JSON.stringify({ status: 'failed', error: 'GPU error' }), { status: 200 }),
        });
        const resFailed = await failedHistory.waitUntilDone('id1');
        expect(resFailed.status).toBe('failed');
        expect(resFailed.error).toBe('GPU error');

        // History timeout
        let sleepCalled = 0;
        const timeoutHistory = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => new Response(JSON.stringify({ status: 'generating' }), { status: 200 }),
            sleep: async () => {
                sleepCalled++;
            },
        });
        await expect(timeoutHistory.waitUntilDone('id1', 0, 10)).rejects.toThrow(/timed out/);
        expect(sleepCalled).toBe(0);

        // Audio network error
        const netErrAudio = createVoiceboxClient({
            url: 'http://custom-voicebox:17493',
            fetch: async () => {
                throw new Error('Audio stream error');
            },
        });
        await expect(netErrAudio.downloadAudio('id1')).rejects.toThrow(/Audio stream error/);
    });

    it('Concat — concatWavs edge cases and validation', () => {
        expect(concatWavs([])).toEqual(new Uint8Array(0));

        const wav1 = createTestWav(100, 24000);
        const wav2 = createTestWav(100, 24000);
        const wavWrongRate = createTestWav(100, 48000);
        const wavWrongChannels = createTestWav(100, 24000, 2);

        const merged = concatWavs([wav1, wav2], [0, 100]); // 100ms gap
        const parsed = parseWav(merged);
        expect(parsed.sampleRate).toBe(24000);
        expect(parsed.dataBytes.length).toBe(2600 * 2);

        expect(() => concatWavs([wav1, wavWrongRate])).toThrow(/sample rate mismatch/);
        expect(() => concatWavs([wav1, wavWrongChannels])).toThrow(/WAV format mismatch/);

        // Parse errors
        expect(() => parseWav(new Uint8Array(10))).toThrow(/too short/);
        const badHeader = new Uint8Array(50);
        expect(() => parseWav(badHeader)).toThrow(/expected RIFF\/WAVE header/);
    });

    it('VoiceScript — parsing and merging multi-doc scripts', () => {
        // Empty parse
        expect(mergeVoiceScripts([], [])).toEqual({ segments: [] });

        // JSON parse error
        expect(() => parseDocToVoiceScript({ id: '1', sourceUri: '', title: '', body: '{ invalid json' })).toThrow(
            /failed to parse JSON/,
        );

        // Plain text with bracket
        const bracketDoc = parseDocToVoiceScript({ id: '1', sourceUri: '', title: '', body: '[laugh] hi' });
        expect(bracketDoc.segments[0]?.text).toBe('[laugh] hi');

        // YAML parse falling through to plain text
        const plainYaml = parseDocToVoiceScript({
            id: '1',
            sourceUri: '',
            title: '',
            body: 'just plain text without keys',
        });
        expect(plainYaml.segments[0]?.text).toBe('just plain text without keys');

        // Multi-doc merging full properties
        const docA: Doc = {
            id: '1',
            sourceUri: '',
            title: 'Doc 1',
            body: 'default_profile: Robin\ndefault_engine: qwen\nlanguage: en\nmax_chunk_chars: 500\ncrossfade_ms: 100\nspeakers:\n  alice: { profile: A }\nsegments:\n  - text: hello\n',
        };
        const docB: Doc = {
            id: '2',
            sourceUri: '',
            title: 'Doc 2',
            body: 'speakers:\n  bob: { profile: B }\nsegments:\n  - text: world\n',
        };
        const s1 = parseDocToVoiceScript(docA);
        const s2 = parseDocToVoiceScript(docB);
        const merged = mergeVoiceScripts([s1, s2], [docA, docB]);
        expect(merged.default_profile).toBe('Robin');
        expect(merged.default_engine).toBe('qwen');
        expect(merged.language).toBe('en');
        expect(merged.max_chunk_chars).toBe(500);
        expect(merged.crossfade_ms).toBe(100);
        expect(merged.speakers?.alice?.profile).toBe('A');
        expect(merged.speakers?.bob?.profile).toBe('B');

        // Multi-doc duplicate speaker error
        const docB_dup: Doc = {
            id: '2',
            sourceUri: '',
            title: 'Doc 2',
            body: 'speakers:\n  alice: { profile: B }\nsegments:\n  - text: world\n',
        };
        const s2_dup = parseDocToVoiceScript(docB_dup);
        expect(() => mergeVoiceScripts([s1, s2_dup], [docA, docB_dup])).toThrow(
            /Duplicate speaker key across documents/,
        );

        // Validation errors
        expect(() => validateVoiceScript(null as unknown as VoiceScript)).toThrow(/must be an object/);
        expect(() => validateVoiceScript({ segments: [] })).toThrow(/non-empty segments/);
        expect(() => validateVoiceScript({ max_chunk_chars: 10, segments: [{ text: 'hi' }] })).toThrow(
            /max_chunk_chars/,
        );
        expect(() => validateVoiceScript({ max_chunk_chars: 6000, segments: [{ text: 'hi' }] })).toThrow(
            /max_chunk_chars/,
        );
        expect(() => validateVoiceScript({ crossfade_ms: -1, segments: [{ text: 'hi' }] })).toThrow(/crossfade_ms/);
        expect(() => validateVoiceScript({ crossfade_ms: 600, segments: [{ text: 'hi' }] })).toThrow(/crossfade_ms/);
        expect(() =>
            validateVoiceScript({
                speakers: {
                    a: null as unknown as VoiceSpeaker,
                },
                segments: [{ text: 'hi' }],
            }),
        ).toThrow(/must be an object/);
        expect(() =>
            validateVoiceScript({
                speakers: {
                    a: { profile: '' },
                },
                segments: [{ text: 'hi' }],
            }),
        ).toThrow(/must have a profile/);
        expect(() =>
            validateVoiceScript({
                speakers: {
                    a: { profile: 'Robin', instruct: 'x'.repeat(501) },
                },
                segments: [{ text: 'hi' }],
            }),
        ).toThrow(/Speaker "a" instruct exceeds 500 characters/);
        expect(() =>
            validateVoiceScript({
                segments: [null as unknown as { text: string }],
            }),
        ).toThrow(/must be an object/);
        expect(() =>
            validateVoiceScript({
                segments: [{ text: 'hi', speaker: 'missing' }],
            }),
        ).toThrow(/Unknown speaker: "missing"/);
        expect(() =>
            validateVoiceScript({
                segments: [{ text: '' }],
            }),
        ).toThrow(/Segment at index 0 text must not be empty/);
        expect(() =>
            validateVoiceScript({
                segments: [{ text: 'hi', gap_ms: -5 }],
            }),
        ).toThrow(/gap_ms must be non-negative/);
        expect(() =>
            validateVoiceScript({
                segments: [{ text: 'hi', max_chunk_chars: 50 }],
            }),
        ).toThrow(/max_chunk_chars/);
        expect(() =>
            validateVoiceScript({
                segments: [{ text: 'hi', crossfade_ms: 600 }],
            }),
        ).toThrow(/crossfade_ms/);
        expect(() =>
            validateVoiceScript({
                default_engine: 'piper',
                segments: [{ text: 'hi' }],
            }),
        ).toThrow(/engine must be one of/);
        expect(() =>
            validateVoiceScript({
                language: 'xx',
                segments: [{ text: 'hi' }],
            }),
        ).toThrow(/language must be a Voicebox language code/);
    });

    it('main CLI — parses args and handles missing flags and errors', async () => {
        const oldArgv = process.argv;
        try {
            // Missing args
            process.argv = ['bun', 'voice-gen'];
            const code1 = await main();
            expect(code1).toBe(1);

            // Valid invocation on empty doclist
            writeFileSync(inputPath, JSON.stringify([]));
            process.argv = ['bun', 'voice-gen', '--in', inputPath, '--out', outputPath];
            const code2 = await main();
            expect(code2).toBe(0);
            expect(existsSync(outputPath)).toBe(true);

            // Invalid input JSON
            writeFileSync(inputPath, 'not-json');
            const code3 = await main();
            expect(code3).toBe(1);
        } finally {
            process.argv = oldArgv;
        }
    });

    it('R12 — Documentation & quality gate pointers exist', async () => {
        const root = join(import.meta.dir, '../../../..');
        const arch = await Bun.file(join(root, 'docs/03_ARCHITECTURE.md')).text();
        expect(arch).toContain('voice-gen/');
        const designIdx = await Bun.file(join(root, 'docs/04_DESIGN.md')).text();
        expect(designIdx).toContain('shipped (D5)');
        const spec = await Bun.file(join(root, 'docs/design/generator-plugin-specification.md')).text();
        expect(spec).toContain('format: "audio"');
        const features = await Bun.file(join(root, 'docs/05_FEATURES.md')).text();
        expect(features).toContain('Voice generator (Voicebox)');
    });
});
