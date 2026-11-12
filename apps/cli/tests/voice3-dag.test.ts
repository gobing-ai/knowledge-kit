/**
 * Task 0324 — `kk-daily-ai-voice3` (the generate half) and the `publish-matrix-bundle` freeze.
 *
 * Failure-first list (written before the test):
 *  1. a channel `*_enabled` / `*_live` / `publish_enabled` switch surviving in the generate graph
 *     (channel enablement is the preset's job now);
 *  2. a second `kk store pool-count` on the candidates file outside `pool-gate`;
 *  3. a publish plugin named in the workflow;
 *  4. `bundle.json` written without the article/episode variants, or advertising a variant whose
 *     sha256 disagrees with the file;
 *  5. a re-freeze forgetting the `runs[]` a publish window already appended;
 *  6. voice2 drift (the generate graph is a copy, not an edit of voice2).
 *
 * The freeze itself is exercised end-to-end: a fixture work dir → `publish-matrix-bundle` → the
 * same bundle consumed by `kk-daily-publish3` in the 0323 suite (which asserts the consumer side).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PublishPreset } from '../src/itc-plan';
import { BundleSchema, runPublishMatrixBundle } from '../src/publish-matrix';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice3.yaml');
const VOICE2 = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice2.yaml');

const created: string[] = [];
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** A work dir with `30-variants/` (the only input the freeze reads). */
function seedVariants(variants: Record<string, string | null>): string {
    const workDir = tempDir('voice3-work-');
    mkdirSync(join(workDir, '30-variants'), { recursive: true });
    for (const [key, body] of Object.entries(variants)) {
        if (body === null) continue;
        writeFileSync(join(workDir, '30-variants', `${key.replaceAll(':', '_')}.content.json`), body);
    }
    return workDir;
}

const ARTICLE = `${JSON.stringify({ title: '今日AI', format: 'markdown', body: '正文 {{article_url}}' })}\n`;
const EPISODE = `${JSON.stringify({ title: '每日AI乱炖 · 2026-10-22', format: 'audio', body: '播客' })}\n`;

