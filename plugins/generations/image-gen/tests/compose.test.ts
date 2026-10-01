/**
 * Task 0180 (F616) — compose-path integration tests.
 *
 * Plan items 2–9: coverage failures, overflow failures, schema failures, pre-spend
 * guards, dry-run behaviour, spend-path with stub composer, non-compose green
 * confirmation, and the E2E real-Chromium test (`compose-e2e.test.ts` is a
 * separate file per the plan).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { readBytes } from '../src/bytes';
import type { CardComposer, CardInput } from '../src/compose/card';
import { assertCoverage } from '../src/compose/card';
import { glyphCoverage } from '../src/compose/cmap';
import { type ProviderResolver, processGeneratorIO } from '../src/index';
import type { ImageProvider } from '../src/providers/types';

const FONTS_DIR = join(import.meta.dir, '..', 'assets', 'fonts');

let TMP = '';
let OUT = '';
let IN = '';

const ENV_KEYS = [
    'HOME',
    'KNOWLEDGE_KIT_PROJECT_ROOT',
    'KK_IMAGE_PRESET_PATH',
    'KK_IMAGE_DRY_RUN',
    'KK_IMAGE_MAX_IMAGES',
    'IMAGE_GEN_PROVIDER',
    'OPENAI_API_KEY',
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
    TMP = mkdtempSync(join(tmpdir(), 'kk-compose-'));
    OUT = join(TMP, 'out', 'content.json');
    IN = join(TMP, 'in.json');
    mkdirSync(join(TMP, 'out'), { recursive: true });
});

afterAll(() => {
    if (TMP !== '' && existsSync(TMP)) {
        rmSync(TMP, { recursive: true, force: true });
    }
});

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.HOME = TMP;
    process.env.KNOWLEDGE_KIT_PROJECT_ROOT = join(TMP, 'absent-project');
    process.env.KK_IMAGE_PRESET_PATH = '';
    delete process.env.KK_IMAGE_DRY_RUN;
    delete process.env.KK_IMAGE_MAX_IMAGES;
    delete process.env.IMAGE_GEN_PROVIDER;
});

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
});

/** A stub provider whose generate() never resolves. */
function stubProvider(name = 'stub'): { resolver: ProviderResolver; generateCalls: () => number } {
    let calls = 0;
    const provider: ImageProvider = {
        name,
        defaultModel: () => 'stub-model',
        isAvailable: () => true,
        supportsReferenceImages: () => false,
        generate: () => {
            calls++;
            return Promise.reject(new Error('stub generate must never be called'));
        },
    };
    return { resolver: () => provider, generateCalls: () => calls };
}

/** A stub provider that returns a minimal valid PNG. */
function pngProvider(): { resolver: ProviderResolver; generateCalls: () => number } {
    let calls = 0;
    // Minimal 1x1 PNG (just enough to satisfy imageDimensions — the stub composer discards bytes).
    const minimalPng = new Uint8Array([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a, // PNG sig
        0x00,
        0x00,
        0x00,
        0x0d, // IHDR length
        0x49,
        0x48,
        0x44,
        0x52, // 'IHDR'
        0x00,
        0x00,
        0x04,
        0x38, // width 1080
        0x00,
        0x00,
        0x05,
        0xa0, // height 1440
        0x08,
        0x02,
        0x00,
        0x00,
        0x00, // bit depth, color type, compression, filter, interlace
        0x00,
        0x00,
        0x00,
        0x00, // CRC placeholder
    ]);
    const provider: ImageProvider = {
        name: 'png-stub',
        defaultModel: () => 'stub-model',
        isAvailable: () => true,
        supportsReferenceImages: () => false,
        generate: () => {
            calls++;
            return Promise.resolve({ bytes: minimalPng, extension: 'png', provider: 'png-stub', model: 'stub-model' });
        },
    };
    return { resolver: () => provider, generateCalls: () => calls };
}

/** A stub CardComposer that records calls and returns a minimal valid 1080x1440 PNG. */
function stubComposer(): { composer: CardComposer; calls: () => CardInput[] } {
    const recorded: CardInput[] = [];
    // Minimal PNG with 1080x1440 dims encoded in IHDR.
    const cardPng = new Uint8Array(24);
    cardPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(cardPng.buffer);
    view.setUint32(8, 13); // IHDR length
    cardPng.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, 1080); // width
    view.setUint32(20, 1440); // height
    const composer: CardComposer = {
        compose: async (input) => {
            recorded.push(input);
            return cardPng;
        },
    };
    return { composer, calls: () => recorded };
}

