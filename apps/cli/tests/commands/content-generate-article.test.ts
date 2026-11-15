import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureOutput } from '../capture';

/**
 * The article column of the generate step verbs (`apps/cli/src/commands/content-generate-article.ts`)
 * driven IN PROCESS. No `process.chdir`: the cwd is process-wide and moving it corrupts the runner's
 * own coverage output path. Config and work dirs are absolute instead.
 *
 * Why this file exists: the e2e suite spawns the CLI, so its work is invisible to the per-file
 * coverage instrument. `setArticleDeps` replaces the two out-of-process seams (the native `itc-*`
 * bodies and the script stage runner) while everything the module owns runs for real: the input
 * guards, the pick commit, the rewrite-budget arithmetic (the REAL `itc-author-verdict` runs behind
 * the seam-free default), the generation record it folds into `content.json`, and the §4.1 bundle it
 * freezes.
 */

let root: string;
let works: string;
let restore: () => void;
/** The config each call runs under; a case may point it elsewhere. */
let configFileForCases: string;

interface Run {
    code: number;
    out: string;
    err: string;
}

let stageCalls: string[][] = [];
let itcCalls: string[][] = [];
let stageCode = 0;
/** What the stubbed `itc-decision --outline` writes into `2-outline/.auto-pick`. */
let decisionPick = 'a';
/** What the stubbed `itc-materialize-plan` writes: the ITC plan (variants/file/adapt/limits/switches). */
let plan: Record<string, unknown> | null = null;
const passItcThrough = true;

async function run(args: string[]): Promise<Run> {
    const captured = captureOutput();
    // The config is read at call time, so it is applied (and restored) per call: a file-level
    // assignment leaks into every other suite sharing this process.
    const saved = process.env.KK_CONFIG;
    process.env.KK_CONFIG = configFileForCases;
    const { main } = await import('../../src/main');
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: captured.read(), err: captured.readErr() };
    } finally {
        captured.restore();
        if (saved === undefined) delete process.env.KK_CONFIG;
        else process.env.KK_CONFIG = saved;
    }
}

function reset(): void {
    stageCalls = [];
    itcCalls = [];
    stageCode = 0;
    decisionPick = 'a';
    plan = null;
}

let counter = 0;
/** A fresh article work dir with the frozen options snapshot `kk article new` writes. */
function workDir(snapshot: Record<string, unknown> = {}): string {
    counter += 1;
    const dir = join(works, `kk-article-generate/demo-${counter}`);
    mkdirSync(join(dir, '2-outline'), { recursive: true });
    mkdirSync(join(dir, '4-publish'), { recursive: true });
    writeFileSync(
        join(dir, 'itc-options.json'),
        `${JSON.stringify({ parentRunId: 'kk-content-demo', sourceLocale: 'en', publishPreset: 'itc-main', ...snapshot })}\n`,
    );
    return dir;
}

function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'kk-article-inproc-'));
    works = join(root, 'works');
    mkdirSync(works, { recursive: true });
    const configFile = join(root, 'config.yaml');
    writeFileSync(
        configFile,
        [
            `works_dir: ${works}`,
            'content_types:',
            '  itc:',
            '    workflow: kk-article-generate',
            'workflows:',
            '  kk-article-generate:',
            '    max_revisions: 1',
            '',
        ].join('\n'),
    );
    configFileForCases = configFile;
    const module = await import('../../src/commands/content-generate-article');
    restore = module.setArticleDeps({
        runStage: async (argv) => {
            stageCalls.push(argv);
            return stageCode;
        },
        runItc: async (argv) => {
            itcCalls.push(argv);
            // The two bodies this module calls that a checkout can run in-process for real
            // (`itc-author-verdict`, `itc-author-complete`) pass straight through when asked; the
            // plan/pick ones are stubbed because they need the plugin registry and the decision hub.
            if (passItcThrough && (argv[0] === 'itc-author-verdict' || argv[0] === 'itc-author-complete')) {
                const { runItcStage } = await import('../../src/itc-stage');
                return (await runItcStage(argv)) ?? 1;
            }
            if (argv[0] === 'itc-decision') {
                writeFileSync(join(argv[2] as string, '2-outline/.auto-pick'), decisionPick);
                return 0;
            }
            if (argv[0] === 'itc-materialize-plan') {
                writeFileSync(join(argv[1] as string, '4-publish/content.json'), '{}\n');
                writeJson(join(argv[1] as string, '4-publish/publish-plan.json'), plan ?? {});
                return 0;
            }
            return 0;
        },
    });
});

