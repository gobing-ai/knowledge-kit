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
    dir = mkdtempSync(join(tmpdir(), 'vibe-voice-tts-'));
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

async function expectDead(pid: number, timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (isAlive(pid) && Date.now() - start < timeoutMs) {
        await Bun.sleep(25);
    }
    expect(isAlive(pid)).toBe(false);
}

const clientOptions = (mode: string, profiles: string = SHIPPED_PROFILES, extraEnv: Record<string, string> = {}) => ({
    workerCommand: ['bun', FAKE, mode],
    env: {
        ...process.env,
        VIBEVOICE_DEVICE: 'cpu',
        VIBEVOICE_PROFILES_PATH: profiles,
        ...extraEnv,
    } as Record<string, string | undefined>,
});

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

describe('vibe-voice-tts entry (R1)', () => {
    it('renders plain text into audio Content with kk:vibe-voice-tts provenance and a 24 kHz WAV', async () => {
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([plainDoc()]), '--out', out], clientOptions('ok'));
        expect(code).toBe(0);
        const content = readContent(out);
        expect(content.format).toBe('audio');
        expect(content.metadata?.generator).toBe('kk:vibe-voice-tts');
        expect(content.metadata?.audioPath).toBe(join(dir, 'content.wav'));
        expect(existsSync(join(dir, 'content.wav'))).toBe(true);
        const wav = parseWav(new Uint8Array(readFileSync(join(dir, 'content.wav'))));
        expect(wav.sampleRate).toBe(24_000);
        expect(wav.numChannels).toBe(1);
        const qc = content.metadata?.qc as { passed: boolean };
        expect(qc.passed).toBe(true);
        expect(stdout.text()).not.toContain('"wav_path"');
        expect(stdout.text()).not.toContain('"op"');
    });

    it('renders a multi-segment VoiceScript with gaps and speed on an anchored reference profile', async () => {
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

describe('vibe-voice-tts entry (R5)', () => {
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
        expect(stderr.text()).toContain('vibe-voice-tts failed');
    });

    it('fails actionably when a worker fails mid-render and writes no output', async () => {
        const out = join(dir, 'content.json');
        const code = await main(['--in', writeDocs([plainDoc()]), '--out', out], clientOptions('crash-stderr'));
        expect(code).toBe(1);
        expect(existsSync(out)).toBe(false);
        expect(stderr.text()).toContain('vibe-voice-tts failed');
    });

    it('rejects missing --in/--out', async () => {
        expect(await main([], clientOptions('ok'))).toBe(1);
        expect(stderr.text()).toContain('Missing required arguments');
    });
});

