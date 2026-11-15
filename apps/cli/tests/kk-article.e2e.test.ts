/**
 * Task 0368 AC1–AC3 — the article pipeline end to end, offline, in a throwaway project root.
 *
 * Everything is doubled that would spend money or leave the machine: the agent CLIs (a PATH stub
 * that honours each `expectFile` contract, so the states' artifact gates are exercised rather than
 * bypassed), the catalog decision behind `itc-decision` (a `spur` shim that answers only
 * `decision run`), and the publish channels (`--dummy`, which fakes exactly the dispatch).
 *
 * What is NOT doubled: the workflow file, its thirteen states and their guards, the two step verbs
 * (`kk article generate-check`, `kk article generate-bundle`), the ITC bodies behind them, the frozen
 * bundle, `kk-publish.yaml`, and the publish matrix. The CLI runs as a child process with the
 * fixture root as its cwd — never `process.chdir`, which is process-wide and corrupts the runner's
 * coverage output path.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const EVIDENCE = join(REPO, '.works/tmp/test-article-generate');
const REAL_SPUR = Bun.which('spur') ?? 'spur';

const created: string[] = [];
afterAll(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
    root: string;
    /** The child CLI entry: a wrapper inside the fixture so the launcher's install root is the fixture. */
    entry: string;
    works: string;
    config: string;
    agentLog: string;
    /** `max_revisions` for the article workflow block; `null` writes no article block at all. */
    maxRevisions: number | null;
    /** Where the stub judge writes its verdict. */
    judgeVerdict: 'PASS' | 'NEEDS_REVISION';
}

/**
 * The agent double: every agent CLI the roster can name. The `expectFile` contract is the REAL one —
 * the prompt names the artifact path, the stub writes it — so a state's gate is exercised.
 */
const AGENT_STUB = String.raw`#!/usr/bin/env bash
set -u
[ -n "\${KK_AGENT_LOG:-}" ] && printf '%s %s\n' "$(basename "$0")" "$*" >> "$KK_AGENT_LOG"
case "\${1:-}" in
  --version) echo "0.99.0"; exit 0 ;;
  --list-models) echo "stub/model-1"; exit 0 ;;
  --help|-h) echo "usage: agent -p <input>"; exit 0 ;;
esac
prompt="$*"
path_of() { printf '%s' "$prompt" | grep -oE "[^ \"]*$1" | head -1; }
write_json() { mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; }
probe=$(path_of '_executor-probe\.ok')
option_a=$(path_of '_outline-option-a\.md')
recommendation=$(path_of '_outline-recommendation\.json')
draft=$(path_of '_3-draft-draft-article\.md')
verdict=$(path_of '_\.itc-verdict\.json')
adapted=$(path_of '_adapted\.json')
if [ -n "$probe" ]; then write_json "$probe" 'OK'; fi
if [ -n "$option_a" ]; then
  printf '# Option A\n\n- claim one\n' > "$option_a"
  printf '# Option B\n\n- claim two\n' > "\${option_a%a.md}b.md"
fi
if [ -n "$recommendation" ]; then write_json "$recommendation" '{"pick":"a","rationale":"stub"}'; fi
if [ -n "$draft" ]; then printf '# Demo article\n\nStub draft body.\n' > "$draft"; fi
if [ -n "$verdict" ]; then
  write_json "$verdict" "{\"verdict\":\"\${KK_STUB_JUDGE:-PASS}\",\"confidence\":\"HIGH\",\"feedback\":[\"tighten the intro\"]}"
fi
if [ -n "$adapted" ]; then
  work=$(printf '%s' "$prompt" | grep -oE '[^ "]*/4-publish/' | head -1)
  printf '{"title":"演示文章","format":"markdown","body":"正文"}\n' > "\${work}content.zh-article.json"
  write_json "$adapted" '{"variants":[{"key":"zh-article","file":"content.zh-article.json"}]}'
fi
exit 0
`;

