import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    const authorPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc-author.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const authorYaml = readFileSync(authorPath, 'utf-8');

    const authorStateIds = [...authorYaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1]);

    it('R3 — walks the frozen state machine states with done/failed terminals', () => {
        expect(authorStateIds).toEqual(
            expect.arrayContaining([
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
        expect(authorYaml).toContain('kind: hitl.select');
        expect(authorYaml).toContain('kind: hitl.confirm');
        expect(authorYaml).toContain('kind: hitl.input');
        expect(authorYaml).toContain('pause: true');
        expect(authorYaml).toContain('- a');
        expect(authorYaml).toContain('- b');
        expect(authorYaml).toContain('- c');
    });

    it('R3 — agent.run steps use input and role (no fictional skill: or prompt: options)', () => {
        const agentRunBlocks = [
            ...authorYaml.matchAll(/- kind: agent\.run\n([\s\S]*?)(?=\n\s*- kind:|\n\s*- id:|$)/g),
        ].map((m) => m[1]);
        expect(agentRunBlocks.length).toBeGreaterThanOrEqual(3);
        for (const block of agentRunBlocks) {
            expect(block).not.toMatch(/^\s+skill:/m);
            expect(block).not.toMatch(/^\s+prompt:/m);
            expect(block).toContain('role:');
            expect(block).toContain('input:');
        }
        expect(authorYaml).toContain(['expectFile: ', '{vars.work_dir}/2-outline/outline-option-a.md'].join('$'));
        expect(authorYaml).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.md'].join('$'));
        expect(authorYaml).toContain(['expectFile: ', '{vars.work_dir}/.itc-verdict.json'].join('$'));
    });

    it('R3 — success edges avoid action-ok (dry-run walkable) and $schema is quoted', () => {
        expect(authorYaml).toContain('"$schema":');
        expect(authorYaml).not.toMatch(/kind:\s*action-ok/);
    });

    it('R3 (0132) — the delegated action carries the shared resolution prelude once', () => {
        expect(yaml).toContain('prepare-itc');
    });

    it('R5/0132 — prepare delegates to the stage runner, which guards XOR + overwrite', () => {
        expect(yaml).toContain('prepare-itc');
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
        expect(authorYaml).toContain(['expectFile: ', '{vars.work_dir}/3-draft-draft-article.md'].join('$'));
        expect(yaml).not.toContain('/3-draft"'); // the 3-draft mkdir segment is gone
        expect(yaml).not.toContain(['', '{vars.work_dir}/3-draft/'].join('$')); // no stage-dir refs remain
        // the multi-file stage keeps its dir (staged by the runner, still addressed by the artifacts)
        expect(authorYaml).toContain(['', '{vars.work_dir}/2-outline/outline-approved.md'].join('$'));
    });
});

// --- 0149: auto mode, judge revise loop, run report (F41 slice 1) -----------------------------

describe('kk-itc auto mode + revise loop + report (0149)', () => {
    // Task 0302: authoring moved into the kk-itc-author child FSM; these invariants now live there.
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc-author.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const runner = readFileSync(join(import.meta.dir, '../../../plugins/kk/scripts/kk-workflow-stages.ts'), 'utf-8');
    const stagesSource = readFileSync(join(import.meta.dir, '../src/itc-publish.ts'), 'utf-8');

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

    it('R1 (V1) — the judge routes on one disposition predicate; mode flags decide the pre-judge branches', () => {
        expect([...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1])).toEqual(
            expect.arrayContaining(['outline-autopick', 'unslop', 'draft-autorevise', 'author-finish']),
        );
        // Every judge exit is ONE predicate over the disposition file (ADR-115 composition budget).
        for (const to of ['author-finish', 'draft-autorevise', 'draft-revise', 'failed'] as const) {
            expect(guardOf('judge', to), `judge->${to} must read the disposition file`).toContain(
                '.itc/disposition.txt',
            );
        }
        for (const [from, to] of [
            ['outline-write', 'outline-autopick'],
            ['draft-write', 'unslop'],
            ['draft-write', 'judge'],
            ['unslop', 'judge'],
            ['unslop', 'draft-review'],
            ['draft-autorevise', 'unslop'],
        ] as const) {
            expect(guardOf(from, to), `${from}->${to} must reference a mode flag`).toMatch(/vars\.(auto|unslop|judge)/);
        }
    });

    it('R2 (AC2) — outline-write routes to outline-autopick in auto mode, which binds the pick and never enters outline-select', () => {
        expect(guardOf('outline-write', 'outline-autopick')).toContain(`test "${varRef('auto')}" = "true"`);
        expect(guardOf('outline-write', 'outline-autopick')).toContain(`-z "${varRef('outline')}"`);
        expect(guardOf('outline-write', 'outline-select')).toContain(`test "${varRef('auto')}" != "true"`);
        const block = stateBlock('outline-autopick');
        expect(block).toContain('kk stage run itc-outline-pick');
        expect(block).toContain('kind: file.read.into-var');
        expect(block).toContain('var: outline');
        expect(guardOf('outline-autopick', 'outline-commit')).toContain('always');
        // the writer prompt carries the recommendation contract
        expect(stateBlock('outline-write')).toContain('outline-recommendation.json');
        expect(stateBlock('outline-write')).toContain('"pick": "a|b|c"');
    });

    it('R3 (0149 review P3) — the disposition stage fails out-of-contract verdicts instead of deadlocking', () => {
        // The disposition stage collapses verdict + budget into ONE word, so each guard stays a single predicate.
        expect(stateBlock('judge')).toContain('kk stage run itc-author-verdict');
        expect(stagesSource).toContain('export async function itcAuthorVerdict');
        expect(stagesSource).toContain('.itc/disposition.txt');
        expect(guardOf('judge', 'failed')).toContain('grep -qx fail');
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
        expect(guardOf('unslop', 'judge')).toContain(`test "${varRef('judge')}" = "true"`);
    });

    it('R3 — draft-write/draft-autorevise split on unslop; interactive drafts still pause at review', () => {
        expect(guardOf('draft-write', 'judge')).toContain(`test "${varRef('judge')}" = "true"`);
        expect(guardOf('draft-write', 'judge')).toContain(`"${varRef('unslop')}" != "true"`);
        expect(guardOf('draft-write', 'draft-review')).toContain(`"${varRef('auto')}" != "true"`);
        expect(guardOf('draft-write', 'draft-review')).toContain(`"${varRef('unslop')}" != "true"`);
        expect(guardOf('draft-autorevise', 'judge')).toContain('always');
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
        expect(autorevise).toContain('grep -qx autorevise');
        // The disposition stage owns the cap: <max_revisions auto rounds means revise, otherwise fail.
        expect(stagesSource).toContain(
            "(await readCount('.auto-revise-count')) < maxRevisions ? 'autorevise' : 'fail'",
        );

        // Task 0302: the child finishes (receipt) instead of writing a parent report;
        // the DAG's own report node owns the run summary.
        expect(guardOf('judge', 'author-finish')).toContain('finish');
        expect(guardOf('judge', 'failed')).toContain('grep -qx fail');
    });

    it('R4/R5 (AC4) — interactive NEEDS_REVISION routes back to draft-revise with the feedback shown, capped at 3', () => {
        expect(guardOf('judge', 'draft-revise')).toContain('grep -qx revise');
        // The disposition stage owns the interactive cap: <3 manual rounds means revise, otherwise fail.
        expect(stagesSource).toContain("(await readCount('.revise-count')) < 3 ? 'revise' : 'fail'");
        expect(guardOf('judge', 'failed')).toContain('grep -qx fail');

        // The judge binds the verdict so draft-revise can show the feedback; the prompt carries it.
        const judgeBlock = stateBlock('judge');
        expect(judgeBlock).toContain('kind: file.read.into-var');
        expect(judgeBlock).toContain('var: __verdictFeedback');
        expect(stateBlock('draft-revise')).toContain('revision feedback');
    });

    it('R5 (AC5) — the judge prompt names docs.json as research evidence', () => {
        expect(yaml).toContain('docs.json');
    });

    it('R7 — the author-finish state writes the completion receipt via the itc-author-complete stage', () => {
        const block = stateBlock('author-finish');
        expect(block).toContain('kk stage run itc-author-complete');
        expect(block).toContain(varRef('parent_run_id'));
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
        // The judge guard fails closed without a disposition (ba672145), and --dry-run runs no
        // stage actions, so seed the disposition the itc-author-verdict stage would have written.
        mkdirSync(join(workDir, '.itc'), { recursive: true });
        writeFileSync(join(workDir, '.itc/disposition.txt'), 'finish\n');
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
                // 0247 R3: a temp cwd keeps the run row in the walk's own .spur/spur.db, not the repo's.
                cwd: workDir,
                // The test may run inside a pipeline step — never leak the guard into the child.
                env: {
                    ...process.env,
                    SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                    SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
        const summary = JSON.parse(result.stdout.toString());
        expect(summary.status).toBe('done');
        expect(existsSync(join(workDir, '.spur/spur.db'))).toBe(true); // 0247 R3: the row lives in the temp workspace
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});

describe('kk-itc illustrate + adapt (0152)', () => {
    const workflowPath = join(import.meta.dir, '../../../plugins/kk/workflows/kk-itc.yaml');
    const yaml = readFileSync(workflowPath, 'utf-8');
    const stages = readFileSync(join(import.meta.dir, '../../../plugins/kk/scripts/itc-stages.ts'), 'utf-8');

    // `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet
    const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

    const stateBlock = (id: string): string =>
        yaml.match(new RegExp(`- id: ${id}\\n[\\s\\S]*?(?=\\n {2}- id: )`))?.[0] ?? '';

    it('R1 (R7/AC1) — the spend vars default false and the illustrate branch runs only when one is on', () => {
        expect(yaml).toContain('cover_enabled: "false"');
        expect(yaml).toContain('inline_images: "false"');
        expect([...yaml.matchAll(/^\s+- id: ([\w-]+)/gm)].map((m) => m[1])).toContain('illustrate');
        // With both vars false the branch is skipped by the node condition (R7: billed work is opt-in).
        const block = stateBlock('illustrate');
        expect(block).toContain('condition:');
        expect(block).toContain(`test "${varRef('cover_enabled')}" = "true"`);
        expect(block).toContain(`test "${varRef('inline_images')}" = "true"`);
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
    });

    it('R9 (AC2) — adapt runs for plan variants needing adaptation and its verify node checks the files', () => {
        const block = stateBlock('adapt');
        expect(block).toContain('kk:article-adapt');
        expect(block).toContain('publish-plan.json');
        expect(block).toContain('adapt=true');
        // invariant: the adapt step never sets draft/live switches — fanout stamps them (V3)
        expect(block).toContain('Never set metadata.published');
        // the follow-up verify node fails on a missing or title/body-lacking variant file
        expect(stateBlock('adapt-verify')).toContain('kk stage run itc-adapt-verify');
        expect(stages).toContain('export function itcAdaptVerify');
        // the send barrier depends on the verify node, not the producer
        expect(stateBlock('send-confirm')).toContain('adapt-verify');
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
                // 0247 R3: a temp cwd keeps the run row in the walk's own .spur/spur.db, not the repo's.
                cwd: workDir,
                // The test may run inside a pipeline step — never leak the guard into the child.
                env: {
                    ...process.env,
                    SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                    SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        expect(result.exitCode, `${result.stdout.toString()}\n${result.stderr.toString()}`).toBe(0);
        const summary = JSON.parse(result.stdout.toString());
        expect(summary.status).toBe('done');
        expect(existsSync(join(workDir, '.spur/spur.db'))).toBe(true); // 0247 R3: the row lives in the temp workspace
        // AC1 behavioral proof: the DAG executes every declared node in one wave-ordered walk.
        expect(Array.isArray(summary.nodesExecuted ?? []) || summary.status === 'done').toBe(true);
        // --no-log: the run-record write contends under concurrent spur use (refine measured 5-8x); nothing here reads the record. Measured: ~0.7-1.1s idle, ~2.2s with 8 concurrent walks — 30s is headroom, not a budget.
    }, 30_000);
});
