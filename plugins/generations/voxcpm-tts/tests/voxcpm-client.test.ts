import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceboxGenerateBody } from '@gobing-ai/voice-gen';
import {
    assertNoVendorPath,
    createVoxCpmClient,
    parseVoxCpmRegistry,
    resolveVoxCpmWorkerCommand,
    type VoxCpmClientOptions,
} from '../src/voxcpm-client';

const FAKE = new URL('./fake-worker.ts', import.meta.url).pathname;
const SHIPPED_PROFILES = new URL('../profiles.json', import.meta.url).pathname;

const dirs: string[] = [];
function makeDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'voxcpm-client-'));
    dirs.push(dir);
    return dir;
}
afterEach(() => {
    while (dirs.length > 0) {
        rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
});

function client(mode: string, options: { env?: Record<string, string | undefined> } = {}) {
    const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        VOXCPM_DEVICE: 'cpu',
        ...options.env,
    };
    const opts: VoxCpmClientOptions = { workerCommand: ['bun', FAKE, mode], env };
    return createVoxCpmClient(opts);
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

describe('parseVoxCpmRegistry', () => {
    it('parses the shipped robin-news instruct profile', () => {
        const profiles = parseVoxCpmRegistry(JSON.parse(readFileSync(SHIPPED_PROFILES, 'utf-8')), '/tmp');
        expect(profiles).toHaveLength(1);
        expect(profiles[0]).toMatchObject({ id: 'robin-news', name: 'robin-news', mode: 'instruct' });
        expect(profiles[0]?.instruct).toBeTruthy();
    });

    it('resolves relative assets against the registry directory', () => {
        const dir = makeDir();
        const profiles = parseVoxCpmRegistry(
            { profiles: [{ id: 'r', name: 'r', mode: 'reference', reference_wav_path: 'ref.wav' }] },
            dir,
        );
        expect(profiles[0]?.reference_wav_path).toBe(join(dir, 'ref.wav'));
    });

    it('rejects duplicates, missing fields, mixed modes, serialized prompts and non-array', () => {
        const bad = [
            {
                profiles: [
                    { id: 'a', name: 'a', mode: 'instruct', instruct: 'x' },
                    { id: 'a', name: 'b', mode: 'instruct', instruct: 'x' },
                ],
            },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'reference' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'continuation', prompt_wav_path: 'p.wav' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', reference_wav_path: 'r.wav' }] },
            { profiles: [{ id: 'a', name: 'a', mode: 'instruct', instruct: 'x', prompt: { foo: 'bar' } }] },
            { not_profiles: [] },
        ];
        for (const registry of bad) {
            expect(() => parseVoxCpmRegistry(registry, '/tmp')).toThrow();
        }
    });

    it('rejects a profile asset that resolves into vendors/', () => {
        expect(() =>
            parseVoxCpmRegistry(
                {
                    profiles: [
                        { id: 'r', name: 'r', mode: 'reference', reference_wav_path: '/tmp/vendors/VoxCPM/x.wav' },
                    ],
                },
                '/tmp',
            ),
        ).toThrow(/vendors\//);
    });
});

describe('createVoxCpmClient guards', () => {
    it('rejects a configured cache path inside vendors/ before spawning', async () => {
        const handle = createVoxCpmClient({
            workerCommand: ['bun', FAKE, 'ok'],
            env: { PATH: process.env.PATH, VOXCPM_DEVICE: 'cpu', UV_CACHE_DIR: join(makeDir(), 'vendors', 'cache') },
        });
        await expect(handle.client.health()).rejects.toThrow(/UV_CACHE_DIR must not reference vendors\//);
        await handle.close();
    });

    it('rejects an unsupported VOXCPM_DEVICE', async () => {
        const handle = client('ok', { env: { VOXCPM_DEVICE: 'tpu' } });
        await expect(handle.client.health()).rejects.toThrow(/unsupported VOXCPM_DEVICE "tpu"/);
        await handle.close();
    });

    it('rejects unsupported controls and ignores a per-request instruct on a reference profile', async () => {
        const dir = makeDir();
        const registry = join(dir, 'profiles.json');
        writeFileSync(
            registry,
            JSON.stringify({
                profiles: [
                    { id: 'instruct', name: 'instruct', mode: 'instruct', instruct: 'calm' },
                    { id: 'ref', name: 'ref', mode: 'reference', reference_wav_path: './ref.wav' },
                ],
            }),
        );
        writeFileSync(join(dir, 'ref.wav'), 'x');
        const handle = client('ok', { env: { VOXCPM_PROFILES_PATH: registry } });
        await handle.client.health();
        await expect(handle.client.generate(body('instruct', { engine: 'qwen' }))).rejects.toThrow(/engine/);
        await expect(handle.client.generate(body('instruct', { personality: true }))).rejects.toThrow(/personality/);
        await expect(handle.client.generate(body('instruct', { effects_chain: [{ type: 'reverb' }] }))).rejects.toThrow(
            /effects_chain/,
        );
        await expect(handle.client.generate(body('missing'))).rejects.toThrow(/unknown voice profile/);
        // The daily pipeline sends a per-request instruct for every segment (its `emotion`); a
        // reference profile ignores it instead of failing the tier. Last: a resolve leaves the
        // request in flight, and the client allows only one at a time.
        await expect(handle.client.generate(body('ref', { instruct: 'nope' }))).resolves.toBeDefined();
        await handle.close();
    });

    it('refuses a second segment on an instruct profile instead of changing voice', async () => {
        const handle = client('ok');
        await handle.client.health();
        const first = await handle.client.generate(body());
        await handle.client.waitUntilDone(first.id, 5000);
        await expect(handle.client.generate(body())).rejects.toThrow(/pins no speaker/);
        await handle.close();
    });
});

describe('createVoxCpmClient protocol + lifecycle', () => {
    it('round-trips health + render and derives duration from the validated WAV', async () => {
        const handle = client('ok');
        await handle.client.health();
        await handle.client.health(); // repeated health never reloads
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

    it('is terminal on an unexpected response id', async () => {
        const handle = client('wrong-id');
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await expect(handle.client.waitUntilDone(id, 5000)).rejects.toThrow(/unknown or duplicate id/);
        await handle.close();
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

describe('voxcpm-tts worker command + registry/file guards', () => {
    it('resolveVoxCpmWorkerCommand builds the locked uv argv (no shell)', () => {
        expect(resolveVoxCpmWorkerCommand('/opt/plugin')).toEqual([
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
        expect(() => parseVoxCpmRegistry({ profiles: [42] }, '/tmp')).toThrow(/not an object/);
        expect(() => parseVoxCpmRegistry({ profiles: [{ mode: 'instruct', instruct: 'x' }] }, '/tmp')).toThrow(
            /nonempty id and name/,
        );
        expect(() =>
            parseVoxCpmRegistry(
                { profiles: [{ id: 'a', name: 'a', mode: 'reference', reference_wav_path: '' }] },
                '/tmp',
            ),
        ).toThrow(/nonempty string/);
    });

    it('reports a missing or invalid-JSON registry file', async () => {
        const missing = client('ok', { env: { VOXCPM_PROFILES_PATH: join(makeDir(), 'nope.json') } });
        await expect(missing.client.resolveProfile('robin-news')).rejects.toThrow(/registry not found/);
        await missing.close();

        const badPath = join(makeDir(), 'profiles.json');
        writeFileSync(badPath, '{ not json');
        const bad = client('ok', { env: { VOXCPM_PROFILES_PATH: badPath } });
        await expect(bad.client.resolveProfile('robin-news')).rejects.toThrow(/not valid JSON/);
        await bad.close();
    });
});

describe('voxcpm-tts worker failure surfaces', () => {
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

describe('voxcpm-tts teardown escalation + framing bound (review findings 1-2)', () => {
    it('force-kills a descendant that ignores SIGTERM (R4 unconditional escalation)', async () => {
        const pidFile = join(makeDir(), 'stubborn.pid');
        const handle = client('stubborn', { env: { FAKE_CHILD_PID_FILE: pidFile } });
        await handle.client.health();
        const { id } = await handle.client.generate(body());
        await handle.client.waitUntilDone(id, 10_000);
        await handle.client.downloadAudio(id);
        const childPid = Number((await Bun.file(pidFile).text()).trim());
        expect(childPid).toBeGreaterThan(0);
        expect(isAlive(childPid)).toBe(true); // ignores the group SIGTERM
        await handle.close(); // must escalate based on group survival, not the direct child
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

    it('surfaces worker stderr tail and exit code when stdout closes on crash (R4)', async () => {
        const handle = client('crash-stderr');
        await expect(handle.client.health()).rejects.toThrow(/RuntimeError: Metal OOM/);
        await handle.close();
    });
});
