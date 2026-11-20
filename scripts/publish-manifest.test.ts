import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    catalogFromRootPackage,
    collectPrivateWorkspaceNames,
    preparePublishedManifest,
    workspacePackagePatterns,
} from './publish-manifest';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

describe('preparePublishedManifest', () => {
    it('rewrites catalog: to the root catalog range so bun add can resolve ts-libs', () => {
        const manifest = {
            dependencies: {
                '@gobing-ai/ts-infra': 'catalog:',
                '@gobing-ai/ts-runtime': 'catalog:',
                '@gobing-ai/ts-utils': 'catalog:',
                commander: '15.0.0',
            },
        };
        const result = preparePublishedManifest(manifest, {
            catalog: {
                '@gobing-ai/ts-infra': '^0.4.39',
                '@gobing-ai/ts-runtime': '^0.4.39',
                '@gobing-ai/ts-utils': '^0.4.39',
            },
            privateWorkspaceNames: new Set(),
        });
        expect(result.rewrittenCatalog).toBe(3);
        expect(result.strippedWorkspace).toBe(0);
        expect(manifest.dependencies).toEqual({
            '@gobing-ai/ts-infra': '^0.4.39',
            '@gobing-ai/ts-runtime': '^0.4.39',
            '@gobing-ai/ts-utils': '^0.4.39',
            commander: '15.0.0',
        });
        expect(JSON.stringify(manifest)).not.toContain('catalog:');
    });

    it('strips workspace:* deps that point at private packages (bundled into dist)', () => {
        const manifest = {
            dependencies: {
                '@gobing-ai/kk-core': 'workspace:*',
                commander: '15.0.0',
            },
        };
        const result = preparePublishedManifest(manifest, {
            catalog: {},
            privateWorkspaceNames: new Set(['@gobing-ai/kk-core']),
        });
        expect(result.strippedWorkspace).toBe(1);
        expect(manifest.dependencies).toEqual({ commander: '15.0.0' });
        expect(JSON.stringify(manifest)).not.toContain('workspace:');
    });

    it('fails loud on workspace:* to a non-private package and on catalog: missing from the catalog', () => {
        expect(() =>
            preparePublishedManifest(
                { dependencies: { '@gobing-ai/public-pkg': 'workspace:*' } },
                { catalog: {}, privateWorkspaceNames: new Set() },
            ),
        ).toThrow(/non-private workspace dep/);
        expect(() =>
            preparePublishedManifest(
                { dependencies: { '@gobing-ai/ts-missing': 'catalog:' } },
                { catalog: {}, privateWorkspaceNames: new Set() },
            ),
        ).toThrow(/not in the root workspaces.catalog/);
    });

    it('collects private workspaces from the root globs, plugin kinds included (0.1.21 publish)', async () => {
        const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
        // The publish workflow died on `@gobing-ai/music-gen` because the scan hardcoded
        // apps/ and packages/, so a private plugin-kind workspace looked public.
        expect(workspacePackagePatterns(rootPkg)).toContain('plugins/generations/*');
        const names = await collectPrivateWorkspaceNames(repoRoot, rootPkg);
        expect(names.has('@gobing-ai/music-gen')).toBe(true);
        expect(names.has('@gobing-ai/kk-core')).toBe(true);
        // A package that is not private must stay out of the set, or it would be stripped.
        expect(names.has('commander')).toBe(false);
        expect(workspacePackagePatterns({})).toEqual(['apps/*', 'packages/*']);
    });

    it('the CLI package rewrite is npm-installable (no catalog: or workspace: left)', async () => {
        const cliPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/cli/package.json'), 'utf-8')) as Record<
            string,
            unknown
        >;
        const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as Record<string, unknown>;
        const catalog = catalogFromRootPackage(rootPkg);

        expect(catalog['@gobing-ai/ts-infra']).toBeTruthy();
        expect(catalog['@gobing-ai/ts-runtime']).toBeTruthy();
        expect(catalog['@gobing-ai/ts-utils']).toBeTruthy();

        const manifest = structuredClone(cliPkg);
        // The real collector, never a hand-kept copy of it: a mirrored list is what let
        // music-gen through the gate while the publish scan still skipped plugins/.
        preparePublishedManifest(manifest, {
            catalog,
            privateWorkspaceNames: await collectPrivateWorkspaceNames(repoRoot, rootPkg),
        });
        const deps = manifest.dependencies as Record<string, string>;
        for (const range of Object.values(deps)) {
            expect(range).not.toMatch(/^(catalog:|workspace:)/);
        }
        expect(deps['@gobing-ai/kk-core']).toBeUndefined();
        expect(deps['@gobing-ai/kk-store']).toBeUndefined();
        expect(deps['@gobing-ai/ts-infra']).toBe(catalog['@gobing-ai/ts-infra']);
        expect(deps['@gobing-ai/ts-runtime']).toBe(catalog['@gobing-ai/ts-runtime']);
        expect(deps['@gobing-ai/ts-utils']).toBe(catalog['@gobing-ai/ts-utils']);
        expect(deps.commander).toBe('15.0.0');
    });
});
