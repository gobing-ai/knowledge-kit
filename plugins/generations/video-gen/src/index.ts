import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { videoGenContentSchema } from '@gobing-ai/kk-core';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { transcribeWords } from './captions';
import { resolveLedgerPath } from './ccu-ledger';
import { type ColabJob, runColabJob } from './colab-runner';
import { nodeFileSystem } from './fs';
import { probeAudioDuration, sliceHookAudio } from './hook-slicer';
import { resolveVideoInputs, type VideoInputs } from './inputs';
import {
    AVATAR_COMPOSITION_ID,
    COMPOSITION_ID,
    chunkCaptions,
    HYBRID_PIP_COMPOSITION_ID,
    resolveHookWindow,
    VIDEO,
} from './layout';
import { type RunProcess, runtimeRunProcess } from './process';
import { buildAvatarProps, buildEditorialProps, buildHybridPipProps } from './props';
import { type RenderVideo, renderReel, stageAssets } from './render';
import { parseVideoGenRequestInput, type VideoGenRequest } from './request';
import { localKenBurns, prepareVisualLayer, resolveAvatarProvider } from './visual-provider';

/** Directory the plugin writes every artifact into, relative to the daily run's work dir. */
export const OUTPUT_DIR_NAME = '32-video';

/** Injected dependencies: the process seam, the filesystem seam and the Remotion renderer. */
export interface VideoGenDeps {
    runProcess: RunProcess;
    render: RenderVideo;
    fs: FileSystem;
    /** Clock for the CCU ledger's rolling window and job durations (tests pin it). */
    now: () => number;
}

const DEFAULT_PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveOutputOutPath(values: { out?: string | undefined }): string {
    if (values.out === undefined || values.out === '') {
        throw new Error('video-gen: missing --out <content.json>');
    }
    return values.out;
}

/** Write the video Content (shared by the editorial and avatar paths). */
async function emitContent(args: {
    fs: FileSystem;
    outPath: string;
    videoPath: string;
    inputs: VideoInputs;
    request: VideoGenRequest;
    durationSec: number;
    wordsPath: string;
    headline: string;
    providerId: string;
    fallbackUsed?: boolean;
    warnings?: string[];
    syntheticPresenter?: boolean;
}): Promise<number> {
    const content = videoGenContentSchema.parse({
        title: args.headline,
        body: args.inputs.plan.items.map((item) => item.lead).join('\n\n'),
        format: 'video',
        metadata: {
            generator: 'kk:video-gen',
            videoPath: args.videoPath,
            coverPath: args.inputs.coverPath,
            width: VIDEO.width,
            height: VIDEO.height,
            fps: VIDEO.fps,
            durationSec: args.durationSec,
            visualMode: args.request.visualMode,
            renderProvider: args.providerId,
            ...(args.fallbackUsed === true ? { fallbackUsed: true } : {}),
            ...(args.warnings === undefined || args.warnings.length === 0 ? {} : { warnings: args.warnings }),
            captionsPath: args.wordsPath,
            ...(args.syntheticPresenter === true ? { syntheticPresenter: true } : {}),
            ...(args.inputs.plan.tags.length > 0 ? { tags: args.inputs.plan.tags } : {}),
        },
    });
    await args.fs.ensureDir(dirname(args.outPath));
    await args.fs.writeFile(args.outPath, `${JSON.stringify(content, null, 4)}\n`);
    return 0;
}

/**
 * `kk executor run video-gen --in <request.json> --out <content.json>`: render a 9:16 editorial
 * teaser from a completed daily AI news run and emit `videoGenContentSchema` Content.
 *
 * Order is the fail-closed contract: request → inputs → teaser window → artifact dir. Nothing is
 * spawned (no ffprobe/ffmpeg/uv/Chromium) until every input that can be checked without a render has
 * been checked.
 */