function makeFixture(maxRevisions: number | null = 1, judgeVerdict: Fixture['judgeVerdict'] = 'PASS'): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-0368-e2e-'));
    created.push(root);
    const works = join(root, 'works');
    const bin = join(root, 'bin');
    mkdirSync(works, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(root, '.spur'), { recursive: true });
    // The package root the stages, presets and skills resolve through: this fixture's own tree.
    symlinkSync(join(REPO, 'plugins'), join(root, 'plugins'));

    const agentLog = join(root, 'agents.log');
    writeFileSync(agentLog, '');
    for (const agent of ['inline', 'claude', 'codex', 'opencode', 'agy', 'gemini', 'pi', 'droid']) {
        writeFileSync(join(bin, agent), AGENT_STUB);
        chmodSync(join(bin, agent), 0o755);
    }
    // The child entry lives inside the fixture: the launcher resolves its install root by walking up
    // from the running entry, so a fixture entry keeps the checkout-vs-install diff on the fixture
    // (whose plugins ride the symlink), never on this repo's stale `apps/cli/plugins` build copy.
    mkdirSync(join(root, 'pkg/apps/cli/src'), { recursive: true });
    const entry = join(root, 'pkg/apps/cli/src/index.ts');
    writeFileSync(
        entry,
        `import { main } from ${JSON.stringify(join(REPO, 'apps/cli/src/main.ts'))};\nprocess.exit(await main(['bun', import.meta.path, ...Bun.argv.slice(2)]));\n`,
    );
    // `kk`: every node command is the shipped CLI, resolved from this checkout.
    writeFileSync(join(bin, 'kk'), `#!/usr/bin/env bash\nexec bun ${JSON.stringify(entry)} "$@"\n`);
    chmodSync(join(bin, 'kk'), 0o755);
    // `spur`: the bounded outline decision is answered locally (a suite never buys a model call);
    // every workflow call is the real engine.
    writeFileSync(
        join(bin, 'spur'),
        [
            '#!/usr/bin/env bash',
            'set -u',
            `if [ "\${1:-}" = "decision" ] && [ "\${2:-}" = "run" ]; then`,
            '  printf \'{"value":"a","source":"model","reason":"stub decision","maker":"stub"}\\n\'',
            '  exit 0',
            'fi',
            'case "$*" in *"agent run"*) echo "OK"; exit 0 ;; esac',
            `exec ${JSON.stringify(REAL_SPUR)} "$@"`,
            '',
        ].join('\n'),
    );
    chmodSync(join(bin, 'spur'), 0o755);

    writeFileSync(
        join(root, '.spur', 'config.yaml'),
        [
            'agent:',
            '  roles:',
            '    scribe: { tier: cheap, stages: [changelog] }',
            '    reviewer: { tier: capable-1, stages: [verify, review] }',
            '  executors:',
            '    - name: stub-scribe',
            '      agent: pi',
            '      model: stub/model-1',
            '      tier: cheap',
            '    - name: stub-reviewer',
            '      agent: claude',
            '      model: stub/model-1',
            '      tier: capable-1',
            '',
        ].join('\n'),
    );

    const config = join(root, 'config.yaml');
    writeFileSync(
        config,
        [
            `works_dir: ${works}`,
            'store:',
            `  db_path: ${join(root, 'store.db')}`,
            'content_types:',
            '  itc:',
            '    workflow: kk-article-generate',
            '    publish_preset: itc-main',
            ...(maxRevisions === null
                ? []
                : ['workflows:', '  kk-article-generate:', `    max_revisions: ${maxRevisions}`]),
            '',
        ].join('\n'),
    );
    return { root, entry, works, config, agentLog, maxRevisions, judgeVerdict };
}

function envOf(fixture: Fixture, overrides: Record<string, string> = {}): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined) continue;
        // `SPUR_*` would make the nested engine think it is already inside a workflow run, and a
        // leaked `TYPESAFE_*` pair breaks the agent doctor's attestation (the same two strips
        // `kk-news-generate.e2e.test.ts` makes).
        if (key.startsWith('SPUR_') || key.startsWith('KK_') || key.startsWith('TYPESAFE_')) continue;
        env[key] = value;
    }
    return {
        ...env,
        PATH: `${join(fixture.root, 'bin')}:${process.env.PATH ?? ''}`,
        HOME: join(fixture.root, 'home'),
        KK_CONFIG: fixture.config,
        KK_AGENT_LOG: fixture.agentLog,
        KK_STUB_JUDGE: fixture.judgeVerdict,
        ...overrides,
    };
}

