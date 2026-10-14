import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogFromRootPackage, preparePublishedManifest } from './publish-manifest';

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

    it('the CLI package rewrite is npm-installable (no catalog: or workspace: left)', () => {
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
        preparePublishedManifest(manifest, {
            catalog,
            // Must mirror `collectPrivateWorkspaceNames()` (scripts/publish.ts:24) — it globs
            // `{apps,packages}/*/package.json` for `private: true`, so every private workspace
            // package the CLI depends on belongs here. kk-store joined with task 0206;
            // kk-board joined with G8 task 0252 (a devDependency for the `./contracts` types);
            // publish-harness joined with task 0276 (the bot lifecycle).
            privateWorkspaceNames: new Set([
                '@gobing-ai/kk-core',
                '@gobing-ai/kk-store',
                '@gobing-ai/kk-board',
                '@gobing-ai/publish-harness',
            ]),
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
