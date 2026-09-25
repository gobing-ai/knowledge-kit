import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
    composePrompt,
    type FormatPreset,
    FormatPresetSchema,
    loadPresets,
    renderTemplate,
    resolvePresetRoots,
    type StylePreset,
    StylePresetSchema,
} from '../src/presets';

const BUILTIN_ROOT = join(import.meta.dir, '..', 'presets');

/**
 * Task 0102 R6 golden prompt: cover × editorial, verbatim — including the
 * trailing space after `concepts,` and the embedded newlines (task Design).
 */
const GOLDEN_COVER_PROMPT = `Cinematic wide-format cover illustration for "Microservices Guide", subtitled "From monolith to mesh".
Theme: distributed systems.
Visual approach: abstract geometric with clean modern lines.
Composition: strong central focal point, negative space in upper third for text overlay.
Color palette: deep navy transitioning to electric blue with warm amber accents.
Atmosphere: professional, aspirational, forward-looking, modern and aspirational sensibility.
Inspired by the article's core concepts, 
create a visually striking hero image with dramatic volumetric lighting,
fine detail textures, and cinematic depth of field.
Magazine-quality digital art with strong visual hierarchy., 8K, ultra-high-quality, masterpiece, cinematic composition, rule of thirds, volumetric lighting, dramatic shadows, fine detail textures, professional color grading, editorial magazine style, high contrast, bold composition, dramatic directional lighting, sophisticated design, strong visual hierarchy, premium quality`;

function testFormat(overrides: Partial<FormatPreset> = {}): FormatPreset {
    return {
        name: 'f',
        description: 'test format',
        job: 'free',
        aspectRatio: '1:1',
        defaultStyle: 'vibrant',
        keywords: ['K1', 'K2'],
        outputFilename: 'out.png',
        variables: {},
        template: 'BODY',
        ...overrides,
    };
}

function testStyle(overrides: Partial<StylePreset> = {}): StylePreset {
    return { name: 's', description: 'test style', modifiers: 'M', ...overrides };
}

function setEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

/**
 * Point every non-builtin preset root at a controlled location so no test
 * reads the real ~/.config/kk/image-presets` or an ambient project root.
 */
function isolateEnv(opts: { home?: string; project?: string; envPath?: string } = {}): void {
    process.env.HOME = opts.home ?? EMPTY_TMP;
    process.env.KNOWLEDGE_KIT_PROJECT_ROOT = opts.project ?? join(EMPTY_TMP, 'absent-project');
    process.env.KK_IMAGE_PRESET_PATH = opts.envPath ?? '';
}

/** Load presets against only the shipped built-in presets. */
function loadShipped() {
    isolateEnv();
    return loadPresets();
}

const ENV_KEYS = ['HOME', 'KNOWLEDGE_KIT_PROJECT_ROOT', 'KK_IMAGE_PRESET_PATH'] as const;
let savedEnv: Record<string, string | undefined> = {};
let EMPTY_TMP = '';

beforeAll(() => {
    EMPTY_TMP = mkdtempSync(join(tmpdir(), 'kk-image-gen-test-'));
});

afterAll(() => {
    if (EMPTY_TMP !== '' && existsSync(EMPTY_TMP)) {
        rmSync(EMPTY_TMP, { recursive: true, force: true });
    }
});

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    isolateEnv();
});

afterEach(() => {
    for (const key of ENV_KEYS) {
        setEnv(key, savedEnv[key]);
    }
});

/** Write a one-preset override axis under `dir` and return the file path. */
function writeOverride(dir: string, axis: 'formats' | 'styles', file: string, content: string): string {
    mkdirSync(join(dir, axis), { recursive: true });
    const path = join(dir, axis, file);
    writeFileSync(path, content);
    return path;
}

