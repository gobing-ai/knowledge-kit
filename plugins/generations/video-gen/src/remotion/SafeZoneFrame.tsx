import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { contentBox } from '../layout';

/**
 * Keeps every child inside the platform overlay margins (bottom 480px / right 162px) by rendering
 * into the content box rather than the full frame.
 */
export const SafeZoneFrame = ({ children }: { children: ReactNode }) => {
    const box = contentBox();
    return (
        <AbsoluteFill style={{ backgroundColor: '#070b10' }}>
            <div
                style={{
                    position: 'absolute',
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                    overflow: 'hidden',
                }}
            >
                {children}
            </div>
        </AbsoluteFill>
    );
};
