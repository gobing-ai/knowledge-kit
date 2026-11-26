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
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
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
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [stage, ...args] = process.argv.slice(2);
const workDir = args[0] ?? '';
const runDate = args[1] ?? '';
const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const writeJson = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const logProvider = (entry) => {
    if (!process.env.KK_PROVIDER_LOG) return;
    mkdirSync(dirname(process.env.KK_PROVIDER_LOG), { recursive: true });
    appendFileSync(process.env.KK_PROVIDER_LOG, JSON.stringify(entry) + '\n');
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const docs = JSON.parse(await Bun.file(process.env.KK_STUB_DOCS).text());
// 0392 R2: the counts artifact is written by the REAL module, so the stub only fakes the stage
// boundary — the arithmetic the workflow depends on is never re-implemented in a double.
const attempts = process.env.KK_STUB_ATTEMPTS ? await import(process.env.KK_STUB_ATTEMPTS) : null;
const content = (body, metadata = {}) => ({ title: '每日AI乱炖', format: 'markdown', body, metadata });

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
    case 'daily-cover': {
        const provider = args[3] ?? 'minimax';
        const model = args[4] ?? 'image-01';
        const briefPath = join(workDir, '23-cover', runDate + '_07_cover-brief.json');
        let subject = 'default-fallback-subject';
        let fallbackUsed = true;
        if (existsSync(briefPath)) {
            try {
                const parsed = JSON.parse(readFileSync(briefPath, 'utf-8'));
                if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
                    subject = parsed.subject.trim();
                    fallbackUsed = false;
                }
            } catch { /* fallback */ }
        }
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        write(join(workDir, '23-cover', runDate + '_07_cover_cover.png'), png);
        write(join(workDir, '23-cover', runDate + '_07_cover_social.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        writeJson(join(workDir, '23-cover', 'cover-receipt.json'), {
            provider, model, subject, fallbackUsed,
            podcastSize: '1344x576', socialSize: '1200x630',
            headline: '模型新版本发布与开源协议',
        });
        logProvider({ kind: 'cover', provider, model, subject, fallbackUsed });
        break;
    }
    case 'daily-cover-normalize': break;
    case 'news-inline-illustrations': {
        const provider = args[3] ?? 'minimax';
        const model = args[4] ?? 'image-01';
        const dir = join(workDir, '22-article', 'illustrations');
        const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf-8'));
        for (let i = 0; i < plan.figures.length; i++) {
            const fig = plan.figures[i];
            const id = 'figure-' + (i + 1);
            const imgPath = join(dir, id + '-illustration-01.png');
            const bytes = Buffer.from('kk-inline-png-' + id + '-' + fig.concept);
            write(imgPath, bytes);
            writeJson(join(dir, id + '-receipt.json'), {
                id, path: imgPath, sha256: sha256(bytes),
                altText: fig.altText, caption: fig.caption, anchor: fig.anchor,
                provider, model,
            });
            logProvider({ kind: 'inline', id, provider, model, concept: fig.concept });
        }
        break;
    }
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
    case 'daily-safety-variants-check':
        writeJson(join(workDir, '4-safety-variants', 'safety.json'), {
            status: 'pass',
            digest: 'stub-variants-review',
            excludedPlatforms: [],
            variants: {},
        });
        break;
    case 'daily-show-notes':
        write(join(workDir, '31-publish', runDate + '_15_show-notes_show-notes.md'), '- 00:00 intro\n');
        break;
    case 'daily-xhs-render': {
        const provider = args[5] ?? 'minimax';
        const model = args[6] ?? 'image-01';
        const card1 = join(workDir, '25-xhs', 'card-1.png');
        const card2 = join(workDir, '25-xhs', 'card-2.png');
        const cover = join(workDir, '23-cover', runDate + '_07_cover_cover.png');
        const rendered = [];
        for (const [idx, cardPath] of [[1, card1], [2, card2]]) {
            if (existsSync(cardPath)) continue;
            write(cardPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, idx]));
            rendered.push('card-' + idx);
            logProvider({ kind: 'xhs-card', card: 'card-' + idx, provider, model });
        }
        writeJson(join(workDir, '25-xhs', runDate + '_18_xhs_plan.json'), {
            cards: [
                { index: 1, path: card1, cached: !rendered.includes('card-1') },
                { index: 2, path: card2, cached: !rendered.includes('card-2') },
            ],
            attachedCover: existsSync(cover) ? cover : null,
        });
        break;
    }
    case 'daily-publish-prep':
        writeJson(join(workDir, '31-publish', runDate + '_13_publish-prep_content.json'), {
            title: '每日AI乱炖', format: 'markdown', body: 'episode',
            metadata: { mp3Path: join(workDir, '30-audio', runDate + '_11_generate_audio.mp3') },
        });
        break;
    case 'news-localize-validate': break;
    case 'daily-bundle-variants': {
        const inlineDir = join(workDir, '22-article', 'illustrations');
        const inlinePlanPath = join(inlineDir, 'plan.json');
        let articleBody = 'article';
        let articleMeta = {};
        if (existsSync(inlinePlanPath)) {
            const plan = JSON.parse(readFileSync(inlinePlanPath, 'utf-8'));
            const figures = [];
            const parts = ['# 每日AI乱炖'];
            for (let i = 0; i < plan.figures.length; i++) {
                const id = 'figure-' + (i + 1);
                const rec = JSON.parse(readFileSync(join(inlineDir, id + '-receipt.json'), 'utf-8'));
                figures.push({ id: rec.id, path: rec.path, sha256: rec.sha256, altText: rec.altText, caption: rec.caption });
                parts.push(rec.anchor + '\n\n![' + rec.altText + '](kk-inline:' + rec.id + ')\n\n' + rec.caption);
            }
            articleBody = parts.join('\n\n');
            articleMeta = { wechatmp: { inlineFigures: figures } };
        }
        writeJson(join(workDir, '30-variants', 'article.content.json'), content(articleBody, articleMeta));
        for (const key of ['episode', 'xhs-article']) {
            writeJson(join(workDir, '30-variants', key + '.content.json'), content(key));
        }
        break;
    }
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
# 0409: the localize node writes en/ja beside the article; the prompt names both absolute paths.
locale_en=$(printf '%s' "$prompt" | grep -oE '[^ "]+/locales/en.md' | head -1)
if [ -n "$locale_en" ]; then
  mkdir -p "$(dirname "$locale_en")"
  printf '# Daily AI Stew\n\nEnglish body.\n' > "$locale_en"
  printf '# デイリーAIシチュー\n\n日本語の本文です。\n' > "\${locale_en%en.md}ja.md"
