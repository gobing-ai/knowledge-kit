/**
 * Task 0367 AC2 — the seven generate step verbs compose the existing stages (R1–R6).
 *
 * The proof is execution of the PUBLIC surface: every case spawns the real `kk` binary
 * (`apps/cli/src/index.ts` behind a temp package wrapper) in a throwaway project root outside the
 * repo, and asserts on the one JSON object on stdout, the exit code and the files written. The only
 * doubles are the ones the task sanctions for an offline rehearsal:
 *
 *  - the stage bodies (`plugins/kk/scripts/kk-workflow-stages.ts`), replaced by a recorded runner in
 *    the temp package layout the stage resolver already understands — this is what proves the verb
 *    SEQUENCE, the argv each stage receives and the first-failure stop, without a store, an LLM, TTS
 *    or a card renderer;
 *  - the report generator plugin (`news-report-gen`), a one-line fixture that returns a Content.
 *
 * Everything else is real: the Commander surface, the flag contract, the exit codes, the pool gate,
 * the store selection (a real SQLite store seeded through the store's own DAO), the bundle freeze
 * (`runPublishMatrixBundle`) and the report body (`generateRunReport`).
 *
 * Evidence (summary.json) lands under `.works/tmp/test-news-generate`, the fixture path the task
 * names; the fixtures themselves live in the OS temp dir and are removed afterwards.
 */
import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { createHash } from 'node:crypto';
import {
    chmodSync,
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

/**
 * Every case here spawns the real binary once per verb, so the slowest one is nine child processes
 * (~4.2 s on a workstation, over bun's 5 s default on a CI runner — run 44206669178 timed out and
 * its killed child then read as an empty-stderr assertion failure). The budget is a liveness guard
 * for E2E work, not an assertion: the contracts under test are the exit codes, the JSON and the
 * files, all of which fail on their own terms.
 */
setDefaultTimeout(60_000);
const DIGITS = '20261113';

/** The two fixture stories: the pool, the candidates and the seeded store all carry these ids. */
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
}

