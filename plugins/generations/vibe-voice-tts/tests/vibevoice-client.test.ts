import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceboxGenerateBody } from '@gobing-ai/voice-gen';
import {
    assertNoVendorPath,
    createVibeVoiceClient,
    parseVibeVoiceRegistry,
    resolveVibeVoiceWorkerCommand,
    type VibeVoiceClientOptions,
} from '../src/vibevoice-client';

const FAKE = new URL('./fake-worker.ts', import.meta.url).pathname;
const SHIPPED_PROFILES = new URL('../profiles.json', import.meta.url).pathname;

const dirs: string[] = [];
function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vibevoice-client-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    while (dirs.length > 0) {
        rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
});

function client(mode: string, options: { env?: Record<string, string | undefined>; workerCommand?: string[] } = {}) {
    const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        VIBEVOICE_DEVICE: 'cpu',
        ...options.env,
    };
    const opts: VibeVoiceClientOptions = {
        workerCommand: options.workerCommand ?? ['bun', FAKE, mode],
        env,
    };
    return createVibeVoiceClient(opts);
}

function body(profileId = 'robin-news', over: Partial<VoiceboxGenerateBody> = {}): VoiceboxGenerateBody {
    return { profile_id: profileId, text: '你好世界', language: 'zh', max_chunk_chars: 800, crossfade_ms: 50, ...over };
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitGone(pid: number, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (!isAlive(pid)) return;
        await Bun.sleep(50);
    }
}

describe('parseVibeVoiceRegistry', () => {
    it('parses the shipped robin-news instruct profile', () => {
        const profiles = parseVibeVoiceRegistry(JSON.parse(readFileSync(SHIPPED_PROFILES, 'utf-8')), '/tmp');
        expect(profiles).toHaveLength(1);
        expect(profiles[0]).toMatchObject({ id: 'robin-news', name: 'robin-news', mode: 'instruct' });
        expect(profiles[0]?.instruct).toBeTruthy();
    });

    it('resolves relative reference and cached_prompt assets plus inference knobs', () => {
        const dir = makeDir();
        const profiles = parseVibeVoiceRegistry(
            {
                profiles: [
                    {
                        id: 'ref',
                        name: 'Ref Voice',
                        mode: 'reference',
                        reference_wav_path: 'ref.wav',
                        cfg_scale: 1.5,
                        ddpm_steps: 10,
                    },
                    {
                        id: 'cached',
                        name: 'Cached Voice',
                        mode: 'cached_prompt',
                        prompt_pt_path: 'voice.pt',
                        cfg_scale: 1.3,
                        ddpm_steps: 5,
                    },
                ],
            },
            dir,
        );
        expect(profiles[0]).toMatchObject({
            id: 'ref',
            mode: 'reference',
            reference_wav_path: join(dir, 'ref.wav'),
            cfg_scale: 1.5,
            ddpm_steps: 10,
        });
        expect(profiles[1]).toMatchObject({
            id: 'cached',
            mode: 'cached_prompt',
            prompt_pt_path: join(dir, 'voice.pt'),
            cfg_scale: 1.3,
            ddpm_steps: 5,
        });
    });

    it('rejects duplicates, missing fields, mixed modes, invalid knobs, serialized prompts, and non-arrays', () => {
        const bad = [
            {
                profiles: [
                    { id: 'a', name: 'a', mode: 'instruct', instruct: 'x' },
                    { id: 'a', name: 'b', mode: 'instruct', instruct: 'x' },
                ],
            },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'reference' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'cached_prompt' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', reference_wav_path: 'r.wav' }] },
            {
                profiles: [
                    { id: 'a', name: 'a', mode: 'reference', reference_wav_path: 'r.wav', prompt_pt_path: 'p.pt' },
                ],
            },
            {
                profiles: [
                    { id: 'a', name: 'a', mode: 'cached_prompt', prompt_pt_path: 'p.pt', reference_wav_path: 'r.wav' },
                ],
            },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', cfg_scale: -1 }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', ddpm_steps: 1.5 }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', prompt: { foo: 'bar' } }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', serialized_prompt: 'abc' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'weird' }] },
            { not_profiles: [] },
        ];
        for (const registry of bad) {
            expect(() => parseVibeVoiceRegistry(registry, '/tmp')).toThrow();
        }
    });

    it('rejects profile assets that resolve into vendors/', () => {
        expect(() =>
            parseVibeVoiceRegistry(
                {
                    profiles: [
                        { id: 'r', name: 'r', mode: 'reference', reference_wav_path: '/tmp/vendors/VibeVoice/x.wav' },
                    ],
                },
                '/tmp',
            ),
        ).toThrow(/vendors\//);
        expect(() =>
            parseVibeVoiceRegistry(
                {
                    profiles: [
                        { id: 'c', name: 'c', mode: 'cached_prompt', prompt_pt_path: '/tmp/vendors/VibeVoice/c.pt' },
                    ],
                },
                '/tmp',
            ),
        ).toThrow(/vendors\//);
    });
});

