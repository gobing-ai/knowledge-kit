import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentSchema, discoverAllPlugins } from '@gobing-ai/kk-core';

/**
 * Task 0149 (F41) — unit coverage for the deterministic kk-itc stage helpers in
 * plugins/kk/scripts/itc-stages.ts. Every test spawns the script the same way the workflow's
 * `kk stage` delegation does, so exit codes and stderr messages are asserted for real.
 */
const STAGES = join(import.meta.dir, '../../../plugins/kk/scripts/itc-stages.ts');

function run(args: string[]): { status: number; stdout: string; stderr: string } {
    const res = Bun.spawnSync([process.execPath, STAGES, ...args], { stdout: 'pipe', stderr: 'pipe' });
    return { status: res.exitCode ?? 1, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}

function seedWorkDir(): string {
    return mkdtempSync(join(tmpdir(), 'kk-itc-stages-'));
}

function seedOutlinePick(workDir: string, recommendation: object, options: string[]): void {
    const dir = join(workDir, '2-outline');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'outline-recommendation.json'), JSON.stringify(recommendation));
    for (const option of options) writeFileSync(join(dir, `outline-option-${option}.md`), `# option ${option}\n`);
}

describe('itc-outline-pick (0149)', () => {
    it('writes the picked letter to .auto-pick without a trailing newline', () => {
        const workDir = seedWorkDir();
        seedOutlinePick(workDir, { pick: 'b', rationale: 'tightest narrative' }, ['a', 'b']);
        const res = run(['itc-outline-pick', workDir]);
        expect(res.status, res.stderr).toBe(0);
        expect(readFileSync(join(workDir, '2-outline/.auto-pick'), 'utf-8')).toBe('b');
    });

    it('fails when the recommendation file is missing', () => {
        const workDir = seedWorkDir();
        const res = run(['itc-outline-pick', workDir]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('outline recommendation not found');
        expect(res.stderr).toContain('outline-recommendation.json');
    });

    it('fails when the pick is outside a|b|c', () => {
        for (const pick of ['d', '', 42, null]) {
            const workDir = seedWorkDir();
            seedOutlinePick(workDir, { pick, rationale: 'x' }, ['a', 'b']);
            const res = run(['itc-outline-pick', workDir]);
            expect(res.status, `pick=${String(pick)}`).toBe(1);
            expect(res.stderr).toContain('invalid pick');
            expect(res.stderr).toContain('expected a|b|c');
        }
    });

    it('fails when the picked option file is missing', () => {
        const workDir = seedWorkDir();
        seedOutlinePick(workDir, { pick: 'c', rationale: 'x' }, ['a', 'b']); // option-c.md absent
        const res = run(['itc-outline-pick', workDir]);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('picked outline option not found');
        expect(res.stderr).toContain('outline-option-c.md');
    });

    it('fails without a work_dir', () => {
        expect(run(['itc-outline-pick']).status).toBe(1);
        expect(run(['itc-outline-pick']).stderr).toContain('usage');
    });
});

describe('itc-report (0149)', () => {
    it('writes report.json {outcome, verdict, revisions} and report.md for a passing run', () => {
        const workDir = seedWorkDir();
        writeFileSync(
            join(workDir, '.itc-verdict.json'),
            JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', feedback: [] }),
        );
        writeFileSync(join(workDir, '.auto-revise-count'), '1\n');
        const res = run(['itc-report', workDir, '2']);
        expect(res.status, res.stderr).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
        expect(report).toEqual({ outcome: 'done', verdict: 'PASS', revisions: 1 });
        expect(readFileSync(join(workDir, '5-report/report.md'), 'utf-8')).toContain('Outcome: done');
    });

    it('marks a PASS without a HIGH/MEDIUM/LOW confidence failed — the judge gate never cleared', () => {
        for (const confidence of [undefined, 'SURE', 'high', 1]) {
            const workDir = seedWorkDir();
            writeFileSync(
                join(workDir, '.itc-verdict.json'),
                JSON.stringify({ verdict: 'PASS', ...(confidence === undefined ? {} : { confidence }), feedback: [] }),
            );
            const res = run(['itc-report', workDir, '2']);
            expect(res.status, res.stderr).toBe(0);
            const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
            expect(report.outcome, `confidence=${String(confidence)}`).toBe('failed');
            expect(report.verdict).toBe('PASS');
            expect(readFileSync(join(workDir, '5-report/report.md'), 'utf-8')).toContain(
                'no HIGH/MEDIUM/LOW confidence',
            );
        }
    });

    it('still reports an absent verdict file as done (the dry-run PASS convention is unchanged)', () => {
        const workDir = seedWorkDir();
        const res = run(['itc-report', workDir, '2']);
        expect(res.status, res.stderr).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
        expect(report).toEqual({ outcome: 'done', verdict: '', revisions: 0 });
    });

    it('marks a FAIL verdict failed', () => {
        const workDir = seedWorkDir();
        writeFileSync(join(workDir, '.itc-verdict.json'), JSON.stringify({ verdict: 'FAIL', feedback: [] }));
        const res = run(['itc-report', workDir, '2']);
        expect(res.status, res.stderr).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
        expect(report.outcome).toBe('failed');
        expect(report.verdict).toBe('FAIL');
    });

    it('marks an exhausted NEEDS_REVISION budget failed and an in-budget one done', () => {
        const exhausted = seedWorkDir();
        writeFileSync(join(exhausted, '.itc-verdict.json'), JSON.stringify({ verdict: 'NEEDS_REVISION' }));
        writeFileSync(join(exhausted, '.auto-revise-count'), '2');
        const res = run(['itc-report', exhausted, '2']);
        expect(res.status, res.stderr).toBe(0);
        expect(JSON.parse(readFileSync(join(exhausted, '5-report/report.json'), 'utf-8')).outcome).toBe('failed');

        const inBudget = seedWorkDir();
        writeFileSync(join(inBudget, '.itc-verdict.json'), JSON.stringify({ verdict: 'NEEDS_REVISION' }));
        writeFileSync(join(inBudget, '.auto-revise-count'), '1');
        run(['itc-report', inBudget, '2']);
        expect(JSON.parse(readFileSync(join(inBudget, '5-report/report.json'), 'utf-8')).outcome).toBe('done');
    });

    it('treats a PASS on the final allowed revision as done (budget spent != exhausted)', () => {
        const workDir = seedWorkDir();
        writeFileSync(join(workDir, '.itc-verdict.json'), JSON.stringify({ verdict: 'PASS', confidence: 'HIGH' }));
        writeFileSync(join(workDir, '.auto-revise-count'), '2');
        const res = run(['itc-report', workDir, '2']);
        expect(res.status, res.stderr).toBe(0);
        expect(JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8')).outcome).toBe('done');
    });

    it('treats a missing verdict as PASS (the workflow dry-run convention) and falls back to .revise-count', () => {
        const workDir = seedWorkDir();
        writeFileSync(join(workDir, '.revise-count'), '2');
        const res = run(['itc-report', workDir, '2']);
        expect(res.status, res.stderr).toBe(0);
        const report = JSON.parse(readFileSync(join(workDir, '5-report/report.json'), 'utf-8'));
        expect(report).toEqual({ outcome: 'done', verdict: '', revisions: 2 });
    });

    it('exits 1 only when it cannot write', () => {
        const workDir = seedWorkDir();
        const blocker = join(workDir, 'blocker');
        writeFileSync(blocker, 'a file where a directory is needed');
        const res = run(['itc-report', blocker, '2']);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain('cannot write report');
    });

    it('fails without a work_dir', () => {
        expect(run(['itc-report']).status).toBe(1);
        expect(run(['itc-report']).stderr).toContain('usage');
    });
});

// ---------------------------------------------------------------------------
// 0150 — itc-materialize / itc-publish-plan / TARGET_PROFILES
// ---------------------------------------------------------------------------

function seedDraft(workDir: string, draft: string): void {
    writeFileSync(join(workDir, '3-draft-draft-article.md'), draft);
}

describe('itc-materialize (0150)', () => {
    it('materializes the draft to ContentSchema-shaped content.json with every optional input', () => {
        const workDir = seedWorkDir();
        seedDraft(workDir, '# Packing Rust builds\n\nIntro paragraph.\n\n## Ship it\n\nBody text.\n');
        mkdirSync(join(workDir, '2-outline'), { recursive: true });
        writeFileSync(join(workDir, '2-outline/outline-approved.md'), '# Outline\n- intro\n');
        writeFileSync(
            join(workDir, 'docs.json'),
            JSON.stringify([
                { id: 'd1', body: 'x', title: 'A source', sourceUri: 'https://example.test/a' },
                { id: 'd2', body: 'y' },
            ]),
        );
        mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
        writeFileSync(join(workDir, '4-illustrations/cover.png'), 'png');
        writeFileSync(
            join(workDir, 'brief.md'),
            '---\ntitle: brief\ntags: [rust, ci]\nkeywords: rust, builds\ndescription: Ship faster.\n---\n\nBrief body.\n',
        );
        const res = run(['itc-materialize', workDir, 'false']);
        expect(res.status, res.stderr).toBe(0);
        const parsed = ContentSchema.parse(JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8')));
        expect(parsed.title).toBe('Packing Rust builds');
        expect(parsed.body).not.toContain('# Packing');
        expect(parsed.body.startsWith('Intro paragraph.')).toBe(true);
        expect(parsed.format).toBe('markdown');
        expect(parsed.outline).toContain('- intro');
        expect(parsed.references).toEqual([
            { url: 'https://example.test/a', title: 'A source', cite: 'd1' },
            { cite: 'd2' },
        ]);
        expect(parsed.metadata).toEqual({
            published: false,
            coverImage: join('4-illustrations', 'cover.png'),
            tags: ['rust', 'ci'],
            keywords: ['rust', 'builds'],
            description: 'Ship faster.',
        });
    });

    it('always writes metadata.published as a boolean from publish_live', () => {
        for (const [liveArg, expected] of [
            ['true', true],
            ['false', false],
        ] as const) {
            const workDir = seedWorkDir();
            seedDraft(workDir, '# T\n\nBody.\n');
            const res = run(['itc-materialize', workDir, liveArg]);
            expect(res.status, res.stderr).toBe(0);
            const content = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8'));
            expect(content.metadata.published).toBe(expected);
            expect(typeof content.metadata.published).toBe('boolean');
        }
    });

    it('omits optional keys when their inputs are absent', () => {
        const workDir = seedWorkDir();
        seedDraft(workDir, 'Intro without frontmatter.\n\n# Late H1\n\nBody.\n');
        const res = run(['itc-materialize', workDir]);
        expect(res.status, res.stderr).toBe(0);
        const content = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8'));
        expect(ContentSchema.parse(content).metadata).toEqual({ published: false });
        expect(content.outline).toBeUndefined();
        expect(content.references).toBeUndefined();
    });

    it('fails naming the artifact when the draft is missing, has no H1, or has an empty body', () => {
        const missing = seedWorkDir();
        const resMissing = run(['itc-materialize', missing, 'false']);
        expect(resMissing.status).toBe(1);
        expect(resMissing.stderr).toContain('final draft not found');
        expect(resMissing.stderr).toContain('3-draft-draft-article.md');

        const noH1 = seedWorkDir();
        writeFileSync(join(noH1, '3-draft-draft-article.md'), 'just prose\n');
        const resNoH1 = run(['itc-materialize', noH1, 'false']);
        expect(resNoH1.status).toBe(1);
        expect(resNoH1.stderr).toContain('no H1 title');

        const emptyBody = seedWorkDir();
        writeFileSync(join(emptyBody, '3-draft-draft-article.md'), '# Only a title\n\n');
        const resEmpty = run(['itc-materialize', emptyBody, 'false']);
        expect(resEmpty.status).toBe(1);
        expect(resEmpty.stderr).toContain('empty body');
    });

    it('fails without a work_dir', () => {
        expect(run(['itc-materialize']).status).toBe(1);
        expect(run(['itc-materialize']).stderr).toContain('usage');
    });
});

describe('itc-publish-plan (0150)', () => {
    type Plan = Record<string, unknown> & {
        variants: Record<string, Record<string, unknown>>;
        fanout: Array<Record<string, unknown>>;
        browser: Array<Record<string, unknown>>;
    };
    function planOf(workDir: string): Plan {
        return JSON.parse(readFileSync(join(workDir, '4-publish/publish-plan.json'), 'utf-8'));
    }

    /** Seed 4-publish/content.<variant>.json — what the kk:article-adapt step writes (agent-run, seeded here). */
    function seedVariant(workDir: string, variant: string): void {
        mkdirSync(join(workDir, '4-publish'), { recursive: true });
        writeFileSync(
            join(workDir, `4-publish/content.${variant}.json`),
            JSON.stringify({ title: 'T', format: 'markdown', body: 'b', metadata: {} }),
        );
    }

    it('shares content.json for source-locale article targets and unions their switches (V3)', () => {
        const workDir = seedWorkDir();
        const res = run(['itc-publish-plan', workDir, 'medium-pub,emdash-pub,surfdash-pub', 'en', 'false']);
        expect(res.status, res.stderr).toBe(0);
        const plan = planOf(workDir);
        expect(plan).toEqual({
            live: false,
            sourceLocale: 'en',
            variants: {
                'en-article': {
                    file: 'content.json',
                    adapt: false,
                    switches: { publishStatus: 'draft', published: false },
                },
            },
            fanout: [{ variant: 'en-article', targets: ['medium-pub', 'emdash-pub', 'surfdash-pub'] }],
            browser: [],
        });
    });

    it('splits browser targets and non-source variants with adapt:true and limits', () => {
        const workDir = seedWorkDir();
        mkdirSync(join(workDir, '4-illustrations'), { recursive: true }); // wechatmp cover
        writeFileSync(join(workDir, '4-illustrations/cover.png'), 'png');
        seedVariant(workDir, 'zh-article');
        seedVariant(workDir, 'zh-wechat-article');
        const res = run(['itc-publish-plan', workDir, 'juejin-pub,wechatmp-pub', 'en', 'false']);
        expect(res.status, res.stderr).toBe(0);
        const plan = planOf(workDir);
        expect(plan.variants).toEqual({
            'zh-article': {
                file: 'content.zh-article.json',
                adapt: true,
                limits: {},
                switches: { publishStatus: 'draft' },
            },
            'zh-wechat-article': {
                file: 'content.zh-wechat-article.json',
                adapt: true,
                limits: {
                    title: {
                        max: 64,
                        unit: 'unicode_code_points',
                    },
                },
                switches: { operation: '文章', publishStatus: 'draft' },
            },
        });
        // 0298: transport derives from the manifest's browserSession, never a channel-name table.
        expect(plan.fanout).toEqual([]);
        expect(plan.browser).toEqual([
            { target: 'juejin-pub', variant: 'zh-article' },
            { target: 'wechatmp-pub', variant: 'zh-wechat-article' },
        ]);
    });

    it('reuses content.json when a fixed locale equals the source locale', () => {
        const workDir = seedWorkDir();
        const res = run(['itc-publish-plan', workDir, 'zenn-pub', 'ja', 'false']);
        expect(res.status, res.stderr).toBe(0);
        expect(planOf(workDir).variants['ja-article']).toEqual({
            file: 'content.json',
            adapt: false,
            switches: { published: false },
        });
    });

    it('flips switches to live values and plans x-pub only when publish_live=true', () => {
        const live = seedWorkDir();
        seedVariant(live, 'en-short-post'); // x-pub's variant file — the adapt step's output (agent-run, not in CI)
        const res = run(['itc-publish-plan', live, 'medium-pub,x-pub', 'en', 'true']);
        expect(res.status, res.stderr).toBe(0);
        const plan = planOf(live);
        expect(plan.live).toBe(true);
        expect(plan.variants['en-article']?.switches).toEqual({ publishStatus: 'public' });
        expect(plan.variants['en-short-post']?.switches).toEqual({ operation: 'post' });
        expect(plan.fanout).toEqual([{ variant: 'en-article', targets: ['medium-pub'] }]);
        expect(plan.browser).toEqual([{ target: 'x-pub', variant: 'en-short-post' }]);

        const draft = seedWorkDir();
        const resDraft = run(['itc-publish-plan', draft, 'x-pub', 'en', 'false']);
        expect(resDraft.status).toBe(1);
        expect(resDraft.stderr).toContain('x-pub');
        expect(resDraft.stderr).toContain('no draft mode');
    });

    it('plans wechatmp-pub live with complete bindings and skips cover-less targets by name', () => {
        const liveWorkDir = seedWorkDir();
        mkdirSync(join(liveWorkDir, '4-illustrations'), { recursive: true });
        writeFileSync(join(liveWorkDir, '4-illustrations/cover.png'), 'png');
        seedVariant(liveWorkDir, 'zh-wechat-article');
        const res = run(['itc-publish-plan', liveWorkDir, 'wechatmp-pub', 'zh', 'true']);
        expect(res.status, res.stderr).toBe(0);
        const plan = planOf(liveWorkDir);
        expect(plan.variants['zh-wechat-article']?.switches).toEqual({
            operation: '文章',
            publishStatus: 'public',
        });

        const noCover = seedWorkDir();
        const resCover = run(['itc-publish-plan', noCover, 'xhs-pub', 'zh', 'false']);
        expect(resCover.status, resCover.stderr).toBe(0);
        expect(resCover.stderr).toContain('itc-publish-plan: skipped xhs-pub');
        expect(resCover.stderr).toContain('needs a cover image');
        expect(planOf(noCover).warnings).toEqual([
            `skipped xhs-pub: needs a cover image at 4-illustrations/cover.* in ${noCover}`,
        ]);
        expect(planOf(noCover).variants).toEqual({});

        const withCover = seedWorkDir();
        mkdirSync(join(withCover, '4-illustrations'), { recursive: true });
        writeFileSync(join(withCover, '4-illustrations/cover.jpg'), 'jpg');
        writeFileSync(join(withCover, '4-illustrations/card-1.png'), 'png');
        mkdirSync(join(withCover, '4-publish'), { recursive: true });
        writeFileSync(
            join(withCover, '4-publish/content.json'),
            JSON.stringify({
                title: 'T',
                body: 'b',
                metadata: { images: [join(withCover, '4-illustrations/card-1.png')] },
            }),
        );
        seedVariant(withCover, 'zh-short-note');
        expect(run(['itc-publish-plan', withCover, 'xhs-pub', 'zh', 'false']).status, 'cover.jpg counts').toBe(0);
    });

    it('rejects podcast-pub and unknown targets by name', () => {
        for (const target of ['podcast-pub', 'nosuch-pub']) {
            const workDir = seedWorkDir();
            const res = run(['itc-publish-plan', workDir, target, 'en', 'false']);
            expect(res.status, target).toBe(1);
            expect(res.stderr).toContain(`unsupported publish target: ${target}`);
        }
    });

    it('fails without work_dir, targets or source_locale', () => {
        expect(run(['itc-publish-plan']).status).toBe(1);
        expect(run(['itc-publish-plan']).stderr).toContain('usage');
        expect(run(['itc-publish-plan', seedWorkDir()]).status).toBe(1);
    });
});

describe('Discovered publishing capabilities (0150 / 0298)', () => {
    it('discovers capabilities for each standard publish target', () => {
        const { plugins } = discoverAllPlugins();
        const byName = new Map(plugins.map((p) => [p.name, p]));
        const targets = [
            'medium-pub',
            'substack-pub',
            'emdash-pub',
            'surfdash-pub',
            'zenn-pub',
            'qiita-pub',
            'wechatmp-pub',
            'juejin-pub',
            'infoq-pub',
            'xhs-pub',
            'x-pub',
        ];
        for (const target of targets) {
            const plugin = byName.get(target);
            expect(plugin?.publishing, target).toBeDefined();
            expect(plugin?.publishing?.defaultProfile, target).toBeDefined();
            const profile = plugin?.publishing?.profiles[plugin.publishing.defaultProfile];
            expect(profile, target).toBeDefined();
        }
    });

    it('carries explicit mode bindings for plannable modes and rejects draft for x-pub post', () => {
        const { plugins } = discoverAllPlugins();
        const byName = new Map(plugins.map((p) => [p.name, p]));
        const xPub = byName.get('x-pub')?.publishing?.profiles.post;
        expect(xPub?.modes.draft).toBeUndefined();
        expect(xPub?.modes.live?.metadata).toEqual({ operation: 'post' });

        const qiita = byName.get('qiita-pub')?.publishing?.profiles.article;
        expect(qiita?.modes.draft?.metadata).toEqual({ private: true, published: false });
        expect(qiita?.modes.live?.metadata).toEqual({ private: false, published: true });

        const wechat = byName.get('wechatmp-pub')?.publishing?.profiles.article;
        expect(wechat?.modes.draft?.metadata).toEqual({ operation: '文章', publishStatus: 'draft' });
        expect(wechat?.modes.live?.metadata).toEqual({ operation: '文章', publishStatus: 'public' });
    });
});

// ---------------------------------------------------------------------------
// 0150 — in-process suite. The spawn tests above assert real exit codes/stderr,
// but Bun's coverage cannot see subprocesses, so the per-file coverage threshold
// only sees these direct calls. `fail()` exits via process.exit, stubbed here.
// ---------------------------------------------------------------------------

describe('itc stages in-process (coverage of the spawned module body)', () => {
    type Stages = {
        itcOutlinePick: (args: string[]) => void;
        itcReport: (args: string[]) => void;
        itcMaterialize: (args: string[]) => void;
        itcPublishPlan: (args: string[]) => void;
        itcPublishFanout: (args: string[]) => void;
        itcPublishNext: (args: string[]) => void;
        itcAdaptVerify: (args: string[]) => void;
    };
    const loadMod = async (): Promise<Stages> => (await import(STAGES)) as unknown as Stages;
    class ExitError extends Error {
        constructor(readonly code: number) {
            super(`exit ${code}`);
        }
    }

    /** Run `fn` with process.exit/console.error captured; returns its exit code or result. */
    async function capture(fn: (mod: Stages) => void): Promise<{ exit?: number; stderr: string }> {
        const mod = await loadMod();
        const origExit = process.exit;
        const origErr = console.error;
        const origLog = console.log;
        let stderr = '';
        console.error = (message: unknown) => {
            stderr += `${String(message)}\n`;
        };
        // Stages emit operator progress on stdout (e.g. fan-out per-group exit lines); capture it
        // so in-process runs don't pollute the test reporter.
        console.log = () => {};
        process.exit = (code?: number) => {
            throw new ExitError(code ?? 0);
        };
        try {
            fn(mod);
            return { stderr };
        } catch (error) {
            if (error instanceof ExitError) return { exit: error.code, stderr };
            throw error;
        } finally {
            process.exit = origExit;
            console.error = origErr;
            console.log = origLog;
        }
    }

    it('itc-outline-pick branches', async () => {
        const ok = seedWorkDir();
        seedOutlinePick(ok, { pick: 'a', rationale: 'x' }, ['a']);
        const done = await capture((m) => m.itcOutlinePick([ok]));
        expect(done.exit).toBeUndefined();
        expect(readFileSync(join(ok, '2-outline/.auto-pick'), 'utf-8')).toBe('a');

        const missing = await capture((m) => m.itcOutlinePick([seedWorkDir()]));
        expect(missing.exit).toBe(1);
        expect(missing.stderr).toContain('outline recommendation not found');

        const badPick = seedWorkDir();
        seedOutlinePick(badPick, { pick: 'z', rationale: 'x' }, ['a']);
        const invalid = await capture((m) => m.itcOutlinePick([badPick]));
        expect(invalid.exit).toBe(1);
        expect(invalid.stderr).toContain('invalid pick');

        const noOption = seedWorkDir();
        seedOutlinePick(noOption, { pick: 'b', rationale: 'x' }, ['a']);
        const absent = await capture((m) => m.itcOutlinePick([noOption]));
        expect(absent.exit).toBe(1);
        expect(absent.stderr).toContain('picked outline option not found');

        const usage = await capture((m) => m.itcOutlinePick([]));
        expect(usage.exit).toBe(1);
        expect(usage.stderr).toContain('usage');
    });

    it('itc-report branches', async () => {
        const pass = seedWorkDir();
        writeFileSync(join(pass, '.itc-verdict.json'), JSON.stringify({ verdict: 'PASS', confidence: 'HIGH' }));
        writeFileSync(join(pass, '.auto-revise-count'), '1\n');
        const done = await capture((m) => m.itcReport([pass, '2']));
        expect(done.exit).toBeUndefined();
        expect(JSON.parse(readFileSync(join(pass, '5-report/report.json'), 'utf-8'))).toEqual({
            outcome: 'done',
            verdict: 'PASS',
            revisions: 1,
        });

        const fallback = seedWorkDir();
        writeFileSync(join(fallback, '.revise-count'), 'not-a-number');
        const nonNumeric = await capture((m) => m.itcReport([fallback]));
        expect(nonNumeric.exit).toBeUndefined(); // non-numeric count -> 0 via the fallback chain

        const fail = seedWorkDir();
        writeFileSync(join(fail, '.itc-verdict.json'), JSON.stringify({ verdict: 'FAIL' }));
        const failed = await capture((m) => m.itcReport([fail]));
        expect(failed.exit).toBeUndefined();
        expect(JSON.parse(readFileSync(join(fail, '5-report/report.json'), 'utf-8')).outcome).toBe('failed');

        const junk = seedWorkDir();
        writeFileSync(join(junk, '.itc-verdict.json'), 'not json');
        const badJson = await capture((m) => m.itcReport([junk]));
        expect(badJson.exit).toBe(1);
        expect(badJson.stderr).toContain('invalid JSON');

        const usage = await capture((m) => m.itcReport([]));
        expect(usage.exit).toBe(1);
    });

    it('itc-materialize branches', async () => {
        const ok = seedWorkDir();
        seedDraft(ok, '# T\n\nBody.\n');
        writeFileSync(
            join(ok, 'brief.md'),
            '---\ntags: [rust, ci]\nkeywords: rust, builds\ndescription: "Ship."\n: bad line\n',
        ); // unterminated frontmatter -> ignored
        const bare = await capture((m) => m.itcMaterialize([ok, 'true']));
        expect(bare.exit).toBeUndefined();
        expect(JSON.parse(readFileSync(join(ok, '4-publish/content.json'), 'utf-8')).metadata).toEqual({
            published: true,
        });

        const full = seedWorkDir();
        seedDraft(full, '# T\n\nBody.\n');
        writeFileSync(`${full}/docs.json`, JSON.stringify([{ id: 'd1', sourceUri: 'https://x', title: 'X' }]));
        mkdirSync(join(full, '4-illustrations')); // exists but coverless
        writeFileSync(
            join(full, 'brief.md'),
            '---\ntags: [rust, ci]\nkeywords: rust, builds\ndescription: "Ship."\nno colon line\n---\nbody\n',
        );
        const done = await capture((m) => m.itcMaterialize([full, 'false']));
        expect(done.exit).toBeUndefined();
        const content = JSON.parse(readFileSync(join(full, '4-publish/content.json'), 'utf-8'));
        expect(content.references).toEqual([{ url: 'https://x', title: 'X', cite: 'd1' }]);
        expect(content.metadata).toEqual({
            published: false,
            tags: ['rust', 'ci'],
            keywords: ['rust', 'builds'],
            description: 'Ship.',
        });

        const blocked = seedWorkDir();
        seedDraft(blocked, '# T\n\nBody.\n');
        writeFileSync(join(blocked, '4-publish'), 'a file where the output dir goes');
        const unwritable = await capture((m) => m.itcMaterialize([blocked, 'false']));
        expect(unwritable.exit).toBe(1);
        expect(unwritable.stderr).toContain('cannot write');

        const missing = await capture((m) => m.itcMaterialize([seedWorkDir(), 'false']));
        expect(missing.exit).toBe(1);
        expect(missing.stderr).toContain('final draft not found');

        const noH1 = seedWorkDir();
        seedDraft(noH1, 'prose only\n');
        expect((await capture((m) => m.itcMaterialize([noH1, 'false']))).stderr).toContain('no H1 title');

        const empty = seedWorkDir();
        seedDraft(empty, '# Only title\n');
        expect((await capture((m) => m.itcMaterialize([empty, 'false']))).stderr).toContain('empty body');

        const usage = await capture((m) => m.itcMaterialize([]));
        expect(usage.exit).toBe(1);
    });

    it('itc-publish-plan branches', async () => {
        const ok = seedWorkDir();
        const done = await capture((m) => m.itcPublishPlan([ok, 'medium-pub', 'en', 'false']));
        expect(done.exit).toBeUndefined();
        expect(
            Object.keys(JSON.parse(readFileSync(join(ok, '4-publish/publish-plan.json'), 'utf-8')).variants),
        ).toEqual(['en-article']);

        for (const [targets, live, message] of [
            ['podcast-pub', 'false', 'unsupported publish target'],
            ['x-pub', 'false', 'no draft mode'],
        ] as const) {
            const workDir = seedWorkDir();
            const res = await capture((m) => m.itcPublishPlan([workDir, targets, 'en', live]));
            expect(res.exit, targets).toBe(1);
            expect(res.stderr, targets).toContain(message);
        }

        // A cover-requiring target without a cover is SKIPPED, not an error: the stage stays clean,
        // the warning is echoed to stderr, and a plan is still written (with nothing left to route).
        const coverless = seedWorkDir();
        const skipped = await capture((m) => m.itcPublishPlan([coverless, 'xhs-pub', 'en', 'false']));
        expect(skipped.exit).toBeUndefined();
        expect(skipped.stderr).toContain('itc-publish-plan: skipped xhs-pub');
        expect(skipped.stderr).toContain('needs a cover image');
        expect(JSON.parse(readFileSync(join(coverless, '4-publish/publish-plan.json'), 'utf-8')).warnings).toEqual([
            `skipped xhs-pub: needs a cover image at 4-illustrations/cover.* in ${coverless}`,
        ]);

        const live = seedWorkDir();
        mkdirSync(join(live, '4-illustrations'));
        writeFileSync(join(live, '4-illustrations/cover.jpg'), 'j');
        // x-pub's variant file — the adapt step's output (agent-run, not in CI)
        mkdirSync(join(live, '4-publish'), { recursive: true });
        writeFileSync(
            join(live, '4-publish/content.en-short-post.json'),
            JSON.stringify({ title: 'T', format: 'markdown', body: 'b', metadata: {} }),
        );
        const liveRun = await capture((m) => m.itcPublishPlan([live, 'x-pub,x-pub,medium-pub', 'en', 'true']));
        expect(liveRun.exit).toBeUndefined(); // duplicate targets dedupe; x-pub planned live; cover.jpg found
        const livePlan = JSON.parse(readFileSync(join(live, '4-publish/publish-plan.json'), 'utf-8'));
        expect(livePlan.live).toBe(true);
        expect(livePlan.fanout).toEqual([{ variant: 'en-article', targets: ['medium-pub'] }]);
        expect(livePlan.browser).toEqual([{ target: 'x-pub', variant: 'en-short-post' }]);

        const usage = await capture((m) => m.itcPublishPlan([seedWorkDir()]));
        expect(usage.exit).toBe(1);
        expect(usage.stderr).toContain('usage');
    });
    it('itc-publish-plan is a no-op inside the native stage (no re-entry) and itc-report fails loud on an unwritable report', async () => {
        const nested = seedWorkDir();
        const prior = process.env._KK_ITC_STAGE_NATIVE;
        process.env._KK_ITC_STAGE_NATIVE = '1';
        try {
            expect(
                (await capture((m) => m.itcPublishPlan([nested, 'medium-pub', 'en', 'false']))).exit,
            ).toBeUndefined();
        } finally {
            if (prior === undefined) delete process.env._KK_ITC_STAGE_NATIVE;
            else process.env._KK_ITC_STAGE_NATIVE = prior;
        }
        expect(existsSync(join(nested, '4-publish/publish-plan.json'))).toBe(false);

        const blocked = seedWorkDir();
        writeFileSync(join(blocked, '5-report'), 'a file where the report dir belongs');
        const res = await capture((m) => m.itcReport([blocked, '2']));
        expect(res.exit).toBe(1);
        expect(res.stderr).toContain('cannot write report');
    });
    it('itc-report publish section (0151): fanout aggregates, browser results, decline', async () => {
        const plan = {
            live: true,
            sourceLocale: 'en',
            variants: {
                'en-article': { file: 'content.en-article.json', adapt: false, switches: { published: true } },
            },
            fanout: [{ variant: 'en-article', targets: ['medium-pub', 'zenn-pub'] }],
            browser: [{ target: 'x-pub', variant: 'en-short-post' }],
        };
        const seedPlan = (workDir: string): string => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(join(publishDir, 'publish-plan.json'), JSON.stringify(plan));
            return publishDir;
        };

        // Nothing ran: every planned target is an unresolved failure and the run outcome is failed.
        const none = seedWorkDir();
        seedPlan(none);
        const noneRun = await capture((m) => m.itcReport([none]));
        expect(noneRun.exit).toBeUndefined();
        const noneReport = JSON.parse(readFileSync(join(none, '5-report/report.json'), 'utf-8'));
        expect(noneReport.outcome).toBe('failed');
        expect(noneReport.publish.targets).toEqual([
            {
                target: 'medium-pub',
                transport: 'fanout',
                ok: false,
                error: `no ${join('4-publish', 'fanout-result.en-article.json')}`,
            },
            {
                target: 'zenn-pub',
                transport: 'fanout',
                ok: false,
                error: `no ${join('4-publish', 'fanout-result.en-article.json')}`,
            },
            {
                target: 'x-pub',
                transport: 'browser',
                ok: false,
                error: `no ${join('4-publish', 'result.x-pub.json')}`,
            },
        ]);
        expect(noneReport.publish.retryCommands).toEqual([]); // variant file absent -> no retry command
        expect(readFileSync(join(none, '5-report/report.md'), 'utf-8')).toContain('FAILED');

        // A partial aggregate: ok rows carry urls, junk-typed fields are dropped, failed rows build a retry command.
        const partial = seedWorkDir();
        const partialDir = seedPlan(partial);
        writeFileSync(join(partialDir, 'content.en-article.json'), JSON.stringify({ metadata: {} }));
        writeFileSync(
            join(partialDir, 'fanout-result.en-article.json'),
            JSON.stringify({
                targets: [
                    { target: 'medium-pub', ok: true, url: 'https://x' },
                    { target: 'zenn-pub', ok: false, error: 'boom' },
                    { target: 'x-pub', ok: 'yes', url: 42 }, // junk types collapse to a plain failed row
                ],
            }),
        );
        writeFileSync(join(partialDir, 'result.x-pub.json'), JSON.stringify({ ok: true, url: 'https://z' }));
        const partialRun = await capture((m) => m.itcReport([partial]));
        expect(partialRun.exit).toBeUndefined();
        const partialReport = JSON.parse(readFileSync(join(partial, '5-report/report.json'), 'utf-8'));
        expect(partialReport.outcome).toBe('failed');
        expect(partialReport.publish.targets[2]).toEqual({ target: 'x-pub', transport: 'fanout', ok: false });
        expect(partialReport.publish.retryCommands).toEqual([
            `kk executor fan-out --content ${join(partialDir, 'content.en-article.json')} --retry-from ${join(partialDir, 'fanout-result.en-article.json')} --out ${join(partialDir, 'fanout-result.en-article.json')}`,
        ]);
        expect(readFileSync(join(partial, '5-report/report.md'), 'utf-8')).toContain('Retry the failed fan-out groups');

        // A clean aggregate plus a browser result is a done run with no retries.
        const clean = seedWorkDir();
        const cleanDir = seedPlan(clean);
        writeFileSync(
            join(cleanDir, 'fanout-result.en-article.json'),
            JSON.stringify({ targets: [{ target: 'medium-pub', ok: true, url: 'https://x' }] }),
        );
        writeFileSync(join(cleanDir, 'result.x-pub.json'), JSON.stringify({ ok: true, url: 'https://z' }));
        const cleanRun = await capture((m) => m.itcReport([clean]));
        expect(cleanRun.exit).toBeUndefined();
        const cleanReport = JSON.parse(readFileSync(join(clean, '5-report/report.json'), 'utf-8'));
        expect(cleanReport.outcome).toBe('done');
        expect(cleanReport.publish.retryCommands).toEqual([]);

        // Declined: the plan exists but the operator marker keeps the run send-free.
        const declined = seedWorkDir();
        seedPlan(declined);
        writeFileSync(join(declined, '4-publish', '.publish-declined'), '');
        const declinedRun = await capture((m) => m.itcReport([declined]));
        expect(declinedRun.exit).toBeUndefined();
        expect(JSON.parse(readFileSync(join(declined, '5-report/report.json'), 'utf-8')).outcome).toBe('declined');
        expect(readFileSync(join(declined, '5-report/report.md'), 'utf-8')).toContain('Declined by the operator');
    });

    it('itc-publish-fanout (0151): drives kk fan-out per group, stamps switches, writes routing markers', async () => {
        const binDir = mkdtempSync(join(tmpdir(), 'kk-itc-stub-bin-'));
        // Minimal kk stub: writes the aggregate named by --out (when told to), exits with $KK_EXIT.
        writeFileSync(
            join(binDir, 'kk'),
            '#!/bin/bash\nout=""; prev=""\nfor a in "$@"; do [ "$prev" = "--out" ] && out="$a"; prev="$a"; done\n[ -n "$KK_STUB_AGGREGATE" ] && printf \'%s\' "$KK_STUB_AGGREGATE" > "$out"\nexit $' +
                '{KK_EXIT:-0}\n',
        );
        chmodSync(join(binDir, 'kk'), 0o755);
        const origPath = process.env.PATH;
        process.env.PATH = `${binDir}:${origPath ?? ''}`;
        const plan = {
            live: true,
            sourceLocale: 'en',
            variants: {
                'en-article': { file: 'content.en-article.json', adapt: false, switches: { published: true } },
            },
            fanout: [{ variant: 'en-article', targets: ['medium-pub'] }],
            browser: [{ target: 'x-pub', variant: 'en-short-post' }],
        };
        const seedFanout = (aggregate: string, exitCode: string): string => {
            const workDir = seedWorkDir();
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(join(publishDir, 'publish-plan.json'), JSON.stringify(plan));
            writeFileSync(join(publishDir, 'content.en-article.json'), JSON.stringify({ metadata: { tags: ['t'] } }));
            process.env.KK_STUB_AGGREGATE = aggregate;
            process.env.KK_EXIT = exitCode;
            return workDir;
        };
        try {
            // Clean send: aggregate written, switches stamped onto the variant content, cursor on the first browser.
            const ok = seedFanout(JSON.stringify({ targets: [{ ok: true }] }), '0');
            const okRun = await capture((m) => m.itcPublishFanout([ok]));
            expect(okRun.exit).toBeUndefined();
            const content = JSON.parse(readFileSync(join(ok, '4-publish/content.en-article.json'), 'utf-8'));
            expect(content.metadata).toEqual({ tags: ['t'], published: true }); // merged, never removed
            expect(readFileSync(join(ok, '4-publish/.fanout-failed'), 'utf-8')).toBe('');
            expect(readFileSync(join(ok, '4-publish/.next-browser'), 'utf-8')).toBe('x-pub');

            // Exit 1 = target failures kept as data; .fanout-failed flips to 1.
            const failed = seedFanout(JSON.stringify({ targets: [{ ok: false, error: 'boom' }] }), '1');
            const failedRun = await capture((m) => m.itcPublishFanout([failed]));
            expect(failedRun.exit).toBeUndefined();
            expect(readFileSync(join(failed, '4-publish/.fanout-failed'), 'utf-8')).toBe('1');

            // --retry skips groups whose aggregate has no failures (the stub writes nothing when skipped).
            const retry = seedFanout(JSON.stringify({ targets: [{ ok: true }] }), '0');
            await capture((m) => m.itcPublishFanout([retry]));
            const retryRun = await capture((m) => m.itcPublishFanout([retry, '--retry']));
            expect(retryRun.exit).toBeUndefined();
            expect(existsSync(join(retry, '4-publish/fanout-result.en-article.json'))).toBe(true);

            // Exit 2 = input error -> fail; a missing aggregate -> fail.
            const inputError = seedFanout(JSON.stringify({ targets: [] }), '2');
            const inputRun = await capture((m) => m.itcPublishFanout([inputError]));
            expect(inputRun.exit).toBe(1);
            expect(inputRun.stderr).toContain('fan-out input error');

            const silent = seedFanout('', '0');
            const silentRun = await capture((m) => m.itcPublishFanout([silent]));
            expect(silentRun.exit).toBe(1);
            expect(silentRun.stderr).toContain('did not write');

            const noVariant = seedFanout(JSON.stringify({ targets: [{ ok: true }] }), '0');
            rmSync(join(noVariant, '4-publish/content.en-article.json'));
            const variantRun = await capture((m) => m.itcPublishFanout([noVariant]));
            expect(variantRun.exit).toBe(1);
            expect(variantRun.stderr).toContain('variant file not found');

            const noPlan = seedWorkDir();
            const planRun = await capture((m) => m.itcPublishFanout([noPlan]));
            expect(planRun.exit).toBe(1);
            expect(planRun.stderr).toContain('publish plan not found');

            const usage = await capture((m) => m.itcPublishFanout([]));
            expect(usage.exit).toBe(1);
            expect(usage.stderr).toContain('usage');
        } finally {
            if (origPath === undefined) delete process.env.PATH;
            else process.env.PATH = origPath;
            delete process.env.KK_STUB_AGGREGATE;
            delete process.env.KK_EXIT;
        }
    });

    it('itc-publish-next (0151): cursor walks browser targets lacking a Result, empties when done', async () => {
        const plan = {
            live: false,
            sourceLocale: 'en',
            variants: {},
            fanout: [],
            browser: [
                { target: 'x-pub', variant: 'en-short-post' },
                { target: 'surfdash-pub', variant: 'en-short-post' },
            ],
        };
        const workDir = seedWorkDir();
        const publishDir = join(workDir, '4-publish');
        mkdirSync(publishDir, { recursive: true });
        writeFileSync(join(publishDir, 'publish-plan.json'), JSON.stringify(plan));
        const cursor = (): string => readFileSync(join(publishDir, '.next-browser'), 'utf-8');

        await capture((m) => m.itcPublishNext([workDir]));
        expect(cursor()).toBe('x-pub');
        writeFileSync(join(publishDir, 'result.x-pub.json'), JSON.stringify({ ok: true }));
        await capture((m) => m.itcPublishNext([workDir]));
        expect(cursor()).toBe('surfdash-pub');
        writeFileSync(join(publishDir, 'result.surfdash-pub.json'), JSON.stringify({ ok: true }));
        await capture((m) => m.itcPublishNext([workDir]));
        expect(cursor()).toBe('');

        const noPlan = await capture((m) => m.itcPublishNext([seedWorkDir()]));
        expect(noPlan.exit).toBe(1);
        expect(noPlan.stderr).toContain('publish plan not found');

        const usage = await capture((m) => m.itcPublishNext([]));
        expect(usage.exit).toBe(1);
        expect(usage.stderr).toContain('usage');
    });

    it('itc-adapt-verify branches (0152)', async () => {
        const seedPlan = (workDir: string): void => {
            const publishDir = join(workDir, '4-publish');
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(publishDir, 'publish-plan.json'),
                JSON.stringify({
                    live: false,
                    sourceLocale: 'en',
                    variants: {
                        'en-article': { file: 'content.json', adapt: false, switches: { published: false } },
                        'ja-article': {
                            file: 'content.ja-article.json',
                            adapt: true,
                            limits: {},
                            switches: { published: false },
                        },
                    },
                    fanout: [],
                    browser: [],
                }),
            );
        };

        const ok = seedWorkDir();
        seedPlan(ok);
        writeFileSync(
            join(ok, '4-publish/content.ja-article.json'),
            JSON.stringify({ title: 'T', format: 'article', body: 'b', metadata: {} }),
        );
        const done = await capture((m) => m.itcAdaptVerify([ok]));
        expect(done.exit).toBeUndefined();

        // missing variant file -> exit 1, naming the variant and its file
        const missing = seedWorkDir();
        seedPlan(missing);
        const miss = await capture((m) => m.itcAdaptVerify([missing]));
        expect(miss.exit).toBe(1);
        expect(miss.stderr).toContain('ja-article');
        expect(miss.stderr).toContain('content.ja-article.json');

        // present but lacking a non-empty title or body -> exit 1
        for (const bad of [{ title: '', body: 'b' }, { title: 'T', body: '   ' }, { title: 'T' }, {}]) {
            const workDir = seedWorkDir();
            seedPlan(workDir);
            writeFileSync(join(workDir, '4-publish/content.ja-article.json'), JSON.stringify(bad));
            const res = await capture((m) => m.itcAdaptVerify([workDir]));
            expect(res.exit, JSON.stringify(bad)).toBe(1);
            expect(res.stderr).toContain('title/body');
        }

        // adapt:false variants are not checked; a missing plan fails by path
        const noAdapt = seedWorkDir();
        seedPlan(noAdapt);
        writeFileSync(join(noAdapt, '4-publish/content.json'), JSON.stringify({ title: 'T', body: 'b' }));
        writeFileSync(
            join(noAdapt, '4-publish/publish-plan.json'),
            JSON.stringify({
                live: false,
                sourceLocale: 'en',
                variants: { 'en-article': { file: 'content.json', adapt: false, switches: {} } },
                fanout: [],
                browser: [],
            }),
        );
        expect((await capture((m) => m.itcAdaptVerify([noAdapt]))).exit).toBeUndefined();
        expect((await capture((m) => m.itcAdaptVerify([seedWorkDir()]))).stderr).toContain('publish plan not found');
        expect((await capture((m) => m.itcAdaptVerify([]))).stderr).toContain('usage');
    });
});
