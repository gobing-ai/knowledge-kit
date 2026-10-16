/**
 * G8/0254 — the IT Content projection, the plan-derived target results and the reader's ITC route.
 *
 * Failure-first list (written before the code):
 * 1. an out-of-vocabulary judge confidence is reported unknown, never echoed;
 * 2. revision counts come from recorded draft-revise/draft-autorevise VISITS, never a counter file;
 * 3. a judge/revision/outline with no recorded producer stays unavailable, never zero;
 * 4. per-target results are read from the run's plan and BOTH publisher shapes are handled;
 * 5. a failed target is a failed outcome, never a publish;
 * 6. a legacy run without a capture reports unknown config (uncaptured keys), not today's defaults;
 * 7. a later owner makes an earlier run's files superseded (AC6);
 * 8. an external ITC workspace is captured only as a trusted root's canonical child; broad roots
 *    and the config root are refused; XOR/force refusal never overwrites an existing brief;
 * 9. a real prepare initialises the revision counter and a real capture binds the workspace.
 *
 * Real temporary directories, the real prepare stage and a real Bun HTTP server observe the path.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowName } from '@gobing-ai/kk-board/contracts';
import { captureRun } from '../../src/board/capture';
import type { ArtifactObservation } from '../../src/board/collect';
import {
    asJudgeConfidence,
    authorizeItcChild,
    boundedPreview,
    type ItcSummary,
    isOutOfVocabularyConfidence,
    itcResultSpecs,
    projectItcResults,
    projectJudge,
    revisionUsage,
    revisionUsageFromChild,
} from '../../src/board/itc';
import { createBoardReader } from '../../src/board/reader';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const STAMP = '20261011';
const STAGE = join(import.meta.dir, '../../../../plugins/kk/scripts/kk-workflow-stages.ts');
const tempDirs: string[] = [];
const servers: { stop(): void }[] = [];

function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const server of servers) server.stop();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The fake Board: project identity + run detail + the state-machine progress projection. */
function startFakeBoard(projectPath: string, states: unknown[]) {
    const state = {
        projectPath,
        run: { id: 'run-1', workflowName: 'kk-itc', status: 'done', startedAt: null, completedAt: null },
    };
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
            const url = new URL(request.url);
            if (url.pathname === '/api/project') return json({ name: 'proj', path: state.projectPath });
            if (url.pathname === `/api/runs/${state.run.id}`)
                return json({ run: state.run, phases: [], transitions: [], actions: [] });
            if (url.pathname === `/api/runs/${state.run.id}/progress`)
                return json({ schemaVersion: 1, runId: state.run.id, workflow: 'kk-itc', status: 'done', states });
            return json({ error: 'unknown' }, 404);
        },
    });
    servers.push(server);
    return { origin: `http://127.0.0.1:${server.port}` };
}

/** Every ITC producer state a completed run recorded, as `passed`. */
function passedStates(): unknown[] {
    const keys: Record<string, string[]> = {
        prepare: ['prepare:onEnter:0'],
        'outline-write': ['outline-write:onEnter:0', 'outline-write:onEnter:1'],
        'outline-commit': ['outline-commit:onEnter:0'],
        'draft-write': ['draft-write:onEnter:0'],
        judge: ['judge:onEnter:0', 'judge:onEnter:1'],
        illustrate: ['illustrate:onEnter:0', 'illustrate:onEnter:1'],
        'publish-plan': ['publish-plan:onEnter:0'],
        'publish-fanout': ['publish-fanout:onEnter:0'],
        'publish-agent': ['publish-agent:onEnter:0', 'publish-agent:onEnter:1', 'publish-agent:onEnter:2'],
        report: ['report:onEnter:0'],
    };
    return Object.entries(keys).map(([state, actionKeys], index) => ({
        state,
        visit: 1,
        status: 'passed',
        actions: actionKeys.map((actionKey) => ({ actionKey, status: 'passed', attempts: [index] })),
    }));
}

