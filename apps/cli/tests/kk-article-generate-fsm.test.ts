/**
 * Task 0368 R4/R5/R8 — `kk-article-generate.yaml` as a file contract.
 *
 * The design freeze (`docs/design/content-pipeline-consolidation.md` §5.2) names thirteen states and
 * the fate of every `kk-itc`/`kk-itc-author` state; this suite asserts the YAML matches that map
 * without executing it — `kk-article.e2e.test.ts` runs the machine, this file fails fast when a state
 * is renamed, reordered, re-wired or given a body the design forbids:
 *
 *  - R4: exactly the thirteen designed states, `executor-probe` initial, the seven vars, ONE executor
 *    var, no child workflow, no inline supervisor shell, no `kk stage` in any state;
 *  - R5: the three human pauses, the `auto` bypass, and the judge loop bounded through the verb that
 *    reads `workflows.kk-article-generate.max_revisions`;
 *  - R8: `spur workflow validate` accepts the file.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-article-generate.yaml');
const TEXT = readFileSync(WORKFLOW, 'utf-8');

interface Action {
    kind: string;
    onError?: string;
    options?: Record<string, unknown>;
}

interface State {
    id: string;
    description?: string;
    pause?: boolean;
    onEnter?: Action[];
}

interface Edge {
    from: string;
    to: string;
    terminalReason?: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface Doc {
    name: string;
    kind: string;
    initialState: string;
    terminalStates: string[];
    failureStates: string[];
    vars: Record<string, string>;
    states: State[];
    transitions: Edge[];
}

const doc = Bun.YAML.parse(TEXT) as Doc;
const byId = new Map(doc.states.map((state) => [state.id, state]));
const edge = (from: string, to: string): Edge | undefined =>
    doc.transitions.find((entry) => entry.from === from && entry.to === to);
const command = (action: Action): string => String(action.options?.command ?? '');
/** Every shell command in the file, whichever action carries it. */
const commands = (): string[] =>
    doc.states.flatMap((state) => (state.onEnter ?? []).filter((a) => a.kind === 'shell').map(command));

/** The thirteen states of design §5.2, in the design's own order. */
const DESIGN_STATES = [
    'executor-probe',
    'outline-write',
    'outline-select',
    'outline-review',
    'draft-write',
    'unslop',
    'draft-review',
    'judge',
    'illustrate',
    'adapt',
    'freeze',
    'done',
    'failed',
];

describe('kk-article-generate — R4: thirteen states, one executor var, no padding', () => {
    it('declares exactly the designed states, in order, with the probe first', () => {
        expect(doc.name).toBe('kk-article-generate');
        expect(doc.kind).toBe('state-machine');
        expect(doc.states.map((state) => state.id)).toEqual(DESIGN_STATES);
        expect(doc.initialState).toBe('executor-probe');
        expect(doc.terminalStates).toEqual(['done', 'failed']);
        expect(doc.failureStates).toEqual(['failed']);
    });

    it('has ONE executor variable, `inline` by default, and the seven designed vars', () => {
        expect(Object.keys(doc.vars).sort()).toEqual([
            '__hitlAnswer',
            'agent',
            'auto',
            'preset',
            'run_id',
            'skill_dir',
            'slug',
            'work_dir',
        ]);
        expect(doc.vars.agent).toBe('inline');
        expect(TEXT).not.toContain(`\${vars.executor}`);
        expect(TEXT).not.toContain(`\${vars.model}`);
        // Every agent action resolves through the one var; the only literals are the var's default
        // and the role-resolved retry inside the YAML file's own schema.
        const literals = [...TEXT.matchAll(/^\s+agent: (.+)$/gm)].map((match) => match[1]?.trim());
        expect(literals[0]).toBe('inline');
        for (const literal of literals.slice(1)) expect(literal).toBe(`\${vars.agent}`);
    });

    it('runs the 0360 probe first, and gives it an artifact so validation accepts the state', () => {
        const probe = byId.get('executor-probe') as State;
        const action = probe.onEnter?.[0] as Action;
        expect(action.kind).toBe('agent.run');
        expect(action.options?.role).toBe('scribe');
        expect(action.options?.agent).toBe(`\${vars.agent}`);
        expect(action.options?.timeoutMs).toBe(120000);
        expect(String(action.options?.input)).toContain('Reply with exactly: OK');
        expect(action.options?.expectFile).toBe(`\${vars.work_dir}/.executor-probe.ok`);
    });

    it('never nests a workflow, spawns a supervisor, or names a stage (R4)', () => {
        for (const state of doc.states) {
            for (const action of state.onEnter ?? []) {
                const body = `${action.kind} ${command(action)}`;
                expect(`${state.id}: ${body}`).not.toContain('kk stage');
                expect(body).not.toContain('spur workflow run');
                expect(body).not.toContain('spur workflow continue');
                expect(body).not.toContain('kk-itc-author');
                expect(body).not.toContain('trap ');
            }
        }
        expect(TEXT).not.toContain('kk stage');
        // The prose may describe the re-entry command; no ACTION may spawn one.
        expect(commands().join('\n')).not.toContain('spur workflow');
    });

    it('calls one `kk article <verb>` per deterministic state, and never jq', () => {
        for (const shell of commands()) {
            expect(shell).not.toContain('jq ');
            // At most two verb calls per state: `freeze` is the design's one pair (variants, freeze).
            expect((shell.match(/\bkk article /g) ?? []).length).toBeLessThanOrEqual(2);
        }
        expect(TEXT).not.toContain('jq ');
    });
});

