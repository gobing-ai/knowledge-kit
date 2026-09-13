import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')) as {
    name: string;
    bin: Record<string, string>;
};

describe('package publish metadata (R1/R2)', () => {
    it('keeps the package name and exposes kk plus the knowledge-kit alias on the same dist artifact', () => {
        expect(pkg.name).toBe('@gobing-ai/knowledge-kit');
        expect(pkg.bin.kk).toBe('./dist/index.js');
        expect(pkg.bin['knowledge-kit']).toBe('./dist/index.js');
    });

    it('prepack stages the dist artifact that both bins name', () => {
        const result = spawnSync('bun', ['run', 'prepack'], { cwd: pkgDir, encoding: 'utf-8' });
        expect(result.status, result.stderr ?? result.stdout).toBe(0);
        for (const bin of Object.values(pkg.bin)) {
            expect(existsSync(join(pkgDir, bin))).toBe(true);
        }
        // 0111: staged product plugins must not carry checkout-bound node_modules.
        for (const collection of ['ingestions', 'generations', 'publishings'] as const) {
            const collectionDir = join(pkgDir, 'plugins', collection);
            if (!existsSync(collectionDir)) {
                continue;
            }
            for (const name of readdirSync(collectionDir)) {
                expect(existsSync(join(collectionDir, name, 'node_modules')), `${collection}/${name}`).toBe(false);
            }
        }
    }, 120_000); // Runs the real build:bundle — far past the 5s default on a cold checkout.
});