describe('R1 — preset schemas', () => {
    test('a valid format file parses into a FormatPreset', async () => {
        const text = await Bun.file(join(BUILTIN_ROOT, 'formats', 'cover.yaml')).text();
        const preset = FormatPresetSchema.parse(Bun.YAML.parse(text));
        expect(preset.name).toBe('cover');
        expect(preset.job).toBe('cover');
        expect(preset.template).toContain('\n');
        expect(preset.template).toMatch(/^Cinematic wide-format/);
    });

    test('a format file without job is rejected, naming job', async () => {
        const text = await Bun.file(join(BUILTIN_ROOT, 'formats', 'cover.yaml')).text();
        const withoutJob = Bun.YAML.parse(text) as Record<string, unknown>;
        delete withoutJob.job;
        expect(() => FormatPresetSchema.parse(withoutJob)).toThrow(/job/);
    });

    test('loadPresets emits an invalid diagnostic for a job-less format and keeps the built-ins loadable', async () => {
        const root = join(EMPTY_TMP, 'no-job-root');
        const text = await Bun.file(join(BUILTIN_ROOT, 'formats', 'cover.yaml')).text();
        const withoutJob = Bun.YAML.parse(text) as Record<string, unknown>;
        delete withoutJob.job;
        const brokenPath = writeOverride(root, 'formats', 'cover.yaml', Bun.YAML.stringify(withoutJob));
        process.env.KK_IMAGE_PRESET_PATH = root;

        const { formats, diagnostics } = loadPresets();

        expect(formats.has('cover')).toBe(true); // the built-in still loads
        expect([...formats.keys()].sort()).toEqual(['cover', 'daily-news-cover', 'free', 'illustration', 'xhs-card']);
        const invalid = diagnostics.filter((d) => d.code === 'invalid');
        expect(invalid).toHaveLength(1);
        expect(invalid[0]?.path).toBe(brokenPath);
    });

    test('a style file with only name, description and modifiers parses; optional fields stay undefined', () => {
        const parsed = StylePresetSchema.parse(
            Bun.YAML.parse('name: editorial\ndescription: A style\nmodifiers: bold, high contrast'),
        );
        expect(parsed.name).toBe('editorial');
        expect(parsed.modifiers).toBe('bold, high contrast');
        expect(parsed.palette).toBeUndefined();
        expect(parsed.typography).toBeUndefined();
        expect(parsed.visualElements).toBeUndefined();
        expect(parsed.bestFor).toBeUndefined();
        expect(parsed.negative).toBeUndefined();
        expect(parsed.source).toBeUndefined();
    });
});

describe('R2 — the frozen composition rule', () => {
    test('composePrompt concatenates the four segments in the frozen order', () => {
        expect(composePrompt(testFormat(), testStyle(), {}, 'E')).toBe('BODY, K1, K2, M, E');
    });

    test('an empty optional segment is dropped, not left as a stray comma', () => {
        expect(composePrompt(testFormat({ keywords: [] }), testStyle(), {})).toBe('BODY, M');
    });

    test('a placeholder with no value and no fallback fails loud, naming placeholder and format', () => {
        const format = testFormat({ name: 'cover', template: 'Hello {{nonesuch}}', variables: {} });
        expect(() => composePrompt(format, testStyle(), {})).toThrow(/nonesuch/);
        expect(() => composePrompt(format, testStyle(), {})).toThrow(/cover/);
    });

    test('the fallback form is used when the variable resolves empty', () => {
        const format = testFormat({
            keywords: [],
            template: '{{subtitle | , subtitled "{{subtitle}}"}}',
            variables: { subtitle: { description: 'Subtitle', default: '' } },
        });
        expect(composePrompt(format, testStyle(), { subtitle: '' })).toContain(', subtitled "{{subtitle}}"');
    });
});

