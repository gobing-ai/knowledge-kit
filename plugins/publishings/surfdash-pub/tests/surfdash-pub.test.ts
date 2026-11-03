import { describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    awaitArticleLive,
    extractFailingPostHint,
    fastForwardToOrigin,
    getPublishTransport,
    main,
    mapContentToSurfingMarkdown,
    normalizeLocaleFrontmatter,
    normalizeTag,
    PostsurfingFileCliTransport,
    processPublishIO,
    pushPostGit,
    runListenLinkBackfill,
    runSiteGate,
    slugify,
    withEmdashTokenHint,
} from '../src/index';
import { crossLinkFor, localeIndexPath, patchPostFiles, upsertFrontmatterKey } from '../src/patch';

// Auto-push targets the real surfdash checkout — CLI-path tests run offline with stub binaries.
process.env.SURFDASH_AUTO_PUSH ??= '0';

describe('surfdash-pub plugin', () => {
    test('slugify converts titles and tags into lowercase hyphenated strings', () => {
        expect(slugify('Hello World!')).toBe('hello-world');
        expect(slugify('  TypeScript & Bun  ')).toBe('typescript-bun');
    });

    test('mapContentToSurfingMarkdown maps Content properties according to publish spec', () => {
        const content: Content = {
            title: 'My Surfing Article',
            body: '# My Surfing Article\n\nThis is the lead paragraph.\n\nSecond paragraph content.',
            format: 'markdown',
            references: [{ url: 'https://example.com/ref-1', title: 'Ref 1' }],
            metadata: {
                description: 'Custom description from metadata',
                tags: ['Web Dev', 'TypeScript!'],
                canonicalUrl: 'https://example.com/canonical',
                published: true,
            },
        };

        const markdown = mapContentToSurfingMarkdown(content);
        expect(markdown).toContain('title: "My Surfing Article"');
        expect(markdown).toContain('description: "Custom description from metadata"');
        expect(markdown).toContain('tags: ["web-dev","typescript"]');
        expect(markdown).toContain('draft: false');
        expect(markdown).toContain('publishDate: "');
        expect(markdown).toContain('# My Surfing Article');
    });

    test('mapContentToSurfingMarkdown leaves description empty when metadata.description is absent (refine owns it)', () => {
        const content: Content = {
            body: '# Extracted Title\n\nThis lead paragraph will not become the description.\n\nMore text.',
            format: 'markdown',
        };

        const markdown = mapContentToSurfingMarkdown(content);
        expect(markdown).toContain('title: "Extracted Title"');
        expect(markdown).toContain('description: ""');
        expect(markdown).toContain('draft: false');
    });

    test('getPublishTransport resolves PostsurfingFileCliTransport by default and FakeFileCliTransport when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(PostsurfingFileCliTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('PostsurfingFileCliTransport handles missing postsurfing binary gracefully', async () => {
        const tmpDir = join(process.cwd(), '.tmp-missing-bin');
        await mkdir(tmpDir, { recursive: true });
        process.env.SURFDASH_ROOT = tmpDir; // bypass bin-path root derivation; spawn still targets a missing bin
        process.env.POSTSURFING_BIN = 'postsurfing-definitely-missing-bin';
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = { title: 'CLI Test', body: 'Test body', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('surfdash');
            expect(result.error).toContain('Postsurfing transport error');
            expect(result.metadata?.deliveryState).toBe('uncertain');
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('PostsurfingFileCliTransport handles CLI non-zero exit when binary exists', async () => {
        const tmpDir = join(process.cwd(), '.tmp-mock-postsurfing');
        await mkdir(tmpDir, { recursive: true });
        const mockBin = join(tmpDir, 'postsurfing');
        await writeFile(mockBin, '#!/usr/bin/env bun\nconsole.error("CLI error"); process.exit(1);\n', 'utf-8');
        await Bun.spawn(['chmod', '+x', mockBin]).exited;

        process.env.POSTSURFING_BIN = mockBin;
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = { title: 'Fail Test', body: 'Test body', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.target).toBe('surfdash');
            expect(result.error).toContain('postsurfing CLI failed (exit 1): CLI error');
            expect(result.metadata?.deliveryState).toBe('uncertain');
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('PostsurfingFileCliTransport handles successful CLI execution', async () => {
        const tmpDir = join(process.cwd(), '.tmp-mock-postsurfing-pass');
        await mkdir(tmpDir, { recursive: true });
        const mockBin = join(tmpDir, 'postsurfing');
        await writeFile(
            mockBin,
            readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'),
            'utf-8',
        );
        await Bun.spawn(['chmod', '+x', mockBin]).exited;

        process.env.POSTSURFING_BIN = mockBin;
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = { title: 'Pass Test', body: 'Test body', format: 'markdown' };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('surfdash');
            expect(result.message).toContain('auto-push disabled');
            // Contract: date-stamped slug under content/posts/articles/<locale>/; markdown at index.md
            const articlesDir = join(tmpDir, 'content', 'posts', 'articles', 'zh');
            const entries = existsSync(articlesDir) ? await readdir(articlesDir) : [];
            expect(entries.length).toBe(1);
            expect(entries[0]).toMatch(/^\d{8}-pass-test$/);
            expect(existsSync(join(articlesDir, entries[0] ?? '', 'index.md'))).toBe(true);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('PostsurfingFileCliTransport date-stamps slug from metadata.runDate and copies cover asset', async () => {
        const tmpDir = join(process.cwd(), '.tmp-mock-postsurfing-cover');
        await mkdir(tmpDir, { recursive: true });
        const mockBin = join(tmpDir, 'postsurfing');
        await writeFile(
            mockBin,
            readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'),
            'utf-8',
        );
        await Bun.spawn(['chmod', '+x', mockBin]).exited;
        const coverSrc = join(tmpDir, 'source-cover.png');
        await writeFile(coverSrc, 'fake-png-bytes', 'utf-8');

        process.env.POSTSURFING_BIN = mockBin;
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = {
                title: '中文标题', // slugifies to '' — falls back to <date>-post
                body: '# 中文标题\n\n正文段落。',
                format: 'markdown',
                metadata: { runDate: '20260904', coverImage: coverSrc },
            };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);

            const postDir = join(tmpDir, 'content', 'posts', 'articles', 'zh', '20260904-post');
            const markdown = await readFile(join(postDir, 'index.md'), 'utf-8');
            expect(markdown).toContain('publishDate: "2026-09-04"');
            expect(markdown).toContain('image: "./assets/cover.png"');
            expect(markdown).toContain('og_image: "./assets/cover.png"');
            expect(existsSync(join(postDir, 'assets', 'cover.png'))).toBe(true);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('processPublishIO executes offline via FakeFileCliTransport without external effects', async () => {
        const fakeTransport = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Test Publish',
            body: 'Body content for test publish.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        await processPublishIO(inPath, outPath, fakeTransport);

        const logs = fakeTransport.getCallLogs();
        expect(logs.length).toBe(1);
        expect(logs[0]?.payload.content.title).toBe('Test Publish');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(true);
        expect(result.target).toBe('fake-file-cli');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('processPublishIO handles transport failures and writes error Result', async () => {
        const fakeTransport = new FakeFileCliTransport();
        fakeTransport.setNextResult({
            ok: false,
            target: 'surfdash',
            error: 'Simulated postsurfing CLI failure',
        });

        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-fail');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'input-content.json');
        const outPath = join(tmpDir, 'output-result.json');

        const inputContent: Content = {
            title: 'Test Fail',
            body: 'Body content for fail test.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        expect(processPublishIO(inPath, outPath, fakeTransport)).rejects.toThrow('Simulated postsurfing CLI failure');

        const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
        const result = ResultSchema.parse(resultJson);

        expect(result.ok).toBe(false);
        expect(result.target).toBe('surfdash');
        expect(result.error).toBe('Simulated postsurfing CLI failure');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('main CLI entry handles argument parsing and failure paths', async () => {
        const origArgv = process.argv;
        process.argv = ['bun', 'index.ts'];
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
        }

        const tmpDir = join(process.cwd(), '.works/tmp/test-main');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        const inputContent: Content = {
            title: 'Main Test',
            body: 'Body content for main test.',
            format: 'markdown',
        };
        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];

        try {
            expect(await main()).toBe(0);
            const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
            expect(ResultSchema.parse(resultJson).ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke with surfdash-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-invoke');
        await mkdir(tmpDir, { recursive: true });

        const inPath = join(tmpDir, 'in-content.json');
        const outPath = join(tmpDir, 'out-result.json');

        const inputContent: Content = {
            title: 'Invoke Integration Test',
            body: 'Integration testing surfdash-pub with runInvoke.',
            format: 'markdown',
        };

        await writeFile(inPath, JSON.stringify(inputContent), 'utf-8');

        const pluginsRoot = join(process.cwd(), 'plugins');
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'surfdash-pub',
                inPath,
                outPath,
                pluginsRoot,
            });

            const resultJson = JSON.parse(await readFile(outPath, 'utf-8'));
            const result = ResultSchema.parse(resultJson);

            expect(code).toBe(0);
            expect(result.ok).toBe(true);
            expect(result.target).toBe('fake-file-cli');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }

        await rm(tmpDir, { recursive: true, force: true });
    });
});

/**
 * Fake surfdash checkout root (0096): a package.json whose `sd` script maps to a stub
 * bun script plus a stub publish-orchestrator — no real surfdash checkout is touched.
 * `sdExit`/`syncExit` let tests force CLI failures; argv and sync side effects are
 * logged to files the tests assert against.
 */
async function writeSurfdashFixture(root: string, opts: { sdExit?: number; syncExit?: number } = {}): Promise<void> {
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
    await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: 'fake-surfdash', private: true, scripts: { sd: 'bun scripts/sd.ts' } }),
        'utf-8',
    );
    const sdLines = [
        "import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';",
        "import { dirname, join, sep } from 'node:path';",
        `const failExit = ${opts.sdExit ?? 0};`,
        'const argv = process.argv.slice(2);',
        'const [cmd, postPath] = argv;',
        "appendFileSync(join(import.meta.dir, '..', 'sd-args.log'), JSON.stringify(argv) + '\\n');",
        "if (cmd !== 'translate') { console.error('unknown sd cmd: ' + String(cmd)); process.exit(1); }",
        'const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };',
        "const source = opt('--source') ?? 'zh';",
        "const target = opt('--target') ?? 'en';",
        "if (failExit !== 0) { console.error('sd translate exploded'); process.exit(failExit); }",
        "if (!postPath || !existsSync(postPath)) { console.error('post not found: ' + String(postPath)); process.exit(1); }",
        "const marker = sep + 'zh' + sep;",
        'const i = postPath.lastIndexOf(marker);',
        "if (i < 0) { console.error('no zh segment'); process.exit(1); }",
        'const draftPath = postPath.slice(0, i) + sep + target + sep + postPath.slice(i + marker.length);',
        'mkdirSync(dirname(draftPath), { recursive: true });',
        "writeFileSync(draftPath, '---\\ntitle: scaffolded ' + source + ' -> ' + target + '\\n---\\n\\nDraft body\\n');",
        "console.log('wrote ' + draftPath);",
    ];
    await writeFile(join(root, 'scripts', 'sd.ts'), `${sdLines.join('\n')}\n`, 'utf-8');
    const orchestratorLines = [
        "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        `const failExit = ${opts.syncExit ?? 0};`,
        'const argv = process.argv.slice(2);',
        'const [cmd, postPath] = argv;',
        "if (!postPath || !['refine', 'sync'].includes(cmd)) { console.error('usage: publish-orchestrator <refine|sync> <postPath>'); process.exit(2); }",
        "if (failExit !== 0) { console.error('orchestrator sync exploded'); process.exit(failExit); }",
        "if (cmd === 'refine') { const raw = readFileSync(postPath, 'utf-8'); if (!raw.includes('refined: true')) writeFileSync(postPath, raw.replace('refined: false', 'refined: true')); appendFileSync(join(import.meta.dir, '..', 'refine-log.txt'), postPath + '\\n'); process.exit(0); }",
        "appendFileSync(join(import.meta.dir, '..', 'sync-log.txt'), 'synced ' + postPath + '\\n');",
        "console.log('sync ok');",
    ];
    await writeFile(join(root, 'scripts', 'publish-orchestrator.ts'), `${orchestratorLines.join('\n')}\n`, 'utf-8');
}

/** Creates a zh post (with an assets dir) inside the fixture root; returns its abs path. */
async function writeFixtureZhPost(root: string, slug = '20260906-post'): Promise<string> {
    const zhDir = join(root, 'content', 'posts', 'articles', 'zh', slug);
    await mkdir(join(zhDir, 'assets'), { recursive: true });
    const zhPostPath = join(zhDir, 'index.md');
    await writeFile(
        zhPostPath,
        '---\ntitle: "zh post"\npublishDate: "2026-09-06"\ndraft: true\n---\n\n正文段落。\n',
        'utf-8',
    );
    await writeFile(join(zhDir, 'assets', 'cover.png'), 'png-bytes', 'utf-8');
    return zhPostPath;
}

describe('surfdash-pub operations (0096)', () => {
    const unusedContent: Content = { title: 'unused', body: 'unused', format: 'markdown' };

    test('prepare materializes the zh post without invoking postsurfing or CMS sync', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-prepare');
        await writeSurfdashFixture(root);
        const expectedPath = join(root, 'content', 'posts', 'articles', 'zh', '20261102-prepared-post', 'index.md');

        process.env.SURFDASH_ROOT = root;
        process.env.POSTSURFING_BIN = join(root, 'missing-postsurfing');
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: {
                    title: 'Prepared Post',
                    body: '# Prepared Post\n\nPrepared before locale translation.',
                    format: 'markdown',
                    metadata: { runDate: '20261102' },
                },
                options: { operation: 'prepare' },
            });

            expect(result.ok).toBe(true);
            expect(result.target).toBe('surfdash');
            expect(result.metadata?.postPath).toBe(expectedPath);
            expect(existsSync(expectedPath)).toBe(true);
            expect(existsSync(join(root, 'sd-args.log'))).toBe(false);
            expect(existsSync(join(root, 'sync-log.txt'))).toBe(false);
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('refine-prepared delegates every locale to Surfdash refine and returns the post-fingerprint', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-refine-prepared');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root);
        await writeFile(
            zhPostPath,
            (await readFile(zhPostPath, 'utf-8')).replace('draft: true', 'draft: false\nrefined: false'),
            'utf-8',
        );
        const localePaths = {
            zh: zhPostPath,
            en: zhPostPath.replace('/zh/', '/en/'),
            ja: zhPostPath.replace('/zh/', '/ja/'),
        };
        for (const locale of ['en', 'ja'] as const) {
            await mkdir(dirname(localePaths[locale]), { recursive: true });
            await writeFile(
                localePaths[locale],
                '---\ntitle: "translated post"\npublishDate: "2026-09-06"\ndraft: false\nrefined: false\n---\n\nTranslated body.\n',
                'utf-8',
            );
        }

        process.env.SURFDASH_ROOT = root;
        try {
            const result = await new PostsurfingFileCliTransport().publish({
                content: unusedContent,
                options: {
                    operation: 'refine-prepared',
                    postPath: zhPostPath,
                    runDate: '20260906',
                },
            });
            expect(result.ok).toBe(true);
            expect(result.metadata?.postPath).toBe(zhPostPath);
            expect(result.metadata?.runDate).toBe('20260906');
            expect(typeof result.metadata?.localeFingerprint).toBe('string');
            const refinedPaths = [localePaths.zh, localePaths.en, localePaths.ja];
            for (const path of refinedPaths) expect(await readFile(path, 'utf-8')).toContain('refined: true');
            expect((await readFile(join(root, 'refine-log.txt'), 'utf-8')).trim().split('\n')).toEqual(refinedPaths);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale on a fixture zh post returns the en draft path and creates the scaffolded file', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-scaffold');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root);
        const draftPath = join(root, 'content', 'posts', 'articles', 'en', '20260906-post', 'index.md');

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: zhPostPath, target: 'en' },
            });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('surfdash');
            expect(result.metadata?.draftPath).toBe(draftPath);
            expect(result.metadata?.target).toBe('en');
            expect(existsSync(draftPath)).toBe(true);
            expect(await readFile(draftPath, 'utf-8')).toContain('scaffolded zh -> en');
            // The zh post's assets dir is copied next to the draft.
            expect(existsSync(join(dirname(draftPath), 'assets', 'cover.png'))).toBe(true);
            // The sd CLI received the exact frozen argv shape.
            const sdArgs = JSON.parse(await readFile(join(root, 'sd-args.log'), 'utf-8')) as string[];
            expect(sdArgs).toEqual(['translate', zhPostPath, '--source', 'zh', '--target', 'en']);

            const forced = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: zhPostPath, target: 'en', force: true },
            });
            expect(forced.ok).toBe(true);
            const sdArgLines = (await readFile(join(root, 'sd-args.log'), 'utf-8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            expect(sdArgLines[1]).toEqual(['translate', zhPostPath, '--source', 'zh', '--target', 'en', '--force']);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale skips the asset copy when the zh post has no assets dir (ja target)', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-no-assets');
        await writeSurfdashFixture(root);
        const zhDir = join(root, 'content', 'posts', 'articles', 'zh', '20260906-post');
        await mkdir(zhDir, { recursive: true });
        const zhPostPath = join(zhDir, 'index.md');
        await writeFile(
            zhPostPath,
            '---\ntitle: "zh post"\npublishDate: "2026-09-06"\ndraft: true\n---\n\n正文段落。\n',
            'utf-8',
        );
        const draftPath = join(root, 'content', 'posts', 'articles', 'ja', '20260906-post', 'index.md');

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: zhPostPath, target: 'ja' },
            });
            expect(result.ok).toBe(true);
            expect(result.metadata?.draftPath).toBe(draftPath);
            expect(existsSync(draftPath)).toBe(true);
            // No assets dir on the zh post → none is created next to the draft.
            expect(existsSync(join(dirname(draftPath), 'assets'))).toBe(false);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('sync on a fixture post returns an ok Result and runs the publish-orchestrator', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-sync');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root);

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: unusedContent,
                options: { operation: 'sync', postPath: zhPostPath },
            });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('surfdash');
            expect(result.metadata?.postPath).toBe(zhPostPath);
            expect(await readFile(join(root, 'sync-log.txt'), 'utf-8')).toBe(`synced ${zhPostPath}\n`);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('unknown operation fails loud naming the valid operations', async () => {
        const transport = new PostsurfingFileCliTransport();
        const result = await transport.publish({ content: unusedContent, options: { operation: 'teleport' } });
        expect(result.ok).toBe(false);
        expect(result.target).toBe('surfdash');
        expect(result.error).toContain('invalid options.operation "teleport"');
        expect(result.error).toContain('publish, prepare, refine-prepared, publish-prepared, scaffold-locale, sync');
    });

    test('publish-prepared validates the locale identity and publishes without rematerializing zh', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-publish-prepared');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root, '20260906-prepared');
        const zhBody =
            '---\ntitle: "validated zh"\npublishDate: "2026-09-06"\ndraft: false\nrefined: true\n---\n\nValidated body\n';
        await writeFile(zhPostPath, zhBody, 'utf-8');
        const enPostPath = zhPostPath.replace('/zh/', '/en/');
        const jaPostPath = zhPostPath.replace('/zh/', '/ja/');
        await mkdir(dirname(enPostPath), { recursive: true });
        await mkdir(dirname(jaPostPath), { recursive: true });
        await writeFile(enPostPath, '---\ntitle: en\ndraft: false\n---\n\nEnglish\n', 'utf-8');
        await writeFile(jaPostPath, '---\ntitle: ja\ndraft: false\n---\n\nJapanese\n', 'utf-8');
        const localePaths = { zh: zhPostPath, en: enPostPath, ja: jaPostPath };
        const localeDigests = {
            zh: createHash('sha256')
                .update(await readFile(zhPostPath))
                .digest('hex'),
            en: createHash('sha256')
                .update(await readFile(enPostPath))
                .digest('hex'),
            ja: createHash('sha256')
                .update(await readFile(jaPostPath))
                .digest('hex'),
        };
        const identity = { runDate: '20260906', postPath: zhPostPath, localePaths, localeDigests };
        const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        const before = await readFile(zhPostPath, 'utf-8');
        const mockBin = join(root, 'postsurfing');
        await writeFile(
            mockBin,
            readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'),
            'utf-8',
        );
        await Bun.spawn(['chmod', '+x', mockBin]).exited;

        process.env.SURFDASH_ROOT = root;
        process.env.POSTSURFING_BIN = mockBin;
        try {
            const result = await new PostsurfingFileCliTransport().publish({
                content: { title: 'must not replace validated bytes', body: 'wrong', format: 'markdown' },
                options: {
                    operation: 'publish-prepared',
                    postPath: zhPostPath,
                    runDate: '20260906',
                    expectedPostSha256: localeDigests.zh,
                    expectedLocaleFingerprint: fingerprint,
                },
            });
            expect(result.ok).toBe(true);
            expect(result.metadata?.postPath).toBe(zhPostPath);
            expect(result.metadata?.localeFingerprint).toBe(fingerprint);
            expect(await readFile(zhPostPath, 'utf-8')).toBe(before);
            expect(existsSync(join(root, 'sd-args.log'))).toBe(false);
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('publish-prepared rejects a remote phase that mutates locale bytes after validation', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-publish-prepared-mutation');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root, '20260906-prepared-mutation');
        await writeFile(
            zhPostPath,
            (await readFile(zhPostPath, 'utf-8')).replace('draft: true', 'draft: false\nrefined: true'),
            'utf-8',
        );
        const enPostPath = zhPostPath.replace('/zh/', '/en/');
        const jaPostPath = zhPostPath.replace('/zh/', '/ja/');
        await mkdir(dirname(enPostPath), { recursive: true });
        await mkdir(dirname(jaPostPath), { recursive: true });
        await writeFile(enPostPath, '---\ntitle: en\ndraft: false\nrefined: true\n---\n\nEnglish\n', 'utf-8');
        await writeFile(jaPostPath, '---\ntitle: ja\ndraft: false\nrefined: true\n---\n\nJapanese\n', 'utf-8');
        const localePaths = { zh: zhPostPath, en: enPostPath, ja: jaPostPath };
        const localeDigests = {
            zh: createHash('sha256')
                .update(await readFile(zhPostPath))
                .digest('hex'),
            en: createHash('sha256')
                .update(await readFile(enPostPath))
                .digest('hex'),
            ja: createHash('sha256')
                .update(await readFile(jaPostPath))
                .digest('hex'),
        };
        const identity = { runDate: '20260906', postPath: zhPostPath, localePaths, localeDigests };
        const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        const mutatingBin = join(root, 'postsurfing-mutates');
        await writeFile(
            mutatingBin,
            "#!/usr/bin/env bun\nimport { readFileSync, writeFileSync } from 'node:fs';\nconst zh = process.argv[3];\nconst en = zh.replace('/zh/', '/en/');\nwriteFileSync(en, readFileSync(en, 'utf-8') + '\\nremote mutation\\n');\n",
            'utf-8',
        );
        await Bun.spawn(['chmod', '+x', mutatingBin]).exited;

        process.env.SURFDASH_ROOT = root;
        process.env.POSTSURFING_BIN = mutatingBin;
        try {
            const result = await new PostsurfingFileCliTransport().publish({
                content: unusedContent,
                options: {
                    operation: 'publish-prepared',
                    postPath: zhPostPath,
                    runDate: '20260906',
                    expectedPostSha256: localeDigests.zh,
                    expectedLocaleFingerprint: fingerprint,
                },
            });
            expect(result.ok).toBe(false);
            expect(result.metadata?.deliveryState).toBe('uncertain');
            expect(result.error).toContain('prepared locale files changed after remote publish');
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('publish-prepared commits every locale post and asset, not only the zh directory', async () => {
        const base = join(process.cwd(), `.tmp-surfdash-fixture-publish-prepared-locales-${Date.now()}`);
        const root = join(base, 'work');
        const origin = join(base, 'origin.git');
        await writeSurfdashFixture(root);
        // The merged publisher runs the site's gate/backfill before committing. Keep those
        // external commands local while exercising the real locale identity and Git pathspec.
        const sdPath = join(root, 'scripts', 'sd.ts');
        await writeFile(
            sdPath,
            `if (['check', 'seo'].includes(process.argv[2])) {
                const { appendFileSync } = await import('node:fs');
                appendFileSync(${JSON.stringify(join(root, 'site-gate.log'))}, JSON.stringify(process.argv.slice(2)) + '\\n');
                process.exit(0);
            }\n${await readFile(sdPath, 'utf-8')}`,
        );
        await writeFile(
            join(root, 'package.json'),
            JSON.stringify({
                name: 'fake-surfdash',
                private: true,
                scripts: { sd: 'bun scripts/sd.ts', 'check:content': 'bun scripts/sd.ts check content' },
            }),
        );
        const zhPostPath = await writeFixtureZhPost(root, '20260906-prepared-all-locales');
        const localePaths = {
            zh: zhPostPath,
            en: zhPostPath.replace('/zh/', '/en/'),
            ja: zhPostPath.replace('/zh/', '/ja/'),
        };
        await writeFile(
            localePaths.zh,
            (await readFile(localePaths.zh, 'utf-8')).replace('draft: true', 'draft: false\nrefined: true'),
        );
        for (const locale of ['en', 'ja'] as const) {
            await mkdir(join(dirname(localePaths[locale]), 'assets'), { recursive: true });
            await writeFile(
                localePaths[locale],
                `---\ntitle: ${locale}\npublishDate: "2026-09-06"\ndraft: false\nrefined: true\n---\n\n${locale} body\n`,
            );
            await writeFile(join(dirname(localePaths[locale]), 'assets', 'cover.png'), `${locale} initial asset`);
        }

        const runGit = (...args: string[]): void => {
            const result = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
            if (result.exitCode !== 0) {
                throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
            }
        };
        try {
            runGit('init', '-q', '-b', 'main');
            runGit('config', 'user.email', 'test@test');
            runGit('config', 'user.name', 'test');
            runGit('add', '-A');
            runGit('commit', '-q', '-m', 'seed');
            runGit('init', '--bare', '-q', '-b', 'main', origin);
            runGit('remote', 'add', 'origin', origin);
            runGit('push', '-q', '-u', 'origin', 'main');

            for (const locale of ['zh', 'en', 'ja'] as const) {
                await writeFile(localePaths[locale], `${await readFile(localePaths[locale], 'utf-8')}updated\n`);
                await writeFile(join(dirname(localePaths[locale]), 'assets', 'cover.png'), `${locale} updated asset`);
            }
            const localeDigests = Object.fromEntries(
                (['zh', 'en', 'ja'] as const).map((locale) => [
                    locale,
                    createHash('sha256').update(readFileSync(localePaths[locale])).digest('hex'),
                ]),
            ) as { zh: string; en: string; ja: string };
            const identity = { runDate: '20260906', postPath: zhPostPath, localePaths, localeDigests };
            const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
            const fakeBin = join(root, 'postsurfing');
            await writeFile(fakeBin, readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'));
            await Bun.spawn(['chmod', '+x', fakeBin]).exited;

            process.env.SURFDASH_ROOT = root;
            process.env.POSTSURFING_BIN = fakeBin;
            const previousAutoPush = process.env.SURFDASH_AUTO_PUSH;
            const previousSurfdashUrl = process.env.SURFDASH_URL;
            const liveServer = Bun.serve({ port: 0, fetch: () => new Response('ok') });
            process.env.SURFDASH_AUTO_PUSH = '1';
            process.env.SURFDASH_URL = `http://127.0.0.1:${liveServer.port}`;
            try {
                const result = await new PostsurfingFileCliTransport().publish({
                    content: unusedContent,
                    options: {
                        operation: 'publish-prepared',
                        postPath: zhPostPath,
                        runDate: '20260906',
                        expectedPostSha256: localeDigests.zh,
                        expectedLocaleFingerprint: fingerprint,
                    },
                });
                expect(result.ok, result.error).toBe(true);
                const gateCalls = (await readFile(join(root, 'site-gate.log'), 'utf-8'))
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line));
                expect(gateCalls).toEqual([
                    ['seo', 'listen-link', '--backfill', '--write'],
                    ['check', 'digest'],
                    ['check', 'content'],
                ]);
                const pushedPaths = Bun.spawnSync(
                    ['git', '--git-dir', origin, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main'],
                    { stdout: 'pipe', stderr: 'pipe' },
                ).stdout.toString();
                for (const locale of ['zh', 'en', 'ja']) {
                    expect(pushedPaths).toContain(
                        `content/posts/articles/${locale}/20260906-prepared-all-locales/index.md`,
                    );
                    expect(pushedPaths).toContain(
                        `content/posts/articles/${locale}/20260906-prepared-all-locales/assets/cover.png`,
                    );
                }
            } finally {
                if (previousAutoPush === undefined) delete process.env.SURFDASH_AUTO_PUSH;
                else process.env.SURFDASH_AUTO_PUSH = previousAutoPush;
                if (previousSurfdashUrl === undefined) delete process.env.SURFDASH_URL;
                else process.env.SURFDASH_URL = previousSurfdashUrl;
                liveServer.stop();
            }
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(base, { recursive: true, force: true });
        }
    });

    test('publish-prepared refuses changed slug or locale bytes before invoking postsurfing', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-publish-prepared-guard');
        await writeSurfdashFixture(root);
        const originalZh = await writeFixtureZhPost(root, '20260906-original');
        const otherZh = await writeFixtureZhPost(root, '20260906-other');
        for (const zhPath of [originalZh, otherZh]) {
            await writeFile(
                zhPath,
                '---\ntitle: same\npublishDate: "2026-09-06"\ndraft: false\nrefined: true\n---\n\nBody\n',
                'utf-8',
            );
            for (const locale of ['en', 'ja']) {
                const sibling = zhPath.replace('/zh/', `/${locale}/`);
                await mkdir(dirname(sibling), { recursive: true });
                await writeFile(sibling, `---\ntitle: ${locale}\ndraft: false\n---\n\n${locale}\n`, 'utf-8');
            }
        }
        const enOriginal = originalZh.replace('/zh/', '/en/');
        const jaOriginal = originalZh.replace('/zh/', '/ja/');
        const originalDigests = {
            zh: createHash('sha256')
                .update(await readFile(originalZh))
                .digest('hex'),
            en: createHash('sha256')
                .update(await readFile(enOriginal))
                .digest('hex'),
            ja: createHash('sha256')
                .update(await readFile(jaOriginal))
                .digest('hex'),
        };
        const originalIdentity = {
            runDate: '20260906',
            postPath: originalZh,
            localePaths: { zh: originalZh, en: enOriginal, ja: jaOriginal },
            localeDigests: originalDigests,
        };
        const originalFingerprint = createHash('sha256').update(JSON.stringify(originalIdentity)).digest('hex');
        await writeFile(enOriginal, 'changed after validation', 'utf-8');
        process.env.SURFDASH_ROOT = root;
        process.env.POSTSURFING_BIN = join(root, 'missing-postsurfing');
        try {
            const transport = new PostsurfingFileCliTransport();
            const changedLocale = await transport.publish({
                content: { title: 'ignored', body: 'ignored', format: 'markdown' },
                options: {
                    operation: 'publish-prepared',
                    postPath: originalZh,
                    runDate: '20260906',
                    expectedPostSha256: originalDigests.zh,
                    expectedLocaleFingerprint: originalFingerprint,
                },
            });
            expect(changedLocale.ok).toBe(false);
            expect(changedLocale.metadata?.deliveryState).toBe('not-sent');
            expect(existsSync(join(root, 'sd-args.log'))).toBe(false);

            const changedSlug = await transport.publish({
                content: { title: 'ignored', body: 'ignored', format: 'markdown' },
                options: {
                    operation: 'publish-prepared',
                    postPath: otherZh,
                    runDate: '20260906',
                    expectedPostSha256: originalDigests.zh,
                    expectedLocaleFingerprint: originalFingerprint,
                },
            });
            expect(changedSlug.ok).toBe(false);
            expect(changedSlug.metadata?.deliveryState).toBe('not-sent');
            expect(existsSync(join(root, 'sd-args.log'))).toBe(false);
        } finally {
            delete process.env.SURFDASH_ROOT;
            delete process.env.POSTSURFING_BIN;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale and sync validate their options fail-loud (no defaults)', async () => {
        const transport = new PostsurfingFileCliTransport();
        const noTarget = await transport.publish({
            content: unusedContent,
            options: { operation: 'scaffold-locale', postPath: '/tmp/x/index.md' },
        });
        expect(noTarget.ok).toBe(false);
        expect(noTarget.error).toContain('expected one of en, ja');
        const badTarget = await transport.publish({
            content: unusedContent,
            options: { operation: 'scaffold-locale', postPath: '/tmp/x/index.md', target: 'fr' },
        });
        expect(badTarget.ok).toBe(false);
        expect(badTarget.error).toContain('expected one of en, ja');
        const noPost = await transport.publish({ content: unusedContent, options: { operation: 'sync' } });
        expect(noPost.ok).toBe(false);
        expect(noPost.error).toContain('options.postPath is required for the "sync" operation');
    });

    test('scaffold-locale and sync fail loud when postPath is relative or escapes the surfdash root', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-escape');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root);
        // Absolute but `..`-escaping: resolves outside the checkout even though it carries /zh/.
        const escaping = join(root, '..', 'escaped', 'zh', '20260906-post', 'index.md');
        const relative = 'content/posts/articles/zh/20260906-post/index.md';

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const relativeScaffold = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: relative, target: 'en' },
            });
            expect(relativeScaffold.ok).toBe(false);
            expect(relativeScaffold.error).toContain('must be an absolute path inside the surfdash checkout');
            const relativeSync = await transport.publish({
                content: unusedContent,
                options: { operation: 'sync', postPath: `./${relative}` },
            });
            expect(relativeSync.ok).toBe(false);
            expect(relativeSync.error).toContain('must be an absolute path inside the surfdash checkout');
            const escapeScaffold = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: escaping, target: 'en' },
            });
            expect(escapeScaffold.ok).toBe(false);
            expect(escapeScaffold.error).toContain('must resolve inside the surfdash checkout');
            const escapeSync = await transport.publish({
                content: unusedContent,
                options: { operation: 'sync', postPath: escaping },
            });
            expect(escapeSync.ok).toBe(false);
            expect(escapeSync.error).toContain('must resolve inside the surfdash checkout');
            // Fail-loud happened before any spawn: the in-checkout zh post is untouched.
            expect(existsSync(zhPostPath)).toBe(true);
            expect(existsSync(join(root, 'sync-log.txt'))).toBe(false);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale fails loud on a missing post and when sd translate exits non-zero', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-sd-fail');
        await writeSurfdashFixture(root, { sdExit: 3 });
        const zhPostPath = await writeFixtureZhPost(root);

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const missing = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: join(root, 'nope', 'index.md'), target: 'en' },
            });
            expect(missing.ok).toBe(false);
            expect(missing.error).toContain('options.postPath does not exist');
            const failed = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: zhPostPath, target: 'ja' },
            });
            expect(failed.ok).toBe(false);
            expect(failed.error).toContain('sd translate failed (exit 3)');
            expect(failed.error).toContain('sd translate exploded');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale fails loud when postPath has no /zh/ segment', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-nonzh');
        await writeSurfdashFixture(root);
        const enPostPath = join(root, 'content', 'posts', 'articles', 'en', '20260906-post', 'index.md');
        await mkdir(dirname(enPostPath), { recursive: true });
        await writeFile(enPostPath, '---\ntitle: en\n---\n\nBody\n', 'utf-8');

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: enPostPath, target: 'en' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('/zh/');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('sync returns a fail Result with stderr when the publish-orchestrator exits non-zero', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-fixture-sync-fail');
        await writeSurfdashFixture(root, { syncExit: 1 });
        const zhPostPath = await writeFixtureZhPost(root);

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const result = await transport.publish({
                content: unusedContent,
                options: { operation: 'sync', postPath: zhPostPath },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('publish-orchestrator sync failed (exit 1)');
            expect(result.error).toContain('orchestrator sync exploded');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('scaffold-locale and sync fail loud when no surfdash root resolves', async () => {
        const prevRoot = process.env.SURFDASH_ROOT;
        const prevBin = process.env.POSTSURFING_BIN;
        delete process.env.SURFDASH_ROOT;
        delete process.env.POSTSURFING_BIN;
        try {
            const transport = new PostsurfingFileCliTransport();
            const scaffold = await transport.publish({
                content: unusedContent,
                options: { operation: 'scaffold-locale', postPath: '/tmp/x/index.md', target: 'en' },
            });
            expect(scaffold.ok).toBe(false);
            expect(scaffold.error).toContain('SURFDASH_ROOT is required');
            const sync = await transport.publish({
                content: unusedContent,
                options: { operation: 'sync', postPath: '/tmp/x/index.md' },
            });
            expect(sync.ok).toBe(false);
            expect(sync.error).toContain('SURFDASH_ROOT is required');
        } finally {
            if (prevRoot !== undefined) process.env.SURFDASH_ROOT = prevRoot;
            if (prevBin !== undefined) process.env.POSTSURFING_BIN = prevBin;
        }
    });

    test('explicit operation publish routes to the postsurfing publish path unchanged', async () => {
        const tmpDir = join(process.cwd(), '.tmp-surfdash-op-publish');
        await rm(tmpDir, { recursive: true, force: true });
        await mkdir(tmpDir, { recursive: true });
        const mockBin = join(tmpDir, 'postsurfing');
        await writeFile(
            mockBin,
            readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'),
            'utf-8',
        );
        await Bun.spawn(['chmod', '+x', mockBin]).exited;

        process.env.POSTSURFING_BIN = mockBin;
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = { title: 'Router Publish', body: 'Body', format: 'markdown' };
            const result = await transport.publish({ content, options: { operation: 'publish' } });
            expect(result.ok).toBe(true);
            expect(result.target).toBe('surfdash');
            expect(typeof result.metadata?.postPath).toBe('string');
            expect(existsSync(result.metadata?.postPath as string)).toBe(true);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('processPublishIO forwards top-level input options to the transport (scaffold via --in JSON)', async () => {
        const root = join(process.cwd(), '.tmp-surfdash-io-options');
        await writeSurfdashFixture(root);
        const zhPostPath = await writeFixtureZhPost(root);
        const draftPath = join(root, 'content', 'posts', 'articles', 'ja', '20260906-post', 'index.md');

        const inPath = join(root, 'input-content.json');
        const outPath = join(root, 'output-result.json');
        const input = {
            title: 'zh post',
            body: '正文',
            format: 'markdown',
            options: { operation: 'scaffold-locale', postPath: zhPostPath, target: 'ja' },
        };
        await writeFile(inPath, JSON.stringify(input), 'utf-8');

        process.env.SURFDASH_ROOT = root;
        try {
            await processPublishIO(inPath, outPath); // default transport — no fake env
            const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(result.ok).toBe(true);
            expect(result.metadata?.draftPath).toBe(draftPath);
            expect(existsSync(draftPath)).toBe(true);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    test('withEmdashTokenHint maps expired-token errors to the config fix', () => {
        expect(withEmdashTokenHint('sync failed: API error 401: {"error":{"code":"INVALID_TOKEN"}}')).toContain(
            '~/.config/kk/config.yaml',
        );
        expect(withEmdashTokenHint('some other failure')).toBe('some other failure');
    });

    test('cliErrorText concatenates both streams so a stdout-only 401 still triggers the hint', () => {
        const spawned = {
            exitCode: 1,
            stdout: '❌ Orchestrator error: API error 401: INVALID_TOKEN',
            stderr: '✗ sync_cms/shell exited with 1',
        };
        expect(withEmdashTokenHint(spawned.stderr + spawned.stdout)).toContain('regenerate the EmDash token');
    });

    test('pushPostGit commits and pushes only the post path to main', async () => {
        const base = join(process.cwd(), `.tmp-sdpush-${Date.now()}`);
        await mkdir(base, { recursive: true });
        const origin = join(base, 'origin.git');
        const work = join(base, 'work');
        const run = async (cmd: string[], cwd: string): Promise<void> => {
            const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
            const [code, , err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${err}`);
        };
        try {
            await run(['git', 'init', '--bare', '-b', 'main', origin], base);
            await run(['git', 'init', '-b', 'main', work], base);
            await run(['git', 'config', 'user.email', 'test@test'], work);
            await run(['git', 'config', 'user.name', 'test'], work);
            await writeFile(join(work, 'seed.md'), 'seed');
            await run(['git', 'add', '.'], work);
            await run(['git', 'commit', '-m', 'seed'], work);
            await run(['git', 'remote', 'add', 'origin', origin], work);
            await run(['git', 'push', '-u', 'origin', 'main'], work);

            // A staged decoy must not ride along in the publish commit (pathspec commit).
            await writeFile(join(work, 'decoy.md'), 'decoy');
            await run(['git', 'add', 'decoy.md'], work);
            const postRel = join('content', 'posts', 'articles', 'zh', '20260912-x');
            await mkdir(join(work, postRel), { recursive: true });
            await writeFile(join(work, postRel, 'index.md'), 'post');

            const outcome = await pushPostGit(work, postRel, 'content: test');
            expect(outcome.ok).toBe(true);
            if (outcome.ok) expect(outcome.hash.length).toBeGreaterThan(3);
            const pushedSubject = await new Response(
                Bun.spawn(['git', '--git-dir', origin, 'log', '--format=%s', '-1', 'main']).stdout,
            ).text();
            expect(pushedSubject.trim()).toBe('content: test');
            const pushedTree = await new Response(
                Bun.spawn(['git', '--git-dir', origin, 'ls-tree', '-r', '--name-only', 'main']).stdout,
            ).text();
            expect(pushedTree).toContain('index.md');
            expect(pushedTree).not.toContain('decoy');
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });

    test('pushPostGit treats an already-committed, already-pushed post as success', async () => {
        const base = join(process.cwd(), `.tmp-sdpush-${Date.now()}`);
        await mkdir(base, { recursive: true });
        const origin = join(base, 'origin.git');
        const work = join(base, 'work');
        const run = async (cmd: string[], cwd: string): Promise<void> => {
            const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
            const [code, , err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${err}`);
        };
        try {
            await run(['git', 'init', '--bare', '-b', 'main', origin], base);
            await run(['git', 'init', '-b', 'main', work], base);
            await run(['git', 'config', 'user.email', 'test@test'], work);
            await run(['git', 'config', 'user.name', 'test'], work);
            const postRel = join('content', 'posts', 'articles', 'zh', '20260912-x');
            await mkdir(join(work, postRel), { recursive: true });
            await writeFile(join(work, postRel, 'index.md'), 'post');
            await run(['git', 'add', '.'], work);
            await run(['git', 'commit', '-m', 'seed'], work);
            await run(['git', 'remote', 'add', 'origin', origin], work);
            await run(['git', 'push', '-u', 'origin', 'main'], work);

            const outcome = await pushPostGit(work, postRel, 'content: retry');
            expect(outcome.ok).toBe(true);
            if (outcome.ok) expect(outcome.hash.length).toBeGreaterThan(3);
            const pushedSubject = await new Response(
                Bun.spawn(['git', '--git-dir', origin, 'log', '--format=%s', '-1', 'main']).stdout,
            ).text();
            expect(pushedSubject.trim()).toBe('seed');
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });

    test('pushPostGit refuses to push from a non-main branch', async () => {
        const base = join(process.cwd(), `.tmp-sdpush-branch-${Date.now()}`);
        await mkdir(base, { recursive: true });
        const work = join(base, 'work');
        const run = async (cmd: string[], cwd: string): Promise<void> => {
            const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
            const [code, , err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${err}`);
        };
        try {
            await run(['git', 'init', '-b', 'main', work], base);
            await run(['git', 'config', 'user.email', 'test@test'], work);
            await run(['git', 'config', 'user.name', 'test'], work);
            await writeFile(join(work, 'seed.md'), 'seed');
            await run(['git', 'add', '.'], work);
            await run(['git', 'commit', '-m', 'seed'], work);
            await run(['git', 'checkout', '-b', 'feature'], work);

            const outcome = await pushPostGit(work, 'seed.md', 'msg');
            expect(outcome.ok).toBe(false);
            if (!outcome.ok) expect(outcome.error).toContain("not 'main'");
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });

    test('awaitArticleLive resolves true once the URL serves 2xx and false on timeout', async () => {
        const live = Bun.serve({ port: 0, fetch: () => new Response('ok') });
        const never = Bun.serve({ port: 0, fetch: () => new Response('nope', { status: 404 }) });
        try {
            expect(await awaitArticleLive(`http://localhost:${live.port}/`, 2_000, 10)).toBe(true);
            expect(await awaitArticleLive(`http://localhost:${never.port}/`, 80, 10)).toBe(false);
        } finally {
            live.stop(true);
            never.stop(true);
        }
    });
});

describe('processPublishIO invalid input (R7)', () => {
    const cases: Array<{ name: string; payload: string }> = [
        { name: 'malformed JSON', payload: '{not json' },
        { name: 'a schema-invalid body', payload: '{"body": 42}' },
    ];

    for (const { name, payload } of cases) {
        test(`${name} writes an ok:false Result and rejects`, async () => {
            const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-r7');
            await mkdir(tmpDir, { recursive: true });
            const inPath = join(tmpDir, 'input.json');
            // A nested output dir also proves ensureDir runs on the failure path (AC7c).
            const outPath = join(tmpDir, 'nested', 'result.json');
            const origRoot = process.env.SURFDASH_ROOT;
            try {
                delete process.env.SURFDASH_ROOT;
                await writeFile(inPath, payload, 'utf-8');
                await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/Invalid Content input:/);
                expect(existsSync(outPath)).toBe(true);
                const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
                expect(result.ok).toBe(false);
                expect(result.error?.startsWith('Invalid Content input:')).toBe(true);
            } finally {
                if (origRoot !== undefined) process.env.SURFDASH_ROOT = origRoot;
                else delete process.env.SURFDASH_ROOT;
                await rm(tmpDir, { recursive: true, force: true });
            }
        });
    }
});

describe('normalizeLocaleFrontmatter (R3)', () => {
    test('rewrites only the frontmatter head and preserves the body byte-for-byte', () => {
        // The defect dropped every empty line in the WHOLE document (the body included), which is
        // the sync corruption. The rewrite must be frontmatter-only.
        const input =
            '---\ntitle: T\ncanonical: https://x/zh/p\ndraft: true\n---\n\nPara one.\n\nPara two.\n\n```ts\na();\n\nb();\n```\n';
        const expected = '---\ntitle: T\ndraft: false\n---\n\nPara one.\n\nPara two.\n\n```ts\na();\n\nb();\n```\n';
        expect(normalizeLocaleFrontmatter(input)).toBe(expected);
    });

    test('returns text without leading frontmatter unchanged', () => {
        const input = 'No frontmatter here.\n\nSecond para.\n';
        expect(normalizeLocaleFrontmatter(input)).toBe(input);
    });

    test('returns an unterminated frontmatter unchanged', () => {
        const input = '---\ntitle: T\ndraft: true\n';
        expect(normalizeLocaleFrontmatter(input)).toBe(input);
    });
});

describe('path-derived metadata validation (R4)', () => {
    const mockBin = async (dir: string): Promise<string> => {
        const bin = join(dir, 'postsurfing');
        await writeFile(bin, readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'), 'utf-8');
        await Bun.spawn(['chmod', '+x', bin]).exited;
        return bin;
    };

    const withRoot = async (
        tmpDir: string,
        metadata: Record<string, unknown>,
        locale?: string,
    ): Promise<Awaited<ReturnType<PostsurfingFileCliTransport['publish']>>> => {
        process.env.POSTSURFING_BIN = await mockBin(tmpDir);
        process.env.SURFDASH_ROOT = tmpDir;
        if (locale !== undefined) process.env.SURFDASH_LOCALE = locale;
        const content: Content = {
            title: 'Daily AI',
            body: '# Daily AI\n\nBody.',
            format: 'markdown',
            metadata,
        };
        return new PostsurfingFileCliTransport().publish({ content });
    };

    test('(a) a non-YYYYMMDD runDate is rejected and writes nothing under the articles tree', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-r4-rundate');
        await mkdir(tmpDir, { recursive: true });
        const orig = { bin: process.env.POSTSURFING_BIN, root: process.env.SURFDASH_ROOT };
        try {
            const result = await withRoot(tmpDir, { runDate: '../../../../tmp/evil' });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('runDate');
            // The escape never created a post directory (this was the reproduced escape).
            expect(existsSync(join(tmpDir, 'content', 'posts', 'articles', 'zh'))).toBe(false);
        } finally {
            if (orig.bin !== undefined) process.env.POSTSURFING_BIN = orig.bin;
            else delete process.env.POSTSURFING_BIN;
            if (orig.root !== undefined) process.env.SURFDASH_ROOT = orig.root;
            else delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('(b) a traversing SURFDASH_LOCALE is rejected', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-r4-locale');
        await mkdir(tmpDir, { recursive: true });
        const orig = {
            bin: process.env.POSTSURFING_BIN,
            root: process.env.SURFDASH_ROOT,
            locale: process.env.SURFDASH_LOCALE,
        };
        try {
            const result = await withRoot(tmpDir, { runDate: '20260904' }, '../../x');
            expect(result.ok).toBe(false);
            // The zh/en/ja allowlist (added for the locale-prefix URL fix) now
            // rejects traversal locales before the path-escape check runs.
            expect(result.error).toContain('SURFDASH_LOCALE');
        } finally {
            if (orig.bin !== undefined) process.env.POSTSURFING_BIN = orig.bin;
            else delete process.env.POSTSURFING_BIN;
            if (orig.root !== undefined) process.env.SURFDASH_ROOT = orig.root;
            else delete process.env.SURFDASH_ROOT;
            if (orig.locale !== undefined) process.env.SURFDASH_LOCALE = orig.locale;
            else delete process.env.SURFDASH_LOCALE;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('(b2) en publishes at the site root — no /en prefix (surfdash localePathPrefix)', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-en-url');
        await mkdir(tmpDir, { recursive: true });
        const orig = {
            bin: process.env.POSTSURFING_BIN,
            root: process.env.SURFDASH_ROOT,
            locale: process.env.SURFDASH_LOCALE,
        };
        try {
            // en: localePathPrefix is "" — /en/posts/… 404s on the deployed site.
            const en = await withRoot(tmpDir, { runDate: '20260904' }, 'en');
            expect(en.ok).toBe(true);
            if (en.ok) expect(en.url).toBe('https://surfing.salty.vip/posts/20260904-daily-ai');
            // zh/ja keep the /<locale> prefix.
            const zh = await withRoot(tmpDir, { runDate: '20260904' }, 'zh');
            expect(zh.ok).toBe(true);
            if (zh.ok) expect(zh.url).toBe('https://surfing.salty.vip/zh/posts/20260904-daily-ai');
        } finally {
            if (orig.bin !== undefined) process.env.POSTSURFING_BIN = orig.bin;
            else delete process.env.POSTSURFING_BIN;
            if (orig.root !== undefined) process.env.SURFDASH_ROOT = orig.root;
            else delete process.env.SURFDASH_ROOT;
            if (orig.locale !== undefined) process.env.SURFDASH_LOCALE = orig.locale;
            else delete process.env.SURFDASH_LOCALE;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test.each([
        ['(c) a non-image coverImage extension', 'secret.txt'],
        ['(d) a coverImage with no extension', 'cover'],
    ])('%s is rejected before any asset is written', async (_label, name) => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-surfdash-r4-cover');
        await mkdir(tmpDir, { recursive: true });
        const orig = { bin: process.env.POSTSURFING_BIN, root: process.env.SURFDASH_ROOT };
        try {
            const secret = join(tmpDir, name);
            await writeFile(secret, 'not-an-image', 'utf-8');
            const result = await withRoot(tmpDir, { runDate: '20260904', coverImage: secret });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('coverImage');
            expect(existsSync(join(tmpDir, 'content', 'posts', 'articles', 'zh', '20260904-post', 'assets'))).toBe(
                false,
            );
        } finally {
            if (orig.bin !== undefined) process.env.POSTSURFING_BIN = orig.bin;
            else delete process.env.POSTSURFING_BIN;
            if (orig.root !== undefined) process.env.SURFDASH_ROOT = orig.root;
            else delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('surfdash-pub frontmatter tags (2026-10-12)', () => {
    test('drops tags that slugify to nothing and collapses duplicates', () => {
        const markdown = mapContentToSurfingMarkdown({
            title: 'tag case',
            body: 'Body.',
            format: 'markdown',
            metadata: { tags: ['ai-news', 'AI', 'ai', '硬件发布', '   ', 'IPO'] },
        });
        const frontmatter = markdown.split('---')[1] ?? '';
        const parsed = Bun.YAML.parse(frontmatter) as { tags: string[] };
        // `硬件发布` slugifies to '' (non-ASCII), `AI`/`ai` collapse to one slug.
        expect(parsed.tags).toEqual(['ai-news', 'ai', 'ipo']);
    });

    test('normalizeTag and mapContentToSurfingMarkdown preserve sub-category:<slug> prefix and support metadata.subCategory', () => {
        expect(normalizeTag('sub-category:ai-daily')).toBe('sub-category:ai-daily');
        expect(normalizeTag('  Sub-Category :  AI Daily  ')).toBe('sub-category:ai-daily');
        expect(normalizeTag('sub-category:')).toBe('');
        expect(normalizeTag('sub-category: 硬件')).toBe('');

        const markdown = mapContentToSurfingMarkdown({
            title: 'daily post',
            body: 'Body.',
            format: 'markdown',
            metadata: {
                tags: ['ai-news', 'sub-category:ai-daily'],
                subCategory: 'ai-daily',
            },
        });
        const frontmatter = markdown.split('---')[1] ?? '';
        const parsed = Bun.YAML.parse(frontmatter) as { tags: string[] };
        expect(parsed.tags).toEqual(['ai-news', 'sub-category:ai-daily']);
    });
});

describe('surfdash-pub post-patch (2026-10-12 boundary move from the kk stage)', () => {
    const post = (root: string, locale: string): string =>
        join(root, 'content', 'posts', 'articles', locale, '20261011-post', 'index.md');

    async function withTree<T>(fn: (root: string, localCover: string) => Promise<T>): Promise<T> {
        const root = await mkdtemp(join(tmpdir(), 'sd-patch-'));
        const localCover = join(root, 'cover.png');
        await writeFile(localCover, 'png-bytes');
        for (const locale of ['zh', 'en']) {
            await mkdir(dirname(post(root, locale)), { recursive: true });
            await writeFile(
                post(root, locale),
                `---\ntitle: T\npublishDate: '2026-10-11'\nimage: ./assets/cover.png\n---\n\nBody line\nimage: keep-me\n`,
            );
        }
        try {
            return await fn(root, localCover);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    }

    test('localeIndexPath swaps the last /zh/ segment and refuses a path without one', () => {
        const zh = '/sd/content/posts/articles/zh/slug/index.md';
        expect(localeIndexPath(zh, 'zh')).toBe(zh);
        expect(localeIndexPath(zh, 'en')).toBe('/sd/content/posts/articles/en/slug/index.md');
        expect(localeIndexPath(zh, 'ja')).toBe('/sd/content/posts/articles/ja/slug/index.md');
        expect(localeIndexPath('/sd/elsewhere/index.md', 'en')).toBeUndefined();
    });

    test('upsertFrontmatterKey rewrites folded scalars and escapes quotes without expanding $&', () => {
        const md = '---\ntitle: T\nog_image: >-\n  https://old.example/x.png\n---\n\nimage: keep-me\n';
        const next = upsertFrontmatterKey(md, 'og_image', "https://cdn/it's-$&-x.png");
        expect(next).toContain("og_image: 'https://cdn/it''s-$&-x.png'");
        expect(next).not.toContain('https://old.example');
        expect(next).toContain('image: keep-me');
        // An absent key lands after publishDate, inside the frontmatter only.
        const inserted = upsertFrontmatterKey('---\ntitle: T\npublishDate: X\n---\nBody\n', 'image', 'u');
        expect(inserted).toBe("---\ntitle: T\npublishDate: X\nimage: 'u'\n---\nBody\n");
    });

    test("crossLinkFor names each locale's canonical series (2026-10-23 retired-name regression)", () => {
        expect(crossLinkFor('zh', '2026-10-23', 'https://pod.example/i/9')).toBe(
            '🎧 本期已同步制作为播客节目，[点击收听《每日AI乱炖 · 2026-10-23》](https://pod.example/i/9)。',
        );
        expect(crossLinkFor('en', '2026-10-23', 'https://pod.example/i/9')).toBe(
            '🎧 This episode is also available as a podcast: [listen to Daily AI Stew · 2026-10-23](https://pod.example/i/9).',
        );
        expect(crossLinkFor('ja', '2026-10-23', 'https://pod.example/i/9')).toBe(
            '🎧 本エピソードはポッドキャストでも配信中：[デイリーAIシチュー · 2026-10-23 を聴く](https://pod.example/i/9)。',
        );
    });

    test('patchPostFiles replaces a stale 🎧 cross-link line instead of appending a second one', async () => {
        await withTree(async (root, localCover) => {
            // A previous run left the en cross-link carrying the zh series name (2026-10-23 shape):
            // the URL is present, so the old append-only logic kept the retired name forever.
            const stale =
                '🎧 This episode is also available as a podcast: [listen to 每日AI乱炖 · 2026-10-11](https://pod.example/i/1).';
            const enPath = post(root, 'en');
            await writeFile(
                enPath,
                `---\ntitle: T\npublishDate: '2026-10-11'\nimage: ./assets/cover.png\n---\n\nBody line\n\n${stale}\n`,
            );
            const outcome = await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: 'https://cdn.example/cover.png',
                showNotesUrl: 'https://pod.example/i/1',
                localCover,
                dateIso: '2026-10-11',
            });
            const en = await readFile(enPath, 'utf-8');
            expect(en).toContain('[listen to Daily AI Stew · 2026-10-11](https://pod.example/i/1)');
            expect(en).not.toContain('每日AI乱炖');
            expect(en.match(/pod\.example\/i\/1/g)).toHaveLength(1);
            expect(en.match(/🎧/g)).toHaveLength(1);
            expect(outcome.changed).toBe(2); // zh gains its cross-link; en swaps the stale line

            // A prose line that merely mentions the URL is left alone — only 🎧 lines refresh.
            const prose = 'Earlier coverage: https://pod.example/i/2 is worth a listen.';
            await writeFile(
                enPath,
                `---\ntitle: T\n---\n\n${prose}\n\n🎧 This episode is also available as a podcast: [listen to Daily AI Stew · 2026-10-11](https://pod.example/i/2).\n`,
            );
            await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: '',
                showNotesUrl: 'https://pod.example/i/2',
                localCover,
                dateIso: '2026-10-11',
            });
            expect(await readFile(enPath, 'utf-8')).toContain(prose);
        });
    });

    test('patchPostFiles writes the cover URL and the cross-link for every published locale', async () => {
        await withTree(async (root, localCover) => {
            const outcome = await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: 'https://cdn.example/cover.png',
                showNotesUrl: 'https://pod.example/i/1',
                localCover,
                dateIso: '2026-10-11',
            });
            expect(outcome.slug).toBe('20261011-post');
            expect(outcome.changed).toBe(2);
            expect(outcome.absent).toEqual(['ja']);
            expect(outcome.images).toEqual({
                zh: 'https://cdn.example/cover.png',
                en: 'https://cdn.example/cover.png',
            });
            const zh = await readFile(post(root, 'zh'), 'utf-8');
            expect(zh).toContain("image: 'https://cdn.example/cover.png'");
            expect(zh).toContain('[点击收听《每日AI乱炖 · 2026-10-11》](https://pod.example/i/1)');
            const en = await readFile(post(root, 'en'), 'utf-8');
            expect(en).toContain('[listen to Daily AI Stew · 2026-10-11](https://pod.example/i/1)');

            // Idempotent: a second pass changes nothing and writes nothing.
            const again = await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: 'https://cdn.example/cover.png',
                showNotesUrl: 'https://pod.example/i/1',
                localCover,
                dateIso: '2026-10-11',
            });
            expect(again.changed).toBe(0);
            expect(again.written).toEqual([]);
        });
    });

    test('patchPostFiles adds the full-series-name listen link to zh, en and ja once the episode is published', async () => {
        await withTree(async (root, localCover) => {
            const jaPath = post(root, 'ja');
            await mkdir(dirname(jaPath), { recursive: true });
            await writeFile(jaPath, `---\ntitle: T\npublishDate: '2026-10-23'\n---\n\n本文\n`);
            const url = 'https://podcast.salty.vip/i/daily-ai-2026-10-23/';
            const outcome = await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: '',
                showNotesUrl: url,
                localCover,
                dateIso: '2026-10-23',
            });
            expect(outcome.absent).toEqual([]);
            expect(await readFile(post(root, 'zh'), 'utf-8')).toContain(
                `[点击收听《每日AI乱炖 · 2026-10-23》](${url})`,
            );
            const en = await readFile(post(root, 'en'), 'utf-8');
            expect(en).toContain(`[listen to Daily AI Stew · 2026-10-23](${url})`);
            expect(en).not.toMatch(/listen to AI Stew/);
            expect(await readFile(jaPath, 'utf-8')).toContain(`[デイリーAIシチュー · 2026-10-23 を聴く](${url})`);
        });
    });

    test('patchPostFiles copies the local cover when no podcast cover URL exists', async () => {
        await withTree(async (root, localCover) => {
            // Strip the pre-existing `image:` so the fallback branch is reachable.
            for (const locale of ['zh', 'en']) {
                const md = await readFile(post(root, locale), 'utf-8');
                await writeFile(post(root, locale), md.replace(/^image:.*$/m, '').replace(/^og_image:.*$/m, ''));
            }
            const outcome = await patchPostFiles({
                postPath: post(root, 'zh'),
                coverUrl: '',
                showNotesUrl: '',
                localCover,
                dateIso: '2026-10-11',
            });
            const asset = join(dirname(post(root, 'zh')), 'assets', 'cover.png');
            expect(existsSync(asset)).toBe(true);
            expect(outcome.written).toContain(asset);
            expect(await readFile(post(root, 'zh'), 'utf-8')).toContain("image: './assets/cover.png'");
        });
    });

    test('patchPostFiles rejects a coverUrl that is not an absolute https:// URL', async () => {
        await withTree(async (root, localCover) => {
            await expect(
                patchPostFiles({
                    postPath: post(root, 'zh'),
                    coverUrl: 'http://insecure.example/cover.png',
                    showNotesUrl: '',
                    localCover,
                    dateIso: '2026-10-11',
                }),
            ).rejects.toThrow('coverUrl must be an absolute https:// URL');

            await expect(
                patchPostFiles({
                    postPath: post(root, 'zh'),
                    coverUrl: './assets/cover.png',
                    showNotesUrl: '',
                    localCover,
                    dateIso: '2026-10-11',
                }),
            ).rejects.toThrow('coverUrl must be an absolute https:// URL');
        });
    });

    test('patchPostFiles throws naming the locale when coverUrl is empty, frontmatter has no image key, and localCover is missing', async () => {
        await withTree(async (root, _localCover) => {
            for (const locale of ['zh', 'en']) {
                const md = await readFile(post(root, locale), 'utf-8');
                await writeFile(post(root, locale), md.replace(/^image:.*$/m, '').replace(/^og_image:.*$/m, ''));
            }
            await expect(
                patchPostFiles({
                    postPath: post(root, 'zh'),
                    coverUrl: '',
                    showNotesUrl: '',
                    localCover: join(root, 'non-existent-cover.png'),
                    dateIso: '2026-10-11',
                }),
            ).rejects.toThrow('zh post has no cover');
        });
    });
});

describe('surfdash-pub patch operation (2026-10-12 boundary move)', () => {
    const RUN_DATE = '20261011';

    const git = (cwd: string, ...args: string[]): { status: number; stdout: string } => {
        const r = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' });
        return { status: r.exitCode ?? 1, stdout: r.stdout.toString() };
    };

    /** A throwaway checkout on `main` with one zh post, plus a stub sync script when `orchestrator` is set. */
    async function setupPatched(
        orchestrator: boolean,
    ): Promise<{ root: string; postPath: string; outPath: string; inPath: string }> {
        const root = await mkdtemp(join(tmpdir(), 'sd-patch-op-'));
        const postDir = join(root, 'content', 'posts', 'articles', 'zh', `${RUN_DATE}-post`);
        await mkdir(postDir, { recursive: true });
        const postPath = join(postDir, 'index.md');
        await writeFile(postPath, `---\ntitle: T\npublishDate: '2026-10-11'\nimage: ./assets/cover.png\n---\n\nBody\n`);
        if (orchestrator) {
            await mkdir(join(root, 'scripts'), { recursive: true });
            await writeFile(join(root, 'scripts', 'publish-orchestrator.ts'), 'process.exit(0);\n');
        }
        git(root, 'init', '-q', '-b', 'main');
        git(root, 'config', 'user.email', 't@t');
        git(root, 'config', 'user.name', 'T');
        git(root, 'add', '-A');
        git(root, 'commit', '-q', '-m', 'init');

        // Create an en sibling with an untracked assets/cover.png (as scaffold-locale produces)
        const enDir = join(root, 'content', 'posts', 'articles', 'en', `${RUN_DATE}-post`);
        await mkdir(join(enDir, 'assets'), { recursive: true });
        await writeFile(
            join(enDir, 'index.md'),
            `---\ntitle: EN\npublishDate: '2026-10-11'\nimage: ./assets/cover.png\n---\n\nEN Body\n`,
        );
        await writeFile(join(enDir, 'assets', 'cover.png'), 'en-cover-bytes');

        const inPath = join(root, 'patch-in.json');
        const outPath = join(root, 'patch-out.json');
        await writeFile(
            inPath,
            JSON.stringify({
                body: '',
                options: {
                    operation: 'patch',
                    postPath,
                    coverUrl: 'https://cdn.example/cover.png',
                    showNotesUrl: 'https://pod.example/i/1',
                    dateIso: '2026-10-11',
                    localCover: join(root, 'cover.png'),
                },
            }),
        );
        return { root, postPath, inPath, outPath };
    }

    test('patches the posts, re-syncs the CMS rows and commits the scoped paths', async () => {
        const fx = await setupPatched(true);
        process.env.SURFDASH_ROOT = fx.root;
        try {
            await processPublishIO(fx.inPath, fx.outPath);
            const result = ResultSchema.parse(JSON.parse(await readFile(fx.outPath, 'utf-8')));
            expect(result.ok, result.error).toBe(true);
            expect(result.message).toContain('patched 2 post(s)');
            expect(result.metadata?.cmsResync).toBe('ok');
            expect(result.metadata?.locales).toEqual(['zh', 'en']);
            expect(result.metadata?.absentLocales).toEqual(['ja']);
            expect(typeof result.metadata?.gitCommit).toBe('string');
            const md = await readFile(fx.postPath, 'utf-8');
            expect(md).toContain("image: 'https://cdn.example/cover.png'");
            expect(md).toContain('点击收听');
            // Committed on main, including the scaffolded en/assets/cover.png so no untracked assets remain.
            expect(git(fx.root, 'log', '-1', '--format=%s').stdout).toContain('cover + podcast cross-link');
            const trackedFiles = git(fx.root, 'ls-tree', '-r', '--name-only', 'HEAD').stdout;
            expect(trackedFiles).toContain(`content/posts/articles/en/${RUN_DATE}-post/assets/cover.png`);
            expect(git(fx.root, 'status', '--porcelain', '--', 'content/posts/articles').stdout.trim()).toBe('');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('reports a failed CMS re-sync while keeping the patched, committed files', async () => {
        const fx = await setupPatched(false); // no orchestrator script → the sync spawn fails
        process.env.SURFDASH_ROOT = fx.root;
        try {
            await expect(processPublishIO(fx.inPath, fx.outPath)).rejects.toThrow('cms re-sync failed');
            const result = ResultSchema.parse(JSON.parse(await readFile(fx.outPath, 'utf-8')));
            expect(result.ok).toBe(false);
            expect(String(result.error)).toContain('cms re-sync failed');
            // `metadata.cmsResync` is what lets the caller treat it as the soft channel it is.
            expect(result.metadata?.cmsResync).toBe('failed');
            expect(await readFile(fx.postPath, 'utf-8')).toContain('https://cdn.example/cover.png');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('refuses a feature branch before writing anything', async () => {
        const fx = await setupPatched(true);
        git(fx.root, 'checkout', '-q', '-b', 'feature');
        const before = git(fx.root, 'rev-parse', 'HEAD').stdout.trim();
        process.env.SURFDASH_ROOT = fx.root;
        try {
            await expect(processPublishIO(fx.inPath, fx.outPath)).rejects.toThrow('not');
            const result = ResultSchema.parse(JSON.parse(await readFile(fx.outPath, 'utf-8')));
            expect(result.ok).toBe(false);
            expect(String(result.error)).toContain('feature');
            expect(await readFile(fx.postPath, 'utf-8')).toContain('./assets/cover.png');
            expect(git(fx.root, 'rev-parse', 'HEAD').stdout.trim()).toBe(before);
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(fx.root, { recursive: true, force: true });
        }
    });

    test('refuses a postPath that escapes the checkout', async () => {
        const fx = await setupPatched(true);
        process.env.SURFDASH_ROOT = fx.root;
        const escaped = join(dirname(fx.root), 'outside', 'index.md');
        await writeFile(fx.inPath, JSON.stringify({ body: '', options: { operation: 'patch', postPath: escaped } }));
        try {
            await expect(processPublishIO(fx.inPath, fx.outPath)).rejects.toThrow('must resolve inside');
            const result = ResultSchema.parse(JSON.parse(await readFile(fx.outPath, 'utf-8')));
            expect(result.ok).toBe(false);
            expect(String(result.error)).toContain('inside the surfdash checkout');
        } finally {
            delete process.env.SURFDASH_ROOT;
            await rm(fx.root, { recursive: true, force: true });
        }
    });
});

/**
 * 2026-10-21/22: three publish days died on `! [rejected] main -> main (fetch first)` because the
 * checkout sat behind a remote another machine had pushed to. The article was written and committed
 * on a stale base, the push was rejected, and the run closed `partial` — with the podcast episode
 * already live. A fast-forward before writing is lossless; a diverged checkout is not ours to fix.
 */
describe('fastForwardToOrigin', () => {
    const gitRun = async (cmd: string[], cwd: string): Promise<string> => {
        const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
        const [code, out, err] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${err}`);
        return out;
    };

    /** A bare origin plus two clones: `work` (the publisher) and `peer` (another machine). */
    async function setupPair(): Promise<{ base: string; origin: string; work: string; peer: string }> {
        const base = join(process.cwd(), `.tmp-ff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        await mkdir(base, { recursive: true });
        const origin = join(base, 'origin.git');
        const work = join(base, 'work');
        await gitRun(['git', 'init', '--bare', '-b', 'main', origin], base);
        for (const dir of [work, join(base, 'peer')]) {
            await gitRun(['git', 'init', '-b', 'main', dir], base);
            await gitRun(['git', 'config', 'user.email', 'test@test'], dir);
            await gitRun(['git', 'config', 'user.name', 'test'], dir);
        }
        const peer = join(base, 'peer');
        await writeFile(join(peer, 'seed.md'), 'seed');
        await gitRun(['git', 'add', '.'], peer);
        await gitRun(['git', 'commit', '-m', 'seed'], peer);
        await gitRun(['git', 'remote', 'add', 'origin', origin], peer);
        await gitRun(['git', 'push', '-u', 'origin', 'main'], peer);
        await gitRun(['git', 'remote', 'add', 'origin', origin], work);
        await gitRun(['git', 'pull', '--quiet', 'origin', 'main'], work);
        return { base, origin, work, peer };
    }

    test('fast-forwards a checkout that is strictly behind, so the next push is accepted', async () => {
        const { base, work, peer } = await setupPair();
        try {
            // The other machine publishes first.
            await writeFile(join(peer, 'remote-post.md'), 'post');
            await gitRun(['git', 'add', '.'], peer);
            await gitRun(['git', 'commit', '-m', 'content: from the other machine'], peer);
            await gitRun(['git', 'push', 'origin', 'main'], peer);
            const behindBefore = (await gitRun(['git', 'rev-parse', 'HEAD'], work)).trim();

            const ff = await fastForwardToOrigin(work);
            expect(ff.ok).toBe(true);
            const headAfter = (await gitRun(['git', 'rev-parse', 'HEAD'], work)).trim();
            expect(headAfter).not.toBe(behindBefore);
            expect(headAfter).toBe((await gitRun(['git', 'rev-parse', 'origin/main'], work)).trim());

            // With the base current, the publish push no longer has to be rejected.
            const postRel = join('content', 'posts', 'articles', 'zh', '20261022-x');
            await mkdir(join(work, postRel), { recursive: true });
            await writeFile(join(work, postRel, 'index.md'), 'post');
            const outcome = await pushPostGit(work, postRel, 'content: 20261022');
            expect(outcome.ok).toBe(true);
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });

    test('refuses a diverged checkout and names both counts instead of rewriting history', async () => {
        const { base, origin, work, peer } = await setupPair();
        try {
            for (const [dir, file, message] of [
                [peer, 'remote-post.md', 'content: remote'],
                [work, 'local-post.md', 'content: local'],
            ] as const) {
                await writeFile(join(dir, file), 'x');
                await gitRun(['git', 'add', '.'], dir);
                await gitRun(['git', 'commit', '-m', message], dir);
            }
            await gitRun(['git', 'push', 'origin', 'main'], peer);
            const headBefore = (await gitRun(['git', 'rev-parse', 'HEAD'], work)).trim();

            const ff = await fastForwardToOrigin(work);
            expect(ff.ok).toBe(false);
            if (!ff.ok) expect(ff.error).toContain('diverged from origin/main (1 local, 1 remote commit(s))');
            // Nothing was rewritten: the local commit is still HEAD and still unpushed.
            expect((await gitRun(['git', 'rev-parse', 'HEAD'], work)).trim()).toBe(headBefore);
            const remoteLog = await gitRun(['git', '--git-dir', origin, 'log', '--format=%s', '-1', 'main'], base);
            expect(remoteLog.trim()).toBe('content: remote');
        } finally {
            await rm(base, { recursive: true, force: true });
        }
    });
});

describe('publishPost cover validation (Item 2)', () => {
    const mockBin = async (dir: string): Promise<string> => {
        const bin = join(dir, 'postsurfing');
        await writeFile(bin, readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'), 'utf-8');
        await Bun.spawn(['chmod', '+x', bin]).exited;
        return bin;
    };

    test('fails before writing anything if metadata.coverImage is a string but does not exist', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-cover-missing');
        await mkdir(tmpDir, { recursive: true });
        process.env.POSTSURFING_BIN = await mockBin(tmpDir);
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = {
                title: 'No Cover File',
                body: '正文',
                format: 'markdown',
                metadata: {
                    coverImage: join(tmpDir, 'non-existent-cover.png'),
                },
            };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('metadata.coverImage not found:');
            expect(result.metadata?.deliveryState).toBe('not-sent');
            expect(existsSync(join(tmpDir, 'content', 'posts', 'articles', 'zh'))).toBe(false);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test.each([
        ['tags', { tags: ['sub-category:ai-daily'] }],
        ['keywords', { keywords: ['sub-category:ai-daily'] }],
        ['subCategory', { subCategory: 'ai-daily' }],
    ])('digest post marked by %s fails if it has no cover image', async (_label, metadata) => {
        const tmpDir = join(process.cwd(), `.works/tmp/test-digest-nocover-${_label}`);
        await mkdir(tmpDir, { recursive: true });
        process.env.POSTSURFING_BIN = await mockBin(tmpDir);
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = {
                title: 'Digest Without Cover',
                body: '正文',
                format: 'markdown',
                metadata,
            };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(false);
            expect(result.error).toBe('digest post has no cover image (metadata.coverImage)');
            expect(existsSync(join(tmpDir, 'content', 'posts', 'articles', 'zh'))).toBe(false);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('non-digest posts without coverImage keep working', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-nondigest-nocover');
        await mkdir(tmpDir, { recursive: true });
        process.env.POSTSURFING_BIN = await mockBin(tmpDir);
        process.env.SURFDASH_ROOT = tmpDir;
        try {
            const transport = new PostsurfingFileCliTransport();
            const content: Content = {
                title: 'Ordinary Article',
                body: '正文',
                format: 'markdown',
                metadata: { tags: ['tech', 'programming'] },
            };
            const result = await transport.publish({ content });
            expect(result.ok).toBe(true);
        } finally {
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('digest frontmatter check wiring in publishPost and syncPost (Item 4)', () => {
    const mockBin = async (dir: string): Promise<string> => {
        const bin = join(dir, 'postsurfing');
        await writeFile(bin, readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'), 'utf-8');
        await Bun.spawn(['chmod', '+x', bin]).exited;
        return bin;
    };

    test('publishPost fails when refined digest frontmatter violates contract, passes when warn env is set', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-publish-digest-gate');
        await mkdir(tmpDir, { recursive: true });
        process.env.POSTSURFING_BIN = await mockBin(tmpDir);
        process.env.SURFDASH_ROOT = tmpDir;
        process.env.FAKE_POSTSURFING_BAD_DIGEST = '1';

        const coverSrc = join(tmpDir, 'valid-cover.png');
        await writeFile(coverSrc, 'fake-png-bytes');

        const content: Content = {
            title: 'Daily Digest',
            body: '# Daily Digest\n\n正文。',
            format: 'markdown',
            metadata: {
                runDate: '20261023',
                subCategory: 'ai-daily',
                coverImage: coverSrc,
            },
        };

        try {
            const transport = new PostsurfingFileCliTransport();
            const failResult = await transport.publish({ content });
            expect(failResult.ok).toBe(false);
            expect(failResult.error).toContain('digest frontmatter check failed:');

            // With warn env, logs warning and proceeds
            process.env.SURFDASH_DIGEST_CHECK = 'warn';
            const warnResult = await transport.publish({ content });
            expect(warnResult.ok).toBe(true);
        } finally {
            delete process.env.FAKE_POSTSURFING_BAD_DIGEST;
            delete process.env.SURFDASH_DIGEST_CHECK;
            delete process.env.POSTSURFING_BIN;
            delete process.env.SURFDASH_ROOT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('syncPost fails when synced post has bad digest frontmatter, passes when warn env is set', async () => {
        const root = join(process.cwd(), '.works/tmp/test-sync-digest-gate');
        await writeSurfdashFixture(root);

        // Create a zh post with sub-category:ai-daily and bad digest frontmatter (e.g. date-only title)
        const zhDir = join(root, 'content', 'posts', 'articles', 'zh', '20261023-post');
        await mkdir(zhDir, { recursive: true });
        const zhPostPath = join(zhDir, 'index.md');
        await writeFile(
            zhPostPath,
            '---\ntitle: "每日AI乱炖 · 2026-10-23"\ntags: ["sub-category:ai-daily"]\npublishDate: "2026-10-23"\ndescription: "太短。"\ndraft: false\n---\n\n正文。\n',
            'utf-8',
        );

        process.env.SURFDASH_ROOT = root;
        try {
            const transport = new PostsurfingFileCliTransport();
            const failResult = await transport.publish({
                content: { title: 'unused', body: 'unused', format: 'markdown' },
                options: { operation: 'sync', postPath: zhPostPath },
            });
            expect(failResult.ok).toBe(false);
            expect(failResult.error).toContain('digest frontmatter check failed:');

            process.env.SURFDASH_DIGEST_CHECK = 'warn';
            const warnResult = await transport.publish({
                content: { title: 'unused', body: 'unused', format: 'markdown' },
                options: { operation: 'sync', postPath: zhPostPath },
            });
            expect(warnResult.ok).toBe(true);
        } finally {
            delete process.env.SURFDASH_DIGEST_CHECK;
            delete process.env.SURFDASH_ROOT;
            await rm(root, { recursive: true, force: true });
        }
    });

    describe('surfdash site gate before commit/push', () => {
        interface GateFixture {
            base: string;
            origin: string;
            work: string;
            coverSrc: string;
        }

        const run = async (cmd: string[], cwd: string): Promise<void> => {
            const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
            const [code, , err] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            if (code !== 0) throw new Error(`${cmd.join(' ')} exited ${code}: ${err}`);
        };

        const setupGateFixture = async (name: string): Promise<GateFixture> => {
            const base = join(
                process.cwd(),
                `.works/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            );
            await mkdir(base, { recursive: true });
            const origin = join(base, 'origin.git');
            const work = join(base, 'work');

            await run(['git', 'init', '--bare', '-b', 'main', origin], base);
            await run(['git', 'init', '-b', 'main', work], base);
            await run(['git', 'config', 'user.email', 'test@test'], work);
            await run(['git', 'config', 'user.name', 'test'], work);
            await writeFile(join(work, 'seed.md'), 'seed');
            await run(['git', 'add', '.'], work);
            await run(['git', 'commit', '-m', 'seed'], work);
            await run(['git', 'remote', 'add', 'origin', origin], work);
            await run(['git', 'push', '-u', 'origin', 'main'], work);

            await mkdir(join(work, 'scripts'), { recursive: true });
            await writeFile(
                join(work, 'package.json'),
                JSON.stringify({
                    name: 'fake-surfdash',
                    private: true,
                    scripts: {
                        sd: 'bun scripts/sd.ts',
                        'check:content': 'bun scripts/check-content.ts',
                    },
                }),
                'utf-8',
            );

            const sdScript = `
const argv = process.argv.slice(2);
if (argv[0] === 'seo' && argv[1] === 'listen-link') {
    if (process.env.TEST_SD_LISTEN_BACKFILL_FAIL === '1') {
        console.error('listen-link backfill failed: network error');
        process.exit(1);
    }
    console.log('seo listen-link backfill — 0 linked (written), 0 not-live, 0 already-linked');
    process.exit(0);
}
if (argv[0] === 'check' && argv[1] === 'digest') {
    if (process.env.TEST_SD_CHECK_DIGEST_FAIL === '1') {
        console.error('sd check digest failed: content/posts/articles/zh/20261024-test/index.md: filler sentence detected');
        process.exit(1);
    }
    console.log('sd check digest ok');
    process.exit(0);
}
console.error('unknown sd args: ' + argv.join(' '));
process.exit(1);
`;
            await writeFile(join(work, 'scripts', 'sd.ts'), `${sdScript.trim()}\n`, 'utf-8');

            const checkContentScript = `
if (process.env.TEST_CHECK_CONTENT_FAIL === '1') {
    console.error('check:content error in content/posts/articles/zh/20261024-test/index.md: label mismatch');
    process.exit(1);
}
console.log('check:content ok');
process.exit(0);
`;
            await writeFile(join(work, 'scripts', 'check-content.ts'), `${checkContentScript.trim()}\n`, 'utf-8');

            const bin = join(work, 'postsurfing');
            await writeFile(
                bin,
                readFileSync(join(import.meta.dir, 'fixtures', 'fake-postsufing.ts'), 'utf-8'),
                'utf-8',
            );
            await Bun.spawn(['chmod', '+x', bin]).exited;

            const coverSrc = join(work, 'valid-cover.png');
            await writeFile(coverSrc, 'fake-png-bytes');

            return { base, origin, work, coverSrc };
        };

        const makeContent = (coverSrc: string): Content => ({
            title: 'Test Post',
            body: '# Test Post\n\n正文段落。',
            format: 'markdown',
            metadata: {
                runDate: '20261024',
                subCategory: 'ai-daily',
                coverImage: coverSrc,
            },
        });

        const mockLiveFetch = (): (() => void) => {
            const spy = spyOn(globalThis, 'fetch').mockImplementation(
                (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
            );
            return () => {
                spy.mockRestore();
            };
        };

        test('gate pass -> push happens', async () => {
            const fx = await setupGateFixture('test-gate-pass');
            const restoreFetch = mockLiveFetch();

            process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
            process.env.SURFDASH_ROOT = fx.work;
            process.env.SURFDASH_AUTO_PUSH = '1';
            try {
                const transport = new PostsurfingFileCliTransport();
                const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                expect(result.ok).toBe(true);

                const pushed = await new Response(
                    Bun.spawn(['git', '--git-dir', fx.origin, 'log', '-1', '--format=%s', 'main']).stdout,
                ).text();
                expect(pushed).toContain('daily AI news 20261024');
            } finally {
                restoreFetch();
                delete process.env.POSTSURFING_BIN;
                delete process.env.SURFDASH_ROOT;
                process.env.SURFDASH_AUTO_PUSH = '0';
                await rm(fx.base, { recursive: true, force: true });
            }
        });

        test('sd check digest fails -> no commit/push and error text contains output', async () => {
            const fx = await setupGateFixture('test-sd-fail');
            const restoreFetch = mockLiveFetch();

            process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
            process.env.SURFDASH_ROOT = fx.work;
            process.env.SURFDASH_AUTO_PUSH = '1';
            process.env.TEST_SD_CHECK_DIGEST_FAIL = '1';
            try {
                const transport = new PostsurfingFileCliTransport();
                const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('bun run sd check digest');
                expect(result.error).toContain('filler sentence detected');
                expect(result.error).toContain('failing post: content/posts/articles/zh/20261024-test/index.md');

                const pushed = await new Response(
                    Bun.spawn(['git', '--git-dir', fx.origin, 'log', '-1', '--format=%s', 'main']).stdout,
                ).text();
                expect(pushed.trim()).toBe('seed');
            } finally {
                restoreFetch();
                delete process.env.TEST_SD_CHECK_DIGEST_FAIL;
                delete process.env.POSTSURFING_BIN;
                delete process.env.SURFDASH_ROOT;
                process.env.SURFDASH_AUTO_PUSH = '0';
                await rm(fx.base, { recursive: true, force: true });
            }
        });

        test('check:content fails -> no commit/push and error text contains output', async () => {
            const fx = await setupGateFixture('test-content-fail');
            const restoreFetch = mockLiveFetch();

            process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
            process.env.SURFDASH_ROOT = fx.work;
            process.env.SURFDASH_AUTO_PUSH = '1';
            process.env.TEST_CHECK_CONTENT_FAIL = '1';
            try {
                const transport = new PostsurfingFileCliTransport();
                const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('bun run check:content');
                expect(result.error).toContain('label mismatch');
                expect(result.error).toContain('failing post: content/posts/articles/zh/20261024-test/index.md');

                const pushed = await new Response(
                    Bun.spawn(['git', '--git-dir', fx.origin, 'log', '-1', '--format=%s', 'main']).stdout,
                ).text();
                expect(pushed.trim()).toBe('seed');
            } finally {
                restoreFetch();
                delete process.env.TEST_CHECK_CONTENT_FAIL;
                delete process.env.POSTSURFING_BIN;
                delete process.env.SURFDASH_ROOT;
                process.env.SURFDASH_AUTO_PUSH = '0';
                await rm(fx.base, { recursive: true, force: true });
            }
        });

        test('warn mode -> push happens and warning echoed', async () => {
            const fx = await setupGateFixture('test-gate-warn');
            const restoreFetch = mockLiveFetch();

            process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
            process.env.SURFDASH_ROOT = fx.work;
            process.env.SURFDASH_AUTO_PUSH = '1';
            process.env.TEST_SD_CHECK_DIGEST_FAIL = '1';
            process.env.SURFDASH_DIGEST_CHECK = 'warn';

            const errTarget = createBufferTarget();
            const restore = setDefaultOutputTargets({ stderr: errTarget });
            try {
                const transport = new PostsurfingFileCliTransport();
                const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                expect(result.ok).toBe(true);
                expect(errTarget.text()).toContain('site gate (warn):');
                expect(errTarget.text()).toContain('filler sentence detected');

                const pushed = await new Response(
                    Bun.spawn(['git', '--git-dir', fx.origin, 'log', '-1', '--format=%s', 'main']).stdout,
                ).text();
                expect(pushed).toContain('daily AI news 20261024');
            } finally {
                restore();
                restoreFetch();
                delete process.env.TEST_SD_CHECK_DIGEST_FAIL;
                delete process.env.SURFDASH_DIGEST_CHECK;
                delete process.env.POSTSURFING_BIN;
                delete process.env.SURFDASH_ROOT;
                process.env.SURFDASH_AUTO_PUSH = '0';
                await rm(fx.base, { recursive: true, force: true });
            }
        });

        test('runSiteGate supports off mode and extractFailingPostHint helper', async () => {
            process.env.SURFDASH_DIGEST_CHECK = 'off';
            try {
                const outcome = await runSiteGate('/nonexistent');
                expect(outcome.ok).toBe(true);
            } finally {
                delete process.env.SURFDASH_DIGEST_CHECK;
            }

            expect(extractFailingPostHint('Error in content/posts/articles/zh/slug/index.md: bad')).toBe(
                'content/posts/articles/zh/slug/index.md',
            );
            expect(extractFailingPostHint('Error in posts/articles/en/slug.')).toBe('posts/articles/en/slug');
            expect(extractFailingPostHint('no post path here')).toBeUndefined();
        });

        test('patchPost respects site gate when auto push is enabled', async () => {
            const fx = await setupGateFixture('test-patch-gate');
            process.env.TEST_CHECK_CONTENT_FAIL = '1';
            process.env.SURFDASH_ROOT = fx.work;
            process.env.SURFDASH_AUTO_PUSH = '1';

            const zhPostPath = join(fx.work, 'content', 'posts', 'articles', 'zh', '20261024-post', 'index.md');
            await mkdir(dirname(zhPostPath), { recursive: true });
            await writeFile(
                zhPostPath,
                `---\ntitle: ZH\npublishDate: '2026-10-24'\nimage: ./assets/cover.png\n---\n\nBody\n`,
            );

            await writeFile(join(fx.work, 'scripts', 'publish-orchestrator.ts'), 'process.exit(0);\n');

            const gitRun = async (cmd: string[], cwd: string): Promise<void> => {
                const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
                await proc.exited;
            };
            await gitRun(['git', 'add', '-A'], fx.work);
            await gitRun(['git', 'commit', '-m', 'add-post'], fx.work);
            await gitRun(['git', 'push', 'origin', 'main'], fx.work);

            try {
                const transport = new PostsurfingFileCliTransport();
                const result = await transport.publish({
                    content: { title: 'unused', body: 'unused', format: 'markdown' },
                    options: {
                        operation: 'patch',
                        postPath: zhPostPath,
                        coverUrl: 'https://cdn.example/cover.png',
                        dateIso: '2026-10-24',
                    },
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('bun run check:content');
            } finally {
                delete process.env.TEST_CHECK_CONTENT_FAIL;
                delete process.env.SURFDASH_ROOT;
                process.env.SURFDASH_AUTO_PUSH = '0';
                await rm(fx.base, { recursive: true, force: true });
            }
        });

        describe('surfdash listen-link backfill before site gate/commit', () => {
            test('backfill invoked with exact argv and cwd', async () => {
                const fx = await setupGateFixture('test-backfill-argv');
                const recorderScript = `
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'seo' && argv[1] === 'listen-link') {
    appendFileSync('${join(fx.work, 'backfill-invoked.json')}', JSON.stringify({ argv, cwd: process.cwd() }));
    console.log('seo listen-link backfill — 0 linked (written), 0 not-live, 0 already-linked');
    process.exit(0);
}
process.exit(0);
`;
                await writeFile(join(fx.work, 'scripts', 'sd.ts'), `${recorderScript.trim()}\n`, 'utf-8');

                const backfilled = await runListenLinkBackfill(fx.work);
                expect(backfilled).toEqual([]);

                const raw = await readFile(join(fx.work, 'backfill-invoked.json'), 'utf-8');
                const recorded = JSON.parse(raw);
                expect(recorded.argv).toEqual(['seo', 'listen-link', '--backfill', '--write']);
                expect(recorded.cwd).toBe(fx.work);

                await rm(fx.base, { recursive: true, force: true });
            });

            test('off switch skips backfill completely (SURFDASH_LISTEN_BACKFILL=off)', async () => {
                const fx = await setupGateFixture('test-backfill-off');
                const recorderScript = `
import { appendFileSync } from 'node:fs';
appendFileSync('${join(fx.work, 'should-not-run.txt')}', 'ran');
process.exit(0);
`;
                await writeFile(join(fx.work, 'scripts', 'sd.ts'), `${recorderScript.trim()}\n`, 'utf-8');

                process.env.SURFDASH_LISTEN_BACKFILL = 'off';
                try {
                    const backfilled = await runListenLinkBackfill(fx.work);
                    expect(backfilled).toEqual([]);
                    expect(existsSync(join(fx.work, 'should-not-run.txt'))).toBe(false);
                } finally {
                    delete process.env.SURFDASH_LISTEN_BACKFILL;
                    await rm(fx.base, { recursive: true, force: true });
                }
            });

            test('backfill failure is non-fatal: reported via echoError and publish succeeds', async () => {
                const fx = await setupGateFixture('test-backfill-fail-publish');
                const restoreFetch = mockLiveFetch();

                process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
                process.env.SURFDASH_ROOT = fx.work;
                process.env.SURFDASH_AUTO_PUSH = '1';
                process.env.TEST_SD_LISTEN_BACKFILL_FAIL = '1';

                const errTarget = createBufferTarget();
                const restore = setDefaultOutputTargets({ stderr: errTarget });
                try {
                    const transport = new PostsurfingFileCliTransport();
                    const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                    expect(result.ok).toBe(true);
                    expect(errTarget.text()).toContain('listen-link backfill:');
                    expect(errTarget.text()).toContain('listen-link backfill failed: network error');

                    const pushed = await new Response(
                        Bun.spawn(['git', '--git-dir', fx.origin, 'log', '-1', '--format=%s', 'main']).stdout,
                    ).text();
                    expect(pushed).toContain('daily AI news 20261024');
                } finally {
                    restore();
                    restoreFetch();
                    delete process.env.TEST_SD_LISTEN_BACKFILL_FAIL;
                    delete process.env.POSTSURFING_BIN;
                    delete process.env.SURFDASH_ROOT;
                    process.env.SURFDASH_AUTO_PUSH = '0';
                    await rm(fx.base, { recursive: true, force: true });
                }
            });

            test('backfill failure is non-fatal: reported via echoError and patch succeeds', async () => {
                const fx = await setupGateFixture('test-backfill-fail-patch');
                process.env.SURFDASH_ROOT = fx.work;
                process.env.SURFDASH_AUTO_PUSH = '1';
                process.env.TEST_SD_LISTEN_BACKFILL_FAIL = '1';

                const zhPostPath = join(fx.work, 'content', 'posts', 'articles', 'zh', '20261024-post', 'index.md');
                await mkdir(dirname(zhPostPath), { recursive: true });
                await writeFile(
                    zhPostPath,
                    `---\ntitle: ZH\npublishDate: '2026-10-24'\nimage: ./assets/cover.png\n---\n\nBody\n`,
                );
                await writeFile(join(fx.work, 'scripts', 'publish-orchestrator.ts'), 'process.exit(0);\n');

                const gitRun = async (cmd: string[], cwd: string): Promise<void> => {
                    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
                    await proc.exited;
                };
                await gitRun(['git', 'add', '-A'], fx.work);
                await gitRun(['git', 'commit', '-m', 'add-post'], fx.work);
                await gitRun(['git', 'push', 'origin', 'main'], fx.work);

                const errTarget = createBufferTarget();
                const restore = setDefaultOutputTargets({ stderr: errTarget });
                try {
                    const transport = new PostsurfingFileCliTransport();
                    const result = await transport.publish({
                        content: { title: 'unused', body: 'unused', format: 'markdown' },
                        options: {
                            operation: 'patch',
                            postPath: zhPostPath,
                            coverUrl: 'https://cdn.example/cover.png',
                            dateIso: '2026-10-24',
                        },
                    });
                    expect(result.ok).toBe(true);
                    expect(errTarget.text()).toContain('listen-link backfill:');
                    expect(errTarget.text()).toContain('listen-link backfill failed: network error');
                } finally {
                    restore();
                    delete process.env.TEST_SD_LISTEN_BACKFILL_FAIL;
                    delete process.env.SURFDASH_ROOT;
                    process.env.SURFDASH_AUTO_PUSH = '0';
                    await rm(fx.base, { recursive: true, force: true });
                }
            });

            test('backfilled paths end up in the commit pathspec on publish (unrelated staged files stay out)', async () => {
                const fx = await setupGateFixture('test-backfill-paths-publish');
                const restoreFetch = mockLiveFetch();

                const oldPostRel = join('content', 'posts', 'articles', 'zh', '20261023-old', 'index.md');
                const oldPostPath = join(fx.work, oldPostRel);
                await mkdir(dirname(oldPostPath), { recursive: true });
                await writeFile(oldPostPath, '---\ntitle: Old\n---\nOld body\n');

                await run(['git', 'add', oldPostRel], fx.work);
                await run(['git', 'commit', '-m', 'seed-old-post'], fx.work);
                await run(['git', 'push', 'origin', 'main'], fx.work);

                const unrelatedFile = join(fx.work, 'other.txt');
                await writeFile(unrelatedFile, 'unrelated content\n');
                await run(['git', 'add', 'other.txt'], fx.work);

                const backfillScript = `
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'seo' && argv[1] === 'listen-link') {
    writeFileSync(${JSON.stringify(oldPostPath)}, '---\\ntitle: Old\\n---\\nOld body backfilled with listen link\\n');
    console.log('✎ 20261023-old [backfilled]');
    console.log('seo listen-link backfill — 1 linked (written), 0 not-live, 0 already-linked');
    process.exit(0);
}
if (argv[0] === 'check' && argv[1] === 'digest') {
    process.exit(0);
}
process.exit(1);
`;
                await writeFile(join(fx.work, 'scripts', 'sd.ts'), `${backfillScript.trim()}\n`, 'utf-8');

                process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
                process.env.SURFDASH_ROOT = fx.work;
                process.env.SURFDASH_AUTO_PUSH = '1';

                try {
                    const transport = new PostsurfingFileCliTransport();
                    const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                    expect(result.ok).toBe(true);

                    const committedFilesRaw = await new Response(
                        Bun.spawn(['git', '--git-dir', fx.origin, 'show', '--name-only', '--pretty=format:', 'main'])
                            .stdout,
                    ).text();
                    const committedFiles = committedFilesRaw
                        .split('\n')
                        .map((l) => l.trim())
                        .filter((l) => l.length > 0);

                    expect(committedFiles).toContain(oldPostRel);
                    expect(committedFiles.some((f) => f.includes('20261024-test'))).toBe(true);
                    expect(committedFiles).not.toContain('other.txt');

                    const stagedRaw = await new Response(
                        Bun.spawn(['git', 'diff', '--cached', '--name-only'], { cwd: fx.work }).stdout,
                    ).text();
                    expect(stagedRaw).toContain('other.txt');
                } finally {
                    restoreFetch();
                    delete process.env.POSTSURFING_BIN;
                    delete process.env.SURFDASH_ROOT;
                    process.env.SURFDASH_AUTO_PUSH = '0';
                    await rm(fx.base, { recursive: true, force: true });
                }
            });

            test('backfilled paths end up in the commit pathspec on patch (unrelated staged files stay out)', async () => {
                const fx = await setupGateFixture('test-backfill-paths-patch');

                const oldPostRel = join('content', 'posts', 'articles', 'zh', '20261023-old', 'index.md');
                const oldPostPath = join(fx.work, oldPostRel);
                await mkdir(dirname(oldPostPath), { recursive: true });
                await writeFile(oldPostPath, '---\ntitle: Old\n---\nOld body\n');

                const zhPostRel = join('content', 'posts', 'articles', 'zh', '20261024-post', 'index.md');
                const zhPostPath = join(fx.work, zhPostRel);
                await mkdir(dirname(zhPostPath), { recursive: true });
                await writeFile(
                    zhPostPath,
                    `---\ntitle: ZH\npublishDate: '2026-10-24'\nimage: ./assets/cover.png\n---\n\nBody\n`,
                );

                await writeFile(join(fx.work, 'scripts', 'publish-orchestrator.ts'), 'process.exit(0);\n');

                await run(['git', 'add', '-A'], fx.work);
                await run(['git', 'commit', '-m', 'seed-posts'], fx.work);
                await run(['git', 'push', 'origin', 'main'], fx.work);

                await writeFile(join(fx.work, 'other.txt'), 'unrelated content\n');
                await run(['git', 'add', 'other.txt'], fx.work);

                const backfillScript = `
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'seo' && argv[1] === 'listen-link') {
    writeFileSync(${JSON.stringify(oldPostPath)}, '---\\ntitle: Old\\n---\\nOld body backfilled\\n');
    console.log('✎ 20261023-old [backfilled]');
    process.exit(0);
}
if (argv[0] === 'check' && argv[1] === 'digest') {
    process.exit(0);
}
process.exit(1);
`;
                await writeFile(join(fx.work, 'scripts', 'sd.ts'), `${backfillScript.trim()}\n`, 'utf-8');

                process.env.SURFDASH_ROOT = fx.work;
                process.env.SURFDASH_AUTO_PUSH = '1';

                try {
                    const transport = new PostsurfingFileCliTransport();
                    const result = await transport.publish({
                        content: { title: 'unused', body: 'unused', format: 'markdown' },
                        options: {
                            operation: 'patch',
                            postPath: zhPostPath,
                            coverUrl: 'https://cdn.example/cover.png',
                            dateIso: '2026-10-24',
                        },
                    });
                    expect(result.ok).toBe(true);

                    const committedFilesRaw = await new Response(
                        Bun.spawn(['git', '--git-dir', fx.origin, 'show', '--name-only', '--pretty=format:', 'main'])
                            .stdout,
                    ).text();
                    const committedFiles = committedFilesRaw
                        .split('\n')
                        .map((l) => l.trim())
                        .filter((l) => l.length > 0);

                    expect(committedFiles).toContain(oldPostRel);
                    expect(committedFiles).toContain(zhPostRel);
                    expect(committedFiles).not.toContain('other.txt');

                    const stagedRaw = await new Response(
                        Bun.spawn(['git', 'diff', '--cached', '--name-only'], { cwd: fx.work }).stdout,
                    ).text();
                    expect(stagedRaw).toContain('other.txt');
                } finally {
                    delete process.env.SURFDASH_ROOT;
                    process.env.SURFDASH_AUTO_PUSH = '0';
                    await rm(fx.base, { recursive: true, force: true });
                }
            });

            test('execution order is backfill -> site gate -> commit', async () => {
                const fx = await setupGateFixture('test-backfill-order');
                const restoreFetch = mockLiveFetch();

                const orderLog = join(fx.work, 'order.log');

                const sdScript = `
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2);
if (argv[0] === 'seo' && argv[1] === 'listen-link') {
    appendFileSync('${orderLog}', 'backfill\\n');
    process.exit(0);
}
if (argv[0] === 'check' && argv[1] === 'digest') {
    appendFileSync('${orderLog}', 'site-gate:sd-check-digest\\n');
    process.exit(0);
}
process.exit(1);
`;
                await writeFile(join(fx.work, 'scripts', 'sd.ts'), `${sdScript.trim()}\n`, 'utf-8');

                const checkContentScript = `
import { appendFileSync } from 'node:fs';
appendFileSync('${orderLog}', 'site-gate:check-content\\n');
process.exit(0);
`;
                await writeFile(
                    join(fx.work, 'scripts', 'check-content.ts'),
                    `${checkContentScript.trim()}\n`,
                    'utf-8',
                );

                const hookPath = join(fx.work, '.git', 'hooks', 'pre-commit');
                await writeFile(hookPath, `#!/bin/sh\nprintf "commit\\n" >> "${orderLog}"\nexit 0\n`);
                await Bun.spawn(['chmod', '+x', hookPath]).exited;

                process.env.POSTSURFING_BIN = join(fx.work, 'postsurfing');
                process.env.SURFDASH_ROOT = fx.work;
                process.env.SURFDASH_AUTO_PUSH = '1';

                try {
                    const transport = new PostsurfingFileCliTransport();
                    const result = await transport.publish({ content: makeContent(fx.coverSrc) });
                    expect(result.ok).toBe(true);

                    const logLines = (await readFile(orderLog, 'utf-8'))
                        .split('\n')
                        .map((l) => l.trim())
                        .filter((l) => l.length > 0);

                    expect(logLines).toEqual([
                        'backfill',
                        'site-gate:sd-check-digest',
                        'site-gate:check-content',
                        'commit',
                    ]);
                } finally {
                    restoreFetch();
                    delete process.env.POSTSURFING_BIN;
                    delete process.env.SURFDASH_ROOT;
                    process.env.SURFDASH_AUTO_PUSH = '0';
                    await rm(fx.base, { recursive: true, force: true });
                }
            });
        });
    });
});
