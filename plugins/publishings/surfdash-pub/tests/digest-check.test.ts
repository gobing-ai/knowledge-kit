import { describe, expect, test } from 'bun:test';
import { checkDigestFrontmatter, type DigestLocale, parseFrontmatterScalars } from '../src/digest-check';
import { SERIES_NAMES } from '../src/patch';

/**
 * Post-refine digest contract (2026-10-24): the surfdash refine step owns the digest
 * title/description/key_points; checkDigestFrontmatter re-verifies the values so a regressed
 * derivation fails the publish loud. Table-driven per rule, both passing and failing, including
 * the two real refined titles from the 2026-10-23 posts.
 */

/** Frontmatter wrapper: a digest post (the gate only applies to sub-category:ai-daily tags). */
const digest = (body: string): string => `---\ntags: ["ai-news", "sub-category:ai-daily"]\n${body}\n---\n\n正文。\n`;

/** A complete, contract-valid frontmatter per locale (mutated per rule by the cases). */
const valid = (locale: DigestLocale): string => {
    const series = SERIES_NAMES[locale];
    if (locale === 'zh') {
        return digest(
            [
                `title: "${series} · 2026-10-23：迪士尼买下 Character.AI、微软「医疗超级智能」"`,
                'description: "本期两条主线：迪士尼正式买下 Character.AI，微软推出「医疗超级智能」新模型。两家公司都把赌注押在个性化智能体上。完整分析见正文，详情逐条展开。"',
                'key_points:',
                '  - "迪士尼 — 迪士尼确认收购 Character.AI，交易已宣布。"',
                '  - "微软 — 微软发布「医疗超级智能」模型。"',
            ].join('\n'),
        );
    }
    if (locale === 'en') {
        return digest(
            [
                `title: "${series} · 2026-10-23: Disney buy, MS care AI"`,
                'description: "Disney agreed to buy Character.AI, while Microsoft shipped its care-focused superintelligence model. Both bets move daily AI products closer to people."',
                'key_points:',
                '  - "Disney — Disney confirmed the Character.AI acquisition today."',
                '  - "Microsoft — Microsoft launched its care superintelligence model."',
            ].join('\n'),
        );
    }
    return digest(
        [
            `title: "${series} · 2026-10-23：ディズニーが買収、マイクロソフトの医療AI"`,
            'description: "今号の本題は二つ：ディズニーがCharacter.AIの買収を決め、マイクロソフトは「医療スーパーインテリジェンス」を公開した。両社とも個別化エージェントに賭ける。詳しくは本文で順に述べる。"',
            'key_points:',
            '  - "ディズニー — ディズニーがCharacter.AIの買収を発表した。"',
            '  - "マイクロソフト — マイクロソフトが医療AIモデルを公開した。"',
        ].join('\n'),
    );
};

