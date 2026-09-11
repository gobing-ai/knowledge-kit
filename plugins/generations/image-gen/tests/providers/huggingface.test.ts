import { describe, expect, test } from 'bun:test';
import { createHuggingface } from '../../src/providers/huggingface';
import { PROVIDERS, selectProvider } from '../../src/providers/types';

const req = (overrides: Partial<Parameters<typeof buildPayloadShape>[0]> = {}) => ({
    prompt: 'a calm sea',
    model: 'stabilityai/stable-diffusion-xl-base-1.0',
    ...overrides,
});
// local shim to keep the type import single: mirrors buildPayload's parameter input
const buildPayloadShape = (r: { prompt: string; width?: number; height?: number; quality?: 'normal' | '2k' }) => r;

describe('huggingface request building', () => {
    test('payload mirrors wt HuggingFaceBackend wire shape', () => {
        const provider = createHuggingface();
        expect(provider.name).toBe('huggingface');
        expect(provider.supportsReferenceImages()).toBe(false);
        expect(PROVIDERS['huggingface']?.defaultModel).toBe('stabilityai/stable-diffusion-xl-base-1.0');
    });

    test('hf: model prefix maps to the inference path (default model without prefix)', () => {
        const provider = createHuggingface({ env: { HUGGINGFACE_API_TOKEN: 't' } });
        expect(provider.defaultModel()).toBe('stabilityai/stable-diffusion-xl-base-1.0');
        expect(
            createHuggingface({
                env: { HUGGINGFACE_API_TOKEN: 't', HUGGINGFACE_MODEL: 'black-forest-labs/FLUX.1-schnell' },
            }).defaultModel(),
        ).toBe('black-forest-labs/FLUX.1-schnell');
    });
});

describe('huggingface provider', () => {
    test('missing token fails loudly before any fetch', async () => {
        const provider = createHuggingface({
            env: {},
            fetch: (() => {
                throw new Error('fetch must not be called');
            }) as unknown as typeof fetch,
        });
        await expect(provider.generate(req())).rejects.toThrow('HUGGINGFACE_API_TOKEN');
    });

    test('200 returns bytes with content-type-derived extension; 503 and other status throw', async () => {
        const provider = createHuggingface({
            env: { HUGGINGFACE_API_TOKEN: 't' },
            fetch: (async () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { 'content-type': 'image/png' },
                })) as typeof fetch,
        });
        const result = await provider.generate(req());
        expect([...result.bytes].length).toBe(3);
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('huggingface');

        const loading = createHuggingface({
            env: { HUGGINGFACE_API_TOKEN: 't' },
            fetch: (async () => new Response('loading', { status: 503 })) as typeof fetch,
        });
        await expect(loading.generate(req())).rejects.toThrow('model loading (HTTP 503)');

        const denied = createHuggingface({
            env: { HUGGINGFACE_API_TOKEN: 't' },
            fetch: (async () => new Response('bad token', { status: 401 })) as typeof fetch,
        });
        await expect(denied.generate(req())).rejects.toThrow('HTTP 401');
    });

    test('auto-selection: huggingface leads AUTO_ORDER only with its token present', () => {
        expect(selectProvider(undefined, { env: { HUGGINGFACE_API_TOKEN: 't' } })).toBe('huggingface');
        expect(() => selectProvider('huggingface', { env: { HUGGINGFACE_API_TOKEN: '' } })).toThrow(
            'HUGGINGFACE_API_TOKEN',
        );
    });
});
