/**
 * Pure layout, hook-window, caption-chunking and waveform math for the 9:16 short.
 *
 * WHY pure: bun enforces 90% per *loaded* file, and `.tsx` components only load inside a real
 * Remotion render. Every branch a reviewer would want tested lives here, in modules the fast tier
 * loads; the composition files stay declarative.
 */

/** The composition id registered in the Remotion root and selected by the renderer. */
export const COMPOSITION_ID = 'EditorialReel';

/** Full-frame avatar composition id (0452). */
export const AVATAR_COMPOSITION_ID = 'AvatarReel';

/** Hybrid-PiP composition id (0452). */
export const HYBRID_PIP_COMPOSITION_ID = 'HybridPipReel';

/** The one output geometry every channel accepts (Shipinhao / XHS / Shorts). */
export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;

/** Platform UI overlay margins: nothing renders inside the bottom 480px or the right 162px. */
export const SAFE_ZONE = { bottomPx: 480, rightPx: 162 } as const;

/** Teaser-cadence bounds: shorter than 45s reads as an incomplete hook, longer than 60s loses retention. */
export const HOOK_MIN_SEC = 45;
export const HOOK_MAX_SEC = 60;

/** Axis-aligned layout box in output pixels. */
export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Teaser window inside the episode audio. */
export interface HookWindow {
    startSec: number;
    endSec: number;
}

/** One aligned word from the whisper worker. */
export interface WordTimestamp {
    word: string;
    startSec: number;
    endSec: number;
}

/** One on-screen caption burst: the words that appear together. */
export interface CaptionChunk {
    text: string;
    startSec: number;
    endSec: number;
    words: WordTimestamp[];
}

/** Default caption burst width in characters — two ZH lines at the template's 64px caption size. */
export const CAPTION_MAX_CHARS = 16;
/** A silence longer than this starts a new caption burst. */
export const CAPTION_MAX_GAP_SEC = 0.6;
const SENTENCE_END = /[。．.!?！？；;]$/;

/**
 * True when a box touches a platform overlay margin. Both zones are inclusive at the boundary:
 * a box ending exactly at y=1440 clears the bottom zone.
 */
export function intersectsSafeZone(box: Box): boolean {
    const maxX = VIDEO.width - SAFE_ZONE.rightPx;
    const maxY = VIDEO.height - SAFE_ZONE.bottomPx;
    return box.x + box.width > maxX || box.y + box.height > maxY;
}

/** Throw when a box intrudes on a platform overlay margin; `label` names it in the message. */
export function assertInSafeArea(box: Box, label = 'box'): void {
    if (intersectsSafeZone(box)) {
        throw new Error(
            `video-gen: ${label} at x=${box.x}, y=${box.y}, ${box.width}x${box.height} intrudes on the platform safe zone (bottom ${SAFE_ZONE.bottomPx}px / right ${SAFE_ZONE.rightPx}px)`,
        );
    }
}

/** Circular presenter bubble diameter (0452 design). */
export const PIP_DIAMETER_PX = 320;
/** Gap between the bubble and the reserved overlay margins. */
export const PIP_GAP_PX = 48;

/**
 * The hybrid-PiP presenter bubble: a circle anchored bottom-left, clear of the bottom overlay zone.
 * Geometry lives here (not in `.tsx`) so `assertInSafeArea` can prove it in the fast tier.
 */
export function pipBox(): Box {
    const y = VIDEO.height - SAFE_ZONE.bottomPx - PIP_GAP_PX - PIP_DIAMETER_PX;
    return { x: PIP_GAP_PX, y, width: PIP_DIAMETER_PX, height: PIP_DIAMETER_PX };
}

/** The persistent "AI生成" disclosure chip: top-left, inside the safe area. */
export function aiLabelBox(): Box {
    return { x: PIP_GAP_PX, y: PIP_GAP_PX, width: 208, height: 56 };
}

/** The drawable content area: everything the shell may use once both overlay margins are reserved. */
export function contentBox(): Box {
    return { x: 0, y: 0, width: VIDEO.width - SAFE_ZONE.rightPx, height: VIDEO.height - SAFE_ZONE.bottomPx };
}

function assertPositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`video-gen: ${label} must be a positive number of seconds (got ${value})`);
    }
}

/**
 * Derive the teaser window from the episode length: start at 0 (the hook is the cold open) and take
 * the 45–60s head of the episode.
 */
