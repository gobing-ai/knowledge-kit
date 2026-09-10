import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { DEFAULT_MAX_IMAGES, main, type ProviderResolver, processGeneratorIO, resolveMaxImages } from '../src/index';
import type { ImageJobSpec } from '../src/job';
import type { ImageProvider } from '../src/providers/types';

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
    TMP = mkdtempSync(join(tmpdir(), 'kk-image-gen-io-'));
    OUT = join(TMP, 'out', 'content.json');
    IN = join(TMP, 'in.json');
});

afterAll(() => {
    if (TMP !== '' && existsSync(TMP)) {
        rmSync(TMP, { recursive: true, force: true });
    }
});

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    // Presets see only the shipped built-ins; the budget/dry-run seams start unset.
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

/** Stub provider whose generate() fails the test if ever reached. */
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

async function runWith(docs: Doc[], options?: { providerResolver?: ProviderResolver }): Promise<void> {
    writeFileSync(IN, JSON.stringify(docs));
    await processGeneratorIO(IN, OUT, options);
}

function readOut(): Content {
    return ContentSchema.parse(JSON.parse(readFileSync(OUT, 'utf-8')));
}

describe('spec §2.5 — empty input is a notice, not a failure', () => {
    test('an empty DocList writes the EMPTY_CONTENT notice', async () => {
        await runWith([]);
        const content = readOut();
        expect(content.body).toContain('Notice');
        expect(content.format).toBe('markdown');
    });
});

describe('R1 — the envelope fails loud before any provider work', () => {
    test('a doc without metadata.imageGen throws naming the path and the jobs; --out stays absent', async () => {
        const { resolver, generateCalls } = stubProvider();
        writeFileSync(IN, JSON.stringify([{ id: 'd1', body: 'x' }]));
        await expect(processGeneratorIO(IN, OUT, { providerResolver: resolver })).rejects.toThrow(/metadata\.imageGen/);
        expect(generateCalls()).toBe(0);
        expect(existsSync(OUT)).toBe(false);
    });
});

describe('R6 — the dry run composes prompts and spends nothing', () => {
    test('a free dry run puts the composed prompt in body and dryRun in metadata', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver, generateCalls } = stubProvider();
        await runWith([{ id: 'p1', body: 'a red bicycle', metadata: { imageGen: { job: 'free' } } }], {
            providerResolver: resolver,
        });
        const content = readOut();
        expect(content.format).toBe('image');
        expect(content.title).toBe('free');
        expect(content.body).toContain('a red bicycle');
        const metadata = content.metadata as Record<string, unknown>;
        expect(metadata.generator).toBe('kk:image-gen');
        expect(metadata.job).toBe('free');
        expect(metadata.dryRun).toBe(true);
        expect(metadata.images).toEqual([]);
        expect(metadata.sourceDocId).toBeUndefined();
        expect(content.references).toEqual([]);
        expect(generateCalls()).toBe(0);
    });

    test('a cover dry run records the source doc id and the format-preset title', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver } = stubProvider();
        await runWith(
            [{ id: 'art-1', body: 'article', title: 'My Article', metadata: { imageGen: { job: 'cover' } } }],
            {
                providerResolver: resolver,
            },
        );
        const content = readOut();
        expect(content.title).toBe('cover');
        expect((content.metadata as Record<string, unknown>).sourceDocId).toBe('art-1');
    });

    test('an illustration dry run composes one prompt per anchor', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver } = stubProvider();
        await runWith(
            [
                {
                    id: 'art-1',
                    body: 'article',
                    metadata: { imageGen: { job: 'illustration' }, positions: ['anchor one', 'anchor two'] },
                },
            ],
            { providerResolver: resolver },
        );
        const content = readOut();
        expect(content.body.split('\n\n---\n\n')).toHaveLength(2);
        expect((content.metadata as Record<string, unknown>).sourceDocId).toBe('art-1');
    });

    test('an illustration count contradicting the anchors fails loud naming both', async () => {
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver } = stubProvider();
        writeFileSync(
            IN,
            JSON.stringify([
                {
                    id: 'a',
                    body: 'x',
                    metadata: { imageGen: { job: 'illustration', count: 3 }, positions: ['a', 'b'] },
                },
            ]),
        );
        await expect(processGeneratorIO(IN, OUT, { providerResolver: resolver })).rejects.toThrow(/3.*2|2.*3/s);
    });
});

