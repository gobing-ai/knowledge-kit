import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { discoverPlugins, parsePluginManifest } from '@gobing-ai/kk-core';

/**
 * AC1 (R1) — the plugin is discoverable and checkable.
 *
 * `kk plugins list` / `kk plugins status` read this manifest through kk-core's
 * registry, so the assertions here are the registry's own: the plugin is found
 * under the `generator` kind with `entry: ./src/index.ts`, its manifest parses
 * with no diagnostics, and its declared runtime requirements equal what the code
 * actually imports — the check R1 asks for, run in the repo's normal test target
 * because kk-core's manifest schema carries `runtime` as a loose (preserved)
 * key rather than a validated one.
 */

const PLUGIN_ROOT = join(import.meta.dir, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..', '..');

/** Declared module requirements, read from plugin.json. */
function declaredRequires(): string[] {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf8')) as {
        runtime?: { requires?: string[] };
    };
    return manifest.runtime?.requires ?? [];
}

/** Every `.ts` file in `src/`, recursively. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            out.push(...sourceFiles(path));
            continue;
        }
        if (name.endsWith('.ts')) {
            out.push(path);
        }
    }
    return out;
}

/** Bare specifiers (`node:*`, `bun:*`, packages) imported anywhere in `src/`. */
function importedSpecifiers(): string[] {
    const specifiers = new Set<string>();
    for (const file of sourceFiles(join(PLUGIN_ROOT, 'src'))) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
            const specifier = match[1];
            if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')) {
                continue;
            }
            specifiers.add(specifier);
        }
        for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
            const specifier = match[1];
            if (specifier === undefined || specifier.startsWith('.') || specifier.startsWith('/')) {
                continue;
            }
            specifiers.add(specifier);
        }
    }
    return [...specifiers].sort();
}

describe('AC1 — the plugin is discoverable and checkable', () => {
    test('discovery finds music-gen under the generator kind with entry ./src/index.ts', () => {
        const { plugins, diagnostics } = discoverPlugins(join(REPO_ROOT, 'plugins'));
        const record = plugins.find((plugin) => plugin.name === 'music-gen');
        expect(record).toBeDefined();
        expect(record?.kind).toBe('generator');
        expect(record?.entry).toBe('./src/index.ts');
        expect(record?.dir).toBe(PLUGIN_ROOT);
        expect(diagnostics.filter((diagnostic) => diagnostic.path.includes(PLUGIN_ROOT))).toEqual([]);
        expect(existsSync(join(PLUGIN_ROOT, record?.entry ?? ''))).toBe(true);
    });

    test('the manifest parses against the registry schema and declares name, kind, entry, version and description', () => {
        const parsed = parsePluginManifest(JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf8')));
        expect(parsed.name).toBe('music-gen');
        expect(parsed.kind).toBe('generator');
        expect(parsed.entry).toBe('./src/index.ts');
        expect(parsed.version).toBe('0.1.0');
        expect(parsed.description).toContain('Lyria 3');
        // A generator declares no readiness probe (that is ADR-032's browser/publish surface).
        expect(parsed.check).toBeUndefined();
    });

    test('the declared runtime requirements match what the code imports', () => {
        const declared = declaredRequires();
        const imported = importedSpecifiers();
        // `fetch` is not an import: it is declared because the adapter calls the platform fetch.
        const declaredModules = declared.filter((entry) => entry !== 'fetch').sort();
        expect(declaredModules).toEqual(imported);
        const usesFetch = sourceFiles(join(PLUGIN_ROOT, 'src')).some((file) =>
            /\bfetch\b/.test(readFileSync(file, 'utf8')),
        );
        expect(usesFetch).toBe(true);
        expect(declared).toContain('fetch');
        // Sorted and de-duplicated, so the annotation cannot drift into a hand-ordered list.
        expect(declared).toEqual([...declared].sort());
        expect(new Set(declared).size).toBe(declared.length);
    });

    test('package.json declares the same runtime packages as dependencies', () => {
        const pkg = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
        };
        const packages = importedSpecifiers().filter(
            (specifier) => !specifier.startsWith('node:') && !specifier.startsWith('bun:'),
        );
        expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(packages);
    });
});
