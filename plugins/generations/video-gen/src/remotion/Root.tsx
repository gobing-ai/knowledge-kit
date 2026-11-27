import { type AnyZodObject, Composition } from 'remotion';
import { AVATAR_COMPOSITION_ID, COMPOSITION_ID, HYBRID_PIP_COMPOSITION_ID } from '../layout';
import type { AvatarReelProps, EditorialReelProps, HybridPipReelProps } from '../props';
import { AvatarReel } from './AvatarReel';
import { EditorialReel } from './EditorialReel';
import { HybridPipReel } from './HybridPipReel';

/** Placeholder props: `calculateMetadata` replaces all of them from the render input. */
const DEFAULT_WAVEFORM = [{ id: 'bar-0', height: 0.2 }];
const DEFAULT_CAPTIONS = [{ text: '', startSec: 0, endSec: 1, words: [{ word: '', startSec: 0, endSec: 1 }] }];

const DEFAULT_PROPS: EditorialReelProps = {
    images: ['still-0.png'],
    clips: [],
    captions: DEFAULT_CAPTIONS,
    headline: '',
    cta: '',
    audioSrc: 'teaser.wav',
    durationSec: 50,
    waveform: DEFAULT_WAVEFORM,
    width: 1080,
    height: 1920,
    fps: 30,
};

const DEFAULT_AVATAR_PROPS: AvatarReelProps = {
    presenterClip: 'presenter.mp4',
    captions: DEFAULT_CAPTIONS,
    headline: '',
    cta: '',
    audioSrc: 'teaser.wav',
    durationSec: 50,
    waveform: DEFAULT_WAVEFORM,
    width: 1080,
    height: 1920,
    fps: 30,
};

const DEFAULT_HYBRID_PROPS: HybridPipReelProps = { ...DEFAULT_PROPS, presenterClip: 'presenter.mp4' };

/** Composition registry: the editorial shell plus the two avatar compositions (0452). */
export const RemotionRoot = () => (
    <>
        <Composition<AnyZodObject, EditorialReelProps>
            id={COMPOSITION_ID}
            component={EditorialReel}
            durationInFrames={DEFAULT_PROPS.durationSec * DEFAULT_PROPS.fps}
            fps={DEFAULT_PROPS.fps}
            width={DEFAULT_PROPS.width}
            height={DEFAULT_PROPS.height}
            defaultProps={DEFAULT_PROPS}
            calculateMetadata={({ props }) => ({
                durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
                fps: props.fps,
                width: props.width,
                height: props.height,
            })}
        />
        <Composition<AnyZodObject, AvatarReelProps>
            id={AVATAR_COMPOSITION_ID}
            component={AvatarReel}
            durationInFrames={DEFAULT_AVATAR_PROPS.durationSec * DEFAULT_AVATAR_PROPS.fps}
            fps={DEFAULT_AVATAR_PROPS.fps}
            width={DEFAULT_AVATAR_PROPS.width}
            height={DEFAULT_AVATAR_PROPS.height}
            defaultProps={DEFAULT_AVATAR_PROPS}
            calculateMetadata={({ props }) => ({
                durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
                fps: props.fps,
                width: props.width,
                height: props.height,
            })}
        />
        <Composition<AnyZodObject, HybridPipReelProps>
            id={HYBRID_PIP_COMPOSITION_ID}
            component={HybridPipReel}
            durationInFrames={DEFAULT_HYBRID_PROPS.durationSec * DEFAULT_HYBRID_PROPS.fps}
            fps={DEFAULT_HYBRID_PROPS.fps}
            width={DEFAULT_HYBRID_PROPS.width}
            height={DEFAULT_HYBRID_PROPS.height}
            defaultProps={DEFAULT_HYBRID_PROPS}
            calculateMetadata={({ props }) => ({
                durationInFrames: Math.max(1, Math.round(props.durationSec * props.fps)),
                fps: props.fps,
                width: props.width,
                height: props.height,
            })}
        />
    </>
);
