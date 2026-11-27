import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    activeCaptionAt,
    activeWordIndex,
    aiLabelBox,
    assertInSafeArea,
    buildWaveform,
    type CaptionChunk,
    chunkCaptions,
    contentBox,
    deriveHookWindow,
    HOOK_MAX_SEC,
    HOOK_MIN_SEC,
    intersectsSafeZone,
    pipBox,
    resolveHookWindow,
    SAFE_ZONE,
    VIDEO,
    validateHookWindow,
    type WordTimestamp,
} from '../src/layout';
import { buildAvatarProps, buildEditorialProps, buildHybridPipProps, PODCAST_CTA } from '../src/props';
import { describeRenderFailure, renderReel, stageAssets } from '../src/render';

/**
 * AC3 (R4) — teaser clamping, caption chunking and the platform safe zone, plus AC2's render
 * handoff. Everything here is the pure/deterministic half, so it runs in the fast tier with no
 * browser and no spawn.
 */

const WORDS: WordTimestamp[] = [
    { word: 'OpenAI', startSec: 0, endSec: 0.4 },
    { word: '发布', startSec: 0.4, endSec: 0.7 },
    { word: '新模型。', startSec: 0.7, endSec: 1.2 },
    { word: '国产', startSec: 2.2, endSec: 2.5 },
    { word: '开源', startSec: 2.5, endSec: 2.8 },
];

describe('safe zone', () => {
    it('reserves the bottom 480px and right 162px overlay margins', () => {
        expect(SAFE_ZONE).toEqual({ bottomPx: 480, rightPx: 162 });
        expect(intersectsSafeZone(contentBox())).toBe(false);
        expect(() => assertInSafeArea(contentBox())).not.toThrow();
    });

    it('treats the boundary as inclusive and names an intruding box', () => {
        const maxY = VIDEO.height - SAFE_ZONE.bottomPx;
        const flush = { x: 0, y: maxY - 100, width: 100, height: 100 };
        expect(intersectsSafeZone(flush)).toBe(false);
        const intruding = { x: 0, y: maxY - 99, width: 100, height: 100 };
        expect(intersectsSafeZone(intruding)).toBe(true);
        expect(() => assertInSafeArea(intruding, 'captions')).toThrow(/captions .* safe zone/);
        expect(intersectsSafeZone({ x: 900, y: 0, width: 40, height: 40 })).toBe(true);
    });
});

describe('avatar geometry (0452 R3/AC2)', () => {
    it('places the PiP bubble and the AI label clear of the overlay margins', () => {
        const pip = pipBox();
        expect(intersectsSafeZone(pip)).toBe(false);
        expect(() => assertInSafeArea(pip, 'pip')).not.toThrow();
        expect(pip.width).toBe(pip.height);
        // Bottom-left, above the reserved bottom strip.
        expect(pip.x).toBeLessThan(VIDEO.width / 2);
        expect(pip.y + pip.height).toBeLessThanOrEqual(VIDEO.height - SAFE_ZONE.bottomPx);

        const label = aiLabelBox();
        expect(intersectsSafeZone(label)).toBe(false);
        expect(label.x).toBeLessThan(VIDEO.width - SAFE_ZONE.rightPx);
    });
});

describe('avatar props (0452)', () => {
    const shared = {
        captions: chunkCaptions(WORDS),
        headline: 'AI 日报',
        audioName: 'teaser.wav',
        durationSec: 52,
        width: 1080,
        height: 1920,
        fps: 30,
    };

    it('builds an avatar reel from exactly one presenter clip', () => {
        const props = buildAvatarProps({ layer: { kind: 'clips', clips: ['presenter.mp4'] }, ...shared });
        expect(props.presenterClip).toBe('presenter.mp4');
        expect(props.cta).toBe(PODCAST_CTA);
        expect(props.waveform).toHaveLength(48);
    });

    it('refuses a stills layer, two clips, or no captions', () => {
        expect(() => buildAvatarProps({ layer: { kind: 'stills', images: ['a.png'] }, ...shared })).toThrow(
            /needs a presenter clip layer/,
        );
        expect(() => buildAvatarProps({ layer: { kind: 'clips', clips: ['a.mp4', 'b.mp4'] }, ...shared })).toThrow(
            /exactly one presenter clip/,
        );
        expect(() => buildAvatarProps({ layer: { kind: 'clips', clips: ['a.mp4'] }, ...shared, captions: [] })).toThrow(
            /caption burst/,
        );
    });

    it('builds a hybrid-PiP reel from the editorial layer plus one presenter clip', () => {
        const props = buildHybridPipProps({
            layer: { kind: 'stills', images: ['still-0.png'] },
            presenterLayer: { kind: 'clips', clips: ['presenter.mp4'] },
            ...shared,
        });
        expect(props.presenterClip).toBe('presenter.mp4');
        expect(props.images).toEqual(['still-0.png']);
        expect(props.cta).toBe(PODCAST_CTA);
    });
});

