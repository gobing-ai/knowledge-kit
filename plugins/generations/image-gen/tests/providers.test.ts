import { describe, expect, test } from 'bun:test';
import {
    AUTO_ORDER,
    type FallbackOrder,
    type ImageProvider,
    type ImageRequest,
    type ImageResult,
    PROVIDERS,
    type ProviderFactory,
    resolveFallbackOrder,
    selectProvider,
} from '../src/providers/types';

/**
 * Task 0103 — pins the frozen selection order (the money-spending decision) before any
 * adapter exists. No network, no subprocess: every test injects `env` and/or an
 * `isAvailable` stub, and the I/O-free test's `fetch` stub fails the test if invoked.
 */

const ALL_NAMES = Object.keys(PROVIDERS).sort();

const throwingFetch: typeof fetch = () => {
    throw new Error('network I/O is forbidden in this suite');
};

describe('PROVIDERS registry (R1/R2)', () => {
    test('registers exactly the 12 baoyu adapters plus huggingface (0116) and h3-local (0379)', () => {
        expect(ALL_NAMES).toEqual([
            'agnes',
            'azure',
            'codex-cli',
            'dashscope',
            'google',
            'h3-local',
            'huggingface',
            'jimeng',
            'minimax',
            'openai',
            'openrouter',
            'replicate',
            'seedream',
            'zai',
        ]);
    });

    test('AUTO_ORDER is frozen, excludes the never-auto providers, and covers the rest', () => {
        expect(AUTO_ORDER).not.toContain('codex-cli');
        expect(AUTO_ORDER).not.toContain('h3-local');
        expect([...AUTO_ORDER].sort()).toEqual(ALL_NAMES.filter((name) => name !== 'codex-cli' && name !== 'h3-local'));
    });

    test('ImageRequest accepts referenceImages without a cast and providers satisfy ImageProvider', () => {
        const request: ImageRequest = { prompt: 'p', model: 'gemini-3-pro-image', referenceImages: ['/abs/a.png'] };
        expect(request.referenceImages).toEqual(['/abs/a.png']);

        const factory: ProviderFactory = PROVIDERS.openai.create;
        const provider: ImageProvider = factory({ env: {} });
        expect(provider.name).toBe('openai');

        const result: ImageResult = { bytes: new Uint8Array([1]), extension: 'png', provider: 'x', model: 'm' };
        expect(result.bytes.length).toBe(1);
    });
});

describe('isAvailable performs no I/O (R2/R5)', () => {
    test('every registered adapter answers isAvailable from env only — the injected fetch is never invoked', () => {
        for (const name of ALL_NAMES) {
            const provider = PROVIDERS[name].create({ fetch: throwingFetch, env: {} });
            expect(provider.isAvailable()).toBe(false);
        }
    });

    test('a set env var makes a shell available without touching fetch', () => {
        const provider = PROVIDERS.openai.create({ fetch: throwingFetch, env: { OPENAI_API_KEY: 'sk-test' } });
        expect(provider.isAvailable()).toBe(true);
    });

    test('an empty-string env value counts as unset', () => {
        const provider = PROVIDERS.openai.create({ fetch: throwingFetch, env: { OPENAI_API_KEY: '' } });
        expect(provider.isAvailable()).toBe(false);
    });
});

describe('providers (registry facts)', () => {
    test('name and defaultModel come from the registry row', () => {
        const provider = PROVIDERS.google.create({ env: {} });
        expect(provider.name).toBe('google');
        expect(provider.defaultModel()).toBe('gemini-3-pro-image');
    });

    test('supportsReferenceImages follows the per-model gates recorded in the inventory', () => {
        const google = PROVIDERS.google.create({ env: {} });
        expect(google.supportsReferenceImages('gemini-3-pro-image')).toBe(true);
        expect(google.supportsReferenceImages('models/gemini-3-pro-image')).toBe(true);
        expect(google.supportsReferenceImages('imagen-3.0-generate-002')).toBe(false);

        const openai = PROVIDERS.openai.create({ env: {} });
        expect(openai.supportsReferenceImages('gpt-image-2')).toBe(true);
        expect(openai.supportsReferenceImages('dall-e-3')).toBe(false);

        const dashscope = PROVIDERS.dashscope.create({ env: {} });
        expect(dashscope.supportsReferenceImages('wan2.7-image-pro')).toBe(true);
        expect(dashscope.supportsReferenceImages('qwen-image-2.0-pro')).toBe(false);

        const seedream = PROVIDERS.seedream.create({ env: {} });
        expect(seedream.supportsReferenceImages('doubao-seedream-5-0-260128')).toBe(true);
        expect(seedream.supportsReferenceImages('doubao-seedream-3-0-t2i-250415')).toBe(false);

        expect(PROVIDERS.zai.create({ env: {} }).supportsReferenceImages('glm-image')).toBe(false);
        expect(PROVIDERS.jimeng.create({ env: {} }).supportsReferenceImages('jimeng_t2i_v40')).toBe(true);
        expect(PROVIDERS.minimax.create({ env: {} }).supportsReferenceImages('image-01')).toBe(true);
    });

    test('jimeng requires both halves of its credential pair', () => {
        const jimeng = PROVIDERS.jimeng;
        expect(jimeng.create({ env: { JIMENG_ACCESS_KEY_ID: 'a' } }).isAvailable()).toBe(false);
        expect(jimeng.create({ env: { JIMENG_SECRET_ACCESS_KEY: 'b' } }).isAvailable()).toBe(false);
        expect(jimeng.create({ env: { JIMENG_ACCESS_KEY_ID: 'a', JIMENG_SECRET_ACCESS_KEY: 'b' } }).isAvailable()).toBe(
            true,
        );
    });
});