/** Write the ITC workspace artifacts the projection reads (with optional overrides/removals). */
function seedItcWorkspace(workDir: string, overrides: Record<string, string | null> = {}): void {
    for (const rel of ['2-outline', '4-illustrations', '4-publish', '5-report']) {
        mkdirSync(join(workDir, rel), { recursive: true });
    }
    const plan = {
        live: false,
        sourceLocale: 'en',
        variants: { 'en-article': { file: 'content.json', adapt: false, switches: {} } },
        fanout: [{ variant: 'en-article', targets: ['surfdash-pub', 'medium-pub'] }],
        browser: [{ target: 'substack-pub', variant: 'en-article' }],
    };
    const files: Record<string, string> = {
        '2-outline/outline-option-a.md': '# Outline A\n\n- one\n- two\n',
        '2-outline/outline-option-b.md': '# Outline B\n\n- alpha\n',
        '2-outline/outline-approved.md': '# Outline B\n\n- alpha\n',
        '3-draft-draft-article.md': '# Draft title\n\nBody paragraph.\n',
        '.itc-verdict.json': JSON.stringify({
            verdict: 'NEEDS_REVISION',
            confidence: 'MEDIUM',
            feedback: ['tighten the intro', 'add a benchmark'],
        }),
        '4-illustrations/cover.png': 'PNG-BYTES',
        '4-publish/publish-plan.json': JSON.stringify(plan),
        '4-publish/fanout-result.en-article.json': JSON.stringify({
            targets: [
                { target: 'surfdash-pub', ok: true, url: 'https://surf.example/post' },
                { target: 'medium-pub', ok: false, error: 'rate limited' },
            ],
        }),
        '4-publish/result.substack-pub.json': JSON.stringify({
            ok: true,
            target: 'substack-pub',
            metadata: { publishStatus: 'draft' },
            url: 'https://substack.example/p/1',
        }),
        '5-report/report.json': JSON.stringify({
            outcome: 'failed',
            verdict: 'NEEDS_REVISION',
            revisions: 2,
            publish: { targets: [] },
        }),
    };
    for (const [rel, body] of Object.entries({ ...files, ...overrides })) {
        if (body === null) continue;
        writeFileSync(join(workDir, rel), body);
    }
}

const SETTINGS = { judge: 'true', auto: 'true', max_revisions: '2', source_locale: 'en' };

/** Seed a project root with one captured ITC workspace under a named `works` root. */
async function seededProject(overrides?: Record<string, string | null>) {
    const root = tempDir('kk-itc-proj-');
    const workDir = join(root, '.works', 'kk-itc', 'run');
    mkdirSync(workDir, { recursive: true });
    seedItcWorkspace(workDir, overrides ?? {});
    await captureRun(
        { workflow: 'kk-itc', runId: 'run-1', workDir, stamp: STAMP, settings: SETTINGS },
        { projectPath: root },
    );
    return { root, workDir };
}

function startReader(boardOrigin: string, projectPath: string) {
    const reader = createBoardReader({ boardOrigin, port: 0, projectPath });
    servers.push(reader);
    return reader.url;
}

interface ResultsJson {
    availability: string;
    summary: ItcSummary;
    artifacts: { id: string; availability: string }[];
    diagnostics: { code: string }[];
}

const resultsUrl = (reader: string) => `${reader}/api/workflows/kk-itc/runs/run-1/results`;
const getResults = async (reader: string): Promise<ResultsJson> =>
    (await (await fetch(resultsUrl(reader))).json()) as ResultsJson;

describe('judge confidence validation', () => {
    it('accepts only HIGH/MEDIUM/LOW and reports anything else as unknown', async () => {
        expect(asJudgeConfidence('HIGH')).toBe('HIGH');
        expect(asJudgeConfidence('low')).toBeNull();
        expect(asJudgeConfidence('CERTAIN')).toBeNull();
        expect(asJudgeConfidence(undefined)).toBeNull();
        expect(isOutOfVocabularyConfidence('CERTAIN')).toBe(true);
        expect(isOutOfVocabularyConfidence('LOW')).toBe(false);
        expect(isOutOfVocabularyConfidence('')).toBe(false);
        expect(projectJudge({ verdict: 'PASS', confidence: 'SURE' })).toMatchObject({
            verdict: 'PASS',
            confidence: null,
            confidenceInvalid: true,
        });
        expect(projectJudge(null)).toBeNull();
    });
});

describe('revisionUsage', () => {
    it('counts recorded revise/auto-revise visits and never invents a zero without progress', async () => {
        const progress = {
            states: [
                { state: 'draft-revise', visit: 1, status: 'passed', actions: [] },
                { state: 'draft-autorevise', visit: 1, status: 'passed', actions: [] },
                { state: 'draft-autorevise', visit: 2, status: 'passed', actions: [] },
            ],
        };
        expect(revisionUsage(progress, { max_revisions: '2' })).toMatchObject({
            revise: 1,
            autoRevise: 2,
            total: 3,
            budget: 2,
            recorded: true,
        });
        expect(revisionUsage(null, {})).toMatchObject({ revise: null, total: null, budget: 3, recorded: false });
        // A recorded but empty progress projection is a real zero, not an unknown.
        expect(revisionUsage({ states: [] }, { max_revisions: 'x' })).toMatchObject({
            revise: 0,
            total: 0,
            budget: null,
        });
    });
});

