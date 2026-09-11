import { describe, expect, test } from 'bun:test';
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
});
