/**
 * Task 0367 R7/R8, AC1 — `kk-news-generate.yaml` as a file contract.
 *
 * The design freeze (`docs/design/content-pipeline-consolidation.md` §5.1) names twenty nodes and
 * the fate of voice3's forty-three; this suite asserts the YAML matches that map without executing
 * it — `kk-news-generate.e2e.test.ts` runs the graph, this file fails fast when a node is renamed,
 * reordered, re-wired or given a body the design forbids:
 *
 *  - AC1: twenty nodes, ONE executor variable, `executor-probe` first, and no node command that
 *    reaches back to `kk stage`, `jq` or `file.read`;
 *  - R7: the seven declared vars, the single `agent` var, agent/fix/judge roles, the review pause,
 *    and no publish node (publishing is `kk news generate --publish`);
 *  - R7: every node after `prepare` conditions on `pool-gate.json`, and every non-agent, non-pause,
 *    non-nested command is one `kk news <verb> …` call (the freeze node is the design's one pair).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-news-generate.yaml');

interface NodeAction {
    kind: string;
    onError?: string;
    options?: Record<string, unknown>;
}

interface Node {
    id: string;
    description?: string;
    dependsOn?: string[];
    pause?: boolean;
    condition?: { kind: string; options?: Record<string, unknown> };
    action?: NodeAction;
}

interface Doc {
    name: string;
    kind: string;
    vars: Record<string, string>;
    nodes: Node[];
}

const doc = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf-8')) as Doc;
const byId = new Map(doc.nodes.map((node) => [node.id, node]));
const command = (node: Node): string => String(node.action?.options?.command ?? '');
const condition = (node: Node): string => String(node.condition?.options?.command ?? '');
const order = doc.nodes.map((node) => node.id);

/** The design §5.1 nodes in the design's topological order, plus 0409's localize pair. */
const DESIGN_NODES = [
    'executor-probe',
    'prepare',
    'curate',
    'curate-check',
    'curate-fix',
    'curate-final',
    'script-write',
    'script-check',
    'script-fix',
    'editorial-judge',
    'render',
    'safety',
    'review',
    // 0426 R1: the opt-in inline-figure pair, after the drafts verdict and before the freeze.
    'illustrations-plan',
    'illustrations-render',
    // 0409 R1: the en/ja translations of the reviewed article, gated before the freeze so the
    // variants review and the freeze digest cover exactly the bytes that publish.
    'localize',
    'localize-check',
    'voice',
    'voice-fallback-box',
    'voice-fallback',
    'voice-fallback2',
    'cards',
    // 0449 R3: the opt-in 9:16 teaser, before the bundle so its variants freeze with the episode.
    'video',
    'variants',
    'safety-variants',
    'freeze',
];

/** Shell nodes that are NOT nested workflow calls: the ones R2 constrains to one verb call. */
/**
 * The documented exceptions to "a shell node calls one `kk news <verb>`": each is a `kk stage` call
 * because the work is deterministic stage work no `news` verb owns.
 * - 0409: `localize-check` — translating inside the plugin would move a model call into a
 *   deterministic step, and translating after the freeze would publish bytes the review never saw.
 * - 0426: `illustrations-render` — whole-plan validation + one pinned `job: illustration` request
 *   per figure with per-figure receipts; no existing verb owns it.
 * - ADR-059: `safety-variants` — deterministic post-TTS variant integrity + PII gate that inherits
 *   the pre-TTS `safety` stamp and writes `4-safety-variants/safety.json` for `freeze`.
 * - 0449 R3: `video` — `kk stage daily-video-request` writes the typed generator request (the
 *   `Doc[]` envelope `kk executor run` validates) and the node then runs the video-gen plugin; no
 *   `news` verb owns a generator invocation, and the request shape must stay next to the variants.
 * Declared once so an undocumented exception cannot slip in through one assertion.
 */
const STAGE_NODE_EXCEPTIONS = new Set(['localize-check', 'illustrations-render', 'safety-variants', 'video']);

const verbNodes = (): Node[] =>
    doc.nodes.filter(
        (node) =>
            node.pause !== true &&
            node.action?.kind === 'shell' &&
            !command(node).includes('spur workflow run') &&
            !STAGE_NODE_EXCEPTIONS.has(node.id),
    );