describe('boundedPreview', () => {
    it('collapses whitespace, bounds length and reports truncation with an ellipsis', async () => {
        expect(boundedPreview('a   b\n c')).toBe('a b c');
        expect(boundedPreview('')).toBeNull();
        expect(boundedPreview(null)).toBeNull();
        const long = boundedPreview('x'.repeat(500), 10);
        expect(long).toBe(`${'x'.repeat(10)}…`);
    });
});

describe('itcResultSpecs', () => {
    it('derives fan-out and browser result specs from the run plan (never a client path)', async () => {
        const plan = JSON.stringify({
            fanout: [{ variant: 'en-article', targets: ['surfdash-pub', 'medium-pub'] }],
            browser: [{ target: 'substack-pub' }],
        });
        const specs = itcResultSpecs(plan);
        expect(specs.map((entry) => entry.spec.pattern)).toEqual([
            '4-publish/fanout-result.en-article.json',
            '4-publish/result.substack-pub.json',
        ]);
        expect(specs[0]?.spec.producerActionKey).toBe('publish-fanout:onEnter:0');
        expect(specs[1]?.spec.producerActionKey).toBe('publish-agent:onEnter:1');
        expect(itcResultSpecs(undefined)).toEqual([]);
        expect(itcResultSpecs('{ not json')).toEqual([]);
    });
});

describe('projectItcResults (pure)', () => {
    const record = {
        schemaVersion: 1 as const,
        projectPath: '/proj',
        workflow: 'kk-itc' as WorkflowName,
        runId: 'run-1',
        workspacePath: '/proj/.works/kk-itc/run',
        stamp: STAMP,
        capturedAt: '2026-10-11T12:00:00.000Z',
        settings: SETTINGS,
    };
    const detail = {
        id: 'run-1',
        workflowName: 'kk-itc',
        status: 'done',
        startedAt: '2026-10-11T12:00:00.000Z',
        completedAt: '2026-10-11T12:10:00.000Z',
    };
    const texts: Record<string, string> = {
        'outline-a': '# Outline A\n',
        draft: '# Draft title\n\nBody.\n',
        'judge-verdict': JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', feedback: ['ok'] }),
        report: JSON.stringify({ outcome: 'done', verdict: 'PASS', revisions: 0 }),
        'itc-fanout-en-article': JSON.stringify({
            targets: [{ target: 'medium-pub', ok: true, url: 'https://medium.example/p/1' }],
        }),
        'itc-browser-substack-pub': JSON.stringify({
            ok: false,
            target: 'substack-pub',
            error: 'login required',
        }),
    };
    const observationOf = (spec: { id: string }): ArtifactObservation | undefined =>
        texts[spec.id] === undefined ? undefined : { state: 'present', text: texts[spec.id] };
    const resultSpecs = itcResultSpecs(
        JSON.stringify({
            fanout: [{ variant: 'en-article', targets: ['medium-pub'] }],
            browser: [{ target: 'substack-pub' }],
        }),
    );

    it('reads both publisher shapes into per-target outcomes', async () => {
        const results = projectItcResults({
            record,
            detail,
            marker: 'owned',
            producerOf: () => 'success',
            observationOf,
            resultSpecs,
            progress: { states: [] },
        });
        const summary = results.summary as unknown as ItcSummary;
        expect(summary.targets).toHaveLength(2);
        expect(summary.targets.find((t) => t.target === 'medium-pub')).toMatchObject({
            transport: 'fanout',
            ok: true,
            url: 'https://medium.example/p/1',
        });
        expect(summary.targets.find((t) => t.target === 'substack-pub')).toMatchObject({
            transport: 'browser',
            ok: false,
            error: 'login required',
        });
        expect(summary.counts).toMatchObject({ targetsOk: 1, targetsFailed: 1, targetsUnknown: 0 });
        expect(summary.outcome).toBe('done');
        expect(summary.judge).toMatchObject({ verdict: 'PASS', confidence: 'HIGH' });
        // Every declared outline is listed with its own availability; an absent one is explicit.
        expect(summary.outlines.map((outline) => outline.id)).toEqual(['outline-a', 'outline-b', 'outline-c']);
        expect(summary.selectedOutline?.availability).toBe('missing');
        expect(summary.draft).toMatchObject({ availability: 'available' });
    });

    it('keeps an unrecorded producer and an unknown report explicit, never zero', async () => {
        const results = projectItcResults({
            record,
            detail,
            marker: 'owned',
            producerOf: (spec) => (spec.id === 'judge-verdict' ? 'failure' : 'unknown'),
            observationOf,
            resultSpecs: [],
        });
        const summary = results.summary as unknown as ItcSummary;
        expect(summary.judge).toBeNull();
        expect(summary.report).toBeNull();
        expect(summary.outcome).toBeNull();
        expect(summary.targets).toEqual([]);
        expect(summary.revisions.recorded).toBe(false);
        expect(results.diagnostics.map((d) => d.code)).toContain('board.publish.unavailable');
        const judgeArtifact = results.artifacts.find((artifact) => artifact.id === 'judge-verdict');
        expect(judgeArtifact?.availability).toBe('missing');
    });
});

