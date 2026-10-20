import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0071 (F5) — kk-solo-podcast workflow static invariants.
 * Task 0078 (F7) — agent.run steps now invoke kk:audio-authoring; revise counter moved to
 * ${vars.work_dir}/.revise-count; wrap-docs shells wrap-voicescript-doc.ts sidecar;
 * duration-check gates via .duration-ok with a script-write retry edge.
 * Encodes the state-machine ACs that are static invariants of the delivered config:
 * R1/R3 state machine shape (prepare, understand, outline-write, outline-select, outline-commit,
 * script-write, script-validate, script-review, script-revise, wrap-docs, generate, duration-check,
 * done, failed), Spur HITL actions (select, confirm, input), agent.run with input+role (no skill/prompt),
 * expectFile usage, no action-ok success guards, runtime dest $HOME/.config/kk/workflows,
 */
describe('kk-solo-podcast workflow (0071)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-solo-podcast.yaml');
    const helpPath = join(import.meta.dir, '../../../docs/help/solo-podcast-workflow.md');
    const stagesPath = join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const help = readFileSync(helpPath, 'utf-8');
    // 0131/0132 (ADR-115): prepare / duration-check logic and the sidecar override chain moved
    // from inline shell into this runner. The behaviour assertions below read the owner.
    const stages = readFileSync(stagesPath, 'utf-8');

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

    it('R3/R8 — agent.run steps use input+role and invoke the kk:audio-authoring skill', () => {
        const agentRunBlocks = [...yaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g)].map(
            (m) => m[1],
        );
        expect(agentRunBlocks.length).toBeGreaterThanOrEqual(3);
        for (const block of agentRunBlocks) {
            expect(block).not.toMatch(/^\s+skill:/m);
            expect(block).not.toMatch(/^\s+prompt:/m);
            expect(block).toContain('role:');
            expect(block).toContain('input:');
            expect(block).toContain('kk:audio-authoring');
        }
        expect(yaml).toContain('operation `briefing`');
        expect(yaml).toContain('operation `outline`');
        expect(yaml).toContain('operation `script`');
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/1-briefing-briefing.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/2-outline/outline-option-a.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-script-voicescript.yaml'].join('$'));
    });

    it('R1/R3 — success edges avoid action-ok (dry-run walkable) and $schema is quoted', () => {
        expect(yaml).toContain('"$schema":');
        expect(yaml).not.toMatch(/kind:\s*action-ok/);
    });

    it('R2/R9/R10 — prepare guards XOR input and refuses overwrite without force=true', () => {
        expect(stages).toContain('XOR violation: both topic and input_file set');
        expect(stages).toContain('XOR violation: neither topic nor input_file set');
        expect(stages).toContain(`initialization target already exists at \${workDirArg}/brief.md`);
        expect(stages).toContain('missing voice_profile (set vars.voice_profile or VOICEBOX_DEFAULT_PROFILE)');
        expect(yaml).toContain('bun "$st" prepare-solo');
    });

    it('R6/R7 — generate line carries no duration flag; duration-check gates via .duration-ok', () => {
        const generateLine = yaml.split('\n').find((l) => l.includes('kk executor run voice-gen'));
        expect(generateLine).toBeDefined();
        expect(generateLine).not.toContain('--duration');
        expect(generateLine).not.toContain('--target-duration');
        expect(yaml).toContain('kk executor run voice-gen --in');
        expect(stages).toContain('Regenerate: audio metadata.duration missing or not a number');
        expect(stages).toContain('Regenerate: last audio duration');
        expect(yaml).toContain('.duration-ok');
        expect(help).toContain('content.wav');
        expect(help).toContain('WAV');
    });

    it('R2/R3/R5 — revise counter in work_dir, wrap helper sidecar, duration retry edge declared', () => {
        expect(yaml).toContain('.revise-count');
        expect(yaml).not.toContain('__runId');
        expect(yaml).not.toContain('.spur/run');
        const wrapPath = join(import.meta.dir, '../../../plugins/kk/scripts/wrap-voicescript-doc.ts');
        expect(existsSync(wrapPath)).toBe(true);
        const wrap = readFileSync(wrapPath, 'utf-8');
        expect(wrap).toContain('node:crypto');
        expect(wrap).toContain('Podcast VoiceScript');
        expect(wrap).not.toMatch(/from\s+['"]@gobing-ai\//);
        expect(stages).toContain('wrap-voicescript-doc.ts');
        expect(stages).toContain('usage: kk-workflow-stages.ts wrap');
        expect(yaml).toContain('bun "$st" wrap');
        expect(yaml).toContain(['test -f "', '{vars.work_dir}/4-audio/.duration-ok"'].join('$'));
        expect(yaml).toContain('to: script-write');
        expect(yaml).toContain('.duration-feedback');
    });

    it('runtime paths resolve via package root; no bare checkout-relative trees', () => {
        expect(yaml).not.toContain('docs/design');
        expect(yaml).not.toContain('plugins/kk/lib');
        expect(yaml).not.toContain('plugins/kk/skills');
        // plugins/kk/workflows and plugins/kk/scripts are allowed ONLY under the $pkg
        // package-root prefix or the explicit checkout fallback tier 0133 added to the prelude
        // (`[ -f "$st" ] || st="plugins/kk/scripts/kk-workflow-stages.ts"`). Any other bare,
        // cwd-relative reference would break outside a checkout.
        const bareRefs = [...[...yaml.matchAll(/plugins\/kk\/(workflows|scripts)/g)]].filter((m) => {
            const before = yaml.slice(0, m.index);
            if (before.endsWith('$pkg/')) return false;
            const lineStart = before.lastIndexOf('\n') + 1;
            const line = yaml.slice(lineStart, yaml.indexOf('\n', m.index));
            return !line.includes('|| st="plugins/kk/scripts/kk-workflow-stages.ts"');
        });
        expect(bareRefs).toEqual([]);
        expect(yaml).toContain('command -v kk');
        // 0131 (ADR-115): the override chain + sidecar names now live in the stage runner;
        // the YAML resolves only the runner, from the kk package root.
        expect(stages).toContain('KK_WORKFLOWS_DIR');
        expect(stages).toContain('.config/kk/workflows');
        expect(stages).toContain('validate-voicescript.ts');
        expect(yaml).toContain('$pkg/plugins/kk/scripts/kk-workflow-stages.ts');
    });

    it('R3 (0131) — the script-write prompt is bounded and points at the skill template', () => {
        const blocks = [...yaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g)].map(
            (m) => m[1] ?? '',
        );
        const scriptBlock = blocks.find((b) => b.includes('operation `script`'));
        expect(scriptBlock).toBeDefined();
        const raw = (scriptBlock ?? '').split('input: |')[1]?.split('expectFile:')[0] ?? '';
        const input = raw
            .split('\n')
            .map((line) => line.trim())
            .join('\n')
            .trim();
        // ADR-115 error tier is above 1000 chars; the local cap keeps the prompt from
        // drifting back into a restated field schema (it was 1458 before task 0131).
        expect(input.length).toBeLessThanOrEqual(1000);
        expect(input).toContain('templates/voicescript.solo.yaml');
        expect(input).toContain(`--dir \${vars.work_dir}`);
    });

    it('R2 (0131) — the four delegated shell actions share one resolution prelude', () => {
        // A drifted copy would still pass validate; the cap counts each action separately, so
        // divergence stays invisible unless the four blocks are asserted identical.
        for (const line of [
            'kbin="$(command -v kk 2>/dev/null)";',
            'pkg="$(dirname "$(dirname "$(realpath "$kbin" 2>/dev/null)")")";',
            'st="$pkg/plugins/kk/scripts/kk-workflow-stages.ts";',
            '[ -f "$st" ] || st="plugins/kk/scripts/kk-workflow-stages.ts";',
            '[ -f "$st" ] || echo "kk-workflow-stages.ts not found at $st — install or refresh the kk package (bun link in a checkout)" >&2;',
        ]) {
            expect(yaml.split(line).length - 1).toBe(4);
        }
    });

    it('R2/R3 (0132) — every delegated action calls the runner with its declared argv', () => {
        for (const call of [
            `bun "$st" prepare-solo "\${vars.work_dir}" "\${vars.topic}" "\${vars.input_file}" "\${vars.voice_profile}" "\${vars.force}"`,
            `bun "$st" validate "\${vars.validate_script}" --in "\${vars.work_dir}/3-script-voicescript.yaml"`,
            `bun "$st" wrap "\${vars.wrap_script}" --in "\${vars.work_dir}/3-script-voicescript.yaml" --out "\${vars.work_dir}/4-audio/docs.json" --profile "\${vars.voice_profile}"`,
            `bun "$st" duration "\${vars.work_dir}" "\${vars.target_duration_min}"`,
        ]) {
            expect(yaml).toContain(call);
        }
    });

    it('R3 (0132) — the script-write prompt keeps the skill Flags line the trimmed prompt needs', () => {
        const scriptBlock = [...yaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g)]
            .map((m) => m[1] ?? '')
            .find((b) => b.includes('operation `script`'));
        expect(scriptBlock).toContain(
            `Flags: --dir \${vars.work_dir} --duration \${vars.target_duration_min} --language \${vars.language} --profile \${vars.voice_profile} --revise "\${vars.__hitlInput}"`,
        );
    });

    it('R5 — script_approved skips script-review the same way outline skips outline-select', () => {
        expect(yaml).toContain('script_approved: ""');
        expect(yaml).toContain(['test "', '{vars.script_approved}" = "true"'].join('$'));
        expect(yaml).toContain(['test -n "', '{vars.outline}"'].join('$'));
    });

    it('help doc documents XOR input, WAV, VoiceScript, HITL skips, and runtime workflows_dir', () => {
        const normalized = help.replace(/\s+/g, ' ');
        expect(existsSync(helpPath)).toBe(true);
        expect(normalized).toContain('Solo-Podcast Workflow');
        expect(normalized).toContain('sentence XOR a markdown file');
        expect(normalized).toContain('WAV');
        expect(normalized).toContain('VoiceScript');
        expect(normalized).toContain('script_approved');
        expect(normalized).toContain('hitl.select');
        expect(normalized).toContain('$HOME/.config/kk/workflows');
        expect(normalized).toContain('kk-solo-podcast');
    });

    it('R8 — no fat solo-podcast skill; /workflow-run may install this YAML', () => {
        expect(existsSync(join(import.meta.dir, '../../../plugins/kk/skills/solo-podcast'))).toBe(false);
    });

    // --- 0128: single-file stage flattening -------------------------------------

    // --- 0317 R7: the auto-profile outline binding --------------------------------

    it('R7 (0317) — the auto profile binds the outline before the operator gate, and defers on fallback', () => {
        expect(stateIds).toContain('outline-autopick');
        // The autopick state is the only one that asks a catalog decision for the outline.
        expect(yaml).toContain('decision: kk-podcast-outline');
        // Edges: auto goes through the decision, interactive keeps the pause, and a deferred
        // decision lands on the SAME operator gate the interactive profile uses.
        expect(yaml).toContain(['test -z "', '{vars.outline}" && test "', '{vars.auto}" = "true"'].join('$'));
        expect(yaml).toContain(['test -z "', '{vars.outline}" && test "', '{vars.auto}" != "true"'].join('$'));
        expect(yaml).toContain('to: outline-autopick');
        expect(yaml).toContain('to: outline-select');
    });

    it('R7 (0317) — a confident decision writes .auto-pick; a degraded or absent row leaves it empty', () => {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-podcast-pick-')));
        mkdirSync(join(dir, '2-outline'), { recursive: true });
        writeFileSync(join(dir, '2-outline', 'outline-option-a.md'), '# a\n');
        writeFileSync(join(dir, '2-outline', 'outline-option-b.md'), '# b\n');
        const projection = yaml
            .split('- id: outline-autopick')[1]
            ?.split('- id: outline-commit')[0]
            ?.match(/command: >-\n((?:\s{10,}.*\n)+)/g)
            ?.at(-1);
        expect(projection).toBeDefined();
        const original = (projection ?? '').replace(/^\s*command: >-\n/, '');
        const source = original.replace(/\n\s{10}/g, ' ').trim();
        const command = source.replace(/\$\{vars\.work_dir\}/g, dir);

        const runProjection = (row: Record<string, unknown> | null): string => {
            rmSync(join(dir, '2-outline', '.auto-pick'), { force: true });
            const decisionPath = join(dir, '2-outline', '.outline-decision.json');
            if (row === null) rmSync(decisionPath, { force: true });
            else writeFileSync(decisionPath, JSON.stringify(row));
            const result = Bun.spawnSync(['bash', '-c', command], { cwd: dir });
            expect(result.exitCode).toBe(0);
            const pick = join(dir, '2-outline', '.auto-pick');
            return existsSync(pick) ? readFileSync(pick, 'utf-8').trim() : '';
        };

        expect(runProjection({ value: 'b', degraded: false })).toBe('b');
        // A fallback (degraded) row is not a pick: the operator gate still decides.
        expect(runProjection({ value: 'a', degraded: true })).toBe('');
        // A tolerated decide failure leaves no row at all — still a deferral, never a guess.
        expect(runProjection(null)).toBe('');
        // A value naming an option that was never written is refused.
        expect(runProjection({ value: 'c', degraded: false })).toBe('');
        rmSync(dir, { recursive: true, force: true });
    });

    it('R2 (0128) — single-file briefing/script stages flatten; multi-file stages keep their dirs', () => {
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/1-briefing-briefing.md'].join('$'));
        expect(yaml).toContain(['expectFile: ', '{vars.work_dir}/3-script-voicescript.yaml'].join('$'));
        expect(yaml).not.toContain('/1-briefing"');
        expect(yaml).not.toContain('/3-script"');
        expect(yaml).not.toContain(['', '{vars.work_dir}/1-briefing/'].join('$'));
        expect(yaml).not.toContain(['', '{vars.work_dir}/3-script/'].join('$'));
        expect(stages).toContain("dirs: ['2-outline', '4-audio']");
    });
});