describe('kk-news-generate — AC1: twenty nodes, one executor variable, no padding', () => {
    it('declares exactly the designed node ids, in topological order', () => {
        expect(doc.name).toBe('kk-news-generate');
        expect(doc.kind).toBe('dag');
        // 26 since 0449: 0426's 25 plus the opt-in short-form `video` node (D9).
        expect(doc.nodes).toHaveLength(26);
        expect(order).toEqual(DESIGN_NODES);
    });

    it('runs the opt-in figure pair after the drafts verdict AND the review pause (0426 R1)', () => {
        // `[safety]` alone would spend before the operator approves the body; `[review]` alone would
        // be skipped whenever `--skip-review` is set (a node whose dependencies are ALL skipped is
        // skipped) and silently drop opted-in figures. Both edges give the ordering and survive the
        // skip, because done+skipped is a mix and a mixed node still runs.
        expect(byId.get('illustrations-plan')?.dependsOn).toEqual(['safety', 'review']);
        expect(byId.get('illustrations-render')?.dependsOn).toEqual(['illustrations-plan']);
        expect(byId.get('variants')?.dependsOn).toContain('illustrations-render');
        for (const id of ['illustrations-plan', 'illustrations-render']) {
            expect(condition(byId.get(id) as Node), `${id} is opt-in only`).toContain(
                `"\${vars.inline_illustrations}" = "true"`,
            );
        }
    });

    it('keeps every dependency forward-only, with executor-probe as the only entry node', () => {
        for (const node of doc.nodes) {
            for (const dep of node.dependsOn ?? []) {
                expect(order).toContain(dep);
                expect(order.indexOf(dep)).toBeLessThan(order.indexOf(node.id));
            }
        }
        expect(byId.get('executor-probe')?.dependsOn ?? []).toEqual([]);
        for (const node of doc.nodes.filter((entry) => entry.id !== 'executor-probe')) {
            expect((node.dependsOn ?? []).length).toBeGreaterThan(0);
        }
    });

    it('has ONE executor variable and the twelve designed vars (ADR-053 §5, R7; 0424/0426 add the visual and inline-figure vars)', () => {
        expect(Object.keys(doc.vars).sort()).toEqual([
            'agent',
            'cover_model',
            'cover_provider',
            'inline_illustrations',
            'plugins_path',
            'preset',
            'run_date',
            'run_id',
            'skill_dir',
            'skip_review',
            'video',
            'visual_skill_root',
            'work_dir',
        ]);
        // 0424 R2: the daily visual skills are read in place from the package; the declared default
        // keeps a direct `spur workflow run` call working without the launcher.
        expect(doc.vars.visual_skill_root).toBe('plugins/kk/skills');
        // 0426 R1: inline figures are opt-in; the default is off for every existing caller.
        expect(doc.vars.inline_illustrations).toBe('false');
        // 0449 R3: the short-form video is opt-in too (`off`), so a default day renders nothing.
        expect(doc.vars.video).toBe('off');
        // `agent` is the only executor switch: `inline` by default, and no node pins a model, an
        // executor roster entry or a second agent var.
        expect(doc.vars.agent).toBe('inline');
        const text = readFileSync(WORKFLOW, 'utf-8');
        expect(text).not.toContain(`\${vars.executor}`);
        expect(text).not.toContain(`\${vars.model}`);
        // Every agent node resolves through the one var; the only literal is the var's own default.
        const literalAgents = [...text.matchAll(/agent: (.+)/g)].map((match) => match[1]?.trim());
        expect(literalAgents).toEqual(['inline', ...Array(8).fill(`\${vars.agent}`)]);
    });

    it('runs the 0360 executor probe first: the shared real-traffic prompt', () => {
        const probe = byId.get('executor-probe') as Node;
        expect(probe.action?.kind).toBe('agent.run');
        expect(probe.action?.options?.role).toBe('scribe');
        expect(probe.action?.options?.agent).toBe(`\${vars.agent}`);
        expect(probe.action?.options?.timeoutMs).toBe(120000);
        expect(probe.action?.options?.input).toBe('Reply with exactly: OK');
    });

    it('never reaches back to a stage name, jq or a var-writing file read (AC1)', () => {
        // 0409's one documented exception: the localize gate is a stage (`news-localize-validate`),
        // because translating in the plugin would put a model call in a deterministic step and
        // translating after the freeze would publish bytes the safety review never saw.
        for (const node of doc.nodes.filter((entry) => !STAGE_NODE_EXCEPTIONS.has(entry.id))) {
            const body = `${command(node)}\n${condition(node)}`;
            expect(body).not.toContain('kk stage');
            expect(body).not.toContain('jq ');
            expect(body).not.toContain('file.read');
            expect(node.action?.kind).not.toBe('file.read.into-var');
        }
    });
});

