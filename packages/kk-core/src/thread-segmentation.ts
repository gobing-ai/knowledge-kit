/**
 * @gobing-ai/kk-core — deterministic, invariant-preserving thread segmentation engine.
 * Sourced from production thread splitting patterns with strict mathematical invariant:
 * segments.join('') === originalText
 */

import { type ContentCountUnit, countContentUnits } from './content-limits';

/** Options controlling thread segmentation thresholds and units. */
export interface ThreadSplitOptions {
    readonly maxUnits: number;
    readonly unit: ContentCountUnit;
}

/** Result of splitting text into thread segments. */
export interface ThreadSplitResult {
    readonly segments: readonly string[];
    readonly reconstructed: boolean;
    readonly characterCounts: readonly number[];
}

const URL_PATTERN = /https?:\/\/[^\s]+/giu;
const PARAGRAPH_PATTERN = /(?:\r\n|\r|\n)[\t ]*(?:\r\n|\r|\n)+/gu;
const SENTENCE_PATTERN = /[。！？!?；;]+[”’」』）》】〕］）"'…]*/gu;
const NEWLINE_PATTERN = /\r\n|\r|\n/gu;
const SPACE_PATTERN = /[\t ]+/gu;

interface Range {
    start: number;
    end: number;
}

function utf16IndexToCodePointOffset(text: string, utf16Index: number): number {
    return Array.from(text.slice(0, utf16Index)).length;
}

function collectBreakOffsets(text: string, pattern: RegExp): number[] {
    const offsets: number[] = [];
    for (const match of text.matchAll(pattern)) {
        const idx = match.index ?? 0;
        offsets.push(utf16IndexToCodePointOffset(text, idx + match[0].length));
    }
    return offsets;
}

function collectUrlRanges(text: string): Range[] {
    const ranges: Range[] = [];
    for (const match of text.matchAll(URL_PATTERN)) {
        const start = utf16IndexToCodePointOffset(text, match.index ?? 0);
        const len = Array.from(match[0]).length;
        ranges.push({ start, end: start + len });
    }
    return ranges;
}

function isInsideRange(offset: number, ranges: readonly Range[]): boolean {
    return ranges.some((r) => offset > r.start && offset < r.end);
}

/**
 * Deterministically splits text into thread segments respecting platform character limits,
 * protecting URLs from corruption, and strictly preserving the original text.
 */
export function splitThreadContent(text: string, options: ThreadSplitOptions): ThreadSplitResult {
    const rawText = String(text ?? '');
    if (!rawText) {
        return {
            segments: [''],
            reconstructed: true,
            characterCounts: [0],
        };
    }

    const totalUnits = countContentUnits(rawText, options.unit);
    if (totalUnits <= options.maxUnits) {
        return {
            segments: [rawText],
            reconstructed: true,
            characterCounts: [totalUnits],
        };
    }

    const codePointLength = Array.from(rawText).length;
    const urlRanges = collectUrlRanges(rawText);

    // Collect candidate break offsets by descending priority
    const paragraphBreaks = collectBreakOffsets(rawText, PARAGRAPH_PATTERN);
    const sentenceBreaks = collectBreakOffsets(rawText, SENTENCE_PATTERN);
    const newlineBreaks = collectBreakOffsets(rawText, NEWLINE_PATTERN);
    const spaceBreaks = collectBreakOffsets(rawText, SPACE_PATTERN);

    const segments: string[] = [];
    let currentCodePointCursor = 0;

    while (currentCodePointCursor < codePointLength) {
        const remainingChars = Array.from(rawText).slice(currentCodePointCursor).join('');
        const remainingUnits = countContentUnits(remainingChars, options.unit);
        if (remainingUnits <= options.maxUnits) {
            segments.push(remainingChars);
            break;
        }

        // Find best break point ahead of currentCodePointCursor
        let bestBreak = -1;

        // Try candidate break categories in order of preference
        const categories = [paragraphBreaks, sentenceBreaks, newlineBreaks, spaceBreaks];

        for (const candidates of categories) {
            for (const offset of candidates) {
                if (offset <= currentCodePointCursor) continue;
                if (isInsideRange(offset, urlRanges)) continue;

                const candidateSlice = Array.from(rawText).slice(currentCodePointCursor, offset).join('');
                const candidateUnits = countContentUnits(candidateSlice, options.unit);

                if (candidateUnits <= options.maxUnits && offset > bestBreak) {
                    bestBreak = offset;
                }
            }
            if (bestBreak > currentCodePointCursor) {
                break;
            }
        }

        // Fallback: binary search or step back code points if no natural delimiter fits
        if (bestBreak <= currentCodePointCursor) {
            let low = currentCodePointCursor + 1;
            let high = codePointLength;
            let lastValid = currentCodePointCursor + 1;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const slice = Array.from(rawText).slice(currentCodePointCursor, mid).join('');
                const units = countContentUnits(slice, options.unit);

                if (units <= options.maxUnits) {
                    if (!isInsideRange(mid, urlRanges)) {
                        lastValid = mid;
                    }
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            bestBreak = lastValid;
        }

        const segment = Array.from(rawText).slice(currentCodePointCursor, bestBreak).join('');
        segments.push(segment);
        currentCodePointCursor = bestBreak;
    }

    const reconstructed = segments.join('') === rawText;
    const characterCounts = segments.map((s) => countContentUnits(s, options.unit));

    return {
        segments,
        reconstructed,
        characterCounts,
    };
}
