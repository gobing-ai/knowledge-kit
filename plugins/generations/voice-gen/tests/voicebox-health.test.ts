import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { createVoiceboxClient, detectCpuFallback } from '../src/index';

/** The live `/health` shape Voicebox answered on 2026-11-20 while rendering on CPU. */
const cpuFallbackHealth = {
    status: 'healthy',
    model_loaded: true,
    gpu_available: true,
    gpu_type: 'MPS (Apple Silicon)',
    backend_type: 'mlx',
    backend_variant: 'cpu',
    gpu_compatibility_warning: null,
};

let stderr: ReturnType<typeof createBufferTarget>;
let restoreOutput: () => void;
beforeEach(() => {
    stderr = createBufferTarget();
    restoreOutput = setDefaultOutputTargets({ stdout: createBufferTarget(), stderr });
});
afterEach(() => {
    restoreOutput();
    delete process.env.VOICEBOX_REQUIRE_GPU;
});

const stub = (body: unknown, status = 200) =>
    (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as typeof fetch;

describe('detectCpuFallback', () => {
    it('R2 — flags gpu_available:true with a non-GPU backend_variant', () => {
        expect(detectCpuFallback(cpuFallbackHealth)?.backend_variant).toBe('cpu');
    });

    it('R2 — stays silent when the GPU path is live, absent, or unreported', () => {
        expect(detectCpuFallback({ ...cpuFallbackHealth, backend_variant: 'mps' })).toBeUndefined();
        expect(detectCpuFallback({ ...cpuFallbackHealth, backend_variant: 'Metal' })).toBeUndefined();
        expect(detectCpuFallback({ ...cpuFallbackHealth, gpu_available: false })).toBeUndefined();
        expect(detectCpuFallback({ ...cpuFallbackHealth, backend_variant: undefined })).toBeUndefined();
    });
});

describe('voice-gen health — silent CPU fallback guard', () => {
    it('R2 — warns loudly on gpu_available:true + backend_variant:"cpu"', async () => {
        const client = createVoiceboxClient({ url: 'http://127.0.0.1:17493', fetch: stub(cpuFallbackHealth) });
        await client.health();
        expect(stderr.text()).toContain('rendering on CPU');
        expect(stderr.text()).toContain('5.6x');
    });

    it('R2 — VOICEBOX_REQUIRE_GPU turns the warning into a failure', async () => {
        process.env.VOICEBOX_REQUIRE_GPU = '1';
        const client = createVoiceboxClient({ url: 'http://127.0.0.1:17493', fetch: stub(cpuFallbackHealth) });
        await expect(client.health()).rejects.toThrow(/rendering on CPU/);
    });

    it('R2 — a healthy GPU backend, a non-JSON body, and an HTTP error keep their existing behavior', async () => {
        const gpu = createVoiceboxClient({
            url: 'http://127.0.0.1:17493',
            fetch: stub({ ...cpuFallbackHealth, backend_variant: 'mps' }),
        });
        await gpu.health();
        expect(stderr.text()).toBe('');

        const opaque = createVoiceboxClient({ url: 'http://127.0.0.1:17493', fetch: stub('ok') });
        await opaque.health();

        const down = createVoiceboxClient({ url: 'http://127.0.0.1:17493', fetch: stub('{}', 503) });
        await expect(down.health()).rejects.toThrow(
            /Voicebox health check failed at http:\/\/127\.0\.0\.1:17493: HTTP 503/,
        );
    });
});
