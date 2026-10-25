import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { DAILY_SERIES_NAMES, findRetiredSeriesNames, normalizeSeriesNames } from '../scripts/series-names';

/**
 * 2026-10-23 regression — the translate agent invented locale series names for the daily posts
 * (ja 毎日AIブレンド, en "Daily AI Medley"/"hodgepodge", zh-name listen links inside en/ja).
 * series-names.ts is the pure single table + deterministic rewrite the translate-sync gate runs
 * before the CMS sync; these tests pin every retired/wrong-locale token per locale, idempotence
 * and URL safety.
 */
describe('series-names (2026-10-23 retired-name regression)', () => {
    it('defines one canonical series/show pair per locale', () => {
        expect(DAILY_SERIES_NAMES).toEqual({
            zh: { series: '每日AI乱炖', show: '咸话咸说' },
            en: { series: 'Daily AI Stew', show: 'Salty Talk' },
            ja: { series: 'デイリーAIシチュー', show: '咸話咸説' },
        });
    });

    it('rewrites every retired and wrong-locale series token to the en canonical name', () => {
        for (const bad of [
            '每日AI乱炖',
            'デイリーAIシチュー',
            '毎日AIブレンド',
            'Daily AI Medley',
            'daily AI medley',
            'Daily AI Briefing',
            'AI 乱炖',
            'AI乱炖',
        ]) {
            const { markdown, remaining } = normalizeSeriesNames(
                `This is Robin's Salty Talk: the ${bad}. [listen to ${bad} · 2026-10-23](https://pod.example/i/1).`,
                'en',
            );
            expect(markdown, `en rewrite of ${bad}`).toBe(
                "This is Robin's Salty Talk: the Daily AI Stew. [listen to Daily AI Stew · 2026-10-23](https://pod.example/i/1).",
            );
            expect(remaining, `en remaining for ${bad}`).toEqual([]);
        }
    });

    it('leaves the ordinary ja word ごった煮 alone (vocabulary, not a series name)', () => {
        const text = '今週のニュースはまさにごった煮だ。';
        expect(normalizeSeriesNames(text, 'ja')).toEqual({ markdown: text, remaining: [] });
        expect(findRetiredSeriesNames(text, 'ja')).toEqual([]);
    });

    it('rewrites every retired and wrong-locale series token to the ja canonical name', () => {
        for (const bad of [
            '毎日AIブレンド',
            '每日AI乱炖',
            'Daily AI Stew',
            'Daily AI Medley',
            'Daily AI Briefing',
            'AI 乱炖',
        ]) {
            const { markdown, remaining } = normalizeSeriesNames(
                `咸話咸説の${bad}、Robin がお届けします。[${bad} · 2026-10-23 を聴く](https://pod.example/i/1)。`,
                'ja',
            );
            expect(markdown, `ja rewrite of ${bad}`).toBe(
                '咸話咸説のデイリーAIシチュー、Robin がお届けします。[デイリーAIシチュー · 2026-10-23 を聴く](https://pod.example/i/1)。',
            );
            expect(remaining, `ja remaining for ${bad}`).toEqual([]);
        }
    });

    it('rewrites the short/spaced zh form to the full zh name without doubling 每日', () => {
        for (const bad of [
            '咸话咸说之AI乱炖',
            '咸话咸说之AI 乱炖',
            '咸话咸说之Daily AI Stew',
            '咸话咸说之毎日AIブレンド',
        ]) {
            expect(normalizeSeriesNames(`${bad}。`, 'zh').markdown, `zh rewrite of ${bad}`).toBe(
                '咸话咸说之每日AI乱炖。',
            );
        }
        // The already-correct full form is stable — no double 每日 prefix.
        expect(normalizeSeriesNames('咸话咸说之每日AI乱炖。', 'zh').markdown).toBe('咸话咸说之每日AI乱炖。');
    });

    it('rewrites the observed en intro phrasing, not just the bare name', () => {
        expect(normalizeSeriesNames('Your daily AI hodgepodge from Robin, on Salty Talk.', 'en').markdown).toBe(
            'Your Daily AI Stew from Robin, on Salty Talk.',
        );
        expect(normalizeSeriesNames("Robin's daily AI hodgepodge of models.", 'en').markdown).toBe(
            "Robin's Daily AI Stew of models.",
        );
    });

    it('is idempotent per locale over a kitchen-sink document', () => {
        const doc = [
            '---',
            'title: Daily AI Medley · 2026-10-23',
            '---',
            '',
            'Your daily AI hodgepodge from Robin, on Salty Talk.',
            '咸話咸説の毎日AIブレンド、Robin がお届けします。',
            '[每日AI乱炖 · 2026-10-23 を聴く](https://pod.example/i/1)。',
            '这里是由Robin为你带来的咸话咸说之AI乱炖。',
            '[listen to 每日AI乱炖 · 2026-10-23](https://pod.example/i/1).',
        ].join('\n');
        for (const locale of ['zh', 'en', 'ja'] as const) {
            const once = normalizeSeriesNames(doc, locale);
            const twice = normalizeSeriesNames(once.markdown, locale);
            expect(twice.markdown, `${locale} second pass`).toBe(once.markdown);
            expect(twice.remaining, `${locale} second remaining`).toEqual(once.remaining);
        }
    });

    it('never touches or flags series tokens inside URLs', () => {
        const md = '[每日AI乱炖 · 2026-10-23 を聴く](https://pod.example/每日AI乱炖/episode-1)。';
        const ja = normalizeSeriesNames(md, 'ja');
        expect(ja.markdown).toBe(
            '[デイリーAIシチュー · 2026-10-23 を聴く](https://pod.example/每日AI乱炖/episode-1)。',
        );
        expect(ja.remaining).toEqual([]);
        // The URL alone is neither rewritten nor detected.
        expect(findRetiredSeriesNames('see https://pod.example/daily-ai-medley/1 now', 'en')).toEqual([]);
    });

    it('reports a bare hodgepodge it cannot safely rewrite instead of butchering prose', () => {
        const en = normalizeSeriesNames('The stack is a hodgepodge of APIs.', 'en');
        expect(en.markdown).toBe('The stack is a hodgepodge of APIs.');
        expect(en.remaining).toEqual(['hodgepodge']);
        // In ja/zh prose the bare word is just as unrewritable.
        expect(normalizeSeriesNames('Hodgepodge of APIs。', 'ja').remaining).toEqual(['Hodgepodge']);
    });

    it('findRetiredSeriesNames reports pre-rewrite occurrences for hand repair', () => {
        expect(findRetiredSeriesNames('毎日AIブレンド と Daily AI Medley', 'ja')).toEqual([
            '毎日AIブレンド',
            'Daily AI Medley',
        ]);
        expect(findRetiredSeriesNames('咸话咸说之AI乱炖', 'zh')).toEqual(['AI乱炖']);
        // The locale's own canonical name is never a finding.
        expect(findRetiredSeriesNames('每日AI乱炖 · 2026-10-23', 'zh')).toEqual([]);
    });

    it('agrees with surfdash-pub crossLinkFor — the two name tables cannot import each other', () => {
        const patch = join(import.meta.dir, '../../publishings/surfdash-pub/src/patch.ts');
        const probe = Bun.spawnSync([
            'bun',
            '-e',
            `const { crossLinkFor } = await import(${JSON.stringify(patch)});` +
                `console.log(JSON.stringify(['zh','en','ja'].map((l) => crossLinkFor(l, '2026-10-23', 'https://pod.example/i/9'))));`,
        ]);
        expect(probe.exitCode).toBe(0);
        const links = JSON.parse(probe.stdout.toString()) as string[];
        expect(links).toHaveLength(3);
        for (const locale of ['zh', 'en', 'ja'] as const) {
            expect(links[['zh', 'en', 'ja'].indexOf(locale)], `${locale} link names the canonical series`).toContain(
                DAILY_SERIES_NAMES[locale].series,
            );
            // And the emitted line carries no retired token in any locale.
            expect(findRetiredSeriesNames(links[['zh', 'en', 'ja'].indexOf(locale)], locale)).toEqual([]);
        }
    });
});
