import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0059 (C4) — STORM daily topic-research workflow prototype.
 * Encodes the workflow ACs that are static invariants of the delivered config:
 * R1 state machine shape (prepare → ingest → generate → render → done|failed, no
 * publish/judge), R2 byte-identical install source, R3 switchable fixture default,
 * and the anti-pattern guards the task froze (always success edges, quoted $schema).
 * Functional dry-run behavior is verified separately via `spur workflow validate`
 * and `--dry-run` (verify stage).
 */
describe('kk-storm-research workflow (0059)', () => {
    const ssotPath = join(import.meta.dir, '../../../.spur/workflows/kk-storm-research.yaml');
    const installPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-storm-research.yaml');
    const helpPath = join(import.meta.dir, '../../../docs/help/storm-topic-research-workflow.md');

    const ssot = readFileSync(ssotPath, 'utf-8');
    const install = readFileSync(installPath, 'utf-8');
    const help = readFileSync(helpPath, 'utf-8');

    const stateIds = [...ssot.matchAll(/^\s+- id: (\w+)/gm)].map((m) => m[1]);

    it('R2 — install-source YAML is byte-identical to the repo SSOT', () => {
        expect(install).toBe(ssot);
    });

    it('generate — local-doc merge is array-safe jq (C4 dogfood P1-1 regression)', () => {
        // WHY: `.[0] + .[1]` adds a Doc object to a Doc[] array → jq type error, exit 5,
        // so every file-mode run failed at generate. `[.[0]] + .[1]` wraps the object first.
        expect(ssot).toContain("jq -s '[.[0]] + .[1]'");
        expect(ssot).not.toContain("jq -s '.[0] + .[1]'");
    });

    it('R1 — walks prepare → ingest → generate → render, with done/failed terminals', () => {
        expect(stateIds).toEqual(expect.arrayContaining(['prepare', 'ingest', 'generate', 'render', 'done', 'failed']));
    });

    it('R1 — machine has no publish or judge states (C4 scope)', () => {
        expect(stateIds).not.toContain('publish');
        expect(stateIds).not.toContain('judge');
    });

    it('R1 — success edges are guard: { kind: always } and $schema stays quoted', () => {
        expect(ssot).toContain('"$schema":');
        // The header comment mentions `action-ok`; only a `kind: action-ok` guard violates the contract.
        expect(ssot).not.toMatch(/kind:\s*action-ok/);
        const guards = ssot.match(/guard:\s*\n\s+kind: always/g) ?? [];
        expect(guards.length).toBeGreaterThanOrEqual(4);
    });

    it('R1 — render shells bun render_script --in content.json --out content.md', () => {
        // Template literal with escaped placeholders so the string contains literal ${vars.*}.
        // Whitespace-normalize: the YAML folds long commands across physical lines.
        const flat = ssot.replace(/\s+/g, ' ');
        expect(flat).toContain(
            `bun "\${vars.render_script}" --in "\${vars.work_dir}/content.json" --out "\${vars.work_dir}/content.md"`,
        );
    });

    it('R3 — fixture defaults to "false" and is never hardcoded true in the YAML', () => {
        expect(ssot).toContain('fixture: "false"');
        expect(ssot).not.toContain('fixture: true');
    });

    it('R1 — prepare guards the XOR input (both or neither set → fail)', () => {
        const prepareCommand = ssot.match(/command: >-\n\s+set -e;[\s\S]*?^$/m)?.[0] ?? '';
        expect(prepareCommand).toContain('XOR violation: both topic and input_file set');
        expect(prepareCommand).toContain('XOR violation: neither topic nor input_file set');
    });

    it('R4 — help doc documents the four-state machine, XOR input, and content.md sidecar', () => {
        const normalized = help.replace(/\s+/g, ' ');
        expect(normalized).toContain('STORM Topic-Research Workflow');
        expect(normalized).toContain('sentence XOR a markdown file');
        expect(normalized).toContain('content.md');
        expect(normalized).toContain('render');
    });
});
