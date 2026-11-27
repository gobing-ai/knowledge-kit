import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { pipBox } from '../layout';
import type { HybridPipReelProps } from '../props';
import { AiLabel } from './AiLabel';
import { EditorialReel } from './EditorialReel';

/**
 * Hybrid-PiP reel (0452 R3): the editorial canvas with a circular MuseTalk host bubble. The circle
 * sits at `pipBox()` — clear of the bottom/right overlay margins by construction — over the same
 * safe-zone shell, and carries the always-on `AI生成` label because the bubble is a synthesized
 * likeness.
 */
export const HybridPipReel = (props: HybridPipReelProps) => {
    const box = pipBox();
    return (
        <AbsoluteFill>
            <EditorialReel {...props} />
            <AbsoluteFill style={{ pointerEvents: 'none' }}>
                <div
                    style={{
                        position: 'absolute',
                        left: box.x,
                        top: box.y,
                        width: box.width,
                        height: box.height,
                        borderRadius: '50%',
                        overflow: 'hidden',
                        border: '4px solid rgba(244, 248, 255, 0.85)',
                        boxShadow: '0 12px 32px rgba(7, 11, 16, 0.55)',
                    }}
                >
                    <OffthreadVideo
                        src={staticFile(props.presenterClip)}
                        muted
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                </div>
            </AbsoluteFill>
            <AiLabel />
        </AbsoluteFill>
    );
};