describe('kk-news-generate — R7: the node bodies', () => {
    it('calls exactly one `kk news <verb>` per non-agent, non-pause, non-nested node', () => {
        const verbs: Record<string, string> = {
            prepare: 'kk news prepare',
            'curate-check': `kk news generate-check --work-dir "\${vars.work_dir}" --step curate`,
            'curate-final': `kk news generate-check --work-dir "\${vars.work_dir}" --step curate --final`,
            'script-check': `kk news generate-check --work-dir "\${vars.work_dir}" --step script`,
            render: `kk news generate-render --work-dir "\${vars.work_dir}"`,
            voice: `kk news generate-voice --work-dir "\${vars.work_dir}" --engine voxcpm`,
            'voice-fallback-box': `kk news generate-voice --work-dir "\${vars.work_dir}" --engine voicebox`,
            'voice-fallback': `kk news generate-voice --work-dir "\${vars.work_dir}" --engine gemini`,
            'voice-fallback2': `kk news generate-voice --work-dir "\${vars.work_dir}" --engine omnivoice`,
            cards: `kk news generate-cards --work-dir "\${vars.work_dir}"`,
            variants: `kk news generate-bundle --work-dir "\${vars.work_dir}"`,
        };
        for (const [id, expected] of Object.entries(verbs)) {
            expect(command(byId.get(id) as Node)).toContain(expected);
        }
        for (const node of verbNodes().filter((entry) => entry.id !== 'freeze')) {
            expect(command(node).match(/\bkk news /g) ?? []).toHaveLength(1);
            expect(command(node)).not.toContain(';');
            // The freeze node is the design's one exception: freeze THEN report, so a report
            // failure cannot cost the frozen bundle a re-run (design §5.1 node 20).
            if (node.id !== 'freeze') expect(command(node)).not.toContain('&&');
        }
        // The freeze pair: the bundle first, the report second.
        const freeze = command(byId.get('freeze') as Node);
        expect(freeze.indexOf('--stage freeze')).toBeGreaterThan(-1);
        expect(freeze.indexOf('kk news report')).toBeGreaterThan(freeze.indexOf('--stage freeze'));
    });

    it('reads the writer skill in place and never under 20-editorial/ (design §2.2)', () => {
        const agents = doc.nodes.filter((node) => node.action?.kind === 'agent.run');
        expect(agents.map((node) => node.id)).toEqual([
            'executor-probe',
            'curate',
            'curate-fix',
            'script-write',
            'script-fix',
            'editorial-judge',
            // 0426 R1: the opt-in figure plan (scribal work, same executor var).
            'illustrations-plan',
            // 0409 R1: the translation of the reviewed article (scribal work, same executor var).
            'localize',
        ]);
        // The four writer-skill prompts cite the resolved skill directory (design §2.2: read in
        // place, no per-run copy). The judge cites its OWN skill (`kk:content-judge`), which is a
        // different skill, so it is not a `skill_dir` consumer — but no prompt may name the copy
        // directory that no longer exists.
        const writerNodes = ['curate', 'curate-fix', 'script-write', 'script-fix'];
        for (const node of agents.filter((entry) => entry.id !== 'executor-probe')) {
            const input = String(node.action?.options?.input);
            expect(input).not.toContain('20-editorial');
            expect(String(node.action?.options?.agent)).toBe(`\${vars.agent}`);
            if (writerNodes.includes(node.id)) expect(input).toContain(`\${vars.skill_dir}/SKILL.md`);
        }
        // 0409: the localize node is a translation of an already-authored article, not a mode of the
        // writer skill, so its prompt cites the artefact contract instead of `skill_dir`.
        for (const node of agents.filter((entry) => !['executor-probe', 'localize'].includes(entry.id))) {
            expect(String(node.action?.options?.input)).toContain('SKILL.md');
        }
        // 0424 R2: the two plan-authoring passes also carry the cover-scene direction, read in place
        // from the same package skill root (never a per-run copy, never the writer's own SKILL.md).
        const visualRoot = '$' + '{vars.visual_skill_root}';
        for (const id of ['script-write', 'script-fix']) {
            const input = String(byId.get(id)?.action?.options?.input);
            expect(input).toContain(`${visualRoot}/daily-news-cover/SKILL.md`);
            expect(input).toContain(`${visualRoot}/daily-news-illustrations/SKILL.md`);
            expect(input).toContain(`${visualRoot}/news-editorial/references/daily-visual-composition.md`);
        }
        // The judge reads its rubric from the same package skill root: a checkout-relative path
        // resolved against the launch cwd, not the installed package the other prompts read.
        const judge = String(byId.get('editorial-judge')?.action?.options?.input);
        expect(judge).toContain(`${visualRoot}/content-judge/references/rubrics.md`);
        expect(judge).toContain(`${visualRoot}/content-judge/SKILL.md`);
        // The two fix passes and the judge resolve above the primary's rung.
        for (const id of ['curate-fix', 'script-fix', 'editorial-judge']) {
            expect(byId.get(id)?.action?.options?.role).toBe('reviewer');
        }
    });

    it('keeps the review pause and the skip switch, and publishes nothing', () => {
        const review = byId.get('review') as Node;
        expect(review.pause).toBe(true);
        expect(review.action).toBeUndefined();
        expect(condition(review)).toContain(`"\${vars.skip_review}" != "true"`);
        // Publishing is `kk news generate --publish` after the workflow exits 0.
        expect(order).not.toContain('publish');
        for (const node of doc.nodes) {
            expect(command(node)).not.toContain('news publish');
            expect(command(node)).not.toContain('kk-publish.yaml');
        }
    });

    it('nests the safety machine pre-TTS and runs deterministic safety-variants after variants (ADR-059)', () => {
        const safetyNode = byId.get('safety') as Node;
        expect(safetyNode.action?.kind).toBe('shell');
        expect(safetyNode.dependsOn).toEqual(['render']);
        expect(command(safetyNode)).toContain('spur workflow run plugins/kk/workflows/kk-daily-safety.yaml');
        expect(command(safetyNode)).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST');

        const variantsNode = byId.get('safety-variants') as Node;
        expect(variantsNode.action?.kind).toBe('shell');
        expect(variantsNode.dependsOn).toEqual(['variants']);
        expect(command(variantsNode)).toContain('kk stage daily-safety-variants-check');
    });

    it('gates the voice chain and the card render on a failed step instead of a hard node error', () => {
        // voice3's posture: the primary and the middle attempts continue, the last one is loud.
        expect(byId.get('voice')?.action?.onError).toBe('continue');
        expect(byId.get('voice-fallback-box')?.action?.onError).toBe('continue');
        expect(byId.get('voice-fallback')?.action?.onError).toBe('continue');
        expect(byId.get('voice-fallback2')?.action?.onError).toBeUndefined();
        expect(byId.get('cards')?.action?.onError).toBe('continue');
        // 0417 R3: local voicebox precedes the cloud engines; each fallback hangs off the one before.
        expect(byId.get('voice-fallback-box')?.dependsOn).toEqual(['voice']);
        expect(byId.get('voice-fallback')?.dependsOn).toEqual(['voice-fallback-box']);
        expect(byId.get('voice-fallback2')?.dependsOn).toEqual(['voice-fallback']);
        // And each fallback only runs while no engine left a passing audio verdict.
        for (const id of ['voice-fallback-box', 'voice-fallback', 'voice-fallback2']) {
            expect(condition(byId.get(id) as Node)).toContain('"passed": true');
            expect(condition(byId.get(id) as Node)).toContain('30-audio');
        }
    });
});

describe('kk-news-generate — R7: the pool gate is the only routing token', () => {
    it('conditions every node after prepare on pool-gate.json status PASS', () => {
        for (const node of doc.nodes.filter((entry) => !['executor-probe', 'prepare'].includes(entry.id))) {
            const text = condition(node);
            expect(`${node.id}: ${text}`).toContain('pool-gate.json');
            expect(text).toContain('PASS');
        }
        // `prepare` is the node that WRITES the gate, so it cannot read it.
        expect(byId.get('prepare')?.condition).toBeUndefined();
    });

    it('carries the run identity as vars instead of reading token files back', () => {
        // R7/design §4.3: work_dir, run_date and run_id arrive from the launching verb.
        for (const node of verbNodes()) {
            expect(command(node)).toContain(`--work-dir "\${vars.work_dir}"`);
        }
        const text = readFileSync(WORKFLOW, 'utf-8');
        expect(text).not.toContain('work-dir.txt');
        expect(text).not.toContain('run-date.txt');
        expect(text).not.toContain('pool-gate.status');
    });
});