export function deriveHookWindow(audioDurationSec: number): HookWindow {
    assertPositiveFinite(audioDurationSec, 'audio duration');
    if (audioDurationSec < HOOK_MIN_SEC) {
        throw new Error(
            `video-gen: episode audio is ${audioDurationSec.toFixed(1)}s, shorter than the ${HOOK_MIN_SEC}s teaser minimum`,
        );
    }
    return { startSec: 0, endSec: Math.min(HOOK_MAX_SEC, audioDurationSec) };
}

/** Validate an explicit hook window against the 45–60s cadence and the available audio (fail closed). */
export function validateHookWindow(hook: HookWindow, audioDurationSec: number): HookWindow {
    assertPositiveFinite(audioDurationSec, 'audio duration');
    if (!Number.isFinite(hook.startSec) || hook.startSec < 0) {
        throw new Error(`video-gen: hook.startSec must be >= 0 (got ${hook.startSec})`);
    }
    const length = hook.endSec - hook.startSec;
    if (length < HOOK_MIN_SEC || length > HOOK_MAX_SEC) {
        throw new Error(
            `video-gen: hook window is ${length.toFixed(1)}s; the teaser must be ${HOOK_MIN_SEC}–${HOOK_MAX_SEC}s`,
        );
    }
    if (hook.endSec > audioDurationSec) {
        throw new Error(
            `video-gen: hook window ends at ${hook.endSec}s but the episode audio is only ${audioDurationSec.toFixed(1)}s`,
        );
    }
    return { startSec: hook.startSec, endSec: hook.endSec };
}

/** Pick the teaser window: an explicit request wins, otherwise the derived 45–60s head. */
export function resolveHookWindow(
    requested: HookWindow | undefined,
    audioDurationSec: number,
): HookWindow & { durationSec: number } {
    const window = requested ? validateHookWindow(requested, audioDurationSec) : deriveHookWindow(audioDurationSec);
    return { ...window, durationSec: window.endSec - window.startSec };
}

/**
 * Group aligned words into caption bursts: a new burst starts at a sentence end, after a silence
 * longer than {@link CAPTION_MAX_GAP_SEC}, or when the next word would overflow
 * {@link CAPTION_MAX_CHARS}.
 */
export function chunkCaptions(words: readonly WordTimestamp[], maxChars = CAPTION_MAX_CHARS): CaptionChunk[] {
    const chunks: CaptionChunk[] = [];
    let current: WordTimestamp[] = [];
    const flush = () => {
        if (current.length === 0) return;
        const first = current[0] as WordTimestamp;
        const last = current[current.length - 1] as WordTimestamp;
        chunks.push({
            text: current.map((w) => w.word).join(''),
            startSec: first.startSec,
            endSec: last.endSec,
            words: current,
        });
        current = [];
    };
    for (const word of words) {
        const previous = current[current.length - 1];
        const gap = previous ? word.startSec - previous.endSec : 0;
        const text = current.map((w) => w.word).join('');
        if (
            previous &&
            (gap > CAPTION_MAX_GAP_SEC || SENTENCE_END.test(previous.word) || text.length + word.word.length > maxChars)
        ) {
            flush();
        }
        current.push(word);
    }
    flush();
    return chunks;
}

/** The caption burst visible at `timeSec`, or `null` between bursts. */
export function activeCaptionAt(chunks: readonly CaptionChunk[], timeSec: number): CaptionChunk | null {
    for (const chunk of chunks) {
        if (timeSec >= chunk.startSec && timeSec < chunk.endSec) return chunk;
    }
    return null;
}

/** Index of the word being spoken inside a burst (`-1` before the first word starts). */
export function activeWordIndex(chunk: CaptionChunk, timeSec: number): number {
    let index = -1;
    for (let i = 0; i < chunk.words.length; i += 1) {
        const word = chunk.words[i] as WordTimestamp;
        if (timeSec >= word.startSec) index = i;
    }
    return index;
}

/**
 * Deterministic waveform heights (0..1) for the audio bar: one bar per caption burst, scaled by that
 * burst's speaking rate so the bar visibly reacts without touching the audio samples.
 */
export function buildWaveform(chunks: readonly CaptionChunk[], bars = 48): number[] {
    const count = bars > 0 && Number.isFinite(bars) ? Math.floor(bars) : 0;
    if (count === 0) return [];
    if (chunks.length === 0) return Array.from({ length: count }, () => 0.2);
    return Array.from({ length: count }, (_, index) => {
        const chunk = chunks[index % chunks.length] as CaptionChunk;
        const span = Math.max(chunk.endSec - chunk.startSec, 0.001);
        const rate = chunk.words.length / span;
        return Math.min(1, Math.max(0.15, Number((rate / 8).toFixed(3))));
    });
}
