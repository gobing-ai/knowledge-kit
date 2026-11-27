import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoGenContentSchema } from '@gobing-ai/kk-core';
import { main, OUTPUT_DIR_NAME } from '../src/index';
import type { RunProcess } from '../src/process';
import type { RenderVideo } from '../src/render';
import { docListInput, fixtureRequest, makeFixtureRun } from './fixtures';

/**
 * AC4 (R5) + AC5 (R6) — the end-to-end plugin path with an injected process runner and renderer:
 * a successful editorial render spawns no `colab`, and every invalid input exits nonzero before an
 * expensive spawn is recorded.
 */

const WORDS = {
    words: [
        { word: 'OpenAI', startSec: 0, endSec: 0.4 },
        { word: '发布', startSec: 0.4, endSec: 0.9 },
        { word: '新一代推理模型。', startSec: 0.9, endSec: 1.6 },
    ],
};

interface Harness {
    calls: string[][];
    runProcess: RunProcess;
    render: RenderVideo;
    renderCalls: Parameters<RenderVideo>[0][];
}

/** Fake runner: answers ffprobe, writes the sliced wav, writes the caption track. */
function harness(
    options: { duration?: string; ffmpegCode?: number; uvCode?: number; renderError?: Error } = {},
): Harness {
    const calls: string[][] = [];
    const renderCalls: Parameters<RenderVideo>[0][] = [];
    const runProcess: RunProcess = async (argv) => {
        calls.push(argv);
        if (argv[0] === 'ffprobe') return { code: 0, stdout: `${options.duration ?? '52.5'}\n`, stderr: '' };
        if (argv[0] === 'ffmpeg') {
            if (options.ffmpegCode !== undefined && options.ffmpegCode !== 0) {
                return { code: options.ffmpegCode, stdout: '', stderr: 'Invalid data found when processing input' };
            }
            writeFileSync(argv[argv.length - 1] as string, 'WAV');
            return { code: 0, stdout: '', stderr: '' };
        }
        if (argv[0] === 'uv') {
            if (options.uvCode !== undefined && options.uvCode !== 0) {
                return { code: options.uvCode, stdout: '', stderr: 'no model cache' };
            }
            writeFileSync(argv[argv.indexOf('--out') + 1] as string, JSON.stringify(WORDS));
            return { code: 0, stdout: '', stderr: '' };
        }
        throw new Error(`unexpected spawn: ${argv.join(' ')}`);
    };
    const render: RenderVideo = async (args) => {
        renderCalls.push(args);
        if (options.renderError) throw options.renderError;
        writeFileSync(args.outputPath, 'MP4DATA');
    };
    return { calls, runProcess, render, renderCalls };
}

/** Materialise a request file and return the argv the plugin entry would receive. */
function argvFor(payload: Record<string, unknown>): { argv: string[]; outPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'kk-video-req-'));
    const inPath = join(dir, 'request.json');
    const outPath = join(dir, 'content.json');
    writeFileSync(inPath, JSON.stringify(docListInput(payload)));
    return { argv: ['--in', inPath, '--out', outPath], outPath };
}

const expensiveSpawns = (calls: string[][]): string[] =>
    calls.map((argv) => argv[0] as string).filter((program) => program !== 'ffprobe');

