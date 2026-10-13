import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Judge-verdict confidence contract (20261003).
 *
 * `kk:content-judge` promises `confidence: HIGH | MEDIUM | LOW` on every verdict, and the
 * `daily-safety-gate` stage enforces it (`plugins/kk/tests/kk-workflow-stages.test.ts`, 0189 R10).
 * The remaining consumers are spur workflow guards, whose `jq` verdict read must not accept a
 * PASS that carries a missing or out-of-enum confidence.
 *
 * This file executes the REAL guard strings extracted from the workflow YAML (no duplicated guard
 * logic) with fixture verdict files, and asserts the routing outcome for each verdict × var
 * combination — including that a contract-violating verdict still leaves the judge state (fail
 * closed, never deadlock). It also scans every workflow that reads a judge verdict so a future
 * consumer cannot silently skip the check, and finishes by emitting a repeatable artifact at
 * `.spur/run/verdict-confidence/summary.json`.
 *
 * The `kk-collect` half (G31 R14) is the same seam one step downstream: `kk store label` emits the
 * pass verdict whose level the workflow's `label` guard reads, so the fixture verdicts there are the
 * label-result lines the emitter prints and the consumer is that guard — a missing or out-of-enum
 * level is refused by name instead of being read as a pass.
 *
 * The PRODUCER half is verified too, because a consumer that enforces an enum nobody emits is just a
 * gate that blocks every run (2026-10-04: three daily runs failed closed at `safety-judge`): the
 * `kk:content-judge` skill must keep declaring the enum and what each level means, its reference
 * snippet must carry the same confidence-aware filter as the guards (anti-drift across the
 * producer→consumer seam), and every `agent.run` that writes a verdict must name that contract.
 */

const REPO = join(import.meta.dir, '../../..');
const WORKFLOWS = join(REPO, 'plugins/kk/workflows');

const ITC = 'plugins/kk/workflows/kk-itc.yaml';
const EXAMPLE = 'plugins/kk/workflows/judge-gated-publish-example.yaml';
const COLLECT = 'plugins/kk/workflows/kk-collect.yaml';
/** The live daily DAG, and the nested machine its `safety` node shells out (20261012). */
const VOICE2 = 'plugins/kk/workflows/kk-daily-ai-voice2.yaml';
const SAFETY_MACHINE = 'plugins/kk/workflows/kk-daily-safety.yaml';
const SKILL = 'plugins/kk/skills/content-judge/SKILL.md';
const SKILL_REFERENCE = 'plugins/kk/skills/content-judge/references/workflow-integration.md';
const SAFETY_SKILL = 'plugins/kk/skills/content-safety/SKILL.md';
const LABEL_EMITTER = 'apps/cli/src/commands/store.ts';

/**
 * The one confidence-aware verdict read. Every workflow guard and the skill's reference snippet must
 * carry it byte-identically: a `PASS` with a missing/out-of-enum `confidence` becomes `PASS!`, which
 * no accept guard matches. The `kk-collect` label guard is the newest reader of the same filter, so
 * the label pass's own verdict is held to the contract its judge siblings already enforce.
 */
const CONFIDENCE_JQ_FILTER =
    'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end';

/** Recorded check outcomes, aggregated into the artifact by the final test. */
const checks: { id: string; ok: boolean; detail: string }[] = [];
const record = (id: string, ok: boolean, detail = ''): boolean => {
    checks.push({ id, ok, detail });
    return ok;
};

interface RawTransition {
    from: string;
    to: string;
    description?: string;
    guard?: { kind?: string; options?: { command?: unknown } };
}

interface Workflow {
    rel: string;
    vars: Record<string, string>;
    transitions: { from: string; to: string; description: string; command: string | null }[];
}

/**
 * `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet (the same dodge
 * the itc workflow tests use).
 */
const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

const VARS_REF = /\$\{vars\.([\w.]+)\}/g;

/** Parse a workflow and unwrap each transition's guard command (`null` = a non-shell guard). */
function load(rel: string): Workflow {
    const parsed = Bun.YAML.parse(readFileSync(join(REPO, rel), 'utf-8')) as {
        vars?: Record<string, string>;
        transitions?: RawTransition[];
    };
    return {
        rel,
        vars: { ...(parsed.vars ?? {}) },
        // A `kind: dag` workflow has no top-level transitions (task 0211) — and today carries no
        // `jq -r .*verdict` guards either, so an empty list scans it correctly. If the DAG ever
        // grows verdict guards inside node conditions, teach load() to unwrap nodes instead.
        transitions: (parsed.transitions ?? []).map((t) => ({
            from: t.from,
            to: t.to,
            description: t.description ?? '',
            command: t.guard?.kind === 'shell' ? String(t.guard?.options?.command ?? '') : null,
        })),
    };
}