afterAll(() => {
    restore?.();
    rmSync(root, { recursive: true, force: true });
});

describe('kk article generate-check — --step outline (R1)', () => {
    it('picks, binds the decision and commits the approved outline', async () => {
        reset();
        const dir = workDir();
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'a', rationale: 'sharper' });
        writeFileSync(join(dir, '2-outline/outline-option-a.md'), '# Option A\n');
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'outline', verdict: 'pass' });
        expect(stageCalls).toContainEqual(['itc-outline-pick', dir]);
        expect(itcCalls.some((call) => call[0] === 'itc-decision' && call[1] === '--outline')).toBe(true);
        expect(readFileSync(join(dir, '2-outline/outline-approved.md'), 'utf-8')).toContain('Option A');
    });

    it('reports fix when the decision defers, and commits nothing', async () => {
        reset();
        decisionPick = '';
        const dir = workDir();
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'b' });
        writeFileSync(join(dir, '2-outline/outline-option-b.md'), '# Option B\n');
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'outline', verdict: 'fix' });
    });

    it('exits 1 when the writer left no recommendation (design §1.3 input guard)', async () => {
        reset();
        const dir = workDir();
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('input is missing or unreadable');
        expect(result.err).toContain('outline-recommendation.json');
    });

    it('exits 1 when the bounded decision fails', async () => {
        reset();
        const dir = workDir();
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'a' });
        writeFileSync(join(dir, '2-outline/outline-option-a.md'), '# A\n');
        const module = await import('../../src/commands/content-generate-article');
        const restoreDecision = module.setArticleDeps({
            runItc: async (argv) => (argv[0] === 'itc-decision' ? 1 : 0),
        });
        try {
            const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
            expect(result.code).toBe(1);
            expect(result.err).toContain('itc-decision --outline failed');
        } finally {
            restoreDecision();
        }
    });

    it('binds the decision to the request run when the snapshot is absent', async () => {
        reset();
        const dir = workDir();
        rmSync(join(dir, 'itc-options.json'));
        writeJson(join(dir, 'request.json'), { run: 'demo' });
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'a' });
        writeFileSync(join(dir, '2-outline/outline-option-a.md'), '# A\n');
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(0);
        expect(itcCalls.find((call) => call[0] === 'itc-decision')).toContain('kk-content-demo');
    });

    it('exits 1 when the chosen option file is absent', async () => {
        reset();
        decisionPick = 'c';
        const dir = workDir();
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'c' });
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('picked outline option is missing');
    });

    it('exits 1 when the pick stage fails', async () => {
        reset();
        stageCode = 1;
        const dir = workDir();
        writeJson(join(dir, '2-outline/outline-recommendation.json'), { pick: 'a' });
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('itc-outline-pick failed');
    });
});