describe('reader ITC route', () => {
    it('serves both publisher shapes, the judge feedback and the final report (AC2)', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root, passedStates());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.summary.judge).toMatchObject({
            verdict: 'NEEDS_REVISION',
            confidence: 'MEDIUM',
            feedback: ['tighten the intro', 'add a benchmark'],
        });
        expect(results.summary.targets).toHaveLength(3);
        expect(results.summary.targets.find((t) => t.target === 'surfdash-pub')).toMatchObject({ ok: true });
        expect(results.summary.targets.find((t) => t.target === 'medium-pub')).toMatchObject({ ok: false });
        expect(results.summary.targets.find((t) => t.target === 'substack-pub')).toMatchObject({ ok: true });
        expect(results.summary.selectedOutline?.text).toContain('Outline B');
        expect(results.summary.draft?.text).toContain('Draft title');
        expect(results.artifacts.find((artifact) => artifact.id === 'cover')?.availability).toBe('available');
        expect(results.artifacts.find((artifact) => artifact.id === 'report')?.availability).toBe('available');

        const config = (await (await fetch(`${reader}/api/workflows/kk-itc/runs/run-1/config`)).json()) as {
            settings: Record<string, string>;
            unavailableKeys: string[];
        };
        expect(config.settings).toMatchObject({ judge: 'true', auto: 'true', max_revisions: '2' });
        expect(config.unavailableKeys).toContain('research');
    });

    it('marks a failed publisher artifact unavailable and the target unknown', async () => {
        const { root } = await seededProject({ '4-publish/fanout-result.en-article.json': null });
        const board = startFakeBoard(root, passedStates());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        const fanoutTargets = results.summary.targets.filter((t) => t.transport === 'fanout');
        expect(fanoutTargets.every((t) => t.ok === null)).toBe(true);
        expect(results.summary.counts.targetsUnknown).toBe(2);
    });

    it('reports an out-of-vocabulary judge confidence as unknown, not echoed (AC2)', async () => {
        const { root } = await seededProject({
            '.itc-verdict.json': JSON.stringify({ verdict: 'PASS', confidence: 'SURE' }),
        });
        const board = startFakeBoard(root, passedStates());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.summary.judge).toMatchObject({ verdict: 'PASS', confidence: null, confidenceInvalid: true });
    });

    it('refuses a wrong origin and keeps another workflow out (route guard)', async () => {
        const { root } = await seededProject();
        const board = startFakeBoard(root, passedStates());
        const reader = startReader(board.origin, root);
        expect((await fetch(resultsUrl(reader), { headers: { origin: 'http://evil.example' } })).status).toBe(403);
        expect((await fetch(`${reader}/api/workflows/kk-collect/runs/run-1/results`)).status).toBe(404);
        expect((await fetch(`${reader}/api/workflows/kk-itc/runs/run-1/artifacts/nope`)).status).toBe(404);
    });

    it('marks artifacts superseded for a later workspace owner (AC6)', async () => {
        const { root, workDir } = await seededProject();
        await captureRun(
            { workflow: 'kk-itc', runId: 'run-2', workDir, stamp: STAMP, settings: {} },
            { projectPath: root },
        );
        const board = startFakeBoard(root, passedStates());
        const reader = startReader(board.origin, root);
        const results = await getResults(reader);
        expect(results.availability).toBe('superseded');
        expect(results.diagnostics.map((d) => d.code)).toContain('board.artifact.superseded');
    });
});