describe('createVibeVoiceClient guards', () => {
    it('rejects configured cache/import paths inside vendors/ before spawning', async () => {
        const handle = createVibeVoiceClient({
            workerCommand: ['bun', FAKE, 'ok'],
            env: { PATH: process.env.PATH, VIBEVOICE_DEVICE: 'cpu', UV_CACHE_DIR: join(makeDir(), 'vendors', 'cache') },
        });
        await expect(handle.client.health()).rejects.toThrow(/UV_CACHE_DIR must not reference vendors\//);
        await handle.close();
    });

    it('rejects an unsupported VIBEVOICE_DEVICE', async () => {
        const handle = client('ok', { env: { VIBEVOICE_DEVICE: 'tpu' } });
        await expect(handle.client.health()).rejects.toThrow(/unsupported VIBEVOICE_DEVICE "tpu"/);
        await handle.close();
    });

    it('rejects spawn failure cleanly when worker binary is missing', async () => {
        const handle = client('ok', { workerCommand: ['/nonexistent/binary/that/does/not/exist'] });
        await expect(handle.client.health()).rejects.toThrow(/worker/);
        await handle.close();
    });

    it('rejects unsupported controls and ignores per-request instruct on anchored profiles', async () => {
        const dir = makeDir();
        const registry = join(dir, 'profiles.json');
        writeFileSync(
            registry,
            JSON.stringify({
                profiles: [
                    { id: 'instruct', name: 'instruct', mode: 'instruct', instruct: 'calm' },
                    { id: 'ref', name: 'ref', mode: 'reference', reference_wav_path: './ref.wav', cfg_scale: 1.6 },
                    { id: 'cached', name: 'cached', mode: 'cached_prompt', prompt_pt_path: './v.pt', ddpm_steps: 5 },
                ],
            }),
        );
        writeFileSync(join(dir, 'ref.wav'), 'x');
        writeFileSync(join(dir, 'v.pt'), 'x');
        const reqLog = join(dir, 'last-req.json');
        const handle = client('ok', { env: { VIBEVOICE_PROFILES_PATH: registry, FAKE_REQUEST_LOG: reqLog } });
        await handle.client.health();
        await expect(handle.client.generate(body('instruct', { engine: 'qwen' }))).rejects.toThrow(/engine/);
        await expect(handle.client.generate(body('instruct', { personality: true }))).rejects.toThrow(/personality/);
        await expect(handle.client.generate(body('instruct', { effects_chain: [{ type: 'reverb' }] }))).rejects.toThrow(
            /effects_chain/,
        );
        await expect(handle.client.generate(body('missing'))).rejects.toThrow(/unknown voice profile/);

        const r1 = await handle.client.generate(body('ref', { instruct: 'ignored', seed: 42 }));
        await handle.client.waitUntilDone(r1.id, 5000);
        const logged1 = JSON.parse(readFileSync(reqLog, 'utf-8')) as {
            seed: number | null;
            profile: Record<string, unknown>;
        };
        expect(logged1.seed).toBe(42);
        expect(logged1.profile).toMatchObject({ mode: 'reference', cfg_scale: 1.6 });

        // Rejects a second concurrent render while one is in flight.
        const r2 = await handle.client.generate(body('cached', { instruct: 'ignored' }));
        await expect(handle.client.generate(body('cached'))).rejects.toThrow(/already in flight/);
        await handle.client.waitUntilDone(r2.id, 5000);
        await handle.close();
    });

    it('refuses a second segment on an instruct profile instead of switching speakers', async () => {
        const handle = client('ok');
        await handle.client.health();
        const first = await handle.client.generate(body());
        await handle.client.waitUntilDone(first.id, 5000);
        await expect(handle.client.generate(body())).rejects.toThrow(/pins no speaker/);
        await handle.close();
    });
});

describe('createVibeVoiceClient protocol + lifecycle', () => {
    it('round-trips health + render and derives duration from the 24 kHz WAV', async () => {
        const handle = client('ok');
        await handle.client.health();
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        expect(await handle.client.waitUntilDone(id, 5000)).toEqual({ status: 'completed', duration: 1 });
        const wav = await handle.client.downloadAudio(id);
        expect(wav.length).toBeGreaterThan(44);
        await handle.close();
    });

    it('is terminal after an invalid JSON frame and rejects a retry without restart', async () => {
        const handle = client('bad-json');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/invalid JSON/);
        await expect(handle.client.health()).rejects.toThrow(/invalid JSON/);
        await handle.close();
    });

    it('is terminal on an unexpected response id or mismatched wav_path', async () => {
        const wrongId = client('wrong-id');
        await wrongId.client.health();
        const r1 = await wrongId.client.generate(body());
        await expect(wrongId.client.waitUntilDone(r1.id, 5000)).rejects.toThrow(/unknown or duplicate id/);
        await wrongId.close();

        const wrongPath = client('wrong-wav-path');
        await wrongPath.client.health();
        const r2 = await wrongPath.client.generate(body());
        await expect(wrongPath.client.waitUntilDone(r2.id, 5000)).rejects.toThrow(/unexpected WAV path/);
        await wrongPath.close();
    });

    it('is terminal on an oversized frame', async () => {
        const handle = client('oversize');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/exceeds 1 MiB/);
        await handle.close();
    });

    it('bounds a hung render by the waitUntilDone deadline and goes terminal', async () => {
        const handle = client('hang');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 400)).rejects.toThrow(/timed out after 400ms/);
        await expect(handle.client.health()).rejects.toThrow(/timed out after 400ms/);
        await handle.close();
    });

    it('rejects a non-mono worker WAV', async () => {
        const handle = client('bad-wav');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/mono/);
        await handle.close();
    });

    it('rejects an empty worker WAV', async () => {
        const handle = client('empty-wav');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/no samples/);
        await handle.close();
    });

    it('close reaps the owned worker and its descendant process', async () => {
        const pidFile = join(makeDir(), 'child.pid');
        const handle = client('descendant', { env: { FAKE_CHILD_PID_FILE: pidFile } });
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await handle.client.waitUntilDone(id, 10_000);
        await handle.client.downloadAudio(id);
        const childPid = Number((await Bun.file(pidFile).text()).trim());
        expect(childPid).toBeGreaterThan(0);
        expect(isAlive(childPid)).toBe(true);
        await handle.close();
        await waitGone(childPid);
        expect(isAlive(childPid)).toBe(false);
    });
});