export async function main(argv: string[] = process.argv.slice(2), deps?: Partial<VideoGenDeps>): Promise<number> {
    const { values } = parseArgs({ args: argv, options: { in: { type: 'string' }, out: { type: 'string' } } });
    const runProcess = deps?.runProcess ?? runtimeRunProcess;
    const fs = deps?.fs ?? nodeFileSystem;
    const pluginRoot = DEFAULT_PLUGIN_ROOT;

    try {
        if (values.in === undefined || values.in === '') {
            throw new Error('video-gen: missing --in <request.json>');
        }
        const outPath = resolveOutputOutPath(values);
        const request = parseVideoGenRequestInput(JSON.parse(await fs.readFile(values.in)) as unknown);
        const portraitPath = request.visualMode === 'editorial' ? undefined : request.hostPortraitPath;
        if (portraitPath !== undefined) {
            try {
                const portrait = await fs.stat(portraitPath);
                if (
                    portrait === null ||
                    !portrait.isFile() ||
                    (await Bun.file(portraitPath).slice(0, 1).arrayBuffer()).byteLength === 0
                ) {
                    throw new Error('no readable portrait bytes');
                }
            } catch {
                throw new Error(`video-gen: host portrait ${portraitPath} is missing or unreadable`);
            }
        }
        const inputs = await resolveVideoInputs(request.workDir, request.runDate, fs);

        const audioDurationSec = await probeAudioDuration(inputs.audioPath, runProcess);
        const window = resolveHookWindow(request.hook, audioDurationSec);

        const outputDir = join(request.workDir, OUTPUT_DIR_NAME);
        const publicDir = join(outputDir, 'public');
        await fs.ensureDir(publicDir);
        const hookPath = join(outputDir, `${request.runDate}_hook.wav`);
        const wordsPath = join(outputDir, `${request.runDate}_words.json`);
        const videoPath = join(outputDir, `${request.runDate}_video.mp4`);

        await sliceHookAudio({ audioPath: inputs.audioPath, outputPath: hookPath, window, runProcess });
        const { words, waveform } = await transcribeWords({
            pluginRoot,
            audioPath: hookPath,
            outputPath: wordsPath,
            runProcess,
        });
        const captions = chunkCaptions(words);

        // Loaded after the fail-closed checks: a rejected request never pays the Remotion import.
        const render = deps?.render ?? (await import('./remotion/engine')).remotionRender;
        const headline = inputs.plan.headline ?? inputs.plan.items[0]?.lead ?? request.runDate;
        const colabDeps = {
            runProcess,
            fs,
            ledgerPath: resolveLedgerPath(request.workDir),
            outputDir,
            maxMonthlyCcu: request.colab?.maxMonthlyCcu,
            now: deps?.now,
            ...(request.colab?.cacheDir === undefined ? {} : { cacheDir: request.colab.cacheDir }),
        };
        const runJob = (job: ColabJob) => runColabJob(job, colabDeps);

        if (portraitPath !== undefined) {
            // 0452: avatar modes have NO fallback — a missing presenter is a broken video, so a
            // failure exits nonzero (the daily node's `onError: continue` keeps the episode alive).
            const avatar = resolveAvatarProvider(request.provider ?? 'musetalk', {
                runJob,
                outputDir,
                runDate: request.runDate,
                script: join(
                    pluginRoot,
                    'python',
                    request.provider === 'echomimic-v2' ? 'colab_echomimic_v2.py' : 'colab_musetalk.py',
                ),
                remoteDir: '/content/kk-video',
                portraitPath,
                audioPath: hookPath,
                exists: async (path: string) => (await fs.exists(path)) === true,
                ...(request.colab?.gpu === undefined ? {} : { gpu: request.colab.gpu }),
                ...(request.colab?.timeoutMs === undefined ? {} : { timeoutMs: request.colab.timeoutMs }),
                env: { KK_COLAB_CACHE_DIR: request.colab?.cacheDir ?? '/content/drive/MyDrive/kk-video-cache' },
            });
            const presenterLayer = await avatar.prepare({ images: [] });
            const stagedPresenter = await stageAssets({
                images: presenterLayer.kind === 'clips' ? presenterLayer.clips : [],
                audioPath: hookPath,
                publicDir,
                fs,
            });
            const editorialLayer = await localKenBurns.prepare({ images: [inputs.coverPath, ...inputs.cardPaths] });
            const stagedEditorial = await stageAssets({
                images: editorialLayer.kind === 'stills' ? editorialLayer.images : [],
                audioPath: hookPath,
                publicDir,
                fs,
            });
            const shared = {
                captions,
                waveform,
                headline,
                audioName: stagedEditorial.audioName,
                durationSec: window.durationSec,
                width: VIDEO.width,
                height: VIDEO.height,
                fps: VIDEO.fps,
            };
            const isAvatar = request.visualMode === 'avatar';
            const props = isAvatar
                ? buildAvatarProps({
                      layer: { kind: 'clips', clips: stagedPresenter.imageNames },
                      ...shared,
                  })
                : buildHybridPipProps({
                      layer: { kind: 'stills', images: stagedEditorial.imageNames },
                      presenterLayer: { kind: 'clips', clips: stagedPresenter.imageNames },
                      ...shared,
                  });
            await renderReel({
                compositionId: isAvatar ? AVATAR_COMPOSITION_ID : HYBRID_PIP_COMPOSITION_ID,
                props,
                publicDir,
                outputPath: videoPath,
                entryPoint: join(pluginRoot, 'src', 'remotion', 'index.tsx'),
                render,
                fs,
            });
            return await emitContent({
                fs,
                outPath,
                videoPath,
                inputs,
                request,
                durationSec: window.durationSec,
                wordsPath,
                headline,
                providerId: request.provider ?? 'musetalk',
                syntheticPresenter: true,
            });
        }

        const wantedProvider = request.provider ?? 'local-ken-burns';
        const prepared = await prepareVisualLayer({
            mode: request.visualMode,
            providerId: wantedProvider,
            images: [inputs.coverPath, ...inputs.cardPaths],
            ...(wantedProvider === 'wan21-i2v'
                ? {
                      wan21: {
                          runJob,
                          outputDir,
                          runDate: request.runDate,
                          script: join(pluginRoot, 'python', 'colab_wan21_i2v.py'),
                          remoteDir: '/content/kk-video',
                          exists: async (path: string) => (await fs.exists(path)) === true,
                          ...(request.colab?.gpu === undefined ? {} : { gpu: request.colab.gpu }),
                          ...(request.colab?.timeoutMs === undefined ? {} : { timeoutMs: request.colab.timeoutMs }),
                          env: {
                              KK_COLAB_CACHE_DIR: request.colab?.cacheDir ?? '/content/drive/MyDrive/kk-video-cache',
                          },
                      },
                  }
                : {}),
        });
        const layer = prepared.layer;
        const staged =
            layer.kind === 'stills'
                ? await stageAssets({ images: layer.images, audioPath: hookPath, publicDir, fs })
                : await stageAssets({ images: layer.clips, audioPath: hookPath, publicDir, fs });

        const props = buildEditorialProps({
            // The shell renders the staged names, not the source paths the provider resolved.
            layer:
                layer.kind === 'stills'
                    ? { kind: 'stills', images: staged.imageNames }
                    : { kind: 'clips', clips: staged.imageNames },
            captions,
            waveform,
            headline: inputs.plan.headline ?? inputs.plan.items[0]?.lead ?? request.runDate,
            audioName: staged.audioName,
            durationSec: window.durationSec,
            width: VIDEO.width,
            height: VIDEO.height,
            fps: VIDEO.fps,
        });

        await renderReel({
            compositionId: COMPOSITION_ID,
            props,
            publicDir,
            outputPath: videoPath,
            entryPoint: join(pluginRoot, 'src', 'remotion', 'index.tsx'),
            render,
            fs,
        });

        return await emitContent({
            fs,
            outPath,
            videoPath,
            inputs,
            request,
            durationSec: window.durationSec,
            wordsPath,
            headline,
            providerId: prepared.providerId,
            fallbackUsed: prepared.fallbackUsed,
            warnings: prepared.warnings,
        });
    } catch (error: unknown) {
        echoError(`video-gen failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
