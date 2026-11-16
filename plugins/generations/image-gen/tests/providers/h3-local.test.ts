import { describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h3Canvas, h3ExactSize } from '../../src/providers/h3-local';
import { AUTO_ORDER, PROVIDERS, selectProvider } from '../../src/providers/types';

/**
 * Task 0379 (feature K2) — the `h3-local` adapter against a FAKE wrapper: no H3 weights, no
 * model load, no network. The fake records its argv and writes controlled bytes where the
 * adapter told it to, which is the whole contract R2/R3/R5 pin.
 */

interface FakeWrapper {
    readonly path: string;
    /** Argv the wrapper received, or null when it was never spawned. */
    args(): Promise<string[] | null>;
}

/** Write an executable `/bin/sh` wrapper that records argv and writes `bytes` to `--output`. */
async function fakeWrapper(
    dir: string,
    options?: { body?: string; exitCode?: number; stderr?: string; noOutput?: boolean },
): Promise<FakeWrapper> {
    const argsFile = join(dir, 'args.txt');
    const path = join(dir, 'h3gen.sh');
    const script = [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > '${argsFile}'`,
        'out=""',
        'prev=""',
        'for a in "$@"; do',
        '  if [ "$prev" = "--output" ]; then out="$a"; fi',
        '  prev="$a"',
        'done',
        ...(options?.body === undefined ? [] : [options.body]),
        ...(options?.noOutput === true ? [] : ['printf \'FAKEPNG\' > "$out"', 'echo "h3gen: wrote $out"']),
        ...(options?.stderr === undefined ? [] : [`printf '%s' '${options.stderr}' >&2`]),
        `exit ${options?.exitCode ?? 0}`,
    ].join('\n');
    await writeFile(path, script, { mode: 0o755 });
    return {
        path,
        args: async () => {
            try {
                const text = await readFile(argsFile, 'utf8');
                return text.trim() === '' ? [] : text.trimEnd().split('\n');
            } catch {
                return null;
            }
        },
    };
}

function flagValue(argv: string[], flag: string): string | undefined {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
}

function allFlagValues(argv: string[], flag: string): string[] {
    return argv.flatMap((arg, index) => (arg === flag ? [argv[index + 1] ?? ''] : []));
}

describe('h3-local size negotiation (AC3)', () => {
    test('legal H3 canvases are exact dimensions and illegal ones fall back to aspect-only', () => {
        expect(h3ExactSize(1024, 1024)).toBe(true);
        expect(h3ExactSize(256, 4096)).toBe(true);
        expect(h3ExactSize(1080, 1440)).toBe(false); // xhs-card: not a multiple of 32
        expect(h3ExactSize(1024, 224)).toBe(false); // below the 256 floor
        expect(h3ExactSize(1024, 4128)).toBe(false); // above the 4096 ceiling
        expect(h3ExactSize(Number.NaN, 1024)).toBe(false);
    });

    test('every aspect ratio maps to a legal canvas', () => {
        for (const ratio of ['1:1', '3:4', '4:3', '16:9', '9:16', '21:9', '2:3']) {
            const canvas = h3Canvas(ratio);
            expect(canvas).not.toBeNull();
            if (canvas === null) continue;
            expect(h3ExactSize(canvas.width, canvas.height)).toBe(true);
        }
        expect(h3Canvas('nonsense')).toBeNull();
    });

    test('adapter reports its exact-size capability through the provider seam', () => {
        const provider = PROVIDERS['h3-local'].create({ env: {} });
        expect(provider.exactSize?.('h3', 1024, 1024)).toBe(true);
        expect(provider.exactSize?.('h3', 1080, 1440)).toBe(false);
    });
});

describe('h3-local provider facts (AC4)', () => {
    test('never auto-selected; explicit selection needs H3_IMAGE_MLX_BIN', () => {
        const provider = PROVIDERS['h3-local'].create({ env: {} });
        expect(provider.name).toBe('h3-local');
        expect(provider.defaultModel()).toBe('h3');
        expect(provider.isAvailable()).toBe(false);
        expect(provider.supportsReferenceImages('h3')).toBe(true);
        expect(AUTO_ORDER).not.toContain('h3-local');

        const ready = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: '/nope/h3gen.sh' } });
        expect(ready.isAvailable()).toBe(true); // env presence only — no filesystem probe

        expect(() => selectProvider('h3-local', { env: {} })).toThrow('H3_IMAGE_MLX_BIN');
        expect(selectProvider('h3-local', { env: { H3_IMAGE_MLX_BIN: '/nope/h3gen.sh' } })).toBe('h3-local');
        expect(() => selectProvider(undefined, { env: { H3_IMAGE_MLX_BIN: '/nope/h3gen.sh' } })).toThrow(
            'No image provider is configured',
        );
    });

    test('n > 1 is rejected before spawning', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir);
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        expect(() => provider.validate?.({ prompt: 'p', model: 'h3', n: 2 })).toThrow('n=1');
        expect(() => provider.validate?.({ prompt: 'p', model: 'h3', n: 1 })).not.toThrow();
        expect(await wrapper.args()).toBeNull();
    });

    test('a missing H3_IMAGE_MLX_BIN fails with guidance', async () => {
        const provider = PROVIDERS['h3-local'].create({ env: {} });
        expect(await provider.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message)).toContain(
            'H3_IMAGE_MLX_BIN',
        );
    });
});

describe('h3-local wrapper invocation (AC2)', () => {
    test('exact canvas is forwarded unchanged with prompt, output and references', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir);
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        const result = await provider.generate({
            prompt: 'a teapot',
            model: 'h3',
            width: 1024,
            height: 1536,
            referenceImages: [join(dir, 'a.png'), join(dir, 'b.png')],
        });

        const argv = await wrapper.args();
        expect(argv).not.toBeNull();
        const args = argv ?? [];
        expect(flagValue(args, '--prompt')).toBe('a teapot');
        expect(flagValue(args, '--width')).toBe('1024');
        expect(flagValue(args, '--height')).toBe('1536');
        expect(allFlagValues(args, '--reference')).toEqual([join(dir, 'a.png'), join(dir, 'b.png')]);
        expect(args).not.toContain('--aspect');

        expect(new TextDecoder().decode(result.bytes)).toBe('FAKEPNG');
        expect(result.provider).toBe('h3-local');
        expect(result.model).toBe('h3');
        expect(result.extension).toBe('png');
    });

    test('aspect-only request becomes a legal canvas and no --aspect flag', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir);
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        await provider.generate({ prompt: 'p', model: 'h3', aspectRatio: '21:9' });

        const args = (await wrapper.args()) ?? [];
        const width = Number(flagValue(args, '--width'));
        const height = Number(flagValue(args, '--height'));
        expect(h3ExactSize(width, height)).toBe(true);
        expect(width / height).toBeCloseTo(21 / 9, 1);
        expect(args).not.toContain('--aspect');
    });

    test('an unparseable aspect ratio still spawns a legal 1:1 canvas', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir);
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        await provider.generate({ prompt: 'p', model: 'h3', aspectRatio: 'wide-ish' });

        const args = (await wrapper.args()) ?? [];
        expect(flagValue(args, '--width')).toBe('1024');
        expect(flagValue(args, '--height')).toBe('1024');
    });
});

describe('h3-local failure and cleanup (AC2/AC3)', () => {
    test('temporary output is removed after success', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir);
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        await provider.generate({ prompt: 'p', model: 'h3' });

        const args = (await wrapper.args()) ?? [];
        const written = flagValue(args, '--output') ?? '';
        expect(written).not.toBe('');
        expect(
            await access(written).then(
                () => true,
                () => false,
            ),
        ).toBe(false);
    });

    test('temporary output is removed after a non-zero exit, whose stderr is preserved', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir, { exitCode: 3, stderr: 'h3gen: FAIL - runtime missing' });
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        const message = await provider.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message);
        expect(message).toContain('code 3');
        expect(message).toContain('runtime missing');

        const args = (await wrapper.args()) ?? [];
        const written = flagValue(args, '--output') ?? '';
        expect(
            await access(written).then(
                () => true,
                () => false,
            ),
        ).toBe(false);
    });

    test('a timeout kills the wrapper and reports diagnostics', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir, { body: '#!/bin/sh\nsleep 30' });
        const provider = PROVIDERS['h3-local'].create({
            env: { H3_IMAGE_MLX_BIN: wrapper.path },
            timeoutMs: 300,
        });
        const message = await provider.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message);
        expect(message).toContain('timed out');
    }, 15000);

    test('a wrapper that cannot be spawned surfaces the spawn error', async () => {
        // A file that exists but is not executable makes `spawn` emit its `error` event rather
        // than a non-zero exit; the adapter must not swallow it into a generic message.
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const notExecutable = join(dir, 'h3gen.sh');
        await writeFile(notExecutable, '#!/bin/sh\n', { mode: 0o644 });
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: notExecutable } });
        const message = await provider.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message);
        expect(message).toMatch(/EACCES|permission/i);
    });

    test('H3_LOCAL_TIMEOUT_MS overrides the 30-minute default, and nonsense falls back to it', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir, { body: '#!/bin/sh\nsleep 30' });
        const overriding = PROVIDERS['h3-local'].create({
            env: { H3_IMAGE_MLX_BIN: wrapper.path, H3_LOCAL_TIMEOUT_MS: '200' },
        });
        expect(await overriding.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message)).toContain(
            'timed out after 200ms',
        );

        const fallingBack = PROVIDERS['h3-local'].create({
            env: { H3_IMAGE_MLX_BIN: (await fakeWrapper(dir)).path, H3_LOCAL_TIMEOUT_MS: 'soon' },
        });
        expect((await fallingBack.generate({ prompt: 'p', model: 'h3' })).provider).toBe('h3-local');
    });

    test('a wrapper that writes no file is an actionable error, not a silent empty result', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'h3-local-'));
        const wrapper = await fakeWrapper(dir, { noOutput: true });
        const provider = PROVIDERS['h3-local'].create({ env: { H3_IMAGE_MLX_BIN: wrapper.path } });
        const message = await provider.generate({ prompt: 'p', model: 'h3' }).catch((e: Error) => e.message);
        expect(message).toContain('no output');
    });
});
