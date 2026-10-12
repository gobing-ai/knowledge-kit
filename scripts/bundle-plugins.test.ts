import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLEABLE, bundlePlugins, bundleStagedEntries, EXCLUDE } from './bundle-plugins';

/**
 * Fixture entries must be dependency-free: Bun.build succeeds in-process for
 * them, while the real plugins' `@gobing-ai/*` workspace symlinks only resolve
 * in the full-bundle subprocess run below (0111).
 */
const FIXTURE_ENTRY = 'export const staged = "kk-bundle-fixture";\n';
/** Declared-check fixture body, dependency-free for the same in-process Bun.build reason. */
const FIXTURE_CHECK = 'export const check = "kk-bundle-check-fixture";\n';
/** Non-JS declared check: staging must copy it verbatim, never feed it to Bun.build. */
const FIXTURE_SHELL_CHECK = '#!/bin/sh\necho \'{"status":"error","detail":"fixture shell check ran"}\'\nexit 2\n';

/** Repo root — the source manifests staging must never mutate. */
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const STAGING_SCRIPT = fileURLToPath(new URL('./bundle-plugins.ts', import.meta.url));

/** Real plugins whose manifest declares a TypeScript readiness check (0249 review F2; `weibo-pub` added 0245). */
const CHECK_DECLARING_PLUGINS = [
    'infoq-pub',
    'juejin-pub',
    'substack-pub',
    'wechatmp-pub',
    'weibo-pub',
    'x-pub',
    'xhs-pub',
];

function makeScratch(label: string): string {
    return mkdtempSync(join(tmpdir(), `kk-0111-${label}-`));
}

/** Write a minimal product plugin source tree: `<root>/<collection>/<name>/`. */
function writePluginSource(root: string, collection: string, name: string): string {
    return writePluginFixture(root, collection, name);
}

/**
 * Write a minimal plugin source tree at `<root>/<collection>/<name>/` declaring
 * `entry` and, optionally, a `check`. `checkBody: null` declares the check path
 * without creating the file — the fail-loud fixture for a missing check source.
 */
