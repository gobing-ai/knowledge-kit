import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { parseWav } from '@gobing-ai/voice-gen';
import { spawnPluginEntry } from '../../../../apps/cli/src/invoke';
import { main } from '../src/index';

const FAKE = new URL('./fake-worker.ts', import.meta.url).pathname;
const ENTRY = new URL('../src/index.ts', import.meta.url).pathname;
const SHIPPED_PROFILES = new URL('../profiles.json', import.meta.url).pathname;

let dir: string;
let stdout: ReturnType<typeof createBufferTarget>;
let stderr: ReturnType<typeof createBufferTarget>;
let restoreOutput: () => void;
let savedEnv: NodeJS.ProcessEnv;

/**
 * voice-gen / voicebox knobs `processGeneratorIO` reads from the ambient environment. A sibling
 * test file leaks one into the shared `bun test` process (voice-gen's budget test sets
 * `VOICE_GEN_MAX_RUN_MS=1` as the last test of its describe with no restore), which flips this
 * entry's exit code on any multi-segment render. Clear them per test so this file is hermetic.
 */
const AMBIENT_VOICE_KNOBS = [
    'VOICE_GEN_MAX_RUN_MS',
    'VOICE_GEN_FAIL_ON_QC',
    'VOICE_GEN_MP3',
    'VOICEBOX_DEFAULT_PROFILE',
    'VOICEBOX_ENGINE',
    'VOICEBOX_MAX_CHUNK_CHARS',
    'VOICEBOX_CROSSFADE_MS',
    'VOICEBOX_TIMEOUT_MS',
    'VOICEBOX_POLL_MS',
    'VOICEBOX_MAX_VERIFY_ATTEMPTS',
];

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxcpm-tts-'));
    stdout = createBufferTarget();
    stderr = createBufferTarget();
    restoreOutput = setDefaultOutputTargets({ stdout, stderr });
    savedEnv = { ...process.env };
    for (const key of AMBIENT_VOICE_KNOBS) {
        delete process.env[key];
    }
});
afterEach(() => {
    restoreOutput();
    process.env = savedEnv;
    rmSync(dir, { recursive: true, force: true });
});

function writeDocs(docs: Doc[]): string {
    const path = join(dir, 'docs.json');
    writeFileSync(path, JSON.stringify(docs));
    return path;
}

function plainDoc(): Doc {
    return {
        id: 'd1',
        sourceUri: 'https://example.com/plain',
        title: 'Daily',
        body: '你好世界。这是一条新闻播报。',
        metadata: { voiceProfile: 'robin-news' },
    };
}

function scriptDoc(): Doc {
    return {
        id: 'd2',
        sourceUri: 'https://example.com/script',
        title: 'Daily',
        body: 'title: "Daily"\ndefault_profile: robin-news\nsegments:\n  - text: "第一段新闻内容"\n    gap_ms: 500\n  - text: "第二段新闻内容"\n    speed: 1.5\n',
    };
}

