import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: capture.read(), stderr: capture.readErr() };
    } finally {
        capture.restore();
    }
}

describe('content nouns (0363)', () => {
    it('creates an article request idempotently and reports status', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-nouns-'));
        const works = join(root, 'works');
        const source = join(root, 'fixture.md');
        const variant = join(root, 'variant.md');
        const cover = join(root, 'cover.png');
        writeFileSync(source, '# Demo\n\nBody');
        writeFileSync(variant, '# Demo JA\n\nVariant body');
        writeFileSync(cover, 'fake image bytes');
        const before = process.env.KK_WORKS_DIR;
        process.env.KK_WORKS_DIR = works;
        try {
            const first = await run([
                'article',
                'new',
                '--slug',
                'demo',
                '--from',
                source,
                '--locale',
                'zh',
                '--title',
                'Demo title',
                '--tags',
                'one, two',
                '--description',
                'A demo',
                '--cover',
                cover,
                '--variant',
                `ja=${variant}`,
            ]);
            const firstRequest = readFileSync(join(JSON.parse(first.stdout).workDir as string, 'request.json'));
            const second = await run(['article', 'new', '--slug', 'demo', '--from', source]);
            expect(first.code).toBe(0);
            expect(second.code).toBe(0);
            expect(JSON.parse(first.stdout).created).toBe(true);
            expect(JSON.parse(second.stdout).created).toBe(false);
            const workDir = JSON.parse(first.stdout).workDir as string;
            expect(readFileSync(join(workDir, 'request.json'))).toEqual(firstRequest);
            expect(readFileSync(join(workDir, 'content', 'zh', 'article.md'), 'utf8')).toContain('Body');
            expect(readFileSync(join(workDir, '4-publish', 'content.json'), 'utf8')).toContain('Demo title');
            expect(readFileSync(join(workDir, '4-illustrations', 'cover.png'), 'utf8')).toBe('fake image bytes');
            const request = JSON.parse(readFileSync(join(workDir, 'request.json'), 'utf8')) as {
                tags: string[];
                variants: Record<string, string>;
            };
            expect(request.tags).toEqual(['one', 'two']);
            expect(request.variants.ja).toBe(variant);
            const status = await run(['article', 'status', '--slug', 'demo']);
            expect(status.code).toBe(0);
            expect(JSON.parse(status.stdout)).toMatchObject({ workDir, type: 'itc', generate: null, bundle: null });
            const missingNews = await run(['news', 'status', '--run-date', '20260101']);
            expect(missingNews.code).toBe(1);
            const summaryPath = join(process.cwd(), '.works', 'tmp', 'test-content-nouns', 'summary.json');
            mkdirSync(join(process.cwd(), '.works', 'tmp', 'test-content-nouns'), { recursive: true });
            writeFileSync(
                summaryPath,
                `${JSON.stringify(
                    [first, second, status, missingNews].map((result, index) => ({
                        command:
                            index === 0
                                ? 'article new (first)'
                                : index === 1
                                  ? 'article new (second)'
                                  : index === 2
                                    ? 'article status'
                                    : 'news status',
                        exitCode: result.code,
                        stdout: result.stdout,
                    })),
                    null,
                    2,
                )}\n`,
            );
            expect(readFileSync(summaryPath, 'utf8')).toContain('article new (first)');
        } finally {
            if (before === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = before;
        }
    });

    it('rejects fixed news types and unknown article types with exit 2', async () => {
        expect((await run(['news', 'new', '--type', 'itc'])).code).toBe(2);
        expect((await run(['article', 'status', '--type', 'missing', '--slug', 'demo'])).code).toBe(2);
    });

    it('reads configured news runs and reports receipt, bundle, and publish windows', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-news-'));
        const config = join(root, 'config.yaml');
        const works = join(root, 'configured-works');
        writeFileSync(config, `works_dir: ${works}\n`);
        const beforeConfig = process.env.KK_CONFIG;
        const beforeWorks = process.env.KK_WORKS_DIR;
        process.env.KK_CONFIG = config;
        delete process.env.KK_WORKS_DIR;
        try {
            const created = await run(['news', 'new', '--run-date', '20260102', '--topic', 'news-topic']);
            expect(created.code).toBe(0);
            const payload = JSON.parse(created.stdout) as { workDir: string };
            expect(payload.workDir).toBe(join(works, 'kk-news-generate', '20260102'));
            const workDir = payload.workDir;
            writeFileSync(
                join(workDir, 'schedule-receipt.json'),
                JSON.stringify({ status: 'done', runId: 'run-1', executor: 'inline', checkoutCommit: 'abc' }),
            );
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            writeFileSync(
                join(workDir, '4-publish', 'bundle.json'),
                JSON.stringify({ frozen: true, runId: 'bundle-1', variants: { en: { path: 'en.json' } } }),
            );
            writeFileSync(
                join(workDir, '4-publish', 'outcome.after-generate.json'),
                JSON.stringify({ window: 'after-generate', status: 'full', published: 1, targets: 2 }),
            );
            writeFileSync(
                join(workDir, '4-publish', 'outcome.cn-peak.json'),
                JSON.stringify({ window: 'cn-peak', status: 'dummy', published: 0, targets: 1 }),
            );
            writeFileSync(join(workDir, '4-publish', 'outcome.bad.json'), '{broken');
            const status = await run(['news', 'status', '--run-date', '20260102']);
            expect(status.code).toBe(0);
            expect(JSON.parse(status.stdout)).toMatchObject({
                generate: { status: 'done', runId: 'run-1', executor: 'inline', checkoutCommit: 'abc' },
                bundle: { frozen: true, runId: 'bundle-1' },
                windows: {
                    'after-generate': { status: 'full', published: 1, targets: 2 },
                    'cn-peak': { status: 'dummy', published: 0, targets: 1 },
                },
            });
            const filtered = await run(['news', 'status', '--run-date', '20260102', '--window', 'after-generate']);
            expect(filtered.code).toBe(0);
            expect(JSON.parse(filtered.stdout)).toMatchObject({
                windows: { 'after-generate': { status: 'full', published: 1, targets: 2 } },
            });
            const explicit = await run(['news', 'status', '--work-dir', join(root, 'arbitrary-run')]);
            expect(explicit.code).toBe(1);
            expect(JSON.parse(explicit.stdout)).toMatchObject({
                type: 'news',
                generate: null,
                bundle: null,
                windows: null,
            });
        } finally {
            if (beforeConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = beforeConfig;
            if (beforeWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = beforeWorks;
        }
    });

    it('reports malformed config and validates new/status usage', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-errors-'));
        const config = join(root, 'bad.yaml');
        const beforeConfig = process.env.KK_CONFIG;
        const beforeWorks = process.env.KK_WORKS_DIR;
        process.env.KK_CONFIG = config;
        delete process.env.KK_WORKS_DIR;
        try {
            writeFileSync(config, '[]\n');
            expect((await run(['article', 'status', '--slug', 'demo'])).code).toBe(2);
            writeFileSync(config, 'content_types:\n  itc:\n    works_namespace: old\n');
            expect((await run(['article', 'status', '--slug', 'demo'])).code).toBe(2);
            writeFileSync(config, 'content_types:\n  itc:\n    writer_skill: kk:no-such-skill\n');
            expect((await run(['article', 'status', '--slug', 'demo'])).code).toBe(5);
            writeFileSync(config, '{}\n');
            expect((await run(['article', 'new', '--slug', 'bad'])).code).toBe(2);
            expect((await run(['article', 'new', '--slug', 'BAD', '--topic', 'x'])).code).toBe(2);
            expect((await run(['article', 'new', '--slug', 'good', '--topic', 'x', '--locale', 'fr'])).code).toBe(2);
            expect(
                (await run(['article', 'new', '--slug', 'good', '--topic', 'x', '--run-date', '20260231'])).code,
            ).toBe(2);
            expect((await run(['article', 'new', '--slug', 'good', '--from', join(root, 'missing.md')])).code).toBe(2);
            expect((await run(['article', 'new', '--slug', 'good', '--topic', 'x', '--variant', 'bad'])).code).toBe(2);
            expect((await run(['article', 'new', '--slug', 'good', '--topic', 'x', '--variant', 'Bad=x'])).code).toBe(
                2,
            );
            expect(
                (await run(['article', 'new', '--slug', 'good', '--topic', 'x', '--cover', join(root, 'missing.png')]))
                    .code,
            ).toBe(2);
            expect((await run(['news', 'status', '--run-date', '20260231'])).code).toBe(2);
        } finally {
            if (beforeConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = beforeConfig;
            if (beforeWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = beforeWorks;
        }
    });
});