/** One executed guard: whether the transition was taken, plus what the guard printed. */
interface GuardRun {
    matched: boolean;
    stdout: string;
    stderr: string;
}

/**
 * Run one guard the way the engine does: substitute every `${vars.*}` from the scenario table,
 * export the same table as env vars (the engine also exports vars, which is how the example's
 * `$attempt` reads resolve), then run the real command string. Guards own their exit code
 * (0 = transition taken), so they need no `echo`/exit convention. Every referenced `${vars.*}` must
 * be in the table — an undeclared var is a workflow bug, not an empty string.
 *
 * A `${…}` the engine does not resolve from `vars` is a BUILTIN reference to it, not shell syntax
 * (`${v:-<none>}` fails the run with `Workflow builtin "v:-<none>" is not defined`). This helper
 * substitutes only `${vars.*}`, so it would hand such a template to bash and pass where the engine
 * fails — hence the assertion: extend this helper before using another template shape, do not let
 * the harness silently out-run the engine.
 */
function executeGuard(command: string, vars: Record<string, string>, cwd: string): GuardRun {
    const templates = [...command.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    const unsupported = templates.filter((name) => !name.startsWith('vars.'));
    expect(unsupported, `${varRef('<name>')} templates the engine resolves as builtins, not shell`).toEqual([]);
    const missing = [...command.matchAll(VARS_REF)].map((m) => m[1]).filter((name) => !(name in vars));
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

/** Whether the guard's command string is taken in this scenario (exit code 0). */
function matches(command: string, vars: Record<string, string>, cwd: string): boolean {
    return executeGuard(command, vars, cwd).matched;
}

/**
 * The transitions leaving `state` that this scenario satisfies. Each state's guards are disjoint by
 * construction, so a fail-closed refusal must still leave exactly one — the caller asserts that.
 */ function route(workflow: Workflow, state: string, vars: Record<string, string>, cwd: string): string[] {
    return workflow.transitions
        .filter((t) => t.from === state)
        .filter((t) => (t.command === null ? true : matches(t.command, vars, cwd)))
        .map((t) => `${t.from}->${t.to}`);
}

/** Write one judge verdict fixture into `dir` and return its path. */
function scenarioVerdict(dir: string, verdict: unknown): string {
    const path = join(dir, '.itc-verdict.json');
    writeFileSync(path, typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
    return path;
}

/**
 * Write one `kk store label` verdict line (the `label-result.txt` the workflow's label state
 * produces) into `dir` and return its path. A `null` payload writes an EMPTY file, which is what a
 * label pass that failed before printing leaves behind.
 */
function scenarioLabelResult(dir: string, payload: Record<string, unknown> | string | null): string {
    const path = join(dir, 'label-result.txt');
    if (payload === null) writeFileSync(path, '');
    else writeFileSync(path, typeof payload === 'string' ? payload : JSON.stringify(payload));
    return path;
}

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

/** Every fixture leaves with the test run — verdict files are disposable evidence. */
const tempDirs: string[] = [];
afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('kk-itc judge verdict → confidence routing', () => {
    const itc = load(ITC);

    /** The workflow's own var defaults + the fixture work dir (vars are templated or env-exported). */
    const itcVariables = (dir: string, extra: Record<string, string> = {}): Record<string, string> => ({
        ...itc.vars,
        auto: 'false',
        judge: 'true',
        work_dir: dir,
        ...extra,
    });

    it.each([
        ['PASS + HIGH', { verdict: 'PASS', confidence: 'HIGH' }, ['judge->done']],
        ['PASS + MEDIUM', { verdict: 'PASS', confidence: 'MEDIUM' }, ['judge->done']],
        ['PASS + LOW', { verdict: 'PASS', confidence: 'LOW' }, ['judge->done']],
        // The contract violation fails the run through the out-of-contract catch-all.
        ['PASS without confidence', { verdict: 'PASS' }, ['judge->failed']],
        ['PASS + out-of-enum confidence', { verdict: 'PASS', confidence: 'SURE' }, ['judge->failed']],
        ['PASS + lowercase confidence', { verdict: 'PASS', confidence: 'high' }, ['judge->failed']],
        ['FAIL', { verdict: 'FAIL' }, ['judge->failed']],
        ['NEEDS_REVISION with budget left', { verdict: 'NEEDS_REVISION' }, ['judge->draft-revise']],
    ])('%s routes exactly one transition', (name, verdict, expected) => {
        const dir = tempDir('kk-itc-confidence-');
        scenarioVerdict(dir, verdict);
        const taken = route(itc, 'judge', itcVariables(dir), dir);
        expect(record(`itc:${name}`, JSON.stringify(taken) === JSON.stringify(expected), taken.join(','))).toBe(true);
        expect(taken).toEqual(expected);
    });

    it('a contract-violating PASS never reaches done or publish-entry with targets set', () => {
        const dir = tempDir('kk-itc-confidence-publish-');
        const verdict = scenarioVerdict(dir, { verdict: 'PASS', confidence: 'SURE' });
        const taken = route(itc, 'judge', itcVariables(dir, { publish_targets: 'qiita-pub' }), dir);
        expect(record('itc:invalid-pass-blocks-publish', taken.join(',') === 'judge->failed', taken.join(','))).toBe(
            true,
        );
        expect(taken).not.toContain('judge->publish-entry');
        expect(readFileSync(verdict, 'utf-8')).toContain('SURE'); // the evidence is never rewritten
    });

    it('auto mode keeps a valid PASS and a plain FAIL on their existing routes', () => {
        const passDir = tempDir('kk-itc-confidence-auto-pass-');
        scenarioVerdict(passDir, { verdict: 'PASS', confidence: 'HIGH' });
        expect(route(itc, 'judge', itcVariables(passDir, { auto: 'true' }), passDir)).toEqual(['judge->report']);

        const failDir = tempDir('kk-itc-confidence-auto-fail-');
        scenarioVerdict(failDir, { verdict: 'FAIL' });
        const failTaken = route(itc, 'judge', itcVariables(failDir, { auto: 'true' }), failDir);
        expect(record('itc:auto-fail-unchanged', failTaken.join(',') === 'judge->report', failTaken.join(','))).toBe(
            true,
        );
        expect(failTaken).toEqual(['judge->report']);

        const invalidDir = tempDir('kk-itc-confidence-auto-invalid-');
        scenarioVerdict(invalidDir, { verdict: 'PASS', confidence: 'SURE' });
        expect(route(itc, 'judge', itcVariables(invalidDir, { auto: 'true' }), invalidDir)).toEqual(['judge->failed']);
    });

    it('the dry-run convention is preserved: an absent verdict file still routes interactive PASS onward', () => {
        const dir = tempDir('kk-itc-confidence-dryrun-');
        const taken = route(itc, 'judge', itcVariables(dir), dir);
        expect(record('itc:dry-run-empty-verdict', taken.join(',') === 'judge->done', taken.join(','))).toBe(true);
        expect(taken).toEqual(['judge->done']);
    });
});

describe('judge-gated-publish-example verdict → confidence routing', () => {
    const example = load(EXAMPLE);

    const exampleVariables = (verdictFile: string, extra: Record<string, string> = {}): Record<string, string> => ({
        ...example.vars,
        verdictFile,
        attempt: '0',
        ...extra,
    });

    it.each([
        ['PASS + HIGH', { verdict: 'PASS', confidence: 'HIGH' }, ['judge->publish']],
        ['PASS + LOW', { verdict: 'PASS', confidence: 'LOW' }, ['judge->publish']],
        ['PASS without confidence', { verdict: 'PASS' }, ['judge->failed']],
        ['PASS + out-of-enum confidence', { verdict: 'PASS', confidence: 'SURE' }, ['judge->failed']],
        ['FAIL', { verdict: 'FAIL' }, ['judge->failed']],
        ['NEEDS_REVISION with budget left', { verdict: 'NEEDS_REVISION' }, ['judge->generate']],
        ['NEEDS_REVISION with budget exhausted', { verdict: 'NEEDS_REVISION' }, ['judge->failed'], { attempt: '2' }],
    ])('%s routes exactly one transition', (name, verdict, expected, extra = {}) => {
        const dir = tempDir('kk-example-confidence-');
        const path = scenarioVerdict(dir, verdict);
        const taken = route(example, 'judge', exampleVariables(path, extra as Record<string, string>), dir);
        expect(record(`example:${name}`, JSON.stringify(taken) === JSON.stringify(expected), taken.join(','))).toBe(
            true,
        );
        expect(taken).toEqual(expected);
    });

    it('the seeded dry-run verdict carries a confidence value', () => {
        // The seed keeps the guards evaluable under --dry-run, so it must satisfy the same contract.
        const parsed = Bun.YAML.parse(readFileSync(join(REPO, EXAMPLE), 'utf-8')) as {
            states: { id: string; onEnter?: { kind?: string; options?: { command?: string } }[] }[];
        };
        const seed = parsed.states
            .find((state) => state.id === 'generate')
            ?.onEnter?.find((action) => action.kind === 'shell')?.options?.command;
        const seeded = (seed ?? '').match(/echo '(\{.*\})'/)?.[1] ?? '';
        expect(record('example:seed-has-confidence', seeded.includes('"confidence":"HIGH"'), seeded)).toBe(true);
        expect(JSON.parse(seeded)).toMatchObject({ verdict: 'PASS', confidence: 'HIGH' });
    });

    it('an absent verdict file still walks the dry-run path (file-absent fail-open is unchanged)', () => {
        const dir = tempDir('kk-example-confidence-dryrun-');
        expect(route(example, 'judge', exampleVariables(join(dir, 'absent.json')), dir)).toEqual(['judge->publish']);
    });
});

describe('kk-collect label verdict → confidence routing', () => {
    const collect = load(COLLECT);

    /** The workflow's own var defaults + the fixture work dir (the only var its guards read). */
    const collectVariables = (dir: string): Record<string, string> => ({ ...collect.vars, work_dir: dir });

    /**
     * The engine's own rule (`ts-dual-workflow-engine` state-machine.js): outbound guards are
     * evaluated in declaration order and the first passing one wins, an unguarded transition being
     * unconditional. Modelling THAT — not "which guards are satisfied" — is what makes the
     * no-deadlock assertion meaningful: `label -> release-failed` is unconditional, so a refused
     * verdict still leaves the state instead of stranding the run.
     */
    const firstPassing = (state: string, vars: Record<string, string>, cwd: string): string | null => {
        for (const transition of collect.transitions.filter((t) => t.from === state)) {
            if (transition.command === null || matches(transition.command, vars, cwd)) {
                return `${transition.from}->${transition.to}`;
            }
        }
        return null;
    };

    /** The REAL `label -> <to>` guard command string, read out of the workflow (never copied). */
    const labelGuard = (to: string): string => {
        const transition = collect.transitions.find((t) => t.from === 'label' && t.to === to && t.command !== null);
        if (transition?.command == null) throw new Error(`kk-collect declares no shell guard label->${to}`);
        return transition.command;
    };

    it('the emitter is the verdict producer: it prints a PASS line with one level per row', () => {
        const emitter = readFileSync(join(REPO, LABEL_EMITTER), 'utf-8');
        const emitsVerdict = /verdict: 'PASS'/.test(emitter);
        const derivesLevels = /labelConfidence\(/.test(emitter) && /verdictConfidence\(/.test(emitter);
        expect(
            record(
                'kk-collect:producer-emits-one-level',
                emitsVerdict && derivesLevels,
                `${LABEL_EMITTER}: verdict line=${emitsVerdict}, level derivation=${derivesLevels}`,
            ),
        ).toBe(true);
        expect(emitsVerdict).toBe(true);
        expect(derivesLevels).toBe(true);
    });

    it.each([
        ['PASS + HIGH', { verdict: 'PASS', confidence: 'HIGH', labeled: 10, model: 10, fallback: 0 }, 'label->release'],
        [
            'PASS + MEDIUM',
            { verdict: 'PASS', confidence: 'MEDIUM', labeled: 10, model: 5, fallback: 0 },
            'label->release',
        ],
        [
            'PASS + LOW (heuristic or degraded rows)',
            { verdict: 'PASS', confidence: 'LOW', labeled: 5, model: 0, fallback: 5 },
            'label->release',
        ],
        [
            'PASS without a confidence field',
            { verdict: 'PASS', labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        [
            'PASS with a null confidence',
            { verdict: 'PASS', confidence: null, labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        [
            'PASS + out-of-enum confidence',
            { verdict: 'PASS', confidence: 'SURE', labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        [
            'PASS + lowercase confidence',
            { verdict: 'PASS', confidence: 'high', labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        [
            'PASS + numeric confidence',
            { verdict: 'PASS', confidence: 1, labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        [
            'PASS + empty-string confidence',
            { verdict: 'PASS', confidence: '', labeled: 5, model: 5, fallback: 0 },
            'label->release-failed',
        ],
        ['a label result with no verdict field', { labeled: 0, model: 0, fallback: 0 }, 'label->release-failed'],
        ['an empty label-result file (the pass failed before printing)', null, 'label->release-failed'],
        [
            'a FAIL verdict',
            { verdict: 'FAIL', confidence: 'HIGH', labeled: 0, model: 0, fallback: 0 },
            'label->release-failed',
        ],
    ])('%s leaves the label state on exactly one edge', (name, payload, expected) => {
        const dir = tempDir('kk-collect-label-');
        scenarioLabelResult(dir, payload);
        const taken = firstPassing('label', collectVariables(dir), dir);
        expect(record(`kk-collect:${name}`, taken === expected, String(taken))).toBe(true);
        expect(taken).toBe(expected);
    });

    it('names the offending value in the refusal and stays fail-closed, never deadlocked', () => {
        const dir = tempDir('kk-collect-label-refusal-');
        scenarioLabelResult(dir, { verdict: 'PASS', confidence: 'SURE', labeled: 5, model: 5, fallback: 0 });
        const outOfEnum = executeGuard(labelGuard('release'), collectVariables(dir), dir);
        expect(
            record(
                'kk-collect:refusal-names-out-of-enum',
                !outOfEnum.matched && /confidence-refused/.test(outOfEnum.stderr) && outOfEnum.stderr.includes('SURE'),
                outOfEnum.stderr.trim(),
            ),
        ).toBe(true);
        expect(outOfEnum.matched).toBe(false);
        expect(outOfEnum.stderr).toContain('kk-collect.label.confidence-refused');
        expect(outOfEnum.stderr).toContain('SURE');

        const missingDir = tempDir('kk-collect-label-missing-');
        scenarioLabelResult(missingDir, { verdict: 'PASS', labeled: 5, model: 5, fallback: 0 });
        const missing = executeGuard(labelGuard('release'), collectVariables(missingDir), missingDir);
        expect(
            record(
                'kk-collect:refusal-names-missing',
                !missing.matched && missing.stderr.includes('HIGH|MEDIUM|LOW') && missing.stderr.includes('<absent>'),
                missing.stderr.trim(),
            ),
        ).toBe(true);
        expect(missing.stderr).toContain('<absent>');

        // Fail-closed WITHOUT deadlock: the unconditional `label -> release-failed` still fires.
        expect(firstPassing('label', collectVariables(dir), dir)).toBe('label->release-failed');
    });

    it('a valid verdict is the only thing that reaches release (the refusal is not vacuous)', () => {
        const dir = tempDir('kk-collect-label-valid-');
        scenarioLabelResult(dir, { verdict: 'PASS', confidence: 'LOW', labeled: 1, model: 0, fallback: 1 });
        const accepted = executeGuard(labelGuard('release'), collectVariables(dir), dir);
        expect(record('kk-collect:valid-low-accepted', accepted.matched, accepted.stderr.trim())).toBe(true);
        expect(accepted.matched).toBe(true);
        expect(accepted.stderr).toBe('');
    });

    it('the label state keeps a shell guard for the scan to read (no silent parser gap)', () => {
        // The consumer scans above read `command` off the parsed transitions; a label guard that
        // stopped being a shell command would make every kk-collect check in this file vacuous.
        const label = collect.transitions.filter((t) => t.from === 'label');
        const shell = label.filter((t) => t.command !== null);
        const unconditional = label.filter((t) => t.command === null);
        // The guard reads its file through shell vars, never `${…}` (a non-`vars.*` template is a
        // builtin reference to the engine and fails the whole run).
        const templates = [...labelGuard('release').matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] ?? '');
        const ok = shell.length === 1 && unconditional.length === 1 && templates.every((n) => n.startsWith('vars.'));
        expect(
            record(
                'parser:kk-collect.label',
                ok,
                `${shell.length} shell / ${unconditional.length} always; templates: ${templates.join(',')}`,
            ),
        ).toBe(true);
        expect(ok).toBe(true);
    });
});

describe('every judge-verdict consumer verifies confidence', () => {
    const workflowFiles = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yaml'));
    const workflows = workflowFiles.map((name) => load(join('plugins/kk/workflows', name)));

    /** A guard "accepts PASS" when it matches `= PASS` but is not the `!= PASS` rejection form. */
    const acceptsPass = (command: string): boolean => /= PASS/.test(command) && !/!= PASS/.test(command);

    const verdictGuards = (workflow: Workflow) =>
        workflow.transitions.filter((t) => t.command !== null && /jq -r .*verdict/.test(t.command));

    it.each(workflows.map((workflow) => [workflow.rel, workflow] as const))(
        '%s — every PASS-accepting verdict guard checks the confidence enum',
        (rel, workflow) => {
            const guards = verdictGuards(workflow);
            const offenders = guards
                .filter((t) => acceptsPass(t.command ?? ''))
                .filter((t) => !/confidence/.test(t.command ?? ''))
                .map((t) => `${t.from}->${t.to}`);
            const detail = `${guards.length} verdict guards, ${offenders.length} without a confidence check`;
            expect(record(`consumer-scan:${rel}`, offenders.length === 0, offenders.join(',') || detail)).toBe(true);
            expect(offenders).toEqual([]);
        },
    );

    it('every confidence-aware guard resolves the verdict through the same jq filter', () => {
        // Five copies of the filter exist (three itc accept guards + its catch-all + the example's).
        // Anti-drift: they must stay byte-identical, so a fix in one place cannot silently miss the others.
        const filters = new Set(
            workflows.flatMap((workflow) =>
                verdictGuards(workflow)
                    .filter((t) => /confidence/.test(t.command ?? ''))
                    .map((t) => (t.command ?? '').match(/jq -r '([^']*)'/)?.[1] ?? '<unparsed>'),
            ),
        );
        expect(record('consumer-scan:single-jq-filter', filters.size === 1, [...filters].join(' | '))).toBe(true);
        expect(filters.size).toBe(1);
        expect([...filters][0]).toBe(CONFIDENCE_JQ_FILTER);
    });

    it('the stage-level consumer (daily-safety-gate) also enforces it', () => {
        // R7 (0211): the daily stage bodies moved to the lazy sibling — scan the concatenation.
        const stages =
            readFileSync(join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts'), 'utf-8') +
            readFileSync(join(REPO, 'plugins/kk/scripts/daily-stages.ts'), 'utf-8');
        const gate = stages.slice(stages.indexOf('function dailySafetyGate'));
        // 20261005: the gate names the whole enum (a positive allow-list); match either polarity so
        // the scan checks the contract — every level present — not one spelling of it.
        const ok = ['HIGH', 'MEDIUM', 'LOW'].every((level) =>
            new RegExp(`confidence (===|!==|includes\\() ?'?${level}`).test(gate),
        );
        expect(record('consumer-scan:kk-workflow-stages.dailySafetyGate', ok)).toBe(true);
        expect(ok).toBe(true);
    });

    /** Source files (never tests) that read a judge verdict artifact. */
    const tsVerdictReaders = (): string[] => {
        const files: string[] = [];
        const walk = (rel: string): void => {
            for (const entry of readdirSync(join(REPO, rel), { withFileTypes: true })) {
                const child = `${rel}/${entry.name}`;
                if (entry.isDirectory()) walk(child);
                else if (entry.name.endsWith('.ts')) files.push(child);
            }
        };
        for (const root of ['plugins/kk/scripts', 'apps/cli/src']) walk(root);
        return files.filter((rel) => /verdict\.json/.test(readFileSync(join(REPO, rel), 'utf-8')));
    };

    it('every TS verdict reader handles the confidence enum', () => {
        const readers = tsVerdictReaders();
        const offenders = readers.filter((rel) => !/confidence/.test(readFileSync(join(REPO, rel), 'utf-8')));
        const detail = `${readers.length} readers, offenders: ${offenders.join(',') || 'none'}`;
        expect(record('consumer-scan:ts-verdict-readers', offenders.length === 0, detail)).toBe(true);
        expect(offenders).toEqual([]);
        // Non-vacuous: the daily gate and the itc report are both readers today.
        expect(readers.length).toBeGreaterThanOrEqual(2);
    });

    it('the judge-state guards are the ones the scan covers (no silent parser gap)', () => {
        // Guard the parser: a judge state whose transitions lost their command would make the
        // consumer scan above vacuous.
        for (const workflow of [load(ITC), load(EXAMPLE)]) {
            const judge = workflow.transitions.filter((t) => t.from === 'judge');
            const extracted = judge.filter((t) => t.command !== null).length;
            const ok = judge.length > 0 && extracted === judge.length;
            expect(record(`parser:${workflow.rel}`, ok, `${extracted}/${judge.length}`)).toBe(true);
            expect(ok).toBe(true);
        }
    });
});

describe('every judge-verdict producer declares the confidence contract', () => {
    const skill = readFileSync(join(REPO, SKILL), 'utf-8');

    it('the judge skill states the confidence enum and defines every level', () => {
        const enumLine = /"confidence"\s*:\s*"HIGH\s*\|\s*MEDIUM\s*\|\s*LOW"/.test(skill);
        const levels = ['HIGH', 'MEDIUM', 'LOW'].filter((level) => skill.includes(`- \`${level}\``));
        const ok = enumLine && levels.length === 3;
        expect(
            record('producer:skill-confidence-enum', ok, `enum line=${enumLine}, levels=${levels.join(',') || 'none'}`),
        ).toBe(true);
        expect(ok).toBe(true);
    });

    it('the skill reference snippet carries the same confidence-aware filter as the guards', () => {
        // The skill TEACHES the consumer read; a drifted snippet would have operators wire a gate
        // that accepts a PASS the stages refuse.
        const snippet = readFileSync(join(REPO, SKILL_REFERENCE), 'utf-8').match(/jq -r '([^']*)'/)?.[1] ?? '';
        expect(
            record(
                'producer:skill-reference-filter',
                snippet === CONFIDENCE_JQ_FILTER,
                snippet === '' ? 'no jq -r filter in the reference' : snippet,
            ),
        ).toBe(true);
        expect(snippet).toBe(CONFIDENCE_JQ_FILTER);
    });

    /** Every `agent.run` step whose `expectFile` is a judge verdict artifact, across all workflows. */
    const verdictProducers = (): { rel: string; state: string; input: string }[] =>
        confidenceArtifactProducers(/verdict/i);

    it('every agent.run that writes a verdict names the skill that declares the enum', () => {
        const producers = verdictProducers();
        const offenders = producers.filter((p) => !/kk:content-judge/.test(p.input)).map((p) => `${p.rel}:${p.state}`);
        const detail = `${producers.length} producers, unnamed contract: ${offenders.join(',') || 'none'}`;
        expect(record('producer:verdict-steps-name-the-skill', offenders.length === 0, detail)).toBe(true);
        expect(offenders).toEqual([]);
        // Non-vacuous: the daily safety judge, the itc judge and the example each write one.
        expect(producers.length).toBeGreaterThanOrEqual(3);
    });
});

/**
 * Every `agent.run` step whose `expectFile` is a confidence-bearing artifact, selected by artifact
 * name. The two families are written by different skills against different contracts — a judge
 * `verdict` (`kk:content-judge`) and the content-safety `report` (`kk:content-safety`) — but both
 * carry a `HIGH | MEDIUM | LOW` level their consumer refuses to guess, so both need the same
 * anti-drift net. A scanner fixed on `/verdict/i` never matches `_09_safety-review_report.json`,
 * which is how the report half stayed unverified while its gate enforced it.
 */
function confidenceArtifactProducers(
    artifact: RegExp,
): { rel: string; state: string; input: string; expectFile: string }[] {
    const found: { rel: string; state: string; input: string; expectFile: string }[] = [];
    for (const name of readdirSync(WORKFLOWS).filter((entry) => entry.endsWith('.yaml'))) {
        const rel = `plugins/kk/workflows/${name}`;
        const parsed = Bun.YAML.parse(readFileSync(join(REPO, rel), 'utf-8')) as {
            states?: { id?: string; onEnter?: { kind?: string; options?: Record<string, unknown> }[] }[];
        };
        for (const state of parsed.states ?? []) {
            for (const action of state.onEnter ?? []) {
                if (action.kind !== 'agent.run') continue;
                const expectFile = String(action.options?.expectFile ?? '');
                if (!artifact.test(expectFile)) continue;
                found.push({ rel, state: state.id ?? '?', input: String(action.options?.input ?? ''), expectFile });
            }
        }
    }
    return found;
}

/**
 * The report-level half of the same enum (20261007 amendment, ADR-033 R5 / task 0189 R10), scoped to
 * the workflow this project actually runs: `kk-daily-ai-voice2.yaml`.
 *
 * `daily-safety-gate` blocks a disposition-contract report whose own `confidence` is missing or
 * outside the enum; that stage half is covered in `kk-workflow-stages.test.ts`. The other end of the
 * seam was unverified: `verdict-confidence` above selects `expectFile` on /verdict/i, which never
 * matches `_09_safety-review_report.json`, so the report producer sat outside the scan entirely —
 * while its review prompt enumerated the report's fields (`platforms[]` entries with `decision`, plus
 * `escalate`) and omitted the one field the gate hard-requires.
 *
 * voice2 owns no report producer of its own: its `safety` node shells out the nested state machine,
 * so the producers to check are that machine's. The scope is proved by the first check rather than
 * asserted here. voice1's original is deliberately outside it — voice2's R1 freezes that file
 * byte-identical apart from comments and `description:` scalars, so its prompt cannot carry a
 * correction, and it is not on the live path.
 */
describe('the voice2 safety report producer declares the confidence contract', () => {
    const skill = readFileSync(join(REPO, SAFETY_SKILL), 'utf-8');
    const reports = confidenceArtifactProducers(/report/i).filter((p) => p.rel === SAFETY_MACHINE);

    it('voice2 runs the nested machine whose producers these checks read', () => {
        const voice2 = readFileSync(join(REPO, VOICE2), 'utf-8');
        const shellOut = `spur workflow run ${SAFETY_MACHINE}`;
        const ok = voice2.includes(shellOut);
        expect(
            record(
                'producer:voice2-runs-the-safety-machine',
                ok,
                ok ? `voice2 shells out ${SAFETY_MACHINE}` : `${shellOut} not found in ${VOICE2}`,
            ),
        ).toBe(true);
        expect(ok).toBe(true);
        // Non-vacuous: that machine declares exactly one report producer today.
        expect(reports.length).toBeGreaterThanOrEqual(1);
    });

    it('the content-safety skill states the report confidence enum and when it is required', () => {
        const enumLine = /"confidence"\s*:\s*"HIGH\s*\|\s*MEDIUM\s*\|\s*LOW"/.test(skill);
        // The enum alone is not enough: a disposition-contract report needs the level while a
        // legacy report stays exempt, so an emitter that cannot read WHEN it applies drops it on
        // every run and the gate blocks every run.
        const required = /must\*\* carry a valid `confidence`/.test(skill);
        const ok = enumLine && required;
        expect(
            record(
                'producer:content-safety-report-enum',
                ok,
                `enum line=${enumLine}, states when it is required=${required}`,
            ),
        ).toBe(true);
        expect(ok).toBe(true);
    });

    it('the report-writing agent.run names the skill that declares the enum', () => {
        const offenders = reports.filter((p) => !/kk:content-safety/.test(p.input)).map((p) => `${p.rel}:${p.state}`);
        const detail = `${reports.length} report producers, unnamed contract: ${offenders.join(', ') || 'none'}`;
        expect(record('producer:voice2-report-names-the-skill', offenders.length === 0, detail)).toBe(true);
        expect(offenders).toEqual([]);
    });

    it('the report producer is told the report carries a HIGH|MEDIUM|LOW confidence', () => {
        // Naming the skill is not enough on its own: the prompt is the emitter's instruction and it
        // enumerates the report's shape, so a shape that omits the gate-required field teaches the
        // emitter to omit it. The judge prompt below it is the precedent — it states its level.
        const offenders = reports.filter((p) => !/confidence/.test(p.input)).map((p) => `${p.rel}:${p.state}`);
        const detail = `${reports.length} report producers, silent on the level: ${offenders.join(', ') || 'none'}`;
        expect(record('producer:voice2-report-states-the-confidence-rule', offenders.length === 0, detail)).toBe(true);
        expect(offenders).toEqual([]);
    });
});

describe('verdict-confidence artifact', () => {
    it('writes a repeatable summary of every check', () => {
        const failed = checks.filter((check) => !check.ok).map((check) => check.id);
        const dir = join(REPO, '.spur/run/verdict-confidence');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'summary.json'),
            `${JSON.stringify(
                {
                    generatedAt: new Date().toISOString(),
                    contract:
                        'a judge verdict PASS requires confidence HIGH | MEDIUM | LOW, and so does the kk-collect label pass verdict',
                    ok: failed.length === 0,
                    failed,
                    checks,
                },
                null,
                2,
            )}\n`,
        );
        expect(failed).toEqual([]);
    });
});
