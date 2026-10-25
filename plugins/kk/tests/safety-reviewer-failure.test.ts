import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0270 — a failed safety reviewer must reach the gate, not abort the nested run.
 *
 * The `kk-daily-safety` machine's two reviewer steps (`review`, `judge`) failed under the engine's
 * default `onError: 'fail'` policy, so a reviewer that produced nothing halted the loop at its own
 * state and the `daily-safety-gate` stage that classifies exactly that failure never ran. The bug
 * is an authored-policy gap no runtime suite observes, so this file pins the authored YAML (the
 * real files are parsed, never their strings copied) and executes the real `judge -> clean` guard
 * with fixtures — the `verdict-confidence.test.ts` pattern, extended to this machine's accept edge
 * with the confidence shapes that file leaves uncovered (non-string, empty-string, no stamp) and
 * the declaration-order routing on refusal. The stage half drives the real runner out of process
 * (same reasoning as `kk-workflow-stages.test.ts`: the stage body is a spawned runner, not a
 * library) on two prepared temp dirs to pin the gate's fail-closed classification surface.
 */

const REPO = join(import.meta.dir, '../../..');
const SAFETY_MACHINE = 'plugins/kk/workflows/kk-daily-safety.yaml';
const VOICE2 = 'plugins/kk/workflows/kk-daily-ai-voice2.yaml';
const STAGE_RUNNER = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const STAMP = '20260916';
/** The smallest VoiceScript the shipped validator accepts — the safety stages re-validate drafts. */
const MINIMAL_VOICESCRIPT = 'title: T\nsegments:\n  - text: 大家好，欢迎收听。\n';

/**
 * `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet (the same dodge
 * `verdict-confidence.test.ts` uses).
 */
const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');
const VARS_REF = /\$\{vars\.([\w.]+)\}/g;

interface EnterAction {
    kind?: string;
    onError?: string;
    options?: Record<string, unknown>;
}

interface Machine {
    vars: Record<string, string>;
    states: { id: string; onEnter: EnterAction[] }[];
    transitions: { from: string; to: string; terminalReason?: string; command: string | null }[];
}

/** Parse a state machine: states with their onEnter actions, transitions with unwrapped guards. */
function loadMachine(rel: string): Machine {
    const parsed = Bun.YAML.parse(readFileSync(join(REPO, rel), 'utf-8')) as {
        vars?: Record<string, string>;
        states?: { id?: string; onEnter?: EnterAction[] }[];
        transitions?: {
            from: string;
            to: string;
            terminalReason?: string;
            guard?: { kind?: string; options?: { command?: unknown } };
        }[];
    };
    return {
        vars: { ...(parsed.vars ?? {}) },
        states: (parsed.states ?? []).map((state) => ({ id: String(state.id ?? '?'), onEnter: state.onEnter ?? [] })),
        transitions: (parsed.transitions ?? []).map((transition) => ({
            from: transition.from,
            to: transition.to,
            terminalReason: transition.terminalReason,
            command: transition.guard?.kind === 'shell' ? String(transition.guard?.options?.command ?? '') : null,
        })),
    };
}

const machine = loadMachine(SAFETY_MACHINE);

/** Every fixture leaves with the test run — verdict/stamp files and prepared work dirs are disposable. */
const tempDirs: string[] = [];
afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/**
 * The state's PRIMARY agent.run step whose expectFile carries `expectFragment` (the reviewer pin).
 * Since 2026-10-24 a state may declare a `-retry` sibling with the SAME pin on a higher tier, so
 * the primary is the first match and the count assertion moved to the retry test below.
 */
function reviewerStep(stateId: string, expectFragment: string): EnterAction {
    const steps = (machine.states.find((state) => state.id === stateId)?.onEnter ?? []).filter(
        (action) => action.kind === 'agent.run' && String(action.options?.expectFile ?? '').includes(expectFragment),
    );
    const step = steps.at(0);
    if (step === undefined) {
        throw new Error(`${stateId}: expected an agent.run expecting ${expectFragment}, found none`);
    }
    return step;
}

/** The `-retry` sibling of {@link reviewerStep}: same pin, a different (declared) executor. */
function reviewerRetryStep(stateId: string, expectFragment: string): EnterAction {
    const steps = (machine.states.find((state) => state.id === stateId)?.onEnter ?? []).filter(
        (action) => action.kind === 'agent.run' && String(action.options?.expectFile ?? '').includes(expectFragment),
    );
    const step = steps.at(1);
    if (step === undefined) {
        throw new Error(`${stateId}: expected a retry agent.run for ${expectFragment}, found ${steps.length}`);
    }
    return step;
}

