import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { WaveformBar as WaveformBarModel } from '../props';

/** Deterministic bar strip: heights come from the props, the frame only shifts which bar leads. */
export const WaveformBar = ({ waveform }: { waveform: WaveformBarModel[] }) => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();
    const active = Math.floor((frame * waveform.length) / durationInFrames);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 96, justifyContent: 'center' }}>
            {waveform.map((bar, position) => {
                const lead = position === active;
                return (
                    <div
                        key={bar.id}
                        style={{
                            width: 8,
                            height: Math.max(8, Math.round(bar.height * 96)),
                            borderRadius: 4,
                            background: lead ? '#3ddc97' : '#2f8f6a',
                            opacity: lead ? 1 : 0.75,
                        }}
                    />
                );
            })}
        </div>
    );
};
