import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAzureBaseURL, validateReferenceImages } from '../../src/providers/azure';
import { PROVIDERS } from '../../src/providers/types';

describe('azure endpoint parsing', () => {
    test('extracts deployment from a deployments URL', () => {
        const endpoint = parseAzureBaseURL('https://my-resource.openai.azure.com/openai/deployments/my-deploy');
        expect(endpoint.resourceBaseURL).toBe('https://my-resource.openai.azure.com/openai');
        expect(endpoint.deployment).toBe('my-deploy');
    });

    test('falls back to gpt-image-2 for a plain resource URL', () => {
        const endpoint = parseAzureBaseURL('https://my-resource.openai.azure.com');
        expect(endpoint.resourceBaseURL).toBe('https://my-resource.openai.azure.com/openai');
        expect(endpoint.deployment).toBe(null);
    });
});

describe('azure provider', () => {
    test('reference images must be PNG or JPG', () => {
        expect(() => validateReferenceImages(['/tmp/ref.webp'])).toThrow('PNG or JPG/JPEG');
        expect(() => validateReferenceImages(['/tmp/ref.png', '/tmp/a.jpg'])).not.toThrow();
    });

    test('isAvailable from env only', () => {
        expect(PROVIDERS.azure.create({ env: {} }).isAvailable()).toBe(false);
        expect(PROVIDERS.azure.create({ env: { AZURE_OPENAI_API_KEY: 'k' } }).isAvailable()).toBe(true);
    });

    test('generate posts to the deployments endpoint', async () => {
        const b64 = Buffer.from('imgbytes').toString('base64');
        let captured = '';
        const provider = PROVIDERS.azure.create({
            env: {
                AZURE_OPENAI_API_KEY: 'k',
                AZURE_OPENAI_BASE_URL: 'https://resource.example/openai/deployments/dep-x',
            },
            fetch: (async (input) => {
                captured = String(input);
                return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'gpt-image-2' });
        expect(result.provider).toBe('azure');
        expect(result.extension).toBe('png');
        expect(result.bytes.length).toBe(8);
        expect(captured).toContain('/openai/deployments/gpt-image-2/images/generations?api-version=');
    });

    test('generate without env throws', async () => {
        const provider = PROVIDERS.azure.create({ env: {} });
        expect(await provider.generate({ prompt: 'p', model: 'gpt-image-2' }).catch((e: Error) => e.message)).toContain(
            'AZURE_OPENAI_API_KEY is required',
        );
    });

    test('parseAzureBaseURL handles bare deployments paths, trailing slashes, and encoded names', () => {
        const noOpenai = parseAzureBaseURL('https://r.example/deployments/dep');
        expect(noOpenai.resourceBaseURL).toBe('https://r.example/openai');
        expect(noOpenai.deployment).toBe('dep');

        const slashed = parseAzureBaseURL('https://r.example/openai/deployments/dep%20x/');
        expect(slashed.resourceBaseURL).toBe('https://r.example/openai');
        expect(slashed.deployment).toBe('dep x');

        const plainOpenai = parseAzureBaseURL('https://r.example/openai');
        expect(plainOpenai.resourceBaseURL).toBe('https://r.example/openai');
        expect(plainOpenai.deployment).toBe(null);
    });

    test('defaultModel precedence: explicit deployment, URL deployment, malformed URL, frozen default', () => {
        expect(PROVIDERS.azure.create({ env: { AZURE_OPENAI_DEPLOYMENT: ' dep-env ' } }).defaultModel()).toBe(
            'dep-env',
        );
        expect(
            PROVIDERS.azure
                .create({ env: { AZURE_OPENAI_BASE_URL: 'https://r.example/openai/deployments/dep-url' } })
                .defaultModel(),
        ).toBe('dep-url');
        expect(PROVIDERS.azure.create({ env: { AZURE_OPENAI_BASE_URL: 'not a url' } }).defaultModel()).toBe(
            'gpt-image-2',
        );
        expect(PROVIDERS.azure.create({ env: {} }).defaultModel()).toBe('gpt-image-2');
    });

    test('validate delegates to the PNG/JPG reference gate', () => {
        const provider = PROVIDERS.azure.create({ env: {} });
        expect(() => provider.validate({ prompt: 'p', model: 'm', referenceImages: ['/tmp/a.bmp'] })).toThrow(
            'PNG or JPG/JPEG',
        );
        expect(() => provider.validate({ prompt: 'p', model: 'm' })).not.toThrow();
    });

    test('missing base URL with a key present fails loudly', async () => {
        const provider = PROVIDERS.azure.create({ env: { AZURE_OPENAI_API_KEY: 'k' } });
        expect(await provider.generate({ prompt: 'p', model: 'm' }).catch((e: Error) => e.message)).toContain(
            'AZURE_OPENAI_BASE_URL is required',
        );
    });

    test('blank model is rejected before any fetch', async () => {
        const provider = PROVIDERS.azure.create({
            env: { AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_BASE_URL: 'https://r.example' },
            fetch: (() => {
                throw new Error('fetch must not be called');
            }) as unknown as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: '   ' }).catch((e: Error) => e.message)).toContain(
            'deployment name is required',
        );
    });

    test('edits path posts multipart form with quality and per-image mime', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'azure-test-'));
        const refPath = join(dir, 'ref.png');
        await writeFile(refPath, Buffer.from('refbytes'));
        const b64 = Buffer.from('imgbytes').toString('base64');
        let capturedUrl = '';
        let capturedHeaders: Record<string, string> | undefined;
        let capturedForm: FormData | undefined;
        const provider = PROVIDERS.azure.create({
            env: {
                AZURE_OPENAI_API_KEY: 'k',
                AZURE_OPENAI_BASE_URL: 'https://r.example/openai/deployments/dep-x',
                AZURE_API_VERSION: '2024-01-01',
            },
            fetch: (async (input, init) => {
                capturedUrl = String(input);
                capturedHeaders = init?.headers as Record<string, string>;
                capturedForm = init?.body as FormData;
                return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({
            prompt: 'p',
            model: 'dep-x',
            referenceImages: [refPath],
            width: 512,
            height: 512,
            quality: '2k',
        });
        expect(result.provider).toBe('azure');
        expect(result.extension).toBe('png');
        expect(capturedUrl).toBe('https://r.example/openai/deployments/dep-x/images/edits?api-version=2024-01-01');
        expect(capturedHeaders?.['api-key']).toBe('k');
        expect(capturedForm?.get('prompt')).toBe('p');
        expect(capturedForm?.get('size')).toBe('512x512');
        expect(capturedForm?.get('quality')).toBe('high');
        const uploaded = capturedForm?.get('image[]');
        expect(uploaded instanceof File && (uploaded as File).name).toBe('ref.png');
    });

    test('edits and generations API errors surface the response body', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'azure-err-'));
        const refPath = join(dir, 'ref.png');
        await writeFile(refPath, Buffer.from('refbytes'));
        const base = { AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_BASE_URL: 'https://r.example' };
        const fail = () => new Response('boom', { status: 500 }) as unknown as Response;
        const edits = PROVIDERS.azure.create({ env: base, fetch: fail });
        expect(
            await edits
                .generate({ prompt: 'p', model: 'm', referenceImages: [refPath] })
                .catch((e: Error) => e.message),
        ).toContain('Azure OpenAI edits API error: boom');
        const generations = PROVIDERS.azure.create({ env: base, fetch: fail });
        expect(await generations.generate({ prompt: 'p', model: 'm' }).catch((e: Error) => e.message)).toContain(
            'Azure OpenAI API error: boom',
        );
    });

    test('generations body carries default quality and derived size', async () => {
        let body = '';
        const provider = PROVIDERS.azure.create({
            env: { AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_BASE_URL: 'https://r.example' },
            fetch: (async (_input, init) => {
                body = String(init?.body);
                return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('x').toString('base64') }] }), {
                    status: 200,
                });
            }) as typeof fetch,
        });
        await provider.generate({ prompt: 'p', model: 'gpt-image-2', aspectRatio: '16:9' });
        const parsed = JSON.parse(body) as { size: string; quality: string; n: number };
        expect(parsed.quality).toBe('medium');
        expect(parsed.n).toBe(1);
        expect(parsed.size).toMatch(/^\d+x\d+$/);
    });
});