describe('hook window', () => {
    it('derives the 45–60s head of the episode', () => {
        expect(deriveHookWindow(52.5)).toEqual({ startSec: 0, endSec: 52.5 });
        expect(deriveHookWindow(180)).toEqual({ startSec: 0, endSec: HOOK_MAX_SEC });
    });

    it('fails closed on audio shorter than the teaser minimum or a non-positive length', () => {
        expect(() => deriveHookWindow(HOOK_MIN_SEC - 1)).toThrow(/shorter than the 45s/);
        expect(() => deriveHookWindow(0)).toThrow(/audio duration must be a positive number/);
    });

    it('rejects an explicit window outside 45–60s or past the end of the audio', () => {
        expect(validateHookWindow({ startSec: 0, endSec: 45 }, 52.5)).toEqual({ startSec: 0, endSec: 45 });
        expect(() => validateHookWindow({ startSec: 0, endSec: 44.9 }, 52.5)).toThrow(/must be 45–60s/);
        expect(() => validateHookWindow({ startSec: 0, endSec: 61 }, 90)).toThrow(/must be 45–60s/);
        expect(() => validateHookWindow({ startSec: 0, endSec: 60 }, 55)).toThrow(/only 55.0s/);
        expect(() => validateHookWindow({ startSec: -1, endSec: 50 }, 60)).toThrow(/hook.startSec must be >= 0/);
    });

    it('prefers an explicit window and reports its duration', () => {
        expect(resolveHookWindow(undefined, 52.5)).toEqual({ startSec: 0, endSec: 52.5, durationSec: 52.5 });
        expect(resolveHookWindow({ startSec: 5, endSec: 55 }, 90)).toEqual({
            startSec: 5,
            endSec: 55,
            durationSec: 50,
        });
    });
});

describe('caption chunking', () => {
    it('starts a new burst at a sentence end and after a silence', () => {
        const chunks = chunkCaptions(WORDS);
        expect(chunks.map((chunk) => chunk.text)).toEqual(['OpenAI发布新模型。', '国产开源']);
        expect(chunks[0]?.startSec).toBe(0);
        expect(chunks[0]?.endSec).toBe(1.2);
    });

    it('overflows into a new burst rather than rendering an over-wide line', () => {
        const chunks = chunkCaptions(WORDS, 6);
        expect(chunks.every((chunk) => chunk.text.length <= 8)).toBe(true);
        expect(chunks.length).toBeGreaterThan(2);
    });

    it('returns nothing for an empty track', () => {
        expect(chunkCaptions([])).toEqual([]);
    });
});

describe('waveform + active caption helpers', () => {
    const chunks = chunkCaptions(WORDS);

    it('scales bars from the caption track and stays inside 0..1', () => {
        const bars = buildWaveform(chunks, 12);
        expect(bars).toHaveLength(12);
        expect(bars.every((bar) => bar >= 0.15 && bar <= 1)).toBe(true);
        expect(buildWaveform([], 4)).toEqual([0.2, 0.2, 0.2, 0.2]);
        expect(buildWaveform(chunks, 0)).toEqual([]);
    });

    it('resolves the visible burst and the spoken word', () => {
        expect(activeCaptionAt(chunks, 0.5)?.text).toBe('OpenAI发布新模型。');
        expect(activeCaptionAt(chunks, 1.5)).toBeNull();
        const chunk = chunks[0] as CaptionChunk;
        expect(activeWordIndex(chunk, 0.8)).toBe(2);
        expect(activeWordIndex(chunk, -1)).toBe(-1);
    });
});

