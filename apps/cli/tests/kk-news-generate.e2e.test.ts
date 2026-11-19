/**
 * Task 0367 AC3 / R9 — the new workflow freezes the same bundle as the voice3 node sequence.
 *
 * The proof is execution: `spur workflow run plugins/kk/workflows/kk-news-generate.yaml` drives the
 * real twenty-node DAG in a throwaway project root outside the repo, with the doubles the task
 * sanctions for an offline rehearsal —
 *
 *  - the stage bodies (`kk-workflow-stages.ts`), replaced by a recorded runner in the temp package
 *    layout the stage resolver already understands, so the deterministic nodes are offline;
 *  - the agent executors (`inline` / `pi` / `claude` …), PATH stubs honoring the real `expectFile`
 *    contracts, so the six agent nodes author real plan artefacts;
 *  - the nested safety machine (`kk-daily-safety.yaml`, out of scope for this task), a `spur` shim
 *    that intercepts only that path and writes the evidence file the freeze reads;
 *  - `news-report-gen`, a one-line fixture plugin.
 *
 * What is NOT doubled: the workflow file, the node order and conditions, the step verbs and their
 * argv, the pool gate, `runPublishMatrixBundle`, and `kk daily run-report`'s body.
 *
 * The reference bundle is produced by running voice3's own bundle node sequence —
 * `daily-publish-prep` → `daily-bundle-variants` → `daily-safety-manifest` →
 * `kk stage run publish-matrix-bundle`, the exact stages the retired voice3 DAG's nodes 39–42
 * call — over the same fixture, then comparing variant keys and safety status.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { itemId, openStore } from '@gobing-ai/kk-store';

const REPO = resolve(import.meta.dir, '../../..');
const EVIDENCE = join(REPO, '.works/tmp/test-news-generate');
const DIGITS = '20261113';
const SPUR = Bun.which('spur') ?? 'spur';
const STORIES = [
    { id: 'story-a', title: '模型新版本发布', body: '新版本跑分提升明显。', sourceUri: 'https://example.com/story-a' },
    { id: 'story-b', title: '开源项目融资', body: '维护者承诺协议不变。', sourceUri: 'https://example.com/story-b' },
];

interface Fixture {
    root: string;
    works: string;
    bin: string;
    pkg: string;
    plugins: string;
    config: string;
    docsFile: string;
    agentLog: string;
    kkLog: string;
}

const roots: string[] = [];
afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The stage runner double: the deterministic node bodies, offline (same double as AC2). */
const STAGE_STUB = String.raw`#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [stage, ...args] = process.argv.slice(2);
const workDir = args[0] ?? '';
const runDate = args[1] ?? '';
const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const writeJson = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const docs = JSON.parse(await Bun.file(process.env.KK_STUB_DOCS).text());
// 0392 R2: the counts artifact is written by the REAL module, so the stub only fakes the stage
// boundary — the arithmetic the workflow depends on is never re-implemented in a double.
const attempts = process.env.KK_STUB_ATTEMPTS ? await import(process.env.KK_STUB_ATTEMPTS) : null;
const content = (body) => ({ title: '每日AI乱炖', format: 'markdown', body, metadata: {} });

if (process.env.KK_STUB_FAIL_STAGE === stage) process.exit(3);
switch (stage) {
    case 'daily-preflight': break;
    case 'daily-extract':
        writeJson(join(workDir, '10-collect', 'pool.json'), { metadata: { docs } });
        break;
    case 'daily-plan':
        writeJson(join(workDir, '21-plan', runDate + '_03_plan_content.json'), { title: '每日AI乱炖', format: 'markdown', body: 'plan', metadata: { docs } });
        break;
    case 'daily-qc-content':
        writeJson(join(workDir, '21-plan', runDate + '_04_quality-control-content_candidates.json'), {
            title: '每日AI乱炖', format: 'markdown', body: 'candidates',
            metadata: { docs: process.env.KK_STUB_EMPTY_POOL === '1' ? [] : docs },
        });
        attempts?.recordSelectionAttempt(workDir, {
            runDate,
            attemptId: runDate + '#1',
            spec: { version: 2 },
            stages: [{ stage: 'qc', input: docs.length, kept: process.env.KK_STUB_EMPTY_POOL === '1' ? 0 : docs.length, dropped: process.env.KK_STUB_EMPTY_POOL === '1' ? docs.map((d) => d.id) : [] }],
            excluded: [],
            keptIds: process.env.KK_STUB_EMPTY_POOL === '1' ? [] : docs.map((d) => d.id),
        });
        break;
    case 'daily-curate-check': {
        const plan = join(workDir, '21-plan', runDate + '_03_plan_plan.json');
        const errors = join(workDir, '21-plan', runDate + '_03_curate_errors.json');
        writeJson(plan, docs);
        writeJson(join(workDir, '21-plan', runDate + '_03_curate_excluded.json'), []);
        if (existsSync(errors)) rmSync(errors, { force: true });
        // The curation stage amends the attempt the QC node wrote: one run day, one attempt.
        attempts?.recordSelectionStage(workDir, runDate, {
            stages: [
                { stage: 'curation', input: docs.length, kept: docs.length, dropped: [] },
                { stage: 'plan', input: docs.length, kept: docs.length, dropped: [] },
            ],
        });
        break;
    }
    case 'daily-script-check': {
        const errors = join(workDir, '24-script', runDate + '_08_script-write_errors.json');
        if (existsSync(errors)) rmSync(errors, { force: true });
        break;
    }
    case 'daily-script':
        writeJson(join(workDir, '24-script', runDate + '_08_script_content.json'), content('script'));
        write(join(workDir, '24-script', runDate + '_08_script_voicescript.yaml'), 'version: 1\n');
        break;
    case 'daily-editorial-render':
        write(join(workDir, '22-article', runDate + '_06_article-write_body.md'), '正文\n');
        break;
    case 'daily-article':
        writeJson(join(workDir, '22-article', runDate + '_06_article_content.json'), content('article'));
        break;
    case 'daily-cover':
        write(join(workDir, '23-cover', runDate + '_07_cover_cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        break;
    case 'daily-cover-normalize': break;
    case 'daily-wrap-docs':
        writeJson(join(workDir, '30-audio', runDate + '_10_wrap-docs_docs.json'), { metadata: { docs: [] } });
        break;
    case 'daily-generate':
        writeJson(join(workDir, '30-audio', runDate + '_11_generate_content.json'), {
            title: '每日AI乱炖', format: 'markdown', body: 'audio',
            metadata: {
                mp3Path: join(workDir, '30-audio', runDate + '_11_generate_audio.mp3'),
                duration: 1020,
                qc: { passed: true, overallScore: 88 },
            },
        });
        break;
    case 'daily-intro': case 'daily-voice-audit': case 'daily-quality-report':
    case 'daily-quality-verdict': case 'daily-episode-duration': case 'daily-safety-manifest':
        break;
    case 'daily-show-notes':
        write(join(workDir, '31-publish', runDate + '_15_show-notes_show-notes.md'), '- 00:00 intro\n');
        break;
    case 'daily-xhs-render':
        writeJson(join(workDir, '25-xhs', runDate + '_18_xhs_plan.json'), { cards: [] });
        write(join(workDir, '25-xhs', 'card-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        break;
    case 'daily-publish-prep':
        writeJson(join(workDir, '31-publish', runDate + '_13_publish-prep_content.json'), {
            title: '每日AI乱炖', format: 'markdown', body: 'episode',
            metadata: { mp3Path: join(workDir, '30-audio', runDate + '_11_generate_audio.mp3') },
        });
        break;
    case 'daily-bundle-variants':
        for (const key of ['article', 'episode', 'xhs-article']) {
            writeJson(join(workDir, '30-variants', key + '.content.json'), content(key));
        }
        break;
    default: break;
}
process.exit(0);
`;