describe('vibe-voice-tts entry (R4/R6)', () => {
    it('reaps an owned descendant when run through the direct entry', async () => {
        const pidFile = join(dir, 'child.pid');
        const options = clientOptions('descendant', SHIPPED_PROFILES, { FAKE_CHILD_PID_FILE: pidFile });
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
        process.env.VIBEVOICE_DEVICE = 'cpu';
        process.env.VIBEVOICE_PROFILES_PATH = SHIPPED_PROFILES;
        process.env.FAKE_CHILD_PID_FILE = pidFile;

        const out = join(dir, 'content.json');
        const result = spawnPluginEntry({
            entryPath: ENTRY,
            cwd: dir,
            inPath: writeDocs([plainDoc()]),
            outPath: out,
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(readContent(out).metadata?.generator).toBe('kk:vibe-voice-tts');
        const childPid = Number(readFileSync(pidFile, 'utf-8').trim());
        expect(childPid).toBeGreaterThan(0);
        await expectDead(childPid);
    });

    it('renders multiple sections in --batch and VIBEVOICE_BATCH_MANIFEST modes and reports batch errors', async () => {
        const profiles = anchoredRegistry();
        const in1 = join(dir, 'sec1_in.json');
        const out1 = join(dir, 'sec1.json');
        const in2 = join(dir, 'sec2_in.json');
        const out2 = join(dir, 'sec2.json');
        writeFileSync(in1, JSON.stringify([{ ...plainDoc(), id: 's1' }]));
        writeFileSync(in2, JSON.stringify([{ ...plainDoc(), id: 's2' }]));
        const manifest = join(dir, 'batch.json');
        writeFileSync(
            manifest,
            JSON.stringify([
                { in: in1, out: out1 },
                { in: in2, out: out2 },
            ]),
        );

        const code = await main(['--batch', manifest], clientOptions('ok', profiles));
        expect(code).toBe(0);
        expect(readContent(out1).metadata?.generator).toBe('kk:vibe-voice-tts');
        expect(readContent(out2).metadata?.generator).toBe('kk:vibe-voice-tts');
        expect(existsSync(join(dir, 'sec1.wav'))).toBe(true);
        expect(existsSync(join(dir, 'sec2.wav'))).toBe(true);

        const out3 = join(dir, 'sec3.json');
        const manifest2 = join(dir, 'batch2.json');
        writeFileSync(manifest2, JSON.stringify([{ in: in1, out: out3 }]));
        const envCode = await main([], clientOptions('ok', profiles, { VIBEVOICE_BATCH_MANIFEST: manifest2 }));
        expect(envCode).toBe(0);
        expect(readContent(out3).metadata?.generator).toBe('kk:vibe-voice-tts');

        const crashCode = await main(['--batch', manifest2], clientOptions('crash', profiles));
        expect(crashCode).toBe(1);

        const badManifest = join(dir, 'bad-batch.json');
        writeFileSync(badManifest, JSON.stringify({ nope: true }));
        expect(await main(['--batch', badManifest], clientOptions('ok', profiles))).toBe(1);
        expect(stderr.text()).toContain('invalid batch manifest');
    });

    it('runs its bundled dist entry and copied assets cleanly outside the repo checkout (R4)', async () => {
        const pluginRoot = new URL('..', import.meta.url).pathname;
        const outsidePlugin = join(dir, 'isolated-plugin');
        const distOut = join(outsidePlugin, 'dist');
        mkdirSync(join(outsidePlugin, 'python'), { recursive: true });

        const bundle = Bun.spawnSync(['bun', 'build', ENTRY, '--outdir', distOut, '--target', 'bun'], {
            encoding: 'utf-8',
        });
        expect(bundle.exitCode, bundle.stderr).toBe(0);

        for (const rel of ['python/worker.py', 'pyproject.toml', 'uv.toml', 'profiles.json']) {
            writeFileSync(join(outsidePlugin, rel), readFileSync(join(pluginRoot, rel)));
        }
        writeFileSync(
            join(outsidePlugin, 'plugin.json'),
            JSON.stringify({ name: 'vibe-voice-tts', kind: 'generator', entry: './dist/index.js', version: '1.0.0' }),
        );

        const shimDir = join(dir, 'shim-outside');
        const workDir = join(dir, 'outside-cwd');
        mkdirSync(shimDir, { recursive: true });
        mkdirSync(workDir, { recursive: true });
        const uvShim = join(shimDir, 'uv');
        writeFileSync(uvShim, `#!/bin/sh\nexec bun ${FAKE} ok\n`);
        chmodSync(uvShim, 0o755);

        const inFile = writeDocs([plainDoc()]);
        const outFile = join(workDir, 'content.json');
        const run = Bun.spawnSync(['bun', join(distOut, 'index.js'), '--in', inFile, '--out', outFile], {
            cwd: workDir,
            env: {
                ...process.env,
                PATH: `${shimDir}:${process.env.PATH ?? ''}`,
                VIBEVOICE_DEVICE: 'cpu',
            },
            encoding: 'utf-8',
        });
        expect(run.exitCode, run.stderr).toBe(0);
        expect(readContent(outFile).metadata?.generator).toBe('kk:vibe-voice-tts');
    });
});
