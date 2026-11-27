import {
    AbsoluteFill,
    Audio,
    Img,
    interpolate,
    OffthreadVideo,
    Sequence,
    staticFile,
    useCurrentFrame,
    useVideoConfig,
} from 'remotion';
import type { EditorialReelProps } from '../props';
import { KineticCaptions } from './KineticCaptions';
import { SafeZoneFrame } from './SafeZoneFrame';
import { WaveformBar } from './WaveformBar';

const CTA_TAIL_SEC = 3.5;

/**
 * The 9:16 editorial shell: Ken-Burns stills under a headline card, kinetic captions, a waveform
 * strip, and a podcast CTA tail. Every still gets an equal slice of the teaser; the pan/zoom is a
 * frame interpolation of the slice, not a video decode.
 */
export const EditorialReel = (props: EditorialReelProps) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const timeSec = frame / fps;
    // A clip reel (Wan2.1 I2V, 0451) and a stills reel share the shell; only the slide differs.
    const slides = props.clips.length > 0 ? props.clips : props.images;
    const framesPerSlide = Math.ceil(durationInFrames / Math.max(slides.length, 1));
    const ctaFrom = Math.max(0, durationInFrames - Math.round(CTA_TAIL_SEC * fps));

    return (
        <SafeZoneFrame>
            <Audio src={staticFile(props.audioSrc)} />
            {slides.map((name, index) => {
                const from = index * framesPerSlide;
                const isClip = props.clips.length > 0;
                return (
                    <Sequence key={name} from={from} durationInFrames={framesPerSlide}>
                        {isClip ? (
                            <AbsoluteFill style={{ overflow: 'hidden' }}>
                                <OffthreadVideo
                                    src={staticFile(name)}
                                    muted
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            </AbsoluteFill>
                        ) : (
                            <StillSlide src={staticFile(name)} index={index} />
                        )}
                    </Sequence>
                );
            })}
            <AbsoluteFill style={{ alignItems: 'center', paddingTop: 72 }}>
                <div
                    style={{
                        maxWidth: '86%',
                        padding: '20px 28px',
                        borderRadius: 20,
                        background: 'rgba(7, 11, 16, 0.78)',
                        color: '#f4f8ff',
                        fontSize: 54,
                        fontWeight: 800,
                        lineHeight: 1.2,
                        textAlign: 'center',
                    }}
                >
                    {props.headline}
                </div>
            </AbsoluteFill>
            <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.9 }}>
                <WaveformBar waveform={props.waveform} />
            </AbsoluteFill>
            <KineticCaptions captions={props.captions} timeSec={timeSec} />
            <Sequence from={ctaFrom} durationInFrames={Math.max(1, durationInFrames - ctaFrom)}>
                <AbsoluteFill
                    style={{
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(7, 11, 16, 0.82)',
                        color: '#3ddc97',
                        fontSize: 48,
                        fontWeight: 700,
                        textAlign: 'center',
                        padding: 48,
                    }}
                >
                    {props.cta}
                </AbsoluteFill>
            </Sequence>
        </SafeZoneFrame>
    );
};

/** One Ken-Burns pass: slow scale-up plus a drift whose direction alternates per still. */
const StillSlide = ({ src, index }: { src: string; index: number }) => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();
    const progress = interpolate(frame, [0, Math.max(durationInFrames - 1, 1)], [0, 1], { extrapolateRight: 'clamp' });
    const scale = 1.06 + progress * 0.12;
    const shiftX = (index % 2 === 0 ? 1 : -1) * progress * 36;
    const shiftY = (index % 3 === 0 ? -1 : 1) * progress * 28;
    return (
        <AbsoluteFill style={{ overflow: 'hidden' }}>
            <Img
                src={src}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    transform: `translate(${shiftX}px, ${shiftY}px) scale(${scale})`,
                }}
            />
        </AbsoluteFill>
    );
};
