import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { artifactPath, outStemFor, type ProviderResolver, processGeneratorIO, resolveMaxImages } from '../src/index';
import type { ImageJobSpec } from '../src/job';
import { createSeedream, mapSize } from '../src/providers/seedream';
import type { ImageProvider, ImageRequest, ImageResult } from '../src/providers/types';

let TMP = '';

const ENV_KEYS = ['HOME', 'KK_IMAGE_DRY_RUN', 'KK_IMAGE_MAX_IMAGES', 'ARK_API_KEY', 'IMAGE_GEN_PROVIDER'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    TMP = mkdtempSync(join(tmpdir(), 'kk-image-gen-adapter-'));
    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.HOME = TMP;
    delete process.env.KK_IMAGE_DRY_RUN;
    delete process.env.KK_IMAGE_MAX_IMAGES;
    delete process.env.ARK_API_KEY;
    delete process.env.IMAGE_GEN_PROVIDER;
});

afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

function stubImages(ok: boolean, result?: ImageResult): ImageProvider {
    return {
        name: 'stub',
        defaultModel: () => 'stub-model',
        isAvailable: () => true,
        supportsReferenceImages: () => true,
        generate: (req: ImageRequest) =>
            ok
                ? Promise.resolve(
                      result ?? {
                          bytes: new Uint8Array([1, 2, 3]),
                          extension: 'png',
                          provider: 'stub',
                          model: req.model,
                      },
                  )
                : Promise.reject(new Error('provider boom')),
    };
}

function freeDoc(): Doc {
    return {
        id: 'd1',
        title: 'Demo',
        body: 'a red bicycle',
        format: 'markdown',
        references: [],
        metadata: { imageGen: { job: 'free' } },
    } as Doc;
}

async function writeDoc(out: string, docs: Doc[]): Promise<void> {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(docs));
}

describe('money branch (0107)', () => {
    test('artefacts land beside --out and metadata records them', async () => {
        const out = join(TMP, 'a', 'content.json');
        const inp = join(TMP, 'a', 'in.json');
        await writeDoc(inp, [freeDoc()]);
        await processGeneratorIO(inp, out, { providerResolver: () => stubImages(true) });
        const first = artifactPath(out, outStemFor(out), 'free', 1, 'png');
        expect(new Uint8Array(readFileSync(first))).toEqual(new Uint8Array([1, 2, 3]));
        const content = JSON.parse(readFileSync(out).toString());
        expect(content.metadata.images[0].path).toBe(first);
        expect(content.metadata.images[0].bytes).toBe(3);
    });

    test('deterministic zero-padded names overwrite across re-runs', async () => {
        const out = join(TMP, 'b', 'content.json');
        const inp = join(TMP, 'b', 'in.json');
        await writeDoc(inp, [freeDoc()]);
        const resolver: ProviderResolver = () => stubImages(true);
        await processGeneratorIO(inp, out, { providerResolver: resolver });
        const first = artifactPath(out, outStemFor(out), 'free', 1, 'png');
        await processGeneratorIO(inp, out, { providerResolver: resolver });
        // Same NN on both runs → same file, no duplicates beside --out.
        expect(readdirSync(dirname(out)).filter((f) => f.endsWith('.png'))).toEqual(['content-free-01.png']);
        expect(readFileSync(first).byteLength).toBe(3);
    });

    test('a failed mid-batch run leaves nothing behind', async () => {
        const out = join(TMP, 'c', 'content.json');
        const doc = {
            ...freeDoc(),
            body: 'part A middle B end',
            metadata: { imageGen: { job: 'illustration' }, positions: ['A', 'B'] },
        } as Doc;
        const inp = join(TMP, 'c', 'in.json');
        await writeDoc(inp, [doc]);
        let call = 0;
        const provider = stubImages(true);
        const original = provider.generate.bind(provider);
        provider.generate = (req) => {
            call += 1;
            return call >= 2 ? Promise.reject(new Error('boom on 2')) : original(req);
        };
        await expect(processGeneratorIO(inp, out, { providerResolver: () => provider })).rejects.toThrow('boom on 2');
        expect(readdirSync(dirname(out)).filter((f) => f.endsWith('.png'))).toEqual([]);
    });

    test('illustration inserts refs + captions; original body not mutated in place', async () => {
        const out = join(TMP, 'd', 'content.json');
        const doc = {
            ...freeDoc(),
            body: 'before PILOT after',
            metadata: { imageGen: { job: 'illustration' }, positions: ['PILOT'] },
        } as Doc;
        const inp = join(TMP, 'd', 'in.json');
        await writeDoc(inp, [doc]);
        await processGeneratorIO(inp, out, { providerResolver: () => stubImages(true) });
        const content = JSON.parse(readFileSync(out).toString());
        expect(content.body).toContain('before PILOT');
        expect(content.body).toContain('![Illustration 1](');
        expect(content.metadata.captions[0].anchor).toBe('PILOT');
        expect(content.metadata.images[0].prompt).toContain('PILOT');
    });

    test('KK_IMAGE_MAX_IMAGES override leg with 9 images completes end-to-end', async () => {
        const out = join(TMP, 'f', 'content.json');
        process.env.KK_IMAGE_MAX_IMAGES = '9';
        const positions = Array.from({ length: 9 }, (_, i) => `ANCHOR${i}`);
        const doc = {
            ...freeDoc(),
            body: positions.join(' '),
            metadata: { imageGen: { job: 'illustration' }, positions },
        } as Doc;
        const inp = join(TMP, 'f', 'in.json');
        await writeDoc(inp, [doc]);
        await processGeneratorIO(inp, out, { providerResolver: () => stubImages(true) });
        const content = JSON.parse(readFileSync(out).toString());
        expect(content.metadata.images).toHaveLength(9);
        expect(content.metadata.captions).toHaveLength(9);
        expect(readdirSync(dirname(out)).filter((f) => f.endsWith('.png'))).toHaveLength(9);
    });

    test('dry run still writes no artefact bytes and no generate call', async () => {
        const out = join(TMP, 'e', 'content.json');
        process.env.KK_IMAGE_DRY_RUN = '1';
        const inp = join(TMP, 'e', 'in.json');
        await writeDoc(inp, [freeDoc()]);
        let calls = 0;
        const provider = stubImages(true);
        const original = provider.generate.bind(provider);
        provider.generate = (req) => {
            calls += 1;
            return original(req);
        };
        await processGeneratorIO(inp, out, { providerResolver: () => provider });
        expect(calls).toBe(0);
        expect(readdirSync(dirname(out)).filter((f) => f.includes('cover-'))).toEqual([]);
    });
});