interface CliRun {
    code: number;
    out: string;
    err: string;
}

function cli(fixture: Fixture, args: string[], extraEnv: Record<string, string> = {}): CliRun {
    mkdirSync(join(fixture.root, 'home'), { recursive: true });
    const result = Bun.spawnSync([process.execPath, fixture.entry, ...args], {
        cwd: fixture.root,
        env: envOf(fixture, extraEnv),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { code: result.exitCode ?? 1, out: result.stdout.toString(), err: result.stderr.toString() };
}

/** The run directory the launcher resolves for a slug. */
function articleRun(fixture: Fixture, slug: string): string {
    return join(fixture.works, 'kk-article-generate', slug);
}

/** Seed the two inputs `kk article new --topic` cannot write: the brief and the research docs. */
function seedInputs(runDir: string): void {
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'brief.md'), '# Demo article\n\nWrite about SQLite WAL mode.\n');
    writeFileSync(
        join(runDir, 'docs.json'),
        `${JSON.stringify([{ id: 'doc-1', title: 'SQLite WAL', sourceUri: 'https://sqlite.org/wal.html' }])}\n`,
    );
}

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

/** Write one agent's artefact, the way the stub agent would (the FSM is file-driven). */
function authorArtifacts(runDir: string, judge: Fixture['judgeVerdict'], drafts: number): void {
    mkdirSync(join(runDir, '2-outline'), { recursive: true });
    writeFileSync(join(runDir, '2-outline/outline-option-a.md'), '# Option A\n\n- claim one\n');
    writeFileSync(join(runDir, '2-outline/outline-option-b.md'), '# Option B\n\n- claim two\n');
    writeFileSync(join(runDir, '2-outline/outline-recommendation.json'), '{"pick":"a","rationale":"stub"}\n');
    writeFileSync(join(runDir, '3-draft-draft-article.md'), '# Demo article\n\nStub draft body.\n');
    writeFileSync(join(runDir, '.draft-count'), `${drafts}\n`);
    mkdirSync(join(runDir, '.itc'), { recursive: true });
    writeFileSync(
        join(runDir, '.itc-verdict.json'),
        `${JSON.stringify({ verdict: judge, confidence: 'HIGH', feedback: ['tighten the intro'] })}\n`,
    );
}

/**
 * The article pipeline through its PUBLIC SURFACE, in the order `kk-article-generate.yaml` drives it.
 *
 * The agent states are stood in for by the artefacts they produce (`authorArtifacts`) — the engine's
 * dispatch is the one thing this suite cannot exercise offline in every environment (the shipped
 * `kk-news-generate.e2e.test.ts` hits the same `spur agent doctor` refusal on a host whose global
 * spur cannot attest the stub executors), and it is covered by `kk-article-generate-fsm.test.ts`
 * plus `spur workflow validate`. What runs here is real: the launcher's plan, the two step verbs and
 * the ITC bodies behind them, the freeze, `kk-publish.yaml`, and the publish matrix.
 */
