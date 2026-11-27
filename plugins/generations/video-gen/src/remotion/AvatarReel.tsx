import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { AvatarReelProps } from '../props';
import { AiLabel } from './AiLabel';
import { KineticCaptions } from './KineticCaptions';
import { SafeZoneFrame } from './SafeZoneFrame';
import { WaveformBar } from './WaveformBar';

const CTA_TAIL_SEC = 3.5;

/**
 * Full-frame presenter reel (0452 R3): the synthesized host clip fills the safe area with kinetic
 * captions, a waveform strip, the CTA tail and the always-on `AI生成` label.
 */
export const AvatarReel = (props: AvatarReelProps) => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const timeSec = frame / fps;
    const ctaFrom = Math.max(0, durationInFrames - Math.round(CTA_TAIL_SEC * fps));

    return (
        <SafeZoneFrame>
            <Audio src={staticFile(props.audioSrc)} />
            <AbsoluteFill style={{ overflow: 'hidden' }}>
                <OffthreadVideo
                    src={staticFile(props.presenterClip)}
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
            </AbsoluteFill>
            <AbsoluteFill style={{ alignItems: 'center', paddingTop: 72 }}>
                <div
                    style={{
                        maxWidth: '86%',
                        padding: '18px 26px',
                        borderRadius: 20,
                        background: 'rgba(7, 11, 16, 0.72)',
                        color: '#f4f8ff',
                        fontSize: 50,
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
                        fontSize: 46,
                        fontWeight: 700,
                        textAlign: 'center',
                        padding: 48,
                    }}
                >
                    {props.cta}
                </AbsoluteFill>
            </Sequence>
            <AiLabel />
        </SafeZoneFrame>
    );
};
