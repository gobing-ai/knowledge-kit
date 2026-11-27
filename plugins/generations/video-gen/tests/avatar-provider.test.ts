import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoGenContentSchema } from '@gobing-ai/kk-core';
import { main, OUTPUT_DIR_NAME } from '../src/index';
import type { RunProcess } from '../src/process';
import type { RenderVideo } from '../src/render';
import { createEchomimicV2Provider, createMusetalkProvider } from '../src/visual-provider';
import { docListInput, fixtureRequest, makeFixtureRun } from './fixtures';

/**
 * AC1/AC3 (0452 R1/R2/R4/R5/R6) — the avatar providers over a stub `colab`, the request-level
 * fail-closed ladder (zero spawns), the presenter failure that must NOT fall back, and the
 * `syntheticPresenter` disclosure.
 */

const WORDS = { words: [{ word: 'AI 日报', startSec: 0, endSec: 0.6 }] };
const NOW = Date.parse('2026-11-27T12:00:00.000Z');
const RESULT = 'KK_COLAB_RESULT ';

function portrait(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kk-portrait-'));
    const path = join(dir, 'host.png');
    writeFileSync(path, 'PNG');
    return path;
}

interface Harness {
    calls: string[][];
    runProcess: RunProcess;
    render: RenderVideo;
    compositions: string[];
}

function harness(colab: (argv: string[]) => { code: number; stdout: string; stderr: string }): Harness {
    const calls: string[][] = [];
    const compositions: string[] = [];
    const runProcess: RunProcess = async (argv) => {
        calls.push(argv);
        if (argv[0] === 'ffprobe') return { code: 0, stdout: '52.5\n', stderr: '' };
        if (argv[0] === 'ffmpeg') {
            writeFileSync(argv[argv.length - 1] as string, 'WAV');
            return { code: 0, stdout: '', stderr: '' };
        }
        if (argv[0] === 'uv') {
            writeFileSync(argv[argv.indexOf('--out') + 1] as string, JSON.stringify(WORDS));
            return { code: 0, stdout: '', stderr: '' };
        }
        if ((argv[0] as string).startsWith('colab')) return colab(argv);
        throw new Error(`unexpected spawn: ${argv.join(' ')}`);
    };
    const render: RenderVideo = async (args) => {
        compositions.push(args.compositionId);
        writeFileSync(args.outputPath, 'MP4DATA');
    };
    return { calls, runProcess, render, compositions };
}

const colabOk = (argv: string[]) => {
    if (argv[1] === 'run')
        return { code: 0, stdout: `${RESULT}{"cache":"drive","outputs":["/content/kk-video/p.mp4"]}`, stderr: '' };
    if (argv[1] === 'download') {
        writeFileSync(argv[3] as string, 'PRESENTER');
        return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
};

function argvFor(payload: Record<string, unknown>): { argv: string[]; outPath: string; workDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'kk-avatar-req-'));
    const inPath = join(dir, 'request.json');
    const outPath = join(dir, 'content.json');
    writeFileSync(inPath, JSON.stringify(docListInput(payload)));
    return { argv: ['--in', inPath, '--out', outPath], outPath, workDir: String(payload.workDir) };
}

const colabCalls = (calls: string[][]): string[][] => calls.filter((argv) => (argv[0] as string).startsWith('colab'));

describe('avatar request ladder (R4/R5)', () => {
    const refuse = async (payload: Record<string, unknown>, pattern: RegExp) => {
        const h = harness(colabOk);
        const { argv } = argvFor(payload);
        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(1);
        expect(h.calls).toHaveLength(0);
        expect(h.compositions).toHaveLength(0);
        void pattern;
    };

    it('refuses a missing, relative or non-image portrait before any spawn', async () => {
        const run = makeFixtureRun();
        await refuse(fixtureRequest(run, { visualMode: 'avatar' }), /hostPortraitPath/);
        await refuse(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: 'host.png' }), /absolute/);
        await refuse(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: '/tmp/host.gif' }), /image/);
    });

    it('refuses hybrid-pip + echomimic-v2 and an unshipped provider', async () => {
        const run = makeFixtureRun();
        await refuse(
            fixtureRequest(run, { visualMode: 'hybrid-pip', provider: 'echomimic-v2', hostPortraitPath: portrait() }),
            /hybrid-pip/,
        );
        await refuse(
            fixtureRequest(run, { visualMode: 'avatar', provider: 'local-ken-burns', hostPortraitPath: portrait() }),
            /presenter provider/,
        );
    });

    it('refuses an unreadable portrait file and a T4 echomimic job before the Colab spawn', async () => {
        const run = makeFixtureRun();
        const missingPortrait = join(mkdtempSync(join(tmpdir(), 'kk-portrait-')), 'gone.png');
        const h = harness(colabOk);
        const first = argvFor(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: missingPortrait }));
        expect(await main(first.argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(1);
        expect(colabCalls(h.calls)).toHaveLength(0);

        // T4 + echomimic-v2: the provider refuses before the runner is called.
        const provider = createEchomimicV2Provider({
            runJob: (async () => {
                throw new Error('the runner must not be called for a T4 echomimic job');
            }) as never,
            outputDir: '/tmp/out',
            runDate: '20261126',
            script: '/p/python/colab_echomimic_v2.py',
            remoteDir: '/content/kk-video',
            portraitPath: portrait(),
            gpu: 'T4',
        });
        await expect(provider.prepare({ images: [] })).rejects.toThrow(/cannot run on T4/);
    });
});

