import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Task 0331 — the variants scope of the content-safety review.
 *
 * The daily run's FINAL publish variants (`30-variants/*.content.json`) must be reviewed like the
 * drafts are, and the publish matrix must gate live launches on that evidence. The same
 * `kk-daily-safety` machine now serves both surfaces through one trailing scope argument
 * (`safety_scope_dir`): the drafts paths stay byte-identical by default, and the variants scope
 * re-roots the artifact set to `4-safety-variants`, digests the manifest-listed variant bytes and
 * leaves `safety.json` — status, exclusion record, per-variant sha256 — for the bundle freeze.
 * This file pins the authored machines (the drafts default is untouched) and drives the real
 * stage runner and artifact-check script out of process on the whole variants chain, including
 * the two failure-first cases: bytes edited after the review are refused at the verdict, and a
 * quality block never quarantines the drafts directory it did not review.
 */

const REPO = join(import.meta.dir, '../../..');
const SAFETY_MACHINE = resolve(
    process.env.KK_SAFETY_WORKFLOW ?? join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml'),
);
const VOICE3 = join(REPO, 'plugins/kk/workflows/kk-news-generate.yaml');
const STAGE_RUNNER = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const CHECK = join(import.meta.dir, '../scripts/safety-artifact-check.ts');
const STAMP = '20261022';
const VARIANTS_SCOPE = '4-safety-variants';

const tempDirs: string[] = [];
afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function runStage(args: string[]) {
    return spawnSync('bun', [STAGE_RUNNER, ...args], { encoding: 'utf-8' });
}

function runCheck(kind: string, dir: string, fourth = 'false', fifth = '') {
    const args = [CHECK, kind, dir, STAMP, fourth];
    if (fifth !== '') args.push(fifth);
    return spawnSync('bun', args, { encoding: 'utf-8' });
}

const varRef = (name: string): string => ['$' + '{vars.', name, '}'].join('');

/** A manifest digest over sorted keys + current bytes — the same algorithm the stages use. */
function manifestDigest(dir: string, manifest: { variants: Record<string, { path: string }> }): string {
    const hash = createHash('sha256');
    for (const key of Object.keys(manifest.variants).sort()) {
        hash.update(key)
            .update('\0')
            .update(readFileSync(join(dir, manifest.variants[key].path)))
            .update('\0');
    }
    return hash.digest('hex');
}

/** Two parseable variants under 30-variants plus the manifest that registers them. */
function setupVariantsDir(): string {
    const dir = tempDir('kk-0331-variants-');
    writeVariants(dir);
    const manifest = runStage(['daily-safety-manifest', dir, STAMP]);
    if (manifest.status !== 0) throw new Error(`daily-safety-manifest failed: ${manifest.stderr}`);
    return dir;
}

function writeVariants(dir: string, bodies: Record<string, string> = {}): void {
    mkdirSync(join(dir, '30-variants'), { recursive: true });
    writeFileSync(
        join(dir, '30-variants', 'surfdash-pub_post.content.json'),
        bodies['surfdash-pub_post'] ?? '{"title":"t","body":"b"}',
    );
    writeFileSync(
        join(dir, '30-variants', 'wechatmp-pub_文章.content.json'),
        bodies['wechatmp-pub_文章'] ?? '{"title":"t2","body":"b2"}',
    );
}

/** prep + reviewed-good report/verdict: everything the gate needs to admit the variants scope. */
function reviewedVariants(dir: string): void {
    const prep = runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou,wechatmp', VARIANTS_SCOPE]);
    if (prep.status !== 0) throw new Error(`daily-safety-prep failed: ${prep.stderr}`);
    writeFileSync(
        join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-review_report.json`),
        JSON.stringify({
            platforms: [
                { platform: 'xiaoyuzhou', decision: 'OK', findings: [] },
                { platform: 'wechatmp', decision: 'OK', findings: [] },
            ],
            escalate: false,
            confidence: 'HIGH',
        }),
    );
    writeFileSync(
        join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-judge_verdict.json`),
        JSON.stringify({ verdict: 'PASS', confidence: 'HIGH', rubric: 'compliance', score: 0.98, findings: [] }),
    );
}

