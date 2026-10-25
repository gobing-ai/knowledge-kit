/**
 * Quote-aware sentence splitting (2026-10-24).
 *
 * NOTE: This file mirrors `packages/kk-core/src/sentences.ts`. It exists as a separate script file
 * because `plugins/kk/scripts/daily-stages.ts` runs from the installed package or from standalone
 * runner invocations with Node/Bun builtins only and cannot import `@gobing-ai/kk-core`.
 * Keep the algorithm and behaviors in sync between both files.
 *
 * Rules:
 * - splits after 。！？ (CJK) always, and after `.`/`!`/`?` only when followed by whitespace or end of text
 *   (so Character.AI, llama.cpp, LWN.net, whatmodel.sh, claude.dev, v1.2, 3.6% never split);
 * - keeps any run of closing quotes/brackets ( ” ’ 」 』 ） ) " ' ) attached to the preceding sentence;
 * - never splits while inside an open 「」, 『』, “”, （） pair (track depth; unbalanced → treat the rest as one sentence);
 * - trims each sentence, drops empties; joining the results with '' (zh) loses no non-whitespace characters.
 * - `{ cjkOnly: true }` splits only on 。！？ — the zh/ja briefing paths, where an English body must
 *   stay one unit (its first-two-sentences cut would otherwise glue "vtables.It" and split "U.S.").
 */

const CJK_TERMINATORS = new Set(['。', '！', '？']);
const LATIN_TERMINATORS = new Set(['.', '!', '?']);
const ATTACHED_CLOSERS = new Set(['”', '’', '」', '』', '）', ')', '"', "'"]);

const OPEN_PAIRS: Record<string, string> = {
    '「': '」',
    '『': '』',
    '“': '”',
    '（': '）',
    '(': ')',
};

/** Splitter options; `cjkOnly` drops the Latin `.!?` terminators (zh/ja split only on 。！？). */
export interface SplitSentencesOptions {
    cjkOnly?: boolean;
}

const CLOSE_PAIRS: Record<string, string> = {
    '」': '「',
    '』': '『',
    '”': '“',
    '）': '（',
    ')': '(',
};

/**
 * Splits text into complete sentences while respecting CJK/Latin terminators,
 * attached closing quotes, and nested quote/bracket pairs.
 */
export function splitSentences(text: string, options: SplitSentencesOptions = {}): string[] {
    if (!text || typeof text !== 'string') return [];
    const results: string[] = [];
    let sentenceStart = 0;
    let stack: string[] = [];
    let i = 0;
    const isTerminator = (c: string): boolean =>
        CJK_TERMINATORS.has(c) || (options.cjkOnly !== true && LATIN_TERMINATORS.has(c));

    while (i < text.length) {
        const ch = text[i] as string;

        if (isTerminator(ch)) {
            let termEnd = i;
            let hasCjkTerm = false;
            let hasLatinTerm = false;
            while (termEnd < text.length) {
                const termChar = text[termEnd];
                if (!termChar || !isTerminator(termChar)) {
                    break;
                }
                if (CJK_TERMINATORS.has(termChar)) hasCjkTerm = true;
                if (LATIN_TERMINATORS.has(termChar)) hasLatinTerm = true;
                termEnd++;
            }

            let closerEnd = termEnd;
            const tempStack = [...stack];
            while (closerEnd < text.length) {
                const closer = text[closerEnd];
                if (!closer || !ATTACHED_CLOSERS.has(closer)) {
                    break;
                }
                const top = tempStack[tempStack.length - 1];
                if (top !== undefined && top === closer) {
                    tempStack.pop();
                } else if (CLOSE_PAIRS[closer]) {
                    const idx = tempStack.lastIndexOf(closer);
                    if (idx >= 0) tempStack.splice(idx, 1);
                }
                closerEnd++;
            }

            let isBoundary = false;
            if (tempStack.length === 0) {
                if (hasCjkTerm) {
                    isBoundary = true;
                } else if (hasLatinTerm) {
                    const nextChar = text[closerEnd];
                    if (closerEnd === text.length || (nextChar !== undefined && /\s/.test(nextChar))) {
                        isBoundary = true;
                    }
                }
            }

            if (isBoundary) {
                const sentence = text.slice(sentenceStart, closerEnd).trim();
                if (sentence.length > 0) {
                    results.push(sentence);
                }
                sentenceStart = closerEnd;
                stack = tempStack;
                i = closerEnd;
                continue;
            }
        }

        const openMatch = OPEN_PAIRS[ch];
        const closeMatch = CLOSE_PAIRS[ch];
        if (openMatch) {
            stack.push(openMatch);
        } else if (closeMatch) {
            const idx = stack.lastIndexOf(ch);
            if (idx >= 0) stack.splice(idx, 1);
        }
        i++;
    }

    if (sentenceStart < text.length) {
        const tail = text.slice(sentenceStart).trim();
        if (tail.length > 0) {
            results.push(tail);
        }
    }

    return results;
}
