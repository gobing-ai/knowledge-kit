import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { processGeneratorIO } from '../src/index';
import { createMinimax } from '../src/providers/minimax';

// Failure-first: explicit provider failure is retried without switching vendors; failures are
// bounded; numeric policy/auth/quota codes cannot be hidden by vague messages; successful image
// downloads are never regenerated. Exercise the actual plugin entry over a local HTTP server.
test('MiniMax system failures recover through the real image-gen entry; permanent failures stop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kk-minimax-recovery-'));
    const entry = resolve(import.meta.dir, '../src/index.ts');
    const cases = [
        { name: 'system-error-recovers', codes: [1033, 0], expectedCalls: 2, ok: true },
        { name: 'internal-error-recovers', codes: [1024, 0], expectedCalls: 2, ok: true },
        { name: 'unknown-error-bounded', codes: [1000, 1000, 1000, 0], expectedCalls: 3, ok: false },
        { name: 'policy-no-retry', codes: [1026, 0], expectedCalls: 1, ok: false },
        { name: 'auth-no-retry', codes: [1004, 0], expectedCalls: 1, ok: false },
        { name: 'balance-no-retry', codes: [1008, 0], expectedCalls: 1, ok: false },
        { name: 'invalid-params-no-retry', codes: [2013, 0], expectedCalls: 1, ok: false },
        { name: 'invalid-params-timeout-word-no-retry', codes: [2013, 0], expectedCalls: 1, ok: false },
        { name: 'http-error-recovers', codes: [503, 0], expectedCalls: 2, ok: true },
        { name: 'timeout-code-recovers', codes: [1001, 0], expectedCalls: 2, ok: true },
        { name: 'download-failure-no-regeneration', codes: [-1, 0], expectedCalls: 1, ok: false },
        { name: 'policy-code-on-http500-no-retry', codes: [-1026, 0], expectedCalls: 1, ok: false },
    ];
    const evidence: Record<string, unknown>[] = [];
    try {
        for (const scenario of cases) {
            let calls = 0;
            const server = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch(request) {
                    if (new URL(request.url).pathname === '/download') return new Response('failed', { status: 503 });
                    expect(new URL(request.url).pathname).toBe('/v1/image_generation');
                    const code = scenario.codes[calls++] ?? 0;
                    if (code === -1026)
                        return Response.json(
                            { base_resp: { status_code: 1026, status_msg: 'system error' } },
                            { status: 500 },
                        );
                    if (code === 503) return new Response('temporary failure', { status: 503 });
                    if (code === -1)
                        return Response.json({ data: { image_urls: [new URL('/download', request.url).href] } });
                    return Response.json({
                        base_resp: {
                            status_code: code,
                            status_msg:
                                scenario.name === 'invalid-params-timeout-word-no-retry'
                                    ? 'request timeout'
                                    : 'system error',
                        },
                        ...(code === 0
                            ? { data: { image_base64: [Buffer.from('fixture-image').toString('base64')] } }
                            : {}),
                    });
                },
            });
            try {
                const input = join(root, `${scenario.name}.in.json`);
                const output = join(root, `${scenario.name}.out.json`);
                await writeFile(
                    input,
                    JSON.stringify([
                        {
                            id: 'cover',
                            title: 'cover',
                            body: '',
                            metadata: {
                                imageGen: { job: 'cover', provider: 'minimax', model: 'image-01', maxImages: 1 },
                            },
                        },
                    ]),
                );
                const child = Bun.spawn(['bun', entry, '--in', input, '--out', output], {
                    cwd: root,
                    env: { ...process.env, MINIMAX_API_KEY: 'fixture-only', MINIMAX_BASE_URL: String(server.url) },
                    stdout: 'pipe',
                    stderr: 'pipe',
                });
                const stderrPromise = new Response(child.stderr).text();
                const stdoutPromise = new Response(child.stdout).text();
                const exitCode = await child.exited;
                const stderr = await stderrPromise;
                await stdoutPromise;
                expect(calls, `${scenario.name}: ${stderr}`).toBe(scenario.expectedCalls);
                expect(exitCode === 0, `${scenario.name}: ${stderr}`).toBe(scenario.ok);
                if (scenario.ok) {
                    const content = JSON.parse(await readFile(output, 'utf8'));
                    expect(content.metadata.images[0].provider).toBe('minimax');
                    expect(stderr).toContain('retrying');
                } else {
                    expect(stderr).toContain(
                        scenario.codes[0] === -1 ? 'download image' : `status_code=${Math.abs(scenario.codes[0] ?? 0)}`,
                    );
                    expect(await Bun.file(output).exists()).toBe(false);
                }
                // The public programmatic entry must behave identically to the subprocess entry.
                // Use the real adapter over HTTP, so coverage also measures the recovery code.
                calls = 0;
                const integrationOutput = join(root, `${scenario.name}.integration.json`);
                let integrationFailed = false;
                try {
                    await processGeneratorIO(input, integrationOutput, {
                        providerResolver: () =>
                            createMinimax({
                                env: { MINIMAX_API_KEY: 'fixture-only', MINIMAX_BASE_URL: String(server.url) },
                            }),
                    });
                } catch {
                    integrationFailed = true;
                }
                expect(integrationFailed).toBe(!scenario.ok);
                expect(calls).toBe(scenario.expectedCalls);
                evidence.push({ name: scenario.name, calls, exitCode, pass: true });
            } finally {
                server.stop(true);
            }
        }
        const artifact = resolve(import.meta.dir, '../../../../.works/tmp/test-minimax-recovery/summary.json');
        await Bun.write(artifact, `${JSON.stringify({ version: 1, cases: evidence }, null, 2)}\n`);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 60000);

test('image-gen request deadline interrupts retry backoff without another POST', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kk-minimax-deadline-'));
    let calls = 0;
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch() {
            calls += 1;
            return Response.json({ base_resp: { status_code: 1033, status_msg: 'system error' } });
        },
    });
    try {
        const input = join(root, 'in.json');
        await writeFile(
            input,
            JSON.stringify([{ id: 'cover', body: '', metadata: { imageGen: { job: 'cover', provider: 'minimax' } } }]),
        );
        const started = performance.now();
        await expect(
            processGeneratorIO(input, join(root, 'out.json'), {
                providerResolver: () =>
                    createMinimax({
                        timeoutMs: 100,
                        env: { MINIMAX_API_KEY: 'fixture-only', MINIMAX_BASE_URL: String(server.url) },
                    }),
            }),
        ).rejects.toThrow();
        expect(performance.now() - started).toBeLessThan(700);
        expect(calls).toBe(1);
    } finally {
        server.stop(true);
        await rm(root, { recursive: true, force: true });
    }
});