/** The report generator double: a `generator` plugin whose Content `body` is the report page. */
const REPORT_PLUGIN = String.raw`#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(out, JSON.stringify({ title: 'generation report', format: 'markdown', body: '# Daily run report\n', metadata: {} }));
process.exit(0);
`;

/**
 * The executor double: every agent CLI the roster names. The `expectFile` contract is the real one
 * — the prompt names the artefact path, the stub writes it — so the DAG's `expectFile` gate is
 * exercised rather than bypassed.
 */
const AGENT_STUB = `#!/usr/bin/env bash
set -u
[ -n "\${KK_AGENT_LOG:-}" ] && printf '%s %s %s\\n' "$(basename "$0")" "$*" "" >> "$KK_AGENT_LOG"
case "\${1:-}" in
  --version) echo "0.99.0"; exit 0 ;;
  --list-models) echo "stub/model-1"; exit 0 ;;
  --help|-h) echo "usage: agent -p <input>"; exit 0 ;;
esac
prompt="$*"
plan=$(printf '%s' "$prompt" | grep -oE '[^ "]+/_03_plan_plan\\.json' | head -1)
script_plan=$(printf '%s' "$prompt" | grep -oE '[^ "]+/_08_script-write_plan\\.json' | head -1)
judge=$(printf '%s' "$prompt" | grep -oE '[^ "]+/_08_editorial-judge_verdict\\.json' | head -1)
if [ -n "$plan" ]; then
  mkdir -p "$(dirname "$plan")"
  cp "$KK_STUB_DOCS" "$plan"
  excluded="\${plan%_03_plan_plan.json}_03_curate_excluded.json"
  printf '[]\\n' > "$excluded"
fi
if [ -n "$script_plan" ]; then
  mkdir -p "$(dirname "$script_plan")"
  printf '{"version":1,"intro":"今日概览","outro":"明天继续","items":[],"excluded":[]}\\n' > "$script_plan"
fi
if [ -n "$judge" ]; then
  mkdir -p "$(dirname "$judge")"
  printf '{"verdict":"PASS","confidence":"HIGH","rubric":"news-balance","score":0.9}\\n' > "$judge"
fi
exit 0
`;

function makeFixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-0367-ac3-'));
    roots.push(root);
    const bin = join(root, 'bin');
    const pkg = join(root, 'pkg');
    const plugins = join(root, 'plugins');
    const works = join(root, 'works');
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(pkg, 'apps/cli/plugins/kk/scripts'), { recursive: true });
    mkdirSync(join(pkg, 'apps/cli/src'), { recursive: true });
    mkdirSync(join(plugins, 'generations/news-report-gen'), { recursive: true });
    mkdirSync(works, { recursive: true });
    mkdirSync(join(root, '.spur'), { recursive: true });
    // The shipped kk assets resolve through the fixture root (skills, workflow YAMLs); the report
    // generator resolves through the fixture's own `generations/` so the real plugin never runs.
    symlinkSync(join(REPO, 'plugins/kk'), join(plugins, 'kk'));

    const wrapper = join(pkg, 'apps/cli/src/index.ts');
    writeFileSync(
        wrapper,
        `import { main } from ${JSON.stringify(join(REPO, 'apps/cli/src/main.ts'))};\nprocess.exit(await main(['bun', import.meta.path, ...Bun.argv.slice(2)]));\n`,
    );
    writeFileSync(join(pkg, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts'), STAGE_STUB);
    writeFileSync(
        join(plugins, 'generations/news-report-gen/plugin.json'),
        JSON.stringify({ name: 'news-report-gen', kind: 'generator', entry: 'entry.ts', version: '0.0.1' }),
    );
    writeFileSync(join(plugins, 'generations/news-report-gen/entry.ts'), REPORT_PLUGIN);

    const docsFile = join(root, 'docs.json');
    writeFileSync(docsFile, JSON.stringify(STORIES));
    const agentLog = join(root, 'agents.log');
    const kkLog = join(root, 'kk.log');
    writeFileSync(agentLog, '');
    writeFileSync(kkLog, '');

    const kk = join(bin, 'kk');
    writeFileSync(kk, `#!/usr/bin/env bash\necho "$*" >> "${kkLog}"\nexec "${process.execPath}" "${wrapper}" "$@"\n`);
    chmodSync(kk, 0o755);

    // The nested safety machine is out of scope for this task (design §5.1, "unchanged by G61"):
    // the shim intercepts ONLY that path and writes the evidence file the freeze attaches.
    const spur = join(bin, 'spur');
    writeFileSync(
        spur,
        `#!/usr/bin/env bash
case "\${1:-} \${2:-}" in
  "workflow run")
    case "\${3:-}" in
      *kk-daily-safety.yaml)
        vars=""
        prev=""
        for a in "$@"; do [ "$prev" = "--vars" ] && vars="$a"; prev="$a"; done
        wd=$(printf '%s' "$vars" | sed -n 's/.*"work_dir":"\\([^"]*\\)".*/\\1/p')
        scope=$(printf '%s' "$vars" | sed -n 's/.*"safety_scope_dir":"\\([^"]*\\)".*/\\1/p')
        scope=\${scope:-24-script}
        mkdir -p "$wd/$scope"
        if [ "$scope" = "4-safety-variants" ]; then
          printf '{"status":"pass","digest":"stub-variants-review","excludedPlatforms":[],"variants":{}}\\n' > "$wd/4-safety-variants/safety.json"
        fi
        echo "safety machine (stub): $scope clean"
        exit 0 ;;
    esac ;;
esac
exec "` +
            SPUR +
            `" "$@"
`,
    );
    chmodSync(spur, 0o755);
    for (const agent of ['inline', 'claude', 'codex', 'opencode', 'agy', 'gemini', 'pi', 'droid']) {
        const path = join(bin, agent);
        writeFileSync(path, AGENT_STUB);
        chmodSync(path, 0o755);
    }

    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        [
            'agent:',
            '  roles:',
            '    scribe: { tier: cheap, stages: [changelog] }',
            '    reviewer: { tier: capable-1, stages: [verify, review, dogfood] }',
            '  executors:',
            '    - name: stub-scribe',
            '      agent: pi',
            '      model: stub/model-1',
            '      tier: cheap',
            '    - name: stub-reviewer',
            '      agent: claude',
            '      model: stub/model-1',
            '      tier: capable-1',
            `decisions:\n  paths:\n    - ${join(REPO, 'plugins/kk/decisions')}\n`,
            '',
        ].join('\n'),
    );

    const config = join(root, 'config.yaml');
    writeFileSync(
        config,
        [
            `works_dir: ${works}`,
            'content_types:',
            '  news:',
            '    workflow: kk-news-generate',
            'store:',
            `  db_path: ${join(root, 'store.db')}`,
            'workflows:',
            '  kk-news-generate:',
            `    plugins_path: ${plugins}`,
            '',
        ].join('\n'),
    );
    return { root, works, bin, pkg, plugins, config, docsFile, agentLog, kkLog };
}

