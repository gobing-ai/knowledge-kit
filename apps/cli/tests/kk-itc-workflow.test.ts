import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0069 (F4) — kk-itc workflow static invariants.
 * Encodes the state-machine ACs that are static invariants of the delivered config:
 * R3 state machine shape (prepare, research, outline-write, outline-select, outline-commit,
 * draft-write, draft-review, draft-revise, judge, done, failed), Spur HITL actions (select,
 * confirm, input), agent.run with input+role (no skill/prompt), expectFile usage,
 * and no action-ok success guards (dry-run walkability).
 */
describe('kk-itc workflow (0069)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R3 — walks the frozen state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual(
            expect.arrayContaining([
                'prepare',
                'research',
                'outline-write',
                'outline-select',
                'outline-commit',
                'draft-write',
                'draft-review',
                'draft-revise',
                'judge',
                'done',
                'failed',
            ]),
        );
    });

    it('R3 — uses Spur HITL actions (select with a/b/c options, confirm, and input)', () => {
        expect(yaml).toContain('kind: hitl.select');
        expect(yaml).toContain('kind: hitl.confirm');
        expect(yaml).toContain('kind: hitl.input');
        expect(yaml).toContain('pause: true');
        expect(yaml).toContain('- a');
        expect(yaml).toContain('- b');
        expect(yaml).toContain('- c');
    });

    it('R3 — agent.run steps use input and role (no fictional skill: or prompt: options)', () => {
        const agentRunBlocks = [...yaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g)].map(
            (m) => m[1],
        );
        expect(agentRunBlocks.length).toBeGreaterThanOrEqual(4);
        for (const block of agentRunBlocks) {
            expect(block).not.toMatch(/^\s+skill:/m);
            expect(block).not.toMatch(/^\s+prompt:/m);
            expect(block).toContain('role:');
            expect(block).toContain('input:');
        }
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/2-outline/outline-option-a.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/.itc-verdict.json'].join('$'));
    });

    it('R3 — success edges avoid action-ok (dry-run walkable) and $schema is quoted', () => {
        expect(yaml).toContain('"$schema":');
        expect(yaml).not.toMatch(/kind:\s*action-ok/);
    });

    it('R3 (0132) — the delegated action carries the shared resolution prelude once', () => {
        for (const line of [
            'kbin="$(command -v kk 2>/dev/null)";',
            'while [ -L "$kbin" ]; do link="$(readlink "$kbin")"; case "$link" in /*) kbin="$link";; *) kbin="$(dirname "$kbin")/$link";; esac; done;',
            'pkg="$(dirname "$(dirname "$kbin")")";',
            'st="$pkg/plugins/kk/scripts/kk-workflow-stages.ts";',
            '[ -f "$st" ] || echo "kk-workflow-stages.ts not found at $st — install or refresh the kk package (bun link in a checkout)" >&2;',
        ]) {
            expect(yaml.split(line).length - 1).toBe(1);
        }
    });

    it('R5/0132 — prepare delegates to the stage runner, which guards XOR + overwrite', () => {
        expect(yaml).toContain('bun "$st" prepare-itc');
        const runner = readFileSync(
            join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts'),
            'utf-8',
        );
        expect(runner).toContain('XOR violation: both topic and input_file set');
        expect(runner).toContain('XOR violation: neither topic nor input_file set');
        expect(runner).toContain(`initialization target already exists at \${workDirArg}/brief.md`);
        // itc stages only the outline dir (no audio stage) and zeroes the counter before the XOR checks.
        expect(runner).toContain("dirs: ['2-outline']");
        expect(runner).toContain('requireVoiceProfile: false');
        expect(runner).toContain('reviseCountEarly: true');
    });

    // --- 0128: single-file stage flattening -------------------------------------

    it('R1 (0128) — the single-file 3-draft stage is flattened and its stage dir is not created', () => {
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.md'].join('$'));
        expect(yaml).not.toContain('/3-draft"'); // the 3-draft mkdir segment is gone
        expect(yaml).not.toContain(['', '{vars.work_dir}/3-draft/'].join('$')); // no stage-dir refs remain
        // the multi-file stage keeps its dir (staged by the runner, still addressed by the artifacts)
        expect(yaml).toContain(['', '{vars.work_dir}/2-outline/outline-approved.md'].join('$'));
    });
});