const roots: string[] = [];
afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The stage runner double: records each call and writes the artefact the real stage would. */
const STAGE_STUB = String.raw`#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [stage, ...args] = process.argv.slice(2);
const workDir = args[0] ?? '';
const runDate = args[1] ?? '';
const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const writeJson = (path, value) => write(path, JSON.stringify(value, null, 2) + '\n');
const docs = JSON.parse(await Bun.file(process.env.KK_STUB_DOCS).text());
const content = (body) => ({ title: '每日AI乱炖', format: 'markdown', body, metadata: {} });

console.log('stub-stage ' + stage + ' ' + args.join(' '));
if (process.env.KK_STUB_FAIL_STAGE === stage) {
    console.error('stub: ' + stage + ' refused');
    process.exit(3);
}

switch (stage) {
    case 'daily-preflight':
        break;
    case 'daily-extract':
        // 0374: the real dailyExtract writes a bare Doc[] (writeJsonText(picked.docs)); the
        // metadata.docs envelope is the retired shape. KK_STUB_POOL_SHAPE=array exercises
        // what production actually writes.
        writeJson(
            join(workDir, '10-collect', 'pool.json'),
            process.env.KK_STUB_POOL_SHAPE === 'array' ? docs : { metadata: { docs } },
        );
        break;
    case 'daily-plan':
        writeJson(join(workDir, '21-plan', runDate + '_03_plan_content.json'), {
            title: '每日AI乱炖',
            format: 'markdown',
            body: 'plan',
            metadata: { docs },
        });
        break;
    case 'daily-qc-content':
        writeJson(join(workDir, '21-plan', runDate + '_04_quality-control-content_candidates.json'), {
            title: '每日AI乱炖',
            format: 'markdown',
            body: 'candidates',
            metadata: { docs: process.env.KK_STUB_EMPTY_POOL === '1' ? [] : docs },
        });
        break;
    case 'daily-curate-check': {
        const plan = join(workDir, '21-plan', runDate + '_03_plan_plan.json');
        const errors = join(workDir, '21-plan', runDate + '_03_curate_errors.json');
        const final = args.includes('--final');
        if (process.env.KK_STUB_CURATE_REJECT === '1' && !final) {
            writeJson(errors, [{ itemId: 'episode', rule: 'empty-plan' }]);
            break;
        }
        if (final) {
            writeJson(plan, docs);
            writeJson(join(workDir, '21-plan', runDate + '_03_curate_excluded.json'), []);
        } else {
            writeJson(plan, docs);
            writeJson(join(workDir, '21-plan', runDate + '_03_curate_excluded.json'), []);
        }
        if (existsSync(errors)) rmSync(errors, { force: true });
        break;
    }
    case 'daily-script-check': {
        const errors = join(workDir, '24-script', runDate + '_08_script-write_errors.json');
        if (process.env.KK_STUB_SCRIPT_REJECT === '1') writeJson(errors, [{ itemId: 'episode', rule: 'bad' }]);
        else if (existsSync(errors)) rmSync(errors, { force: true });
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
    case 'daily-cover-normalize':
        break;
    case 'daily-wrap-docs':
        writeJson(join(workDir, '30-audio', runDate + '_10_wrap-docs_docs.json'), { metadata: { docs: [] } });
        break;
    case 'daily-generate':
        // A script-gate refusal: the real stage writes this artifact, empties the QC candidates and
        // never produces the generate_content.json that daily-intro needs (0266 refuseScriptBelowFloor).
        if (process.env.KK_STUB_SCRIPT_REFUSAL === '1') {
            writeJson(join(workDir, '30-audio', runDate + '_11_generate_content_duration-refusal.json'), {
                stage: 'script',
                estimatedMinutes: 5.3,
                minMinutes: 15,
                keptCount: 0,
                scriptChars: 1747,
                charRate: 5.6,
                reason: 'the authored script estimates 5.3 min of speech, below the 15 min floor',
            });
            writeJson(join(workDir, '21-plan', runDate + '_04_quality-control-content_candidates.json'), {
                title: '每日AI乱炖',
                format: 'markdown',
                body: 'candidates',
                metadata: { docs: [] },
            });
            break;
        }
        writeJson(join(workDir, '30-audio', runDate + '_11_generate_content.json'), {
            title: '每日AI乱炖',
            format: 'markdown',
            body: 'audio',
            metadata: {
                audioPath: join(workDir, '30-audio', runDate + '_11_generate_audio.wav'),
                mp3Path: join(workDir, '30-audio', runDate + '_11_generate_audio.mp3'),
                duration: 1020,
                qc: { passed: true, overallScore: 88 },
            },
        });
        break;
    case 'daily-intro':
        // The real daily-intro needs the synthesized content and fails loud without it; a double
        // that stays silent would hide exactly the failure the refusal must short-circuit.
        if (!existsSync(join(workDir, '30-audio', runDate + '_11_generate_content.json'))) {
            console.error('stub: daily-intro: required input not found');
            process.exit(1);
        }
        break;
    case 'daily-voice-audit':
    case 'daily-quality-report':
    case 'daily-quality-verdict':
    case 'daily-episode-duration':
        break;
    case 'daily-show-notes':
        write(join(workDir, '31-publish', runDate + '_15_show-notes_show-notes.md'), '- 00:00 intro\n');
        break;
    case 'daily-xhs-render':
        writeJson(join(workDir, '25-xhs', runDate + '_18_xhs_plan.json'), { cards: [] });
        write(join(workDir, '25-xhs', 'card-1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        write(join(workDir, '25-xhs', 'card-2.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        break;
    case 'daily-publish-prep':
        writeJson(join(workDir, '31-publish', runDate + '_13_publish-prep_content.json'), {
            title: '每日AI乱炖',
            format: 'markdown',
            body: 'episode',
            metadata: { mp3Path: join(workDir, '30-audio', runDate + '_11_generate_audio.mp3') },
        });
        break;
    case 'daily-bundle-variants':
        for (const key of ['article', 'episode', 'xhs-article']) {
            writeJson(join(workDir, '30-variants', key + '.content.json'), content(key));
        }
        break;
    case 'daily-safety-manifest':
        break;
    default:
        break;
}
process.exit(0);
`;

/** The report generator double: a `generator` plugin whose Content `body` is the report page. */
const REPORT_PLUGIN = String.raw`#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(
    out,
    JSON.stringify({ title: 'generation report', format: 'markdown', body: '# Daily run report\n', metadata: {} }),
);
process.exit(0);
`;

function makeFixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-0367-ac2-'));
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

    // The shipped kk assets resolve through the fixture root (skills, workflow YAMLs); the report
    // generator resolves through the fixture's own `generations/` so the REAL plugin never runs.
    symlinkSync(join(REPO, 'plugins/kk'), join(plugins, 'kk'));

    // The temp package layout the stage resolver already understands: `argv[1]` is this package's
    // CLI entry, so `resolveStagesScript` picks the stub runner beside it, never the shipped one.
    const wrapper = join(pkg, 'apps/cli/src/index.ts');
    writeFileSync(
        wrapper,
        `import { main } from ${JSON.stringify(join(REPO, 'apps/cli/src/main.ts'))};\nprocess.exit(await main(['bun', import.meta.path, ...Bun.argv.slice(2)]));\n`,
    );
    const stages = join(pkg, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts');
    writeFileSync(stages, STAGE_STUB);
    writeFileSync(
        join(plugins, 'generations/news-report-gen/plugin.json'),
        JSON.stringify({ name: 'news-report-gen', kind: 'generator', entry: 'entry.ts', version: '0.0.1' }),
    );
    writeFileSync(join(plugins, 'generations/news-report-gen/entry.ts'), REPORT_PLUGIN);

    const docsFile = join(root, 'docs.json');
    writeFileSync(docsFile, JSON.stringify(STORIES));

    const kk = join(bin, 'kk');
    writeFileSync(kk, `#!/usr/bin/env bash\nexec "${process.execPath}" "${wrapper}" "$@"\n`);
    chmodSync(kk, 0o755);

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
    return { root, works, bin, pkg, plugins, config, docsFile };
}

/** Seed the fixture store with the two stories, through the store's own write path. */
async function seedStore(fixture: Fixture): Promise<string[]> {
    const path = join(fixture.root, 'store.db');
    const store = await openStore({ path });
    const docs = STORIES.map((story) => ({
        id: itemId({ id: story.id, title: story.title, body: story.body, sourceUri: story.sourceUri }),
        title: story.title,
        body: story.body,
        sourceUri: story.sourceUri,
    }));
    await store.items.upsertDocs('seed-0367', docs, Date.now());
    await store.close();
    // The stub pool/candidates carry the STORE ids, exactly as `kk store extract` would write them.
    writeFileSync(fixture.docsFile, JSON.stringify(docs));
    return docs.map((doc) => doc.id);
}

interface RunResult {
    code: number;
    out: string;
    err: string;
}

