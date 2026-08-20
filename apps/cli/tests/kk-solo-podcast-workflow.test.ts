import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 0071 (F5) — kk-solo-podcast workflow static invariants.
 * Encodes the state-machine ACs that are static invariants of the delivered config:
 * R1/R3 state machine shape (prepare, understand, outline-write, outline-select, outline-commit,
 * script-write, script-validate, script-review, script-revise, wrap-docs, generate, duration-check,
 * done, failed), Spur HITL actions (select, confirm, input), agent.run with input+role (no skill/prompt),
 * expectFile usage, no action-ok success guards, and no /workflow-run profile additions.
 */
describe('kk-solo-podcast workflow (0071)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-solo-podcast.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R1 — walks the frozen state machine states with done/failed terminals', () => {
        expect(stateIds).toEqual(
            expect.arrayContaining([
                'prepare',
                'understand',
                'outline-write',
                'outline-select',
                'outline-commit',
                'script-write',
                'script-validate',
                'script-review',
                'script-revise',
                'wrap-docs',
                'generate',
                'duration-check',
                'done',
                'failed',
            ]),
        );
        expect(yaml).toContain('name: kk-solo-podcast');
        expect(yaml).toContain('kind: state-machine');
        expect(yaml).toContain('"$schema":');
        expect(existsSync(join(import.meta.dir, '../../../.spur/workflows/solo-podcast.yaml'))).toBe(false);
    });

    it('R3/R5 — uses Spur HITL actions (select with a/b/c options, confirm, and input)', () => {
        expect(yaml).toContain('kind: hitl.select');
        expect(yaml).toContain('kind: hitl.confirm');
        expect(yaml).toContain('kind: hitl.input');
        expect(yaml).toContain('pause: true');
        expect(yaml).toContain('- a');
        expect(yaml).toContain('- b');
        expect(yaml).toContain('- c');
    });

    it('R3/R8 — agent.run steps use input and role (no fictional skill: or prompt: options)', () => {
        const agentRunBlocks = [...yaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g)].map(
            (m) => m[1],
        );
        expect(agentRunBlocks.length).toBeGreaterThanOrEqual(3);
        for (const block of agentRunBlocks) {
            expect(block).not.toMatch(/^\s+skill:/m);
            expect(block).not.toMatch(/^\s+prompt:/m);
            expect(block).toContain('role:');
            expect(block).toContain('input:');
        }
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/1-briefing/briefing.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/2-outline/outline-option-a.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-script/voicescript.yaml'].join('$'));
    });

    it('R1/R3 — success edges avoid action-ok (dry-run walkable) and $schema is quoted', () => {
        expect(yaml).toContain('"$schema":');
        expect(yaml).not.toMatch(/kind:\s*action-ok/);
    });

    it('R2/R9/R10 — prepare guards XOR input and refuses overwrite without force=true', () => {
        expect(yaml).toContain('XOR violation: both topic and input_file set');
        expect(yaml).toContain('XOR violation: neither topic nor input_file set');
        expect(yaml).toContain(['initialization target already exists at ', '{vars.work_dir}/brief.md'].join('$'));
        expect(yaml).toContain('missing voice_profile (set vars.voice_profile or VOICEBOX_DEFAULT_PROFILE)');
    });

    it('R6/R7 — generate invokes voice-gen without duration flag and duration-check validates output', () => {
        expect(yaml).toContain('kk executor run voice-gen --in');
        expect(yaml).not.toContain('--duration');
        expect(yaml).not.toContain('--target-duration');
        expect(yaml).toContain('duration-check failed: metadata.duration missing or not a number');
        expect(yaml).toContain('duration-check failed: duration');
        expect(yaml).toContain(['test ! -f "', '{vars.work_dir}/4-audio/content.json"'].join('$'));
    });

    it('R5 — script_approved skips script-review the same way outline skips outline-select', () => {
        expect(yaml).toContain('script_approved: ""');
        expect(yaml).toContain(['test "', '{vars.script_approved}" = "true"'].join('$'));
        expect(yaml).toContain(['test -n "', '{vars.outline}"'].join('$'));
    });

    it('R8 — /workflow-run profile list and skills directory remain unchanged', () => {
        const workflowRunDoc = readFileSync(
            join(import.meta.dir, '../../../plugins/kk/commands/workflow-run.md'),
            'utf-8',
        );
        expect(workflowRunDoc).toContain('kk-storm-research');
        expect(workflowRunDoc).toContain('kk-itc');
        expect(workflowRunDoc).not.toContain('kk-solo-podcast');
        expect(existsSync(join(import.meta.dir, '../../../plugins/kk/skills/solo-podcast'))).toBe(false);
    });
});
