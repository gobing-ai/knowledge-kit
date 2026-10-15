import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import {
    collectionForKind,
    discoverAllPlugins,
    discoverPlugins,
    getByName,
    KK_CAPABILITY_COLLECTION,
    listByKind,
    type PluginKind,
    resolvePluginRoots,
} from '../src/index';
import { findBuiltinRoot } from '../src/registry';

function withTempDir(fn: (dir: string) => void): void {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-registry-test-'));
    try {
        fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function writePlugin(
    root: string,
    kind: PluginKind,
    name: string,
    extra: { dirName?: string; entry?: string; omitKind?: boolean } = {},
): string {
    const dir = join(root, collectionForKind(kind), extra.dirName ?? name);
    mkdirSync(dir, { recursive: true });
    const body = extra.omitKind
        ? { name, entry: extra.entry ?? 'sp:entry' }
        : { name, kind, entry: extra.entry ?? 'sp:entry' };
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify(body));
    return dir;
}

describe('discoverPlugins', () => {
    it('discovers valid plugins grouped by kind and supports listByKind & getByName', () => {
        withTempDir((root) => {
            const p1 = writePlugin(root, 'ingestion', 'ingest-a');
            const p2 = writePlugin(root, 'generator', 'gen-b');

            const res = discoverPlugins(root);
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins).toHaveLength(2);

            const ingestions = listByKind(res, 'ingestion');
            expect(ingestions).toHaveLength(1);
            expect(ingestions[0]?.name).toBe('ingest-a');

            const generators = listByKind(res, 'generator');
            expect(generators).toHaveLength(1);
            expect(generators[0]?.name).toBe('gen-b');

            const pub = listByKind(res, 'publish');
            expect(pub).toHaveLength(0);

            const found = getByName(res, 'gen-b');
            expect(found?.dir).toBe(p2);
            expect(p1).toContain(collectionForKind('ingestion'));
        });
    });

    it('scans a kind-collection directory as the plugins root', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'only-pub');
            const collectionRoot = join(root, collectionForKind('publish'));
            const res = discoverPlugins(collectionRoot);
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('only-pub');
            expect(res.plugins[0]?.kind).toBe('publish');
        });
    });

    it('skips the kk capability collection even when it has a plugin.json', () => {
        withTempDir((root) => {
            writePlugin(root, 'ingestion', 'keep');
            const kkDir = join(root, KK_CAPABILITY_COLLECTION);
            mkdirSync(kkDir, { recursive: true });
            writeFileSync(
                join(kkDir, 'plugin.json'),
                JSON.stringify({ name: 'kk', version: '1.0.0', description: 'capability plugin' }),
            );

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['keep']);
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('emits misplaced when a plugin.json sits at the plugins root', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'ok-pub');
            const stray = join(root, 'stray-plugin');
            mkdirSync(stray, { recursive: true });
            const strayManifest = join(stray, 'plugin.json');
            writeFileSync(strayManifest, JSON.stringify({ name: 'stray', kind: 'publish', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['ok-pub']);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('misplaced');
            expect(res.diagnostics[0]?.path).toBe(strayManifest);
        });
    });

    it('emits kind_mismatch when manifest kind does not match the collection', () => {
        withTempDir((root) => {
            const dir = join(root, collectionForKind('ingestion'), 'wrong-kind');
            mkdirSync(dir, { recursive: true });
            const manifestPath = join(dir, 'plugin.json');
            writeFileSync(manifestPath, JSON.stringify({ name: 'wrong', kind: 'publish', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(0);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('kind_mismatch');
            expect(res.diagnostics[0]?.path).toBe(manifestPath);
        });
    });

    it('treats a prototype-key directory (constructor) as misplaced, not a kind collection (0155 R1)', () => {
        withTempDir((root) => {
            // A valid ingestion manifest under `constructor/` — with the pre-0155 `in`-based
            // kind lookup this directory was mistaken for a kind collection and produced a
            // spurious `kind_mismatch` instead of the normal `misplaced` diagnostic.
            const stray = join(root, 'constructor');
            mkdirSync(stray, { recursive: true });
            const strayManifest = join(stray, 'plugin.json');
            writeFileSync(strayManifest, JSON.stringify({ name: 'stray', kind: 'ingestion', entry: 'e' }));

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(0);
            expect(res.diagnostics.some((d) => d.code === 'kind_mismatch')).toBe(false);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('misplaced');
            expect(res.diagnostics[0]?.path.endsWith(join('constructor', 'plugin.json'))).toBe(true);
        });
    });

    it('emits malformed for invalid JSON without aborting the scan', () => {
        withTempDir((root) => {
            const dir = join(root, collectionForKind('publish'), 'broken-json');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'plugin.json'), '{ not json');
            writePlugin(root, 'publish', 'ok-after-broken');

            const res = discoverPlugins(root);
            expect(res.plugins.map((p) => p.name)).toEqual(['ok-after-broken']);
            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('malformed');
            expect(res.diagnostics[0]?.reason).toContain('Invalid JSON');
        });
    });

    it('skips malformed plugin.json without aborting scan (R3)', () => {
        withTempDir((root) => {
            writePlugin(root, 'publish', 'bad', { omitKind: true, dirName: 'bad-plugin' });
            writePlugin(root, 'publish', 'good', { dirName: 'good-plugin' });

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('good');

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('malformed');
            expect(res.diagnostics[0]?.path).toBe(join(root, 'publishings', 'bad-plugin', 'plugin.json'));
            expect(res.diagnostics[0]?.reason).toContain('kind');
        });
    });

    it('emits duplicate_name diagnostic for duplicate plugin names, first-wins (R4)', () => {
        withTempDir((root) => {
            const p1 = writePlugin(root, 'ingestion', 'same-name', { dirName: 'plugin-1' });
            writePlugin(root, 'ingestion', 'same-name', { dirName: 'plugin-2' });

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.dir).toBe(p1);

            expect(res.diagnostics).toHaveLength(1);
            expect(res.diagnostics[0]?.code).toBe('duplicate_name');
            expect(res.diagnostics[0]?.path).toBe(
                join(root, collectionForKind('ingestion'), 'plugin-2', 'plugin.json'),
            );
        });
    });

    it('silently skips child directories without plugin.json', () => {
        withTempDir((root) => {
            mkdirSync(join(root, 'publishings', 'regular-dir'), { recursive: true });
            writePlugin(root, 'publish', 'ok-plugin');

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.name).toBe('ok-plugin');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('emits unreadable diagnostic when root directory does not exist', () => {
        const res = discoverPlugins('/path/does/not/exist/for/kk/test');
        expect(res.plugins).toHaveLength(0);
        expect(res.diagnostics).toHaveLength(1);
        expect(res.diagnostics[0]?.code).toBe('unreadable');
    });

    it('discovers the shipped kind-collection tree and skips plugins/kk', () => {
        const res = discoverPlugins(join(import.meta.dir, '../../../plugins'));
        expect(res.diagnostics).toHaveLength(0);
        expect(res.plugins.map((p) => p.name).sort()).toEqual([
            'aihot-ingest',
            'content-gen',
            'core-facts-gen',
            'daily-article-gen',
            'dailynews-gen',
            'emdash-pub',
            'episode-plan-gen',
            'gemini-tts',
            'horizon-ingest',
            'image-gen',
            'infoq-pub',
            'jike-pub',
            'juejin-pub',
            'karakeep-local',
            'last30days-ingest',
            'medium-pub',
            'news-report-gen',
            'omni-voice-gen',
            'podcast-pub',
            'qiita-pub',
            'substack-pub',
            'surfdash-pub',
            'threads-pub',
            'voice-gen',
            'voxcpm-tts',
            'web-search',
            'wechatmp-pub',
            'weibo-pub',
            'x-pub',
            'xhs-pub',
            'zenn-pub',
        ]);
        expect(getByName(res, 'karakeep-local')?.kind).toBe('ingestion');
        expect(getByName(res, 'content-gen')?.kind).toBe('generator');
        expect(getByName(res, 'surfdash-pub')?.dir).toContain(`${collectionForKind('publish')}/surfdash-pub`);
    });
});

describe('discoverAllPlugins / resolvePluginRoots (ADR-012, feature B7)', () => {
    it('R1 — default discovery registers the package-shipped tree and skips plugins/kk', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'ingest-a');
            writePlugin(builtin, 'generator', 'gen-b');
            // plugins/kk must never register as a kk-core plugin (ADR-009).
            const kkDir = join(builtin, KK_CAPABILITY_COLLECTION);
            mkdirSync(kkDir, { recursive: true });
            writeFileSync(join(kkDir, 'plugin.json'), JSON.stringify({ name: 'kk', version: '1.0.0' }));

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
            });
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins.map((p) => p.name).sort()).toEqual(['gen-b', 'ingest-a']);
            expect(res.plugins.every((p) => p.origin === 'builtin')).toBe(true);
        });
    });

    it('R2 — a user plugin under ~/.config/kk/plugins merges with built-ins', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'publish', 'builtin-pub');
            const home = join(tmp, 'home');
            writePlugin(join(home, '.config', 'kk', 'plugins'), 'publish', 'my-pub');

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd: join(tmp, 'cwd'),
                env: {},
            });
            expect(getByName(res, 'builtin-pub')?.origin).toBe('builtin');
            const user = getByName(res, 'my-pub');
            expect(user?.origin).toBe('user');
            expect(user?.kind).toBe('publish');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('R4 — --plugins-root scans only that tree; built-ins are not registered', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'builtin-only');
            const isolated = join(tmp, 'isolated');
            writePlugin(isolated, 'publish', 'isolated-pub');

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
                pluginsRoot: isolated,
            });
            expect(res.plugins.map((p) => p.name)).toEqual(['isolated-pub']);
            expect(res.plugins[0]?.origin).toBe('path');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('R5 — a higher-priority root shadows a duplicate name with a naming diagnostic', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            const builtinDir = writePlugin(builtin, 'ingestion', 'same-name');
            const home = join(tmp, 'home');
            const userDir = writePlugin(join(home, '.config', 'kk', 'plugins'), 'ingestion', 'same-name');

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd: join(tmp, 'cwd'),
                env: {},
            });
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.origin).toBe('user');
            expect(res.plugins[0]?.dir).toBe(userDir);

            const shadow = res.diagnostics.find((d) => d.code === 'shadowed');
            expect(shadow?.path).toBe(join(builtinDir, 'plugin.json'));
            expect(shadow?.reason).toContain(join(userDir, 'plugin.json'));
        });
    });

    it('R6 — each plugin record reports its origin (builtin | project | user | path)', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'a-builtin');
            const home = join(tmp, 'home');
            writePlugin(join(home, '.config', 'kk', 'plugins'), 'ingestion', 'b-user');
            const cwd = join(tmp, 'cwd');
            writePlugin(join(cwd, 'plugins'), 'ingestion', 'c-project');
            const envRoot = join(tmp, 'env-root');
            writePlugin(envRoot, 'ingestion', 'd-path');

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd,
                env: { KK_PLUGIN_PATH: envRoot },
            });
            expect(getByName(res, 'a-builtin')?.origin).toBe('builtin');
            expect(getByName(res, 'b-user')?.origin).toBe('user');
            expect(getByName(res, 'c-project')?.origin).toBe('project');
            expect(getByName(res, 'd-path')?.origin).toBe('path');
        });
    });

    it('R7 — a KK_PLUGIN_PATH root registers its plugins with origin path', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'generator', 'builtin-gen');
            const pathRoot = join(tmp, 'extra');
            writePlugin(pathRoot, 'generator', 'path-ing');

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: { KK_PLUGIN_PATH: pathRoot },
            });
            expect(getByName(res, 'path-ing')?.origin).toBe('path');
            expect(getByName(res, 'builtin-gen')?.origin).toBe('builtin');
        });
    });

    it('R8 — a misplaced plugin.json on an extra tree root is reported without aborting the merge', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'ok-builtin');
            const extra = join(tmp, 'extra');
            writePlugin(extra, 'generator', 'ok-extra');
            // A plugin dir directly at the extra root (not under a kind collection) -> misplaced.
            const strayDir = join(extra, 'stray');
            mkdirSync(strayDir, { recursive: true });
            const strayManifest = join(strayDir, 'plugin.json');
            writeFileSync(strayManifest, JSON.stringify({ name: 'stray', kind: 'publish', entry: 'e' }));

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
                extraPaths: [extra],
            });
            expect(getByName(res, 'ok-builtin')?.origin).toBe('builtin');
            expect(getByName(res, 'ok-extra')?.origin).toBe('path');
            const misplaced = res.diagnostics.find((d) => d.code === 'misplaced');
            expect(misplaced?.path).toBe(strayManifest);
        });
    });

    it('R9 — a project plugins tree that is the builtin realpath is scanned once', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'shared-a');
            const cwd = join(tmp, 'cwd');
            mkdirSync(cwd, { recursive: true });
            symlinkSync(builtin, join(cwd, 'plugins'), 'dir');

            const res = discoverAllPlugins({ packagePluginsRoot: builtin, homeDir: join(tmp, 'home'), cwd, env: {} });
            expect(res.plugins).toHaveLength(1);
            expect(res.plugins[0]?.origin).toBe('builtin');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('R10 — a single-plugin --plugins-path directory unions with built-in and user roots', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'generator', 'builtin-gen');
            const home = join(tmp, 'home');
            writePlugin(join(home, '.config', 'kk', 'plugins'), 'publish', 'global-pub');
            // Single plugin dir: plugin.json lives in the folder itself (ADR-012 R6).
            const single = join(tmp, 'single');
            mkdirSync(single, { recursive: true });
            writeFileSync(
                join(single, 'plugin.json'),
                JSON.stringify({ name: 'extra-gen', kind: 'generator', entry: 'sp:entry' }),
            );

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd: join(tmp, 'cwd'),
                env: {},
                extraPaths: [single],
            });
            expect(getByName(res, 'builtin-gen')?.origin).toBe('builtin');
            expect(getByName(res, 'global-pub')?.origin).toBe('user');
            const extra = getByName(res, 'extra-gen');
            expect(extra?.origin).toBe('path');
            expect(extra?.kind).toBe('generator');
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('emits unreadable when a single-plugin-dir manifest cannot be read (skip-and-report)', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'ok-builtin');
            // `plugin.json` is a directory here: it exists (so the single-plugin
            // classification fires) but cannot be read (EISDIR) — the manifest
            // must surface an `unreadable` diagnostic, not vanish silently.
            const single = join(tmp, 'single');
            mkdirSync(join(single, 'plugin.json'), { recursive: true });

            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
                extraPaths: [single],
            });
            expect(getByName(res, 'ok-builtin')).toBeDefined();
            const diag = res.diagnostics.find((d) => d.code === 'unreadable');
            expect(diag?.path).toBe(join(single, 'plugin.json'));
        });
    });

    it('R11 — --plugins-root is exclusive even when extra paths are offered', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'builtin-only');
            const isolated = join(tmp, 'isolated');
            writePlugin(isolated, 'publish', 'isolated-pub');
            const extra = join(tmp, 'extra');
            writePlugin(extra, 'generator', 'extra-gen');

            const opts = {
                packagePluginsRoot: builtin,
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
                extraPaths: [extra],
                pluginsRoot: isolated,
            };
            expect(resolvePluginRoots(opts)).toEqual([{ origin: 'path', root: isolated }]);
            const res = discoverAllPlugins(opts);
            expect(res.plugins.map((p) => p.name)).toEqual(['isolated-pub']);
            expect(res.diagnostics).toHaveLength(0);
        });
    });

    it('splits KK_PLUGIN_PATH on path.delimiter and resolves relative entries against cwd (0155 R6)', () => {
        withTempDir((tmp) => {
            mkdirSync(join(tmp, 'relA'), { recursive: true });
            mkdirSync(join(tmp, 'relB'), { recursive: true });
            mkdirSync(join(tmp, 'relC'), { recursive: true });

            const roots = resolvePluginRoots({
                homeDir: join(tmp, 'home'),
                packagePluginsRoot: join(tmp, 'builtin-empty'),
                cwd: tmp,
                env: { KK_PLUGIN_PATH: ['relA', 'relB'].join(delimiter) },
                extraPaths: ['relC'],
            });
            const pathRoots = roots.filter((r) => r.origin === 'path').map((r) => r.root);
            expect(pathRoots).toEqual([join(tmp, 'relA'), join(tmp, 'relB'), join(tmp, 'relC')]);
            expect(pathRoots.every((p) => isAbsolute(p))).toBe(true);
        });
    });

    it('findBuiltinRoot requires a sibling package.json next to the plugins tree (0155 R5)', () => {
        withTempDir((tmp) => {
            // (a) plugins tree with no package.json beside it -> not a builtin root.
            const start = join(tmp, 'a', 'b', 'c');
            mkdirSync(join(tmp, 'plugins', 'ingestions', 'some-ingest'), { recursive: true });
            mkdirSync(start, { recursive: true });
            expect(findBuiltinRoot(start)).toBeUndefined();

            // (b) same tree plus the repo-root package.json -> resolves.
            writeFileSync(join(tmp, 'package.json'), JSON.stringify({ name: 'repo', private: true }));
            expect(findBuiltinRoot(start)).toBe(join(tmp, 'plugins'));

            // (c) installed-package layout: <pkg>/dist start, manifest + plugins at <pkg>.
            const pkg = join(tmp, 'pkg');
            mkdirSync(join(pkg, 'dist'), { recursive: true });
            mkdirSync(join(pkg, 'plugins', 'publishings', 'some-pub'), { recursive: true });
            writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pkg' }));
            expect(findBuiltinRoot(join(pkg, 'dist'))).toBe(join(pkg, 'plugins'));
        });
    });

    it('resolves default roots low → high (builtin, user, project, env path, extra path)', () => {
        withTempDir((tmp) => {
            const builtin = join(tmp, 'builtin');
            writePlugin(builtin, 'ingestion', 'x');
            const home = join(tmp, 'home');
            writePlugin(join(home, '.config', 'kk', 'plugins'), 'ingestion', 'y');
            const cwd = join(tmp, 'cwd');
            writePlugin(join(cwd, 'plugins'), 'ingestion', 'z');
            const envRoot = join(tmp, 'env-root');
            writePlugin(envRoot, 'ingestion', 'e');
            const extraRoot = join(tmp, 'extra-root');
            writePlugin(extraRoot, 'ingestion', 'f');

            const roots = resolvePluginRoots({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd,
                env: { KK_PLUGIN_PATH: envRoot },
                extraPaths: [extraRoot],
            });
            expect(roots.map((r) => r.origin)).toEqual(['builtin', 'user', 'project', 'path', 'path']);

            // The same merged scan resolves every origin.
            const res = discoverAllPlugins({
                packagePluginsRoot: builtin,
                homeDir: home,
                cwd,
                env: { KK_PLUGIN_PATH: envRoot },
                extraPaths: [extraRoot],
            });
            expect(res.plugins.map((p) => p.origin)).toEqual(['builtin', 'user', 'project', 'path', 'path']);
        });
    });

    it('D2 — resolves the package-shipped builtin root by walking up when not injected', () => {
        withTempDir((tmp) => {
            // No packagePluginsRoot: resolveBuiltinRoot walks up from the module
            // to the packaged `<pkg>/plugins` tree (here: the repo-root plugins/
            // tree). No user/project/env roots exist, so builtin is the only root.
            const res = discoverAllPlugins({
                homeDir: join(tmp, 'home'),
                cwd: join(tmp, 'cwd'),
                env: {},
            });
            expect(res.diagnostics).toHaveLength(0);
            expect(res.plugins.map((p) => p.name).sort()).toEqual([
                'aihot-ingest',
                'content-gen',
                'core-facts-gen',
                'daily-article-gen',
                'dailynews-gen',
                'emdash-pub',
                'episode-plan-gen',
                'gemini-tts',
                'horizon-ingest',
                'image-gen',
                'infoq-pub',
                'jike-pub',
                'juejin-pub',
                'karakeep-local',
                'last30days-ingest',
                'medium-pub',
                'news-report-gen',
                'omni-voice-gen',
                'podcast-pub',
                'qiita-pub',
                'substack-pub',
                'surfdash-pub',
                'threads-pub',
                'voice-gen',
                'voxcpm-tts',
                'web-search',
                'wechatmp-pub',
                'weibo-pub',
                'x-pub',
                'xhs-pub',
                'zenn-pub',
            ]);
            expect(res.plugins.every((p) => p.origin === 'builtin')).toBe(true);
        });
    });

    it('emits unreadable when a kind collection cannot be read, without aborting the scan', () => {
        withTempDir((root) => {
            writePlugin(root, 'ingestion', 'ok-ingest');
            const locked = join(root, collectionForKind('publish'));
            mkdirSync(locked, { recursive: true });
            chmodSync(locked, 0o000);
            try {
                const res = discoverPlugins(root);
                expect(res.plugins.map((p) => p.name)).toEqual(['ok-ingest']);
                expect(res.diagnostics).toHaveLength(1);
                expect(res.diagnostics[0]?.code).toBe('unreadable');
                expect(res.diagnostics[0]?.path).toBe(locked);
            } finally {
                // Restore permissions so the temp-dir cleanup can recurse.
                chmodSync(locked, 0o755);
            }
        });
    });
});