describe('renderTemplate edge cases', () => {
    test('a value wins over a plain-text fallback, and the plain fallback is never re-scanned', () => {
        // The fallback embeds {{other}}, which HAS a value — but since it does not
        // wrap {{name}}, it is a literal default, so the value wins untouched.
        expect(renderTemplate('{{name | see {{other}}}}', { name: 'A', other: 'B' }, 'f')).toBe('A');
    });

    test('an unterminated {{ is left literal instead of eating the rest of the template', () => {
        expect(renderTemplate('draw {{open and {{done}} here', { done: 'X' }, 'f')).toBe('draw {{open and X here');
    });

    test('nested braces count depth, so {{a {{b}} }} resolves as one outer placeholder', () => {
        expect(renderTemplate('{{outer | fallback}}', {}, 'f')).toBe('fallback');
        expect(renderTemplate('{{title}} and {{title}}', { title: 'T' }, 'f')).toBe('T and T');
    });

    test('a fallback is emitted literally and never re-scanned', () => {
        expect(renderTemplate('{{missing | {{alsoMissing}}}}', {}, 'f')).toBe('{{alsoMissing}}');
    });
});

describe('R4 — resolution order and shadowing', () => {
    test('a project-root preset shadows the built-in of the same name', () => {
        const project = join(EMPTY_TMP, 'proj');
        writeOverride(
            join(project, '.kk', 'image-presets'),
            'styles',
            'editorial.yaml',
            'name: editorial\ndescription: project override\nmodifiers: project modifiers',
        );
        process.env.KNOWLEDGE_KIT_PROJECT_ROOT = project;

        const { styles, diagnostics } = loadPresets();

        expect(styles.get('editorial')?.modifiers).toBe('project modifiers');
        const shadowed = diagnostics.filter((d) => d.code === 'shadowed');
        expect(shadowed).toHaveLength(1);
        expect(shadowed[0]?.path).toBe(join(BUILTIN_ROOT, 'styles', 'editorial.yaml'));
    });

    test('KK_IMAGE_PRESET_PATH wins over the project root and emits two shadowed diagnostics', () => {
        const project = join(EMPTY_TMP, 'proj');
        writeOverride(
            join(project, '.kk', 'image-presets'),
            'styles',
            'editorial.yaml',
            'name: editorial\ndescription: project override\nmodifiers: project modifiers',
        );
        const pathDir = join(EMPTY_TMP, 'envpath');
        writeOverride(
            pathDir,
            'styles',
            'editorial.yaml',
            'name: editorial\ndescription: env override\nmodifiers: path modifiers',
        );
        process.env.KNOWLEDGE_KIT_PROJECT_ROOT = project;
        process.env.KK_IMAGE_PRESET_PATH = pathDir;

        const { styles, diagnostics } = loadPresets();

        expect(styles.get('editorial')?.modifiers).toBe('path modifiers');
        const shadowed = diagnostics.filter((d) => d.code === 'shadowed');
        expect(shadowed).toHaveLength(2);
        expect(shadowed.map((d) => d.path)).toContain(join(BUILTIN_ROOT, 'styles', 'editorial.yaml'));
        expect(shadowed.map((d) => d.path)).toContain(
            join(project, '.kk', 'image-presets', 'styles', 'editorial.yaml'),
        );
    });

    test('a malformed preset file is skipped, not fatal', () => {
        const home = join(EMPTY_TMP, 'home');
        const brokenPath = writeOverride(
            join(home, '.config', 'kk', 'image-presets'),
            'styles',
            'broken.yaml',
            'name: broken',
        );
        process.env.HOME = home;

        const { styles, diagnostics } = loadPresets(); // must not throw

        expect(styles.size).toBe(12);
        expect(styles.has('broken')).toBe(false);
        const invalid = diagnostics.filter((d) => d.code === 'invalid');
        expect(invalid).toHaveLength(1);
        expect(invalid[0]?.path).toBe(brokenPath);
    });

    test('a YAML-unparseable preset file is skipped with an invalid diagnostic', () => {
        const home = join(EMPTY_TMP, 'home-garbage');
        const garbagePath = writeOverride(
            join(home, '.config', 'kk', 'image-presets'),
            'styles',
            'garbage.yaml',
            'unbalanced: [',
        );
        process.env.HOME = home;

        const { diagnostics } = loadPresets();

        const invalid = diagnostics.filter((d) => d.code === 'invalid');
        expect(invalid).toHaveLength(1);
        expect(invalid[0]?.path).toBe(garbagePath);
    });
});