describe('publish-matrix-bundle (0324 R2)', () => {
    it('freezes every variant with its sha256 and the episode title', async () => {
        const workDir = seedVariants({
            article: ARTICLE,
            episode: EPISODE,
            'article@wechatmp-pub': ARTICLE,
            'social:x': `${JSON.stringify({ title: 'x', format: 'text', body: 'post' })}\n`,
        });
        const out = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            out.restore();
        }
        const bundlePath = join(workDir, 'bundle.json');
        expect(existsSync(bundlePath)).toBe(true);
        const parsed = BundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf-8')));
        expect(parsed.runDate).toBe('2026-10-22');
        expect(parsed.parentRunId).toBe('run-abc');
        expect(parsed.episode.title).toBe('每日AI乱炖 · 2026-10-22');
        // `_` maps back to `:`: the file name is filesystem-safe, the key is the bundle contract.
        expect(Object.keys(parsed.variants).sort()).toEqual(['article', 'article@wechatmp-pub', 'episode', 'social:x']);
        for (const [key, entry] of Object.entries(parsed.variants)) {
            const bytes = readFileSync(join(workDir, entry.path));
            expect(entry.path).toBe(`30-variants/${key.replaceAll(':', '_')}.content.json`);
            expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
        }
    });

    it('refuses a freeze with no article/episode variant or a variant that is not Content', async () => {
        const noContract = seedVariants({
            'social:x': `${JSON.stringify({ title: 'x', format: 'text', body: 'post' })}\n`,
        });
        const emptyOut = captureOutput();
        try {
            expect(await runPublishMatrixBundle([noContract, '--run-date', '2026-10-22', '--run-id', 'r'])).toBe(1);
            expect(emptyOut.readErr()).toContain('no article/episode variant');
        } finally {
            emptyOut.restore();
        }
        expect(existsSync(join(noContract, 'bundle.json'))).toBe(false);

        const badVariant = seedVariants({
            article: '"not an object"\n',
            episode: EPISODE,
        });
        const badOut = captureOutput();
        try {
            expect(await runPublishMatrixBundle([badVariant, '--run-date', '2026-10-22', '--run-id', 'r'])).toBe(1);
            expect(badOut.readErr()).toContain('is not valid Content');
        } finally {
            badOut.restore();
        }
    });

    it('refuses a freeze when the preset requires a variant the run never produced (0329 F02)', async () => {
        const preset: PublishPreset = {
            schemaVersion: 1,
            name: 'strict-test-preset',
            targets: [
                { plugin: 'surfdash-pub', tier: 0, required: true, variant: 'article' },
                { plugin: 'podcast-pub', tier: 0, required: true, variant: 'episode' },
                { plugin: 'needs-extra-pub', tier: 1, required: true, variant: 'episode@needs-extra-pub' },
            ],
        };
        const thin = seedVariants({ article: ARTICLE, episode: EPISODE });
        const failOut = captureOutput();
        try {
            expect(
                await runPublishMatrixBundle([thin, '--run-date', '2026-10-22', '--run-id', 'r'], {
                    preset,
                }),
            ).toBe(1);
        } finally {
            failOut.restore();
        }
        expect(failOut.readErr()).toContain('strict-test-preset');
        expect(failOut.readErr()).toContain('episode@needs-extra-pub');
        expect(existsSync(join(thin, 'bundle.json'))).toBe(false);

        // Producing the missing variant lets the same freeze through.
        writeFileSync(
            join(thin, '30-variants', 'episode@needs-extra-pub.content.json'),
            `${JSON.stringify({ title: 'ep', format: 'audio', body: '播客' })}\n`,
        );
        const okOut = captureOutput();
        try {
            expect(await runPublishMatrixBundle([thin, '--run-date', '2026-10-22', '--run-id', 'r'], { preset })).toBe(
                0,
            );
        } finally {
            okOut.restore();
        }
        expect(existsSync(join(thin, 'bundle.json'))).toBe(true);
    });

    it('dedups a re-freeze runs[] and appends its own generate run id last (0329 R2)', async () => {
        const workDir = seedVariants({ article: ARTICLE, episode: EPISODE });
        const out = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            out.restore();
        }
        const bundlePath = join(workDir, 'bundle.json');
        const bundle = BundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf-8')));
        // A publish window appended run-abc twice (double-append bug) plus its own id.
        bundle.runs = ['pub-1', 'run-abc', 'run-abc', 'pub-1'];
        writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

        const again = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            again.restore();
        }
        const refrozen = BundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf-8')));
        expect(refrozen.runs).toEqual(['pub-1', 'run-abc']);
    });

    it('writes bundle.json atomically — no temp file survives, no torn write is readable (0329 R2)', async () => {
        const workDir = seedVariants({ article: ARTICLE, episode: EPISODE });
        const out = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            out.restore();
        }
        const leftovers = readdirSync(join(workDir)).filter(
            (file) => file !== 'bundle.json' && file.startsWith('bundle'),
        );
        expect(leftovers).toEqual([]);
        expect(() => BundleSchema.parse(JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')))).not.toThrow();
    });

    it('keeps the runs[] a publish window already appended on a re-freeze', async () => {
        const workDir = seedVariants({ article: ARTICLE, episode: EPISODE });
        const out = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            out.restore();
        }
        const bundlePath = join(workDir, 'bundle.json');
        const bundle = BundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf-8')));
        bundle.runs = ['publish-run-1'];
        writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

        const again = captureOutput();
        try {
            expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'run-abc'])).toBe(0);
        } finally {
            again.restore();
        }
        const refrozen = BundleSchema.parse(JSON.parse(readFileSync(bundlePath, 'utf-8')));
        expect(refrozen.runs).toEqual(['publish-run-1', 'run-abc']);
        // A fresh variant set still re-hashes every entry.
        expect(refrozen.variants.article?.sha256).toBe(
            new Bun.CryptoHasher('sha256')
                .update(readFileSync(join(workDir, '30-variants/article.content.json')))
                .digest('hex'),
        );
    });
});