describe('checkDigestFrontmatter', () => {
    test('returns [] for non-digest posts whatever the metadata looks like', () => {
        const notDigest = (tags: string): string =>
            `---\ntags: ${tags}\ntitle: "whatever"\ndescription: "no rules apply"\n---\n\nBody\n`;
        for (const locale of ['zh', 'en', 'ja'] as const) {
            expect(checkDigestFrontmatter(notDigest('["ai-news"]'), locale)).toEqual([]);
            expect(checkDigestFrontmatter(notDigest('[]'), locale)).toEqual([]);
            expect(checkDigestFrontmatter('no frontmatter at all', locale)).toEqual([]);
        }
        expect(checkDigestFrontmatter(notDigest('["sub-category:ai-weekly"]'), 'zh')).toEqual([]);
    });

    test.each([['zh'], ['en'], ['ja']] as const)('%s: the valid baseline passes (real 2026-10-23 titles)', (locale) => {
        const markdown = valid(locale);
        if (locale === 'zh') {
            expect(markdown).toContain('每日AI乱炖 · 2026-10-23：迪士尼买下 Character.AI、微软「医疗超级智能」');
        }
        if (locale === 'en') {
            expect(markdown).toContain('Daily AI Stew · 2026-10-23: Disney buy, MS care AI');
        }
        expect(checkDigestFrontmatter(markdown, locale)).toEqual([]);
    });

    const titleFailures: Array<{ name: string; locale: DigestLocale; title: string; want: string }> = [
        {
            name: 'date-only title (the 2026-10-21 regression shape)',
            locale: 'zh',
            title: '每日AI乱炖 · 2026-10-23',
            want: 'expected',
        },
        { name: 'wrong series name', locale: 'zh', title: '每日AI速报 · 2026-10-23：a、b', want: 'expected' },
        { name: 'wrong date format', locale: 'zh', title: '每日AI乱炖 · 20261023：a、b', want: 'expected' },
        {
            name: 'wrong separator (latin colon)',
            locale: 'zh',
            title: '每日AI乱炖 · 2026-10-23: a、b',
            want: 'expected',
        },
        {
            name: 'three zh headlines',
            locale: 'zh',
            title: '每日AI乱炖 · 2026-10-23：一、二、三',
            want: 'got 3 in',
        },
        {
            name: 'empty zh headline',
            locale: 'zh',
            title: '每日AI乱炖 · 2026-10-23：一、',
            want: 'got 2 in',
        },
        {
            name: 'en with two ", " (three headlines)',
            locale: 'en',
            title: 'Daily AI Stew · 2026-10-23: A, B, C',
            want: 'got 3 in',
        },
        { name: 'en date-only regression shape', locale: 'en', title: 'Daily AI Stew · 2026-10-23', want: 'expected' },
    ];
    test.each(titleFailures)('title failing: $name', ({ locale, title, want }) => {
        const mutated = valid(locale).replace(/^title: .*$/m, `title: ${JSON.stringify(title)}`);
        const problems = checkDigestFrontmatter(mutated, locale);
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join('\n')).toContain(want);
    });

    // 0408 R1: the site's `seo retitle` collapses a title to ONE headline whenever two do not fit
    // its SEO budget (surfdash `check-digest.ts`), so the kk mirror accepts the 1..2 structural
    // range and leaves "were two owed?" to the site gate. Single headlines used to fail here.
    test.each([
        ['zh', '迪士尼买下 Character.AI'],
        ['en', 'Disney buy'],
        ['ja', 'ディズニーが買収'],
    ] as const)('%s: a single-headline title passes', (locale, headline) => {
        const titleSep = locale === 'en' ? ': ' : '：';
        const mutated = valid(locale).replace(
            /^title: .*$/m,
            () => `title: "${SERIES_NAMES[locale]} · 2026-10-23${titleSep}${headline}"`,
        );
        expect(checkDigestFrontmatter(mutated, locale)).toEqual([]);
        // The two-headline baseline still passes: the range is 1..2, not "anything".
        expect(checkDigestFrontmatter(valid(locale), locale)).toEqual([]);
    });

    test('title whose rendered "<title> | Surfing" exceeds 60 code points fails', () => {
        const long = '迪士尼买下 Character.AI、微软发布全新医疗超级智能体平台';
        const mutated = valid('zh').replace(/^title: .*$/m, `title: "每日AI乱炖 · 2026-10-23：${long}"`);
        expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('code points (max 60)');
        // The valid baseline stays within the budget.
        const seoTitle = `${SERIES_NAMES.zh} · 2026-10-23：迪士尼买下 Character.AI、微软「医疗超级智能」 | Surfing`;
        expect(Array.from(seoTitle).length).toBeLessThanOrEqual(60);
    });

    test('missing title is a problem', () => {
        const mutated = valid('zh').replace(/^title: .*$/m, '');
        expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('title: missing');
    });

    test.each([
        ['title', 'zh'],
        ['description', 'zh'],
        ['title', 'en'],
    ] as const)('ellipsis in %s is a problem (%s)', (field, locale) => {
        const mutated = valid(locale).replace(new RegExp(`^${field}: .*$`, 'm'), `${field}: "包含省略号…的内容。"`);
        expect(checkDigestFrontmatter(mutated, locale).join('\n')).toContain('…" or "..."');
        const dotted = valid(locale).replace(new RegExp(`^${field}: .*$`, 'm'), `${field}: "ends with three dots..."`);
        expect(checkDigestFrontmatter(dotted, locale).join('\n')).toContain('…" or "..."');
    });

    test('ellipsis inside a key_point is a problem', () => {
        const mutated = valid('zh').replace(/^\s{2}-\s+"迪士尼 — (.*)$/m, '  - "迪士尼 — 被裁剪的句子…。"');
        expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('key_points[0]: contains');
    });

    describe('description rules', () => {
        test('zh too short fails with the length window', () => {
            const mutated = valid('zh').replace(/^description: .*$/m, 'description: "太短。"');
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('code points (expected 70–100');
        });
        test('en too short fails with the en window', () => {
            const mutated = valid('en').replace(/^description: .*$/m, 'description: "Too short for en."');
            expect(checkDigestFrontmatter(mutated, 'en').join('\n')).toContain('code points (expected 120–155');
        });
        test('zh too long fails', () => {
            const long = `${'这句很长。'.repeat(25)}结尾。`;
            const mutated = valid('zh').replace(/^description: .*$/m, `description: ${JSON.stringify(long)}`);
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('code points (expected 70–100');
        });
        test('missing terminal punctuation fails', () => {
            const mutated = valid('zh').replace(
                /^description: .*$/m,
                'description: "没有句号结尾的描述，字数倒是足够撑过下限了，就这样吧"',
            );
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain(
                'does not end with sentence punctuation',
            );
        });
        test('zh description ending in 」 passes; en ending in ." passes', () => {
            const zhQuoted = valid('zh').replace(
                /^description: .*$/m,
                'description: "本期两条主线：迪士尼正式买下 Character.AI，微软推出「医疗超级智能」新模型。两家公司都把赌注押在「个性化智能体」上。完整分析见正文，详情逐条展开。"',
            );
            expect(checkDigestFrontmatter(zhQuoted, 'zh')).toEqual([]);
            const enQuoted = valid('en').replace(
                /^description: .*$/m,
                'description: \'Disney agreed to buy Character.AI, while Microsoft shipped its care model, a pair of bets the market read as "care AI going mainstream."\'',
            );
            expect(checkDigestFrontmatter(enQuoted, 'en')).toEqual([]);
        });
        test.each([
            ['这里是由Robin带来的播客更新', 'zh'],
            ['咸话咸说每日更新', 'zh'],
            ['This is Robin with the stew', 'en'],
            ['this is robin lowercase too', 'en'],
            ['Robin がお届けします', 'ja'],
        ] as const)('podcast-intro opening "%s" fails (%s)', (intro, locale) => {
            const tail =
                locale === 'en'
                    ? ' Disney agreed to buy Character.AI and Microsoft shipped its care model, with more analysis inside.'
                    : '，今天的内容继续展开说明，两条主线逐条展开分析完毕，详情见正文。';
            const mutated = valid(locale).replace(/^description: .*$/m, `description: ${JSON.stringify(intro + tail)}`);
            expect(checkDigestFrontmatter(mutated, locale).join('\n')).toContain('podcast intro');
        });
        test('a similar non-intro opening passes (only the listed intros are gated)', () => {
            const mutated = valid('zh').replace(
                /^description: .*$/m,
                'description: "这里是有话说，本期两条主线：迪士尼买下 Character.AI，微软推出「医疗超级智能」。两家公司都把赌注押在个性化智能体上，其余细节见正文展开。"',
            );
            expect(checkDigestFrontmatter(mutated, 'zh')).toEqual([]);
        });
        test('missing description is a problem', () => {
            const mutated = valid('zh').replace(/^description: .*$/m, '');
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('description: missing');
        });
        test('folded (>-) description parses and validates', () => {
            const folded = valid('zh').replace(
                /^description: .*$/m,
                'description: >-\n  本期两条主线：迪士尼正式买下 Character.AI，微软推出「医疗超级智能」新模型。\n  两家公司都把赌注押在个性化智能体上。完整分析见正文，详情逐条展开。',
            );
            expect(checkDigestFrontmatter(folded, 'zh')).toEqual([]);
            const foldedBad = valid('zh').replace(/^description: .*$/m, 'description: >-\n  太短。');
            expect(checkDigestFrontmatter(foldedBad, 'zh').join('\n')).toContain('code points');
        });
        test('single-quoted and plain scalars parse', () => {
            const plain = valid('zh')
                .replace(
                    /^title: .*$/m,
                    'title: 每日AI乱炖 · 2026-10-23：迪士尼买下 Character.AI、微软「医疗超级智能」',
                )
                .replace(/^(\s{2}-\s+)"迪士尼 — (.*)$/m, "$1'迪士尼 — 迪士尼确认收购 Character.AI，交易已宣布。'");
            expect(checkDigestFrontmatter(plain, 'zh')).toEqual([]);
        });
    });

    describe('key_points rules', () => {
        test('missing key_points is a problem', () => {
            const mutated = valid('zh').replace(/^key_points:[\s\S]*?(?=\n---)/m, '');
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('key_points: missing');
        });
        test('an item without " — " fails naming its index', () => {
            const mutated = valid('zh').replace(/^\s{2}-\s+"迪士尼 — (.*)$/m, '  - "没有分隔符的条目。"');
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain(
                'key_points[0]: missing " — " separator',
            );
        });
        test('a zh label over 14 code points fails', () => {
            const mutated = valid('zh').replace(
                /^\s{2}-\s+"迪士尼 — (.*)$/m,
                '  - "这是一个特别长的标签名称已超限 — 内容结束。"',
            );
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain('key_points[0]: label');
        });
        test('an en label over 28 code points fails', () => {
            const mutated = valid('en').replace(
                /^\s{2}-\s+"Disney — (.*)$/m,
                '  - "Disney completes the acquisition — Disney confirmed the buyout today."',
            );
            expect(checkDigestFrontmatter(mutated, 'en').join('\n')).toContain('key_points[0]: label');
        });
        test('text without terminal punctuation fails', () => {
            const mutated = valid('zh').replace(/^\s{2}-\s+"微软 — (.*)$/m, '  - "微软 — 发布了新模型"');
            expect(checkDigestFrontmatter(mutated, 'zh').join('\n')).toContain(
                'key_points[1]: text does not end with sentence punctuation',
            );
        });
        test('a zh point ending inside a closing quote passes', () => {
            const mutated = valid('zh').replace(/^\s{2}-\s+"微软 — (.*)$/m, '  - "微软 — 微软称「模型已上线」。"');
            expect(checkDigestFrontmatter(mutated, 'zh')).toEqual([]);
        });
    });

    test('block-list tags mark the digest just like flow arrays', () => {
        const blockTags = valid('zh').replace(/^tags: .*$/m, 'tags:\n  - ai-news\n  - sub-category:ai-daily');
        expect(checkDigestFrontmatter(blockTags, 'zh')).toEqual([]);
    });

    test('parseFrontmatterScalars covers unquote catch and empty block list', () => {
        const md = valid('zh')
            .replace(
                /^description: .*$/m,
                'description: "本期两条主线：迪士尼买下 Character.AI，微软推出「医疗超级智能」\\q。两家公司都把赌注押在个性化智能体上。完整分析见正文，详情逐条展开。"',
            )
            .replace(
                /^title: .*$/m,
                'empty_key:\ntitle: "每日AI乱炖 · 2026-10-23：迪士尼买下 Character.AI、微软「医疗超级智能」"',
            );
        const res = checkDigestFrontmatter(md, 'zh');
        expect(res).toEqual([]);
    });

    describe('block scalar list parsing', () => {
        test('keeps folded and literal sibling items separate and resumes at the next frontmatter key', () => {
            const markdown = [
                '---',
                'key_points:',
                '  - >-',
                '    Alpha — first sentence.',
                '    Alpha second sentence.',
                '  - >-',
                '    Beta — second sentence.',
                '  - |-',
                '    Gamma — literal first line.',
                '    Gamma literal second line.',
                '  - |-',
                '    Delta — fourth sentence.',
                'tags:',
                '  - sub-category:ai-daily',
                'publishDate: 2026-10-23',
                '---',
            ].join('\n');

            const frontmatter = parseFrontmatterScalars(markdown);

            expect(frontmatter.get('key_points')).toEqual([
                'Alpha — first sentence. Alpha second sentence.',
                'Beta — second sentence.',
                'Gamma — literal first line.\nGamma literal second line.',
                'Delta — fourth sentence.',
            ]);
            expect(frontmatter.get('tags')).toEqual(['sub-category:ai-daily']);
            expect(frontmatter.get('publishDate')).toBe('2026-10-23');
        });

        test('preserves folded paragraph breaks while folding adjacent lines', () => {
            const markdown = [
                '---',
                'description: >-',
                '  first paragraph line one.',
                '  first paragraph line two.',
                '',
                '  second paragraph line one.',
                '  second paragraph line two.',
                'tags: [sub-category:ai-daily]',
                '---',
            ].join('\n');

            expect(parseFrontmatterScalars(markdown).get('description')).toBe(
                'first paragraph line one. first paragraph line two.\nsecond paragraph line one. second paragraph line two.',
            );
        });
    });
});
