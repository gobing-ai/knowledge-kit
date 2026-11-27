import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoGenContentSchema } from '@gobing-ai/kk-core';
import { resolveLedgerPath } from '../src/ccu-ledger';
import { main, OUTPUT_DIR_NAME } from '../src/index';
import type { RunProcess } from '../src/process';
import type { RenderVideo } from '../src/render';
import { createWan21Provider, prepareVisualLayer } from '../src/visual-provider';
import { fixtureRequest, makeFixtureRun } from './fixtures';

/**
 * AC1 (R3/R5) — every Colab failure mode falls back to the local Ken-Burns reel: the run still exits
 * 0, the Content names the cause, and a budget refusal never spawns `colab` at all.
 */

const WORDS = { words: [{ word: 'AI 日报', startSec: 0, endSec: 0.6 }] };
const NOW = Date.parse('2026-11-27T12:00:00.000Z');

interface Harness {
    calls: string[][];
    runProcess: RunProcess;
    render: RenderVideo;
    renders: number;
}

/** Fake runner: real ffprobe/ffmpeg/uv answers plus a scripted `colab` behaviour. */
function harness(colab: (argv: string[]) => { code: number; stdout: string; stderr: string }): Harness {
    const calls: string[][] = [];
    const state = { renders: 0 };
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
        state.renders += 1;
        if (args.props.clips.length > 0) throw new Error('the local fallback must not receive clips');
        writeFileSync(args.outputPath, 'MP4DATA');
    };
    return {
        calls,
        runProcess,
        render,
        get renders() {
            return state.renders;
        },
    };
}

function argvFor(payload: Record<string, unknown>): { argv: string[]; outPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'kk-video-fallback-'));
    const inPath = join(dir, 'request.json');
    const outPath = join(dir, 'content.json');
    writeFileSync(inPath, JSON.stringify([{ id: 'video-gen-request', body: '', metadata: payload }]));
    return { argv: ['--in', inPath, '--out', outPath], outPath };
}

const colabCalls = (calls: string[][]): string[][] => calls.filter((argv) => (argv[0] as string).startsWith('colab'));

describe('wan21-i2v fallback (AC1)', () => {
    it('falls back to local Ken-Burns when the Colab job exits nonzero', async () => {
        const run = makeFixtureRun();
        const { argv, outPath } = argvFor(fixtureRequest(run, { provider: 'wan21-i2v' }));
        const h = harness(() => ({ code: 1, stdout: '', stderr: 'no A100 capacity' }));

        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(0);

        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.renderProvider).toBe('local-ken-burns');
        expect(content.metadata.fallbackUsed).toBe(true);
        expect(content.metadata.warnings?.join(' ')).toContain('no A100 capacity');
        expect(colabCalls(h.calls).length).toBeGreaterThan(0);
        expect(h.renders).toBe(1);
        expect(existsSync(join(run.workDir, OUTPUT_DIR_NAME, `${run.runDate}_video.mp4`))).toBe(true);
    });

    it('falls back when the worker produces no result line, and when the run times out', async () => {
        const run = makeFixtureRun();
        const silent = harness(() => ({ code: 0, stdout: 'booting', stderr: '' }));
        const first = argvFor(fixtureRequest(run, { provider: 'wan21-i2v' }));
        expect(await main(first.argv, { runProcess: silent.runProcess, render: silent.render, now: () => NOW })).toBe(
            0,
        );
        const silentContent = videoGenContentSchema.parse(JSON.parse(readFileSync(first.outPath, 'utf-8')));
        expect(silentContent.metadata.warnings?.join(' ')).toContain('no KK_COLAB_RESULT');

        const timingOut = harness(() => {
            throw new Error('timeout: process group killed');
        });
        const second = argvFor(fixtureRequest(run, { provider: 'wan21-i2v' }));
        expect(
            await main(second.argv, { runProcess: timingOut.runProcess, render: timingOut.render, now: () => NOW }),
        ).toBe(0);
        const timeoutContent = videoGenContentSchema.parse(JSON.parse(readFileSync(second.outPath, 'utf-8')));
        expect(timeoutContent.metadata.fallbackUsed).toBe(true);
        expect(timeoutContent.metadata.warnings?.join(' ')).toContain('timeout');
    });

    it('refuses a T4 before spending anything and falls back', async () => {
        const run = makeFixtureRun();
        const h = harness(() => ({ code: 0, stdout: '', stderr: '' }));
        const { argv, outPath } = argvFor(fixtureRequest(run, { provider: 'wan21-i2v', colab: { gpu: 'T4' } }));
        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(0);
        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.warnings?.join(' ')).toContain('T4');
        // The provider refuses before the runner is called, so no `colab run` was spawned.
        expect(colabCalls(h.calls)).toHaveLength(0);
    });

    it('falls back with zero Colab invocations when the 30-day budget is exhausted', async () => {
        const run = makeFixtureRun();
        const ledgerPath = resolveLedgerPath(run.workDir);
        writeFileSync(
            ledgerPath,
            `${JSON.stringify({
                timestamp: '2026-11-20T00:00:00.000Z',
                gpu: 'A100',
                durationSec: 3600,
                estimatedCcu: 179.5,
                jobType: 'wan21-i2v',
                status: 'ok',
            })}\n`,
        );
        const h = harness(() => ({ code: 0, stdout: '', stderr: '' }));
        const { argv, outPath } = argvFor(fixtureRequest(run, { provider: 'wan21-i2v' }));

        expect(await main(argv, { runProcess: h.runProcess, render: h.render, now: () => NOW })).toBe(0);

        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.renderProvider).toBe('local-ken-burns');
        expect(content.metadata.fallbackUsed).toBe(true);
        expect(content.metadata.warnings?.join(' ')).toContain('budget exhausted');
        expect(colabCalls(h.calls)).toHaveLength(0);
    });
});