describe('R5 — the v1 inventory', () => {
    test('every shipped format declares a job, and the cover job has the generic plus the pinned daily preset', () => {
        const { formats } = loadShipped();
        expect(formats.get('free')?.job).toBe('free');
        expect(formats.get('cover')?.job).toBe('cover');
        expect(formats.get('illustration')?.job).toBe('illustration');
        // F614: daily-news-cover drives the same cover job through a pinned look.
        expect(formats.get('daily-news-cover')?.job).toBe('cover');
    });

    test('the shipped inventory is five formats and twelve styles', () => {
        const { formats, styles, diagnostics } = loadShipped();
        expect(diagnostics).toEqual([]);
        // F614 0163 joins daily-news-cover beside the three v1 formats.
        expect([...formats.keys()].sort()).toEqual(['cover', 'daily-news-cover', 'free', 'illustration', 'xhs-card']);
        expect([...styles.keys()].sort()).toEqual([
            'clean-webapp-ui',
            'cute',
            'daily-news',
            'editorial',
            'fresh',
            'minimalist',
            'photorealistic',
            'sketch',
            'technical-diagram',
            'vibrant',
            'warm',
            'xhs-knowledge',
        ]);
    });
});

describe('xhs card presets (E8 0168)', () => {
    test('xhs-card pins the 3:4 card geometry and the xhs-knowledge default style', () => {
        const { formats, styles } = loadShipped();
        const format = formats.get('xhs-card');
        const style = styles.get('xhs-knowledge');
        if (format === undefined || style === undefined) {
            throw new Error('shipped xhs-card format or xhs-knowledge style missing');
        }
        expect(format.job).toBe('free');
        expect(format.aspectRatio).toBe('3:4');
        expect(format.width).toBe(1080);
        expect(format.height).toBe(1440);
        expect(format.defaultStyle).toBe('xhs-knowledge');
        for (const key of ['role', 'layout', 'headline', 'points', 'subject', 'language']) {
            expect(format.variables[key], `${key} variable declared`).toBeDefined();
        }
        expect(format.variables['language']?.default).toBe('简体中文');
        expect(style.modifiers).toContain('large legible Chinese typography');
    });

    test('xhs-card composes role, headline and points into the rendered prompt', () => {
        const { formats, styles } = loadShipped();
        const format = formats.get('xhs-card');
        const style = styles.get('xhs-knowledge');
        if (format === undefined || style === undefined) {
            throw new Error('shipped xhs-card format or xhs-knowledge style missing');
        }
        const prompt = composePrompt(format, style, {
            role: 'cover',
            layout: 'cover',
            headline: '微服务拆分',
            points: '先按业务边界\n再按团队规模',
            subject: 'flat illustration of service boundaries',
        });
        expect(prompt).toContain('Card role: cover');
        expect(prompt).toContain('"微服务拆分"');
        expect(prompt).toContain('先按业务边界');
        expect(prompt).toContain('xiaohongshu-style');
    });
});

