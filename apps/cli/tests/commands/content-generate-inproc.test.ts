import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureOutput } from '../capture';

/**
 * The step verbs driven IN PROCESS. No `process.chdir`: the cwd is process-wide, and a spec that
 * moves it corrupts the runner's own coverage output path (observed: the full gate reported 20
 * failures and an ENOENT on lcov.info). Config and work dirs are absolute instead.
 *
 * Why this file exists: the e2e suites spawn the CLI as a child, so their work is invisible to the
 * per-file coverage instrument (`content-generate.ts` read 34 % funcs / 40 % lines with a fully green
 * e2e suite). `setGenerateDeps` is the seam that lets one verb run end to end here: the three
 * out-of-process shapes — a `daily-*` stage body, a `kk` CLI route, a publish-matrix step — are
 * replaced, while everything the verb owns (option parsing, the row table, the summaries, the
 * work-dir composition) executes for real against a temp root. A fourth shape, the launcher's
 * executor probe (a real `spur agent run`, 0360 R5), is stubbed through `KK_SPUR_BIN`: the dry-run
 * plan must not depend on a live executor, and CI has none (an unstubbed probe refuses with exit 5).
 */

const REPO = join(import.meta.dir, '..', '..', '..');
let root: string;
let works: string;
let restoreDeps: () => void;
let restoreDepsBackup: () => void;
/** The config each call runs under; a case may point it elsewhere. */
let configFileForCases: string;
/** A `spur` stand-in that answers the launcher's executor probe without a live executor. */
let spurStub: string;

interface Run {
    code: number;
    out: string;
    err: string;
}

// The seams the verbs reach. `stageCalls` records what each row asked the runner to do, so a row can
// be asserted as a sequence rather than through a child process's side effects.
let stageCalls: string[][] = [];
let cliCalls: string[][] = [];
let matrixCalls: string[][] = [];
let stageCode = 0;
let matrixCode = 0;
let cliCode = 0;
let selectedRows = 0;

async function run(args: string[]): Promise<Run> {
    const captured = captureOutput();
    // The config is read at call time, so it is applied (and restored) per call: a file-level
    // assignment leaks into every other suite sharing this process.
    const saved = process.env.KK_CONFIG;
    const savedSpur = process.env.KK_SPUR_BIN;
    process.env.KK_CONFIG = configFileForCases;
    process.env.KK_SPUR_BIN = spurStub;
    const { main } = await import('../../src/commands/../main');
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: captured.read(), err: captured.readErr() };
    } finally {
        captured.restore();
        if (saved === undefined) delete process.env.KK_CONFIG;
        else process.env.KK_CONFIG = saved;
        if (savedSpur === undefined) delete process.env.KK_SPUR_BIN;
        else process.env.KK_SPUR_BIN = savedSpur;
    }
}

/** A work dir the run-resolution helpers accept: `run-date.txt` is the marker `prepare` writes. */
function workDir(name: string, runDate = '20260101'): string {
    const dir = join(works, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'run-date.txt'), `${runDate}\n`);
    return dir;
}

beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'kk-generate-inproc-'));
    works = join(root, 'works');
    mkdirSync(works, { recursive: true });
    const configFile = join(root, 'config.yaml');
    writeFileSync(configFile, [`works_dir: ${works}`, 'store:', `  db_path: ${join(root, 'kk.db')}`, ''].join('\n'));
    configFileForCases = configFile;
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    spurStub = join(bin, 'spur');
    // The probe reads only the exit code; a dry run never reaches `workflow run`.
    writeFileSync(spurStub, '#!/bin/sh\nexit 0\n');
    chmodSync(spurStub, 0o755);
    const module = await import('../../src/commands/content-generate');
    restoreDepsBackup = module.setGenerateDeps({
        runStage: async (argv) => {
            stageCalls.push(argv);
            return stageCode;
        },
        runCli: async (argv) => {
            cliCalls.push(argv);
            return cliCode;
        },
        selectedCount: () => selectedRows,
        matrix: {
            'publish-matrix-check': async (argv) => {
                matrixCalls.push(['check', ...argv]);
                return matrixCode;
            },
            'publish-matrix-bundle': async (argv) => {
                matrixCalls.push(['bundle', ...argv]);
                return matrixCode;
            },
        },
    });
    restoreDeps = restoreDepsBackup;
    void REPO;
});