describe('kk-daily-ai-voice3 shape (0324 R1, R3, R4)', () => {
    const yaml = readFileSync(WORKFLOW, 'utf-8');

    /** Literal `${vars.<name>}` as the YAML text spells it, without tripping the template-curly lint. */
    const varsLit = (name: string): string => `\${vars.${name}}`;

    it('carries no channel enablement switch and no publish plugin', () => {
        // Comments may NAME the removed switches (the graph explains why they are gone); what must not
        // exist is a declared var or a templated reference to one.
        for (const token of ['xhs_enabled', 'wechat_enabled', 'xhs_live', 'wechat_live', 'publish_enabled']) {
            expect({ token, declared: new RegExp(`^  ${token}:`, 'm').test(yaml) }).toEqual({ token, declared: false });
            expect({ token, referenced: yaml.includes(varsLit(token)) }).toEqual({ token, referenced: false });
        }
        for (const plugin of ['surfdash-pub', 'podcast-pub', 'wechatmp-pub', 'xhs-pub', 'weibo-pub', 'threads-pub']) {
            expect({ plugin, present: yaml.includes(plugin) }).toEqual({ plugin, present: false });
        }
    });

    it('holds exactly one pool-count guard over the candidates file, in pool-gate', () => {
        const lines = yaml.split('\n').filter((line) => line.includes('kk store pool-count'));
        const candidateGuards = lines.filter((line) => line.includes('_04_quality-control-content_candidates.json'));
        // One occurrence: the gate's own invocation. The other pool guard is the collect pool.
        expect(candidateGuards).toHaveLength(1);
        const gateIndex = yaml.indexOf('- id: pool-gate');
        expect(yaml.indexOf(candidateGuards[0] as string)).toBeGreaterThan(gateIndex);
        // Every node that used to repeat it reads the gate's token instead.
        expect(yaml.match(/-pool-gate\.status/g)?.length ?? 0).toBeGreaterThanOrEqual(15);
    });

    it('ends with the generate-side payload chain and a conditional nested publish', () => {
        for (const node of [
            'editorial-render',
            'bundle-variants',
            'bundle-freeze',
            'generation-report',
            'publish',
            'ledger',
        ]) {
            expect({ node, present: yaml.includes(`- id: ${node}`) }).toEqual({ node, present: true });
        }
        // The nested launch strips the two launcher vars (voice2's precedent) and is auto_publish-gated.
        expect(yaml).toContain('env -u SPUR_WORKFLOW_RUN_ACTIVE -u SPUR_EXPECTED_DEFINITION_DIGEST');
        expect(yaml).toContain(`test "${varsLit('auto_publish')}" = "true"`);
        expect(yaml).toContain('kk stage run publish-matrix-bundle');
        expect(yaml).toContain('kk stage run daily-bundle-variants');
    });

    // ------------------------------------------------------------------
    // Task 0329 repairs. Failure-first list (source audit
    // .spur/reports/voice3-migration-review-2026-10-25.md):
    //   F01 — token readers without a pool-gate dependency: a condition can read the token before
    //         the gate settled (the real repro: the run finished `done` and never executed select);
    //   F15 — a refused/thin day must still end `done` with a no-content run report: pool-gate may
    //         never exit 1 (a failed dep wedges its dependents into dag-unreachable), the publish
    //         tail must be token-gated, and generation-report must pass real run-report flags;
    //   F21 — prepare's preflight must cover the stages this graph can invoke;
    //   F23 — the daily QC print must be turned into a verdict gate after wrap-docs;
    //   F16 — bundle-variants must depend on its producers and wipe stale variant files.
    // ------------------------------------------------------------------
    describe('0329 repairs', () => {
        /** One node's YAML block: from `- id: X` to the next sibling `- id:` (id is token-exact). */
        function nodeBlock(id: string): string {
            const start = yaml.indexOf(`- id: ${id}\n`);
            expect({ id, found: start > -1 }).toEqual({ id, found: true });
            const rest = yaml.slice(start);
            const next = rest.indexOf('\n  - id:');
            return next === -1 ? rest : rest.slice(0, next);
        }

        function dependsOn(id: string): string[] {
            const match = /dependsOn:\s*\[([^\]]*)\]/.exec(nodeBlock(id));
            if (!match) return [];
            return (match[1] ?? '')
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== '');
        }

        it('every pool-gate token reader depends on pool-gate (F01)', () => {
            const gateIndex = yaml.indexOf('- id: pool-gate');
            expect(gateIndex).toBeGreaterThan(-1);
            const readers = yaml
                .split('\n  - id: ')
                .slice(1)
                .map((block) => block.split('\n')[0]?.trim())
                .filter(
                    (id): id is string =>
                        id !== undefined && id !== 'pool-gate' && nodeBlock(id).includes('-pool-gate.status'),
                );
            expect(readers.length).toBeGreaterThanOrEqual(20);
            for (const id of readers) {
                expect({ id, dependsOn: dependsOn(id), includesGate: dependsOn(id).includes('pool-gate') }).toEqual({
                    id,
                    dependsOn: expect.any(Array),
                    includesGate: true,
                });
            }
            // Topological declaration order: the gate precedes its first reader (select).
            expect(gateIndex).toBeLessThan(yaml.indexOf('- id: select'));
        });

        it('pool-gate never exits non-zero — an empty pool completes the node and skips the graph (F15)', () => {
            const gate = nodeBlock('pool-gate');
            expect(gate).toContain('EMPTY');
            expect(gate).toContain('PASS');
            expect(gate).not.toContain('exit 1');
            expect(dependsOn('pool-gate')).toEqual(['qc-content']);
            // An empty pool must also invalidate a stale bundle a publish window could consume.
            expect(gate).toContain('bundle.json');
        });

        it('quality is a verdict gate and the publish tail is token-gated (F15/F23)', () => {
            const quality = nodeBlock('quality');
            expect(dependsOn('quality')).toEqual(['duration', 'wrap-docs', 'pool-gate']);
            expect(quality).toContain('-pool-gate.status');
            expect(quality).toContain('daily-quality-verdict');
            expect(quality).toContain('daily-quality-report');

            const publishPrep = nodeBlock('publish-prep');
            expect(dependsOn('publish-prep')).toEqual(['duration', 'article', 'safety', 'pool-gate']);
            expect(publishPrep).toContain('daily-publish-prep');
            expect(publishPrep).toContain(varsLit('podcast_artist'));

            for (const id of [
                'show-notes',
                'editorial-render',
                'cards-render',
                'bundle-variants',
                'bundle-freeze',
                'publish',
            ]) {
                expect({ id, gated: nodeBlock(id).includes('-pool-gate.status') }).toEqual({ id, gated: true });
            }
            // The nested publish additionally keeps its auto_publish switch.
            expect(nodeBlock('publish')).toContain(`test "${varsLit('auto_publish')}" = "true"`);
            // 0329 F02: the freeze loads the operator preset so a required variant missing at
            // freeze time refuses before any bundle write.
            expect(nodeBlock('bundle-freeze')).toContain(`--preset ${varsLit('publish_preset')}`);
        });

        it('generation-report passes real run-report flags — no phantom --skip-store (F15)', () => {
            const report = nodeBlock('generation-report');
            expect(report).not.toContain('--skip-store');
            expect(report).toContain('kk daily run-report');
            expect(report).toContain(`--pool "${varsLit('work_dir')}/10-collect/pool.json"`);
            expect(report).toContain(
                `--candidates "${varsLit('work_dir')}/21-plan/${varsLit('run_date')}_04_quality-control-content_candidates.json"`,
            );
            expect(report).toContain(`--plugins-path "${varsLit('plugins_path')}"`);
            expect(report).toContain(`--qc-min-quality "${varsLit('qc_min_quality')}"`);
        });

        it('generation-report and ledger stay reachable on a no-content close (R2)', () => {
            // pool-gate always completes (never skips), so a node listing it beside a skipped
            // dependency still runs — the engine skips only when ALL dependencies were skipped.
            const deps = (id: string): string[] =>
                yaml
                    .split('\n  - id: ')
                    .find((block) => block.startsWith(`${id}\n`))
                    ?.split('\n')
                    .find((line) => line.includes('dependsOn:'))
                    ?.match(/\[([^\]]*)\]/)?.[1]
                    ?.split(',')
                    .map((d) => d.trim()) ?? [];
            expect(deps('generation-report')).toEqual(expect.arrayContaining(['bundle-freeze', 'pool-gate']));
            expect(deps('ledger')).toEqual(expect.arrayContaining(['generation-report', 'publish']));
        });

        it('duration forwards the run id so a refusal invalidates the publish path (F06/F15)', () => {
            const duration = nodeBlock('duration');
            expect(duration).toContain('daily-episode-duration');
            expect(duration).toContain(`"${varsLit('__runId')}"`);
        });

        it('bundle-variants builds from its own producers and the run switches (F16)', () => {
            const variants = dependsOn('bundle-variants');
            for (const producer of [
                'quality',
                'editorial-render',
                'publish-prep',
                'cover-normalize',
                'cards-render',
                'pool-gate',
            ]) {
                expect({ producer, inDeps: variants.includes(producer) }).toEqual({ producer, inDeps: true });
            }
            const block = nodeBlock('bundle-variants');
            expect(block).toContain(`"${varsLit('cards_enabled')}"`);
            expect(block).toContain(`"${varsLit('cover_enabled')}"`);
        });

        it('intro admits a refused day — the sting must not fail a no-content close (F15)', () => {
            const intro = nodeBlock('intro');
            expect(intro).toContain('_duration-refusal.json');
        });

        it('prepare preflights every runner this graph can invoke (F21)', () => {
            const prepare = nodeBlock('prepare');
            // Its OWN file, not voice2's: preflighting voice2 demanded surfdash stages voice3 never runs
            // (2026-11-07 18:07Z `daily-preflight.runner-stale`) and skipped voice3's own stages.
            expect(prepare).toContain('daily-preflight plugins/kk/workflows/kk-daily-ai-voice3.yaml');
            expect(prepare).toContain('kk-daily-safety.yaml');
            expect(prepare).toContain('kk-daily-publish3.yaml');
        });

        it('the runner dispatches the new stage and the preflight knows the publish-matrix roster (F21/F23)', () => {
            const runnerSource =
                readFileSync(join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts'), 'utf-8') +
                readFileSync(join(REPO, 'plugins/kk/scripts/daily-stages.ts'), 'utf-8');
            expect(runnerSource).toContain("case 'daily-quality-verdict'");
            expect(runnerSource).toContain('PUBLISH_MATRIX_STAGES');
            // Legacy `kk stage <name>` spellings stay recognized by the preflight (A22 R2).
            expect(runnerSource).toMatch(/\bkk stage (?:run )?/);
        });
    });

    it('leaves voice2 untouched: the generate nodes it copies still exist there', () => {
        const voice2 = readFileSync(VOICE2, 'utf-8');
        for (const node of [
            'prepare',
            'extract',
            'plan',
            'qc-content',
            'select',
            'article',
            'cover',
            'cover-normalize',
            'script-style',
            'script-write',
            'script',
            'safety',
            'review',
            'wrap-docs',
            'generate',
            'generate-fallback',
            'generate-fallback2',
            'intro',
            'voice-audit',
            'duration',
            'quality',
            'show-notes',
        ]) {
            expect({
                node,
                inVoice2: voice2.includes(`- id: ${node}`),
                inVoice3: yaml.includes(`- id: ${node}`),
            }).toEqual({
                node,
                inVoice2: true,
                inVoice3: true,
            });
        }
        // Legacy per-artifact agent nodes remain in voice2 while voice3 replaces them with curate + editorial-render (0345).
        for (const legacyNode of ['plan-translate', 'article-write', 'cover-brief']) {
            expect(voice2.includes(`- id: ${legacyNode}`)).toBe(true);
            expect(yaml.includes(`- id: ${legacyNode}`)).toBe(false);
        }
    });

    describe('0345 centralize daily-news editorial logic (AC6, AC8, AC9)', () => {
        function nodeIndex(id: string): number {
            return yaml.indexOf(`- id: ${id}\n`);
        }

        function nodeBlock(id: string): string {
            const start = nodeIndex(id);
            expect({ id, found: start > -1 }).toEqual({ id, found: true });
            const rest = yaml.slice(start);
            const next = rest.indexOf('\n  - id:');
            return next === -1 ? rest : rest.slice(0, next);
        }

        function dependsOn(id: string): string[] {
            const match = /dependsOn:\s*\[([^\]]*)\]/.exec(nodeBlock(id));
            if (!match) return [];
            return (match[1] ?? '')
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== '');
        }

        it('AC6: plan-translate is replaced by curate -> curate-check -> curate-fix -> curate-final, every _03_plan_plan.json reader depends on curate-final, and no prompt contains 选题边界', () => {
            for (const removed of ['plan-translate', 'plan-translate-retry']) {
                expect(yaml.includes(`- id: ${removed}\n`)).toBe(false);
            }
            expect(yaml.includes('plan_translate_enabled')).toBe(false);
            expect(yaml.includes('curate_enabled: "true"')).toBe(true);

            const chain = ['script-style', 'curate', 'curate-check', 'curate-fix', 'curate-final'];
            for (let i = 0; i < chain.length - 1; i++) {
                const curr = chain[i] as string;
                const next = chain[i + 1] as string;
                expect(nodeIndex(curr)).toBeGreaterThan(-1);
                expect(nodeIndex(curr)).toBeLessThan(nodeIndex(next));
            }
            expect(dependsOn('curate')).toContain('script-style');
            expect(dependsOn('curate-check')).toContain('curate');
            expect(dependsOn('curate-fix')).toContain('curate-check');
            expect(dependsOn('curate-final')).toEqual(expect.arrayContaining(['curate-check', 'curate-fix']));

            // Every node outside the curate chain that reads _03_plan_plan.json depends on curate-final
            const curateNodes = new Set(['curate', 'curate-check', 'curate-fix', 'curate-final']);
            const allNodes = yaml
                .split('\n  - id: ')
                .slice(1)
                .map((b) => b.split('\n')[0]?.trim())
                .filter((id): id is string => Boolean(id));
            for (const id of allNodes) {
                if (curateNodes.has(id)) continue;
                if (nodeBlock(id).includes('_03_plan_plan.json') || id === 'editorial-render' || id === 'article') {
                    expect({ id, deps: dependsOn(id), hasCurateFinal: dependsOn(id).includes('curate-final') }).toEqual(
                        {
                            id,
                            deps: expect.any(Array),
                            hasCurateFinal: true,
                        },
                    );
                }
            }

            expect(yaml).not.toContain('选题边界');
        });

        it('AC8: removes duplicate writer nodes and article_write_enabled, wires editorial-render after script, and keeps every prompt <= 1000 chars', () => {
            for (const removed of [
                'article-write',
                'article-write-retry',
                'cover-brief',
                'cards-write',
                'social-write',
            ]) {
                expect(yaml.includes(`- id: ${removed}\n`)).toBe(false);
            }
            expect(yaml.includes('article_write_enabled')).toBe(false);

            const scriptIdx = nodeIndex('script');
            const renderIdx = nodeIndex('editorial-render');
            expect(scriptIdx).toBeGreaterThan(-1);
            expect(renderIdx).toBeGreaterThan(scriptIdx);
            expect(dependsOn('editorial-render')).toContain('script');

            for (const consumer of ['article', 'cover', 'cards-render', 'bundle-variants']) {
                expect(nodeIndex(consumer)).toBeGreaterThan(renderIdx);
                expect(dependsOn(consumer)).toContain('editorial-render');
            }

            // Every agent.run prompt in kk-daily-ai-voice3.yaml is <= 1000 chars
            const parsed = Bun.YAML.parse(yaml) as {
                nodes: { id: string; action?: { kind?: string; options?: { input?: string } } }[];
            };
            const agentNodes = parsed.nodes.filter((n) => n.action?.kind === 'agent.run');
            expect(agentNodes.length).toBeGreaterThanOrEqual(4);
            for (const node of agentNodes) {
                const input = node.action?.options?.input ?? '';
                expect({ id: node.id, len: input.length, withinCap: input.length <= 1000 }).toEqual({
                    id: node.id,
                    len: expect.any(Number),
                    withinCap: true,
                });
            }
        });

        it('AC9: editorial-judge is advisory (onError: continue, reviewer role, news-balance rubric) and nothing depends on it for control flow', () => {
            const judgeBlock = nodeBlock('editorial-judge');
            expect(dependsOn('editorial-judge')).toEqual(expect.arrayContaining(['script-check', 'script-write-fix']));
            expect(judgeBlock).toContain('onError: continue');
            expect(judgeBlock).toContain('role: reviewer');
            expect(judgeBlock).toContain('news-balance');
            expect(judgeBlock).toContain('_08_editorial-judge_verdict.json');

            const allNodes = yaml
                .split('\n  - id: ')
                .slice(1)
                .map((b) => b.split('\n')[0]?.trim())
                .filter((id): id is string => Boolean(id));
            for (const id of allNodes) {
                expect({ id, dependsOnJudge: dependsOn(id).includes('editorial-judge') }).toEqual({
                    id,
                    dependsOnJudge: false,
                });
            }
        });
    });

    // 0347 F4 (2026-11-10): the nested safety machine separates an executor outage (infra-fail,
    // machine-retryable) from a content verdict (block). Both nested safety nodes must forward the
    // scheduler's retry executor, and the machine must order the infra-fail edge before the
    // unconditional block edge.
    describe('safety infra-fail separation (0347 F4)', () => {
        const safety = readFileSync(join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml'), 'utf-8');

        it('both nested safety invocations forward agent_retry to the machine', () => {
            const invocations = yaml.split('spur workflow run plugins/kk/workflows/kk-daily-safety.yaml').slice(1);
            expect(invocations.length).toBe(2);
            for (const invocation of invocations) {
                expect(invocation.slice(0, invocation.indexOf('--quiet'))).toContain('agent_retry');
            }
        });

        it('the machine declares infra-fail as a terminal failure state with a guarded edge before block', () => {
            expect(safety).toMatch(/^ {2}- infra-fail$/m);
            expect(safety).toMatch(/terminalStates:[\s\S]*?- clean[\s\S]*?- block[\s\S]*?- infra-fail/);
            expect(safety).toMatch(/failureStates:[\s\S]*?- block[\s\S]*?- infra-fail/);
            const judgeEdges = safety.slice(safety.indexOf('  - from: judge'));
            const infraEdge = judgeEdges.indexOf('to: infra-fail');
            const blockEdge = judgeEdges.indexOf('to: block');
            expect(infraEdge).toBeGreaterThan(-1);
            expect(blockEdge).toBeGreaterThan(infraEdge);
            expect(judgeEdges.slice(infraEdge, blockEdge)).toContain('_09_safety-infra.json"');
            expect(judgeEdges.slice(infraEdge, blockEdge)).toContain('terminalReason: failed-agent');
        });
    });
});
