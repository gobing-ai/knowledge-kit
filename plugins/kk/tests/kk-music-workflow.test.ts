import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The `kk-music` workflow (task 0403, feature D8 R1–R5).
 *
 * Failure-first list (written before the assertions):
 *  1. The state graph drifts: a state is unreachable, a second operator gate appears, or a shell
 *     action grows past ADR-115's budget (the composition finding that would hide a pipeline in YAML).
 *  2. Money leaks: `explore` takes a take in the wrong model (Clip for a Pro direction), re-running
 *     it re-pays for a take already on disk, or `analyze` runs on a take nobody selected.
 *  3. An unmeasured or rejected take is judged/masted/finalized: the verdict gate stops reading the
 *     confidence-aware `jq` filter, or `NEEDS_REVISION` reaches `master` without `accept_revision`.
 *  4. The run artifacts stop matching 0402's run-directory contract, so the judge bundle a workflow
 *     writes is not the bundle the skill documents.
 *  5. The run report drifts from the sidecars: spend that is not the sidecar sum, a missing instance
 *     id, or a delivery profile without its measured LUFS/true peak.
 *
 * The workflow's own stage bodies run through the real CLI (`bun apps/cli/src/index.ts stage run
 * music-*`), with `KK_MUSIC_DRY_RUN=1` so no take can be paid for and no socket can open. The
 * guards are executed from the shipped YAML (never a copy) with fixture verdict files, the same
 * technique `verdict-confidence.test.ts` uses for the judge gate it must not fork.
 */

// Each behavioural case spawns the real CLI once per workflow state; Bun's 5 s default is not the
// budget for four CLI boots plus a render.
setDefaultTimeout(60_000);

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-music.yaml');
const KK_ENTRY = join(REPO, 'apps/cli/src/index.ts');
const EXAMPLE = join(REPO, 'plugins/kk/workflows/judge-gated-publish-example.yaml');

const source = readFileSync(WORKFLOW, 'utf-8');
const flat = source.replace(/\s+/g, ' ');

interface Transition {
    from: string;
    to: string;
    description: string;
    guardKind: string | undefined;
    command: string | null;
}
interface State {
    id: string;
    pause?: boolean;
    description?: string;
    onEnter?: { kind: string; options?: Record<string, unknown> }[];
}
interface Workflow {
    initialState: string;
    terminalStates: string[];
    failureStates: string[];
    vars: Record<string, string>;
    states: State[];
    transitions: Transition[];
}

const raw = Bun.YAML.parse(source) as {
    initialState: string;
    terminalStates: string[];
    failureStates: string[];
    vars: Record<string, string>;
    states: State[];
    transitions: {
        from: string;
        to: string;
        description?: string;
        guard?: { kind?: string; options?: { command?: unknown } };
    }[];
};
const parsed: Workflow = {
    initialState: raw.initialState,
    terminalStates: raw.terminalStates,
    failureStates: raw.failureStates,
    vars: raw.vars,
    states: raw.states,
    transitions: raw.transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        description: transition.description ?? '',
        guardKind: transition.guard?.kind,
        command: transition.guard?.kind === 'shell' ? String(transition.guard.options?.command ?? '') : null,
    })),
};
const stateIds = parsed.states.map((state) => state.id);

const dirs: string[] = [];
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}

/** Run `bun <kk entry> <args…>` from the checkout with the dry-run music adapter. */
function kk(args: string[], env: Record<string, string> = {}): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [KK_ENTRY, ...args], {
        cwd: dirs[dirs.length - 1] ?? REPO,
        encoding: 'utf-8',
        env: { ...process.env, KK_MUSIC_DRY_RUN: '1', KK_MUSIC_KK_BIN: KK_ENTRY, ...env },
        timeout: 120_000,
    });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** One two-direction run directory with the briefs and prompt text the `brief` state would author. */
function seedRun(): { works: string; runDir: string } {
    const works = tempDir('kk-music-workflow-');
    const prep = kk([
        'stage',
        'run',
        'music-prepare',
        works,
        'probe sting',
        '',
        'jingle',
        'synthwave',
        '2',
        'false',
        'probe',
    ]);
    expect(prep.status).toBe(0);
    const runDir = readFileSync(join(works, 'kk-music/.run-dir.txt'), 'utf-8').trim();
    for (const [nn, title, style] of [
        ['01', 'Probe Hook A', 'Synthwave ident at 120 BPM in A minor: analog bass, gated pad, vocal tag.'],
        ['02', 'Probe Hook B', 'Synthwave ident at 100 BPM in D minor: FM bells, wide chorus, spoken tag.'],
    ] as const) {
        const brief = join(runDir, '1-brief', `brief-${nn}.yaml`);
        writeFileSync(
            brief,
            [
                `title: ${title}`,
                'format: jingle',
                'theme: synthwave',
                'duration_target: "0:20"',
                'language: EN',
                'audio_format: wav',
                'instrumental: false',
                `style: |-`,
                `  ${style}`,
                'avoid:',
                '  - orchestral strings',
                'structure:',
                '  - at: "0:00"',
                '    section: Hook',
                '    note: state the name once',
                '  - at: "0:10"',
                '    section: Tag',
                '    note: short melodic tag',
                '  - at: "0:17"',
                '    section: Resolve',
                '    note: final chord',
                'takes: 1',
                '',
            ].join('\n'),
        );
        const render = kk([
            'music',
            'render',
            '--in',
            brief,
            '--out',
            join(runDir, '1-brief', `brief-${nn}.prompt.txt`),
        ]);
        expect(render.status).toBe(0);
    }
    return { works, runDir };
}

/** Run one guard command from the workflow, with `${vars.…}` substituted and the run env exported. */
function guard(command: string, vars: Record<string, string>): number | null {
    let expanded = command;
    for (const [name, value] of Object.entries(vars)) {
        expanded = expanded.replaceAll(`\${vars.${name}}`, value);
    }
    const result = spawnSync('bash', ['-c', expanded], { encoding: 'utf-8', env: { ...process.env } });
    return result.status;
}

/** The `from → to` guards of one source state, in declaration order (first pass wins). */
function outbound(from: string): Transition[] {
    return parsed.transitions.filter((transition) => transition.from === from);
}

describe('the shipped workflow is one inspectable state machine (R1/AC1)', () => {
    it('declares the nine-state pipeline, terminal done and failure failed', () => {
        expect(stateIds).toEqual([
            'prepare',
            'brief',
            'explore',
            'select',
            'analyze',
            'check',
            'judge',
            'master',
            'finalize',
            'done',
            'failed',
        ]);
        expect(parsed.initialState).toBe('prepare');
        expect(parsed.terminalStates).toEqual(['done', 'failed']);
        expect(parsed.failureStates).toEqual(['failed']);
    });

    it('declares every R1 var, including the spend and resume knobs', () => {
        for (const name of [
            'topic',
            'idea_file',
            'theme',
            'format',
            'works',
            'directions',
            'agent',
            'delivery_profile',
            'auto',
            'accept_revision',
            'force',
            'force_reason',
            'dry_run',
        ]) {
            expect(Object.keys(parsed.vars)).toContain(name);
        }
    });

    it('has select as the only operator-pause state', () => {
        expect(parsed.states.filter((state) => state.pause === true).map((state) => state.id)).toEqual(['select']);
        const hitl = parsed.states.flatMap((state) =>
            (state.onEnter ?? []).filter((action) => action.kind.startsWith('hitl.')),
        );
        expect(hitl.map((action) => action.kind)).toEqual(['hitl.select']);
    });

    it('reaches every state from prepare over the declared transitions', () => {
        const seen = new Set<string>([parsed.initialState]);
        const queue = [parsed.initialState];
        while (queue.length > 0) {
            const from = queue.shift() as string;
            for (const transition of outbound(from)) {
                if (!seen.has(transition.to)) {
                    seen.add(transition.to);
                    queue.push(transition.to);
                }
            }
        }
        expect([...seen].sort()).toEqual([...stateIds].sort());
    });

    it('keeps every shell action inside ADR-115 (one bounded call, at most 5 logical commands)', () => {
        const shells = parsed.states.flatMap((state) =>
            (state.onEnter ?? [])
                .filter((action) => action.kind === 'shell')
                .map((action) => String(action.options?.command ?? '')),
        );
        expect(shells.length).toBeGreaterThan(0);
        for (const command of shells) {
            const logical = command
                .replace(/\n/g, ' ')
                .split(/;|&&|\|\|/)
                .filter((part) => part.trim() !== '');
            expect(logical.length).toBeLessThanOrEqual(5);
        }
    });

    it('keeps every agent.run prompt under the 1000-character cap and free of pasted content', () => {
        const prompts = parsed.states.flatMap((state) =>
            (state.onEnter ?? [])
                .filter((action) => action.kind === 'agent.run')
                .map((action) => String(action.options?.input ?? '')),
        );
        expect(prompts.length).toBe(2);
        for (const prompt of prompts) {
            expect(prompt.length).toBeLessThanOrEqual(1000);
            // A prompt that pastes the bundle is a second, drifting copy of it (0402's contract).
            expect(prompt).not.toContain('## 1. brief');
        }
    });

    it('routes the judge through the shipped confidence-aware filter, byte for byte', () => {
        const filter =
            'if (.verdict // "") == "PASS" then (.verdict + (if ((.confidence // "") | test("^(HIGH|MEDIUM|LOW)$")) then "" else "!" end)) else (.verdict // "") end';
        expect(readFileSync(EXAMPLE, 'utf-8')).toContain(filter);
        expect(flat).toContain(filter);
        // The judge state is one agent.run on content-judge with the music rubric, no second verdict.
        expect(flat).toContain('kk:content-judge skill with rubric `music-quality`');
        expect(flat).toContain('4-verdict-music.json');
        expect(source).not.toContain('music-verdict');
    });
});

describe('the verdict gate reads a real music verdict (R3/AC3)', () => {
    const gates = outbound('judge');
    const passGate = gates.find((gate) => gate.description.includes('PASS with a HIGH'))?.command ?? '';
    const acceptGate = gates.find((gate) => gate.description.includes('accept_revision=true'))?.command ?? '';
    const failGate = gates.find((gate) => gate.description.includes('block master')) ?? null;

    /** Write one verdict fixture and answer which gate (if either) lets it reach master. */
    function verdictCase(verdict: Record<string, unknown> | null, acceptRevision: string) {
        const dir = tempDir('kk-music-verdict-');
        if (verdict !== null) {
            writeFileSync(join(dir, '4-verdict-music.json'), `${JSON.stringify(verdict, null, 2)}\n`);
        }
        const vars = { run_dir: dir, accept_revision: acceptRevision };
        return {
            pass: guard(passGate, vars) === 0,
            accept: guard(acceptGate, vars) === 0,
        };
    }

    it('carries the generated guard commands (a real read, not an empty string)', () => {
        expect(passGate).toContain('test("^(HIGH|MEDIUM|LOW)$")');
        expect(acceptGate).toContain('accept_revision');
    });

    it('lets a PASS with HIGH/MEDIUM/LOW confidence through to master', () => {
        for (const confidence of ['HIGH', 'MEDIUM', 'LOW']) {
            expect(verdictCase({ verdict: 'PASS', confidence, rubric: 'music-quality' }, 'false').pass).toBe(true);
        }
    });

    it('refuses a PASS without a contract confidence, a FAIL, and an out-of-contract verdict', () => {
        // A PASS with a missing or out-of-enum confidence becomes `PASS!`, which no accept guard matches.
        expect(verdictCase({ verdict: 'PASS' }, 'false').pass).toBe(false);
        expect(verdictCase({ verdict: 'PASS', confidence: 'certain' }, 'false').pass).toBe(false);
        // A missing verdict file (the judge wrote nothing) fails closed.
        expect(verdictCase(null, 'false').pass).toBe(false);
        for (const verdict of ['FAIL', 'PASS!', '', 'REVISE']) {
            const outcome = verdictCase({ verdict, confidence: 'HIGH' }, 'true');
            expect(outcome.pass).toBe(false);
            expect(outcome.accept).toBe(false);
        }
    });

    it('reaches master on NEEDS_REVISION only with accept_revision=true', () => {
        expect(verdictCase({ verdict: 'NEEDS_REVISION', confidence: 'HIGH' }, 'false').accept).toBe(false);
        expect(verdictCase({ verdict: 'NEEDS_REVISION', confidence: 'HIGH' }, 'true').accept).toBe(true);
        // NEEDS_REVISION never takes the PASS gate.
        expect(verdictCase({ verdict: 'NEEDS_REVISION', confidence: 'HIGH' }, 'true').pass).toBe(false);
    });

    it('routes a review-blocked run to the failed terminal, never to master', () => {
        expect(failGate).not.toBeNull();
        expect(failGate?.to).toBe('failed');
        // The block edge is the last one on the state, so no earlier PASS/NEEDS_REVISION gate shadows it.
        expect(gates[gates.length - 1]?.to).toBe('failed');
    });
});

describe('spend happens in the delivery model, once per direction (R2/AC2/AC5)', () => {
    it('takes one pro take per brief, never a clip, and pays nothing on a re-run', () => {
        const { runDir } = seedRun();
        const first = kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']);
        expect(first.status).toBe(0);
        const explore = JSON.parse(readFileSync(join(runDir, '3-takes/explore.json'), 'utf-8')) as {
            takes: number;
            briefs: { status: string; paid: boolean; model: string }[];
        };
        expect(explore.takes).toBe(2);
        expect(explore.briefs.map((brief) => brief.model)).toEqual(['pro', 'pro']);
        expect(explore.briefs.every((brief) => brief.paid)).toBe(true);
        // A clip request would land as `…-clip-…` and is exactly the shape R2 forbids here.
        const takes = (readFileSync(join(runDir, '3-takes/explore.json'), 'utf-8').match(/-clip-/g) ?? []).length;
        expect(takes).toBe(0);

        const again = kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']);
        expect(again.status).toBe(0);
        const adopted = JSON.parse(readFileSync(join(runDir, '3-takes/explore.json'), 'utf-8')) as {
            briefs: { status: string; paid: boolean }[];
        };
        expect(adopted.briefs.map((brief) => [brief.status, brief.paid])).toEqual([
            ['adopted', false],
            ['adopted', false],
        ]);
    });

    it('analyzes the selected take only', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-select', runDir, '02', 'false']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-analyze', runDir, 'true']).status).toBe(0);
        const selection = JSON.parse(readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8')) as {
            brief: string;
            take: { instanceId: string; artifactPath: string };
        };
        expect(selection.brief).toBe('02');
        expect(existsSync(join(runDir, '3-takes', `analysis-${selection.take.instanceId}.json`))).toBe(true);
        // No analysis for the take nobody picked: one file, one instance id.
        const analyses = readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8');
        expect(analyses).toContain(selection.take.instanceId);
    });

    it('refuses a paid re-roll without force and a force reason', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']).status).toBe(0);
        // force without a reason is never silent (0400's `--force --reason <text>`).
        const forced = kk(['stage', 'run', 'music-explore', runDir, '2', 'true', '', 'true', 'probe']);
        expect(forced.status).not.toBe(0);
        expect(forced.output).toContain('force_reason');
    });

    it('skips the operator gate in auto only when exactly one take exists', () => {
        const autoGate = outbound('explore')[0]?.command ?? '';
        expect(outbound('explore')[0]?.to).toBe('analyze');
        const one = tempDir('kk-music-auto-');
        mkdirSync(join(one, '3-takes'), { recursive: true });
        writeFileSync(join(one, '3-takes/explore.json'), '{"takes":1}\n');
        expect(guard(autoGate, { auto: 'true', run_dir: one })).toBe(0);
        const two = tempDir('kk-music-auto-');
        mkdirSync(join(two, '3-takes'), { recursive: true });
        writeFileSync(join(two, '3-takes/explore.json'), '{"takes":2}\n');
        expect(guard(autoGate, { auto: 'true', run_dir: two })).not.toBe(0);
        expect(guard(autoGate, { auto: 'false', run_dir: one })).not.toBe(0);
        // The explore state's second edge pauses for the operator whatever the take count.
        expect(outbound('explore')[1]?.to).toBe('select');
    });

    it('writes no analysis for a dry run that was never selected past the gate', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '1', 'false', '', 'true', 'probe']).status).toBe(0);
        // directions 1 → one take → explore already bound it (a single take is not a choice).
        expect(existsSync(join(runDir, '3-takes/selection.json'))).toBe(true);
        const selection = JSON.parse(readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8')) as {
            auto: boolean;
        };
        expect(selection.auto).toBe(true);
        expect(kk(['stage', 'run', 'music-analyze', runDir, 'true']).status).toBe(0);
    });
});

describe('artifacts and the run report (R4/AC4)', () => {
    it('assembles the 0402 judge bundle from the six verbatim sections', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-select', runDir, '02', 'false']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-analyze', runDir, 'true']).status).toBe(0);
        const selection = JSON.parse(readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8')) as {
            brief: string;
            take: { artifactPath: string; instanceId: string };
        };
        // The check state is a real `kk music check` (0405); its rows are what the bundle quotes.
        const take = selection.take.artifactPath;
        writeFileSync(
            `${take}.checks.json`,
            `${JSON.stringify(
                [
                    {
                        id: 'duration.target',
                        measured: 20,
                        threshold: '10–30',
                        unit: 's',
                        source: 'ffprobe',
                        result: 'pass',
                    },
                    {
                        id: 'analysis.present',
                        measured: 'present',
                        threshold: 'present',
                        unit: 'state',
                        source: 'lyria instance analysis',
                        result: 'pass',
                    },
                ],
                null,
                4,
            )}\n`,
        );
        const bundle = kk(['stage', 'run', 'music-judge-input', runDir]);
        expect(bundle.status).toBe(0);
        const markdown = readFileSync(join(runDir, '4-judge-input.md'), 'utf-8');
        for (const heading of [
            '## 1. brief',
            '## 2. prompt',
            '## 3. lyrics',
            '## 4. analysis',
            '## 5. checks',
            '## 6. provenance',
        ]) {
            expect(markdown).toContain(heading);
        }
        expect(markdown).toContain('Rubric: music-quality');
        expect(markdown).toContain(selection.take.instanceId);
        expect(markdown).toContain('"id": "duration.target"');
    });

    it('refuses to judge a take whose checks.json carries a fail row', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '1', 'false', '', 'true', 'probe']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-select', runDir, '01', 'false']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-analyze', runDir, 'true']).status).toBe(0);
        const take = (
            JSON.parse(readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8')) as {
                take: { artifactPath: string };
            }
        ).take.artifactPath;
        writeFileSync(
            `${take}.checks.json`,
            `${JSON.stringify(
                [
                    {
                        id: 'duration.target',
                        measured: 1,
                        threshold: '10–30',
                        unit: 's',
                        source: 'ffprobe',
                        result: 'fail',
                    },
                ],
                null,
                4,
            )}\n`,
        );
        const bundle = kk(['stage', 'run', 'music-judge-input', runDir]);
        expect(bundle.status).not.toBe(0);
        expect(bundle.output).toContain('duration.target measured 1 s');
        expect(existsSync(join(runDir, '4-judge-input.md'))).toBe(false);
    });

    it('reports spend as the sidecar sum with the profile measurements and the final path', () => {
        const { runDir } = seedRun();
        expect(kk(['stage', 'run', 'music-explore', runDir, '2', 'false', '', 'true', 'probe']).status).toBe(0);
        expect(kk(['stage', 'run', 'music-select', runDir, '02', 'false']).status).toBe(0);
        const take = (
            JSON.parse(readFileSync(join(runDir, '3-takes/selection.json'), 'utf-8')) as {
                take: { artifactPath: string };
            }
        ).take.artifactPath;
        writeFileSync(
            `${take}.checks.json`,
            `${JSON.stringify(
                [
                    {
                        id: 'delivery.integrated_loudness',
                        measured: -14,
                        threshold: '-15–-13',
                        unit: 'LUFS',
                        source: 'ffmpeg loudnorm',
                        result: 'pass',
                    },
                    {
                        id: 'delivery.true_peak',
                        measured: -1.2,
                        threshold: -1,
                        unit: 'dBTP',
                        source: 'ffmpeg loudnorm',
                        result: 'pass',
                    },
                ],
                null,
                4,
            )}\n`,
        );
        writeFileSync(take.replace(/\.wav$/, '.streaming.wav'), readFileSync(take));
        writeFileSync(
            join(runDir, '4-verdict-music.json'),
            `${JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', rubric: 'music-quality', score: 0.86, findings: [] })}\n`,
        );
        const report = kk(['stage', 'run', 'music-finalize', runDir, 'streaming', 'jingle', 'probe']);
        expect(report.status).toBe(0);
        const markdown = readFileSync(join(runDir, '5-run-report.md'), 'utf-8');
        // Spend = the sidecar sum (two takes × the pro unit price recorded in each sidecar).
        const sidecars = readFileSync(join(runDir, '3-takes/explore.json'), 'utf-8');
        expect(sidecars).toContain('"unitPrice": 0.08');
        expect(markdown).toContain('Total: $0.16 across 2 take(s)');
        expect(markdown).toContain('streaming');
        expect(markdown).toContain('-14 LUFS');
        expect(markdown).toContain('-1.2 dBTP');
        expect(markdown).toContain('`PASS`');
        expect(markdown).toMatch(/final artifact:`? `?\//);
        expect(markdown).toContain('offline-take-1');
    });
});