describe('kk article generate-check — --step judge (R1, R5)', () => {
    it('reports pass for a PASS verdict with a confidence level', async () => {
        reset();
        const dir = workDir();
        writeFileSync(join(dir, '.draft-count'), '1\n');
        mkdirSync(join(dir, '.itc'), { recursive: true });
        writeJson(join(dir, '.itc-verdict.json'), { verdict: 'PASS', confidence: 'HIGH', feedback: [] });
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'judge', verdict: 'pass' });
        // Rewrites performed = drafts - 1: the counter the ITC body budgets against.
        expect(readFileSync(join(dir, '.auto-revise-count'), 'utf-8').trim()).toBe('0');
    });

    it('reports fix and keeps rewriting while the budget lasts, then fails it out', async () => {
        reset();
        const dir = workDir();
        mkdirSync(join(dir, '.itc'), { recursive: true });
        writeJson(join(dir, '.itc-verdict.json'), { verdict: 'NEEDS_REVISION', confidence: 'MEDIUM', feedback: ['x'] });
        writeFileSync(join(dir, '.draft-count'), '1\n');
        // max_revisions is 1 in this fixture: the first draft may be rewritten once …
        const first = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
        expect(JSON.parse(first.out)).toMatchObject({ verdict: 'fix' });
        expect(readFileSync(join(dir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('autorevise');
        // … and the second draft is the budget's last: the disposition says fail (AC3).
        writeFileSync(join(dir, '.draft-count'), '2\n');
        const second = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
        expect(second.code).toBe(0);
        expect(readFileSync(join(dir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('fail');
        expect(JSON.parse(second.out)).toMatchObject({ verdict: 'fix', errors: join(dir, '.itc-verdict.json') });
    });

    it('keeps a pre-set ITC env var and still reports the disposition', async () => {
        reset();
        const dir = workDir();
        mkdirSync(join(dir, '.itc'), { recursive: true });
        writeJson(join(dir, '.itc-verdict.json'), { verdict: 'PASS', confidence: 'LOW', feedback: [] });
        writeFileSync(join(dir, '.draft-count'), '1\n');
        process.env.KK_ITC_AUTO = 'false';
        try {
            const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
            expect(JSON.parse(result.out)).toMatchObject({ verdict: 'pass' });
            // The step restores what it found, so a later verb sees the operator's value again.
            expect(process.env.KK_ITC_AUTO).toBe('false');
        } finally {
            delete process.env.KK_ITC_AUTO;
        }
    });

    it('exits 1 when the ITC verdict body fails', async () => {
        reset();
        const dir = workDir();
        mkdirSync(join(dir, '.itc'), { recursive: true });
        writeJson(join(dir, '.itc-verdict.json'), { verdict: 'PASS', confidence: 'HIGH' });
        const module = await import('../../src/commands/content-generate-article');
        const restoreItc = module.setArticleDeps({ runItc: async () => 1 });
        try {
            const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
            expect(result.code).toBe(1);
            expect(result.err).toContain('itc-author-verdict failed');
        } finally {
            restoreItc();
        }
    });

    it('exits 1 without the judge agent output', async () => {
        reset();
        const dir = workDir();
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('.itc-verdict.json');
    });
});

describe('kk article generate-check — --step adapt (R1)', () => {
    it('passes when itc-adapt-verify accepts every adapted file', async () => {
        reset();
        const dir = workDir();
        writeJson(join(dir, '4-publish/publish-plan.json'), { variants: {} });
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'adapt']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ step: 'adapt', verdict: 'pass' });
        expect(stageCalls).toContainEqual(['itc-adapt-verify', dir]);
    });

    it('exits 1 when a variant is missing or unreadable', async () => {
        reset();
        stageCode = 1;
        const dir = workDir();
        writeJson(join(dir, '4-publish/publish-plan.json'), { variants: {} });
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'adapt']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('itc-adapt-verify failed');
    });

    it('exits 1 without the plan the adapt agent read', async () => {
        reset();
        const dir = workDir();
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'adapt']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('publish-plan.json');
    });
});

describe('kk article generate-bundle — --stage variants (R1, R2)', () => {
    it('materializes the plan and folds the generation record into content.json', async () => {
        reset();
        const dir = workDir();
        writeFileSync(join(dir, '3-draft-draft-article.md'), '# Demo title\n\nBody.\n');
        plan = {
            sourceLocale: 'en',
            variants: {
                'en-article': { file: 'content.json', adapt: false, switches: {} },
                'zh-article': { file: 'content.zh-article.json', adapt: true, limits: { chars: 800 }, switches: {} },
            },
            warnings: ['surfdash-pub skipped: no cover'],
        };
        const result = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(result.code).toBe(0);
        const summary = JSON.parse(result.out) as { variants: string[] };
        expect(summary.variants).toEqual(['en-article', 'zh-article']);
        const content = JSON.parse(readFileSync(join(dir, '4-publish/content.json'), 'utf-8')) as Record<
            string,
            unknown
        >;
        expect(content.sourceLocale).toBe('en');
        expect(content.variants).toMatchObject({ 'zh-article': { file: 'content.zh-article.json', adapt: true } });
        expect(content.warnings).toEqual(['surfdash-pub skipped: no cover']);
        // The ITC plan survives variants — the adapt agent and `--step adapt` read it (R1).
        expect(readFileSync(join(dir, '4-publish/publish-plan.json'), 'utf-8')).toContain('zh-article');
    });

    it('refuses a --preset that disagrees with the run’s frozen snapshot', async () => {
        reset();
        const dir = workDir();
        writeFileSync(join(dir, '3-draft-draft-article.md'), '# T\n\nb\n');
        const result = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            dir,
            '--preset',
            'chinese-article',
            '--stage',
            'variants',
        ]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('prepared with preset');
    });

    it('exits 1 when the materialize body fails, and tolerates an unreadable plan', async () => {
        reset();
        const dir = workDir();
        writeFileSync(join(dir, '3-draft-draft-article.md'), '# T\n\nb\n');
        const module = await import('../../src/commands/content-generate-article');
        const restoreItc = module.setArticleDeps({ runItc: async () => 1 });
        try {
            const failed = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
            expect(failed.code).toBe(1);
            expect(failed.err).toContain('itc-materialize-plan failed');
        } finally {
            restoreItc();
        }
        reset();
        writeFileSync(join(dir, '4-publish/publish-plan.json'), 'not json');
        const tolerated = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(tolerated.code).toBe(0);
        expect(JSON.parse(tolerated.out)).toMatchObject({ variants: [] });
    });

    it('exits 1 without a draft', async () => {
        reset();
        const dir = workDir();
        const result = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'variants']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('final draft not found');
    });
});