describe('kk-daily-safety reviewer steps — a failed reviewer reaches the gate, not an abort (0270)', () => {
    it('AC1: the review reviewer step carries onError continue and keeps its expectFile pin', () => {
        const review = reviewerStep('review', '_09_safety-review_report.json');
        // The fix: without this policy the engine's default 'fail' halts the loop at review and the
        // gate never runs — a reviewer failure must be classified by the gate, never an abort.
        expect(review.onError, 'a failed reviewer must reach the gate, not abort the nested run').toBe('continue');
        const expectFile = String(review.options?.expectFile);
        expect(expectFile).toContain(varRef('work_dir'));
        expect(expectFile).toContain('/24-script/');
        expect(expectFile).toContain('_09_safety-review_report.json');
        // The unconditional review -> judge edge is what then carries the run onward.
        const outbound = machine.transitions.filter((transition) => transition.from === 'review');
        expect(outbound.map((transition) => transition.to)).toEqual(['judge']);
        expect(outbound.at(0)?.command).toBeNull();
    });

    it('AC2: the judge re-check step carries the same onError continue policy with its own pin', () => {
        const judge = reviewerStep('judge', '_09_safety-judge_verdict.json');
        expect(judge.onError, 'a failed judge re-check must reach the gate in the same onEnter sequence').toBe(
            'continue',
        );
        const expectFile = String(judge.options?.expectFile);
        expect(expectFile).toContain(varRef('work_dir'));
        expect(expectFile).toContain('_09_safety-judge_verdict.json');
    });

    it('AC3: each reviewer step retries on the declared capable tier when the primary leaves no artifact (2026-10-24)', () => {
        // 2026-10-24: a scribe-rung executor failed `review` and then `judge` with no artifact, so the
        // gate scored `block` and the episode was withheld although nothing had reviewed it. The
        // machine has no back-edge for those two states, so the retry has to live in the same onEnter.
        for (const [stateId, fragment] of [
            ['review', '_09_safety-review_report.json'],
            ['judge', '_09_safety-judge_verdict.json'],
        ] as const) {
            const retry = reviewerRetryStep(stateId, fragment);
            expect(retry.onError, `${stateId}'s retry must still hand its failure to the gate`).toBe('continue');
            expect(String(retry.options?.agent), `${stateId} must retry on vars.agent_retry`).toContain(
                'vars.agent_retry',
            );
        }
        // `revise` edits the drafts in place (requireDiff), so it has no expectFile pin — match on
        // that option instead: a failed remediation spends a budget unit and re-reviews UNCHANGED
        // bytes, so it needs the same second attempt.
        const reviseAgents = (machine.states.find((state) => state.id === 'revise')?.onEnter ?? [])
            .filter((action) => action.kind === 'agent.run' && action.options?.requireDiff === true)
            .map((action) => String(action.options?.agent));
        expect(reviseAgents).toHaveLength(2);
        expect(reviseAgents.at(0)).toContain('vars.agent');
        expect(reviseAgents.at(1)).toContain('vars.agent_retry');
    });

    it('only the reviewer steps and the tolerated decide are survivable: the deterministic shells fail closed', () => {
        const actions = (stateId: string, kind: string): EnterAction[] =>
            (machine.states.find((state) => state.id === stateId)?.onEnter ?? []).filter(
                (action) => action.kind === kind,
            );
        expect(actions('review', 'shell').length, 'review declares the prep shell').toBe(1);
        // judge: gate shell, the tolerated catalog decide, then the shell that folds the tokens.
        const judgeShells = actions('judge', 'shell');
        expect(judgeShells.length).toBe(2);
        expect(String(judgeShells.at(0)?.options?.command)).toContain('daily-safety-gate');
        expect(String(judgeShells.at(1)?.options?.command)).toContain('daily-safety-verdict');
        for (const action of [...actions('review', 'shell'), ...judgeShells]) {
            expect(action.onError).toBeUndefined();
        }
        // 0317 R6: the decision tolerates its own failure; the fold then refuses the absent row.
        const decides = actions('judge', 'decide');
        expect(decides.length).toBe(1);
        expect(decides.at(0)?.onError).toBe('continue');
    });

    it('AC4: the accept edge reads the folded decision token and the judge -> block catch-all stays unconditional', () => {
        const outbound = machine.transitions.filter((transition) => transition.from === 'judge');
        // Declaration order is load-bearing: a refused verdict falls through clean and revise to block.
        expect(outbound.map((transition) => transition.to)).toEqual(['clean', 'revise', 'block']);
        const accept = outbound.at(0)?.command;
        // 0317 R6: the verdict/confidence read moved into `kk stage daily-safety-verdict`; the guard
        // is now one predicate over the token that stage writes (ADR-115).
        expect(accept).toContain('_09_safety-verdict.status');
        expect(accept).toContain('= accept');
        const block = outbound.at(2);
        expect(block?.command).toBeNull();
        expect(block?.terminalReason).toBe('failed-check');
    });

    it('AC6: the parent daily DAG keeps the safety node fail-fast (no onError) and shells the nested machine', () => {
        const parsed = Bun.YAML.parse(readFileSync(join(REPO, VOICE2), 'utf-8')) as {
            nodes?: { id?: string; action?: EnterAction }[];
        };
        const safety = (parsed.nodes ?? []).find((node) => node.id === 'safety')?.action;
        if (safety === undefined) throw new Error('kk-daily-ai-voice2 declares no safety node');
        // onError here would fail open at the DAG level: a non-zero nested exit must fail the run.
        expect(safety.onError).toBeUndefined();
        const command = String(safety.options?.command);
        expect(command).toContain('spur workflow run');
        expect(command).toContain('kk-daily-safety.yaml');
    });
});

