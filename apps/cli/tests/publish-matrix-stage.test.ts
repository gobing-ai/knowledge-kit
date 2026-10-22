import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPublishMatrixStage } from '../src/publish-matrix-stage';
import { captureOutput } from './capture';

/**
 * A minimal works dir: one bundle with one variant and a preset whose only after-generate target is
 * `dummy`, so a stage-level send never spawns a plugin (0322 owns the real dummy receipt).
 */
function seedWorks(root: string): { workDir: string; bundlePath: string } {
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const article = `${JSON.stringify({ title: 't', format: 'markdown', body: '正文' })}\n`;
    writeFileSync(join(workDir, 'variants/article.json'), article);
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(
        bundlePath,
        JSON.stringify({
            schemaVersion: 1,
            runId: 'gen-run-1',
            runDate: '2026-10-22',
            episode: { title: '每日AI乱炖' },
            variants: {
                article: {
                    path: 'variants/article.json',
                    sha256: createHash('sha256').update(article).digest('hex'),
                },
            },
        }),
    );
    writeFileSync(
        join(root, '.kk/publish-presets/daily-ai-voice.json'),
        JSON.stringify({
            schemaVersion: 1,
            name: 'daily-ai-voice',
            targets: [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'dummy' }],
        }),
    );
    return { workDir, bundlePath };
}

describe('publish-matrix stage names (0321 R7)', () => {
    it('routes each publish-matrix stage to its own implementation and leaves other names alone', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-matrix-stage-'));
        const cwd = process.cwd();
        const out = captureOutput();
        try {
            const { workDir, bundlePath } = seedWorks(root);
            process.chdir(root);

            expect(
                await runPublishMatrixStage([
                    'publish-matrix-plan',
                    workDir,
                    '--bundle',
                    bundlePath,
                    '--preset',
                    'daily-ai-voice',
                    '--window',
                    'after-generate',
                ]),
            ).toBe(0);
            expect(existsSync(join(workDir, '4-publish/plan.after-generate.json'))).toBe(true);

            expect(await runPublishMatrixStage(['publish-matrix-check', workDir, '--window', 'after-generate'])).toBe(
                0,
            );
            expect(existsSync(join(workDir, '4-publish/check.after-generate.json'))).toBe(true);

            // The single plan row is dummy, so send records a no-effect receipt without a spawn.
            expect(await runPublishMatrixStage(['publish-matrix-send', workDir, '--window', 'after-generate'])).toBe(0);
            expect(existsSync(join(workDir, '4-publish/receipts/surfdash-pub.post.json'))).toBe(true);

            expect(await runPublishMatrixStage(['itc-publish-plan'])).toBeUndefined();
            expect(await runPublishMatrixStage(['some-other-stage'])).toBeUndefined();
            expect(await runPublishMatrixStage([])).toBeUndefined();
        } finally {
            process.chdir(cwd);
            out.restore();
            rmSync(root, { recursive: true, force: true });
        }
    });
});
