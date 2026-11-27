import { AbsoluteFill } from 'remotion';
import { activeCaptionAt, activeWordIndex, type CaptionChunk } from '../layout';

/**
 * Word-highlighted ZH/EN captions: the active burst renders as one line, the spoken word in the
 * accent colour. All timing math comes from `layout.ts`, so this file holds no branching logic.
 */
export const KineticCaptions = ({ captions, timeSec }: { captions: CaptionChunk[]; timeSec: number }) => {
    const chunk = activeCaptionAt(captions, timeSec);
    if (chunk === null) return null;
    const active = activeWordIndex(chunk, timeSec);
    return (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 40 }}>
            <div
                style={{
                    maxWidth: '88%',
                    padding: '18px 28px',
                    borderRadius: 24,
                    background: 'rgba(7, 11, 16, 0.72)',
                    color: '#f4f8ff',
                    fontSize: 56,
                    fontWeight: 700,
                    lineHeight: 1.25,
                    textAlign: 'center',
                    letterSpacing: 1,
                }}
            >
                {chunk.words.map((word) => (
                    <span
                        key={`${word.startSec}-${word.word}`}
                        style={{ color: chunk.words[active] === word ? '#3ddc97' : '#f4f8ff' }}
                    >
                        {word.word}
                    </span>
                ))}
            </div>
        </AbsoluteFill>
    );
};
