import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWrapperPath } from '../../src/providers/codex-cli';
import { PROVIDERS } from '../../src/providers/types';

async function writeWrapper(dir: string, ext: '.ts' | '.sh', body: string): Promise<string> {
    const file = join(dir, `wrapper${ext}`);
    await writeFile(file, body);
    return file;
}

describe('codex-cli wrapper resolution', () => {
    test('BAOYU_CODEX_IMAGEGEN_BIN override that exists is used', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-test-'));
        const file = await writeWrapper(dir, '.sh', '#!/bin/sh\n');
        expect(await resolveWrapperPath(() => file)).toBe(file);
    });

    test('missing override throws with guidance', async () => {
        expect(await resolveWrapperPath(() => '').catch((e: Error) => e.message)).toContain('BAOYU_CODEX_IMAGEGEN_BIN');
        expect(await resolveWrapperPath(() => '/does/not/exist.sh').catch((e: Error) => e.message)).toContain(
            'does not exist',
        );
    });
});

describe('codex-cli provider facts', () => {
    test('never auto-selected, always capable of refs, single image', () => {
        const provider = PROVIDERS['codex-cli'].create({ env: {} });
        expect(provider.name).toBe('codex-cli');
        expect(provider.defaultModel()).toBe('codex-image-gen');
        expect(provider.isAvailable()).toBe(false);
        expect(provider.supportsReferenceImages('codex-image-gen')).toBe(true);
        expect(() => provider.validate({ prompt: 'p', model: 'm', n: 2 })).toThrow('n=1');
        expect(() => provider.validate({ prompt: 'p', model: 'm', n: 1 })).not.toThrow();
    });

    test('generate spawns a .ts wrapper and returns the output png', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-test-'));
        const _output = join(dir, 'out.png');
        const promptFile = join(dir, 'prompt.md');
        const wrapper = await writeWrapper(
            dir,
            '.ts',
            [
                'const out = Bun.argv[Bun.argv.indexOf("--image") + 1];',
                'await Bun.write(out, new Uint8Array([1, 2, 3]));',
                'console.log(JSON.stringify({ status: "ok", path: out }));',
            ].join('\n'),
        );
        const provider = PROVIDERS['codex-cli'].create({ env: { BAOYU_CODEX_IMAGEGEN_BIN: wrapper } });
        const result = await provider.generate({
            prompt: 'p',
            model: 'codex-image-gen',
            aspectRatio: '16:9',
            referenceImages: [promptFile.length > 0 ? promptFile : promptFile],
        });
        expect(result.bytes.length).toBe(3);
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('codex-cli');
    });

    test('wrapper errors surface error_kind and error text', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-test-'));
        const wrapper = await writeWrapper(
            dir,
            '.ts',
            'console.log(JSON.stringify({ status: "error", error: "not logged in", error_kind: "auth_error" }));',
        );
        const provider = PROVIDERS['codex-cli'].create({ env: { BAOYU_CODEX_IMAGEGEN_BIN: wrapper } });
        expect(
            await provider.generate({ prompt: 'p', model: 'codex-image-gen' }).catch((e: Error) => e.message),
        ).toContain('auth_error');
    });

    test('non-zero exit with ok status is rejected', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'codex-test-'));
        const wrapper = await writeWrapper(
            dir,
            '.ts',
            'console.log(JSON.stringify({ status: "ok" })); process.exit(3);',
        );
        const provider = PROVIDERS['codex-cli'].create({ env: { BAOYU_CODEX_IMAGEGEN_BIN: wrapper } });
        expect(
            await provider.generate({ prompt: 'p', model: 'codex-image-gen' }).catch((e: Error) => e.message),
        ).toContain('code 3');
    });

    test('no wrapper configured throws', async () => {
        const provider = PROVIDERS['codex-cli'].create({ env: {} });
        expect(
            await provider.generate({ prompt: 'p', model: 'codex-image-gen' }).catch((e: Error) => e.message),
        ).toContain('BAOYU_CODEX_IMAGEGEN_BIN');
    });
});
