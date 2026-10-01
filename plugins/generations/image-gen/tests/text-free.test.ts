/**
 * Task 0181 (F616 R1) — the compose-format illustration prompt stays text-free.
 *
 * Card copy (headline + points) is typeset by the composer (0180); it must never
 * reach the provider prompt. `assertTextFreePrompt` refuses pre-spend and names
 * the offending segment. Also pins the R2 floors-by-construction evidence: the
 * no-illustration `cardHtml` keeps the same glyph floors as an illustrated card.
 */
import { describe, expect, test } from 'bun:test';

import {
    assertTextFreePrompt,
    type CardInput,
    type ComposeBlock,
    cardHtml,
    type TextFreeSource,
} from '../src/compose/card';
import { loadPresets, renderTemplate } from '../src/presets';

const COPY = { headline: '核心概念', points: ['要点一', '要点二'] };

describe('assertTextFreePrompt (R1)', () => {
    test('passes a text-free prompt, numerals and Latin words included', () => {
        expect(() => assertTextFreePrompt('flat illustration of a network, 3 nodes, 2026', COPY, [])).not.toThrow();
    });

    test('names a Han character and its code point from the named source', () => {
        const sources: TextFreeSource[] = [{ source: 'the format template', text: 'Xiaohongshu style 中文' }];
        expect(() => assertTextFreePrompt('clean illustration', COPY, sources)).toThrow(
            "compose: the illustration prompt must stay text-free — the format template contributes Han character '中' (U+4E2D)",
        );
    });

    test('names the style preset when its modifiers carry card copy (Han or headline)', () => {
        const sources: TextFreeSource[] = [{ source: "the style preset 'x'", text: 'large 核心概念 typography' }];
        expect(() => assertTextFreePrompt('clean illustration', COPY, sources)).toThrow(
            "the style preset 'x' contributes the headline '核心概念'",
        );
    });

    test('names a point caught inside a named var', () => {
        const sources: TextFreeSource[] = [{ source: 'vars.subject', text: 'a poster reading 要点一' }];
        expect(() => assertTextFreePrompt('clean illustration', COPY, sources)).toThrow(
            "vars.subject contributes point '要点一'",
        );
    });

    test('names the headline when a segment repeats it verbatim', () => {
        const sources: TextFreeSource[] = [{ source: 'spec.extra', text: 'core idea 核心概念 in flat style' }];
        expect(() => assertTextFreePrompt('clean illustration', COPY, sources)).toThrow(
            "spec.extra contributes the headline '核心概念'",
        );
    });

    test('falls back to the composed prompt when no single segment explains the hit', () => {
        const sources: TextFreeSource[] = [{ source: 'the format template', text: 'clean flat illustration' }];
        expect(() => assertTextFreePrompt('flat 小 illustration', COPY, sources)).toThrow(
            'the composed prompt contributes Han character',
        );
    });

    test('copy strings shorter than two characters are exempt from substring matching', () => {
        expect(() => assertTextFreePrompt('fox and x', { headline: 'x', points: ['ok'] }, [])).not.toThrow();
    });
});

describe('cardHtml glyph floors by construction (R2)', () => {
    const cfg: ComposeBlock = {
        engine: 'text-card',
        safeArea: 72,
        headlineMinPx: 64,
        bodyMinPx: 36,
        illustrationHeight: 640,
        palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' },
        fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
    };
    const base: CardInput = {
        headline: '核心概念',
        points: ['要点一', '要点二'],
        role: 'cover',
        compose: cfg,
        width: 1080,
        height: 1440,
    };
    const fontUrls = new Map([
        ['NotoSansSC-Bold.otf', 'route://headline-font'],
        ['NotoSansSC-Regular.otf', 'route://body-font'],
    ]);

    test('the headline starts at 1.5x its floor and can never step below it', () => {
        const html = cardHtml(base, fontUrls);
        expect(html).toContain('font-size: 96px;'); // headlineMinPx * 1.5
        expect(html).toContain('var headlineMinPx = 64;');
    });

    test('each point is set at the body floor', () => {
        const html = cardHtml(base, fontUrls);
        expect(html).toContain('style="font-size:36px;"');
    });

    test('the no-illustration card has no img element; the illustrated one has exactly one', () => {
        const bare = cardHtml(base, fontUrls);
        expect(bare).not.toContain('<img');
        const illustrated = cardHtml(
            { ...base, illustration: { bytes: new Uint8Array(4), mime: 'image/png' } },
            fontUrls,
        );
        expect(illustrated.match(/<img/g)).toHaveLength(1);
    });
});

describe('shipped compose presets keep the prompt text-free (R1)', () => {
    test('xhs-card × xhs-knowledge composes a Han-free prompt from explicit card copy', () => {
        // Resolve the builtin root only: other suites repoint HOME / the preset path.
        const savedEnv = {
            home: process.env.HOME,
            root: process.env.KNOWLEDGE_KIT_PROJECT_ROOT,
            presetPath: process.env.KK_IMAGE_PRESET_PATH,
        };
        process.env.HOME = '/nonexistent-kk-home';
        process.env.KNOWLEDGE_KIT_PROJECT_ROOT = '/nonexistent-kk-project';
        process.env.KK_IMAGE_PRESET_PATH = '';
        try {
            assertShippedPresetsAreTextFree();
        } finally {
            if (savedEnv.home === undefined) delete process.env.HOME;
            else process.env.HOME = savedEnv.home;
            if (savedEnv.root === undefined) delete process.env.KNOWLEDGE_KIT_PROJECT_ROOT;
            else process.env.KNOWLEDGE_KIT_PROJECT_ROOT = savedEnv.root;
            if (savedEnv.presetPath === undefined) delete process.env.KK_IMAGE_PRESET_PATH;
            else process.env.KK_IMAGE_PRESET_PATH = savedEnv.presetPath;
        }
    });
});

function assertShippedPresetsAreTextFree(): void {
    const { formats, styles } = loadPresets();
    const format = formats.get('xhs-card');
    const style = styles.get('xhs-knowledge');
    expect(format?.compose).toBeDefined();
    expect(style).toBeDefined();
    if (format === undefined || style === undefined) return;

    // The style's own prompt segments must be Han-free...
    expect(style.modifiers).not.toMatch(/\p{Script=Han}/u);
    // ...and the negative instruction must forbid text on the illustration.
    expect(style.negative).toContain('text');
    expect(style.negative).toContain('Chinese characters');

    // The composed prompt — the exact provider input — must be Han-free.
    // (style.negative rides the provider's negative-prompt param, not the text.)
    const vars = {
        role: 'cover',
        layout: 'definition',
        headline: '核心概念',
        points: '要点一\n要点二',
        subject: 'a tidy desk with one glowing laptop',
        index: '01',
        content: '',
    };
    const body = renderTemplate(format.template, vars, format.name);
    const prompt = [body, format.keywords.join(', '), style.modifiers].filter((part) => part !== '').join(', ');
    expect(prompt).not.toMatch(/\p{Script=Han}/u);
}
