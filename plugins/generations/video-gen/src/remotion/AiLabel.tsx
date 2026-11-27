import { AbsoluteFill } from 'remotion';
import { aiLabelBox } from '../layout';

/**
 * The persistent synthetic-media disclosure (0452 R6): a chip anchored at `aiLabelBox()` inside the
 * safe area, drawn on every avatar and hybrid-PiP frame. Always on — the label is a legal
 * requirement for lip-synced likenesses, not a stylistic choice.
 */
export const AiLabel = () => {
    const box = aiLabelBox();
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            <div
                style={{
                    position: 'absolute',
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    background: 'rgba(7, 11, 16, 0.72)',
                    border: '2px solid rgba(244, 248, 255, 0.55)',
                    color: '#f4f8ff',
                    fontSize: 28,
                    fontWeight: 700,
                    letterSpacing: 2,
                }}
            >
                AI生成
            </div>
        </AbsoluteFill>
    );
};