describe('R6 — the budget cap refuses before spending', () => {
    test('count 9 without maxImages fails naming 9 and the compiled cap 4; the stub is never called', async () => {
        const { resolver, generateCalls } = stubProvider();
        writeFileSync(
            IN,
            JSON.stringify([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'illustration', count: 9 } } }]),
        );
        await expect(processGeneratorIO(IN, OUT, { providerResolver: resolver })).rejects.toThrow(/9/);
        await expect(processGeneratorIO(IN, OUT, { providerResolver: resolver })).rejects.toThrow(
            new RegExp(`cap ${DEFAULT_MAX_IMAGES}`),
        );
        expect(generateCalls()).toBe(0);
        expect(existsSync(OUT)).toBe(false);
    });

    test('KK_IMAGE_MAX_IMAGES=10 lets count 9 through (dry run), but spec maxImages 2 wins over the env', async () => {
        process.env.KK_IMAGE_MAX_IMAGES = '10';
        process.env.KK_IMAGE_DRY_RUN = '1';
        const { resolver } = stubProvider();
        const doc: Doc = { id: 'a', body: 'x', metadata: { imageGen: { job: 'illustration', count: 9 } } };

        writeFileSync(IN, JSON.stringify([doc]));
        await processGeneratorIO(IN, OUT, { providerResolver: resolver });
        expect(readOut().body.split('\n\n---\n\n')).toHaveLength(9);

        writeFileSync(
            IN,
            JSON.stringify([{ ...doc, metadata: { imageGen: { job: 'illustration', count: 9, maxImages: 2 } } }]),
        );
        await expect(processGeneratorIO(IN, OUT, { providerResolver: resolver })).rejects.toThrow(/cap 2/);
    });

    test('a non-integer KK_IMAGE_MAX_IMAGES fails loud naming the env var', () => {
        expect(resolveMaxImages({ job: 'free', maxImages: 2 })).toBe(2);
        expect(resolveMaxImages({ job: 'free' })).toBe(DEFAULT_MAX_IMAGES);
        process.env.KK_IMAGE_MAX_IMAGES = 'abc';
        expect(() => resolveMaxImages({ job: 'free' })).toThrow(/KK_IMAGE_MAX_IMAGES/);
    });
});

describe('preset and provider resolution fail loud before any spend', () => {
    test('an unknown format preset throws listing the valid formats', async () => {
        const { resolver } = stubProvider();
        await expect(
            runWith([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free', format: 'nope' } } }], {
                providerResolver: resolver,
            }),
        ).rejects.toThrow(/Unknown image format preset 'nope'.*cover, free, illustration/s);
    });

    test('a format whose job contradicts the requested job is a misconfiguration', async () => {
        const { resolver } = stubProvider();
        await expect(
            runWith([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free', format: 'cover' } } }], {
                providerResolver: resolver,
            }),
        ).rejects.toThrow(/drives the 'cover' job.*'free'/s);
    });

    test('an unknown style preset throws listing the valid styles', async () => {
        const { resolver } = stubProvider();
        await expect(
            runWith([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free', style: 'nope' } } }], {
                providerResolver: resolver,
            }),
        ).rejects.toThrow(/Unknown image style preset 'nope'/);
    });

    test('an unknown provider name throws listing the registry', async () => {
        // No injected resolver: the spec's explicit name hits the real selection order.
        await expect(
            runWith([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free', provider: 'nope' } } }]),
        ).rejects.toThrow(/Unknown image provider 'nope'/);
    });

    test('an explicitly requested but unconfigured provider throws naming the missing env', async () => {
        delete process.env.OPENAI_API_KEY;
        process.env.IMAGE_GEN_PROVIDER = 'openai';
        writeFileSync(IN, JSON.stringify([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free' } } }]));
        await expect(processGeneratorIO(IN, OUT, {})).rejects.toThrow(/OPENAI_API_KEY/);
    });
});

describe('the three job branches are stubbed at the money-spending boundary', () => {
    for (const job of ['free', 'cover', 'illustration'] as const) {
        test(`a ${job} job without dry run reports not implemented, naming the job and selected provider`, async () => {
            const { resolver, generateCalls } = stubProvider('stub-provider');
            await expect(
                runWith([{ id: 'a', body: 'x', metadata: { imageGen: { job } } }], { providerResolver: resolver }),
            ).rejects.toThrow(new RegExp(`${job} job not implemented[\\s\\S]*stub-provider`));
            expect(generateCalls()).toBe(0);
            expect(existsSync(OUT)).toBe(false);
            expect(readdirSync(join(TMP, 'out')).filter((name) => name.endsWith('.png'))).toEqual([]);
        });
    }
});

describe('failure cleanup and the CLI surface', () => {
    test('a failing run deletes a stale --out from a previous invocation', async () => {
        writeFileSync(OUT, '{"stale": true}');
        writeFileSync(IN, JSON.stringify([{ id: 'a', body: 'x' }])); // no spec → throws
        await expect(processGeneratorIO(IN, OUT, {})).rejects.toThrow(/metadata\.imageGen/);
        expect(existsSync(OUT)).toBe(false);
    });

    test('main returns 1 on missing flags and on invalid DocList JSON, 0 on a dry-run success', async () => {
        const oldArgv = process.argv;
        try {
            process.argv = ['bun', 'image-gen'];
            expect(await main()).toBe(1);

            writeFileSync(IN, 'not json');
            process.argv = ['bun', 'image-gen', '--in', IN, '--out', OUT];
            expect(await main()).toBe(1);

            process.env.KK_IMAGE_DRY_RUN = '1';
            writeFileSync(IN, JSON.stringify([{ id: 'a', body: 'x', metadata: { imageGen: { job: 'free' } } }]));
            process.env.IMAGE_GEN_PROVIDER = 'openai';
            process.env.OPENAI_API_KEY = 'dry-run-key';
            expect(await main()).toBe(0);
            expect(readOut().format).toBe('image');
        } finally {
            process.argv = oldArgv;
        }
    });
});

describe('ImageJobSpec typing', () => {
    test('the spec type accepts the frozen fields', () => {
        const spec: ImageJobSpec = { job: 'cover' };
        expect(spec.job).toBe('cover');
    });
});