describe('video-gen happy path', () => {
    it('renders the teaser, emits a valid video Content and spawns no colab', async () => {
        const run = makeFixtureRun({ withCards: true });
        const { argv, outPath } = argvFor(fixtureRequest(run));
        const h = harness();

        expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(0);

        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.title).toBe('AI 日报 1126');
        expect(content.body).toContain('OpenAI 发布新一代推理模型');
        expect(content.metadata.renderProvider).toBe('local-ken-burns');
        expect(content.metadata.visualMode).toBe('editorial');
        expect(content.metadata.durationSec).toBe(52.5);
        expect(content.metadata.videoPath.endsWith(`_video.mp4`)).toBe(true);
        expect(content.metadata.coverPath).toBe(run.coverPath);
        expect(content.metadata.captionsPath?.endsWith('_words.json')).toBe(true);
        expect(content.metadata.tags).toEqual(['ai', 'daily']);

        // R5 (AC4): 100% local — nothing named colab, and the provider is the local Ken-Burns one.
        expect(h.calls.some((call) => call.some((token) => token.includes('colab')))).toBe(false);
        expect(h.calls.map((call) => call[0])).toEqual(['ffprobe', 'ffmpeg', 'uv']);
        expect(h.renderCalls).toHaveLength(1);
        const renderArgs = h.renderCalls[0];
        expect(renderArgs?.props.images).toEqual(['still-0.png', 'still-1.png']);
        expect(renderArgs?.props.durationSec).toBe(52.5);

        const outputDir = join(run.workDir, OUTPUT_DIR_NAME);
        for (const name of ['_hook.wav', '_words.json', '_video.mp4']) {
            expect(existsSync(join(outputDir, `${run.runDate}${name}`))).toBe(true);
        }
        expect(existsSync(join(outputDir, 'public', 'teaser.wav'))).toBe(true);
    });

    it('honours an explicit 45–60s hook window', async () => {
        const run = makeFixtureRun();
        const { argv, outPath } = argvFor(fixtureRequest(run, { hook: { startSec: 5, endSec: 55 } }));
        const h = harness({ duration: '900' });

        expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(0);
        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.durationSec).toBe(50);
        const ffmpeg = h.calls.find((call) => call[0] === 'ffmpeg');
        expect(ffmpeg?.[ffmpeg.indexOf('-ss') + 1]).toBe('5');
    });
});

describe('video-gen fails closed', () => {
    const expectRefusal = async (payload: Record<string, unknown>, pattern: RegExp, h = harness()) => {
        const { argv, outPath } = argvFor(payload);
        expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(1);
        expect(existsSync(outPath)).toBe(false);
        expect(h.calls).toHaveLength(0);
        expect(h.renderCalls).toHaveLength(0);
        return pattern;
    };

    it('refuses an unshipped visual mode or a malformed request with zero spawns', async () => {
        const run = makeFixtureRun();
        await expectRefusal(fixtureRequest(run, { visualMode: 'avatar' }), /not shipped yet/);
        await expectRefusal(fixtureRequest(run, { runDate: 'today' }), /runDate/);
    });

    it('refuses missing audio, a missing cover and a missing plan with zero spawns', async () => {
        const noAudio = makeFixtureRun({ withPrepContent: false });
        await expectRefusal(fixtureRequest(noAudio), /no episode audio recorded/);
        const noCover = makeFixtureRun({ withCover: false });
        await expectRefusal(fixtureRequest(noCover), /cover artwork not found/);
        const noPlan = makeFixtureRun({ withPlan: false });
        await expectRefusal(fixtureRequest(noPlan), /script plan not found/);
    });

    it('refuses a hook window outside 45–60s before ffmpeg, uv or Chromium', async () => {
        const run = makeFixtureRun();
        const h = harness();
        const { argv, outPath } = argvFor(fixtureRequest(run, { hook: { startSec: 0, endSec: 30 } }));
        expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(1);
        expect(existsSync(outPath)).toBe(false);
        expect(expensiveSpawns(h.calls)).toEqual([]);
        expect(h.renderCalls).toHaveLength(0);
    });

    it('refuses an episode shorter than the teaser minimum', async () => {
        const run = makeFixtureRun();
        const h = harness({ duration: '40' });
        const { argv } = argvFor(fixtureRequest(run));
        expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(1);
        expect(expensiveSpawns(h.calls)).toEqual([]);
    });

    it('reports an ffmpeg, worker or renderer failure as a nonzero exit', async () => {
        const run = makeFixtureRun();
        for (const h of [
            harness({ ffmpegCode: 2 }),
            harness({ uvCode: 1 }),
            harness({ renderError: new Error('chromium died') }),
        ]) {
            const { argv, outPath } = argvFor(fixtureRequest(run));
            expect(await main(argv, { runProcess: h.runProcess, render: h.render })).toBe(1);
            expect(existsSync(outPath)).toBe(false);
        }
    });

    it('requires both --in and --out', async () => {
        const h = harness();
        expect(await main([], { runProcess: h.runProcess, render: h.render })).toBe(1);
        const { argv } = argvFor({});
        expect(await main([argv[0] as string, argv[1] as string], { runProcess: h.runProcess, render: h.render })).toBe(
            1,
        );
        expect(h.calls).toHaveLength(0);
    });
});