describe('0331 authored machines — one scope var, drafts paths untouched by default', () => {
    const machine = Bun.YAML.parse(readFileSync(SAFETY_MACHINE, 'utf-8')) as {
        vars: Record<string, string>;
        states: { id: string; onEnter: { kind?: string; options?: Record<string, unknown> }[] }[];
        transitions: { from: string; to: string; guard?: { kind?: string; options?: { command?: unknown } } }[];
    };

    it('AC: kk-daily-safety defaults the scope to 24-script and routes every stage/guard/prompt through it', () => {
        // The default IS the drafts scope: a caller that passes no scope var gets the exact
        // pre-0331 behavior (voice2 keeps calling it with no scope).
        expect(machine.vars.safety_scope_dir).toBe('24-script');
        const allText = JSON.stringify(machine);
        expect(allText.split(varRef('safety_scope_dir')).length - 1).toBeGreaterThanOrEqual(10);
        for (const stage of ['daily-safety-prep', 'daily-safety-gate', 'daily-safety-verdict', 'daily-safety-revise']) {
            const shell = machine.states
                .flatMap((state) => state.onEnter)
                .find((action) => action.kind === 'shell' && String(action.options?.command ?? '').includes(stage));
            expect(String(shell?.options?.command), `${stage} must take the scope arg`).toContain(
                varRef('safety_scope_dir'),
            );
        }
        for (const predicate of ['report-valid', 'judge-valid', 'revision-valid', 'publish-valid']) {
            const guard = machine.transitions.find((transition) =>
                String(transition.guard?.options?.command ?? '').includes(predicate),
            );
            expect(String(guard?.guard?.options?.command), `${predicate} guard must take the scope arg`).toContain(
                varRef('safety_scope_dir'),
            );
        }
        const review = machine.states
            .find((state) => state.id === 'review')
            ?.onEnter.find((action) => action.kind === 'agent.run');
        expect(String(review?.options?.expectFile), 'the review pin must follow the scope').toContain(
            varRef('safety_scope_dir'),
        );
    });

    it('AC: the generate DAG wires safety-variants before freeze and runs the nested machine in the variants scope', () => {
        const dag = Bun.YAML.parse(readFileSync(VOICE3, 'utf-8')) as {
            nodes: { id: string; dependsOn?: string[]; action?: { kind: string; options?: { command?: string } } }[];
        };
        const byId = new Map(dag.nodes.map((node) => [node.id, node]));
        // `variants` is the one verb that writes the payloads and the manifest the review registers.
        expect(String(byId.get('variants')?.action?.options?.command ?? '')).toContain('--stage variants');
        const node = byId.get('safety-variants');
        expect(node?.dependsOn).toEqual(['variants']);
        const command = String(node?.action?.options?.command ?? '');
        expect(command).toContain('kk-daily-safety.yaml');
        expect(command).toContain('safety_scope_dir');
        expect(command).toContain(VARIANTS_SCOPE);
        // The drafts review keeps its own nested machine with NO scope var (defaults to 24-script).
        expect(String(byId.get('safety')?.action?.options?.command ?? '')).not.toContain('safety_scope_dir');
        expect(byId.get('freeze')?.dependsOn).toContain('safety-variants');
    });
});

