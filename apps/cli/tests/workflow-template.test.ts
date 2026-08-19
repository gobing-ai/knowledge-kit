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

    it('R12 — every step shells kk executor run and injects roots via --plugins-path', () => {
        const commands = yaml
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('command: kk executor run'))
            .map((line) => line.slice('command:'.length).trim());
        expect(commands.length).toBeGreaterThanOrEqual(3);
        for (const command of commands) {
            expect(command.startsWith('kk executor run')).toBe(true);
            expect(command).toMatch(/--plugins-path \$\{vars\.plugins_path\}/);
        }
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
