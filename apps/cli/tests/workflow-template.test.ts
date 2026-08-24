import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R12 — workflow YAML extensions and the kk plugin registry stay separate
 * channels (ADR-012 R5): a workflow names product plugins via `kk executor run`
 * and injects extra discovery folders via `--plugins-path`; it never declares
 * product plugins as workflow extension modules.
 */
describe('B3 workflow template (kk-ingest-generate-publish.yaml)', () => {
    const templatePath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-ingest-generate-publish.yaml');
    const yaml = readFileSync(templatePath, 'utf-8');

    it('R12 — every step shells kk executor run with conditional --plugins-path', () => {
        const executorCalls = [...yaml.matchAll(/kk executor run/g)];
        expect(executorCalls.length).toBeGreaterThanOrEqual(3);
        // --plugins-path is conditional (empty plugins_path -> ADR-012 default discovery)
        const conditionals = [...yaml.matchAll(/--plugins-path "\$\{vars\.plugins_path\}"/g)];
        expect(conditionals.length).toBeGreaterThanOrEqual(3);
        expect(yaml).toContain('plugins_path: ""');
    });

    it('R12 — uses --plugins-path, never --plugins-root or extensions blocks', () => {
        expect(yaml).not.toContain('--plugins-root');
        expect(yaml).not.toContain('extensions.actions');
        expect(yaml).not.toContain('extensions.guards');
        // The template still names plugins by registry name, not as extension modules.
        for (const plugin of ['karakeep-local', 'content-gen', 'surfdash-pub']) {
            expect(yaml).toContain(plugin);
        }
    });
});