describe('0331 stages — the variants chain digests registered bytes and leaves bundle evidence', () => {
    it('AC: the manifest registers sorted plugin:operation entries with sha256 and refuses to invent a review surface', () => {
        const dir = tempDir('kk-0331-manifest-');
        writeVariants(dir);
        const result = runStage(['daily-safety-manifest', dir, STAMP]);
        expect(result.status).toBe(0);
        const manifest = JSON.parse(readFileSync(join(dir, VARIANTS_SCOPE, 'manifest.json'), 'utf-8')) as {
            schemaVersion: number;
            runDate: string;
            variants: Record<string, { path: string; sha256: string }>;
        };
        expect(Object.keys(manifest.variants)).toEqual(['surfdash-pub:post', 'wechatmp-pub:文章']);
        expect(manifest.variants['surfdash-pub:post'].path).toBe('30-variants/surfdash-pub_post.content.json');
        expect(manifest.variants['surfdash-pub:post'].sha256).toMatch(/^[0-9a-f]{64}$/);
        // An empty surface is a caller bug, not an empty review: rc 1 before any reviewer spends tokens.
        const empty = tempDir('kk-0331-manifest-empty-');
        mkdirSync(join(empty, '30-variants'), { recursive: true });
        expect(runStage(['daily-safety-manifest', empty, STAMP]).status).not.toBe(0);
        expect(runStage(['daily-safety-manifest', tempDir('kk-0331-manifest-none-'), STAMP]).status).not.toBe(0);
    });

    it('AC: variants prep writes a scope-tagged request with per-variant content, resets the scoped budget and drops stale evidence', () => {
        const dir = setupVariantsDir();
        mkdirSync(join(dir, VARIANTS_SCOPE), { recursive: true });
        writeFileSync(join(dir, VARIANTS_SCOPE, 'safety.json'), '{"status":"pass"}');
        const result = runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou,wechatmp', VARIANTS_SCOPE]);
        expect(result.status).toBe(0);
        expect(existsSync(join(dir, VARIANTS_SCOPE, 'safety.json'))).toBe(false);
        const request = JSON.parse(
            readFileSync(join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-review_request.json`), 'utf-8'),
        ) as {
            scope: string;
            digest: string;
            digestFile: string;
            content: { key: string; path: string; sha256: string }[];
        };
        expect(request.scope).toBe('variants');
        expect(existsSync(request.digestFile)).toBe(true);
        const digestText = readFileSync(request.digestFile, 'utf-8');
        expect(digestText).toContain('Safety Review Digest');
        expect(digestText).toContain('surfdash-pub:post');
        const manifest = JSON.parse(readFileSync(join(dir, VARIANTS_SCOPE, 'manifest.json'), 'utf-8'));
        expect(request.digest).toBe(manifestDigest(dir, manifest));
        expect(request.content.map((entry) => entry.key)).toEqual(['surfdash-pub:post', 'wechatmp-pub:文章']);
        expect(readFileSync(join(dir, '.safety-revise-count-4-safety-variants'), 'utf-8').trim()).toBe('0');
    });

    it('AC: an admitted variants review writes safety.json binding the CURRENT per-variant bytes', () => {
        const dir = setupVariantsDir();
        reviewedVariants(dir);
        const gate = runStage(['daily-safety-gate', dir, STAMP, '0', VARIANTS_SCOPE]);
        expect(gate.status).toBe(0);
        expect(readFileSync(join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-judge_status.txt`), 'utf-8')).toBe('pass');
        writeFileSync(
            join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-verdict.decision`),
            JSON.stringify({ value: 'pass' }),
        );
        const verdict = runStage(['daily-safety-verdict', dir, STAMP, VARIANTS_SCOPE]);
        expect(verdict.status).toBe(0);
        expect(verdict.stdout).toContain('evidence written');
        const evidence = JSON.parse(readFileSync(join(dir, VARIANTS_SCOPE, 'safety.json'), 'utf-8')) as {
            status: string;
            digest: string;
            excludedPlatforms: string[];
            variants: Record<string, string>;
        };
        const manifest = JSON.parse(readFileSync(join(dir, VARIANTS_SCOPE, 'manifest.json'), 'utf-8'));
        expect(evidence.status).toBe('pass');
        expect(evidence.digest).toBe(manifestDigest(dir, manifest));
        expect(evidence.excludedPlatforms).toEqual([]);
        expect(evidence.variants['surfdash-pub:post']).toBe(manifest.variants['surfdash-pub:post'].sha256);
        // The same artifacts pass the shipped publish-valid predicate in the variants scope.
        const check = runCheck('publish-valid', dir, 'true', VARIANTS_SCOPE);
        expect(check.status, check.stdout + check.stderr).toBe(0);
    });

    it('AC: variant bytes edited after the review are refused at the verdict — no evidence, refuse token', () => {
        const dir = setupVariantsDir();
        reviewedVariants(dir);
        runStage(['daily-safety-gate', dir, STAMP, '0', VARIANTS_SCOPE]);
        // The mutation that must never slip through: the reviewer approved different bytes.
        writeVariants(dir, { 'surfdash-pub_post': '{"title":"t","body":"EDITED"}' });
        writeFileSync(
            join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-verdict.decision`),
            JSON.stringify({ value: 'pass' }),
        );
        const verdict = runStage(['daily-safety-verdict', dir, STAMP, VARIANTS_SCOPE]);
        expect(verdict.status).toBe(0);
        expect(verdict.stderr).toContain('variant bytes changed after the review');
        expect(existsSync(join(dir, VARIANTS_SCOPE, 'safety.json'))).toBe(false);
        expect(readFileSync(join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-verdict.status`), 'utf-8')).toBe('refuse');
        const refused = runCheck('publish-valid', dir, 'true', VARIANTS_SCOPE);
        expect(refused.status, refused.stdout + refused.stderr).not.toBe(0);
    });

    it('AC: a quality block in the variants scope never quarantines the drafts it did not review', () => {
        const dir = setupVariantsDir();
        reviewedVariants(dir);
        writeFileSync(
            join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-review_report.json`),
            JSON.stringify({
                platforms: [{ platform: 'wechatmp', decision: 'BLOCK', findings: [] }],
                escalate: false,
                confidence: 'HIGH',
            }),
        );
        const gate = runStage(['daily-safety-gate', dir, STAMP, '0', VARIANTS_SCOPE]);
        expect(gate.status).toBe(0);
        expect(readFileSync(join(dir, VARIANTS_SCOPE, `${STAMP}_09_safety-judge_status.txt`), 'utf-8')).toBe('block');
        expect(existsSync(join(dir, '24-script'))).toBe(false);
    });

    it('AC: variants revise re-validates the manifest files, bumps the scoped budget and re-review guards demand changed bytes', () => {
        const dir = setupVariantsDir();
        reviewedVariants(dir);
        const revise = runStage(['daily-safety-revise', dir, STAMP, VARIANTS_SCOPE]);
        expect(revise.status).toBe(0);
        expect(revise.stdout).toContain('re-validated');
        expect(readFileSync(join(dir, '.safety-revise-count-4-safety-variants'), 'utf-8').trim()).toBe('1');
        // The repair-then-rereview loop: revision-valid refuses unchanged bytes ...
        const unchanged = runCheck('revision-valid', dir, VARIANTS_SCOPE);
        expect(unchanged.status, unchanged.stdout + unchanged.stderr).not.toBe(0);
        expect(unchanged.stdout + unchanged.stderr).toContain('unchanged');
        // ... and accepts a genuinely revised variant set.
        writeVariants(dir, { 'wechatmp-pub_文章': '{"title":"t2","body":"b2 (remediated)"}' });
        const revised = runCheck('revision-valid', dir, VARIANTS_SCOPE);
        expect(revised.status).toBe(0);
        // A remediation that breaks the Content contract fails the stage before any re-review.
        writeVariants(dir, { 'wechatmp-pub_文章': '{"title":"t2"}' });
        expect(runStage(['daily-safety-revise', dir, STAMP, VARIANTS_SCOPE]).status).not.toBe(0);
    });

    it('AC: the drafts scope keeps its pre-0331 behavior when no scope arg is passed', () => {
        const dir = tempDir('kk-0331-drafts-');
        mkdirSync(join(dir, '22-article'), { recursive: true });
        mkdirSync(join(dir, '24-script'), { recursive: true });
        writeFileSync(join(dir, '22-article', `${STAMP}_06_article_content.json`), '{"title":"T","body":"B"}');
        writeFileSync(
            join(dir, '24-script', `${STAMP}_08_script_voicescript.yaml`),
            'title: T\nsegments:\n  - text: 大家好\n',
        );
        const prep = runStage(['daily-safety-prep', dir, STAMP, 'xiaoyuzhou']);
        expect(prep.status).toBe(0);
        const request = JSON.parse(
            readFileSync(join(dir, '24-script', `${STAMP}_09_safety-review_request.json`), 'utf-8'),
        ) as { scope: string; content: string[] };
        expect(request.scope).toBe('drafts');
        expect(request.content).toHaveLength(2);
        expect(existsSync(join(dir, '24-script', `${STAMP}_09_safety-prep_script-snapshot.yaml`))).toBe(true);
        expect(existsSync(join(dir, '.safety-revise-count-4-safety-variants'))).toBe(false);
    });
});