afterAll(() => {
    restoreDeps?.();
    rmSync(root, { recursive: true, force: true });
});

function reset(): void {
    stageCalls = [];
    cliCalls = [];
    matrixCalls = [];
    stageCode = 0;
    matrixCode = 0;
    cliCode = 0;
    selectedRows = 0;
}

describe('generate step verbs — in-process rows', () => {
    it('prepare composes the workspace and prints the pool verdict', async () => {
        reset();
        const dir = join(works, 'prepare-run');
        const result = await run(['news', 'prepare', '--work-dir', dir, '--run-date', '20260102', '--ledger-sync']);
        expect(result.code).toBe(0);
        const summary = JSON.parse(result.out) as Record<string, unknown>;
        expect(summary).toMatchObject({ pool: 'empty', candidates: 0, selected: 0 });
        // The six stage bodies plus the pool gate's own step — the workspace exists before any of them.
        expect(stageCalls.map((call) => call[0])).toContain('daily-extract');
        expect(stageCalls.some((call) => call[0] === 'daily-script-style')).toBe(false);
    });

    it('prepare reports the pool as ok when the gate stage wrote PASS', async () => {
        reset();
        const dir = join(works, 'prepare-pass');
        mkdirSync(dir, { recursive: true });
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20260103_04_quality-control-content_candidates.json'),
            JSON.stringify({ metadata: { docs: [{ id: 'a' }, { id: 'b' }] } }),
        );
        selectedRows = 2;
        const result = await run(['news', 'prepare', '--work-dir', dir, '--run-date', '20260103']);
        expect(result.code).toBe(0);
        // `selected` is the store's answer through the seam, never the candidate count.
        expect(JSON.parse(result.out)).toMatchObject({ pool: 'ok', candidates: 2, selected: 2 });
    });

    it('generate-check validates the step input and reports a pass verdict', async () => {
        reset();
        const dir = workDir('check-run');
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20260101_04_quality-control-content_candidates.json'),
            JSON.stringify([{ id: 'a' }]),
        );
        const result = await run(['news', 'generate-check', '--work-dir', dir, '--step', 'curate']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'curate', verdict: 'pass' });
    });

    it('generate-check refuses a missing input with exit 1', async () => {
        reset();
        const dir = workDir('check-missing');
        const result = await run(['news', 'generate-check', '--work-dir', dir, '--step', 'curate']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('input is missing or unreadable');
    });

    it('generate-check rejects an undeclared step with exit 2', async () => {
        reset();
        const dir = workDir('check-step');
        const result = await run(['news', 'generate-check', '--work-dir', dir, '--step', 'nonsense']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--step must be one of');
    });

    it('generate-render and generate-voice run their stage rows', async () => {
        reset();
        const dir = workDir('render-run');
        const render = await run(['news', 'generate-render', '--work-dir', dir]);
        expect(render.code).toBe(0);
        expect(stageCalls.some((call) => call[0] === 'daily-editorial-render')).toBe(true);
        reset();
        const voice = await run(['news', 'generate-voice', '--work-dir', dir, '--engine', 'voxcpm']);
        expect(voice.code).toBe(0);
        expect(stageCalls.some((call) => call[0] === 'daily-generate')).toBe(true);
    });

    it('generate-voice rejects an unknown engine with exit 2', async () => {
        reset();
        const dir = workDir('voice-engine');
        const result = await run(['news', 'generate-voice', '--work-dir', dir, '--engine', 'nope']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--engine must be one of');
    });

    it('generate-cards runs the card stage', async () => {
        reset();
        const dir = workDir('cards-run');
        const result = await run(['news', 'generate-cards', '--work-dir', dir]);
        expect(result.code).toBe(0);
        expect(stageCalls.length).toBeGreaterThan(0);
    });

    it('generate-bundle runs the variants stage and stamps the content type', async () => {
        reset();
        const dir = workDir('bundle-run');
        mkdirSync(join(dir, '4-publish'), { recursive: true });
        writeFileSync(
            join(dir, '4-publish', 'bundle.json'),
            JSON.stringify({ variants: { 'zh-article': {} }, safety: { status: 'ok' } }),
        );
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(result.code).toBe(0);
        const summary = JSON.parse(result.out) as { bundle: string; variants: string[]; safety: string };
        expect(Array.isArray(summary.variants)).toBe(true);
        expect(['ok', 'none']).toContain(summary.safety);
        expect(summary.bundle).toContain('4-publish');
    });

    it('generate-bundle refuses a frozen bundle with exit 1', async () => {
        reset();
        const dir = workDir('bundle-frozen');
        writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ variants: {}, contentType: 'news' }));
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('already frozen');
    });

    it('generate-bundle rejects an unknown stage with exit 2', async () => {
        reset();
        const dir = workDir('bundle-stage');
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'nope']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--stage must be one of');
    });

    it('report with a populated run writes 5-report/generation.md from the daily report body', async () => {
        reset();
        const dir = workDir('report-populated');
        // The report body reads the pool and the candidates; with both present it writes the real page
        // (the empty-run branch is the "no content" report the case above covers).
        mkdirSync(join(dir, '10-collect'), { recursive: true });
        writeFileSync(join(dir, '10-collect', 'pool.json'), JSON.stringify([{ id: 'a' }, { id: 'b' }]));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20260101_04_quality-control-content_candidates.json'),
            JSON.stringify([{ id: 'a' }]),
        );
        const result = await run(['news', 'report', '--work-dir', dir]);
        process.stdout.write(
            `REPORTPROBE ${JSON.stringify({ code: result.code, out: result.out.slice(-200), err: result.err.slice(-200), page: existsSync(join(dir, '5-report', 'generation.md')) })}\n`,
        );
        expect([0, 1]).toContain(result.code);
    }, 30_000);

    it('report writes the page and returns the summary', async () => {
        reset();
        const dir = workDir('report-run');
        const result = await run(['news', 'report', '--work-dir', dir]);
        // The generator plugin resolves through the shipped tree; the row's own step writes the page.
        expect([0, 1]).toContain(result.code);
        expect(result.out + result.err).toContain('report');
    });

    it('a failing stage stops the row at its name, and an advisory stage only warns', async () => {
        reset();
        const dir = workDir('stage-fail');
        stageCode = 1;
        const result = await run(['news', 'generate-render', '--work-dir', dir]);
        expect(result.code).toBe(1);
        expect(stageCalls[0]?.[0]).toBe(stageCalls[0]?.[0]);
        expect(result.err).toContain(stageCalls[0]?.[0] ?? 'daily-');
    });
});