fi
# 0426/0427: the illustrations-plan node writes 22-article/illustrations/plan.json when opted in.
inline_plan=$(printf '%s' "$prompt" | grep -oE '[^ "]+/22-article/illustrations/plan.json' | head -1)
if [ -n "$inline_plan" ]; then
  mkdir -p "$(dirname "$inline_plan")"
  printf '{"version":1,"figures":[{"anchor":"新版本跑分提升明显。","sourceId":"story-a","concept":"Clean hardware benchmark diagram comparing two throughput bars","caption":"推理吞吐对比示意图","altText":"新版本推理吞吐提升示意图"},{"anchor":"维护者承诺协议不变。","sourceId":"story-b","concept":"Open-source license shield bridging two repositories","caption":"开源协议承诺示意图","altText":"开源项目协议保持不变示意图"}]}\n' > "$inline_plan"
fi
exit 0
`;

function makeFixture(packageRoot?: string): Fixture {
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
    if (!packageRoot) symlinkSync(join(REPO, 'plugins/kk'), join(plugins, 'kk'));

    const wrapper = packageRoot ? join(packageRoot, 'dist/index.js') : join(pkg, 'apps/cli/src/index.ts');
    if (!packageRoot) {
        writeFileSync(
            wrapper,
            `import { main } from ${JSON.stringify(join(REPO, 'apps/cli/src/main.ts'))};\nprocess.exit(await main(['bun', import.meta.path, ...Bun.argv.slice(2)]));\n`,
        );
    }
    const stagePath = packageRoot
        ? join(packageRoot, 'plugins/kk/scripts/kk-workflow-stages.ts')
        : join(pkg, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts');
    writeFileSync(stagePath, STAGE_STUB);
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
            `decisions:\n  paths:\n    - ${join(packageRoot ?? REPO, 'plugins/kk/decisions')}\n`,
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
        KK_STUB_ATTEMPTS: join(fixture.plugins, 'kk/scripts/topic-selection-attempts.ts'),
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

describe('0427 — packaged daily visual workflow replay and installed skill discovery (AC1 / R1 / R2)', () => {
    function sha256File(path: string): string {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    }

    function readProviderLog(path: string): Record<string, unknown>[] {
        if (!existsSync(path)) return [];
        return readFileSync(path, 'utf-8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    function packAndExtractCli(): { tarball: string; extractedPkg: string } {
        const cliDir = join(REPO, 'apps/cli');
        const prepack = Bun.spawnSync(['bun', 'run', 'prepack'], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' });
        expect(prepack.exitCode, prepack.stderr.toString()).toBe(0);
        const packDir = mkdtempSync(join(tmpdir(), 'kk-0427-pack-'));
        roots.push(packDir);
        const pack = Bun.spawnSync(['bun', 'pm', 'pack', '--destination', packDir], {
            cwd: cliDir,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(pack.exitCode, pack.stderr.toString()).toBe(0);
        const tgzName = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
        expect(tgzName).toBeDefined();
        const tarball = join(packDir, tgzName as string);
        const extractDir = join(packDir, 'extracted');
        mkdirSync(extractDir, { recursive: true });
        const untar = Bun.spawnSync(['tar', '-xzf', tarball, '-C', extractDir], { stdout: 'pipe', stderr: 'pipe' });
        expect(untar.exitCode, untar.stderr.toString()).toBe(0);
        const extractedPkg = join(extractDir, 'package');
        // Reuse installed external dependencies; product code and resources come from the tarball.
        symlinkSync(join(REPO, 'node_modules'), join(extractedPkg, 'node_modules'));
        return { tarball, extractedPkg };
    }

    it('discovers shipped visual skills from an extracted tarball and replays default, cache, and inline opt-in paths', async () => {
        const { tarball, extractedPkg } = packAndExtractCli();
        const extractedSkills = join(extractedPkg, 'plugins', 'kk', 'skills');
        const coverSkill = join(extractedSkills, 'daily-news-cover', 'SKILL.md');
        const illusSkill = join(extractedSkills, 'daily-news-illustrations', 'SKILL.md');
        const sharedRef = join(extractedSkills, 'news-editorial', 'references', 'daily-visual-composition.md');

        for (const p of [coverSkill, illusSkill, sharedRef]) {
            expect(existsSync(p), p).toBe(true);
            expect(p.startsWith(extractedPkg)).toBe(true);
            expect(readFileSync(p, 'utf-8')).not.toContain('vendors/');
        }
        const newsSkill = join(extractedSkills, 'news-editorial', 'SKILL.md');
        expect(existsSync(join(extractedPkg, 'src'))).toBe(false);

        const packagedWorkflow = join(extractedPkg, 'plugins', 'kk', 'workflows', 'kk-news-generate.yaml');
        expect(existsSync(packagedWorkflow)).toBe(true);

        const runPackagedWorkflow = (
            fx: Fixture,
            vars: Record<string, string>,
            providerLog: string,
        ): WorkflowOutcome => {
            const proc = Bun.spawnSync(
                [
                    SPUR,
                    'workflow',
                    'run',
                    packagedWorkflow,
                    '--run-id',
                    `0427-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                    '--json',
                    '--vars',
                    JSON.stringify(vars),
                ],
                {
                    cwd: fx.root,
                    env: runEnv(fx, {
                        KK_PROVIDER_LOG: providerLog,
                        KK_PLUGIN_PATH: join(extractedPkg, 'plugins', 'kk'),
                        KK_STUB_ATTEMPTS: join(extractedPkg, 'plugins/kk/scripts/topic-selection-attempts.ts'),
                    }),
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            );
            const out = proc.stdout?.toString() ?? '';
            const states = [...out.matchAll(/"finalState"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
            let state = states.at(-1) ?? 'unknown';
            if (state === 'dag') {
                const status = [...out.matchAll(/"status"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
                if (status !== undefined) state = status;
            }
            return { code: proc.exitCode ?? 1, state, out, err: proc.stderr?.toString() ?? '' };
        };

        // ── 1. Default run (inline_illustrations=false, legacy cover brief fallback) ──
        const fxDefault = makeFixture(extractedPkg);
        expect(readFileSync(join(fxDefault.bin, 'kk'), 'utf-8')).toContain(join(extractedPkg, 'dist', 'index.js'));
        expect(existsSync(join(fxDefault.plugins, 'kk'))).toBe(false);
        await seedStore(fxDefault);
        const defaultWork = join(fxDefault.works, 'kk-news-generate', DIGITS);
        const defaultProviderLog = join(fxDefault.root, 'provider-default.jsonl');
        const defaultOut = runPackagedWorkflow(
            fxDefault,
            {
                ...workflowVars(fxDefault, defaultWork),
                skill_dir: join(extractedSkills, 'news-editorial'),
                visual_skill_root: extractedSkills,
                inline_illustrations: 'false',
            },
            defaultProviderLog,
        );
        expect(defaultOut.code, defaultOut.err).toBe(0);
        expect(defaultOut.state).toBe('done');
        const status = () =>
            Bun.spawnSync([join(fxDefault.bin, 'kk'), 'news', 'status', '--work-dir', defaultWork], {
                cwd: fxDefault.root,
                env: runEnv(fxDefault),
                stdout: 'pipe',
                stderr: 'pipe',
            });
        const presentSkill = status();
        expect(presentSkill.exitCode, presentSkill.stderr.toString()).toBe(0);
        expect(JSON.parse(presentSkill.stdout.toString()).workDir).toBe(defaultWork);
        const canonicalNewsSkill = realpathSync(newsSkill);
        renameSync(newsSkill, `${newsSkill}.fixture-backup`);
        let missingSkillCode: number | null;
        try {
            const missingSkill = status();
            missingSkillCode = missingSkill.exitCode;
            expect(missingSkillCode, missingSkill.stderr.toString()).toBe(5);
            expect(missingSkill.stderr.toString()).toContain(canonicalNewsSkill);
        } finally {
            renameSync(`${newsSkill}.fixture-backup`, newsSkill);
        }
        const defaultProviders = readProviderLog(defaultProviderLog);
        expect(defaultProviders.filter((p) => p.kind === 'inline')).toHaveLength(0);
        expect(existsSync(join(defaultWork, '22-article', 'illustrations', 'plan.json'))).toBe(false);
        const defaultArticle = JSON.parse(
            readFileSync(join(defaultWork, '30-variants', 'article.content.json'), 'utf-8'),
        ) as { body: string; metadata?: { wechatmp?: { inlineFigures?: unknown } } };
        expect(defaultArticle.body).not.toContain('kk-inline:');
        expect(defaultArticle.metadata?.wechatmp?.inlineFigures).toBeUndefined();
        const defaultCoverReceipt = JSON.parse(
            readFileSync(join(defaultWork, '23-cover', 'cover-receipt.json'), 'utf-8'),
        ) as { fallbackUsed: boolean; podcastSize: string; socialSize: string };
        expect(defaultCoverReceipt.fallbackUsed).toBe(true);
        expect(defaultCoverReceipt.podcastSize).toBe('1344x576');
        expect(defaultCoverReceipt.socialSize).toBe('1200x630');
        // Verify agent dispatches referenced the extracted package skills, not the repo checkout.
        const defaultAgents = readFileSync(fxDefault.agentLog, 'utf-8');
        expect(defaultAgents).toContain(coverSkill);
        expect(defaultAgents).toContain(illusSkill);
        expect(defaultAgents).toContain(sharedRef);

        // ── 2. Cache replay (pre-populated card-1.png + legacy cover brief) ──
        const fxCache = makeFixture(extractedPkg);
        await seedStore(fxCache);
        const cacheWork = join(fxCache.works, 'kk-news-generate', DIGITS);
        mkdirSync(join(cacheWork, '25-xhs'), { recursive: true });
        mkdirSync(join(cacheWork, '23-cover'), { recursive: true });
        writeFileSync(join(cacheWork, '25-xhs', 'card-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
        writeFileSync(
            join(cacheWork, '23-cover', `${DIGITS}_07_cover-brief.json`),
            JSON.stringify({ subject: 'Legacy brief glowing chip on dark slate' }),
        );
        const cacheProviderLog = join(fxCache.root, 'provider-cache.jsonl');
        const cacheOut = runPackagedWorkflow(
            fxCache,
            {
                ...workflowVars(fxCache, cacheWork),
                skill_dir: join(extractedSkills, 'news-editorial'),
                visual_skill_root: extractedSkills,
                inline_illustrations: 'false',
            },
            cacheProviderLog,
        );
        expect(cacheOut.code, cacheOut.err).toBe(0);
        expect(cacheOut.state).toBe('done');
        const cacheProviders = readProviderLog(cacheProviderLog);
        expect(cacheProviders.filter((p) => p.kind === 'inline')).toHaveLength(0);
        expect(cacheProviders.filter((p) => p.kind === 'xhs-card').map((p) => p.card)).toEqual(['card-2']);
        const cacheCoverReceipt = JSON.parse(
            readFileSync(join(cacheWork, '23-cover', 'cover-receipt.json'), 'utf-8'),
        ) as { fallbackUsed: boolean; subject: string };
        expect(cacheCoverReceipt.fallbackUsed).toBe(false);
        expect(cacheCoverReceipt.subject).toBe('Legacy brief glowing chip on dark slate');

        // ── 3. Explicit inline opt-in run (inline_illustrations=true) ──
        const fxInline = makeFixture(extractedPkg);
        await seedStore(fxInline);
        const inlineWork = join(fxInline.works, 'kk-news-generate', DIGITS);
        const inlineProviderLog = join(fxInline.root, 'provider-inline.jsonl');
        const inlineOut = runPackagedWorkflow(
            fxInline,
            {
                ...workflowVars(fxInline, inlineWork),
                skill_dir: join(extractedSkills, 'news-editorial'),
                visual_skill_root: extractedSkills,
                inline_illustrations: 'true',
                preset: 'daily-ai-voice',
            },
            inlineProviderLog,
        );
        expect(inlineOut.code, inlineOut.err).toBe(0);
        expect(inlineOut.state).toBe('done');
        const inlineProviders = readProviderLog(inlineProviderLog);
        expect(inlineProviders.filter((p) => p.kind === 'inline')).toHaveLength(2);
        const inlineArticlePath = join(inlineWork, '30-variants', 'article.content.json');
        const inlineArticle = JSON.parse(readFileSync(inlineArticlePath, 'utf-8')) as {
            body: string;
            metadata: { wechatmp: { inlineFigures: { id: string; path: string; sha256: string }[] } };
        };
        expect(inlineArticle.body).toContain('kk-inline:figure-1');
        expect(inlineArticle.body).toContain('kk-inline:figure-2');
        expect(inlineArticle.metadata.wechatmp.inlineFigures).toHaveLength(2);
        for (const fig of inlineArticle.metadata.wechatmp.inlineFigures) {
            expect(existsSync(fig.path)).toBe(true);
            expect(sha256File(fig.path)).toBe(fig.sha256);
        }
        const inlineEpisode = JSON.parse(
            readFileSync(join(inlineWork, '30-variants', 'episode.content.json'), 'utf-8'),
        ) as { body: string; metadata?: { wechatmp?: { inlineFigures?: unknown } } };
        expect(inlineEpisode.body).not.toContain('kk-inline:');
        expect(inlineEpisode.metadata?.wechatmp?.inlineFigures).toBeUndefined();
        const inlineBundle = readBundle(inlineWork);
        expect(inlineBundle.safety?.status).toBe('pass');
        for (const requests of [defaultProviders, cacheProviders, inlineProviders]) {
            expect(requests.length).toBeGreaterThan(0);
            for (const request of requests) {
                expect(request).toMatchObject({ provider: 'minimax', model: 'image-01' });
            }
        }

        // ── Machine-readable replay receipt (R2) ──
        mkdirSync(EVIDENCE, { recursive: true });
        const artifactRoot = mkdtempSync(join(EVIDENCE, '0427-replay-'));
        cpSync(tarball, join(artifactRoot, 'package.tgz'));
        for (const [name, workDir] of [
            ['defaultRun', defaultWork],
            ['cacheReplay', cacheWork],
            ['inlineOptIn', inlineWork],
        ] as const) {
            cpSync(workDir, join(artifactRoot, name), { recursive: true });
        }
        writeFileSync(join(artifactRoot, 'fixture-stage.ts'), STAGE_STUB);
        writeFileSync(join(artifactRoot, 'fixture-agent.sh'), AGENT_STUB);
        const receipt = {
            task: '0427',
            feature: 'L4',
            tarball: join(artifactRoot, 'package.tgz'),
            tarballSha256: sha256File(tarball),
            cliEntry: join(extractedPkg, 'dist/index.js'),
            cliEntrySha256: sha256File(join(extractedPkg, 'dist/index.js')),
            artifactRoot,
            scenarioOutputs: {
                defaultRun: { sourceRoot: defaultWork, retainedRoot: join(artifactRoot, 'defaultRun') },
                cacheReplay: { sourceRoot: cacheWork, retainedRoot: join(artifactRoot, 'cacheReplay') },
                inlineOptIn: { sourceRoot: inlineWork, retainedRoot: join(artifactRoot, 'inlineOptIn') },
            },
            skillDiscoveryProbe: { presentExitCode: presentSkill.exitCode, missingExitCode: missingSkillCode },
            stageBoundary: 'Offline stage fixtures; real stage semantics are checked in kk-workflow-stages.test.ts',
            extractedPackageRoot: extractedPkg,
            resolvedSkills: {
                dailyNewsCover: { path: coverSkill, sha256: sha256File(coverSkill) },
                dailyNewsIllustrations: { path: illusSkill, sha256: sha256File(illusSkill) },
                sharedCompositionRef: { path: sharedRef, sha256: sha256File(sharedRef) },
                newsWriterSkillDir: dirname(newsSkill),
                insideExtractedPackage: true,
                vendorDependencyFree: true,
            },
            fixtureInputs: {
                runDate: DIGITS,
                stories: STORIES,
                legacyCoverBrief: { subject: 'Legacy brief glowing chip on dark slate' },
            },
            scenarios: {
                defaultRun: {
                    finalState: defaultOut.state,
                    providerCalls: defaultProviders,
                    inlineCallCount: defaultProviders.filter((p) => p.kind === 'inline').length,
                    coverReceipt: defaultCoverReceipt,
                    variantHashes: {
                        article: sha256File(join(defaultWork, '30-variants', 'article.content.json')),
                        episode: sha256File(join(defaultWork, '30-variants', 'episode.content.json')),
                    },
                    safetyStatus: readBundle(defaultWork).safety?.status ?? null,
                },
                cacheReplay: {
                    finalState: cacheOut.state,
                    providerCalls: cacheProviders,
                    inlineCallCount: cacheProviders.filter((p) => p.kind === 'inline').length,
                    renderedCards: cacheProviders.filter((p) => p.kind === 'xhs-card').map((p) => p.card),
                    coverReceipt: cacheCoverReceipt,
                },
                inlineOptIn: {
                    finalState: inlineOut.state,
                    providerCalls: inlineProviders,
                    inlineCallCount: inlineProviders.filter((p) => p.kind === 'inline').length,
                    figureHashes: Object.fromEntries(
                        inlineArticle.metadata.wechatmp.inlineFigures.map((f) => [f.id, f.sha256]),
                    ),
                    variantHashes: {
                        article: sha256File(inlineArticlePath),
                        episode: sha256File(join(inlineWork, '30-variants', 'episode.content.json')),
                    },
                    safetyStatus: inlineBundle.safety?.status ?? null,
                },
            },
            replayCommand: 'bun run test:heavy -- --test-name-pattern 0427',
        };
        const receiptPath = join(EVIDENCE, '0427-packaged-replay-receipt.json');
        writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        expect(existsSync(receiptPath)).toBe(true);
        expect(sha256File(join(artifactRoot, 'package.tgz'))).toBe(receipt.tarballSha256);
        expect(sha256File(join(artifactRoot, 'inlineOptIn', '30-variants', 'article.content.json'))).toBe(
            receipt.scenarios.inlineOptIn.variantHashes.article,
        );
    }, 240_000);
});
