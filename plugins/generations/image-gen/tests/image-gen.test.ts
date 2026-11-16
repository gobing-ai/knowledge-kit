import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, ContentSchema, type Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { CardComposer } from '../src/compose/card';
import { DEFAULT_MAX_IMAGES, main, type ProviderResolver, processGeneratorIO, resolveMaxImages } from '../src/index';
import type { ImageJobSpec } from '../src/job';
import type { ImageProvider, ImageRequest } from '../src/providers/types';

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
                    body: 'intro anchor one middle anchor two end',
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
        // 0169: even a dry run validates the anchor plan, so the fixture carries a valid one.
        const positions = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
        const doc: Doc = {
            id: 'a',
            body: positions.join(' '),
            metadata: { imageGen: { job: 'illustration', count: 9 }, positions },
        };

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

describe('the three job branches cross the money-spending boundary (0107)', () => {
    let genCalls = 0;
    let resolveCalls = 0;
    beforeEach(() => {
        genCalls = 0;
        resolveCalls = 0;
    });
    const generatingResolver: ProviderResolver = () => {
        resolveCalls += 1;
        return {
            name: 'generating-stub',
            defaultModel: () => 'stub-model',
            isAvailable: () => true,
            supportsReferenceImages: () => true,
            generate: (req) => {
                genCalls += 1;
                return Promise.resolve({
                    bytes: new Uint8Array([9]),
                    extension: 'png',
                    provider: 'generating-stub',
                    model: req.model,
                });
            },
        };
    };
    for (const job of ['free', 'cover', 'illustration'] as const) {
        test(`a ${job} job calls the provider and writes its artefact beside --out`, async () => {
            await runWith([{ id: 'a', body: 'anchor', metadata: { imageGen: { job }, positions: ['anchor'] } }], {
                providerResolver: generatingResolver,
            });
            expect(genCalls).toBe(1);
            expect(readdirSync(join(TMP, 'out')).filter((name) => name.includes(`-${job}-0`))).toHaveLength(1);
            expect(existsSync(OUT)).toBe(true);
        });
    }

    // 0169: the anchor plan is validated pre-provider, on the paid AND the dry-run branch.
    for (const dryRun of [false, true] as const) {
        for (const plan of [
            {
                name: 'absent anchor',
                body: 'text',
                positions: ['missing'] as string[] | undefined,
                error: /exactly once.*found 0/,
            },
            { name: 'duplicated in body', body: 'twin twin', positions: ['twin'], error: /found 2/ },
            { name: 'anchor not supplied', body: 'text', positions: undefined, error: /anchor missing/ },
            { name: 'empty anchor', body: 'text', positions: [''], error: /found 0/ },
            {
                name: 'contained anchor',
                body: 'foo bar',
                positions: ['foo bar', 'foo'],
                maxImages: 2,
                error: /overlap.*foo bar.*foo/,
            },
            { name: 'partial overlap', body: 'a b c', positions: ['a b', 'b c'], error: /overlap/ },
            { name: 'duplicate entry', body: 'x', positions: ['x', 'x'], error: /overlap/ },
        ]) {
            test(`a bad illustration plan (${plan.name}${dryRun ? ', dry run' : ''}) is rejected before any provider call`, async () => {
                if (dryRun) {
                    process.env.KK_IMAGE_DRY_RUN = '1';
                }
                // Clear prior artefacts but keep TMP/out itself: later tests seed a stale --out there.
                const outDir = join(TMP, 'out');
                for (const name of existsSync(outDir) ? readdirSync(outDir) : []) {
                    rmSync(join(outDir, name), { force: true });
                }
                await expect(
                    runWith(
                        [
                            {
                                id: 'a',
                                body: plan.body,
                                metadata: {
                                    imageGen: {
                                        job: 'illustration',
                                        ...(plan.maxImages !== undefined ? { maxImages: plan.maxImages } : {}),
                                    },
                                    ...(plan.positions !== undefined ? { positions: plan.positions } : {}),
                                },
                            },
                        ],
                        { providerResolver: generatingResolver },
                    ),
                ).rejects.toThrow(plan.error);
                expect(genCalls).toBe(0);
                expect(resolveCalls).toBe(0);
                expect(existsSync(OUT)).toBe(false);
                expect(existsSync(join(TMP, 'out')) ? readdirSync(join(TMP, 'out')) : []).toEqual([]);
            });
        }
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

describe('0182 — the preset canvas reaches the provider, or the delivery is recorded (F618)', () => {
    /** 24-byte PNG header (signature + IHDR) carrying the given canvas. */
    function pngBytes(width: number, height: number): Uint8Array {
        const bytes = new Uint8Array(24);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        const view = new DataView(bytes.buffer);
        view.setUint32(8, 13);
        bytes.set([0x49, 0x48, 0x44, 0x52], 12);
        view.setUint32(16, width);
        view.setUint32(20, height);
        return bytes;
    }

    interface RecordingStub {
        readonly provider: ImageProvider;
        readonly requests: ImageRequest[];
    }

    function recordingStub(
        name: string,
        options: { model?: string; exact?: boolean; bytes: Uint8Array },
    ): RecordingStub {
        const requests: ImageRequest[] = [];
        const model = options.model ?? 'image-01';
        const provider: ImageProvider = {
            name,
            defaultModel: () => model,
            isAvailable: () => true,
            supportsReferenceImages: () => true,
            // Mirrors the MiniMax image-01 rule; the stub answers for the exact gate only.
            ...(options.exact === true ? { exactSize: (m: string): boolean => m === 'image-01' } : {}),
            generate: (request: ImageRequest) => {
                requests.push(request);
                return Promise.resolve({
                    bytes: options.bytes,
                    extension: 'jpg',
                    provider: name,
                    model: request.model,
                });
            },
        };
        return { provider, requests };
    }

    /** Stub composer: a 1080x1440 card PNG, matching the xhs-card canvas the guards expect. */
    function cardComposer(): CardComposer {
        return { compose: async () => pngBytes(1080, 1440) };
    }

    function xhsCardDoc(): Doc {
        return {
            id: 'd1',
            body: 'A knowledge article body.',
            format: 'markdown',
            references: [],
            metadata: {
                imageGen: {
                    job: 'free',
                    format: 'xhs-card',
                    provider: 'minimax',
                    model: 'image-01',
                    vars: { headline: '核心概念', points: '要点一\n要点二' },
                },
            },
        } as Doc;
    }

    let stderr = createBufferTarget();
    let restoreStderr: (() => void) | undefined;

    beforeEach(() => {
        stderr = createBufferTarget();
        restoreStderr = setDefaultOutputTargets({ stderr });
    });

    afterEach(() => {
        restoreStderr?.();
        restoreStderr = undefined;
    });

    async function runOut(
        dir: string,
        docs: Doc[],
        provider: ImageProvider,
        composer?: CardComposer,
    ): Promise<Record<string, unknown>> {
        const out = join(TMP, dir, 'content.json');
        writeFileSync(IN, JSON.stringify(docs));
        await processGeneratorIO(IN, out, {
            providerResolver: () => provider,
            ...(composer !== undefined ? { composer } : {}),
        });
        return JSON.parse(readFileSync(out, 'utf-8')) as Record<string, unknown>;
    }

    function imagesOf(content: Record<string, unknown>): Array<Record<string, unknown>> {
        return ((content.metadata as Record<string, unknown>).images ?? []) as Array<Record<string, unknown>>;
    }

    test('K3: a declared style negative reaches the real provider request after modifiers and before extra', async () => {
        const stubby = recordingStub('minimax', { model: 'image-01', bytes: pngBytes(1344, 576) });
        const doc = {
            id: 'negative-prompt',
            title: 'Negative prompt',
            body: '',
            metadata: {
                imageGen: {
                    job: 'cover',
                    format: 'daily-news-cover',
                    style: 'daily-news',
                    vars: { subject: 'a satellite above a city at dawn' },
                    extra: 'caller-extra',
                },
            },
        } as Doc;

        await runOut('out-k3-negative', [doc], stubby.provider);

        const prompt = stubby.requests[0]?.prompt ?? '';
        expect(prompt).toContain(
            'limited palette, avoid: text, letters, words, numbers, captions, watermark, logo, brand marks, flags, real people, recognizable faces, photorealism, clutter, caller-extra',
        );
        expect(prompt.match(/avoid:/g)).toHaveLength(1);
    });

    test('an aspect-only provider on xhs-card keeps the aspect request and records sizeRequest aspect (R2)', async () => {
        const stubby = recordingStub('minimax', { model: 'image-01', bytes: pngBytes(864, 1152) });
        const content = await runOut('out-0182-aspect', [xhsCardDoc()], stubby.provider, cardComposer());
        expect(stubby.requests[0]?.aspectRatio).toBe('3:4');
        expect(stubby.requests[0]?.width).toBeUndefined();
        expect(stubby.requests[0]?.height).toBeUndefined();
        expect(imagesOf(content)[0]?.sizeRequest).toBe('aspect');
    });

    test(
        'xhs-card on an exact-capable minimax sends 1080x1440 with no aspectRatio; an 864x1152 delivery ' +
            'is recorded and warns, never fails (R1/R3/R5)',
        async () => {
            const stubby = recordingStub('minimax', { model: 'image-01', exact: true, bytes: pngBytes(864, 1152) });
            const content = await runOut('out-0182-exact', [xhsCardDoc()], stubby.provider, cardComposer());

            // The exact request: the declared canvas, aspectRatio omitted (R1/R5).
            expect(stubby.requests[0]?.width).toBe(1080);
            expect(stubby.requests[0]?.height).toBe(1440);
            expect(stubby.requests[0]?.aspectRatio).toBeUndefined();

            const images = imagesOf(content);
            expect(images[0]?.sizeRequest).toBe('exact');
            // The raw provider artifact records what actually arrived (R5).
            const illus = images[0]?.illustration as Record<string, unknown>;
            expect(illus.width).toBe(864);
            expect(illus.height).toBe(1152);
            expect(stderr.text()).toContain(
                "WARN image-gen: minimax/image-01 delivered 864x1152; format 'xhs-card' declares 1080x1440",
            );
        },
    );

    test('unparseable delivery bytes omit width/height, warn exactly once, and the run still succeeds (R3)', async () => {
        const stubby = recordingStub('minimax', { model: 'image-01', exact: true, bytes: new Uint8Array([1, 2, 3]) });
        const content = await runOut('out-0182-junk', [xhsCardDoc()], stubby.provider, cardComposer());
        const images = imagesOf(content);
        expect(images[0]?.sizeRequest).toBe('exact');
        const illus = images[0]?.illustration as Record<string, unknown>;
        expect(illus.width).toBeUndefined();
        expect(illus.height).toBeUndefined();
        expect(stderr.text()).toContain('WARN image-gen: minimax/image-01 delivered unparseable image bytes');
        expect(stderr.text().match(/WARN image-gen:/g)).toHaveLength(1);
    });

    test('the exact gate consults the model actually sent: image-01-live stays aspect-only (R4, D6)', async () => {
        const stubby = recordingStub('minimax', { model: 'image-01-live', exact: true, bytes: pngBytes(1344, 576) });
        const content = await runOut(
            'out-0182-model',
            [
                {
                    id: 'd1',
                    body: 'a red bicycle',
                    format: 'markdown',
                    references: [],
                    metadata: { imageGen: { job: 'cover', provider: 'minimax', model: 'image-01-live' } },
                } as Doc,
            ],
            stubby.provider,
        );
        expect(stubby.requests[0]?.aspectRatio).toBe('21:9');
        expect(stubby.requests[0]?.width).toBeUndefined();
        expect(stubby.requests[0]?.height).toBeUndefined();
        expect(imagesOf(content)[0]?.sizeRequest).toBe('aspect');
    });
});