async function seedStore(fixture: Fixture): Promise<void> {
    const path = join(fixture.root, 'store.db');
    const store = await openStore({ path });
    const docs = STORIES.map((story) => ({
        id: itemId({ id: story.id, title: story.title, body: story.body, sourceUri: story.sourceUri }),
        title: story.title,
        body: story.body,
        sourceUri: story.sourceUri,
    }));
    await store.items.upsertDocs('seed-0367-ac3', docs, Date.now());
    await store.close();
    writeFileSync(fixture.docsFile, JSON.stringify(docs));
}

function runEnv(fixture: Fixture, extraEnv: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        HOME: join(fixture.root, 'home'),
        KK_CONFIG: fixture.config,
        KK_STUB_DOCS: fixture.docsFile,
        KK_STUB_ATTEMPTS: join(REPO, 'plugins/kk/scripts/topic-selection-attempts.ts'),
        KK_AGENT_LOG: fixture.agentLog,
        KK_PLUGIN_PATH: join(REPO, 'plugins/kk'),
        ...extraEnv,
    };
    mkdirSync(env.HOME as string, { recursive: true });
    delete env.KK_WORKS_DIR;
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    for (const key of Object.keys(env)) if (key.startsWith('TYPESAFE_')) delete env[key];
    return env;
}

interface WorkflowOutcome {
    code: number;
    state: string;
    out: string;
    err: string;
}