describe('selectProvider resolution order (R3)', () => {
    test('path 1 — an explicit request wins over everything else', () => {
        const available = (name: string): boolean => name === 'openai' || name === 'replicate';
        expect(selectProvider('replicate', { isAvailable: available })).toBe('replicate');
    });

    test('path 2 — IMAGE_GEN_PROVIDER is honoured when nothing is requested', () => {
        const available = (name: string): boolean => name === 'openai' || name === 'replicate' || name === 'zai';
        const env = { IMAGE_GEN_PROVIDER: 'zai' };
        expect(selectProvider(undefined, { env, isAvailable: available })).toBe('zai');
    });

    test('path 3 — auto picks the earliest AUTO_ORDER provider that is available', () => {
        const available = (name: string): boolean => name === 'replicate' || name === 'openai';
        expect(selectProvider(undefined, { env: {}, isAvailable: available })).toBe('openai');
    });

    test('path 4 — nothing available throws with the per-provider credential map', () => {
        const action = (): string => selectProvider(undefined, { env: {}, isAvailable: () => false });
        expect(action).toThrow('No image provider is configured');
        expect(action).toThrow('google: GOOGLE_API_KEY or GEMINI_API_KEY');
        expect(action).toThrow("codex-cli: requires the 'codex' CLI on PATH with an active login");
    });

    test('an empty-string explicit request falls through to auto-selection', () => {
        const available = (name: string): boolean => name === 'minimax';
        expect(selectProvider('', { env: { IMAGE_GEN_PROVIDER: '' }, isAvailable: available })).toBe('minimax');
    });

    test('failure — an unknown provider throws listing all 13 valid names, without falling through', () => {
        const action = (): string => selectProvider('stable-diffusion', { env: {}, isAvailable: () => true });
        expect(action).toThrow('Unknown image provider');
        for (const name of ALL_NAMES) {
            expect(action).toThrow(name);
        }
    });

    test('failure — IMAGE_GEN_PROVIDER with an unknown name throws the same way', () => {
        const action = (): string => selectProvider(undefined, { env: { IMAGE_GEN_PROVIDER: 'nope' } });
        expect(action).toThrow('Unknown image provider');
        expect(action).toThrow('codex-cli');
    });

    test('failure — a known-but-unconfigured provider names provider and env var, no silent downgrade', () => {
        const action = (): string => selectProvider('openai', { env: {} });
        expect(action).toThrow("Provider 'openai' is not configured: missing OPENAI_API_KEY");
    });

    test('failure — google reports either half of its fallback chain', () => {
        const action = (): string => selectProvider('google', { env: {} });
        expect(action).toThrow('missing GOOGLE_API_KEY or GEMINI_API_KEY');
    });

    test('codex-cli is never auto-selected even when it is the only available provider', () => {
        const action = (): string =>
            selectProvider(undefined, { env: {}, isAvailable: (name) => name === 'codex-cli' });
        expect(action).toThrow('No image provider is configured');
    });

    test('codex-cli can still be pinned explicitly', () => {
        expect(selectProvider('codex-cli', { env: {}, isAvailable: (name) => name === 'codex-cli' })).toBe('codex-cli');
        const unavailable = (): string => selectProvider('codex-cli', { env: {} });
        expect(unavailable).toThrow("Provider 'codex-cli' is not available: requires the 'codex' CLI");
    });
});