describe('wan21 success path through main()', () => {
    it('renders the clip layer and reports the Colab provider without a fallback', async () => {
        const run = makeFixtureRun();
        const clips: string[] = [];
        const h = harness((argv) => {
            if (argv[1] === 'exec') {
                return {
                    code: 0,
                    stdout: `${'KK_COLAB_RESULT '}{"cache":"drive","outputs":["/content/kk-video/clip-0.mp4"]}`,
                    stderr: '',
                };
            }
            if (argv[1] === 'download') {
                writeFileSync(argv[3] as string, 'MP4CLIP');
                clips.push(argv[3] as string);
                return { code: 0, stdout: '', stderr: '' };
            }
            return { code: 0, stdout: '', stderr: '' };
        });
        const seen: { images: string[]; clips: string[] }[] = [];
        const render: RenderVideo = async (args) => {
            seen.push({ images: args.props.images, clips: args.props.clips });
            writeFileSync(args.outputPath, 'MP4DATA');
        };
        const { argv, outPath } = argvFor(fixtureRequest(run, { provider: 'wan21-i2v' }));

        expect(await main(argv, { runProcess: h.runProcess, render, now: () => NOW })).toBe(0);

        const content = videoGenContentSchema.parse(JSON.parse(readFileSync(outPath, 'utf-8')));
        expect(content.metadata.renderProvider).toBe('wan21-i2v');
        expect(content.metadata.fallbackUsed).toBeUndefined();
        expect(clips.length).toBeGreaterThan(0);
        expect(seen[0]?.clips.length).toBeGreaterThan(0);
        expect(seen[0]?.images).toEqual([]);
        // The ledger line for the successful job landed under the works root, not the run dir.
        expect(existsSync(resolveLedgerPath(run.workDir))).toBe(true);
        expect(existsSync(join(run.workDir, 'colab-ccu-ledger.jsonl'))).toBe(false);
    });
});