function kk(fixture: Fixture, args: string[], extraEnv: Record<string, string> = {}): RunResult {
    const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        PATH: `${fixture.bin}:${process.env.PATH ?? ''}`,
        HOME: join(fixture.root, 'home'),
        KK_CONFIG: fixture.config,
        KK_STUB_DOCS: fixture.docsFile,
        ...extraEnv,
    };
    delete env.KK_WORKS_DIR;
    delete env.SPUR_WORKFLOW_RUN_ACTIVE;
    delete env.SPUR_EXPECTED_DEFINITION_DIGEST;
    const proc = Bun.spawnSync([process.execPath, join(fixture.pkg, 'apps/cli/src/index.ts'), ...args], {
        cwd: fixture.root,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    // A killed child has no exit code; saying so keeps a timeout from reading as "exit 1, no stderr".
    const killed = proc.exitCode === null ? `\nkk did not exit (signal ${String(proc.signalCode)})` : '';
    return {
        code: proc.exitCode ?? 1,
        out: proc.stdout?.toString() ?? '',
        err: `${proc.stderr?.toString() ?? ''}${killed}`,
    };
}

/** The verb printed exactly one JSON object. */
function payload(result: RunResult): Record<string, unknown> {
    const lines = result.out
        .trim()
        .split('\n')
        .filter((line) => line.trim() !== '');
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

describe('kk news generate step verbs — AC2: the nine design invocations', () => {
    // 0374: a real run writes `10-collect/pool.json` as a bare `Doc[]` (dailyExtract calls
    // writeJsonText(picked.docs)), not the `{metadata:{docs}}` envelope the rest of this suite
    // stubs. Reading only the envelope left poolNonEmpty false, so daily-plan and
    // daily-qc-content never ran and every generation settled no-content on real data.
    it('closes a script-gate refusal as no-content instead of failing the voice verb (2026-11-20)', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        expect(kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS]).code).toBe(0);
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'PASS' });

        // The refusal empties the candidates and produces no audio content. Before the fix the verb
        // still ran `daily-intro`, which fails on the missing content → exit 1 → the DAG's
        // `voice-fallback2` failed the whole day, and every node still gated on the stale `PASS`.
        const voice = kk(fx, ['news', 'generate-voice', '--work-dir', workDir, '--engine', 'voxcpm'], {
            KK_STUB_SCRIPT_REFUSAL: '1',
        });
        expect(voice.code).toBe(0);
        expect(existsSync(join(workDir, '30-audio', `${DIGITS}_11_generate_content.json`))).toBe(false);
        // The gate is re-settled on the emptied candidates, so every later node skips — the run
        // closes `done` (a no-content day), not `failed`.
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'EMPTY' });
        expect(readFileSync(join(workDir, 'run-report.summary.txt'), 'utf-8')).toContain('no-content');
    });

    it('reads the bare Doc[] pool.json that dailyExtract writes', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        const prepare = kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS], {
            KK_STUB_POOL_SHAPE: 'array',
        });
        expect(prepare.code).toBe(0);
        const prepared = payload(prepare);
        expect(prepared.pool).toBe('ok');
        expect(prepared.candidates).toBe(2);
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'PASS' });
    });
    it('runs prepare → … → report in order and prints one JSON object each', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        const base = ['--work-dir', workDir];
        const steps: Array<{ args: string[]; expect: (value: Record<string, unknown>) => void }> = [];

        const prepare = kk(fx, ['news', 'prepare', ...base, '--run-date', DIGITS, '--ledger-sync']);
        expect(prepare.code).toBe(0);
        const prepared = payload(prepare);
        expect(prepared.pool).toBe('ok');
        expect(prepared.candidates).toBe(2);
        expect(prepared.selected).toBe(2);
        // R3: the session probe's refusals are REPORTED (this fixture has no browser profile) and
        // never fail the verb — the run's own gates are what decide whether a channel may send.
        const sessions = prepared.sessions as { warnings: string[] };
        expect(Array.isArray(sessions.warnings)).toBe(true);
        expect(sessions.warnings.length).toBeGreaterThan(0);
        expect(prepare.code).toBe(0);
        // R3: the gate is a file INSIDE the run, not a token under .spur/run/.
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'PASS' });
        expect(existsSync(join(fx.root, '.spur/run'))).toBe(false);
        steps.push({ args: ['news', 'prepare', ...base], expect: () => {} });

        const curate = kk(fx, ['news', 'generate-check', ...base, '--step', 'curate']);
        expect(curate.code).toBe(0);
        expect(payload(curate)).toEqual({ step: 'curate', verdict: 'pass' });

        const curateFinal = kk(fx, ['news', 'generate-check', ...base, '--step', 'curate', '--final']);
        expect(curateFinal.code).toBe(0);
        expect(payload(curateFinal)).toEqual({ step: 'curate', verdict: 'pass' });

        const script = kk(fx, ['news', 'generate-check', ...base, '--step', 'script']);
        expect(script.code).toBe(0);
        expect(payload(script)).toMatchObject({ step: 'script', verdict: 'pass' });

        const render = kk(fx, ['news', 'generate-render', ...base]);
        expect(render.code).toBe(0);
        const rendered = payload(render);
        expect(rendered.script).toBe(join(workDir, '24-script', `${DIGITS}_08_script_content.json`));
        expect(rendered.article).toBe(join(workDir, '22-article', `${DIGITS}_06_article_content.json`));
        expect(rendered.cover).toBe(join(workDir, '23-cover', `${DIGITS}_07_cover_cover.png`));

        const voice = kk(fx, ['news', 'generate-voice', ...base, '--engine', 'voxcpm']);
        expect(voice.code).toBe(0);
        expect(payload(voice)).toEqual({
            engine: 'voxcpm',
            audio: join(workDir, '30-audio', `${DIGITS}_11_generate_audio.mp3`),
            durationSec: 1020,
            quality: 'pass',
        });

        const cards = kk(fx, ['news', 'generate-cards', ...base]);
        expect(cards.code).toBe(0);
        expect(payload(cards)).toEqual({ cards: 2, dir: join(workDir, '25-xhs') });

        const variants = kk(fx, [
            'news',
            'generate-bundle',
            ...base,
            '--run-id',
            'run-0367',
            '--run-date',
            DIGITS,
            '--stage',
            'variants',
        ]);
        expect(variants.code).toBe(0);
        const varied = payload(variants);
        expect(varied.variants).toEqual(['article', 'episode', 'xhs-article']);
        expect(varied.safety).toBe('none');

        const freeze = kk(fx, [
            'news',
            'generate-bundle',
            ...base,
            '--run-id',
            'run-0367',
            '--run-date',
            DIGITS,
            '--stage',
            'freeze',
        ]);
        expect(freeze.code).toBe(0);
        const frozen = payload(freeze);
        const bundlePath = join(workDir, 'bundle.json');
        expect(frozen.bundle).toBe(bundlePath);
        expect(frozen.runId).toBe('run-0367');
        expect(frozen.variants).toEqual(['article', 'episode', 'xhs-article']);
        const bundleBytes = readFileSync(bundlePath);
        expect(JSON.parse(bundleBytes.toString() as string)).toMatchObject({
            runDate: DIGITS,
            contentType: 'news',
            variants: { episode: { path: '30-variants/episode.content.json' } },
        });
        expect(createHash('sha256').update(bundleBytes).digest('hex')).toHaveLength(64);

        // R6: a second freeze on a frozen bundle exits 1 and rewrites nothing.
        const refreeze = kk(fx, [
            'news',
            'generate-bundle',
            ...base,
            '--run-id',
            'run-0367',
            '--run-date',
            DIGITS,
            '--stage',
            'freeze',
        ]);
        expect(refreeze.code).toBe(1);
        expect(refreeze.err).toContain('already frozen');
        expect(readFileSync(bundlePath).equals(bundleBytes)).toBe(true);

        const report = kk(fx, ['news', 'report', ...base]);
        expect(report.code).toBe(0);
        expect(payload(report)).toEqual({ report: join(workDir, '5-report', 'generation.md') });
        expect(readFileSync(join(workDir, '5-report', 'generation.md'), 'utf-8')).toContain('Daily run report');
        expect(readFileSync(join(workDir, 'run-report.summary.txt'), 'utf-8')).toContain('items planned');

        steps.push({ args: ['news', 'report', ...base], expect: () => {} });
        mkdirSync(EVIDENCE, { recursive: true });
        writeFileSync(
            join(EVIDENCE, 'summary.json'),
            `${JSON.stringify(
                {
                    task: '0367',
                    case: 'AC2',
                    workDir,
                    bundle: bundlePath,
                    bundleSha256: createHash('sha256').update(bundleBytes).digest('hex'),
                    poolGate: JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8')),
                    invocations: [
                        'news prepare --run-date <digits> --ledger-sync',
                        'news generate-check --step curate',
                        'news generate-check --step curate --final',
                        'news generate-check --step script',
                        'news generate-render',
                        'news generate-voice --engine voxcpm',
                        'news generate-cards',
                        'news generate-bundle --stage variants',
                        'news generate-bundle --stage freeze',
                        'news generate-bundle --stage freeze (second) → exit 1',
                        'news report',
                    ],
                },
                null,
                2,
            )}\n`,
        );
        expect(steps.length).toBeGreaterThan(0);
    });

    it('closes an empty pool as exit 0 with pool empty and an EMPTY gate (R3)', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        const result = kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS], {
            KK_STUB_EMPTY_POOL: '1',
        });
        expect(result.code).toBe(0);
        expect(payload(result)).toMatchObject({ pool: 'empty', candidates: 0, selected: 0 });
        expect(JSON.parse(readFileSync(join(workDir, 'pool-gate.json'), 'utf-8'))).toEqual({ status: 'EMPTY' });
        // A refused pool drops a stale same-day bundle so it can never republish yesterday's freeze.
        expect(existsSync(join(workDir, 'bundle.json'))).toBe(false);
        // ...and carries the no-content verdict the launching verb's receipt status reads, because
        // every later node (the report included) is gated on PASS.
        expect(readFileSync(join(workDir, 'run-report.summary.txt'), 'utf-8')).toStartWith('no-content:');
    });

    it('stops at the first failing stage and names it on stderr (R2)', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS]);
        const failed = kk(fx, ['news', 'generate-render', '--work-dir', workDir], {
            KK_STUB_FAIL_STAGE: 'daily-article',
        });
        expect(failed.code).toBe(1);
        expect(failed.err).toContain("stage 'daily-article' failed (exit 3)");
        // The stages before it ran; the stages after it did not (cover never rendered).
        expect(existsSync(join(workDir, '24-script', `${DIGITS}_08_script_content.json`))).toBe(true);
        expect(existsSync(join(workDir, '23-cover', `${DIGITS}_07_cover_cover.png`))).toBe(false);
        expect(failed.out.trim()).toBe('');
    });

    it('reports a fix verdict with the errors file the next node conditions on (R4)', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS]);
        const errors = join(workDir, '21-plan', `${DIGITS}_03_curate_errors.json`);

        const fix = kk(fx, ['news', 'generate-check', '--work-dir', workDir, '--step', 'curate'], {
            KK_STUB_CURATE_REJECT: '1',
        });
        expect(fix.code).toBe(0);
        expect(payload(fix)).toEqual({ step: 'curate', verdict: 'fix', errors });
        expect(existsSync(errors)).toBe(true);

        // `--final` applies the documented fallback: the errors file existed, so the verdict is
        // `fallback` and the plan is rebuilt from the untranslated candidates.
        const final = kk(fx, ['news', 'generate-check', '--work-dir', workDir, '--step', 'curate', '--final'], {
            KK_STUB_CURATE_REJECT: '1',
        });
        expect(final.code).toBe(0);
        expect(payload(final)).toEqual({ step: 'curate', verdict: 'fallback' });
        expect(existsSync(errors)).toBe(false);
        expect(JSON.parse(readFileSync(join(workDir, '21-plan', `${DIGITS}_03_plan_plan.json`), 'utf-8'))).toHaveLength(
            2,
        );

        // Exit 1 only for a missing step INPUT — an unreadable candidate pool.
        const empty = makeFixture();
        const missing = kk(empty, [
            'news',
            'generate-check',
            '--work-dir',
            join(empty.works, 'kk-news-generate', DIGITS),
            '--step',
            'curate',
        ]);
        expect(missing.code).toBe(1);
        expect(missing.err).toContain('input is missing or unreadable');

        // A rejected script plan is the same `fix` contract on its own file.
        const script = kk(fx, ['news', 'generate-check', '--work-dir', workDir, '--step', 'script'], {
            KK_STUB_SCRIPT_REJECT: '1',
        });
        expect(script.code).toBe(0);
        expect(payload(script)).toEqual({
            step: 'script',
            verdict: 'fix',
            errors: join(workDir, '24-script', `${DIGITS}_08_script-write_errors.json`),
        });
    });

    it('refuses an unknown step, an unknown engine and a positional argument with exit 2', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        expect(kk(fx, ['news', 'generate-check', '--work-dir', workDir, '--step', 'nope']).code).toBe(2);
        expect(kk(fx, ['news', 'generate-voice', '--work-dir', workDir, '--engine', 'nope']).code).toBe(2);
        expect(kk(fx, ['news', 'generate-render', 'positional', '--work-dir', workDir]).code).toBe(2);
        expect(kk(fx, ['news', 'generate-render']).code).toBe(2);
        // The article noun shares the two verbs; since 0368 its steps are implemented, so the refusal
        // here is the article input guard (exit 1) rather than the old "not part of this release".
        const article = kk(fx, ['article', 'generate-check', '--work-dir', workDir, '--step', 'outline']);
        expect(article.code).toBe(1);
        expect(article.err).toContain('outline-recommendation.json');
    });

    it('accepts --engine vibe-voice on kk news generate-voice and preserves voxcpm default', async () => {
        const fx = makeFixture();
        await seedStore(fx);
        const workDir = join(fx.works, 'kk-news-generate', DIGITS);
        expect(kk(fx, ['news', 'prepare', '--work-dir', workDir, '--run-date', DIGITS]).code).toBe(0);
        expect(kk(fx, ['news', 'generate-render', '--work-dir', workDir]).code).toBe(0);

        const voice = kk(fx, ['news', 'generate-voice', '--work-dir', workDir, '--engine', 'vibe-voice']);
        expect(voice.code, voice.err).toBe(0);
        expect(payload(voice)).toEqual({
            engine: 'vibe-voice',
            audio: join(workDir, '30-audio', `${DIGITS}_11_generate_audio.mp3`),
            durationSec: 1020,
            quality: 'pass',
        });

        const defaultVoice = kk(fx, ['news', 'generate-voice', '--work-dir', workDir]);
        expect(defaultVoice.code, defaultVoice.err).toBe(0);
        expect(payload(defaultVoice)).toMatchObject({ engine: 'voxcpm', quality: 'pass' });
    });
});

/** Sanity: the fixture's stage double is a real file the resolver can execute. */
describe('content generate fixture', () => {
    it('writes the stage double where the stage resolver looks for an installed package', () => {
        const fx = makeFixture();
        expect(existsSync(join(fx.pkg, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts'))).toBe(true);
        expect(existsSync(join(fx.bin, 'kk'))).toBe(true);
        // And the SQLite fixture store opens with the seeded rows.
        expect(typeof Database).toBe('function');
        void dirname;
    });
});
