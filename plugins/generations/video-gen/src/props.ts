import { buildWaveform, type CaptionChunk } from './layout';
import type { VisualLayer } from './visual-provider';

/**
 * The props the Remotion shell renders from — built here (pure, fast-tier tested) so the `.tsx`
 * files stay declarative and the composition contract is asserted without a render (R4/AC3).
 */

/** Podcast CTA in the outro card; the only copy the shell owns. */
export const PODCAST_CTA = '完整节目见播客 · 搜索「AI 日报」';

/** One waveform bar: stable id plus a normalised height. */
export interface WaveformBar {
    id: string;
    height: number;
}

/** Everything the Remotion composition reads; asset names are `staticFile`-relative. */
export interface EditorialReelProps {
    /** Remotion's `Composition` requires its prop type to be an indexable record. */
    [key: string]: unknown;
    /** Public-dir-relative still names, in play order (cover first); empty for a clip reel. */
    images: string[];
    /** Public-dir-relative motion-loop clip names; empty for a stills reel (0451). */
    clips: string[];
    /** Caption bursts covering the teaser. */
    captions: CaptionChunk[];
    /** Episode headline for the opening card. */
    headline: string;
    /** Outro CTA copy. */
    cta: string;
    /** Public-dir-relative teaser audio name. */
    audioSrc: string;
    /** Teaser length; the composition length is this value. */
    durationSec: number;
    /** Waveform strip bars; `id` is positional identity, `height` is normalised 0..1. */
    waveform: WaveformBar[];
    width: number;
    height: number;
    fps: number;
}

/**
 * Build the composition props from the prepared layer, the caption track and the staged asset names.
 * A `clips` layer (0451's Wan2.1 motion loops) renders through the same shell: `EditorialReel` plays
 * the clips with `OffthreadVideo` instead of animating stills.
 */
export function buildEditorialProps(args: {
    layer: VisualLayer;
    captions: CaptionChunk[];
    headline: string;
    audioName: string;
    durationSec: number;
    width: number;
    height: number;
    fps: number;
}): EditorialReelProps {
    const images = args.layer.kind === 'stills' ? args.layer.images : [];
    const clips = args.layer.kind === 'clips' ? args.layer.clips : [];
    if (images.length === 0 && clips.length === 0) {
        throw new Error('video-gen: editorial reel needs at least one staged still or clip');
    }
    if (args.captions.length === 0) {
        throw new Error('video-gen: editorial reel needs at least one caption burst');
    }
    if (!(args.durationSec > 0)) {
        throw new Error(`video-gen: reel duration must be positive (got ${args.durationSec})`);
    }
    return {
        images,
        clips,
        captions: args.captions,
        headline: args.headline,
        cta: PODCAST_CTA,
        audioSrc: args.audioName,
        durationSec: args.durationSec,
        waveform: buildWaveform(args.captions).map((height, position) => ({ id: `bar-${position}`, height })),
        width: args.width,
        height: args.height,
        fps: args.fps,
    };
}

/** Avatar reel props: a full-frame synthesized presenter plus the shared caption/CTA furniture. */
export interface AvatarReelProps {
    /** Remotion's `Composition` requires its prop type to be an indexable record. */
    [key: string]: unknown;
    /** Public-dir-relative presenter clip name. */
    presenterClip: string;
    captions: CaptionChunk[];
    headline: string;
    cta: string;
    audioSrc: string;
    durationSec: number;
    waveform: WaveformBar[];
    width: number;
    height: number;
    fps: number;
}

/** Hybrid-PiP props: the editorial reel plus the bubble's presenter clip. */
export interface HybridPipReelProps extends EditorialReelProps {
    /** Public-dir-relative presenter clip name for the PiP bubble. */
    presenterClip: string;
}

/**
 * Avatar props (0452 R3): the synthesized presenter clip fills the frame. The layer must carry
 * exactly one clip — an avatar without a presenter is a broken video, so this fails closed.
 */
export function buildAvatarProps(args: {
    layer: VisualLayer;
    captions: CaptionChunk[];
    headline: string;
    audioName: string;
    durationSec: number;
    width: number;
    height: number;
    fps: number;
}): AvatarReelProps {
    const clip = requireSingleClip(args.layer, 'avatar');
    assertCaptionTrack(args.captions, args.durationSec);
    return {
        presenterClip: clip,
        captions: args.captions,
        headline: args.headline,
        cta: PODCAST_CTA,
        audioSrc: args.audioName,
        durationSec: args.durationSec,
        waveform: buildWaveform(args.captions).map((height, position) => ({ id: `bar-${position}`, height })),
        width: args.width,
        height: args.height,
        fps: args.fps,
    };
}

/** Hybrid-PiP props (0452 R3): the editorial reel plus the bubble's presenter clip. */
export function buildHybridPipProps(args: {
    layer: VisualLayer;
    presenterLayer: VisualLayer;
    captions: CaptionChunk[];
    headline: string;
    audioName: string;
    durationSec: number;
    width: number;
    height: number;
    fps: number;
}): HybridPipReelProps {
    const editorial = buildEditorialProps({
        layer: args.layer,
        captions: args.captions,
        headline: args.headline,
        audioName: args.audioName,
        durationSec: args.durationSec,
        width: args.width,
        height: args.height,
        fps: args.fps,
    });
    return { ...editorial, presenterClip: requireSingleClip(args.presenterLayer, 'hybrid-pip') };
}

function requireSingleClip(layer: VisualLayer, mode: string): string {
    if (layer.kind !== 'clips') {
        throw new Error(`video-gen: ${mode} needs a presenter clip layer, got a stills layer`);
    }
    const clip = layer.clips[0];
    if (clip === undefined || layer.clips.length !== 1) {
        throw new Error(`video-gen: ${mode} needs exactly one presenter clip (got ${layer.clips.length})`);
    }
    return clip;
}

function assertCaptionTrack(captions: readonly CaptionChunk[], durationSec: number): void {
    if (captions.length === 0) throw new Error('video-gen: reel needs at least one caption burst');
    if (!(durationSec > 0)) throw new Error(`video-gen: reel duration must be positive (got ${durationSec})`);
}