describe('wan21 provider seam (unit)', () => {
    const wanOptions = (runJob: (job: unknown) => Promise<unknown>) =>
        ({
            runJob: runJob as never,
            outputDir: '/tmp/out',
            runDate: '20261126',
            script: '/p/python/colab_wan21_i2v.py',
            remoteDir: '/content/kk-video',
        }) as const;

    it('refuses an empty still set and a T4 before running a job', async () => {
        const provider = createWan21Provider(
            wanOptions(async () => ({ ok: true, outputs: ['a'], durationSec: 0, cache: 'drive', estimatedCcu: 0 })),
        );
        await expect(provider.prepare({ images: [] })).rejects.toThrow(/at least one still/);
        const t4 = createWan21Provider({
            ...wanOptions(async () => ({ ok: true, outputs: ['a'], durationSec: 0, cache: 'drive', estimatedCcu: 0 })),
            gpu: 'T4',
        });
        await expect(t4.prepare({ images: ['cover.png'] })).rejects.toThrow(/cannot run on T4/);
    });

    it('maps a job result to a clip layer and surfaces a job failure', async () => {
        const ok = createWan21Provider(
            wanOptions(async (job) => {
                expect((job as { gpu: string }).gpu).toBe('A100');
                return {
                    ok: true,
                    outputs: ['/tmp/out/clip-0.mp4'],
                    durationSec: 5,
                    cache: 'drive',
                    estimatedCcu: 0.01,
                };
            }),
        );
        expect(await ok.prepare({ images: ['cover.png'] })).toEqual({ kind: 'clips', clips: ['/tmp/out/clip-0.mp4'] });

        const failed = createWan21Provider(
            wanOptions(async () => ({
                ok: false,
                outputs: [],
                durationSec: 0,
                cache: 'local',
                estimatedCcu: 0,
                error: 'quota',
            })),
        );
        await expect(failed.prepare({ images: ['cover.png'] })).rejects.toThrow(/quota/);

        const empty = createWan21Provider(
            wanOptions(async () => ({ ok: true, outputs: [], durationSec: 0, cache: 'drive', estimatedCcu: 0 })),
        );
        await expect(empty.prepare({ images: ['cover.png'] })).rejects.toThrow(/produced no clips/);
    });

    it('treats a reported-but-absent clip as a fallback cause (R5)', async () => {
        const provider = createWan21Provider({
            runJob: (async () => ({
                ok: true,
                outputs: ['/tmp/out/gone.mp4'],
                durationSec: 4,
                cache: 'drive',
                estimatedCcu: 0,
            })) as never,
            outputDir: '/tmp/out',
            runDate: '20261126',
            script: '/p/python/colab_wan21_i2v.py',
            remoteDir: '/content/kk-video',
            exists: async () => false,
        });
        await expect(provider.prepare({ images: ['cover.png'] })).rejects.toThrow(/not on disk/);
    });

    it('prepareVisualLayer falls back when the request asked for Colab without options', async () => {
        const prepared = await prepareVisualLayer({
            mode: 'editorial',
            providerId: 'wan21-i2v',
            images: ['cover.png'],
        });
        expect(prepared.providerId).toBe('local-ken-burns');
        expect(prepared.fallbackUsed).toBe(true);
        expect(prepared.warnings.join(' ')).toContain('without Colab options');
    });

    it('prepareVisualLayer keeps the clips when the job succeeds', async () => {
        const prepared = await prepareVisualLayer({
            mode: 'editorial',
            providerId: 'wan21-i2v',
            images: ['cover.png'],
            wan21: {
                ...wanOptions(async () => ({
                    ok: true,
                    outputs: ['/tmp/clip-0.mp4'],
                    durationSec: 4,
                    cache: 'drive',
                    estimatedCcu: 0,
                })),
            },
        });
        expect(prepared.providerId).toBe('wan21-i2v');
        expect(prepared.fallbackUsed).toBe(false);
        expect(prepared.layer).toEqual({ kind: 'clips', clips: ['/tmp/clip-0.mp4'] });
    });

    it('prepareVisualLayer resolves the local provider for a plain editorial request', async () => {
        const prepared = await prepareVisualLayer({
            mode: 'editorial',
            providerId: 'local-ken-burns',
            images: ['cover.png'],
        });
        expect(prepared).toEqual({
            layer: { kind: 'stills', images: ['cover.png'] },
            providerId: 'local-ken-burns',
            fallbackUsed: false,
            warnings: [],
        });
    });
});