/** A stub CardComposer that always throws (for overflow simulation). */
function failingComposer(message: string): CardComposer {
    return {
        compose: async () => {
            throw new Error(message);
        },
    };
}

function xhsCardDoc(vars: Record<string, string>, extra?: Record<string, unknown>): Doc[] {
    return [
        {
            id: 'd1',
            body: 'A knowledge article body.',
            metadata: {
                imageGen: {
                    job: 'free',
                    format: 'xhs-card',
                    vars,
                    ...extra,
                },
            },
        },
    ];
}

async function runWith(
    docs: Doc[],
    options?: { providerResolver?: ProviderResolver; composer?: CardComposer },
): Promise<void> {
    writeFileSync(IN, JSON.stringify(docs));
    await processGeneratorIO(IN, OUT, options ?? {});
}

function readOut(): Content {
    return ContentSchema.parse(JSON.parse(readFileSync(OUT, 'utf-8')));
}

// ─────────────────────────────────────────────────────────────
// Task 0181 (F616 R1): text-free illustration prompt — pre-spend refusal
// ─────────────────────────────────────────────────────────────

describe('Plan 0181 — text-free prompt guard refuses pre-spend (R1)', () => {
    test('a Han character in vars.subject is refused naming the var, provider never called', async () => {
        const { resolver, generateCalls } = stubProvider();
        await expect(
            runWith(
                xhsCardDoc({
                    headline: '核心概念',
                    points: '要点一\n要点二',
                    role: 'cover',
                    layout: 'cover',
                    subject: '小桥流水人家',
                    index: '01',
                }),
                { providerResolver: resolver },
            ),
        ).rejects.toThrow("vars.subject contributes Han character '小' (U+5C0F)");
        expect(generateCalls()).toBe(0);
    });

    test('card copy hidden inside a Latin subject var is refused naming the headline', async () => {
        const { resolver, generateCalls } = stubProvider();
        await expect(
            runWith(
                xhsCardDoc({
                    headline: 'core idea',
                    points: 'first point\nsecond point',
                    role: 'cover',
                    layout: 'cover',
                    subject: 'a poster showing the core idea',
                    index: '01',
                }),
                { providerResolver: resolver },
            ),
        ).rejects.toThrow("vars.subject contributes the headline 'core idea'");
        expect(generateCalls()).toBe(0);
    });

    test('a non-compose format with a CJK subject is not refused (guard scope)', async () => {
        const { resolver, generateCalls } = pngProvider();
        const { composer, calls: composerCalls } = stubComposer();
        const myOut = join(TMP, 'out-guard-scope', 'content.json');
        mkdirSync(join(TMP, 'out-guard-scope'), { recursive: true });
        writeFileSync(
            IN,
            JSON.stringify([{ id: 'c1', body: '小桥流水人家', metadata: { imageGen: { job: 'cover' } } }]),
        );
        await processGeneratorIO(IN, myOut, { providerResolver: resolver, composer });
        expect(generateCalls()).toBe(1);
        expect(composerCalls()).toHaveLength(0);
        expect(ContentSchema.parse(JSON.parse(readFileSync(myOut, 'utf-8'))).format).toBe('image');
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 2: uncovered char → pre-spend failure, no provider call
// ─────────────────────────────────────────────────────────────

describe('Plan 2 — uncovered character fails pre-spend (R4)', () => {
    test('headline with an emoji outside NotoSansSC fails loud naming field and code point, provider never called', async () => {
        const { resolver, generateCalls } = stubProvider();
        const { composer } = stubComposer();
        await expect(
            runWith(xhsCardDoc({ headline: '核心😀概念', points: '要点一\n要点二' }), {
                providerResolver: resolver,
                composer,
            }),
        ).rejects.toThrow(/compose: headline has U\+1F600/);
        expect(generateCalls()).toBe(0);
    });

    test('bullet with uncovered char names points[i]', async () => {
        const { resolver, generateCalls } = stubProvider();
        const { composer } = stubComposer();
        await expect(
            runWith(xhsCardDoc({ headline: '核心概念', points: '正常要点\n不支持的字符😀' }), {
                providerResolver: resolver,
                composer,
            }),
        ).rejects.toThrow(/compose: points\[1\] has U\+1F600/);
        expect(generateCalls()).toBe(0);
    });

    test('whitespace and newlines are exempt from coverage check', async () => {
        // Just check that assertCoverage does not throw on whitespace
        const boldBytes = await readBytes(join(FONTS_DIR, 'NotoSansSC-Bold.otf'));
        const regularBytes = await readBytes(join(FONTS_DIR, 'NotoSansSC-Regular.otf'));
        const fonts = new Map<string, (cp: number) => boolean>([
            ['NotoSansSC-Bold.otf', glyphCoverage(boldBytes)],
            ['NotoSansSC-Regular.otf', glyphCoverage(regularBytes)],
        ]);
        const cfg = {
            engine: 'text-card' as const,
            safeArea: 72,
            headlineMinPx: 64,
            bodyMinPx: 36,
            illustrationHeight: 640,
            palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' },
            fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
        };
        // Should not throw — all whitespace/newlines in text.
        assertCoverage(
            { headline: '  \n  ', points: ['\t', ''], role: 'cover', compose: cfg, width: 1080, height: 1440 },
            fonts,
        );
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 3: overflow at floors → named field, zero spend
// ─────────────────────────────────────────────────────────────

describe('Plan 3 — overflow at floors fails naming field (R2)', () => {
    test('composer throwing naming headline is propagated pre-spend', async () => {
        const { resolver, generateCalls } = stubProvider();
        const overflowComposer = failingComposer('compose: text overflows the safe area for field(s): headline');
        await expect(
            runWith(xhsCardDoc({ headline: '核心概念', points: '要点' }), {
                providerResolver: resolver,
                composer: overflowComposer,
            }),
        ).rejects.toThrow(/overflows.*headline/);
        expect(generateCalls()).toBe(0);
    });

    test('composer throwing naming points[0] propagates pre-spend', async () => {
        const { resolver, generateCalls } = stubProvider();
        const overflowComposer = failingComposer('compose: text overflows the safe area for field(s): points[0]');
        await expect(
            runWith(xhsCardDoc({ headline: '核心概念', points: '要点' }), {
                providerResolver: resolver,
                composer: overflowComposer,
            }),
        ).rejects.toThrow(/overflows.*points\[0\]/);
        expect(generateCalls()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 4: compose block without width/height → preset load fails
// ─────────────────────────────────────────────────────────────

describe('Plan 4 — compose block without width/height fails at preset parse', () => {
    test('FormatPresetSchema refine rejects a compose block with no width/height', () => {
        const { FormatPresetSchema } = require('../src/presets') as typeof import('../src/presets');
        const result = FormatPresetSchema.safeParse({
            name: 'no-dims',
            description: 'test',
            job: 'free',
            aspectRatio: '3:4',
            defaultStyle: 'xhs-knowledge',
            keywords: ['k'],
            outputFilename: 'f.png',
            variables: {},
            template: 'T',
            compose: {
                engine: 'text-card',
                safeArea: 72,
                headlineMinPx: 64,
                bodyMinPx: 36,
                illustrationHeight: 640,
                palette: { background: '#FFF', text: '#000', accent: '#F00' },
                fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
            },
        });
        expect(result.success).toBeFalse();
        if (!result.success) {
            expect(result.error.message).toContain('width and height');
        }
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 5: compose format with job != free or empty headline
// ─────────────────────────────────────────────────────────────

describe('Plan 5 — compose pre-spend guards', () => {
    test('empty headline (vars.headline not set, default is empty) fails pre-spend', async () => {
        const { resolver, generateCalls } = stubProvider();
        const { composer } = stubComposer();
        // Pass empty headline override.
        await expect(
            runWith(
                xhsCardDoc({ headline: '   ' }), // whitespace-only = empty
                { providerResolver: resolver, composer },
            ),
        ).rejects.toThrow(/non-empty vars\.headline/);
        expect(generateCalls()).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 6: dry run → composer invoked once, no provider call, no files
// ─────────────────────────────────────────────────────────────

describe('Plan 6 — dry run (R5)', () => {
    test('dry run on xhs-card: composer called once with no illustration, no provider, no files', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver, generateCalls } = stubProvider();
        const { composer, calls: composerCalls } = stubComposer();
        await runWith(xhsCardDoc({ headline: '核心概念', points: '要点一\n要点二' }), {
            providerResolver: resolver,
            composer,
        });
        expect(generateCalls()).toBe(0);
        expect(composerCalls()).toHaveLength(1);
        expect(composerCalls()[0].illustration).toBeUndefined();
        // No artifact files (only the content.json output).
        const outDir = join(TMP, 'out');
        const artifactFiles = readdirSync(outDir).filter((f) => f !== 'content.json');
        expect(artifactFiles).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 7: spend path → two files, path is card, illustration in artifact
// ─────────────────────────────────────────────────────────────

describe('Plan 7 — spend path (R5)', () => {
    test('stub provider + stub composer → card + illustration written, artifact.path is card, artifact.illustration is raw', async () => {
        const { resolver, generateCalls } = pngProvider();
        const { composer, calls: composerCalls } = stubComposer();

        // Clean out dir of any residuals.
        const outDir = join(TMP, 'out');
        for (const f of existsSync(outDir) ? readdirSync(outDir) : []) {
            rmSync(join(outDir, f), { force: true });
        }

        await runWith(xhsCardDoc({ headline: '核心概念', points: '要点一\n要点二' }), {
            providerResolver: resolver,
            composer,
        });

        expect(generateCalls()).toBe(1);
        // Pre-spend dry-compose + post-spend compose with illustration = 2 calls total.
        expect(composerCalls()).toHaveLength(2);
        expect(composerCalls()[0].illustration).toBeUndefined();
        expect(composerCalls()[1].illustration).toBeDefined();

        const content = readOut();
        const metadata = content.metadata as Record<string, unknown>;
        const images = metadata.images as Array<Record<string, unknown>>;
        expect(images).toHaveLength(1);
        const art = images[0];
        expect((art.path as string).endsWith('.png')).toBeTrue();
        expect(art.path as string).toContain('xhs-card');
        expect(art.illustration).toBeDefined();
        const illus = art.illustration as Record<string, unknown>;
        expect(illus.path as string).toContain('xhs-card-illustration');

        const outFiles = readdirSync(outDir).filter((f) => f !== 'content.json');
        expect(outFiles.length).toBeGreaterThanOrEqual(2);
    });

    test('failure after illustration write cleans up both files', async () => {
        const { resolver } = pngProvider();
        const afterIllustrationFailComposer: CardComposer = {
            compose: async (input) => {
                if (input.illustration !== undefined) {
                    // Second call (with illustration) fails.
                    throw new Error('simulated post-illustration compose failure');
                }
                // First call (dry-compose, no illustration) succeeds.
                const cardPng = new Uint8Array(24);
                cardPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
                const view = new DataView(cardPng.buffer);
                view.setUint32(8, 13);
                cardPng.set([0x49, 0x48, 0x44, 0x52], 12);
                view.setUint32(16, 1080);
                view.setUint32(20, 1440);
                return cardPng;
            },
        };

        const outDir = join(TMP, 'out');
        for (const f of existsSync(outDir) ? readdirSync(outDir) : []) {
            rmSync(join(outDir, f), { force: true });
        }

        await expect(
            runWith(xhsCardDoc({ headline: '核心概念', points: '要点' }), {
                providerResolver: resolver,
                composer: afterIllustrationFailComposer,
            }),
        ).rejects.toThrow(/post-illustration/);

        // Cleanup: both illustration and card (if partially written) removed; OUT absent.
        expect(existsSync(OUT)).toBeFalse();
        const outFiles = existsSync(outDir) ? readdirSync(outDir).filter((f) => f !== 'content.json') : [];
        expect(outFiles).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────
// Plan item 8: non-compose tests stay green
// ─────────────────────────────────────────────────────────────

describe('Plan 8 — non-compose formats unaffected (R6)', () => {
    test('free job on the built-in free format bypasses composer entirely', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver, generateCalls } = stubProvider();
        const { composer, calls: composerCalls } = stubComposer();
        writeFileSync(
            IN,
            JSON.stringify([{ id: 'p1', body: 'a red bicycle', metadata: { imageGen: { job: 'free' } } }]),
        );
        await processGeneratorIO(IN, OUT, { providerResolver: resolver, composer });
        expect(generateCalls()).toBe(0);
        expect(composerCalls()).toHaveLength(0);
        const content = readOut();
        expect(content.format).toBe('image');
    });

    test('cover job dry run bypasses composer', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver, generateCalls } = stubProvider();
        const { composer, calls: composerCalls } = stubComposer();
        writeFileSync(IN, JSON.stringify([{ id: 'c1', body: 'body', metadata: { imageGen: { job: 'cover' } } }]));
        await processGeneratorIO(IN, OUT, { providerResolver: resolver, composer });
        expect(generateCalls()).toBe(0);
        expect(composerCalls()).toHaveLength(0);
    });
});
