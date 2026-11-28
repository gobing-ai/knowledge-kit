import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkCaptions, VIDEO, type WordTimestamp } from '../src/layout';
import { runtimeRunProcess } from '../src/process';
import { buildEditorialProps } from '../src/props';
import { remotionRender } from '../src/remotion/engine';
import { renderReel, stageAssets } from '../src/render';

/**
 * AC2 (R2, R3) — the real thing: a true Remotion render of the 9:16 shell, then `ffprobe` on the
 * produced file. Heavy tier (`tests/render-e2e.test.ts` is registered in
 * `scripts/test-suites.ts`), because it boots Chromium and takes minutes, not milliseconds.
 *
 * The teaser is synthesised with `ffmpeg` (sine audio + a solid still) so this test costs no network
 * model download; the caption track is synthesised in the same shape `faster-whisper` emits.
 */

const CLIP_SEC = 3;

const WORDS: WordTimestamp[] = [
    { word: 'AI 日报', startSec: 0, endSec: 0.8 },
    { word: '今日要闻。', startSec: 0.8, endSec: 1.6 },
    { word: '推理模型', startSec: 1.6, endSec: 2.4 },
    { word: '上新。', startSec: 2.4, endSec: CLIP_SEC },
];

describe('editorial reel render (heavy)', () => {
    it('renders a 1080x1920 H.264/AAC MP4 that ffprobe confirms', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-e2e-'));
        const stillPath = join(dir, 'cover.png');
        const audioPath = join(dir, 'teaser.wav');

        expect(
            (
                await runtimeRunProcess([
                    'ffmpeg',
                    '-y',
                    '-loglevel',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    `color=c=0x070b10:s=1080x1920:d=1`,
                    '-frames:v',
                    '1',
                    stillPath,
                ])
            ).code,
        ).toBe(0);
        expect(
            (
                await runtimeRunProcess([
                    'ffmpeg',
                    '-y',
                    '-loglevel',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    `sine=frequency=440:duration=${CLIP_SEC}`,
                    '-ar',
                    '44100',
                    '-ac',
                    '2',
                    audioPath,
                ])
            ).code,
        ).toBe(0);

        const publicDir = join(dir, 'public');
        const staged = await stageAssets({ images: [stillPath], audioPath, publicDir });
        const props = buildEditorialProps({
            layer: { kind: 'stills', images: staged.imageNames },
            captions: chunkCaptions(WORDS),
            headline: '每日 AI 日报',
            audioName: staged.audioName,
            durationSec: CLIP_SEC,
            width: VIDEO.width,
            height: VIDEO.height,
            fps: VIDEO.fps,
        });

        const outputPath = join(dir, 'reel.mp4');
        const written = await renderReel({
            compositionId: 'EditorialReel',
            props,
            publicDir,
            outputPath,
            entryPoint: join(import.meta.dir, '..', 'src', 'remotion', 'index.tsx'),
            render: remotionRender,
        });
        expect(written.sizeBytes).toBeGreaterThan(0);

        const probe = await runtimeRunProcess([
            'ffprobe',
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,width,height:format=duration',
            '-of',
            'json',
            outputPath,
        ]);
        expect(probe.code).toBe(0);
        const info = JSON.parse(probe.stdout) as {
            streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
            format: { duration: string };
        };
        const video = info.streams.find((stream) => stream.codec_type === 'video');
        expect(video?.codec_name).toBe('h264');
        expect(video?.width).toBe(VIDEO.width);
        expect(video?.height).toBe(VIDEO.height);
        expect(info.streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')).toBe(true);
        expect(Number.parseFloat(info.format.duration)).toBeGreaterThan(CLIP_SEC - 0.5);
    }, 600_000);
});

/**
 * The designed missing-cache path: engine.ts's `onBrowserDownload` refuses to download Chromium and
 * names the provisioning command. Remotion resolves its browser cache from the cwd's nearest
 * `package.json` (@remotion/renderer's get-download-destination), so an empty temp cwd has no cache
 * on any machine — the branch a CI runner with no browser takes.
 */
describe('render failure mapping', () => {
    it('names the browser provisioning command when the Chromium cache is missing', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-nocache-'));
        const publicDir = join(dir, 'public');
        mkdirSync(publicDir);
        const cwd = process.cwd();
        process.chdir(dir);
        try {
            await expect(
                remotionRender({
                    compositionId: 'EditorialReel',
                    props: buildEditorialProps({
                        layer: { kind: 'stills', images: ['still-0.png'] },
                        captions: chunkCaptions(WORDS),
                        headline: '每日 AI 日报',
                        audioName: 'teaser.wav',
                        durationSec: CLIP_SEC,
                        width: VIDEO.width,
                        height: VIDEO.height,
                        fps: VIDEO.fps,
                    }),
                    publicDir,
                    outputPath: join(dir, 'reel.mp4'),
                    entryPoint: join(import.meta.dir, '..', 'src', 'remotion', 'index.tsx'),
                }),
            ).rejects.toThrow(/Chromium cache is missing/);
        } finally {
            process.chdir(cwd);
        }
    }, 600_000);
});
