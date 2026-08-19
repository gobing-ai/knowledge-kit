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
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-draft/draft-article.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.verdictFile}'].join('$'));
    });

    it('R3 — success edges avoid action-ok (dry-run walkable) and $schema is quoted', () => {
        expect(yaml).toContain('"$schema":');
        expect(yaml).not.toMatch(/kind:\s*action-ok/);
    });

    it('R5 — prepare guards XOR input and refuses overwrite without force=true', () => {
        expect(yaml).toContain('XOR violation: both topic and input_file set');
        expect(yaml).toContain('XOR violation: neither topic nor input_file set');
        expect(yaml).toContain(['initialization target already exists at ', '{vars.work_dir}/brief.md'].join('$'));
    });
});