describe('vibe-voice-tts worker command + registry/file guards', () => {
    it('resolveVibeVoiceWorkerCommand builds the locked uv argv (no shell)', () => {
        expect(resolveVibeVoiceWorkerCommand('/opt/plugin')).toEqual([
            'uv',
            'run',
            '--project',
            '/opt/plugin',
            '--locked',
            '--no-dev',
            'python',
            '/opt/plugin/python/worker.py',
        ]);
    });

    it('assertNoVendorPath refuses a path that resolves into vendors/ through a symlink', () => {
        const dir = makeDir();
        mkdirSync(join(dir, 'vendors'), { recursive: true });
        writeFileSync(join(dir, 'vendors', 'model.bin'), 'x');
        symlinkSync(join(dir, 'vendors'), join(dir, 'link-to-vendor'), 'dir');
        expect(() => assertNoVendorPath(join(dir, 'link-to-vendor'), 'model')).toThrow(/resolves into vendors\//);
    });

    it('rejects malformed registry entries', () => {
        expect(() => parseVibeVoiceRegistry({ profiles: [42] }, '/tmp')).toThrow(/not an object/);
        expect(() => parseVibeVoiceRegistry({ profiles: [{ mode: 'instruct', instruct: 'x' }] }, '/tmp')).toThrow(
            /nonempty id and name/,
        );
        expect(() =>
            parseVibeVoiceRegistry(
                { profiles: [{ id: 'a', name: 'a', mode: 'reference', reference_wav_path: '' }] },
                '/tmp',
            ),
        ).toThrow(/nonempty string/);
    });

    it('reports a missing or invalid-JSON registry file', async () => {
        const missing = client('ok', { env: { VIBEVOICE_PROFILES_PATH: join(makeDir(), 'nope.json') } });
        await expect(missing.client.resolveProfile('robin-news')).rejects.toThrow(/registry not found/);
        await missing.close();

        const badPath = join(makeDir(), 'profiles.json');
        writeFileSync(badPath, '{ not json');
        const bad = client('ok', { env: { VIBEVOICE_PROFILES_PATH: badPath } });
        await expect(bad.client.resolveProfile('robin-news')).rejects.toThrow(/not valid JSON/);
        await bad.close();
    });
});

describe('vibe-voice-tts worker failure surfaces', () => {
    it('surfaces a health error, an early exit, and a crash', async () => {
        const herr = client('health-error');
        await expect(herr.client.health()).rejects.toThrow(/health failed: model load failed/);
        await herr.close();

        const dead = client('exit0');
        await expect(dead.client.health()).rejects.toThrow();
        await dead.close();

        const crash = client('crash');
        await expect(crash.client.health()).rejects.toThrow();
        await crash.close();
    });

    it('resolves unknown ids as failures and rejects them on download', async () => {
        const handle = client('ok');
        await handle.client.health();
        await expect(handle.client.waitUntilDone('999')).resolves.toMatchObject({ status: 'failed' });
        await expect(handle.client.downloadAudio('999')).rejects.toThrow(/unknown generation id/);
        await handle.close();
    });

    it('returns a render error as a failed status (retryable, not terminal)', async () => {
        const handle = client('render-error');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id)).resolves.toEqual({ status: 'failed', error: 'backend exploded' });
        await handle.close();
    });

    it('rejects a garbage WAV and a non-16-bit WAV from the worker', async () => {
        for (const [mode, pattern] of [
            ['garbage-wav', /invalid worker WAV/],
            ['u8-wav', /must be 16-bit PCM/],
        ] as const) {
            const handle = client(mode);
            await handle.client.health();
            const { id } = await handle.client.generate(body());
            await expect(handle.client.waitUntilDone(id)).rejects.toThrow(pattern);
            await handle.close();
        }
    });

    it('ignores a blank protocol line and rejects a response without an integer id', async () => {
        const blank = client('blank-line');
        await blank.client.health();
        const ok = await blank.client.generate(body());
        await expect(blank.client.waitUntilDone(ok.id)).resolves.toMatchObject({ status: 'completed' });
        await blank.close();

        const noId = client('no-id');
        await noId.client.health();
        const bad = await noId.client.generate(body());
        await expect(noId.client.waitUntilDone(bad.id)).rejects.toThrow(/missing an integer id/);
        await noId.close();
    });

    it('close is idempotent and every surface refuses after close', async () => {
        const handle = client('ok');
        await handle.client.health();
        await handle.close();
        await handle.close();
        await expect(handle.client.health()).rejects.toThrow(/client is closed/);
        await expect(handle.client.generate(body())).rejects.toThrow(/client is closed/);
    });

    it('a terminal failure rejects every later surface, including downloadAudio', async () => {
        const handle = client('bad-json');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/invalid JSON/);
        await expect(handle.client.downloadAudio(id)).rejects.toThrow();
        await expect(handle.client.generate(body())).rejects.toThrow();
        await handle.close();
    });
});

describe('vibe-voice-tts teardown escalation + framing bound', () => {
    it('force-kills a descendant that ignores SIGTERM', async () => {
        const pidFile = join(makeDir(), 'stubborn.pid');
        const handle = client('stubborn', { env: { FAKE_CHILD_PID_FILE: pidFile } });
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await handle.client.waitUntilDone(id, 10_000);
        await handle.client.downloadAudio(id);
        const childPid = Number((await Bun.file(pidFile).text()).trim());
        expect(childPid).toBeGreaterThan(0);
        expect(isAlive(childPid)).toBe(true);
        await handle.close();
        await waitGone(childPid);
        expect(isAlive(childPid)).toBe(false);
    }, 20_000);

    it('bounds an in-progress frame with no newline at 1 MiB', async () => {
        const handle = client('oversize-no-newline');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/exceeds 1 MiB/);
        await handle.close();
    });

    it('surfaces worker stderr tail and exit code when stdout closes on crash', async () => {
        const handle = client('crash-stderr');
        await expect(handle.client.health()).rejects.toThrow(/RuntimeError: MPS OOM/);
        await handle.close();
    });
});