describe('kk article generate-bundle — --stage freeze (R2, AC1)', () => {
    /** The state `--stage variants` leaves behind, as the freeze reads it. */
    function frozen(preset = 'itc-main'): string {
        const dir = workDir({ publishPreset: preset });
        writeFileSync(join(dir, '3-draft-draft-article.md'), '# Demo title\n\nBody.\n');
        writeFileSync(join(dir, '2-outline/outline-approved.md'), '# Outline\n');
        writeFileSync(join(dir, '4-publish/content.zh-article.json'), '{"title":"演示","body":"正文"}\n');
        writeJson(join(dir, '4-publish/content.json'), {
            title: 'Demo title',
            format: 'markdown',
            body: 'Body.',
            sourceLocale: 'en',
            variants: {
                'en-article': { file: 'content.json', adapt: false, switches: {} },
                'zh-article': { file: 'content.zh-article.json', adapt: true, switches: {} },
            },
        });
        writeJson(join(dir, '4-publish/publish-plan.json'), { variants: {} });
        return dir;
    }

    it('writes the design §4.1 article bundle and removes the ITC plan', async () => {
        reset();
        const dir = frozen();
        // `--preset ''` keeps the freeze offline: the preset admission is proved separately below.
        const result = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            dir,
            '--preset',
            '',
            '--stage',
            'freeze',
        ]);
        expect(result.code).toBe(0);
        const bundle = JSON.parse(readFileSync(join(dir, '4-publish/bundle.json'), 'utf-8')) as Record<string, unknown>;
        expect(bundle.contentType).toBe('itc');
        expect(bundle.title).toBe('Demo title');
        expect(bundle.episode).toBeUndefined();
        expect(Object.keys(bundle.variants as Record<string, unknown>).sort()).toEqual([
            'article',
            'en-article',
            'zh-article',
        ]);
        // The adapted file is hashed; the source article is published under both keys.
        expect((bundle.variants as Record<string, { path: string }>)['zh-article']?.path).toBe(
            'content.zh-article.json',
        );
        expect(JSON.parse(result.out)).toMatchObject({ safety: null, runId: `demo-${counter}` });
        // AC1: no ITC plan survives the freeze — the bundle is the publish input.
        expect(() => readFileSync(join(dir, '4-publish/publish-plan.json'), 'utf-8')).toThrow();
    });

    it('refuses a freeze whose adapted variant file is missing, with the verb JSON and exit 1', async () => {
        reset();
        const dir = frozen();
        rmSync(join(dir, '4-publish/content.zh-article.json'), { force: true });
        const result = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        // A missing variant is a refusal with the verb's own error line — never a raw ENOENT crash
        // (P3 of the 0368 review: the guard, not the message, is what the contract needs).
        expect(result.code).toBe(1);
        expect(result.err).toContain("variant 'content.zh-article.json' is missing");
        expect(() => readFileSync(join(dir, '4-publish/bundle.json'), 'utf-8')).toThrow();
    });

    it('refuses a second freeze of a frozen bundle', async () => {
        reset();
        const dir = frozen();
        // A frozen bundle carries the freeze step's own mark (`contentType`): that, not the file's
        // existence, is what makes a second freeze a refusal (the variants step writes the file too).
        writeJson(join(dir, '4-publish/bundle.json'), {
            runId: 'x',
            runDate: '20261113',
            variants: {},
            contentType: 'itc',
        });
        const result = await run(['article', 'generate-bundle', '--work-dir', dir, '--stage', 'freeze']);
        expect(result.code).toBe(1);
        expect(result.err).toContain('already frozen');
    });

    it('refuses to freeze against a preset it cannot read', async () => {
        reset();
        const dir = frozen('no-such-preset');
        const result = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            dir,
            '--run-id',
            'r1',
            '--preset',
            'no-such-preset',
            '--stage',
            'freeze',
        ]);
        expect(result.code).toBe(1);
        expect(result.err).toContain("preset 'no-such-preset' could not be read");
        expect(() => readFileSync(join(dir, '4-publish/bundle.json'), 'utf-8')).toThrow();
    });

    it('freezes against a shipped preset whose required variant the run produced', async () => {
        reset();
        const dir = frozen('technical-article');
        const result = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            dir,
            '--run-id',
            'r2',
            '--preset',
            'technical-article',
            '--stage',
            'freeze',
        ]);
        expect(result.code).toBe(0);
        const bundle = JSON.parse(readFileSync(join(dir, '4-publish/bundle.json'), 'utf-8')) as {
            runs: string[];
            parentRunId: string;
        };
        expect(bundle.runs).toEqual(['r2']);
        expect(bundle.parentRunId).toBe('kk-content-demo');
    });

    it('exits 1 without a materialized content.json, and without a title in it', async () => {
        reset();
        const missing = frozen();
        rmSync(join(missing, '4-publish/content.json'));
        const noContent = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            missing,
            '--preset',
            '',
            '--stage',
            'freeze',
        ]);
        expect(noContent.code).toBe(1);
        expect(noContent.err).toContain('run --stage variants first');
        const untitled = frozen();
        writeJson(join(untitled, '4-publish/content.json'), { body: 'x', variants: {} });
        const noTitle = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            untitled,
            '--preset',
            '',
            '--stage',
            'freeze',
        ]);
        expect(noTitle.code).toBe(1);
        expect(noTitle.err).toContain('has no title');
    });

    it('exits 1 when itc-author-complete refuses the draft', async () => {
        reset();
        const dir = frozen();
        writeFileSync(join(dir, '3-draft-draft-article.md'), '   \n');
        const result = await run([
            'article',
            'generate-bundle',
            '--work-dir',
            dir,
            '--preset',
            '',
            '--stage',
            'freeze',
        ]);
        expect(result.code).toBe(1);
        expect(result.err).toContain('itc-author-complete failed');
    });
});

