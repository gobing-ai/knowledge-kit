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
    // 0409 R1: the en/ja translations of the reviewed article, gated before the freeze so the
    // variants review and the freeze digest cover exactly the bytes that publish.
    'localize',
    'localize-check',
    'voice',
    'voice-fallback-box',
    'voice-fallback',
    'voice-fallback2',
    'cards',
    'variants',
    'safety-variants',
    'freeze',
];

/** Shell nodes that are NOT nested workflow calls: the ones R2 constrains to one verb call. */
const verbNodes = (): Node[] =>
    doc.nodes.filter(
        (node) =>
            node.pause !== true &&
            node.action?.kind === 'shell' &&
            !command(node).includes('spur workflow run') &&
            // 0409: the localize gate is the one shell node that is a `kk stage` call, not a verb.
            node.id !== 'localize-check',
    );

describe('kk-news-generate — AC1: twenty nodes, one executor variable, no padding', () => {
    it('declares exactly the designed node ids, in topological order', () => {
        expect(doc.name).toBe('kk-news-generate');
        expect(doc.kind).toBe('dag');
        // 23 since 0417: the twenty design nodes plus `localize` + its deterministic gate, and the
        // `voice-fallback-box` attempt that puts the local Voicebox renderer before the cloud engines.
        expect(doc.nodes).toHaveLength(23);
        expect(order).toEqual(DESIGN_NODES);
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

    it('has ONE executor variable and the seven designed vars (ADR-053 §5, R7)', () => {
        expect(Object.keys(doc.vars).sort()).toEqual([
            'agent',
            'preset',
            'run_date',
            'run_id',
            'skill_dir',
            'skip_review',
            'work_dir',
        ]);
        // `agent` is the only executor switch: `inline` by default, and no node pins a model, an
        // executor roster entry or a second agent var.
        expect(doc.vars.agent).toBe('inline');
        const text = readFileSync(WORKFLOW, 'utf-8');
        expect(text).not.toContain(`\${vars.executor}`);
        expect(text).not.toContain(`\${vars.model}`);
        // Every agent node resolves through the one var; the only literal is the var's own default.
        const literalAgents = [...text.matchAll(/agent: (.+)/g)].map((match) => match[1]?.trim());
        expect(literalAgents).toEqual(['inline', ...Array(7).fill(`\${vars.agent}`)]);
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
        for (const node of doc.nodes.filter((entry) => entry.id !== 'localize-check')) {
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

    it('nests the safety machine twice: drafts after render, variants after variants', () => {
        for (const [id, dep, extra] of [
            ['safety', 'render', ''],
            ['safety-variants', 'variants', '\\"safety_scope_dir\\":\\"4-safety-variants\\"'],
        ] as const) {
            const node = byId.get(id) as Node;
            expect(node.action?.kind).toBe('shell');
            expect(node.dependsOn).toEqual([dep]);
            expect(command(node)).toContain('spur workflow run plugins/kk/workflows/kk-daily-safety.yaml');
            expect(command(node)).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST');
            if (extra !== '') expect(command(node)).toContain(extra);
        }
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
