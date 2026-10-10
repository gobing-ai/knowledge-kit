import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundlePlugins, bundleStagedEntries, EXCLUDE } from './bundle-plugins';

/**
 * Fixture entries must be dependency-free: Bun.build succeeds in-process for
 * them, while the real plugins' `@gobing-ai/*` workspace symlinks only resolve
 * in the full-bundle subprocess run below (0111).
 */
const FIXTURE_ENTRY = 'export const staged = "kk-bundle-fixture";\n';

function makeScratch(label: string): string {
    return mkdtempSync(join(tmpdir(), `kk-0111-${label}-`));
}

/** Write a minimal product plugin source tree: `<root>/<collection>/<name>/`. */
function writePluginSource(root: string, collection: string, name: string): string {
    const pluginDir = join(root, collection, name);
    mkdirSync(join(pluginDir, 'src'), { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), `${JSON.stringify({ name, entry: './src/index.ts' }, null, 4)}\n`);
    writeFileSync(join(pluginDir, 'src', 'index.ts'), FIXTURE_ENTRY);
    return pluginDir;
}

describe('bundle-plugins EXCLUDE (0111)', () => {
    it('prunes staged node_modules (workspace symlinks must not ship)', () => {
        expect(EXCLUDE.test('/ingestions/karakeep-local/node_modules/@gobing-ai/kk-core')).toBe(true);
        expect(EXCLUDE.test('/generations/core-facts-gen/node_modules')).toBe(true);
        expect(EXCLUDE.test('/publishings/emdash-pub/node_modules/')).toBe(true);
        // A plugin's local Python env (omni-voice-gen) is machine-specific, never distribution content.
        expect(EXCLUDE.test('/generations/omni-voice-gen/.venv/bin/python')).toBe(true);
    });

    it('still stages plugin source, manifests, and dist entries', () => {
        expect(EXCLUDE.test('/ingestions/karakeep-local/src/index.ts')).toBe(false);
        expect(EXCLUDE.test('/generations/core-facts-gen/plugin.json')).toBe(false);
        expect(EXCLUDE.test('/publishings/podcast-pub/dist/index.js')).toBe(false);
    });

    it('still prunes tests, evals, and VCS metadata', () => {
        expect(EXCLUDE.test('/ingestions/karakeep-local/tests/karakeep-local.test.ts')).toBe(true);
        expect(EXCLUDE.test('/generations/core-facts-gen/src/foo.test.ts')).toBe(true);
        expect(EXCLUDE.test('/kk/evals/run.md')).toBe(true);
        expect(EXCLUDE.test('/.git/config')).toBe(true);
        expect(EXCLUDE.test('/.DS_Store')).toBe(true);
    });

    it('staging run writes dist entries, rewrites manifests, and leaves no node_modules', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0111-bundle-'));
        const pluginTarget = join(root, 'plugins');
        const marketplaceTarget = join(root, '.claude-plugin');
        const script = fileURLToPath(new URL('./bundle-plugins.ts', import.meta.url));
        // Spawned, not imported: bun test cannot execute Bun.build in-process
        // for the plugins' workspace-symlink deps (0111).
        const result = spawnSync('bun', [script, pluginTarget, marketplaceTarget], { encoding: 'utf-8' });
        try {
            expect(result.status, result.stderr ?? result.stdout).toBe(0);
            expect(existsSync(join(pluginTarget, 'generations', 'core-facts-gen', 'dist', 'index.js'))).toBe(true);
            const stagedManifest = JSON.parse(
                readFileSync(join(pluginTarget, 'generations', 'core-facts-gen', 'plugin.json'), 'utf-8'),
            ) as { entry: string };
            expect(stagedManifest.entry).toBe('./dist/index.js');
            expect(existsSync(join(pluginTarget, 'publishings', 'podcast-pub', 'plugin.json'))).toBe(true);
            for (const collection of ['ingestions', 'generations', 'publishings'] as const) {
                const collectionDir = join(pluginTarget, collection);
                if (!existsSync(collectionDir)) {
                    continue;
                }
                for (const name of readdirSync(collectionDir)) {
                    expect(existsSync(join(collectionDir, name, 'node_modules')), `${collection}/${name}`).toBe(false);
                }
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
        // The subprocess bundles every real product plugin — ~31s measured 2026-10-07
        // solo, worse under full-suite parallel load; default 5s timeout long since flakes.
    }, 120_000);
});

describe('bundle-plugins staging flow (in-process fixtures)', () => {
    it('stages a fixture tree end-to-end: prunes, bundles, and rewrites the manifest', async () => {
        const root = makeScratch('flow-');
        try {
            const pluginSource = join(root, 'source-plugins');
            const marketplaceSource = join(root, 'source-marketplace');
            const fixturePlugin = writePluginSource(pluginSource, 'generations', 'fixture-gen');
            // Ship-shaped junk the prune filter must drop from the staged copy.
            mkdirSync(join(fixturePlugin, 'node_modules', '@gobing-ai'), { recursive: true });
            writeFileSync(join(fixturePlugin, 'node_modules', '@gobing-ai', 'kk-core'), 'workspace stub');
            mkdirSync(marketplaceSource, { recursive: true });
            writeFileSync(join(marketplaceSource, 'marketplace.json'), '{}\n');

            const pluginTarget = join(root, 'staged-plugins');
            const marketplaceTarget = join(root, 'staged-marketplace');
            const result = await bundlePlugins(pluginTarget, marketplaceTarget, pluginSource, marketplaceSource);
            expect(result).toEqual({ pluginTarget, marketplaceTarget });
            expect(existsSync(join(pluginTarget, 'generations', 'fixture-gen', 'dist', 'index.js'))).toBe(true);
            const stagedManifest = JSON.parse(
                readFileSync(join(pluginTarget, 'generations', 'fixture-gen', 'plugin.json'), 'utf-8'),
            ) as { entry: string };
            expect(stagedManifest.entry).toBe('./dist/index.js');
            expect(existsSync(join(marketplaceTarget, 'marketplace.json'))).toBe(true);
            expect(existsSync(join(pluginTarget, 'generations', 'fixture-gen', 'node_modules'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('throws when the staged copy has no product plugins', async () => {
        const root = makeScratch('empty-');
        try {
            const pluginSource = join(root, 'source-plugins');
            const marketplaceSource = join(root, 'source-marketplace');
            mkdirSync(pluginSource, { recursive: true });
            mkdirSync(marketplaceSource, { recursive: true });
            expect(
                bundlePlugins(
                    join(root, 'staged-plugins'),
                    join(root, 'staged-marketplace'),
                    pluginSource,
                    marketplaceSource,
                ),
            ).rejects.toThrow('no product plugins found');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('counts zero for targets without kind collections or product manifests', async () => {
        const root = makeScratch('count-');
        try {
            const pluginTarget = join(root, 'staged');
            // No 2nd arg: exercises the production pluginSource default.
            expect(await bundleStagedEntries(pluginTarget)).toBe(0);
            mkdirSync(join(pluginTarget, 'ingestions', 'not-a-plugin'), { recursive: true });
            expect(await bundleStagedEntries(pluginTarget, join(root, 'unused-source'))).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('surfaces a Bun.build failure with its logs', async () => {
        const root = makeScratch('brokenbuild-');
        try {
            const pluginTarget = join(root, 'staged');
            const sourcePlugins = join(root, 'source-plugins');
            const broken = join(pluginTarget, 'ingestions', 'broken-gen');
            const brokenSrc = join(sourcePlugins, 'ingestions', 'broken-gen');
            mkdirSync(broken, { recursive: true });
            mkdirSync(brokenSrc, { recursive: true });
            mkdirSync(join(brokenSrc, 'src'), { recursive: true });
            writeFileSync(
                join(brokenSrc, 'src', 'index.ts'),
                "import 'no-such-pkg-0111';\nexport const staged = 'broken';\n",
            );
            writeFileSync(join(broken, 'plugin.json'), JSON.stringify({ name: 'broken-gen', entry: './src/index.ts' }));
            expect(bundleStagedEntries(pluginTarget, sourcePlugins)).rejects.toThrow('bundling broken-gen failed');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a staged manifest without an entry', async () => {
        const root = makeScratch('noentry-');
        try {
            const pluginTarget = join(root, 'staged');
            const broken = join(pluginTarget, 'ingestions', 'broken-gen');
            mkdirSync(broken, { recursive: true });
            writeFileSync(join(broken, 'plugin.json'), `${JSON.stringify({ name: 'broken-gen' }, null, 4)}\n`);
            expect(bundleStagedEntries(pluginTarget, join(root, 'source-plugins'))).rejects.toThrow(
                'staged manifest has no entry',
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects when the source entry is missing', async () => {
        const root = makeScratch('ghost-');
        try {
            const pluginTarget = join(root, 'staged');
            const ghost = join(pluginTarget, 'publishings', 'ghost-pub');
            mkdirSync(ghost, { recursive: true });
            writeFileSync(
                join(ghost, 'plugin.json'),
                `${JSON.stringify({ name: 'ghost-pub', entry: './src/index.ts' }, null, 4)}\n`,
            );
            // Source root without publishings/ghost-pub: entry cannot resolve.
            expect(bundleStagedEntries(pluginTarget, join(root, 'source-plugins'))).rejects.toThrow(
                'source entry missing',
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