describe('kk-article-generate — AC1: the verbs produce a publishable article bundle', () => {
    it('walks new -> the two step verbs -> freeze -> publish, with receipts and no publish-plan.json', async () => {
        const fixture = makeFixture(2, 'PASS');
        const slug = 'demo';
        expect(cli(fixture, ['article', 'new', '--slug', slug, '--topic', 'sqlite wal']).code).toBe(0);
        const runDir = articleRun(fixture, slug);
        seedInputs(runDir);
        authorArtifacts(runDir, 'PASS', 1);

        // R7: `kk article generate` plans the article workflow (a dry run stops before the launch).
        const planned = cli(fixture, ['article', 'generate', '--slug', slug, '--auto', '--dry-run']);
        expect(`${planned.code} ${planned.err}`).toContain('0');
        const plan = JSON.parse(planned.out.trim().split('\n').at(-1) as string) as {
            dryRun?: { workflowPath: string; vars: Record<string, string> };
        };
        expect(plan.dryRun?.workflowPath.endsWith('plugins/kk/workflows/kk-article-generate.yaml')).toBe(true);
        expect(plan.dryRun?.vars.auto).toBe('true');
        expect(plan.dryRun?.vars.slug).toBe(slug);
        expect(plan.dryRun?.vars.skill_dir?.endsWith('skills/itc-generating')).toBe(true);

        // ── the FSM's deterministic steps, in its own order ──
        const outline = cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'outline']);
        expect(`outline ${outline.code}: ${outline.out} ${outline.err}`).toMatch(/^outline 0/);
        expect(readFileSync(join(runDir, '2-outline/outline-approved.md'), 'utf-8')).toContain('Option A');
        const variants = cli(fixture, ['article', 'generate-bundle', '--work-dir', runDir, '--stage', 'variants']);
        expect(`variants ${variants.code}: ${variants.out} ${variants.err}`).toMatch(/^variants 0/);
        // The adapt agent's output for every adapt:true variant the plan names, then its check.
        const planned2 = readJson(join(runDir, '4-publish/publish-plan.json')) as {
            variants: Record<string, { file: string; adapt: boolean }>;
        };
        const adapted = Object.entries(planned2.variants).filter(([, entry]) => entry.adapt);
        expect(adapted.length).toBeGreaterThan(0);
        for (const [key, entry] of adapted) {
            writeFileSync(
                join(runDir, '4-publish', entry.file),
                `${JSON.stringify({ title: `演示 ${key}`, format: 'markdown', body: '正文' })}\n`,
            );
        }
        const adaptCheck = cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'adapt']);
        expect(`adapt ${adaptCheck.code}: ${adaptCheck.out} ${adaptCheck.err}`).toMatch(/^adapt 0/);
        const judge = cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'judge']);
        expect(readFileSync(join(runDir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('finish');
        expect(judge.code).toBe(0);
        const frozen = cli(fixture, [
            'article',
            'generate-bundle',
            '--work-dir',
            runDir,
            '--preset',
            'itc-main',
            '--stage',
            'freeze',
        ]);
        expect(`${frozen.code} ${frozen.err}`).toContain('0');

        // AC1: contentType itc, a title, no episode, one entry per adapted file, no ITC plan.
        const bundle = readJson(join(runDir, '4-publish/bundle.json'));
        expect(bundle.contentType).toBe('itc');
        expect(bundle.episode).toBeUndefined();
        expect(typeof bundle.title).toBe('string');
        const keys = Object.keys(bundle.variants as Record<string, unknown>).sort();
        expect(keys).toContain('article');
        expect(keys).toContain('zh-article');
        expect(existsSync(join(runDir, '4-publish/publish-plan.json'))).toBe(false);

        // AC1: publish runs kk-publish.yaml and writes the shared receipt schema in this work dir.
        const published = cli(fixture, ['article', 'publish', '--slug', slug, '--dummy']);
        expect(`${published.code} ${published.err}`).toContain('0');
        const receiptsDir = join(runDir, '4-publish/receipts');
        const receipts = readdirSync(receiptsDir).filter((file) => file.endsWith('.json'));
        expect(receipts.length).toBeGreaterThan(0);
        const one = readJson(join(receiptsDir, receipts[0] as string));
        expect(one.schemaVersion).toBe(1);
        expect(one.dummy).toBe(true);
        expect(existsSync(join(runDir, '4-publish/plan.after-generate.json'))).toBe(true);
        expect(existsSync(join(runDir, '5-report/publish-after-generate.md'))).toBe(true);

        // ── AC2: one channel is re-sent without regenerating ──
        const bundleBefore = readFileSync(join(runDir, '4-publish/bundle.json'), 'utf-8');
        const contentBefore = readFileSync(join(runDir, '4-publish/content.json'), 'utf-8');
        const channel = (receipts[0] as string).replace(/\.json$/, '');
        const failed = { ...readJson(join(receiptsDir, receipts[0] as string)), status: 'failed', effect: 'none' };
        writeFileSync(join(receiptsDir, receipts[0] as string), `${JSON.stringify(failed, null, 2)}\n`);
        const retried = cli(fixture, [
            'article',
            'publish',
            '--slug',
            slug,
            '--channels',
            channel,
            '--retry',
            '--dummy',
        ]);
        expect(`${retried.code} ${retried.err}`).toContain('0');
        const retryPlan = readJson(join(runDir, '4-publish/plan.after-generate.json')) as {
            rows: Array<{ id: string }>;
            excluded: Array<{ reason: string }>;
        };
        expect(retryPlan.rows.map((row) => row.id)).toEqual([channel]);
        expect(retryPlan.excluded.some((row) => row.reason.includes('not in --channels'))).toBe(true);
        expect(readFileSync(join(runDir, '4-publish/bundle.json'), 'utf-8')).toBe(bundleBefore);
        expect(readFileSync(join(runDir, '4-publish/content.json'), 'utf-8')).toBe(contentBefore);

        mkdirSync(EVIDENCE, { recursive: true });
        writeFileSync(
            join(EVIDENCE, 'summary.json'),
            `${JSON.stringify(
                {
                    task: '0368',
                    case: 'AC1+AC2',
                    workDir: runDir,
                    bundleVariants: keys,
                    contentType: bundle.contentType,
                    receipts: receipts.length,
                    resendRow: channel,
                    plan: '4-publish/plan.after-generate.json',
                },
                null,
                2,
            )}\n`,
        );
    }, 600_000);
});