describe('resolveFallbackOrder (0165, feature D6 R3)', () => {
    test('absent fallback resolves to just the selected provider — strict behaviour preserved', () => {
        expect(resolveFallbackOrder('minimax', undefined)).toEqual({ order: ['minimax'], skipped: [] });
    });

    test('true follows AUTO_ORDER after requested, excluding codex-cli, keeping AUTO_ORDER order', () => {
        const { order, skipped } = resolveFallbackOrder('minimax', true);
        expect(order).toEqual([
            'minimax',
            'huggingface',
            'google',
            'openai',
            'replicate',
            'openrouter',
            'dashscope',
            'seedream',
            'zai',
            'jimeng',
            'azure',
            'agnes',
        ]);
        expect(skipped).toEqual([]);
    });

    test('an explicit list is honored in exactly the given order (AC1)', () => {
        expect(resolveFallbackOrder('minimax', ['google', 'zai'])).toEqual({
            order: ['minimax', 'google', 'zai'],
            skipped: [],
        });
    });

    test('a list keeps first-occurrence order, dedupes, and drops requested', () => {
        const { order } = resolveFallbackOrder('google', ['zai', 'google', 'openai', 'zai']);
        expect(order).toEqual(['google', 'zai', 'openai']);
    });

    test('an unknown list name throws naming it and the valid set', () => {
        const action = (): FallbackOrder => resolveFallbackOrder('minimax', ['google', 'imagen', 'zai']);
        expect(action).toThrow("Unknown fallback provider 'imagen'");
        expect(action).toThrow('Valid providers:');
        for (const valid of ['zai', 'codex-cli', 'minimax']) {
            expect(action).toThrow(valid);
        }
    });

    test('an explicitly listed NEVER_AUTO provider is kept — NEVER_AUTO governs automatic choice only', () => {
        expect(resolveFallbackOrder('minimax', ['codex-cli', 'zai']).order).toEqual(['minimax', 'codex-cli', 'zai']);
    });

    test('skipReason drops a candidate into skipped, in walk order, and never touches requested', () => {
        const { order, skipped } = resolveFallbackOrder('minimax', true, {
            skipReason: (name) => (name === 'huggingface' ? 'missing HUGGINGFACE_API_TOKEN' : undefined),
        });
        expect(order).toEqual([
            'minimax',
            'google',
            'openai',
            'replicate',
            'openrouter',
            'dashscope',
            'seedream',
            'zai',
            'jimeng',
            'azure',
            'agnes',
        ]);
        expect(skipped).toEqual([{ provider: 'huggingface', reason: 'missing HUGGINGFACE_API_TOKEN' }]);
    });

    test('requested is never asked of skipReason — the order always starts with the selected provider', () => {
        const asked: string[] = [];
        const { order, skipped } = resolveFallbackOrder('google', ['google', 'zai'], {
            skipReason: (name) => {
                asked.push(name);
                return 'unconfigured';
            },
        });
        expect(order).toEqual(['google']);
        expect(skipped).toEqual([{ provider: 'zai', reason: 'unconfigured' }]);
        expect(asked).toEqual(['zai']);
    });

    test('every candidate skipped still leaves a non-empty order led by requested (R5 exhaustion input)', () => {
        const { order, skipped } = resolveFallbackOrder('openai', ['zai', 'minimax'], {
            skipReason: () => 'no reference support',
        });
        expect(order).toEqual(['openai']);
        expect(skipped).toEqual([
            { provider: 'zai', reason: 'no reference support' },
            { provider: 'minimax', reason: 'no reference support' },
        ]);
    });
});

/**
 * R5: Bun's `fetch` has no overall request deadline, so every provider call must pass a `signal`.
 * A stalled peer would otherwise hang the workflow step until someone killed the run.
 */
describe('every provider fetch carries an abort signal (R5)', () => {
    // codex-cli and h3-local shell out to a local runtime instead of making HTTP calls.
    const FETCHING = ALL_NAMES.filter((name) => name !== 'codex-cli' && name !== 'h3-local');

    // The registry names credentials only; these are endpoint/deployment config an adapter needs
    // before it can build a request URL at all.
    const EXTRA_ENV: Record<string, Record<string, string>> = {
        azure: { AZURE_OPENAI_BASE_URL: 'https://res.openai.azure.com/openai/deployments/dep' },
    };

    test.each(FETCHING)('%s passes signal on every request', async (name) => {
        const spec = PROVIDERS[name];
        if (spec === undefined) throw new Error(`no registration for ${name}`);

        const inits: Array<RequestInit | undefined> = [];
        const spy = (async (_input: unknown, init?: RequestInit): Promise<Response> => {
            inits.push(init);
            return new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }) as typeof fetch;

        // Dummy credential values make each adapter usable; `envAll` rows need every listed key.
        const env: Record<string, string> = {};
        for (const key of [...spec.env, ...(spec.envAll ?? [])]) env[key] = 'test-value';
        Object.assign(env, EXTRA_ENV[name] ?? {});

        const provider = spec.create({ env, fetch: spy, timeoutMs: 50 });
        try {
            await provider.generate({ prompt: 'a cat', model: spec.defaultModel } as ImageRequest);
        } catch {
            // A generic body cannot satisfy every response parser; the fetch call (and its signal)
            // happens before parsing, which is what this test asserts.
        }
        expect(inits.length).toBeGreaterThan(0);
        for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    test('the overridable timeout actually aborts a stalled request', async () => {
        // Never resolves on its own — only the abort can settle this promise.
        const spy = ((_input: unknown, init?: RequestInit): Promise<Response> =>
            new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal;
                if (!signal) {
                    reject(new Error('no abort signal was passed'));
                    return;
                }
                signal.addEventListener('abort', () => reject(new Error(`aborted: ${String(signal.reason)}`)));
            })) as typeof fetch;

        const provider = PROVIDERS.agnes?.create({
            env: { AGNES_API_KEY: 'k' },
            fetch: spy,
            timeoutMs: 50,
        });
        await expect(provider?.generate({ prompt: 'x', model: 'm' } as ImageRequest)).rejects.toBeDefined();
    });
});