describe('daily-news cover presets (F614 R1)', () => {
    test('daily-news-cover pins the cover geometry and the daily-news default style', () => {
        const { formats, styles } = loadShipped();
        const format = formats.get('daily-news-cover');
        const style = styles.get('daily-news');
        if (format === undefined || style === undefined) {
            throw new Error('shipped daily-news-cover format or daily-news style missing');
        }
        expect(format.job).toBe('cover');
        expect(format.aspectRatio).toBe('21:9');
        expect(format.width).toBe(1344);
        expect(format.height).toBe(576);
        expect(format.defaultStyle).toBe('daily-news');
        // Exactly one declared variable: the subject is the only per-run input — composition,
        // palette and visual approach are literal template text no caller can override.
        expect(Object.keys(format.variables)).toEqual(['subject']);
        // The house style carries a structured palette and the content-banning negative.
        expect(style.palette?.map((entry) => entry.hex)).toEqual(['#0B1F3A', '#2D7FF9', '#F5A623']);
        for (const banned of ['text', 'letters', 'numbers', 'watermark', 'logo', 'flags', 'real people']) {
            expect(style.negative, `${banned} in the daily-news negative`).toContain(banned);
        }
    });

    test('daily-news-cover × daily-news composes from a single subject var', () => {
        const { formats, styles } = loadShipped();
        const format = formats.get('daily-news-cover');
        const style = styles.get('daily-news');
        if (format === undefined || style === undefined) {
            throw new Error('shipped daily-news-cover format or daily-news style missing');
        }
        const subject = 'a delivery drone stacking morning newspapers on a doorstep';
        const prompt = composePrompt(format, style, { subject });

        expect(prompt).toContain(subject);
        expect(prompt).not.toContain('{{');
        // Literal template segments survive beside the subject, and the frozen segment order
        // still appends keywords then style modifiers.
        expect(prompt).toContain('Composition: one central focal subject, generous negative space in the upper third');
        expect(prompt).toContain('deep navy background with electric blue and warm amber accents');
        expect(prompt).toContain('clean composition, high detail, consistent series look');
        expect(prompt).toContain('flat editorial vector illustration');

        // Omitting vars resolves the fixed default scene (the R4 fallback path).
        expect(composePrompt(format, style, {})).toContain(
            'a glowing network of connected nodes rising above a quiet city at dawn',
        );
    });
});

describe('R6 — the golden cover prompt', () => {
    test('cover × editorial renders byte-for-byte', () => {
        const { formats, styles } = loadShipped();
        const cover = formats.get('cover');
        const editorial = styles.get('editorial');
        if (cover === undefined || editorial === undefined) {
            throw new Error('shipped cover format or editorial style missing');
        }
        const prompt = composePrompt(cover, editorial, {
            title: 'Microservices Guide',
            subtitle: 'From monolith to mesh',
            topics: 'distributed systems',
        });
        expect(prompt).toBe(GOLDEN_COVER_PROMPT);
    });
});

describe('resolvePresetRoots (R8)', () => {
    test('splits KK_IMAGE_PRESET_PATH on path.delimiter and drops empty entries', () => {
        // The bug was a hard-coded ':' (R8): on Windows the separator is ';', so the whole
        // string became one bogus root. Using `delimiter` keeps the empty entry in the split
        // result, which the filter must drop.
        const dirA = mkdtempSync(join(tmpdir(), 'kk-preset-a-'));
        const dirB = mkdtempSync(join(tmpdir(), 'kk-preset-b-'));
        const origPath = process.env.KK_IMAGE_PRESET_PATH;
        const origProjectRoot = process.env.KNOWLEDGE_KIT_PROJECT_ROOT;
        try {
            // Point the project root at an empty dir so its .kk/image-presets root cannot appear.
            process.env.KNOWLEDGE_KIT_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'kk-preset-root-'));
            process.env.KK_IMAGE_PRESET_PATH = [dirA, '', dirB].join(delimiter);

            const roots = resolvePresetRoots();

            expect(roots).toContain(dirA);
            expect(roots).toContain(dirB);
            expect(roots.indexOf(dirA)).toBeLessThan(roots.indexOf(dirB));
            expect(roots).not.toContain('');
            expect(roots.filter((r) => r === dirA).length).toBe(1);
        } finally {
            if (origPath !== undefined) process.env.KK_IMAGE_PRESET_PATH = origPath;
            else delete process.env.KK_IMAGE_PRESET_PATH;
            if (origProjectRoot !== undefined) process.env.KNOWLEDGE_KIT_PROJECT_ROOT = origProjectRoot;
            else delete process.env.KNOWLEDGE_KIT_PROJECT_ROOT;
            rmSync(dirA, { recursive: true, force: true });
            rmSync(dirB, { recursive: true, force: true });
        }
    });
});
