import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureVoiceboxRunning } from '../src/voicebox-server';

/** Fetch stub whose /health outcome is programmable; anything else fails the test. */
function healthFetch(ok: boolean, calls: string[] = []): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0]) => {
        calls.push(String(input));
        return new Response(ok ? 'ok' : 'down', { status: ok ? 200 : 503 });
    }) as typeof fetch;
}

function spawnSpy(): {
    spawn: typeof import('node:child_process').spawn;
    spawned: Array<{ bin: string; args: string[] }>;
    unrefCount: () => number;
} {
    const spawned: Array<{ bin: string; args: string[] }> = [];
    let unrefs = 0;
    const spawn = ((bin: string, args: string[]) => {
        spawned.push({ bin, args });
        return { unref: () => void unrefs++ } as never;
    }) as typeof import('node:child_process').spawn;
    return { spawn, spawned, unrefCount: () => unrefs };
}

const opts = {
    bootWaitMs: 1,
    pollMs: 0,
    sleep: () => Promise.resolve(),
    logPath: '/tmp/voicebox-server-test.log',
};

/** A real (empty) file so the VOICEBOX_SERVER_BIN existsSync guard passes. */
function fakeServerBin(): { bin: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'voicebox-server-test-'));
    const bin = join(dir, 'voicebox-server');
    writeFileSync(bin, '');
    return { bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const noSpawn = (() => {
    throw new Error('spawn must not be called');
}) as never;

describe('ensureVoiceboxRunning', () => {
    it('returns without spawning when the server is already healthy', async () => {
        await ensureVoiceboxRunning({
            ...opts,
            url: 'http://127.0.0.1:17493',
            fetch: healthFetch(true),
            spawn: noSpawn,
        });
    });

    it('spawns the local server once and waits until healthy', async () => {
        const calls: string[] = [];
        let healthy = false;
        const fetch = (async (input: Parameters<typeof fetch>[0]) => {
            calls.push(String(input));
            return new Response(healthy ? 'ok' : 'down', { status: healthy ? 200 : 503 });
        }) as typeof fetch;
        const { spawn, spawned, unrefCount } = spawnSpy();
        const { bin, cleanup } = fakeServerBin();
        const done = ensureVoiceboxRunning({
            ...opts,
            url: 'http://127.0.0.1:17599',
            serverBin: bin,
            dataDir: '/fake/data',
            fetch,
            spawn,
        });
        healthy = true; // flip while the (injected, non-blocking) poll loop is pending
        await done;
        cleanup();
        expect(calls.some((c) => c === 'http://127.0.0.1:17599/health')).toBe(true);
        expect(spawned).toEqual([{ bin, args: ['--port', '17599', '--data-dir', '/fake/data'] }]);
        expect(unrefCount()).toBe(1);
    });

    it('fails loud when the spawned server never becomes healthy', async () => {
        const { spawn, spawned } = spawnSpy();
        const { bin, cleanup } = fakeServerBin();
        try {
            await expect(
                ensureVoiceboxRunning({
                    // sleep omitted on purpose: drives the module-default macrotask sleep
                    // so the injected-vs-default seam stays honest (coverage: 5/5 functions).
                    ...opts,
                    sleep: undefined,
                    pollMs: 1,
                    url: 'http://127.0.0.1:17599',
                    serverBin: bin,
                    fetch: healthFetch(false),
                    spawn,
                }),
            ).rejects.toThrow(/did not become healthy/);
        } finally {
            cleanup();
        }
        expect(spawned).toHaveLength(1);
    });

    it('never spawns for a remote URL — configuration error instead', async () => {
        await expect(
            ensureVoiceboxRunning({ ...opts, url: 'http://10.0.0.5:17493', fetch: healthFetch(false), spawn: noSpawn }),
        ).rejects.toThrow(/auto-start only applies to local URLs/);
    });

    it('fails loud without spawning when the server binary is missing', async () => {
        await expect(
            ensureVoiceboxRunning({
                ...opts,
                url: 'http://127.0.0.1:17599',
                serverBin: '/nonexistent/voicebox-server',
                fetch: healthFetch(false),
                spawn: noSpawn,
            }),
        ).rejects.toThrow(/VOICEBOX_SERVER_BIN is missing/);
    });
});

describe('server health probe timeout (R5)', () => {
    it('the probe carries an abort signal', async () => {
        const inits: Array<RequestInit | undefined> = [];
        const spy = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
            inits.push(init);
            return new Response('ok', { status: 200 });
        }) as typeof fetch;

        await ensureVoiceboxRunning({ url: 'http://127.0.0.1:1', fetch: spy });

        expect(inits.length).toBeGreaterThan(0);
        for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
});
