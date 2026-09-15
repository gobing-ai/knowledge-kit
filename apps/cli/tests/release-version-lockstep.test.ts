/**
 * Release lockstep — the guard for the 0.0.15 near-miss.
 *
 * `spur builder bump-ver` rewrites the package manifest and the superskill-facing carriers in
 * ONE commit, so those three files are always on the same version. The 0.0.15 mistake moved the
 * carriers without moving `apps/cli/package.json`, and tagged the aggregate
 * `knowledge-kit-v0.0.15` instead of the scoped per-package tag, so Publish never fired. Each
 * assertion below fails loudly on one half of that failure.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');
const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf-8')) as T;

describe('release version lockstep', () => {
    it('keeps apps/cli, plugins/kk, and the marketplace kk entry on one version', () => {
        const cli = readJson<{ version: string }>('apps/cli/package.json');
        expect(readJson<{ version: string }>('plugins/kk/plugin.json').version).toBe(cli.version);

        const entries = readJson<{ plugins: { name: string; version: string }[] }>(
            '.claude-plugin/marketplace.json',
        ).plugins;
        expect(entries.find((entry) => entry.name === 'kk')?.version).toBe(cli.version);
    });

    it('wires the release scripts to the scoped CLI package, whose tag the publish workflow consumes', () => {
        const scripts = readJson<{ scripts: Record<string, string> }>('package.json').scripts;
        const cliName = readJson<{ name: string }>('apps/cli/package.json').name;

        // The unscoped id (`@gobing-ai/knowledge-kit` -> `knowledge-kit`) is how spur names the
        // per-package target; a targetless bump emits the aggregate `<rootName>-v<version>` tag.
        expect(scripts['bump-ver']).toBe(`spur builder bump-ver ${cliName.split('/').pop()}`);
        expect(readFileSync(join(repoRoot, '.github/workflows/publish.yml'), 'utf-8')).toContain(`'${cliName}-v*'`);
    });
});