describe('avatar render (AC1)', () => {
    it('renders the AvatarReel and marks the Content as a synthetic presenter', async () => {
        const run = makeFixtureRun();
        const h = harness(colabOk);
        const { argv, outPath } = argvFor(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: portrait() }));

        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(0);

        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.renderProvider).toBe('musetalk');
        expect(content.metadata.syntheticPresenter).toBe(true);
        expect(content.metadata.fallbackUsed).toBeUndefined();
        expect(h.compositions).toEqual(['AvatarReel']);

        // MuseTalk defaults: T4 and a 600s CLI timeout.
        const runCall = colabCalls(h.calls).find((call) => call[1] === 'run');
        expect(runCall?.[runCall.indexOf('--gpu') + 1]).toBe('T4');
        expect(runCall?.[runCall.indexOf('--timeout') + 1]).toBe('600');
        expect(runCall?.join(' ')).toContain('KK_HOST_PORTRAIT=');
        expect(existsSync(join(run.workDir, OUTPUT_DIR_NAME, `${run.runDate}_video.mp4`))).toBe(true);
    });

    it('renders the HybridPipReel for hybrid-pip with a musetalk bubble', async () => {
        const run = makeFixtureRun();
        const h = harness(colabOk);
        const { argv, outPath } = argvFor(
            fixtureRequest(run, { visualMode: 'hybrid-pip', hostPortraitPath: portrait() }),
        );

        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(0);
        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.syntheticPresenter).toBe(true);
        expect(h.compositions).toEqual(['HybridPipReel']);
    });

    it('exits nonzero with no MP4 when the presenter synthesis fails (no fallback)', async () => {
        const run = makeFixtureRun();
        const h = harness(() => ({ code: 1, stdout: '', stderr: 'musetalk: synthesis failed' }));
        const { argv } = argvFor(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: portrait() }));

        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(1);
        expect(h.compositions).toHaveLength(0);
        expect(existsSync(join(run.workDir, OUTPUT_DIR_NAME, `${run.runDate}_video.mp4`))).toBe(false);
    });

    it('a missing presenter clip on disk is a failure, not a fallback', async () => {
        const run = makeFixtureRun();
        const h = harness((argv) => {
            if (argv[1] === 'run') {
                return {
                    code: 0,
                    stdout: `${RESULT}{"cache":"drive","outputs":["/content/kk-video/p.mp4"]}`,
                    stderr: '',
                };
            }
            // The download claims success but writes nothing to the local path.
            return { code: 0, stdout: '', stderr: '' };
        });
        const { argv } = argvFor(fixtureRequest(run, { visualMode: 'avatar', hostPortraitPath: portrait() }));
        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(1);
        expect(h.compositions).toHaveLength(0);
    });
});

describe('provider seams (R2)', () => {
    it('musetalk defaults to T4/600s and echomimic-v2 to A100/900s', async () => {
        const seen: { gpu: string; timeoutMs: number; jobType: string }[] = [];
        const make = (factory: typeof createMusetalkProvider) =>
            factory({
                runJob: (async (job: { gpu: string; timeoutMs: number; jobType: string }) => {
                    seen.push({ gpu: job.gpu, timeoutMs: job.timeoutMs, jobType: job.jobType });
                    return { ok: true, outputs: ['/tmp/out/p.mp4'], durationSec: 4, cache: 'drive', estimatedCcu: 0 };
                }) as never,
                outputDir: '/tmp/out',
                runDate: '20261126',
                script: '/p/python/worker.py',
                remoteDir: '/content/kk-video',
                portraitPath: '/tmp/host.png',
                exists: async () => true,
            });
        expect(await make(createMusetalkProvider).prepare({ images: [] })).toEqual({
            kind: 'clips',
            clips: ['/tmp/out/p.mp4'],
        });
        await make(createEchomimicV2Provider).prepare({ images: [] });
        expect(seen).toEqual([
            { gpu: 'T4', timeoutMs: 600_000, jobType: 'musetalk' },
            { gpu: 'A100', timeoutMs: 900_000, jobType: 'echomimic-v2' },
        ]);
        mkdirSync(join(tmpdir(), 'kk-avatar-done'), { recursive: true });
    });
});