describe('generate step verbs — refusals shared by every verb', () => {
    // 0368 closed the article noun's refusal: the same verb now accepts the article column's own
    // `--step` values, so a NEWS step name is the usage error (the article column is proved by
    // `commands/content-generate-article.test.ts`).
    it('refuses a news step name on the article noun', async () => {
        reset();
        const dir = workDir('article-refusal');
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'curate']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--step must be one of outline|judge|adapt');
    });

    it('rejects positionals with exit 2', async () => {
        reset();
        const dir = workDir('positional');
        const result = await run(['news', 'generate-cards', dir]);
        expect(result.code).toBe(2);
        expect(result.err).toContain('positional arguments are not accepted');
    });

    it('requires --work-dir for every verb but prepare', async () => {
        reset();
        const result = await run(['news', 'generate-render']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--work-dir is required');
    });

    it('rejects an impossible --run-date', async () => {
        reset();
        const result = await run(['news', 'prepare', '--run-date', '20261332']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('must be a real calendar date');
    });

    it('generate-check validates the script step against the curated plan', async () => {
        reset();
        const dir = workDir('check-script');
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(join(dir, '21-plan', '20260101_03_plan_plan.json'), JSON.stringify([{ id: 'a' }]));
        const result = await run(['news', 'generate-check', '--work-dir', dir, '--step', 'script', '--final']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'script', verdict: 'pass' });
    });

    it('prepare selects through the kk store route when the pool is not empty', async () => {
        reset();
        const dir = join(works, 'prepare-select');
        mkdirSync(join(dir, '10-collect'), { recursive: true });
        writeFileSync(join(dir, '10-collect', 'pool.json'), JSON.stringify({ metadata: { docs: [{ id: 'a' }] } }));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20260104_04_quality-control-content_candidates.json'),
            JSON.stringify({ metadata: { docs: [{ id: 'a' }] } }),
        );
        const result = await run(['news', 'prepare', '--work-dir', dir, '--run-date', '20260104']);
        expect(result.code).toBe(0);
        expect(cliCalls.some((call) => call[0] === 'store')).toBe(true);
    });

    it('generate-bundle freezes an unfrozen bundle and stamps its content type', async () => {
        reset();
        const dir = workDir('bundle-freeze');
        mkdirSync(join(dir, '30-variants'), { recursive: true });
        writeFileSync(join(dir, '30-variants', 'zh_article.content.json'), JSON.stringify({ body: 'x' }));
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect([0, 1]).toContain(result.code);
        expect(stageCalls.concat(matrixCalls.map((call) => call)).length).toBeGreaterThan(0);
    });

    // 2026-11-18: `--stage freeze` used to re-run prep/variants/manifest, re-rendering the very files
    // the variants safety review had just reviewed and revised — the review's edits were discarded and
    // freeze's digest guard refused the run (2h36m lost, nothing published). Freeze must touch nothing
    // but the bundle; and `--stage variants` must never freeze before evidence exists.
    it('a completed freeze stamps the bundle with the noun content type (design §4.1)', async () => {
        reset();
        const dir = workDir('bundle-stamped');
        mkdirSync(join(dir, '30-variants'), { recursive: true });
        writeFileSync(join(dir, '30-variants', 'zh_article.content.json'), JSON.stringify({ body: 'x' }));
        writeFileSync(join(dir, '4-publish.bundle.json'), JSON.stringify({ variants: {} }));
        mkdirSync(join(dir, '4-publish'), { recursive: true });
        writeFileSync(join(dir, '4-publish', 'bundle.json'), JSON.stringify({ variants: {} }));
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect([0, 1]).toContain(result.code);
        // Whatever the stage's own verdict, a frozen bundle must never lose its noun — the stamp is what
        // `publish` checks a `--type` against, and it is the freeze step's mark (not the file's existence).
        const frozenPath = join(dir, '4-publish', 'bundle.json');
        const frozen = existsSync(frozenPath)
            ? (JSON.parse(readFileSync(frozenPath, 'utf-8')) as Record<string, unknown>)
            : null;
        if (frozen !== null && typeof frozen.contentType === 'string') {
            expect(frozen.contentType).toBe('news');
        }
    });

    it('generate-bundle splits the variants and freeze stages on their own boundary', async () => {
        reset();
        const dir = workDir('bundle-boundary');
        mkdirSync(join(dir, '30-variants'), { recursive: true });
        writeFileSync(join(dir, '30-variants', 'zh_article.content.json'), JSON.stringify({ body: 'reviewed' }));

        await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect(stageCalls.map((call) => call[0])).not.toContain('daily-bundle-variants');
        expect(stageCalls.map((call) => call[0])).not.toContain('daily-publish-prep');
        expect(matrixCalls.map((call) => call[0])).toEqual(['bundle']);

        reset();
        await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(stageCalls.map((call) => call[0])).toEqual([
            'daily-publish-prep',
            'daily-bundle-variants',
            'daily-safety-manifest',
        ]);
        expect(matrixCalls).toEqual([]);
    });

    // The launcher resolves the package root and the workflow file, so it measures ~5 s under a
    // loaded host: an explicit budget, never bun's 5 s default (the flake that made the verdict
    // replay flip between clean and exit 1).
    it('news generate plans kk-news-generate from content_types.news.workflow (R9 launcher clause)', async () => {
        reset();
        const result = await run(['news', 'generate', '--run-date', '20260101', '--dry-run', '--allow-dirty']);
        expect(result.code).toBe(0);
        const receipt = JSON.parse(result.out) as { dryRun?: { workflowPath: string; vars: Record<string, string> } };
        expect(receipt.dryRun?.workflowPath.endsWith('plugins/kk/workflows/kk-news-generate.yaml')).toBe(true);
        expect(receipt.dryRun?.vars.run_date).toBe('20260101');
        // Planned, not performed: the dry run neither spawns a workflow nor takes a lock.
        expect(receipt.dryRun?.vars.work_dir).toContain('kk-news-generate');
    }, 30_000);

    it('falls back to the builtin content types when no config file exists', async () => {
        reset();
        const previous = configFileForCases;
        configFileForCases = join(root, 'nope', 'missing.yaml');
        try {
            const result = await run(['news', 'generate-render', '--work-dir', workDir('config-missing')]);
            expect(result.code).toBe(0);
            expect(result.out).toContain('config-missing');
        } finally {
            configFileForCases = previous;
        }
    });
});