describe('the shared verbs keep their own step tables apart', () => {
    it('rejects a news step on the article noun with the article enum', async () => {
        reset();
        const dir = workDir();
        const result = await run(['article', 'generate-check', '--work-dir', dir, '--step', 'curate']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--step must be one of outline|judge|adapt');
    });

    it('rejects an article step on the news noun with the news enum', async () => {
        reset();
        // A news run's artefact names carry the day, so its work dir must resolve one.
        const dir = join(works, 'kk-news-generate/20261113');
        mkdirSync(dir, { recursive: true });
        const result = await run(['news', 'generate-check', '--work-dir', dir, '--step', 'outline']);
        expect(result.code).toBe(2);
        expect(result.err).toContain('--step must be one of curate|script');
    });

    it('reads the article revision bound from workflows.kk-article-generate', async () => {
        reset();
        const dir = workDir();
        mkdirSync(join(dir, '.itc'), { recursive: true });
        writeJson(join(dir, '.itc-verdict.json'), { verdict: 'NEEDS_REVISION', confidence: 'LOW', feedback: [] });
        writeFileSync(join(dir, '.draft-count'), '1\n');
        await run(['article', 'generate-check', '--work-dir', dir, '--step', 'judge']);
        // max_revisions: 1 in this fixture — one rewrite allowed from the first draft.
        expect(readFileSync(join(dir, '.itc/disposition.txt'), 'utf-8').trim()).toBe('autorevise');
    });
});