describe('seedream adapter', () => {
    test('mapSize precedence', () => {
        expect(mapSize({ prompt: 'p', model: 'm', width: 200, height: 100 })).toBe('200x100');
        expect(mapSize({ prompt: 'p', model: 'm', aspectRatio: '21:9' })).toBe('21:9');
        expect(mapSize({ prompt: 'p', model: 'm' })).toBe('2K');
    });

    test('generate requires ARK_API_KEY', async () => {
        const adapter = createSeedream();
        await expect(adapter.generate({ prompt: 'x', model: 'm' })).rejects.toThrow('requires ARK_API_KEY');
    });

    test('b64_json payloads decode; request shape rides the registry facts', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        const fetchFn = (async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }), {
                status: 200,
            });
        }) as unknown as typeof fetch;
        process.env.ARK_API_KEY = 'k';
        const adapter = createSeedream({ fetch: fetchFn });
        const result = await adapter.generate({ prompt: 'x', model: 'doubao-seedream-5-0-260128' });
        expect(result.bytes.byteLength).toBe(5);
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('seedream');
        const body = JSON.parse(String(calls[0]?.init?.body));
        expect(body.watermark).toBe(false);
        expect(body.response_format).toBe('url');
        expect(calls[0]?.url).toContain('/images/generations');
    });

    test('reference images are lifted to data URIs and flip response_format', async () => {
        const seen: { url?: string; b64?: never | string; init?: RequestInit; data?: Record<string, unknown> } = {};
        let body: Record<string, unknown> = {};
        const fetchFn = (async (_url: string, init?: RequestInit) => {
            body = JSON.parse(String(init?.body));
            return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('ref').toString('base64') }] }), {
                status: 200,
            });
        }) as unknown as typeof fetch;
        process.env.ARK_API_KEY = 'k';
        const refPath = join(TMP, 'ref.png');
        writeFileSync(refPath, Buffer.from('REFDATA'));
        const adapter = createSeedream({ fetch: fetchFn });
        await adapter.generate({
            prompt: 'y',
            model: 'doubao-seedream-4-0-x',
            referenceImages: [refPath],
        });
        expect(body.response_format).toBe('b64_json');
        expect(String(body.image).startsWith('data:image/png;base64,')).toBe(true);
        void seen;
    });

    test('error responses throw with status and body text', async () => {
        const fetchFn = (async () => new Response('quota exhausted', { status: 429 })) as unknown as typeof fetch;
        process.env.ARK_API_KEY = 'k';
        const adapter = createSeedream({ fetch: fetchFn });
        await expect(adapter.generate({ prompt: 'x', model: 'm' })).rejects.toThrow('429');
    });
});

describe('0107 P4 advisories', () => {
    test('outputStem traversal is refused', () => {
        expect(() => artifactPath('/x/out.json', '../escape', 'free', 1, 'png')).toThrow('path separators');
    });

    test('hostile provider extensions are refused', () => {
        expect(() => artifactPath('/x/out.json', 'stem', 'cover', 1, '../../etc/passwd')).toThrow('alphanumeric');
    });

    test('parseInt leniency closed: 4abc is not 4', () => {
        process.env.KK_IMAGE_MAX_IMAGES = '4abc';
        expect(() => resolveMaxImages({ job: 'free' } as ImageJobSpec)).toThrow(
            "must be a positive integer, received '4abc'",
        );
    });
});