function readContent(path: string) {
    return ContentSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Assert the process is gone within a bounded window. SIGTERM delivery + reaping is asynchronous
 * at the kernel level, so an immediate `isAlive` check races the OS; a 2 s bound proves the child
 * dies while this test process is still alive (it cannot hide a leak that only clears on exit).
 */
async function expectDead(pid: number, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (isAlive(pid) && Date.now() - start < timeoutMs) {
        await Bun.sleep(25);
    }
    expect(isAlive(pid)).toBe(false);
}

const clientOptions = (mode: string, profiles: string = SHIPPED_PROFILES) => ({
    workerCommand: ['bun', FAKE, mode],
    env: { ...process.env, VOXCPM_DEVICE: 'cpu', VOXCPM_PROFILES_PATH: profiles } as Record<string, string | undefined>,
});

/**
 * Registry that pins a speaker, which the shipped instruct placeholder deliberately does not: the
 * adapter refuses a second segment on an instruct profile, so multi-segment work needs this.
 */
function anchoredRegistry(): string {
    writeFileSync(join(dir, 'ref.wav'), 'x');
    const path = join(dir, 'anchored.json');
    writeFileSync(
        path,
        JSON.stringify({
            profiles: [
                { id: 'robin-news', name: 'robin-news', mode: 'reference', reference_wav_path: join(dir, 'ref.wav') },
            ],
        }),
    );
    return path;
}

describe('voxcpm-tts entry (AC1)', () => {
    it('renders plain text into audio Content with kk:voxcpm-tts provenance and a native-rate WAV', async () => {
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([plainDoc()]), '--out', out], clientOptions('ok'));
        expect(code).toBe(0);
        const content = readContent(out);
        expect(content.format).toBe('audio');
        expect(content.metadata?.generator).toBe('kk:voxcpm-tts');
        expect(content.metadata?.audioPath).toBe(join(dir, 'content.wav'));
        expect(existsSync(join(dir, 'content.wav'))).toBe(true);
        const wav = parseWav(new Uint8Array(readFileSync(join(dir, 'content.wav'))));
        expect(wav.sampleRate).toBe(48_000); // native rate, never relabelled to 24 kHz
        expect(wav.numChannels).toBe(1);
        const qc = content.metadata?.qc as { passed: boolean };
        expect(qc.passed).toBe(true);
        // The protocol frames never leak onto the plugin's stdout.
        expect(stdout.text()).not.toContain('"wav_path"');
        expect(stdout.text()).not.toContain('"op"');
    });

    it('renders a multi-segment VoiceScript with gaps and speed', async () => {
        const out = join(dir, 'content.json');
        const code = await main(
            ['--in', writeDocs([scriptDoc()]), '--out', out],
            clientOptions('ok', anchoredRegistry()),
        );
        expect(code).toBe(0);
        const content = readContent(out);
        const segments = content.metadata?.segments as { duration: number; speed?: number }[];
        expect(segments).toHaveLength(2);
        expect(segments[1]?.speed).toBe(1.5);
        // total = seg1(1s) + gap(0.5s) + seg2(1s/1.5)
        expect(content.metadata?.duration as number).toBeCloseTo(1 + 0.5 + 1 / 1.5, 5);
    });

    it('publishes a requested MP3 sibling', async () => {
        process.env.VOICE_GEN_MP3 = 'true';
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([plainDoc()]), '--out', out], clientOptions('ok'));
        expect(code).toBe(0);
        expect(existsSync(join(dir, 'content.mp3'))).toBe(true);
        expect(readContent(out).metadata?.mp3Path).toBe(join(dir, 'content.mp3'));
    });
});

describe('voxcpm-tts entry (AC3)', () => {
    it('writes the notice Content for empty Doc[] without starting a worker', async () => {
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([]), '--out', out], clientOptions('crash'));
        expect(code).toBe(0);
        expect(readContent(out).title).toBe('Notice');
    });

    it('fails actionably on a malformed DocList and writes no output', async () => {
        const input = join(dir, 'docs.json');
        writeFileSync(input, '{ not a doc list');
        const out = join(dir, 'content.json');
        const code = await main(['--in', input, '--out', out], clientOptions('ok'));
        expect(code).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(stderr.text()).toContain('voxcpm-tts failed');
    });

    it('rejects missing --in/--out', async () => {
        expect(await main([], clientOptions('ok'))).toBe(1);
        expect(stderr.text()).toContain('Missing required arguments');
    });
});

describe('voxcpm-tts entry (AC4)', () => {
    it('reaps an owned descendant when run through the direct entry', async () => {
        const pidFile = join(dir, 'child.pid');
        const options = clientOptions('descendant');
        options.env = { ...options.env, FAKE_CHILD_PID_FILE: pidFile };
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([plainDoc()]), '--out', out], options);
        expect(code).toBe(0);
        const childPid = Number(readFileSync(pidFile, 'utf-8').trim());
        expect(childPid).toBeGreaterThan(0);
        await expectDead(childPid);
    });

    it('reaps an owned descendant through the synchronous executor with a fake uv shim', async () => {
        const shimDir = join(dir, 'shim');
        mkdirSync(shimDir, { recursive: true });
        const uvShim = join(shimDir, 'uv');
        writeFileSync(uvShim, `#!/bin/sh\nexec bun ${FAKE} descendant\n`);
        chmodSync(uvShim, 0o755);
        const pidFile = join(dir, 'child.pid');
        process.env.PATH = `${shimDir}:${process.env.PATH}`;
        process.env.VOXCPM_DEVICE = 'cpu';
        process.env.VOXCPM_PROFILES_PATH = SHIPPED_PROFILES;
        process.env.FAKE_CHILD_PID_FILE = pidFile;

        const out = join(dir, 'content.json');
        const result = spawnPluginEntry({
            entryPath: ENTRY,
            cwd: dir,
            inPath: writeDocs([plainDoc()]),
            outPath: out,
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(readContent(out).metadata?.generator).toBe('kk:voxcpm-tts');
        const childPid = Number(readFileSync(pidFile, 'utf-8').trim());
        expect(childPid).toBeGreaterThan(0);
        await expectDead(childPid);
    });
});