describe('kk-article-generate — R5: the gates, the auto bypass and the bound', () => {
    it('pauses at the three designed human gates and nowhere else', () => {
        const paused = doc.states.filter((state) => state.pause === true).map((state) => state.id);
        expect(paused).toEqual(['outline-select', 'outline-review', 'draft-review']);
        const selectEnter = (byId.get('outline-select') as State).onEnter ?? [];
        expect((selectEnter[0] as Action).kind).toBe('hitl.select');
        const reviewEnter = (byId.get('outline-review') as State).onEnter ?? [];
        expect((reviewEnter.at(-1) as Action).kind).toBe('hitl.confirm');
        const draftEnter = (byId.get('draft-review') as State).onEnter ?? [];
        expect((draftEnter.at(-1) as Action).kind).toBe('hitl.confirm');
    });

    it('skips every pause when `auto` is on, and picks the outline instead', () => {
        // The auto path never enters a paused state …
        expect(String(edge('outline-write', 'outline-select')?.guard?.options?.command)).toContain(
            `"\${vars.auto}" != "true"`,
        );
        for (const from of ['draft-write', 'unslop']) {
            expect(String(edge(from, 'draft-review')?.guard?.options?.command)).toContain(`"\${vars.auto}" != "true"`);
        }
        // … and the pick that replaces `outline-select` is the verb, behind a one-line guard
        // expression (the engine cannot condition an action on a var).
        const write = byId.get('outline-write') as State;
        const pick = (write.onEnter ?? [])
            .filter((action) => action.kind === 'shell')
            .map(command)
            .join('\n');
        expect(pick).toContain(`test "\${vars.auto}" != "true" ||`);
        expect(pick).toContain(`kk article generate-check --work-dir "\${vars.work_dir}" --step outline`);
    });

    it('bounds the judge loop through the verb, and ends a spent budget in `failed` (R5)', () => {
        const judge = byId.get('judge') as State;
        const actions = judge.onEnter ?? [];
        // The judge agent writes the verdict file, the verb turns it into the disposition word.
        expect(actions[0]?.options?.expectFile).toBe(`\${vars.work_dir}/.itc-verdict.json`);
        expect(command(actions[1] as Action)).toContain(
            `kk article generate-check --work-dir "\${vars.work_dir}" --step judge`,
        );
        // NEEDS_REVISION returns to draft-write — the design's replacement for draft-autorevise.
        expect(String(edge('judge', 'draft-write')?.guard?.options?.command)).toContain('autorevise|revise');
        // A spent budget / FAIL is a TERMINAL failure state, not a node error.
        const failed = edge('judge', 'failed') as Edge;
        expect(failed.terminalReason).toBe('failed-check');
        expect(String(failed.guard?.options?.command)).toContain('grep -qx fail');
        // The bound itself is config-backed: the workflow never carries a number of its own.
        expect(TEXT).not.toContain('max_revisions:');
        expect(TEXT).toContain('workflows.kk-article-generate.max_revisions');
    });

    it('keeps every transition inside the machine, and every failure edge named', () => {
        const ids = new Set(doc.states.map((state) => state.id));
        for (const entry of doc.transitions) {
            expect(ids.has(entry.from)).toBe(true);
            expect(ids.has(entry.to)).toBe(true);
            if (entry.to === 'failed') expect(entry.terminalReason).toBeDefined();
        }
        // `done` is reachable, and only from the freeze.
        expect(doc.transitions.filter((entry) => entry.to === 'done').map((entry) => entry.from)).toEqual(['freeze']);
        for (const state of ['done', 'failed']) {
            expect(doc.transitions.some((entry) => entry.from === state)).toBe(false);
        }
    });
});

