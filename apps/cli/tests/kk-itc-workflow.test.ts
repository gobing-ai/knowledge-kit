import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
            'pkg="$(dirname "$(dirname "$(realpath "$kbin" 2>/dev/null)")")";',
            'st="$pkg/plugins/kk/scripts/kk-workflow-stages.ts";',
            '[ -f "$st" ] || st="plugins/kk/scripts/kk-workflow-stages.ts";',
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

// --- 0149: auto mode, judge revise loop, run report (F41 slice 1) -----------------------------

describe('kk-itc auto mode + revise loop + report (0149)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const runner = readFileSync(join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts'), 'utf-8');

    const stateIds = [...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    // `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet
    // (same dodge as the 0069 expectFile assertions above).
    const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

    /** Extract each transition's guard command from the transitions section, keyed `from->to`. */
    const guardOf = (from: string, to: string): string => {
        const transitions = yaml.slice(yaml.indexOf('\ntransitions:'));
        const blocks = [...transitions.matchAll(/- from: ([\w-]+)\n\s+to: ([\w-]+)([\s\S]*?)(?=\n {2}- from:|$)/g)];
        const block = blocks.find((m) => m[1] === from && m[2] === to);
        expect(block, `transition ${from}->${to} exists`).toBeDefined();
        return block?.[3] ?? '';
    };

    /** The state block's source (description + onEnter), sliced to just that state. */
    const stateBlock = (id: string): string =>
        yaml.match(new RegExp(`- id: ${id}\\n[\\s\\S]*?(?=\\n {2}- id: )`))?.[0] ?? '';

    it('R1 — the new vars default off and the loop caps stay present', () => {
        expect(yaml).toContain('auto: "false"');
        expect(yaml).toContain('unslop: "false"');
        expect(yaml).toContain('max_revisions: "2"');
    });

    it('R1 (V1) — with default vars every new edge is guarded behind auto/unslop, so the path is unchanged', () => {
        expect(stateIds).toEqual(expect.arrayContaining(['outline-autopick', 'unslop', 'draft-autorevise', 'report']));
        // The judge NEEDS_REVISION -> draft-revise edge is the one Q&A-sanctioned default-path change
        // (it replaces today's route to failed); it carries its own dedicated assertions below.
        for (const [from, to] of [
            ['outline-write', 'outline-autopick'],
            ['draft-write', 'unslop'],
            ['draft-write', 'judge'],
            ['unslop', 'judge'],
            ['unslop', 'draft-review'],
            ['draft-autorevise', 'unslop'],
            ['draft-autorevise', 'judge'],
            ['judge', 'report'],
            ['judge', 'draft-autorevise'],
        ] as const) {
            expect(guardOf(from, to), `${from}->${to} must reference vars.auto or vars.unslop`).toMatch(
                /vars\.(auto|unslop)/,
            );
        }
    });

    it('R2 (AC2) — outline-write routes to outline-autopick in auto mode, which binds the pick and never enters outline-select', () => {
        expect(guardOf('outline-write', 'outline-autopick')).toContain(`test "${varRef('auto')}" = "true"`);
        expect(guardOf('outline-write', 'outline-autopick')).toContain(`-z "${varRef('outline')}"`);
        expect(guardOf('outline-write', 'outline-select')).toContain(`test "${varRef('auto')}" != "true"`);
        const block = stateBlock('outline-autopick');
        expect(block).toContain('kk stage itc-outline-pick');
        expect(block).toContain('kind: file.read.into-var');
        expect(block).toContain('var: outline');
        expect(guardOf('outline-autopick', 'outline-commit')).toContain('always');
        // the writer prompt carries the recommendation contract
        expect(stateBlock('outline-write')).toContain('outline-recommendation.json');
        expect(stateBlock('outline-write')).toContain('"pick": "a|b|c"');
    });

    it('R3 (0149 review P3) — a judge catch-all fails out-of-contract verdicts instead of deadlocking', () => {
        // two judge->failed edges exist (interactive FAIL + this catch-all); pin the catch-all by its description
        const i = yaml.indexOf('Catch-all: an out-of-contract verdict');
        expect(i).toBeGreaterThan(-1);
        const guard = yaml.slice(i);
        // non-empty verdict that is none of PASS / FAIL / NEEDS_REVISION still exits the machine
        expect(guard).toContain('test -n "$v"');
        expect(guard).toContain('!= PASS');
        expect(guard).toContain('!= FAIL');
        expect(guard).toContain('!= NEEDS_REVISION');
    });

    it('R3/AC6 — the unslop state edits the draft in place and sits on every auto revision path', () => {
        const block = stateBlock('unslop');
        expect(block).toContain('kk:taste-unslop');
        // executor deletes expectFile pre-dispatch — the editor must write a NEW file (input survives), then the swap makes it in place
        expect(block).toContain('Do not modify or delete the original file');
        expect(block).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.new.md'].join('$'));
        expect(block).toContain('mv -f');
        expect(guardOf('draft-write', 'unslop')).toContain(`test "${varRef('unslop')}" = "true"`);
        expect(guardOf('draft-autorevise', 'unslop')).toContain(`test "${varRef('unslop')}" = "true"`);
        expect(guardOf('unslop', 'judge')).toContain(`test "${varRef('auto')}" = "true"`);
        expect(guardOf('unslop', 'draft-review')).toContain(`test "${varRef('auto')}" != "true"`);
    });

    it('R3 — draft-write/draft-autorevise split on unslop; interactive drafts still pause at review', () => {
        expect(guardOf('draft-write', 'judge')).toContain(`test "${varRef('auto')}" = "true"`);
        expect(guardOf('draft-write', 'judge')).toContain(`"${varRef('unslop')}" != "true"`);
        expect(guardOf('draft-write', 'draft-review')).toContain(`test "${varRef('auto')}" != "true"`);
        expect(guardOf('draft-write', 'draft-review')).toContain(`"${varRef('unslop')}" != "true"`);
        expect(guardOf('draft-autorevise', 'judge')).toContain(`test "${varRef('auto')}" = "true"`);
    });

    it('R4 (AC3, V5) — auto NEEDS_REVISION loops through draft-autorevise, bounded by max_revisions', () => {
        const block = stateBlock('draft-autorevise');
        expect(block).toContain('.auto-revise-count');
        expect(block).toContain('feedback[]');
        expect(block).toContain('.itc-verdict.json');
        // executor deletes expectFile pre-dispatch — the reviser must write a NEW file, then the swap
        expect(block).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.new.md'].join('$'));
        expect(block).toContain('mv -f');

        const autorevise = guardOf('judge', 'draft-autorevise');
        expect(autorevise).toContain(`test "${varRef('auto')}" = "true"`);
        expect(autorevise).toContain('NEEDS_REVISION');
        expect(autorevise).toContain('.auto-revise-count');
        expect(autorevise).toContain(`-lt "${varRef('max_revisions')}"`);

        const report = guardOf('judge', 'report');
        expect(report).toContain(`test "${varRef('auto')}" = "true"`);
        expect(report).toContain('PASS'); // PASS still reports (then routes done)
        expect(report).toContain('FAIL');
        expect(report).toContain(`-ge "${varRef('max_revisions')}"`); // exhausted NEEDS_REVISION reports, ends failed
    });

    it('R4/R5 (AC4) — interactive NEEDS_REVISION routes back to draft-revise with the feedback shown, capped at 3', () => {
        const revise = guardOf('judge', 'draft-revise');
        expect(revise).toContain(`test "${varRef('auto')}" != "true"`);
        expect(revise).toContain('NEEDS_REVISION');
        expect(revise).toContain('.revise-count');
        expect(revise).toContain('-lt 3');

        const failed = guardOf('judge', 'failed');
        expect(failed).toContain(`test "${varRef('auto')}" != "true"`);
        expect(failed).toContain('FAIL');
        expect(failed).toContain('-ge 3');

        // The judge binds the verdict so draft-revise can show the feedback; the prompt carries it.
        const judgeBlock = stateBlock('judge');
        expect(judgeBlock).toContain('kind: file.read.into-var');
        expect(judgeBlock).toContain('var: __verdictFeedback');
        expect(yaml).toContain(['Revision feedback: ', '{vars.__hitlInput}'].join('$'));
        expect(stateBlock('draft-revise')).toContain('Judge feedback');
    });

    it('R5 (AC5) — the judge prompt names docs.json as research evidence', () => {
        expect(stateBlock('judge')).toContain('docs.json');
    });

    it('R7 — the report state delegates itc-report and routes done/failed on the outcome', () => {
        const block = stateBlock('report');
        expect(block).toContain('kk stage itc-report');
        expect(block).toContain(`"${varRef('max_revisions')}"`);
        // Empty outcome = done keeps the dry-run walkable (mirrors the empty-verdict PASS convention).
        expect(guardOf('report', 'done')).toContain('test -z "$o" -o "$o" = done');
        expect(guardOf('report', 'failed')).toContain('"$o" != done');
    });

    it('R8 — the helpers live in itc-stages.ts, are dispatched from the runner switch, and stay node-builtin-only', () => {
        // Lazy sibling resolution: a runner copy without itc-stages.ts still loads and fails loud.
        expect(runner).toContain(`import('./itc-stages.ts')`);
        expect(runner).toContain('loadItcStages');
        expect(runner).toContain(`case 'itc-outline-pick':`);
        expect(runner).toContain(`case 'itc-report':`);
        const stages = readFileSync(join(import.meta.dir, '../../../plugins/kk/scripts/itc-stages.ts'), 'utf-8');
        expect(stages).not.toContain('@gobing-ai/');
        expect(stages).not.toContain(`from '../`); // no cross-directory imports (ADR-018/V6)
        expect(stages).toContain('outline-recommendation.json');
        expect(stages).toContain('report.json');
    });

    it('task check — the dry-run walk with auto=true reaches done', () => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-itc-dryrun-'));
        const result = Bun.spawnSync(
            [
                'spur',
                'workflow',
                'run',
                workflowPath,
                '--run-id',
                `kk-itc-dryrun-${Date.now()}`,
                '--dry-run',
                '--no-log',
                '--json',
                '--vars',
                JSON.stringify({ work_dir: workDir, auto: 'true', judge: 'true', unslop: 'true' }),
            ],
            {
                cwd: join(import.meta.dir, '../../..'),
                // The test may run inside a pipeline step — never leak the guard into the child.
                env: { ...process.env, SPUR_WORKFLOW_RUN_ACTIVE: undefined },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
        const summary = JSON.parse(result.stdout.toString());
        expect(summary.status).toBe('done');
        expect(summary.finalState).toBe('done');
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});

describe('kk-itc illustrate + adapt (0152)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const stages = readFileSync(join(import.meta.dir, '../../../plugins/kk/scripts/itc-stages.ts'), 'utf-8');

    // `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet
    const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

    const guardOf = (from: string, to: string): string => {
        const transitions = yaml.slice(yaml.indexOf('\ntransitions:'));
        const blocks = [...transitions.matchAll(/- from: ([\w-]+)\n\s+to: ([\w-]+)([\s\S]*?)(?=\n {2}- from:|$)/g)];
        const block = blocks.find((m) => m[1] === from && m[2] === to);
        expect(block, `transition ${from}->${to} exists`).toBeDefined();
        return block?.[3] ?? '';
    };

    const stateBlock = (id: string): string =>
        yaml.match(new RegExp(`- id: ${id}\\n[\\s\\S]*?(?=\\n {2}- id: )`))?.[0] ?? '';

    it('R1 (R7/AC1) — the spend vars default false and illustrate runs only when one is on', () => {
        expect(yaml).toContain('cover_enabled: "false"');
        expect(yaml).toContain('inline_images: "false"');
        expect(guardOf('publish-entry', 'illustrate')).toContain(`test "${varRef('cover_enabled')}" = "true"`);
        expect(guardOf('publish-entry', 'illustrate')).toContain(`-o "${varRef('inline_images')}" = "true"`);
        // else-branch: with both vars false the state is never entered
        expect(guardOf('publish-entry', 'materialize')).toContain(`"${varRef('cover_enabled')}" != "true"`);
        expect(guardOf('publish-entry', 'materialize')).toContain(`"${varRef('inline_images')}" != "true"`);
        expect(guardOf('illustrate', 'materialize')).toContain('always');
        expect([...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1])).toContain('illustrate');
    });

    it('R7 — illustrate runs kk:image-authoring non-interactively with auto-confirm and verifies the cover', () => {
        const block = stateBlock('illustrate');
        expect(block).toContain('kk:image-authoring');
        expect(block).toContain('KK_NONINTERACTIVE=1');
        expect(block).toContain('KK_IMAGE_AUTO_CONFIRM=1');
        expect(block).toContain('4-illustrations');
        expect(block).toContain('cover.png');
        // inline figures are requested only when inline_images=true
        expect(block).toContain('When inline_images=true');
        // spend guard: cover_enabled=true must yield a cover artifact
        expect(block).toContain(`test "${varRef('cover_enabled')}" = "true" || exit 0`);
        expect(block).toContain('4-illustrations/cover.*');
    });

    it('R9 (AC2) — adapt runs only for a plan variant needing adaptation and verifies the files', () => {
        const block = stateBlock('adapt');
        expect(block).toContain('kk:article-adapt');
        expect(block).toContain('publish-plan.json');
        expect(block).toContain('adapt=true');
        // invariant: the adapt step never sets draft/live switches — fanout stamps them (V3)
        expect(block).toContain('Never set metadata.published');
        // R3 follow-up shell step fails on a missing or title/body-lacking variant file
        expect(block).toContain('kk stage itc-adapt-verify');
        expect(stages).toContain('export function itcAdaptVerify');

        const adaptEdge = guardOf('publish-plan', 'adapt');
        expect(adaptEdge).toContain('publish-plan.json');
        expect(adaptEdge).toContain('.adapt == true');
        expect(guardOf('adapt', 'publish-gate')).toContain('always');
        // fallback edge: no adaptation needed -> straight through the send gate
        expect(guardOf('publish-plan', 'publish-gate')).toContain('always');
    });

    it('task check — a dry-run walk with cover/inline on and targets set still reaches done', () => {
        const workDir = mkdtempSync(join(tmpdir(), 'kk-itc-dryrun-0152-'));
        const result = Bun.spawnSync(
            [
                'spur',
                'workflow',
                'run',
                workflowPath,
                '--run-id',
                `kk-itc-dryrun-0152-${Date.now()}`,
                '--dry-run',
                '--no-log',
                '--json',
                '--vars',
                JSON.stringify({
                    work_dir: workDir,
                    auto: 'true',
                    judge: 'true',
                    unslop: 'true',
                    cover_enabled: 'true',
                    inline_images: 'true',
                    publish_targets: 'zenn-pub,qiita-pub,surfdash-pub',
                }),
            ],
            {
                cwd: join(import.meta.dir, '../../..'),
                // The test may run inside a pipeline step — never leak the guard into the child.
                env: { ...process.env, SPUR_WORKFLOW_RUN_ACTIVE: undefined },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
        const summary = JSON.parse(result.stdout.toString());
        expect(summary.status).toBe('done');
        expect(summary.finalState).toBe('done');
        // AC1 behavioral proof: the spend vars route the walk through illustrate (+1 transition vs base)
        expect(summary.transitionsTaken).toBe(14);
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});