describe('editorial props', () => {
    const base = {
        layer: { kind: 'stills' as const, images: ['still-0.png', 'still-1.png'] },
        captions: chunkCaptions(WORDS),
        headline: 'AI 日报 1126',
        audioName: 'teaser.wav',
        durationSec: 52,
        width: 1080,
        height: 1920,
        fps: 30,
    };

    it('carries the staged stills, caption track and podcast CTA', () => {
        const props = buildEditorialProps(base);
        expect(props.images).toEqual(['still-0.png', 'still-1.png']);
        expect(props.cta).toBe(PODCAST_CTA);
        expect(props.audioSrc).toBe('teaser.wav');
        expect(props.waveform).toHaveLength(48);
        expect(props.durationSec).toBe(52);
    });

    it('accepts a clip layer (Wan2.1, 0451) and rejects an empty reel or caption track', () => {
        const clipProps = buildEditorialProps({ ...base, layer: { kind: 'clips', clips: ['clip-0.mp4'] } });
        expect(clipProps.clips).toEqual(['clip-0.mp4']);
        expect(clipProps.images).toEqual([]);
        expect(() => buildEditorialProps({ ...base, layer: { kind: 'stills', images: [] } })).toThrow(
            /at least one staged still/,
        );
        expect(() => buildEditorialProps({ ...base, captions: [] })).toThrow(/at least one caption burst/);
        expect(() => buildEditorialProps({ ...base, durationSec: 0 })).toThrow(/duration must be positive/);
    });
});

describe('render failure mapping', () => {
    it('names the one-time browser install for a cold-start renderer failure', () => {
        expect(describeRenderFailure(new Error('Could not find Chrome (ver. 158)'))).toContain('await ensureBrowser()');
        expect(describeRenderFailure(new Error('Unable to download the Chrome Headless Shell'))).toContain(
            'await ensureBrowser()',
        );
    });

    it('passes an unrelated renderer failure through unchanged', () => {
        expect(describeRenderFailure(new Error('ffmpeg exited 1'))).toBe('ffmpeg exited 1');
        expect(describeRenderFailure('plain string failure')).toBe('plain string failure');
    });
});

describe('asset staging + render handoff', () => {
    const scratch = () => mkdtempSync(join(tmpdir(), 'kk-video-stage-'));

    it('copies stills and the teaser into the public dir under positional names', async () => {
        const root = scratch();
        const cover = join(root, 'cover.png');
        const card = join(root, 'card.jpg');
        const audio = join(root, 'hook.wav');
        writeFileSync(cover, 'PNG');
        writeFileSync(card, 'JPG');
        writeFileSync(audio, 'WAV');
        const publicDir = join(root, 'public');

        const staged = await stageAssets({ images: [cover, card], audioPath: audio, publicDir });
        expect(staged).toEqual({ imageNames: ['still-0.png', 'still-1.jpg'], audioName: 'teaser.wav' });
        expect((await stageAssets({ images: [cover], audioPath: audio, publicDir })).imageNames).toEqual([
            'still-0.png',
        ]);
    });

    it('refuses to stage an empty still list', async () => {
        const root = scratch();
        const audio = join(root, 'hook.wav');
        writeFileSync(audio, 'WAV');
        await expect(stageAssets({ images: [], audioPath: audio, publicDir: join(root, 'public') })).rejects.toThrow(
            /no stills to stage/,
        );
    });

    const renderArgs = (outputPath: string) => ({
        props: buildEditorialProps({
            layer: { kind: 'stills' as const, images: ['still-0.png'] },
            captions: chunkCaptions(WORDS),
            headline: 'AI 日报 1126',
            audioName: 'teaser.wav',
            durationSec: 52,
            width: 1080,
            height: 1920,
            fps: 30,
        }),
        publicDir: join(tmpdir(), 'kk-video-public'),
        outputPath,
        entryPoint: 'src/remotion/index.tsx',
    });

    it('accepts only a renderer that leaves a non-empty file', async () => {
        const root = scratch();
        mkdirSync(root, { recursive: true });
        const outputPath = join(root, 'video.mp4');
        const written = await renderReel({
            ...renderArgs(outputPath),
            render: async () => {
                writeFileSync(outputPath, 'MP4');
            },
        });
        expect(written.sizeBytes).toBe(3);

        await expect(renderReel({ ...renderArgs(join(root, 'missing.mp4')), render: async () => {} })).rejects.toThrow(
            /without writing/,
        );
        const empty = join(root, 'empty.mp4');
        writeFileSync(empty, '');
        await expect(renderReel({ ...renderArgs(empty), render: async () => {} })).rejects.toThrow(/is empty/);
    });
});