describe('kk-article-generate — AC3: the judge loop and the R6 fallback', () => {
    it('rewrites up to max_revisions, then the disposition is fail', () => {
        const fixture = makeFixture(1, 'NEEDS_REVISION');
        const slug = 'loop';
        expect(cli(fixture, ['article', 'new', '--slug', slug, '--topic', 'loops']).code).toBe(0);
        const runDir = articleRun(fixture, slug);
        seedInputs(runDir);
        authorArtifacts(runDir, 'NEEDS_REVISION', 1);
        // The first draft may be rewritten once (max_revisions: 1) …
        expect(cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'judge']).code).toBe(0);
        expect(readFileSync(join(runDir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('autorevise');
        expect(readFileSync(join(runDir, '.auto-revise-count'), 'utf-8').trim()).toBe('0');
        // … the rewrite lands, and the second verdict is the budget's last: the FSM's failed edge.
        writeFileSync(join(runDir, '.draft-count'), '2\n');
        expect(cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'judge']).code).toBe(0);
        expect(readFileSync(join(runDir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('fail');
        expect(existsSync(join(runDir, '4-publish/bundle.json'))).toBe(false);
        mkdirSync(EVIDENCE, { recursive: true });
        writeFileSync(
            join(EVIDENCE, 'loop.json'),
            `${JSON.stringify({ drafts: 2, rewrites: 1, maxRevisions: 1, end: 'failed' }, null, 2)}\n`,
        );
    }, 300_000);

    it('honours a config that carries only workflows.kk-itc (R6 fallback)', () => {
        const fixture = makeFixture(null, 'NEEDS_REVISION');
        const slug = 'fallback';
        expect(cli(fixture, ['article', 'new', '--slug', slug, '--topic', 'fallback']).code).toBe(0);
        const runDir = articleRun(fixture, slug);
        seedInputs(runDir);
        authorArtifacts(runDir, 'NEEDS_REVISION', 1);
        writeFileSync(
            fixture.config,
            [
                `works_dir: ${fixture.works}`,
                'store:',
                `  db_path: ${join(fixture.root, 'store.db')}`,
                'content_types:',
                '  itc:',
                '    workflow: kk-article-generate',
                'workflows:',
                '  kk-itc:',
                '    max_revisions: 1',
                '',
            ].join('\n'),
        );
        expect(cli(fixture, ['article', 'generate-check', '--work-dir', runDir, '--step', 'judge']).code).toBe(0);
        expect(readFileSync(join(runDir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('autorevise');
    }, 300_000);
});