describe('the real judge -> clean guard verifies the confidence enum on every shape (AC7)', () => {
    const acceptTransition = machine.transitions.find(
        (transition) => transition.from === 'judge' && transition.to === 'clean',
    );
    if (acceptTransition?.command == null) throw new Error('kk-daily-safety declares no shell guard judge->clean');

    /** One executed guard: whether the transition was taken, plus what the guard printed. */
    interface GuardRun {
        matched: boolean;
        stdout: string;
        stderr: string;
    }

    /**
     * Run the guard the way the engine does: substitute every `${vars.*}` from the scenario table
     * (an undeclared var is a workflow bug, not an empty string), export the same table as env
     * vars, then run the real command string. Guards own their exit code (0 = transition taken).
     */
    function executeGuard(command: string, vars: Record<string, string>, cwd: string): GuardRun {
        const templates = [...command.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1] ?? '');
        const unsupported = templates.filter((name) => !name.startsWith('vars.'));
        expect(unsupported, `${varRef('<name>')} templates the engine resolves as builtins, not shell`).toEqual([]);
        const missing = [...command.matchAll(VARS_REF)].map((match) => match[1]).filter((name) => !(name in vars));
        expect(missing, `scenario table covers every ${varRef('<name>')} in: ${command}`).toEqual([]);
        const resolved = command.replace(VARS_REF, (_all, name: string) => vars[name] ?? '');
        const result = Bun.spawnSync(['bash', '-c', resolved], {
            cwd,
            env: { ...process.env, ...vars },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        return { matched: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    }

    const matches = (command: string, vars: Record<string, string>, cwd: string): boolean =>
        executeGuard(command, vars, cwd).matched;

    /** The engine's rule: outbound guards evaluate in declaration order, first passing one wins. */
    const firstPassing = (state: string, dir: string): string | null => {
        const vars = judgeVars(dir);
        for (const transition of machine.transitions.filter((candidate) => candidate.from === state)) {
            if (transition.command === null || matches(transition.command, vars, dir)) {
                return `${transition.from}->${transition.to}`;
            }
        }
        return null;
    };

    /** The machine's own vars + the fixture work dir/run_date. */
    const judgeVars = (dir: string): Record<string, string> => ({
        ...machine.vars,
        work_dir: dir,
        run_date: STAMP,
    });

    /**
     * A work dir with the gate's classification and (optionally) its stamp, plus the
     * `kk-safety-verdict` row the judge state leaves behind — then the real fold stage. `decision:
     * null` stands for a decide action the engine tolerated away, which leaves no row at all.
     */
    function judgeFixture(status: string, decision: string | null, stamp = true): { dir: string; stderr: string } {
        const dir = tempDir('kk-0270-judge-');
        const scriptDir = join(dir, '24-script');
        mkdirSync(scriptDir, { recursive: true });
        writeFileSync(join(scriptDir, `${STAMP}_09_safety-judge_status.txt`), status);
        if (stamp) {
            writeFileSync(
                join(scriptDir, `${STAMP}_09_safety-judge_stamp.json`),
                JSON.stringify({ digest: 'stub', status, excludedPlatforms: [] }),
            );
        }
        if (decision !== null) {
            writeFileSync(
                join(scriptDir, `${STAMP}_09_safety-verdict.decision`),
                JSON.stringify({ value: decision, method: 'choice', degraded: false, source: 'model' }),
            );
        }
        // The real fold: `kk stage daily-safety-verdict` owns both the token and the refusal text.
        const fold = spawnSync('bun', [STAGE_RUNNER, 'daily-safety-verdict', dir, STAMP], { encoding: 'utf-8' });
        if (fold.status !== 0) throw new Error(`daily-safety-verdict failed: ${fold.stderr}`);
        return { dir, stderr: fold.stderr };
    }

    it.each([
        ['a gate pass the decision confirms', 'pass', 'pass'],
        ['a human escalation the decision confirms', 'escalate', 'escalate'],
        ['an admission-only exclusion the decision confirms', 'exclude', 'exclude'],
    ])('%s is admitted: the guard matches and clean is the first passing edge', (_name, status, decision) => {
        const { dir, stderr } = judgeFixture(status, decision);
        const run = executeGuard(acceptTransition.command ?? '', judgeVars(dir), dir);
        expect(run.matched, stderr).toBe(true);
        expect(stderr).toBe('');
        expect(firstPassing('judge', dir)).toBe('judge->clean');
    });

    it.each([
        ['a decide action the engine tolerated away (no row)', 'pass', null, 'decision-refused'],
        ['a decision outside the admitted vocabulary', 'pass', 'block', 'decision-refused'],
        ['a gate block the decision cannot overrule', 'block', 'pass', 'verdict-refused'],
        ['a gate revise the decision cannot overrule', 'revise', 'pass', 'verdict-refused'],
        ['a missing gate stamp', 'pass', 'pass', 'verdict-refused'],
    ])('%s is refused by name and block is the first passing edge', (_name, status, decision, refusal) => {
        const { dir, stderr } = judgeFixture(status, decision, _name !== 'a missing gate stamp');
        const run = executeGuard(acceptTransition.command ?? '', judgeVars(dir), dir);
        expect(run.matched, run.stdout).toBe(false);
        expect(stderr).toContain(`kk-daily-safety.judge.${refusal}`);
        // Fail-closed without deadlock: the refusal falls through to the unconditional block edge.
        expect(firstPassing('judge', dir)).toBe('judge->block');
    });
});

describe('the gate classifies a reviewer failure fail-closed (AC3, AC4)', () => {
    const OK_REPORT = { platforms: [{ platform: 'xiaoyuzhou', decision: 'OK', findings: [] }], escalate: false };
    const PASS_VERDICT = { verdict: 'PASS', rubric: 'compliance', score: 0.95, confidence: 'HIGH' };
    const at = (dir: string, name: string) => join(dir, '24-script', `${STAMP}_09_${name}`);

    function runStage(args: string[]) {
        return spawnSync('bun', [STAGE_RUNNER, ...args], { encoding: 'utf-8', env: { ...process.env } });
    }

    /** Drafts + prep (writes the digest request the gate checks); the agent outputs are the test's. */
    function setupSafetyDir(report?: unknown, verdict?: unknown): string {
        const dir = tempDir('kk-0270-safety-');
        for (const sub of ['22-article', '24-script']) mkdirSync(join(dir, sub), { recursive: true });
        writeFileSync(
            join(dir, '22-article', `${STAMP}_06_article_content.json`),
            JSON.stringify({ title: 'T', body: 'B' }),
        );
        writeFileSync(join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`), MINIMAL_VOICESCRIPT);
        const prep = runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']);
        if (prep.status !== 0) throw new Error(`daily-safety-prep failed: ${prep.stderr}`);
        if (report !== undefined) writeFileSync(at(dir, 'safety-review_report.json'), JSON.stringify(report));
        if (verdict !== undefined) writeFileSync(at(dir, 'safety-judge_verdict.json'), JSON.stringify(verdict));
        return dir;
    }

    it('AC3: a missing report (the reviewer produced nothing) → block, no stamp, reason line, quarantine', () => {
        const dir = setupSafetyDir(undefined, PASS_VERDICT);
        const result = runStage(['daily-safety-gate', dir, STAMP]);
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('block');
        expect(existsSync(at(dir, 'safety-judge_stamp.json'))).toBe(false);
        expect(result.stdout).toContain('content-safety report missing or malformed');
        // The block-only quarantine: a same-day retry must not replay on the poisoned drafts.
        const quarantine = join(dir, '24-script', `.quarantine-${STAMP}-judge-block`);
        expect(existsSync(join(quarantine, `${STAMP}_06_article_content.json`))).toBe(true);
        expect(existsSync(join(quarantine, `${STAMP}_08_script_voicescript.yaml`))).toBe(true);
    });

    it('AC4: a missing verdict (the judge re-check produced nothing) → block naming the verdict and the enum', () => {
        const dir = setupSafetyDir(OK_REPORT, undefined);
        const result = runStage(['daily-safety-gate', dir, STAMP]);
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(at(dir, 'safety-judge_status.txt'), 'utf-8')).toBe('block');
        expect(existsSync(at(dir, 'safety-judge_stamp.json'))).toBe(false);
        expect(result.stdout).toContain('verdict missing');
        expect(result.stdout).toContain('HIGH/MEDIUM/LOW');
    });
});