describe('ITC workspace capture (AC6 guard)', () => {
    it('accepts only the canonical child of an explicitly trusted root and refuses broad roots', async () => {
        const projectRoot = tempDir('kk-itc-capture-proj-');
        const worksRoot = tempDir('kk-itc-external-works-');
        const workDir = join(worksRoot, 'kk-itc', 'external-topic');
        mkdirSync(workDir, { recursive: true });
        const outcome = await captureRun(
            { workflow: 'kk-itc', runId: 'run-ext', workDir, stamp: STAMP, settings: {} },
            { projectPath: projectRoot, trustedWorksRoot: worksRoot },
        );
        expect(outcome.captured).toBe(true);
        expect(outcome.record?.workspacePath).toBe(workDir);
        // The trusted root itself is never a run workspace.
        await expect(
            captureRun(
                { workflow: 'kk-itc', runId: 'run-root', workDir: worksRoot, stamp: STAMP, settings: {} },
                { projectPath: projectRoot, trustedWorksRoot: worksRoot },
            ),
        ).rejects.toThrow(/works root/);
        // A broad root is refused outright.
        await expect(
            captureRun(
                { workflow: 'kk-itc', runId: 'run-fs', workDir: '/', stamp: STAMP, settings: {} },
                { projectPath: projectRoot, trustedWorksRoot: worksRoot },
            ),
        ).rejects.toThrow(/works root/);
        // A configured trusted root is never the projects own root.
        await expect(
            captureRun(
                { workflow: 'kk-itc', runId: 'run-proj', workDir: join(projectRoot, 'x'), stamp: STAMP, settings: {} },
                { projectPath: projectRoot, trustedWorksRoot: projectRoot },
            ),
        ).rejects.toThrow(/works root/);
    });

    it('never trusts the config directory itself as a works root', async () => {
        const projectRoot = tempDir('kk-itc-config-proj-');
        const configRoot = tempDir('kk-itc-config-root-');
        const workDir = join(configRoot, 'kk-itc', 'run');
        mkdirSync(workDir, { recursive: true });
        await expect(
            captureRun(
                { workflow: 'kk-itc', runId: 'run-cfg', workDir, stamp: STAMP, settings: {} },
                { projectPath: projectRoot, trustedWorksRoot: configRoot, configRoot },
            ),
        ).rejects.toThrow(/works root/);
    });
});

