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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
        expect(refrozen.runs).toEqual(['publish-run-1']);
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

    it('carries no channel enablement switch and no publish plugin', () => {
        // Comments may NAME the removed switches (the graph explains why they are gone); what must not
        // exist is a declared var or a templated reference to one.
        for (const token of ['xhs_enabled', 'wechat_enabled', 'xhs_live', 'wechat_live', 'publish_enabled']) {
            expect({ token, declared: new RegExp(`^  ${token}:`, 'm').test(yaml) }).toEqual({ token, declared: false });
            expect({ token, referenced: yaml.includes(`\${vars.${token}}`) }).toEqual({ token, referenced: false });
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
            'social-write',
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
        expect(yaml).toContain(`test "${'$'}{vars.auto_publish}" = "true"`);
        expect(yaml).toContain('kk stage run publish-matrix-bundle');
        expect(yaml).toContain('kk stage run daily-bundle-variants');
    });

    it('leaves voice2 untouched: the generate nodes it copies still exist there', () => {
        const voice2 = readFileSync(VOICE2, 'utf-8');
        for (const node of [
            'prepare',
            'extract',
            'plan',
            'qc-content',
            'select',
            'plan-translate',
            'article-write',
            'cover-brief',
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
    });
});
