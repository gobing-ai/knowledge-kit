import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aiLabelBox, chunkCaptions, pipBox, VIDEO, type WordTimestamp } from '../src/layout';
import { runtimeRunProcess } from '../src/process';
import { buildAvatarProps, buildHybridPipProps } from '../src/props';
import { remotionRender } from '../src/remotion/engine';
import { renderReel, stageAssets } from '../src/render';

/**
 * AC1/AC2 (0452 R3) — a fixture presenter clip rendered through both avatar compositions: full-frame
 * `AvatarReel` and the hybrid `HybridPipReel` bubble over the editorial canvas. Heavy tier (no Colab,
 * no network); registered in `scripts/test-suites.ts`.
 */

const CLIP_SEC = 3;
const WORDS: WordTimestamp[] = [
    { word: 'AI 日报', startSec: 0, endSec: 0.8 },
    { word: '今日要闻。', startSec: 0.8, endSec: 1.6 },
    { word: '推理模型', startSec: 1.6, endSec: 2.4 },
    { word: '上新。', startSec: 2.4, endSec: CLIP_SEC },
];

async function probe(path: string) {
    const result = await runtimeRunProcess([
        'ffprobe',
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height:format=duration',
        '-of',
        'json',
        path,
    ]);
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout) as {
        streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
        format: { duration: string };
    };
}

describe('avatar reels (heavy)', () => {
    it('renders the full-frame AvatarReel and the HybridPipReel to 1080x1920 H.264/AAC', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-video-avatar-'));
        const audioPath = join(dir, 'teaser.wav');
        const presenterPath = join(dir, 'presenter.mp4');
        const stillPath = join(dir, 'cover.png');

        for (const argv of [
            [
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
            ],
            [
                'ffmpeg',
                '-y',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'color=c=0x203040:s=1080x1920:d=1.5:r=30',
                '-c:v',
                'libx264',
                '-pix_fmt',
                'yuv420p',
                presenterPath,
            ],
            [
                'ffmpeg',
                '-y',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'color=c=0x070b10:s=1080x1920:d=1',
                '-frames:v',
                '1',
                stillPath,
            ],
        ]) {
            expect((await runtimeRunProcess(argv)).code).toBe(0);
        }

        const publicDir = join(dir, 'public');
        const staged = await stageAssets({ images: [presenterPath], audioPath, publicDir });
        const stagedStill = await stageAssets({ images: [stillPath], audioPath, publicDir });
        const captions = chunkCaptions(WORDS);
        const shared = {
            captions,
            headline: '每日 AI 日报',
            audioName: staged.audioName,
            durationSec: CLIP_SEC,
            width: VIDEO.width,
            height: VIDEO.height,
            fps: VIDEO.fps,
        };

        // The PiP bubble and the label clear both overlay margins by construction.
        const pip = pipBox();
        expect(pip.y + pip.height).toBeLessThanOrEqual(VIDEO.height - 480);
        const label = aiLabelBox();
        expect(label.x + label.width).toBeLessThanOrEqual(VIDEO.width - 162);

        const avatarPath = join(dir, 'avatar.mp4');
        await renderReel({
            compositionId: 'AvatarReel',
            props: buildAvatarProps({ layer: { kind: 'clips', clips: staged.imageNames }, ...shared }),
            publicDir,
            outputPath: avatarPath,
            entryPoint: join(import.meta.dir, '..', 'src', 'remotion', 'index.tsx'),
            render: remotionRender,
        });
        const avatarProbe = await probe(avatarPath);
        const avatarVideo = avatarProbe.streams.find((stream) => stream.codec_type === 'video');
        expect(avatarVideo?.codec_name).toBe('h264');
        expect(avatarVideo?.width).toBe(1080);
        expect(avatarVideo?.height).toBe(1920);
        expect(avatarProbe.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac')).toBe(true);

        const pipPath = join(dir, 'hybrid.mp4');
        await renderReel({
            compositionId: 'HybridPipReel',
            props: buildHybridPipProps({
                layer: { kind: 'stills', images: stagedStill.imageNames },
                presenterLayer: { kind: 'clips', clips: staged.imageNames },
                ...shared,
            }),
            publicDir,
            outputPath: pipPath,
            entryPoint: join(import.meta.dir, '..', 'src', 'remotion', 'index.tsx'),
            render: remotionRender,
        });
        const pipProbe = await probe(pipPath);
        expect(pipProbe.streams.find((stream) => stream.codec_type === 'video')?.width).toBe(1080);
        expect(Number.parseFloat(pipProbe.format.duration)).toBeGreaterThan(CLIP_SEC - 0.5);
    }, 600_000);
});