function runWorkflow(
    fixture: Fixture,
    vars: Record<string, string>,
    extraEnv: Record<string, string> = {},
): WorkflowOutcome {
    const proc = Bun.spawnSync(
        [
            SPUR,
            'workflow',
            'run',
            'plugins/kk/workflows/kk-news-generate.yaml',
            '--run-id',
            `ac3-${Date.now()}`,
            '--json',
            '--vars',
            JSON.stringify(vars),
        ],
        { cwd: fixture.root, env: runEnv(fixture, extraEnv), stdout: 'pipe', stderr: 'pipe' },
    );
    const out = proc.stdout?.toString() ?? '';
    const states = [...out.matchAll(/"finalState"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
    let state = states.at(-1) ?? 'unknown';
    if (state === 'dag') {
        const status = [...out.matchAll(/"status"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
        if (status !== undefined) state = status;
    }
    return { code: proc.exitCode ?? 1, state, out, err: proc.stderr?.toString() ?? '' };
}

function workflowVars(_fixture: Fixture, workDir: string): Record<string, string> {
    return {
        work_dir: workDir,
        run_date: DIGITS,
        run_id: 'ac3-run',
        agent: 'inline',
        skill_dir: join(REPO, 'plugins/kk/skills/news-editorial'),
        skip_review: 'true',
        preset: '',
    };
}

function stageCmd(fixture: Fixture, args: string[]): { code: number; out: string; err: string } {
    const proc = Bun.spawnSync([process.execPath, join(fixture.pkg, 'apps/cli/src/index.ts'), ...args], {
        cwd: fixture.root,
        env: runEnv(fixture),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { code: proc.exitCode ?? 1, out: proc.stdout?.toString() ?? '', err: proc.stderr?.toString() ?? '' };
}

interface BundleShape {
    variants: Record<string, unknown>;
    safety?: { status: string };
}

function readBundle(workDir: string): BundleShape {
    return JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')) as BundleShape;
}

describe('kk-news-generate — AC3: the workflow freezes the bundle voice3 freezes', () => {
    it('runs the twenty nodes and freezes the same variant keys and safety status as voice3', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        const outcome = runWorkflow(fx, workflowVars(fx, workDir));
        expect(outcome.err).not.toContain('dag-unreachable');
        expect(outcome.code).toBe(0);
        expect(outcome.state).toBe('done');

        const bundle = readBundle(workDir);
        expect(Object.keys(bundle.variants).sort()).toEqual(['article', 'episode', 'xhs-article']);
        // The nested variants review's evidence is carried into the freeze.
        expect(bundle.safety?.status).toBe('pass');
        // The report (node 20's second command) and the ledger ran behind the freeze.
        expect(readFileSync(join(workDir, '5-report', 'generation.md'), 'utf-8')).toContain('Daily run report');
        expect(readFileSync(join(workDir, 'run-report.summary.txt'), 'utf-8')).toContain('items planned');
        // 0392 R2: the run's counts artifact survives the whole workflow as ONE attempt, and the
        // curation node amended it AFTER the QC node (the ordering a unit test cannot show).
        const selection = JSON.parse(
            readFileSync(join(workDir, '21-plan', 'topic-selection-attempts.json'), 'utf-8'),
        ) as {
            attempts: {
                stages: { stage: string; input: number; kept: number }[];
                stageEvidence: Record<string, string>;
            }[];
            reconciliation: { reconciled: boolean; skippedStages: string[] };
        };
        expect(selection.attempts).toHaveLength(1);
        expect(selection.attempts[0]?.stages.map((entry) => entry.stage)).toEqual(['qc', 'curation', 'plan']);
        expect(selection.attempts[0]?.stageEvidence.curation).toBe('observed');
        expect(selection.reconciliation.skippedStages).not.toContain('curation');
        expect(selection.reconciliation.reconciled).toBe(true);
        // Every agent node was dispatched through the ONE executor variable.
        const agentCalls = readFileSync(fx.agentLog, 'utf-8').trim().split('\n').filter(Boolean);
        expect(agentCalls.length).toBeGreaterThanOrEqual(3);

        // ── the voice3 reference: its own bundle node sequence, same fixture ──
        const reference = join(fx.root, 'reference', 'kk-daily-ai-voice2', DIGITS);
        cpSync(workDir, reference, { recursive: true });
        for (const artifact of ['bundle.json', '5-report', 'run-report.summary.txt', 'pool-gate.json']) {
            rmSync(join(reference, artifact), { recursive: true, force: true });
        }
        // The drafts/variants safety evidence is the same fixture evidence voice3's machine leaves.
        mkdirSync(join(reference, '4-safety-variants'), { recursive: true });
        writeFileSync(
            join(reference, '4-safety-variants', 'safety.json'),
            readFileSync(join(workDir, '4-safety-variants', 'safety.json')),
        );
        const voice3Stages: string[][] = [
            ['stage', 'daily-publish-prep', reference, DIGITS, 'Robin Min', '咸话咸说'],
            ['stage', 'daily-bundle-variants', reference, DIGITS, fx.plugins, 'true', 'true'],
            ['stage', 'daily-safety-manifest', reference, DIGITS],
            ['stage', 'run', 'publish-matrix-bundle', reference, '--run-date', DIGITS, '--run-id', 'voice3-run'],
        ];
        for (const args of voice3Stages) {
            expect(`${args.join(' ')}: ${stageCmd(fx, args).code}`).toBe(`${args.join(' ')}: 0`);
        }
        const referenceBundle = readBundle(reference);
        // AC3: same variant keys, same safety status — the verbs compose the stages voice3 calls.
        expect(Object.keys(referenceBundle.variants).sort()).toEqual(Object.keys(bundle.variants).sort());
        expect(referenceBundle.safety?.status).toBe(bundle.safety?.status);
        for (const key of Object.keys(bundle.variants)) {
            expect(referenceBundle.variants[key]).toEqual(bundle.variants[key]);
        }

        mkdirSync(EVIDENCE, { recursive: true });
        writeFileSync(
            join(EVIDENCE, 'summary.json'),
            `${JSON.stringify(
                {
                    task: '0367',
                    case: 'AC3',
                    workflow: 'kk-news-generate',
                    finalState: outcome.state,
                    workDir,
                    bundleVariants: Object.keys(bundle.variants).sort(),
                    safetyStatus: bundle.safety?.status ?? null,
                    voice3Reference: {
                        workDir: reference,
                        bundleVariants: Object.keys(referenceBundle.variants).sort(),
                        safetyStatus: referenceBundle.safety?.status ?? null,
                    },
                    agentDispatches: agentCalls.length,
                    replay: 'spur workflow run plugins/kk/workflows/kk-news-generate.yaml --vars <workflowVars>',
                },
                null,
                2,
            )}\n`,
        );
    }, 240_000);

    it('closes an empty pool as done/no-content with no agent node executed', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        const outcome = runWorkflow(fx, workflowVars(fx, workDir), { KK_STUB_EMPTY_POOL: '1' });
        expect(outcome.code).toBe(0);
        expect(outcome.state).toBe('done');
        // The gate is the only routing token: EMPTY skips the whole content subtree.
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'EMPTY' });
        expect(existsSync(join(workDir, 'bundle.json'))).toBe(false);
        // The no-content verdict the launching verb's receipt reads.
        expect(readFileSync(join(workDir, 'run-report.summary.txt'), 'utf-8')).toStartWith('no-content:');
        // 0392 R2: an empty pool still leaves an attempt, and its zero is observed — the no-content
        // path must distinguish "QC dropped everything" from "nothing was recorded".
        const selection = JSON.parse(
            readFileSync(join(workDir, '21-plan', 'topic-selection-attempts.json'), 'utf-8'),
        ) as { attempts: { counts: Record<string, number | null> }[]; reconciliation: { zeroKept: boolean } };
        expect(selection.attempts[0]?.counts.preFilter).toBe(2);
        expect(selection.attempts[0]?.counts.kept).toBe(0);
        expect(selection.reconciliation.zeroKept).toBe(true);
        // No content node ran, so the only real dispatch is the executor probe. `--version` /
        // `--list-models` are capability probes the roster check makes, not spend on content.
        const agentCalls = readFileSync(fx.agentLog, 'utf-8').trim().split('\n').filter(Boolean);
        const dispatches = agentCalls.filter((call) => !/ --(version|list-models)\b/.test(call));
        expect(dispatches).toHaveLength(1);
        expect(dispatches[0]).toContain('Reply with exactly: OK');
    }, 240_000);
});

/** Guard: the reference bundle above must not be a copy of the workflow's own file. */
describe('kk-news-generate fixture', () => {
    it('keeps the voice3 reference stages real (the matrix freeze runs in the CLI)', () => {
        const fx = makeFixture();
        expect(existsSync(join(fx.pkg, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts'))).toBe(true);
        expect(dirname(fx.config)).toBe(fx.root);
    });
});