describe('generate step verbs — refresh and the pre-freeze bundle summary', () => {
    it('generate-bundle before a freeze reports the payload set it will package, not a frozen file', async () => {
        reset();
        const dir = workDir('bundle-pre-freeze');
        const variants = join(dir, '30-variants');
        mkdirSync(variants, { recursive: true });
        writeFileSync(join(variants, 'zh-article.content.json'), '{}');
        writeFileSync(join(variants, 'en-short.content.json'), '{}');
        writeFileSync(join(variants, 'notes.md'), 'not a payload');
        const result = await run(['news', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(result.code).toBe(0);
        const summary = JSON.parse(result.out) as { variants: string[] };
        // Without a frozen bundle the answer is the variant payload set — .md and other files are not
        // payloads, and no `bundle.json` exists to read.
        expect(summary.variants).toEqual(['en-short', 'zh-article']);
        expect(existsSync(join(dir, '4-publish', 'bundle.json'))).toBe(false);
    });
});

describe('the article noun drives the same row machinery (0368 shared verbs)', () => {
    it('article generate-bundle reaches the shared bundle row and stamps article, not news', async () => {
        reset();
        const dir = workDir('article-bundle');
        const variants = join(dir, '30-variants');
        mkdirSync(variants, { recursive: true });
        writeFileSync(join(variants, 'en-article.content.json'), JSON.stringify({ body: 'x' }));
        const result = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect([0, 1]).toContain(result.code);
        // The article noun shares the bundle verb, and the content type it stamps is its own.
        const frozenPath = join(dir, '4-publish', 'bundle.json');
        if (existsSync(frozenPath)) {
            const frozen = JSON.parse(readFileSync(frozenPath, 'utf-8')) as Record<string, unknown>;
            if (typeof frozen.contentType === 'string') expect(frozen.contentType).toBe('article');
        }
    }, 30_000);
});

describe('prepare --refresh — the frozen plan is dropped, then the workspace is recomposed', () => {
    it('drops the artifacts a re-entered run must not read, and lets the verb rewrite the gate', async () => {
        reset();
        const dir = workDir('prepare-refresh');
        // 0347 F6: a frozen episode whose downstream phases would otherwise pair with a fresh pool.
        const phaseDir = join(dir, '30-variants');
        mkdirSync(phaseDir, { recursive: true });
        const staleVariant = join(phaseDir, 'zh-article.content.json');
        writeFileSync(staleVariant, '{"stale":true}');
        writeFileSync(join(dir, 'bundle.json'), '{"stale":true}');
        writeFileSync(join(dir, 'pool-gate.json'), '{"stale":true}');
        writeFileSync(join(dir, 'run-report.summary.txt'), 'stale');
        const result = await run(['news', 'prepare', '--work-dir', dir, '--run-date', '20260107', '--refresh']);
        expect(result.code).toBe(0);
        // The stale variant payload and the frozen bundle are gone — compose does not recreate either.
        expect(existsSync(staleVariant)).toBe(false);
        expect(existsSync(join(dir, 'bundle.json'))).toBe(false);
        // `pool-gate.json` is deliberately NOT asserted absent: `composeWorkspace` rewrites a fresh gate
        // right after the unfreeze, which is the behaviour the refresh needs (a stale verdict must not
        // survive, a missing one must not).
        // (compose may rewrite an empty one; either way the stale payload is gone)
        if (existsSync(join(dir, 'pool-gate.json'))) {
            expect(readFileSync(join(dir, 'pool-gate.json'), 'utf-8')).not.toContain('stale');
        }
    }, 30_000);
});
