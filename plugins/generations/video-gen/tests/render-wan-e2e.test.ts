import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkCaptions, VIDEO, type WordTimestamp } from '../src/layout';
import { runtimeRunProcess } from '../src/process';
import { buildEditorialProps } from '../src/props';
import { remotionRender } from '../src/remotion/engine';
import { renderReel, stageAssets } from '../src/render';

/**
 * AC3 (R4) — the shared 9:16 shell composited over **motion clips** instead of stills: two
 * pre-rendered 3s 9:16 loops (no Colab, no network) go through `EditorialReel` and come out as one
 * 1080×1920 H.264/AAC MP4. Heavy tier: registered in `scripts/test-suites.ts`.
 */

const CLIP_SEC = 3;

const WORDS: WordTimestamp[] = [
    { word: 'AI 日报', startSec: 0, endSec: 0.8 },
    { word: '今日要闻。', startSec: 0.8, endSec: 1.6 },
    { word: '推理模型', startSec: 1.6, endSec: 2.4 },
    { word: '上新。', startSec: 2.4, endSec: CLIP_SEC },
];

describe('clip reel render (heavy)', () => {
    it('composites Wan2.1-style motion loops into one 1080x1920 H.264/AAC MP4', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-wan-'));
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
                    `sine=frequency=440:duration=${CLIP_SEC}`,
                    '-ar',
                    '44100',
                    '-ac',
                    '2',
                    audioPath,
                ])
            ).code,
        ).toBe(0);

        // Two synthetic 9:16 loops standing in for the Colab worker's output.
        const clips: string[] = [];
        for (const color of ['0x123456', '0x654321']) {
            const clip = join(dir, `clip-${clips.length}.mp4`);
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
                        `color=c=${color}:s=1080x1920:d=1.5:r=30`,
                        '-c:v',
                        'libx264',
                        '-pix_fmt',
                        'yuv420p',
                        clip,
                    ])
                ).code,
            ).toBe(0);
            clips.push(clip);
        }

        const publicDir = join(dir, 'public');
        const staged = await stageAssets({ images: clips, audioPath, publicDir });
        const props = buildEditorialProps({
            layer: { kind: 'clips', clips: staged.imageNames },
            captions: chunkCaptions(WORDS),
            headline: '每日 AI 日报',
            audioName: staged.audioName,
            durationSec: CLIP_SEC,
            width: VIDEO.width,
            height: VIDEO.height,
            fps: VIDEO.fps,
        });
        expect(props.clips).toHaveLength(2);
        expect(props.images).toEqual([]);

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