describe('browserSession records (0277 R1)', () => {
    it('propagates a valid browserSession onto the resolved PluginRecord', () => {
        withTempDir((root) => {
            const dir = writePlugin(root, 'publish', 'juejin-pub', { entry: './src/index.ts' });
            writeFileSync(
                join(dir, 'plugin.json'),
                JSON.stringify({
                    name: 'juejin-pub',
                    kind: 'publish',
                    entry: './src/index.ts',
                    check: './src/profile-check.ts',
                    browserSession: { profileName: 'juejin', homeUrl: 'https://juejin.cn/editor/drafts/new?v=2' },
                }),
            );

            const res = discoverPlugins(root);
            expect(res.diagnostics).toHaveLength(0);
            const record = getByName(res, 'juejin-pub');
            expect(record?.browserSession).toEqual({
                profileName: 'juejin',
                homeUrl: 'https://juejin.cn/editor/drafts/new?v=2',
            });
        });
    });

    it('reports an invalid descriptor as malformed and drops the plugin', () => {
        withTempDir((root) => {
            const dir = writePlugin(root, 'publish', 'bad-session', { entry: './src/index.ts' });
            writeFileSync(
                join(dir, 'plugin.json'),
                JSON.stringify({
                    name: 'bad-session',
                    kind: 'publish',
                    entry: './src/index.ts',
                    check: './src/profile-check.ts',
                    browserSession: { profileName: 'not safe' },
                }),
            );

            const res = discoverPlugins(root);
            expect(res.plugins).toHaveLength(0);
            expect(res.diagnostics.map((d) => d.code)).toEqual(['malformed']);
        });
    });

    it('preserves the discovery shadowing contract for descriptor plugins', () => {
        withTempDir((root) => {
            for (const rootPath of [join(root, 'a'), join(root, 'b')]) {
                const dir = writePlugin(rootPath, 'publish', 'weibo-pub', { entry: './src/index.ts' });
                writeFileSync(
                    join(dir, 'plugin.json'),
                    JSON.stringify({
                        name: 'weibo-pub',
                        kind: 'publish',
                        entry: './src/index.ts',
                        check: './src/profile-check.ts',
                        browserSession: { profileName: 'weibo', homeUrl: 'https://weibo.com' },
                    }),
                );
            }

            const merged = discoverAllPlugins({
                packagePluginsRoot: join(root, 'a'),
                homeDir: join(root, 'home'),
                cwd: join(root, 'cwd'),
                env: { KK_PLUGIN_PATH: join(root, 'b') },
            });
            expect(merged.plugins).toHaveLength(1);
            expect(merged.plugins[0]?.browserSession).toEqual({ profileName: 'weibo', homeUrl: 'https://weibo.com' });
            expect(merged.diagnostics.some((d) => d.code === 'shadowed')).toBe(true);
        });
    });
});
