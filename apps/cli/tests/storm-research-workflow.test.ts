import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0059 (C4) / Task 0069 (F4) — STORM daily topic-research workflow.
 * Encodes the workflow ACs that are static invariants of the delivered config:
 * R1 state machine shape (prepare → ingest → generate → render → done|failed, no
 * publish/judge), R2 SSOT location under plugins/kk/workflows, R3 switchable fixture default,
 * and the anti-pattern guards the task froze (always success edges, quoted $schema).
 * Functional dry-run behavior is verified separately via `spur workflow validate`
 * and `--dry-run` (verify stage).
 */
describe('kk-storm-research workflow (0059/0069)', () => {
    const ssotPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-storm-research.yaml');
    const spurCopyPath = join(import.meta.dir, '../../../.spur/workflows/kk-storm-research.yaml');
    const helpPath = join(import.meta.dir, '../../../docs/help/storm-topic-research-workflow.md');

    const ssot = readFileSync(ssotPath, 'utf-8');
    const help = readFileSync(helpPath, 'utf-8');

    const stateIds = [...ssot.matchAll(/^\s+- id: (\w+)/gm)].map((m) => m[1]);

    it('R1 — repo SSOT lives under plugins/kk/workflows/ and .spur copy is absent', () => {
        expect(existsSync(ssotPath)).toBe(true);
        expect(existsSync(spurCopyPath)).toBe(false);
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

    it('R1 — render resolves render_script via fallback chain, then buns it', () => {
        // Template literal with escaped placeholders so the string contains literal ${vars.*}.
        // Whitespace-normalize: the YAML folds long commands across physical lines.
        const flat = ssot.replace(/\s+/g, ' ');
        expect(flat).toContain(`rs="\${vars.render_script}"`);
        expect(flat).toContain('command -v kk');
        expect(flat).toContain('$pkg/plugins/kk/scripts/render-md.ts');
        expect(flat).toContain(
            `bun "$rs" --in "\${vars.work_dir}/content.json" --out "\${vars.work_dir}/content.md"`,
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
