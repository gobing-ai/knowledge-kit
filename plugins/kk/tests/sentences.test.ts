import { describe, expect, test } from 'bun:test';
import { splitSentences } from '../scripts/sentences';

describe('plugins/kk/scripts/sentences.ts (mirrors packages/kk-core/src/sentences.ts)', () => {
    test('splits nested quote example as one sentence', () => {
        const text = '「他说「第一句。第二句。」然后走了。下一句！」';
        expect(splitSentences(text)).toEqual(['「他说「第一句。第二句。」然后走了。下一句！」']);
    });

    test('splits dialogue with attribution into two sentences', () => {
        const text = '“很好。”他说。';
        expect(splitSentences(text)).toEqual(['“很好。”', '他说。']);
        expect(splitSentences(text).join('')).toBe(text);
    });

    test('never splits dotted brand name Character.AI', () => {
        const text = 'Character.AI 宣布破产。';
        expect(splitSentences(text)).toEqual(['Character.AI 宣布破产。']);
    });

    test('en text splits after sentence dot but preserves Character.AI and v1.2', () => {
        const text = 'Disney bought Character.AI. Then v1.2 shipped!';
        expect(splitSentences(text)).toEqual(['Disney bought Character.AI.', 'Then v1.2 shipped!']);
    });

    test('preserves llama.cpp and LWN.net without premature splitting', () => {
        const text = 'llama.cpp runs on LWN.net. ok';
        expect(splitSentences(text)).toEqual(['llama.cpp runs on LWN.net.', 'ok']);
    });

    test('dotted tokens whatmodel.sh, claude.dev, 3.6% never split mid-token', () => {
        const text = 'whatmodel.sh and claude.dev and 3.6% are mentioned. Next.';
        expect(splitSentences(text)).toEqual(['whatmodel.sh and claude.dev and 3.6% are mentioned.', 'Next.']);
    });

    test('keeps run of closing quotes/brackets attached to preceding sentence', () => {
        expect(splitSentences('他说：“很好！”真的。')).toEqual(['他说：“很好！”', '真的。']);
        expect(splitSentences('“第一句。””第二句。”')).toEqual(['“第一句。””', '第二句。”']);
        expect(splitSentences('（第一句。）第二句。')).toEqual(['（第一句。）', '第二句。']);
        expect(splitSentences('(First sentence.) Second.')).toEqual(['(First sentence.)', 'Second.']);
        expect(splitSentences('He said: "Great!" Really.')).toEqual(['He said: "Great!"', 'Really.']);
    });

    test('unbalanced quote treats the rest as one sentence', () => {
        const text = '他说「第一句。第二句。';
        expect(splitSentences(text)).toEqual(['他说「第一句。第二句。']);
    });

    test('handles empty and whitespace strings', () => {
        expect(splitSentences('')).toEqual([]);
        expect(splitSentences('   \n\t  ')).toEqual([]);
    });

    test('joining zh sentences with empty string loses no non-whitespace characters', () => {
        const text = '第一句。第二句！第三句？第四句。';
        expect(splitSentences(text).join('')).toBe(text);
    });

    test('cjkOnly keeps an English body as one unit and splits only on 。！？', () => {
        const en = 'The U.S. military struck tankers. It escalated.';
        expect(splitSentences(en, { cjkOnly: true })).toEqual([en]);
        expect(splitSentences('他说：“很好。”然后 v1.2 发布了！Character.AI 破产。', { cjkOnly: true })).toEqual([
            '他说：“很好。”',
            '然后 v1.2 发布了！',
            'Character.AI 破产。',
        ]);
    });
});