describe('kk-article-generate — R4: the designed state bodies', () => {
    it('reads the writer skill in place from `skill_dir` and never copies it', () => {
        const write = (byId.get('outline-write') as State).onEnter?.[0] as Action;
        const writer = String(write.options?.input);
        expect(writer).toContain(`\${vars.skill_dir}/SKILL.md`);
        expect(TEXT).not.toContain('20-editorial');
        expect(write.options?.expectFile).toBe(`\${vars.work_dir}/2-outline/outline-option-a.md`);
    });

    it('commits the outline before the draft and gates the draft on the judge', () => {
        // outline-review commits the operator pick FIRST — a paused state's enter actions are
        // skipped on resume, so the commit cannot live after the HITL action.
        const review = byId.get('outline-review') as State;
        const reviewFirst = (review.onEnter ?? [])[0] as Action;
        expect(reviewFirst.kind).toBe('shell');
        expect(command(reviewFirst)).toContain('2-outline/outline-approved.md');
        // The interactive draft gate routes through the judge, and the auto path goes straight there.
        expect(edge('draft-review', 'judge')).toBeDefined();
        expect(String(edge('draft-write', 'judge')?.guard?.options?.command)).toContain(`"\${vars.auto}" = "true"`);
        // The de-slop pass is conditional on the run's frozen options, and it re-joins the same gates.
        expect(String(edge('draft-write', 'unslop')?.guard?.options?.command)).toContain('unslop');
        expect(edge('unslop', 'judge')).toBeDefined();
    });

    it('illustrates only when a spend switch is on, then adapts and freezes in that order', () => {
        for (const entry of doc.transitions.filter((from) => from.from === 'judge')) {
            const guard = String(entry.guard?.options?.command);
            if (entry.to === 'illustrate' || entry.to === 'adapt') {
                expect(guard).toContain('coverEnabled|inlineImages');
                expect(guard).toContain('grep -qx finish');
            }
        }
        expect(edge('illustrate', 'adapt')).toBeDefined();
        expect(edge('adapt', 'freeze')).toBeDefined();
        const adapt = (byId.get('adapt') as State).onEnter ?? [];
        expect(adapt.map((action: Action) => action.kind)).toEqual(['shell', 'agent.run', 'shell']);
        expect(command(adapt[0] as Action)).toContain('--stage variants');
        expect(command(adapt[2] as Action)).toContain('--step adapt');
        // The freeze is the design's "variants then freeze" pair, in that order, and nothing else.
        const freeze = command((byId.get('freeze') as State).onEnter?.[0] as Action);
        expect(freeze.indexOf('--stage variants')).toBeGreaterThan(-1);
        expect(freeze.indexOf('--stage freeze')).toBeGreaterThan(freeze.indexOf('--stage variants'));
    });

    it('does not publish: the bundle is the product (R7)', () => {
        expect(commands().join('\n')).not.toContain('kk-publish');
        expect(commands().join('\n')).not.toContain('article publish');
        expect(doc.states.some((state) => state.id === 'publish')).toBe(false);
    });
});

describe('kk-article-generate — R8: the engine accepts the file', () => {
    it('passes `spur workflow validate`', () => {
        const result = Bun.spawnSync(['spur', 'workflow', 'validate', WORKFLOW], { stdout: 'pipe', stderr: 'pipe' });
        expect(`${result.stdout?.toString()}${result.stderr?.toString()}`).toContain('workflow valid');
        expect(result.exitCode).toBe(0);
    }, 120_000);
});