describe('kk-itc prepare + Board capture', () => {
    it('initialises the revision counter, refuses XOR and force, then captures a real run', async () => {
        const workDir = join(tempDir('kk-itc-prep-'), '.works', 'kk-itc', 'run');
        mkdirSync(workDir, { recursive: true });
        const run = (args: string[]) =>
            Bun.spawnSync([process.execPath, STAGE, ...args], { stdout: 'pipe', stderr: 'pipe' });
        // XOR violation: both topic and input_file provided.
        const both = run(['prepare-itc', workDir, 'topic', join(workDir, 'in.md'), 'false']);
        expect(both.exitCode).not.toBe(0);
        expect(both.stderr.toString()).toContain('XOR');
        // A real preparation writes brief.md and zeroes the early revision counter.
        const ok = run(['prepare-itc', workDir, 'a real topic', '', 'false']);
        expect(ok.exitCode, ok.stderr.toString()).toBe(0);
        expect(readFileSync(join(workDir, '.revise-count'), 'utf-8').trim()).toBe('0');
        // An existing brief is protected unless force=true.
        const again = run(['prepare-itc', workDir, 'another topic', '', 'false']);
        expect(again.exitCode).not.toBe(0);
        expect(again.stderr.toString()).toContain('force=true');
        const forced = run(['prepare-itc', workDir, 'another topic', '', 'true']);
        expect(forced.exitCode, forced.stderr.toString()).toBe(0);

        // Capture binds the prepared workspace to the run (the Board reads it as owned).
        const project = tempDir('kk-itc-prep-proj-');
        const capture = await captureRun(
            { workflow: 'kk-itc', runId: 'run-prep', workDir, stamp: STAMP, settings: {} },
            { projectPath: project },
        );
        expect(capture.captured).toBe(true);
        expect(readFileSync(join(workDir, '.kk-board-owner.json'), 'utf-8')).toContain('"runId": "run-prep"');
    });

    it('captures through `kk board capture` with the configured works root (external ITC workspace)', async () => {
        const project = tempDir('kk-itc-cli-proj-');
        const works = tempDir('kk-itc-cli-works-');
        const workDir = join(works, 'kk-itc', 'cli-topic');
        mkdirSync(workDir, { recursive: true });
        const cwd = process.cwd();
        const prevWorks = process.env.KK_WORKS_DIR;
        process.env.KK_WORKS_DIR = works;
        process.chdir(project);
        const captured = captureOutput();
        try {
            const code = await main([
                'node',
                'kk',
                'board',
                'capture',
                '--workflow',
                'kk-itc',
                '--run',
                'run-cli',
                '--work-dir',
                workDir,
                '--stamp',
                STAMP,
                '--setting',
                'judge=true',
            ]);
            expect(code).toBe(0);
            const lastLine = captured.read().trim().split('\n').at(-1) ?? '{}';
            const payload = JSON.parse(lastLine) as { captured: boolean; workspacePath: string };
            expect(payload.captured).toBe(true);
            expect(payload.workspacePath).toBe(workDir);
        } finally {
            captured.restore();
            process.chdir(cwd);
            if (prevWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = prevWorks;
        }
    });
});

describe('0303 — ITC child evidence and revision counts across the DAG refactor', () => {
    const SETTINGS = { max_revisions: '2' };

    it('authorizes only a child that binds this parent run, workspace and definition digest', async () => {
        const ok = authorizeItcChild(
            { schemaVersion: 1, parentRunId: 'run-1', childRunId: 'run-1-author', definitionDigest: 'sha256:abc' },
            { parentRunId: 'run-1', workDir: '/w', definitionDigest: 'sha256:abc' },
        );
        expect(ok.childRunId).toBe('run-1-author');
        expect(ok.reason).toBeNull();

        // A different parent, an unexpected child id and a mismatched digest are all refused.
        expect(
            authorizeItcChild(
                { parentRunId: 'run-2', childRunId: 'run-2-author' },
                {
                    parentRunId: 'run-1',
                    workDir: '/w',
                    definitionDigest: null,
                },
            ).childRunId,
        ).toBeNull();
        expect(
            authorizeItcChild(
                { parentRunId: 'run-1', childRunId: 'someone-else' },
                {
                    parentRunId: 'run-1',
                    workDir: '/w',
                    definitionDigest: null,
                },
            ).reason,
        ).toContain('unexpected child run id');
        expect(
            authorizeItcChild(
                { parentRunId: 'run-1', childRunId: 'run-1-author', definitionDigest: 'sha256:zzz' },
                {
                    parentRunId: 'run-1',
                    workDir: '/w',
                    definitionDigest: 'sha256:abc',
                },
            ).reason,
        ).toContain('different definition digest');

        // A missing document is refused, never treated as an empty child.
        expect(
            authorizeItcChild(undefined, { parentRunId: 'run-1', workDir: '/w', definitionDigest: null }).reason,
        ).toContain('missing');
    });

    it('reads child revision visits when the binding verified and nulls — never zero — when it did not', async () => {
        const childProgress = {
            states: [{ state: 'draft-revise' }, { state: 'draft-autorevise' }, { state: 'draft-autorevise' }],
        };
        const verified = { childRunId: 'run-1-author', definitionDigest: 'sha256:abc', reason: null };
        const usage = revisionUsageFromChild(null, verified, childProgress, SETTINGS);
        expect(usage).toEqual({ revise: 1, autoRevise: 2, total: 3, budget: 2, recorded: true });

        const refused = {
            childRunId: null,
            definitionDigest: null,
            reason: 'author-run.json does not bind this parent run',
        };
        const none = revisionUsageFromChild(null, refused, childProgress, SETTINGS);
        expect(none.revise).toBeNull();
        expect(none.total).toBeNull();
        expect(none.recorded).toBe(false);
        expect(none.budget).toBe(2);
    });

    it('keeps a historical single-FSM capture readable from its own progress projection', async () => {
        const historical = { states: [{ state: 'draft-revise' }] };
        const usage = revisionUsageFromChild(
            historical,
            { childRunId: null, definitionDigest: null, reason: 'no child' },
            null,
            SETTINGS,
        );
        expect(usage).toEqual(revisionUsage(historical, SETTINGS));
        expect(usage.revise).toBe(1);
    });
});