function writePluginFixture(
    root: string,
    collection: string,
    name: string,
    declared: { entry?: string; check?: string } = {},
    bodies: { entryBody?: string; checkBody?: string | null } = {},
): string {
    const pluginDir = join(root, collection, name);
    mkdirSync(join(pluginDir, 'src'), { recursive: true });
    const manifest: { name: string; entry: string; check?: string } = {
        name,
        entry: declared.entry ?? './src/index.ts',
    };
    if (declared.check !== undefined) {
        manifest.check = declared.check;
    }
    writeFileSync(join(pluginDir, 'plugin.json'), `${JSON.stringify(manifest, null, 4)}\n`);
    writeFileSync(join(pluginDir, 'src', 'index.ts'), bodies.entryBody ?? FIXTURE_ENTRY);
    if (declared.check !== undefined && bodies.checkBody !== null) {
        const checkPath = join(pluginDir, declared.check.replace(/^\.\//, ''));
        const isModule = /\.(mts|cts|ts|tsx|js|jsx|mjs|cjs)$/i.test(declared.check);
        mkdirSync(dirname(checkPath), { recursive: true });
        writeFileSync(checkPath, bodies.checkBody ?? (isModule ? FIXTURE_CHECK : FIXTURE_SHELL_CHECK));
        if (!isModule) {
            chmodSync(checkPath, 0o755);
        }
    }
    return pluginDir;
}

/** Await a rejected staging promise and return its message; a resolved promise fails the test. */
async function captureRejection(run: Promise<unknown>): Promise<string> {
    let message: string | undefined;
    try {
        await run;
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    expect(message, 'expected staging to reject').toBeDefined();
    return message ?? '';
}

/** The trailing JSON verdict line a probe prints before its exit code (ADR-032). */
function lastJsonLine(output: string): Record<string, unknown> {
    const line = output
        .trim()
        .split('\n')
        .map((text) => text.trim())
        .reverse()
        .find((text) => text.startsWith('{'));
    expect(line, `no JSON verdict line in: ${output}`).toBeDefined();
    return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

/** Ancestors of `dir` that carry a node_modules — a checkout root does, an isolated temp dir does not. */
function nodeModulesAncestors(dir: string): string[] {
    const found: string[] = [];
    for (let current = resolve(dir); ; current = dirname(current)) {
        if (existsSync(join(current, 'node_modules'))) {
            found.push(current);
        }
        if (dirname(current) === current) {
            return found;
        }
    }
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
            // 0256: the voxcpm-tts uv worker + project assets are copied assets (never bundled),
            // while its manifest entry bundles to dist/index.js like every other generator.
            const voxcpmDir = join(pluginTarget, 'generations', 'voxcpm-tts');
            expect(existsSync(join(voxcpmDir, 'dist', 'index.js'))).toBe(true);
            for (const asset of ['python/worker.py', 'pyproject.toml', 'uv.lock', 'profiles.json']) {
                expect(existsSync(join(voxcpmDir, asset)), asset).toBe(true);
            }
            expect((JSON.parse(readFileSync(join(voxcpmDir, 'plugin.json'), 'utf-8')) as { entry: string }).entry).toBe(
                './dist/index.js',
            );
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

describe('bundle-plugins declared check staging (0249 — real staged tree)', () => {
    let scratch = '';
    let stagedPlugins = '';
    /** Source manifest bytes captured before staging, compared after. */
    const sourceManifests: Record<string, string> = {};

    beforeAll(() => {
        scratch = makeScratch('0249-staged-');
        stagedPlugins = join(scratch, 'plugins');
        for (const name of CHECK_DECLARING_PLUGINS) {
            sourceManifests[name] = readFileSync(
                join(REPO_ROOT, 'plugins', 'publishings', name, 'plugin.json'),
                'utf-8',
            );
        }
        // Spawned, not imported: bun test cannot run Bun.build in-process over the real
        // plugins' @gobing-ai/* workspace symlinks (0111).
        const result = spawnSync('bun', [STAGING_SCRIPT, stagedPlugins, join(scratch, 'marketplace')], {
            encoding: 'utf-8',
        });
        expect(result.status, result.stderr ?? result.stdout).toBe(0);
    }, 120_000);

    afterAll(() => {
        if (scratch !== '') {
            rmSync(scratch, { recursive: true, force: true });
        }
    });

    it('rewrites every declared check to a built dist artifact that exists', () => {
        for (const name of CHECK_DECLARING_PLUGINS) {
            const pluginDir = join(stagedPlugins, 'publishings', name);
            const staged = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf-8')) as {
                entry?: string;
                check?: string;
            };
            expect(staged.check, `${name} staged check`).toMatch(/^\.\/dist\/[^/]+\.js$/);
            expect(
                existsSync(join(pluginDir, (staged.check ?? '').replace(/^\.\//, ''))),
                `${name} ${staged.check}`,
            ).toBe(true);
            // R3: the pruned workspace symlinks must not come back through the check bundle.
            expect(existsSync(join(pluginDir, 'node_modules')), name).toBe(false);
        }
    });

    it('runs a staged browser probe outside the checkout and gets the ADR-032 usage refusal', () => {
        const pluginDir = join(stagedPlugins, 'publishings', 'substack-pub');
        const staged = JSON.parse(readFileSync(join(pluginDir, 'plugin.json'), 'utf-8')) as { check?: string };
        const probeCwd = makeScratch('0249-probe-');
        try {
            // Isolation precondition: nothing above the probe cwd offers node_modules, so a
            // run that resolves @gobing-ai/* can only have used the staged bundle itself.
            expect(nodeModulesAncestors(probeCwd)).toEqual([]);
            const env = { ...process.env };
            // Safe refusal (AC1): no publication URL means no browser is ever launched.
            delete env.SUBSTACK_PUBLICATION_URL;
            delete env.SUBSTACK_PROFILE_DIR;
            delete env.KK_BROWSER_PROFILE_DIR;
            const result = spawnSync('bun', [join(pluginDir, (staged.check ?? '').replace(/^\.\//, '')), 'check'], {
                cwd: probeCwd,
                encoding: 'utf-8',
                env,
            });
            const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
            // The defect under test: a raw staged ./src/*.ts dies on workspace imports.
            expect(output).not.toContain('Cannot find module');
            expect(result.status, output).toBe(2);
            const verdict = lastJsonLine(result.stdout ?? '');
            expect(verdict.status).toBe('error');
            expect(String(verdict.detail)).toContain('SUBSTACK_PUBLICATION_URL');
        } finally {
            rmSync(probeCwd, { recursive: true, force: true });
        }
    });

    it('leaves the source manifests byte-unchanged', () => {
        for (const name of CHECK_DECLARING_PLUGINS) {
            const sourceManifestPath = join(REPO_ROOT, 'plugins', 'publishings', name, 'plugin.json');
            const current = readFileSync(sourceManifestPath, 'utf-8');
            expect(current, name).toBe(sourceManifests[name]);
            expect((JSON.parse(current) as { check?: string }).check, name).toBe('./src/profile-check.ts');
        }
    });
});

describe('bundle-plugins declared check staging (0249 — fixtures)', () => {
    /** Stage `sourcePlugins` in-process and return the staged fixture directories. */
    async function stageFixtureTree(
        root: string,
        sourcePlugins: string,
    ): Promise<{ stagedPlugins: string; marketplaceTarget: string }> {
        const marketplaceSource = join(root, 'source-marketplace');
        mkdirSync(marketplaceSource, { recursive: true });
        writeFileSync(join(marketplaceSource, 'marketplace.json'), '{}\n');
        const pluginTarget = join(root, 'staged-plugins');
        const marketplaceTarget = join(root, 'staged-marketplace');
        await bundlePlugins(pluginTarget, marketplaceTarget, sourcePlugins, marketplaceSource);
        return { stagedPlugins: pluginTarget, marketplaceTarget };
    }

    it('bundles a declared check to its own dist artifact and keeps the source manifest untouched', async () => {
        const root = makeScratch('0249-check-');
        try {
            const sourcePlugins = join(root, 'source-plugins');
            const fixtureDir = writePluginFixture(sourcePlugins, 'publishings', 'fixture-check-pub', {
                check: './src/profile-check.ts',
            });
            const sourceManifestPath = join(fixtureDir, 'plugin.json');
            const sourceManifest = readFileSync(sourceManifestPath, 'utf-8');

            const { stagedPlugins } = await stageFixtureTree(root, sourcePlugins);
            const stagedDir = join(stagedPlugins, 'publishings', 'fixture-check-pub');
            const staged = JSON.parse(readFileSync(join(stagedDir, 'plugin.json'), 'utf-8')) as {
                entry: string;
                check: string;
            };
            expect(staged.entry).toBe('./dist/index.js');
            expect(staged.check).toMatch(/^\.\/dist\/[^/]+\.js$/);
            // The probe is its own artifact, not a second name on the entry bundle.
            expect(staged.check).not.toBe(staged.entry);
            expect(existsSync(join(stagedDir, staged.check.replace(/^\.\//, '')))).toBe(true);
            expect(readFileSync(sourceManifestPath, 'utf-8')).toBe(sourceManifest);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves a plugin without a declared check unchanged', async () => {
        const root = makeScratch('0249-nocheck-');
        try {
            const sourcePlugins = join(root, 'source-plugins');
            writePluginFixture(sourcePlugins, 'generations', 'no-check-gen');
            const { stagedPlugins } = await stageFixtureTree(root, sourcePlugins);

            const stagedDir = join(stagedPlugins, 'generations', 'no-check-gen');
            const staged = JSON.parse(readFileSync(join(stagedDir, 'plugin.json'), 'utf-8')) as { check?: string };
            expect(staged.check).toBeUndefined();
            expect(readdirSync(join(stagedDir, 'dist')).sort()).toEqual(['index.js']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves an executable non-JS check as a copied asset', async () => {
        const root = makeScratch('0249-nonjs-');
        try {
            const sourcePlugins = join(root, 'source-plugins');
            writePluginFixture(sourcePlugins, 'publishings', 'shell-check-pub', { check: './scripts/probe.sh' });

            const { stagedPlugins } = await stageFixtureTree(root, sourcePlugins);
            const stagedDir = join(stagedPlugins, 'publishings', 'shell-check-pub');
            const staged = JSON.parse(readFileSync(join(stagedDir, 'plugin.json'), 'utf-8')) as { check: string };
            expect(staged.check).toBe('./scripts/probe.sh');

            const stagedCheck = join(stagedDir, 'scripts', 'probe.sh');
            expect(readFileSync(stagedCheck, 'utf-8')).toBe(FIXTURE_SHELL_CHECK);
            expect(statSync(stagedCheck).mode & 0o111).not.toBe(0);

            const probeCwd = makeScratch('0249-nonjs-probe-');
            try {
                const result = spawnSync(stagedCheck, ['check'], { cwd: probeCwd, encoding: 'utf-8' });
                expect(result.status, result.stderr ?? '').toBe(2);
                expect(lastJsonLine(result.stdout ?? '')).toEqual({
                    status: 'error',
                    detail: 'fixture shell check ran',
                });
            } finally {
                rmSync(probeCwd, { recursive: true, force: true });
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails loud when a declared non-JS check was pruned from the staged copy', async () => {
        const root = makeScratch('0249-pruned-');
        try {
            const sourcePlugins = join(root, 'source-plugins');
            // `tests/` is EXCLUDE-pruned: the file exists in the source tree and never lands
            // in the staged copy, so source-side existence alone cannot prove it ships.
            const fixtureDir = writePluginFixture(sourcePlugins, 'publishings', 'pruned-check-pub', {
                check: './tests/probe.sh',
            });
            expect(existsSync(join(fixtureDir, 'tests', 'probe.sh'))).toBe(true);

            const message = await captureRejection(stageFixtureTree(root, sourcePlugins));
            expect(message).toContain('pruned-check-pub');
            expect(message).toContain(join('tests', 'probe.sh'));
            // Not vacuous: the declared path really was pruned, so a staged manifest would dangle.
            expect(existsSync(join(root, 'staged-plugins', 'publishings', 'pruned-check-pub', 'tests'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails loud when a declared non-JS entry was pruned from the staged copy', async () => {
        const root = makeScratch('0249-pruned-entry-');
        try {
            const pluginTarget = join(root, 'staged');
            const sourcePlugins = join(root, 'source-plugins');
            for (const tree of [pluginTarget, sourcePlugins]) {
                writePluginFixture(tree, 'generations', 'pruned-entry-gen', { entry: './tests/probe.sh' });
            }
            // Present in the source tree only: the staged tree keeps its manifest but no
            // `tests/` directory, so the declared entry dangles exactly as the copy leaves it.
            const sourceEntry = join(sourcePlugins, 'generations', 'pruned-entry-gen', 'tests', 'probe.sh');
            mkdirSync(dirname(sourceEntry), { recursive: true });
            writeFileSync(sourceEntry, FIXTURE_SHELL_CHECK);
            chmodSync(sourceEntry, 0o755);
            const message = await captureRejection(bundleStagedEntries(pluginTarget, sourcePlugins));
            expect(message).toContain('pruned-entry-gen');
            expect(message).toContain(join('tests', 'probe.sh'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('bundles a declared .mts check instead of shipping the raw module', async () => {
        const root = makeScratch('0249-mts-');
        try {
            const sourcePlugins = join(root, 'source-plugins');
            // Type-annotated body: only a real Bun bundle strips the annotation.
            writePluginFixture(
                sourcePlugins,
                'publishings',
                'mts-check-pub',
                { check: './src/profile-check.mts' },
                { checkBody: "export const check: string = 'kk-bundle-mts-fixture';\n" },
            );

            const { stagedPlugins } = await stageFixtureTree(root, sourcePlugins);
            const stagedDir = join(stagedPlugins, 'publishings', 'mts-check-pub');
            const staged = JSON.parse(readFileSync(join(stagedDir, 'plugin.json'), 'utf-8')) as {
                entry: string;
                check: string;
            };
            expect(staged.check).toBe('./dist/profile-check.js');
            const artifact = join(stagedDir, 'dist', 'profile-check.js');
            expect(existsSync(artifact)).toBe(true);
            expect(readFileSync(artifact, 'utf-8')).not.toContain(': string');

            // The staged artifact loads outside the checkout; a raw .mts shipped verbatim is
            // the `Cannot find module` failure this task closed.
            const probeCwd = makeScratch('0249-mts-probe-');
            try {
                const result = spawnSync('bun', [artifact], { cwd: probeCwd, encoding: 'utf-8' });
                const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
                expect(output).not.toContain('Cannot find module');
                expect(result.status, output).toBe(0);
            } finally {
                rmSync(probeCwd, { recursive: true, force: true });
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails loud with plugin and path context when the declared check source is missing', async () => {
        const root = makeScratch('0249-missing-check-');
        try {
            const pluginTarget = join(root, 'staged');
            const sourcePlugins = join(root, 'source-plugins');
            for (const tree of [pluginTarget, sourcePlugins]) {
                // Declared but never written: the check source cannot resolve.
                writePluginFixture(
                    tree,
                    'publishings',
                    'ghost-check-pub',
                    { check: './src/profile-check.ts' },
                    {
                        checkBody: null,
                    },
                );
            }
            const message = await captureRejection(bundleStagedEntries(pluginTarget, sourcePlugins));
            expect(message).toContain('ghost-check-pub');
            expect(message).toContain(join('src', 'profile-check.ts'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails loud with plugin and path context when the declared check does not build', async () => {
        const root = makeScratch('0249-broken-check-');
        try {
            const pluginTarget = join(root, 'staged');
            const sourcePlugins = join(root, 'source-plugins');
            for (const tree of [pluginTarget, sourcePlugins]) {
                writePluginFixture(
                    tree,
                    'publishings',
                    'broken-check-pub',
                    { check: './src/profile-check.ts' },
                    { checkBody: "import 'no-such-pkg-0249';\nexport const check = 'broken';\n" },
                );
            }
            const message = await captureRejection(bundleStagedEntries(pluginTarget, sourcePlugins));
            expect(message).toContain('broken-check-pub');
            expect(message).toContain(join('src', 'profile-check.ts'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('bundle-plugins declared-path classification (0249 review P3-2)', () => {
    it('bundles every module extension the runtime can load, including .mts/.cts', () => {
        for (const declared of [
            './src/index.ts',
            './src/check.tsx',
            './src/check.mts',
            './src/check.cts',
            './src/check.js',
            './src/check.jsx',
            './src/check.mjs',
            './src/check.cjs',
        ]) {
            expect(BUNDLEABLE.test(declared), declared).toBe(true);
        }
    });

    it('matches module extensions case-insensitively', () => {
        for (const declared of ['./src/check.MTS', './src/check.TS', './src/check.MJS', './src/check.CTS']) {
            expect(BUNDLEABLE.test(declared), declared).toBe(true);
        }
    });

    it('still classifies shell, python, and extensionless assets as copied assets', () => {
        for (const declared of ['./scripts/probe.sh', './scripts/probe.py', './bin/omni-voice-gen']) {
            expect(BUNDLEABLE.test(declared), declared).toBe(false);
        }
    });
});
